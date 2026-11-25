// Draws the eye-bats ("Malocchio"). Like the ghouls, one flat sprite each,
// but with a SPHERICAL billboard: the sprite copies the camera's whole
// rotation, so it faces you even when you look straight up at it. (The
// ghouls only turn around the vertical axis: they stand on the ground, and
// tilting them would make them lean. A floating eyeball has no "up" to keep.)
// It also guarantees that the pupil always looks at you: the same assumption
// the simulation makes for the critical hit (see pupilHit in weapon.ts).
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, EyebatEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { EYEBAT_FRAMES, EYEBAT_FRAME_H, EYEBAT_FRAME_W, eyebatSheet } from './eyebatSprite';
import { playEyebatCharge, playFireball, playGhoulDeath } from '../../audio/sfx';
import { addSpecimen } from '../warmUp';

const PIXELS_PER_METER = 32;
/** Wing beats per second (one beat = the 4-frame cycle). */
const FLAPS_PER_SECOND = 5;
/** How long the hurt frame shows after a hit, seconds. */
const HURT_TIME = 0.15;
/** Iris glow strength (HDR, blooms). */
const IRIS_GLOW = 3;
/** Iris glow at the end of a charge, right before the shot. */
const CHARGE_GLOW = 14;

interface EyebatView {
  mesh: THREE.Mesh;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  flapPhase: number;
  hurtTime: number;
}

export interface EyebatRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createEyebatRenderer(scene: THREE.Scene): EyebatRenderer {
  const sheet = eyebatSheet();
  // Centered quad: the mesh's position is the center of the eye.
  const geometry = new THREE.PlaneGeometry(EYEBAT_FRAME_W / PIXELS_PER_METER, EYEBAT_FRAME_H / PIXELS_PER_METER);
  const views = new Map<number, EyebatView>();

  function create(): EyebatView {
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      emissive: 0xff5010,
      emissiveMap: glowMap,
      emissiveIntensity: IRIS_GLOW,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; // a flying shadow on the ground: you see it coming from above
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);
    // Random start phase: a group doesn't flap in sync (purely visual).
    return { mesh, map, glowMap, flapPhase: Math.random() * 4, hurtTime: 0 };
  }

  function showFrame(v: EyebatView, frame: number): void {
    v.map.offset.x = frame / sheet.frameCount;
    v.glowMap.offset.x = frame / sheet.frameCount;
  }

  // One hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => create());

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        if (e.type === 'eyebatCharge' || e.type === 'eyebatShot') {
          const b = byId.get(e.entityId);
          if (!b) continue;
          const where = soundAt(camera, b.x, b.y, b.z);
          if (e.type === 'eyebatCharge') playEyebatCharge(where, tuning.eyebatChargeTime);
          else playFireball(where);
          continue;
        }
        if (e.type !== 'hit') continue;
        const b = byId.get(e.entityId);
        if (!b || b.type !== 'eyebat') continue;
        const v = views.get(e.entityId);
        if (v) v.hurtTime = HURT_TIME;
        if (e.killed) playGhoulDeath(soundAt(camera, b.x, b.y, b.z));
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'eyebat') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        place(v, e, camera, alpha);
        animate(v, e, dt);
      }
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

  function place(v: EyebatView, e: EyebatEntity, camera: THREE.Camera, alpha: number): void {
    const r = tuning.eyebatRadius;
    v.mesh.position.set(
      e.px + (e.x - e.px) * alpha,
      e.py + (e.y - e.py) * alpha + r, // e.y is the bottom of the body
      e.pz + (e.z - e.pz) * alpha,
    );
    // Spherical billboard: same rotation as the camera = parallel to the screen.
    v.mesh.quaternion.copy(camera.quaternion);
  }

  function animate(v: EyebatView, e: EyebatEntity, dt: number): void {
    v.hurtTime -= dt;
    if (e.state === 'dead') {
      showFrame(v, e.popped ? EYEBAT_FRAMES.popped : EYEBAT_FRAMES.dead);
      // Near the end, sink into the ground before the corpse is removed.
      const remaining = tuning.eyebatCorpseTime - e.stateTicks / 60;
      if (remaining < 1) v.mesh.position.y -= (1 - remaining) * 0.4;
      return;
    }
    const material = v.mesh.material as THREE.MeshStandardMaterial;
    if (e.state === 'charge') {
      // The warning: pupil dilated, and the iris glows brighter and brighter
      // (progress² = slow at first, then blazing right before the shot),
      // flickering faster and faster.
      const progress = Math.min(1, e.stateTicks / (tuning.eyebatChargeTime * 60));
      const flicker = 0.85 + 0.15 * Math.sin(e.stateTicks * (0.5 + progress));
      material.emissiveIntensity = (IRIS_GLOW + (CHARGE_GLOW - IRIS_GLOW) * progress * progress) * flicker;
      showFrame(v, EYEBAT_FRAMES.charge);
      return;
    }
    material.emissiveIntensity = IRIS_GLOW;
    if (v.hurtTime > 0) {
      showFrame(v, EYEBAT_FRAMES.hurt);
      return;
    }
    // Flap faster when climbing (it's working harder), slower when gliding down.
    const effort = 1 + Math.max(-0.4, Math.min(0.6, e.vy * 0.15));
    v.flapPhase += dt * FLAPS_PER_SECOND * EYEBAT_FRAMES.flap.length * effort;
    showFrame(v, EYEBAT_FRAMES.flap[Math.floor(v.flapPhase) % EYEBAT_FRAMES.flap.length]);
  }
}
