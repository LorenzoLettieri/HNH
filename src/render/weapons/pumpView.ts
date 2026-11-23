// The PUMP-ACTION in your hands: the shotgun reinforced at the Forge
// (docs/DESIGN.md §6d). The model is "Shotgun" by Quaternius (CC0),
// public/models/pumpShotgun.glb, used AS DOWNLOADED: one mesh, four flat
// colors (Wood, Metal, DarkMetal, Black), nothing split into parts, and in
// its own conventions. The other guns were fitted once in Blender; this one
// is fitted here, in code, when the file has loaded (fitModel below). Same
// math as tools/blender/shovel.py, just run in the browser: a few thousand
// vertices, done once, costs nothing.
//
// THE PUMP, after every shot (timeline in fractions of pumpFireInterval):
//   1. the shot: the gun kicks (viewmodel.ts);
//   2. a small wind-up, then the left hand YANKS the fore-end back while the
//      whole gun is flung up and onto its side: a Stroke (elastic.ts), the
//      same tiny physics as the carbine's lever: a constant push, it slams
//      into the rear stop and bounces ("ch-"); the spent shell is flung high
//      out of the ejection port;
//   3. the hand SHOVES it forward, harder: it slams shut ("-CHK"), the gun
//      is thrown down past its rest pose and springs back, and the slam
//      punches your view (takePunch). Exaggerated on purpose: see CYCLE_KEYS.
// The left arm is a child of the fore-end, so it rides along with it.
//
// THE RELOAD (one shell at a time, like the simulation): for now only the
// gun's pose, rolled to show its belly (where the shells go into the tube),
// and a dip each time a shell goes in. The shells and the hand come next.
// Everything here is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { secondsToTicks, tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { fireInterval } from '../../sim/weapon';
import type { LeverTimes } from '../../audio/sfx';
import { ELASTIC_STEP, PoseSpring, Stroke, ZERO_POSE, poseAt, travelTime, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';
import { createRifleHands } from './hands';
import { createSpentCases, type CaseThrow } from './spentCases';

// --- Fitting the model ------------------------------------------------------------
// The FILE's coordinates (after its own node transform: the file has a 100×
// scale and a −90° turn on its node, applied by the loader): x along the
// barrel toward the muzzle, y up, z to the gun's right. The gun is 5.8
// units long, butt at x −1.48, muzzle at x +4.31. Measured once with a small
// script that reads the .glb and lists the connected pieces of each
// material with their bounds:
//   Wood       stock x −1.33…0.29          fore-end x 1.68…2.53
//   Metal      butt plate, receiver x 0.26…1.24, trigger guard
//   DarkMetal  magazine tube (low) and barrel (high, y 0.13…0.30) up to x 4.31
//   Black      trigger, front band, front sight
/** File units → meters: 5.8 × 0.17 ≈ 1 m, like the carbine (muzzle 0.71 m ahead of the hand). */
const SCALE = 0.17;
/** Where the right hand holds it (the wrist of the stock, just behind the trigger), file coordinates. */
const GRIP = new THREE.Vector3(0.12, -0.08, 0);
/** Wood triangles ahead of this x are the fore-end (the stock ends at 0.29, the fore-end starts at 1.68). */
const FORE_END_FROM_X = 1;
/** The muzzle (center of the barrel's front) and the ejection port (on the right of the receiver), file coordinates. */
const MUZZLE = new THREE.Vector3(4.31, 0.215, 0);
const PORT = new THREE.Vector3(0.94, 0.15, 0.06);

/**
 * The fit as ONE matrix, read right to left (like function composition):
 * move the grip to the origin, turn +90° around Y (the barrel, along +x,
 * now points to −z: "forward" in the viewmodel), scale to meters.
 */
const FIT = new THREE.Matrix4()
  .makeScale(SCALE, SCALE, SCALE)
  .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
  .multiply(new THREE.Matrix4().makeTranslation(-GRIP.x, -GRIP.y, -GRIP.z));
/** A point of the file in the viewmodel's coordinates. */
const fitted = (p: THREE.Vector3) => p.clone().applyMatrix4(FIT);
const FORE_END_Z = fitted(new THREE.Vector3(FORE_END_FROM_X, 0, 0)).z;

/**
 * Splits a geometry in two by triangles: those whose center passes the test,
 * and the rest. Both halves SHARE the vertex buffers (positions, normals):
 * only the index (the list of which vertices make each triangle) is new.
 */
function splitTriangles(
  geo: THREE.BufferGeometry,
  test: (center: THREE.Vector3) => boolean,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const count = index ? index.count : pos.count;
  const vertex = (i: number) => (index ? index.getX(i) : i);
  const yes: number[] = [];
  const no: number[] = [];
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    center.set(0, 0, 0);
    for (let k = 0; k < 3; k++) center.add(v.fromBufferAttribute(pos, vertex(t + k)));
    center.divideScalar(3);
    const list = test(center) ? yes : no;
    for (let k = 0; k < 3; k++) list.push(vertex(t + k));
  }
  const half = (indices: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geo.attributes)) g.setAttribute(name, attribute);
    g.setIndex(indices);
    return g;
  };
  return [half(yes), half(no)];
}

/**
 * Bakes FIT into the vertices of every mesh of the file and sorts the pieces
 * into the two parts that move differently: the frame (everything but the
 * fore-end) and the fore-end. A mesh's own transform inside the file (the
 * node's 100× and −90°) is baked in too: model⁻¹·mesh.matrixWorld = where
 * the mesh is relative to the file's root.
 */
function fitModel(model: THREE.Object3D, frame: THREE.Group, foreEnd: THREE.Group): void {
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  for (const mesh of meshes) {
    const bake = FIT.clone().multiply(toModel).multiply(mesh.matrixWorld);
    const geo = mesh.geometry.clone().applyMatrix4(bake);
    const material = mesh.material as THREE.Material;
    if (material.name === 'Wood') {
      const [front, back] = splitTriangles(geo, (c) => c.z < FORE_END_Z);
      foreEnd.add(new THREE.Mesh(front, material));
      frame.add(new THREE.Mesh(back, material));
    } else frame.add(new THREE.Mesh(geo, material));
  }
  model.removeFromParent(); // the original, unfitted: not needed anymore
}

// --- The pump ---------------------------------------------------------------------
/** How far the fore-end slides back, meters (the gap between it and the receiver). */
const PUMP_TRAVEL = 0.065;
/**
 * How hard the hand yanks it back / shoves it forward, m/s² (a constant push:
 * it accelerates all the way). VIOLENT: it gets there in ~0.04 s and hits the
 * stop at ~3–4 m/s.
 */
const PUMP_PULL = 80;
const PUMP_SHOVE = 120;
/** Speed kept when it hits a stop; below REST it stays there, m/s. */
const PUMP_BOUNCE_BACK = 0.35;
const PUMP_BOUNCE_SHUT = 0.2;
const PUMP_REST_SPEED = 0.05;
/** How much a slam into a stop jolts the gun, per m/s of the fore-end's speed. */
const JOLT_PITCH = 0.4;
const JOLT_Y = 0.08;
const JOLT_Z = 0.1;
/**
 * The slams reach your head too: a camera punch (radians per m/s of the
 * fore-end's speed, visual only, like the kick's). Shoved home = a nod down
 * with the "CHK" (~0.024 rad); the rear stop = a smaller jerk up.
 */
const PUNCH_SHUT = 0.006;
const PUNCH_BACK = 0.003;

/** Timeline in fractions of pumpFireInterval: when the hand pulls, when it shoves. */
const PUMP_BACK_AT = 0.18;
const PUMP_FORWARD_AT = 0.45;
/** The spent shell flies out when the fore-end is this far back (fraction of the travel). */
const EJECT_AT = 0.6;

/** When the moments of the pump happen, seconds after the shot, for the sounds (audio/sfx.ts: playPumpRack). */
export function pumpTimes(interval: number): LeverTimes {
  const throwAt = PUMP_BACK_AT * interval;
  const shutStart = PUMP_FORWARD_AT * interval;
  return {
    throwAt,
    openAt: throwAt + travelTime(PUMP_TRAVEL, PUMP_PULL),
    ejectAt: throwAt + travelTime(PUMP_TRAVEL * EJECT_AT, PUMP_PULL),
    shutStart,
    shutAt: shutStart + travelTime(PUMP_TRAVEL, PUMP_SHOVE),
  };
}

/**
 * The spent shell: flung HIGH, up past your face and over your shoulder, in a
 * slow tumble (lighter gravity than real: it stays on screen longer).
 */
const SHELL_THROW: CaseThrow = { speed: { x: 0.8, y: 1.9, z: 0.55 }, scatter: 0.2, spin: 16, gravity: 5.5, life: 1.0 };

// --- The left arm on the fore-end ---------------------------------------------------
/**
 * The carbine's arms (hands.ts, rifleArms.glb) fit this gun too: both guns
 * have their origin on the right hand and almost the same size. Only the left
 * hand must move from the carbine's fore-end (its palm at z ≈ −0.30) to this
 * one (center at z ≈ −0.34, a bit lower), meters.
 */
const LEFT_HAND_OFFSET = new THREE.Vector3(0, -0.006, -0.04);

// --- The gun's pose: a damped spring chasing keyframes -------------------------------
const POSE_STIFFNESS = 900;
/** Below 0.5 the gun overshoots more: it slams past the rest pose and bounces back. */
const POSE_DAMPING_RATIO = 0.36;
const Z = ZERO_POSE;
const BACK = PUMP_BACK_AT;
const FWD = PUMP_FORWARD_AT;
/**
 * [t, pose] of the pump cycle (t = fraction of pumpFireInterval since the
 * shot). Exaggerated on purpose, built on three classic animation rules:
 *   ANTICIPATION  before the yank the gun dips and cants the other way, a
 *                 tiny wind-up that makes the big move read;
 *   EXAGGERATION  the yank throws it up, across and onto its side (port
 *                 toward you, ~37°), and it HANGS there while the shell flies;
 *   FOLLOW-THROUGH the shove slams it down and forward PAST the rest pose,
 *                 then it settles back (the spring adds its own overshoot).
 * It's back at rest well before the next shot can go (t = 1).
 */
const CYCLE_KEYS: [number, GunPose][] = [
  [0, Z],
  [BACK - 0.05, { x: 0.01, y: -0.012, z: 0, pitch: -0.08, yaw: -0.04, roll: -0.12 }], // anticipation
  [BACK + 0.06, { x: -0.035, y: 0.03, z: 0.05, pitch: 0.3, yaw: 0.18, roll: 0.6 }], // YANK: up, across, on its side
  [FWD - 0.02, { x: -0.04, y: 0.035, z: 0.055, pitch: 0.34, yaw: 0.2, roll: 0.65 }], // hang (the shell in the air)
  [FWD + 0.05, { x: 0.01, y: -0.02, z: -0.03, pitch: -0.12, yaw: -0.03, roll: -0.1 }], // SHOVE: past the rest
  [FWD + 0.16, { x: 0, y: 0.004, z: 0.004, pitch: 0.03, yaw: 0, roll: 0.02 }], // settling
  [0.85, Z],
  [1, Z],
];
/**
 * The reload pose: rolled onto its left side like the carbine, so the RIGHT
 * side (the ejection port) faces up toward you; closer, muzzle up a little.
 * (Rolled the other way, to show the belly, the left arm, which rides on the
 * fore-end, swung up across half the screen.)
 */
const RELOAD_POSE: GunPose = { x: -0.07, y: 0.02, z: 0.05, pitch: 0.25, yaw: 0.15, roll: 1.1 };
/** The dip of the gun when a shell is pushed in, as a speed kick to the spring. */
const PUSH_DIP_Y = -0.15;
const PUSH_DIP_PITCH = -0.5;
/** A shell goes in at this fraction of pumpReloadPerShell (just before the simulation counts it). */
const SHELL_IN_AT = 0.92;

// --- A shell, built in code (a red paper hull on a brass head) ------------------------
const HULL_COLOR = 0x9a1c14;
const BRASS_COLOR = 0xb08a3c;
function createShell(): THREE.Group {
  const shell = new THREE.Group();
  const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, flatShading: true });
  // CylinderGeometry stands along +Y: turned −90° around X it lies along −Z (toward the muzzle).
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.05, 8).rotateX(-Math.PI / 2), material(HULL_COLOR));
  hull.position.z = -0.012;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0102, 0.0102, 0.014, 8).rotateX(-Math.PI / 2), material(BRASS_COLOR));
  head.position.z = 0.02;
  shell.add(hull, head);
  return shell;
}

export interface PumpView {
  /** Goes inside the viewmodel holder. Its origin is the right hand on the wrist of the stock. */
  root: THREE.Group;
  /** Muzzle, in root coordinates. */
  muzzle: THREE.Vector3;
  onShot(): void;
  /** The camera punch of the pump's slams since the last call (radians, + = up), for the viewmodel. */
  takePunch(): number;
  /** Stop every animation (weapon switched away). */
  cancel(): void;
  /** Advance the animations. Returns the pose offsets of the whole gun. */
  update(dt: number, player: PlayerState): GunPose;
}

/** `flightSpace`: where the spent shells fly (the viewmodel scene: they leave the gun behind). */
export function createPumpView(flightSpace: THREE.Object3D): PumpView {
  const root = new THREE.Group();
  const frame = new THREE.Group();
  const foreEnd = new THREE.Group(); // slides back along +z (toward you) when pumped
  root.add(frame, foreEnd);
  // The model arrives asynchronously: when it does, its pieces are fitted
  // and sorted into the two groups above (which exist from the start).
  root.add(loadGunModel('pumpShotgun.glb', (model) => fitModel(model, frame, foreEnd)));

  // Hands: the carbine's (see LEFT_HAND_OFFSET). The left arm is a child of
  // the fore-end: when the fore-end slides, the arm slides with it.
  const hands = createRifleHands();
  hands.left.position.copy(LEFT_HAND_OFFSET);
  frame.add(hands.right);
  foreEnd.add(hands.left);

  // The template of the spent shell, hidden in the ejection port.
  const shellTemplate = createShell();
  shellTemplate.position.copy(fitted(PORT));
  shellTemplate.visible = false;
  frame.add(shellTemplate);

  const pump = new Stroke(PUMP_TRAVEL, PUMP_PULL, PUMP_SHOVE, PUMP_BOUNCE_BACK, PUMP_BOUNCE_SHUT, PUMP_REST_SPEED);
  const spring = new PoseSpring(POSE_STIFFNESS, POSE_DAMPING_RATIO);
  const shells = createSpentCases(flightSpace, SHELL_THROW);
  let leftover = 0;
  let sinceShot = Infinity; // seconds since the last shot
  let ejected = true; // the shell of the last shot is already out
  let lastShellK = 0; // progress of the shell being pushed in (to catch the push moment)
  let punch = 0; // camera punch collected since the viewmodel last took it

  return {
    root,
    muzzle: fitted(MUZZLE),
    takePunch() {
      const p = punch;
      punch = 0;
      return p;
    },
    onShot() {
      sinceShot = 0;
      ejected = false;
    },
    cancel() {
      sinceShot = Infinity;
      pump.reset();
      ejected = true;
      shells.clear();
    },
    update(dt, player) {
      const interval = fireInterval(player, 'shotgun'); // the pump's own interval (pumpFireInterval)
      const perShellTicks = secondsToTicks(tuning.pumpReloadPerShell);
      const reloading = player.reloadTicks > 0;
      // Progress of the shell being pushed in (0..1), -1 while the gun is
      // still turning (the first shell's start time). The same as the carbine.
      const shellK = reloading && player.reloadTicks <= perShellTicks ? 1 - player.reloadTicks / perShellTicks : -1;
      if (lastShellK < SHELL_IN_AT && shellK >= SHELL_IN_AT) {
        spring.vel.y += PUSH_DIP_Y;
        spring.vel.pitch += PUSH_DIP_PITCH;
      }
      lastShellK = shellK;

      // --- Pump and gun pose, in small fixed steps (springs need them) ---
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        sinceShot += ELASTIC_STEP;
        const t = sinceShot / interval;
        pump.step(t >= PUMP_BACK_AT && t < PUMP_FORWARD_AT, ELASTIC_STEP);
        if (pump.impact !== 0) {
          // The fore-end hit a stop: the whole gun feels it. Shoved home
          // (negative speed) jolts it more, and pushes it away from you; the
          // rear stop pulls it toward you.
          const k = Math.abs(pump.impact) * (pump.impact < 0 ? 1 : 0.6);
          spring.vel.pitch += JOLT_PITCH * k;
          spring.vel.y += JOLT_Y * k;
          spring.vel.z += JOLT_Z * k * (pump.impact < 0 ? -1 : 1);
          punch += pump.impact < 0 ? pump.impact * PUNCH_SHUT : pump.impact * PUNCH_BACK; // down / up
          pump.impact = 0;
        }
        const target = reloading ? RELOAD_POSE : t < 1 ? poseAt(CYCLE_KEYS, t) : Z;
        spring.step(target, ELASTIC_STEP);
      }
      foreEnd.position.z = pump.pos; // +z = back toward you

      // --- The spent shell: out when the fore-end is back far enough ---
      if (!ejected && pump.pos >= PUMP_TRAVEL * EJECT_AT) {
        ejected = true;
        shells.eject(shellTemplate);
      }
      shells.update(dt);

      return { ...spring.pose };
    },
  };
}
