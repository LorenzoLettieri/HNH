// Draws the bulls. FOR NOW A "GREYBOX", like the first hound: a few boxes
// (body, hump, head, horns, legs), glowing eyes and a brass nose ring.
// Enough to test how it moves and charges; the pixel-art sprite comes later.
//
// A real 3D object: it turns to face its direction (dirX/dirZ in the sim),
// not the camera. The poses tell you what it's about to do:
//   aim     → stops, paws the ground, head going down, eyes heating up;
//             head fully down and eyes blazing = direction locked, MOVE.
//   charge  → leaning forward, fast gallop.
//   stunned → head swaying, eyes dim: shoot it now.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { BullEntity, Entity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { playBullBellow, playBullCrash, playBullSnort, playGhoulDeath } from '../../audio/sfx';

/** How fast the model turns toward its direction (1/s). */
const TURN_RATE = 8;
/** Leg swing: radians of stride per meter walked. */
const STRIDE_PER_METER = 2.2;
/** Eye glow (HDR, blooms): calm, heating up while aiming, blazing when locked / charging, dim when dazed. */
const EYES_CALM = 2;
const EYES_LOCKED = 10;
const EYES_DAZED = 0.4;
/** Head height when walking and when lowered for the charge (local y of the head pivot). */
const HEAD_UP = 1.35;
const HEAD_DOWN = 0.95;

interface BullView {
  group: THREE.Group;
  /** Body, head and legs: everything except the root, so it can lean without moving the feet. */
  body: THREE.Group;
  head: THREE.Group;
  /** Hip pivots: front-left, front-right, back-left, back-right. */
  legs: THREE.Group[];
  eyeMat: THREE.MeshStandardMaterial;
  yaw: number;
  stride: number;
  fallAngle: number;
}

export interface BullRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createBullRenderer(scene: THREE.Scene): BullRenderer {
  // Shared by every bull: geometries and materials are created once
  // (except the eyes: each bull's glow changes on its own).
  const hide = new THREE.MeshStandardMaterial({ color: 0x2a1210, roughness: 1 });
  const horn = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.8 });
  for (const m of [hide, horn, brass]) addHeightFog(m);
  const bodyGeo = new THREE.BoxGeometry(1.1, 1.0, 1.9);
  const humpGeo = new THREE.BoxGeometry(1.0, 0.45, 0.8);
  const plateGeo = new THREE.BoxGeometry(1.15, 0.08, 0.7);
  const headGeo = new THREE.BoxGeometry(0.6, 0.6, 0.65);
  const snoutGeo = new THREE.BoxGeometry(0.45, 0.3, 0.25);
  const hornBaseGeo = new THREE.BoxGeometry(0.45, 0.12, 0.12);
  const hornTipGeo = new THREE.BoxGeometry(0.1, 0.1, 0.45);
  const legGeo = new THREE.BoxGeometry(0.24, 0.8, 0.24);
  const eyeGeo = new THREE.BoxGeometry(0.1, 0.06, 0.02);
  const ringGeo = new THREE.TorusGeometry(0.1, 0.025, 6, 10);

  const views = new Map<number, BullView>();

  function create(): BullView {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // Model "forward" is +Z (so yaw = atan2(dirX, dirZ) points it where it goes).
    add(bodyGeo, hide, body, 0, 1.25, 0);
    add(humpGeo, hide, body, 0, 1.9, 0.45); // the shoulder hump: it reads as "bull" from far away
    add(plateGeo, brass, body, 0, 1.78, -0.35); // steampunk: a riveted brass plate on its back

    const head = new THREE.Group();
    head.position.set(0, HEAD_UP, 1.05);
    body.add(head);
    add(headGeo, hide, head, 0, 0, 0.2);
    add(snoutGeo, hide, head, 0, -0.15, 0.6);
    const ring = add(ringGeo, brass, head, 0, -0.32, 0.7);
    ring.rotation.y = Math.PI / 2;
    // Horns: a piece sideways, then a piece pointing forward (the dangerous end).
    for (const s of [-1, 1]) {
      add(hornBaseGeo, horn, head, s * 0.48, 0.25, 0.2);
      add(hornTipGeo, horn, head, s * 0.66, 0.3, 0.38);
    }
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff4010, emissiveIntensity: EYES_CALM });
    add(eyeGeo, eyeMat, head, -0.18, 0.08, 0.53);
    add(eyeGeo, eyeMat, head, 0.18, 0.08, 0.53);

    const legs: THREE.Group[] = [];
    for (const [x, z] of [[-0.35, 0.7], [0.35, 0.7], [-0.35, -0.7], [0.35, -0.7]]) {
      const hip = new THREE.Group(); // pivot at the hip: rotating it swings the leg
      hip.position.set(x, 0.8, z);
      body.add(hip);
      add(legGeo, hide, hip, 0, -0.4, 0);
      legs.push(hip);
    }
    scene.add(group);
    return { group, body, head, legs, eyeMat, yaw: 0, stride: 0, fallAngle: 0 };
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
        // Placeholder death sound (the ghoul's, pitched down would be nicer: later).
        if (e.type === 'hit' && e.killed) playGhoulDeath(where);
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'bull') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        draw(v, e, alpha, dt);
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.group);
        v.eyeMat.dispose();
        views.delete(id);
      }
    },
  };

  function draw(v: BullView, e: BullEntity, alpha: number, dt: number): void {
    v.group.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    // Face its direction, turning the shortest way round. While charging the
    // direction is locked, so it snaps (no smoothing): what you see is where it goes.
    const target = Math.atan2(e.dirX, e.dirZ);
    const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
    if (e.state === 'charge' || e.state === 'aim') v.yaw = target;
    else if (e.state !== 'dead') v.yaw += diff * Math.min(1, TURN_RATE * dt);
    v.group.rotation.set(0, v.yaw, 0);

    const t = e.stateTicks / 60; // seconds in the current state
    const speed = Math.hypot(e.vx, e.vz);
    v.stride += speed * dt * STRIDE_PER_METER;
    let swing = Math.sin(v.stride) * Math.min(0.6, speed * 0.12); // walking legs: diagonal pairs
    let lean = 0; // forward pitch of the body
    let headY = HEAD_UP;
    let headRoll = 0;
    let eyes = EYES_CALM;
    let paw = 0;

    if (e.state === 'aim') {
      // Head goes down until the lock, then stays down; eyes heat up with it.
      const lockTime = tuning.bullAimTime - tuning.bullAimLockTime;
      const k = Math.min(1, t / Math.max(0.01, lockTime));
      headY = HEAD_UP + (HEAD_DOWN - HEAD_UP) * k;
      eyes = t >= lockTime ? EYES_LOCKED : EYES_CALM + (EYES_LOCKED * 0.5 - EYES_CALM) * k;
      if (t < lockTime) paw = Math.max(0, Math.sin(t * 14)) * 0.7; // front-right hoof scrapes the ground
      lean = 0.08 * k;
    } else if (e.state === 'charge') {
      headY = HEAD_DOWN;
      eyes = EYES_LOCKED;
      lean = 0.12;
      swing = Math.sin(v.stride * 0.8) * 0.8; // long gallop strides
    } else if (e.state === 'skid') {
      headY = HEAD_DOWN + 0.15;
      lean = -0.15; // leaning back, hooves dug in
      swing = 0.4;
    } else if (e.state === 'stunned') {
      headY = HEAD_DOWN + 0.1;
      headRoll = Math.sin(t * 6) * 0.35; // dazed: the head sways side to side
      eyes = EYES_DAZED;
    }

    v.head.position.y = headY;
    v.head.rotation.z = headRoll;
    v.eyeMat.emissiveIntensity = eyes;
    v.body.rotation.x = lean;
    // Diagonal pairs move together (front-left with back-right): a walk/trot.
    v.legs[0].rotation.x = swing;
    v.legs[3].rotation.x = swing;
    v.legs[1].rotation.x = -swing - paw;
    v.legs[2].rotation.x = -swing;

    if (e.state === 'dead') {
      // Rolls onto its side (slower than the hound: it's heavy), then sinks.
      v.eyeMat.emissiveIntensity = 0;
      v.fallAngle = Math.min(Math.PI / 2, v.fallAngle + dt * 4);
      const remaining = tuning.bullCorpseTime - t;
      if (remaining < 1) v.group.position.y -= (1 - remaining) * 0.5;
    }
    v.group.rotation.z = v.fallAngle;
  }
}
