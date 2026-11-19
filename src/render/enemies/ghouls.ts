// Draws the ghouls: one flat sprite each, always turned toward the camera
// around the vertical axis only (like Doom: from a rooftop they look a bit
// "flat", that's part of the style). Picks the animation frame from what the
// ghoul is doing in the simulation, and makes dead ones fall over.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, GhoulEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { FRAMES, FRAME_H, FRAME_W, GHOUL_FRAME_COUNT, ghoulSheet } from './ghoulSprite';

const PIXELS_PER_METER = 32;
/** Walk animation speed: frames per meter walked (feet must not "skate"). */
const FRAMES_PER_METER = 2.2;
/** How long the hurt frame shows after a hit, seconds. */
const HURT_TIME = 0.15;
/** Eye glow strength (HDR, blooms). */
const EYE_GLOW = 4;

interface GhoulView {
  mesh: THREE.Mesh;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  walkPhase: number;
  hurtTime: number;
  fallAngle: number;
}

export interface GhoulRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createGhoulRenderer(scene: THREE.Scene): GhoulRenderer {
  const sheet = ghoulSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  // The quad stands on its bottom edge: the ghoul's feet are at the origin.
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);

  const views = new Map<number, GhoulView>();

  function create(): GhoulView {
    // Each ghoul has its own copy of the textures (same image) so it can
    // show its own frame, like the flames.
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5, // hard pixel edges, no transparency sorting
      emissive: 0xff7020,
      emissiveMap: glowMap,
      emissiveIntensity: EYE_GLOW,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.order = 'YXZ'; // turn to the camera first, then fall over
    mesh.castShadow = true;
    // Shadows are drawn from a separate "depth" render: it needs the same
    // texture and alphaTest, otherwise the shadow would be a full rectangle.
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: 0.5,
    });
    scene.add(mesh);
    return { mesh, map, glowMap, walkPhase: 0, hurtTime: 0, fallAngle: 0 };
  }

  function showFrame(v: GhoulView, frame: number): void {
    v.map.offset.x = frame / GHOUL_FRAME_COUNT;
    v.glowMap.offset.x = frame / GHOUL_FRAME_COUNT;
  }

  return {
    update(entities, events, camera, alpha, dt) {
      for (const e of events) {
        if (e.type === 'hit' && e.surface === 'flesh') {
          const v = views.get(e.entityId);
          if (v) v.hurtTime = HURT_TIME;
        }
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'ghoul') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        place(v, e, camera, alpha);
        animate(v, e, dt);
      }
      // Ghouls removed from the simulation (old corpses): remove their sprite.
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.mesh);
        (v.mesh.material as THREE.Material).dispose();
        v.map.dispose();
        v.glowMap.dispose();
        views.delete(id);
      }
    },
  };

  function place(v: GhoulView, e: GhoulEntity, camera: THREE.Camera, alpha: number): void {
    // Interpolated position, like the player's camera.
    v.mesh.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    // "Cylindrical billboard": rotate around Y only, so it faces the camera.
    v.mesh.rotation.y = Math.atan2(camera.position.x - v.mesh.position.x, camera.position.z - v.mesh.position.z);
  }

  function animate(v: GhoulView, e: GhoulEntity, dt: number): void {
    v.hurtTime -= dt;
    if (e.state === 'dead') {
      // Falls backward (away from the camera) and, near the end, sinks
      // into the ground before the corpse is removed.
      v.fallAngle = Math.min(Math.PI / 2, v.fallAngle + dt * 7);
      v.mesh.rotation.x = -v.fallAngle;
      const remaining = tuning.ghoulCorpseTime - e.stateTicks / 60;
      if (remaining < 1) v.mesh.position.y -= (1 - remaining) * 0.3;
      showFrame(v, FRAMES.hurt);
      return;
    }
    v.mesh.rotation.x = 0;
    if (v.hurtTime > 0) {
      showFrame(v, FRAMES.hurt);
    } else if (e.state === 'attack') {
      const progress = e.stateTicks / (tuning.ghoulAttackTime * 60);
      showFrame(v, progress < 0.55 ? FRAMES.windup : FRAMES.swipe);
    } else {
      // Advance the walk cycle by the distance covered, not by time: a
      // ghoul pushed against a wall stops "walking".
      v.walkPhase += Math.hypot(e.vx, e.vz) * dt * FRAMES_PER_METER;
      showFrame(v, FRAMES.walk[Math.floor(v.walkPhase) % FRAMES.walk.length]);
    }
  }
}
