// Draws the bulls: a sprite billboard each (always turned toward the camera
// around the vertical axis), with THREE VIEWS picked from the angle, like the
// hound (see hounds.ts for the idea):
//
//   rel = (where the bull is facing) − (direction from the bull to the camera)
//   cos(rel) ≈  1 → it faces you        → FRONT view
//   cos(rel) ≈ -1 → it faces away       → BACK view
//   otherwise     → SIDE view, mirrored when it faces the left of the screen
//
// Its facing is dirX/dirZ from the simulation (where it walks, aims, charges),
// not its velocity: while aiming it stands still but turns toward you, and
// that turning is exactly what you need to SEE.
//
// What each state shows (the warning must be readable):
//   approach → walking;  aim → pawing the ground, head lowering, eyes heating;
//   locked (end of aim) → head down, eyes blazing: MOVE;  charge → gallop;
//   skid → braced legs;  stunned → drooping head, stars, eyes out: shoot it.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { BullEntity, Entity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { bullSheet, FRAMES, FRAME_H, FRAME_W } from './bullSprite';
import { playBullBellow, playBullCrash, playBullSnort, playGhoulDeath } from '../../audio/sfx';

const PIXELS_PER_METER = 32;
/** Walk animation speed: frames per meter (a 4-frame stride ≈ 2.7 m). */
const FRAMES_PER_METER = 1.5;
/** Gallop: frames per meter while charging (2 frames per bound). */
const CHARGE_FRAMES_PER_METER = 0.6;
/** Pawing the ground while aiming: frames per second. */
const PAW_RATE = 7;
/** How long the hurt tint shows after a hit, seconds. */
const HURT_TIME = 0.12;
/** How fast its facing follows its direction while walking (1/s). */
const TURN_RATE = 8;
/** Within this angle of "straight at / away from the camera", show the front / back view. */
const FRONT_ANGLE = (35 * Math.PI) / 180;
/** Glow of eyes, nostrils, cracks and pipes (HDR, blooms). */
const GLOW_CALM = 1.5;
const GLOW_LOCKED = 7;
const GLOW_DAZED = 0.4;

interface BullView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  /** Direction it's facing (radians, the player's yaw convention), smoothed while walking. */
  yaw: number;
  /** Distance walked/run, converted into animation frames. */
  walkPhase: number;
  chargePhase: number;
  hurtTime: number;
}

export interface BullRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createBullRenderer(scene: THREE.Scene): BullRenderer {
  const sheet = bullSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  // The quad stands on its bottom edge: the hooves are at the origin.
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);
  const white = new THREE.Color(1, 1, 1);
  const hurtTint = new THREE.Color(1, 0.55, 0.5);

  const views = new Map<number, BullView>();

  function create(): BullView {
    // Own copies of the textures (same image): each bull shows its own frame.
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      emissive: 0xff5a18,
      emissiveMap: glowMap,
      emissiveIntensity: GLOW_CALM,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);
    return { mesh, material, map, glowMap, yaw: 0, walkPhase: 0, chargePhase: 0, hurtTime: 0 };
  }

  /** Shows one frame of the sheet; a NEGATIVE repeat mirrors it for free (see hounds.ts). */
  function showFrame(v: BullView, frame: number, mirror: boolean): void {
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
        const b =
          e.type === 'bullAim' || e.type === 'bullCharge' || e.type === 'bullCrash' || e.type === 'hit'
            ? byId.get(e.entityId)
            : undefined;
        if (!b || b.type !== 'bull') continue;
        const where = soundAt(camera, b.x, b.y + 1.2, b.z);
        if (e.type === 'bullAim') playBullSnort(where, tuning.bullAimTime);
        if (e.type === 'bullCharge') playBullBellow(where);
        if (e.type === 'bullCrash') playBullCrash(where);
        if (e.type === 'hit') {
          const v = views.get(b.id);
          if (v) v.hurtTime = HURT_TIME;
          // Placeholder death sound (the ghoul's): a proper one later.
          if (e.killed) playGhoulDeath(where);
        }
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'bull') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          v.yaw = Math.atan2(e.dirX, e.dirZ);
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

  function draw(v: BullView, e: BullEntity, camera: THREE.Camera, alpha: number, dt: number): void {
    const m = v.mesh;
    m.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    const toCamera = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    m.rotation.y = toCamera; // cylindrical billboard

    // Facing. Aiming and charging: exactly the sim's direction (what you see
    // is where it goes). Walking: smoothed, turning the shortest way round.
    const target = Math.atan2(e.dirX, e.dirZ);
    if (e.state === 'aim' || e.state === 'charge') v.yaw = target;
    else if (e.state !== 'dead') {
      const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
      v.yaw += diff * Math.min(1, TURN_RATE * dt);
    }
    const rel = v.yaw - toCamera;
    const view = Math.cos(rel) > Math.cos(FRONT_ANGLE) ? 'front' : Math.cos(rel) < -Math.cos(FRONT_ANGLE) ? 'back' : 'side';
    const mirror = Math.sin(rel) < 0;

    const speed = Math.hypot(e.vx, e.vz);
    v.walkPhase += speed * dt * FRAMES_PER_METER;
    v.chargePhase += speed * dt * CHARGE_FRAMES_PER_METER;
    v.hurtTime -= dt;
    v.material.color.copy(v.hurtTime > 0 ? hurtTint : white);

    const t = e.stateTicks / 60; // seconds in the current state
    const lockAt = tuning.bullAimTime - tuning.bullAimLockTime;
    const locked = e.state === 'aim' && t >= lockAt;
    const walk = Math.floor(v.walkPhase);
    const gallop = Math.floor(v.chargePhase);

    // Glow: calm → heating up while it aims → blazing when locked / charging.
    if (e.state === 'aim') v.material.emissiveIntensity = locked ? GLOW_LOCKED : GLOW_CALM + (GLOW_LOCKED * 0.5 - GLOW_CALM) * (t / lockAt);
    else if (e.state === 'charge') v.material.emissiveIntensity = GLOW_LOCKED;
    else if (e.state === 'stunned') v.material.emissiveIntensity = GLOW_DAZED;
    else v.material.emissiveIntensity = GLOW_CALM;

    if (e.state === 'dead') {
      v.material.emissiveIntensity = 0; // the fire inside goes out
      showFrame(v, FRAMES.dead, mirror);
      const remaining = tuning.bullCorpseTime - t;
      if (remaining < 1) m.position.y -= (1 - remaining) * 0.6; // sinks into the ground
      return;
    }

    if (view === 'front') {
      const f = FRAMES.front;
      let frame = f.walk[walk % 2];
      if (e.state === 'aim') frame = locked ? f.charge[0] : f.walk[0];
      else if (e.state === 'charge') frame = f.charge[gallop % 2];
      else if (e.state === 'skid') frame = f.charge[0];
      else if (e.state === 'stunned') frame = f.dazed;
      showFrame(v, frame, false);
    } else if (view === 'back') {
      showFrame(v, FRAMES.back.walk[(e.state === 'charge' ? gallop : walk) % 2], false);
    } else {
      const f = FRAMES.side;
      let frame = f.walk[walk % 4];
      if (e.state === 'aim') frame = locked ? f.locked : f.paw[Math.floor(t * PAW_RATE) % 2];
      else if (e.state === 'charge') frame = f.charge[gallop % 2];
      else if (e.state === 'skid') frame = f.skid;
      else if (e.state === 'stunned') frame = f.dazed;
      showFrame(v, frame, mirror);
    }
  }
}
