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
//
// The aim is the warning that matters most, so it gets more than a pose
// (particles in particles.ts, all purely visual):
//   - it TREMBLES, harder and harder (the sprite shakes sideways);
//   - each scrape of the hoof kicks up DIRT behind it;
//   - fiery SNORTS from the nostrils and puffs from the exhaust pipes, faster as it gets closer;
//   - at the LOCK: a burst of fire from nostrils and pipes, a cloud of dirt and
//     a "swell" of the sprite (it gets bigger for an instant). After that it's coming.
//   - while charging it leaves a trail of dirt and flames behind.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { BullEntity, Entity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { bullSheet, FRAMES, FRAME_H, FRAME_W } from './bullSprite';
import { spawnDirt, spawnSnort } from '../particles';
import { playBullBellow, playBullCrash, playBullSnort, playGhoulDeath } from '../../audio/sfx';
import { addSpecimen } from '../warmUp';

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
/** Trembling while aiming: sideways shake, meters (grows from START to LOCKED), and speed (rad/s). */
const SHAKE_START = 0.01;
const SHAKE_LOCKED = 0.07;
const SHAKE_SPEED = 70;
/** Snorts while aiming: seconds between two, at the start and just before the lock. */
const SNORT_EVERY_START = 0.45;
const SNORT_EVERY_LOCKED = 0.12;
/** How much the sprite swells at the lock (0.15 = +15%), and how fast it goes back (1/s). */
const LOCK_SWELL = 0.15;
const SWELL_DECAY = 6;
/** Charge trail: seconds between two puffs of dirt/flames behind it. */
const TRAIL_EVERY = 0.05;

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
  /** Seconds until the next snort / trail puff. */
  puffTimer: number;
  /** The paw frame shown last (a new scrape = dirt). */
  lastPaw: number;
  /** The lock burst was already played for this aim. */
  lockBurst: boolean;
  /** 1 right at the lock, then back to 0: the swell. */
  swell: number;
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
  // Scratch vectors for the particle calls (no new objects every frame).
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();

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
    return { mesh, material, map, glowMap, yaw: 0, walkPhase: 0, chargePhase: 0, hurtTime: 0, puffTimer: 0, lastPaw: -1, lockBurst: false, swell: 0 };
  }

  /** Shows one frame of the sheet; a NEGATIVE repeat mirrors it for free (see hounds.ts). */
  function showFrame(v: BullView, frame: number, mirror: boolean): void {
    const n = sheet.frameCount;
    for (const t of [v.map, v.glowMap]) {
      t.repeat.x = (mirror ? -1 : 1) / n;
      t.offset.x = (mirror ? frame + 1 : frame) / n;
    }
  }

  // One hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => create());

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
        if (e.type === 'bullCrash') {
          playBullCrash(where);
          // Debris where its head hit the wall.
          point.set(b.x + b.dirX * 1.2, b.y + 0.6, b.z + b.dirZ * 1.2);
          dir.set(-b.dirX, 0.8, -b.dirZ);
          spawnDirt(point, dir, 30);
        }
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

    effects(v, e, t, lockAt, locked, dt);
    // The swell at the lock: bigger for an instant, then back to normal size.
    v.swell = Math.max(0, v.swell - SWELL_DECAY * dt);
    m.scale.setScalar(1 + LOCK_SWELL * v.swell);

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

  /**
   * The aim's warning effects and the charge trail. Positions are computed in
   * the world from the bull's facing (dirX, dirZ): nostrils ahead and low,
   * pipes on the back, hooves on the ground. They don't depend on the sprite.
   */
  function effects(v: BullView, e: BullEntity, t: number, lockAt: number, locked: boolean, dt: number): void {
    const m = v.mesh;
    const fx = e.dirX;
    const fz = e.dirZ;
    if (e.state !== 'aim') {
      v.lockBurst = false;
      v.lastPaw = -1;
    }

    if (e.state === 'aim') {
      // 0 → 1 over the aim, up to the lock.
      const k = Math.min(1, t / Math.max(0.01, lockAt));
      // Tremble: sideways along the billboard's own "right" axis (its local x
      // in the world is (cos θ, 0, −sin θ) for a rotation θ around y).
      const amp = locked ? SHAKE_LOCKED : SHAKE_START + (SHAKE_LOCKED - SHAKE_START) * k * 0.6;
      const shake = Math.sin(t * SHAKE_SPEED) * amp;
      m.position.x += Math.cos(m.rotation.y) * shake;
      m.position.z -= Math.sin(m.rotation.y) * shake;

      // A new scrape of the hoof (the paw frame changed): dirt flies backward.
      const paw = Math.floor(t * PAW_RATE) % 2;
      if (!locked && paw !== v.lastPaw && paw === 1) {
        point.set(e.x + fx * 1.0, e.y + 0.1, e.z + fz * 1.0);
        dir.set(-fx * 0.9, 0.5, -fz * 0.9);
        spawnDirt(point, dir, 7);
      }
      v.lastPaw = paw;

      // Snorts, more and more often.
      v.puffTimer -= dt;
      if (v.puffTimer <= 0 && !locked) {
        v.puffTimer = SNORT_EVERY_START + (SNORT_EVERY_LOCKED - SNORT_EVERY_START) * k;
        snortFrom(e, 3 + Math.round(k * 4));
        pipesFrom(e, 2 + Math.round(k * 3));
      }

      // THE LOCK: one big burst, once.
      if (locked && !v.lockBurst) {
        v.lockBurst = true;
        v.swell = 1;
        snortFrom(e, 18);
        pipesFrom(e, 14);
        for (const side of [-1, 1]) {
          point.set(e.x + fx * 0.9 - fz * side * 0.4, e.y + 0.1, e.z + fz * 0.9 + fx * side * 0.4);
          dir.set(-fx * 0.5 - fz * side * 0.6, 0.4, -fz * 0.5 + fx * side * 0.6);
          spawnDirt(point, dir, 12);
        }
      }
    } else if (e.state === 'charge' || e.state === 'skid') {
      // Trail: dirt from the hooves behind it; flames from the pipes while charging.
      v.puffTimer -= dt;
      if (v.puffTimer <= 0) {
        v.puffTimer = TRAIL_EVERY;
        point.set(e.x - fx * 0.8, e.y + 0.1, e.z - fz * 0.8);
        dir.set(-fx * 0.4, 0.7, -fz * 0.4);
        spawnDirt(point, dir, e.state === 'skid' ? 6 : 3);
        if (e.state === 'charge') pipesFrom(e, 2);
      }
    }
  }

  /** Fiery breath from the nostrils: ahead of it, low (head down), blown forward and down. */
  function snortFrom(e: BullEntity, count: number): void {
    point.set(e.x + e.dirX * 1.5, e.y + 1.0, e.z + e.dirZ * 1.5);
    dir.set(e.dirX * 0.8, -0.3, e.dirZ * 0.8);
    spawnSnort(point, dir, count);
  }

  /** Flames from the exhaust pipes on its back, straight up. */
  function pipesFrom(e: BullEntity, count: number): void {
    point.set(e.x - e.dirX * 0.3, e.y + 2.25, e.z - e.dirZ * 0.3);
    dir.set(0, 1, 0);
    spawnSnort(point, dir, count);
  }
}
