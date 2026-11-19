// Draws the hellhounds: a sprite billboard each (always turned toward the
// camera around the vertical axis, like the ghouls), but with THREE VIEWS
// picked from the angle, like Doom's sprites:
//
//   rel = (where the hound is going) − (direction from the hound to the camera)
//   cos(rel) ≈  1 → it's coming at you         → FRONT view
//   cos(rel) ≈ -1 → it's running away from you → BACK view
//   otherwise     → SIDE view, mirrored when it runs toward the left of the screen
//
// The sprite faces the camera, so "where the hound is going" can't be shown
// by turning the mesh: it's shown by WHICH IMAGE is on it.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, HoundEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { FRAMES, FRAME_H, FRAME_W, houndSheet } from './houndSprite';
import { playGhoulDeath, playHowl, playSwipe } from '../../audio/sfx';

const PIXELS_PER_METER = 32;
/** Gallop animation speed: frames per meter run (one 4-frame stride ≈ 2.5 m). */
const FRAMES_PER_METER = 1.6;
/** How long the hurt frame shows after a hit, seconds. */
const HURT_TIME = 0.15;
/** How fast its facing follows its velocity (1/s): smooths out jitter. */
const TURN_RATE = 12;
/** Within this angle of "straight at / away from the camera", show the front / back view. */
const FRONT_ANGLE = (35 * Math.PI) / 180;
/** Glow of eyes and ember cracks (HDR, blooms): smoldering while stalking, blazing when it charges. */
const GLOW_STALK = 1.5;
const GLOW_CHARGE = 6;
/** While stalking it slinks low: the sprite is squashed to this height. */
const STALK_SQUASH = 0.88;

interface HoundView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  /** Direction it's facing (radians, the player's yaw convention), smoothed. */
  yaw: number;
  runPhase: number;
  hurtTime: number;
}

export interface HoundRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createHoundRenderer(scene: THREE.Scene): HoundRenderer {
  const sheet = houndSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  // The quad stands on its bottom edge: the paws are at the origin.
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);

  const views = new Map<number, HoundView>();

  function create(): HoundView {
    // Own copies of the textures (same image): each hound shows its own frame.
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      emissive: 0xff5a18,
      emissiveMap: glowMap, // only the pixels marked "glow" (eyes, cracks) shine
      emissiveIntensity: GLOW_STALK,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);
    return { mesh, material, map, glowMap, yaw: 0, runPhase: 0, hurtTime: 0 };
  }

  /**
   * Shows one frame of the sheet. Mirroring is free: a NEGATIVE repeat reads
   * the frame from right to left (u goes from frame+1 down to frame).
   */
  function showFrame(v: HoundView, frame: number, mirror: boolean): void {
    const n = sheet.frameCount;
    for (const t of [v.map, v.glowMap]) {
      t.repeat.x = (mirror ? -1 : 1) / n;
      t.offset.x = (mirror ? frame + 1 : frame) / n;
    }
  }

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        const h = e.type === 'houndBite' || e.type === 'houndHowl' || e.type === 'hit' ? byId.get(e.entityId) : undefined;
        if (!h || h.type !== 'hound') continue;
        const where = soundAt(camera, h.x, h.y + 0.8, h.z);
        if (e.type === 'houndHowl') playHowl(where);
        // Placeholder sounds (ghoul ones) until the hound gets its own.
        if (e.type === 'houndBite') playSwipe(where);
        if (e.type === 'hit') {
          const v = views.get(h.id);
          if (v) v.hurtTime = HURT_TIME;
          if (e.killed) playGhoulDeath(where);
        }
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'hound') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        draw(v, e, camera, alpha, dt);
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.mesh);
        v.material.dispose();
        (v.mesh.customDepthMaterial as THREE.Material).dispose();
        v.map.dispose();
        v.glowMap.dispose();
        views.delete(id);
      }
    },
  };

  function draw(v: HoundView, e: HoundEntity, camera: THREE.Camera, alpha: number, dt: number): void {
    const m = v.mesh;
    m.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    const toCamera = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    m.rotation.y = toCamera; // cylindrical billboard

    // Facing: follows the velocity, turning the shortest way round
    // (the difference wrapped into [-π, π]).
    const speed = Math.hypot(e.vx, e.vz);
    if (e.state !== 'dead' && speed > 0.5) {
      const target = Math.atan2(e.vx, e.vz);
      const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
      v.yaw += diff * Math.min(1, TURN_RATE * dt);
    }

    // Which view? sin(rel) > 0 = it's heading toward the right of the screen
    // (the dot product of its direction with the billboard's right axis).
    const rel = v.yaw - toCamera;
    const view = Math.cos(rel) > Math.cos(FRONT_ANGLE) ? 'front' : Math.cos(rel) < -Math.cos(FRONT_ANGLE) ? 'back' : 'side';
    const mirror = Math.sin(rel) < 0;

    v.hurtTime -= dt;
    v.runPhase += speed * dt * FRAMES_PER_METER;
    const step = Math.floor(v.runPhase);
    m.scale.y = e.state === 'stalk' || e.state === 'retreat' ? STALK_SQUASH : 1;
    v.material.emissiveIntensity = e.state === 'charge' || e.state === 'bite' ? GLOW_CHARGE : GLOW_STALK;

    if (e.state === 'dead') {
      v.material.emissiveIntensity = 0; // the fire inside goes out
      m.scale.y = 1;
      showFrame(v, FRAMES.dead, mirror);
      const remaining = tuning.houndCorpseTime - e.stateTicks / 60;
      if (remaining < 1) m.position.y -= (1 - remaining) * 0.3; // sinks into the ground
      return;
    }
    const hurt = v.hurtTime > 0 || e.state === 'staggered';
    if (view === 'front') {
      const f = FRAMES.front;
      showFrame(v, hurt ? f.hurt : e.state === 'bite' ? f.bite : f.run[step % 2], false);
    } else if (view === 'back') {
      // From behind, a bite or a flinch look like running: the head is hidden.
      showFrame(v, hurt ? FRAMES.side.hurt : FRAMES.back.run[step % 2], hurt && mirror);
    } else {
      const f = FRAMES.side;
      // In the air (a jump, a charge over an obstacle): the stretched gallop frame.
      const frame = hurt ? f.hurt : e.state === 'bite' ? f.bite : !e.onGround ? f.run[0] : f.run[step % 4];
      showFrame(v, frame, mirror);
    }
  }
}
