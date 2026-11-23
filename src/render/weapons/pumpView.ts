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
// THE RELOAD (one shell at a time, like the simulation): the gun flung up,
// every shell SLAPPED into the tube from below by the left hand, then a full
// rack, "ch-CHK". See "The reload" below.
// Everything here is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { secondsToTicks, tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { fireInterval, magazineSize } from '../../sim/weapon';
import type { LeverTimes } from '../../audio/sfx';
import { ELASTIC_STEP, PoseSpring, Stroke, ZERO_POSE, phase, poseAt, smoothstep, travelTime, type GunPose } from './elastic';
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
// --- The reload: one shell at a time into the tube, from below ------------------------
// Badass before realistic (docs/DESIGN.md, pillar 5), but the hand must never
// go THROUGH the gun. The left hand is posed cupped UNDER the fore-end, its
// fingers wrapped round it: the one place it fits without sinking into the
// gun is UNDER the gun. So the shells go in where they really do, the loading
// port under the receiver: the gun is flung up and canted (its belly turns
// toward you), the hand drops to the belt, comes back up under the gun with a
// shell and SLAPS it in with the thumb, the gun jumping up at each one. At
// the end the hand grabs the fore-end and racks it, "ch-CHK".
// (First version: through the ejection port on the gun's side. Rejected: the
// cupped hand either sank its fingers into the gun, or, kept clear of it,
// hung huge in the middle of the screen: that side faces the camera.)
// The timeline follows the simulation's timer (player.reloadTicks): the start
// (pumpReloadStart), one stretch per shell (pumpReloadPerShell), then the
// close (pumpReloadClose, after the 'reloadEnd' event).
//
// The hand is placed by its PALM (the point that holds the fore-end): the
// positions below are where the palm goes, in the gun's coordinates
// (x = its right side, y = its top, z = back toward you). They were checked
// with a script that counts the hand's vertices inside the gun's parts:
// under the receiver they sink in less than in the normal grip on the
// fore-end (where the fingers wrap the wood on purpose).
/** Center of the fore-end (file coordinates → meters): where the palm holds it, pump shut. */
const FORE_END_CENTER = fitted(new THREE.Vector3(2.107, -0.005, 0));
/** The loading port under the receiver, between the trigger guard and the tube (file x 0.85…1.2). */
const LOADING_PORT = fitted(new THREE.Vector3(1.0, -0.13, 0));
/** At the belt, grabbing a shell: straight down from the gun, off the screen, a bit toward you. */
const HAND_AWAY = LOADING_PORT.clone().add(new THREE.Vector3(-0.04, -0.2, 0.08));
/** Under the port, shell in the palm, ready. */
const HAND_READY = LOADING_PORT.clone().add(new THREE.Vector3(0, -0.05, 0));
/** The wind-up of the slap: a bit lower (anticipation). */
const HAND_WINDUP = HAND_READY.clone().add(new THREE.Vector3(0, -0.025, 0.005));
/** SLAPPED: the palm against the gun's belly (fingers round the receiver, like a grip)... */
const HAND_IN = LOADING_PORT.clone().add(new THREE.Vector3(0, -0.03, 0));
/** ...and the shell, thumbed out of the palm, up into the port. */
const SHELL_IN = LOADING_PORT.clone().add(new THREE.Vector3(0, 0.012, 0));
/** The shell leaves the palm at this fraction of the slap (it goes in faster than the hand). */
const SHELL_LEAVES_AT = 0.6;
/** How fast the hand chases its target (1/s): fast, only to smooth the jumps (a reload stopped by a click). */
const HAND_RATE = 40;

/**
 * The reload pose: lifted, muzzle up, turned toward the middle of the screen
 * and canted a little to the right, so the belly shows. (Not more: the left
 * arm is rigid, and rolled further right it swings up across the screen.)
 */
const RELOAD_POSE: GunPose = { x: -0.05, y: 0.04, z: 0.05, pitch: 0.3, yaw: 0.2, roll: -0.3 };
const pose = (p: Partial<GunPose>): GunPose => ({ ...RELOAD_POSE, ...p });

/** The start, in fractions of pumpReloadStart: a wind-up the other way, then FLUNG up past the reload pose. */
const FLIP_KEYS: [number, GunPose][] = [
  [0, Z],
  [0.2, { x: 0.01, y: -0.02, z: 0, pitch: -0.12, yaw: -0.05, roll: 0.2 }], // anticipation
  [0.6, pose({ y: 0.06, pitch: 0.48, yaw: 0.28, roll: -0.5 })], // flung: past the reload pose...
  [1, RELOAD_POSE], // ...and back
];
/** ...and when the hand lets go of the fore-end (it drops to the belt). */
const LET_GO_AT = 0.3;

/** Each shell, in fractions of pumpReloadPerShell (the simulation counts it in at 1). */
const FETCH_UNTIL = 0.3; // the hand is at the belt, grabbing it
const READY_AT = 0.66; // under the port
const SLAP_AT = 0.84; // the wind-up is over: the slap starts...
const SLAP_IN = 0.96; // ...and the shell is in
/** The gun dips toward the hand as it comes (it "meets" the slap). */
const SHELL_KEYS: [number, GunPose][] = [
  [0, RELOAD_POSE],
  [READY_AT, pose({ y: 0.03, pitch: 0.26 })],
  [SLAP_AT, pose({ y: 0.028, pitch: 0.25 })],
  [SLAP_IN, RELOAD_POSE],
  [1, RELOAD_POSE],
];
/** The slap hits the gun's belly: it JUMPS up (a kick to the spring's speed), and your view with it. */
const SLAP_KICK_Y = 0.35;
const SLAP_KICK_PITCH = 0.9;
const SLAP_KICK_ROLL = -0.8;
const SLAP_PUNCH = 0.01;

/**
 * The close, in seconds after 'reloadEnd' (it fits in pumpReloadClose, when
 * the gun can fire again): the hand on the fore-end, then a full RACK, back
 * and home: "ch-CHK" (it chambers the first shell).
 */
const CLOSE_HAND_TIME = 0.02;
const CLOSE_RACK_BACK_UNTIL = CLOSE_HAND_TIME + travelTime(PUMP_TRAVEL, PUMP_PULL) + 0.012;
/** The gun comes back from the reload pose, jerked by the rack, slammed down past the rest and settling (seconds). */
const CLOSE_TIME = 0.4;
const CLOSE_KEYS: [number, GunPose][] = [
  [0, RELOAD_POSE],
  [CLOSE_RACK_BACK_UNTIL / CLOSE_TIME, { x: -0.03, y: 0.03, z: 0.05, pitch: 0.2, yaw: 0.15, roll: 0.25 }], // racked: thrown the other way
  [0.45, { x: 0.01, y: -0.025, z: -0.03, pitch: -0.15, yaw: -0.03, roll: -0.05 }], // shoved home: slammed down past the rest
  [0.75, { x: 0, y: 0.004, z: 0.004, pitch: 0.03, yaw: 0, roll: 0.02 }],
  [1, Z],
];

/** When the moment of the reload's start happens (the gun flung up), seconds after 'reloadStart', for the sounds. */
export function pumpReloadTimes(): { flipAt: number } {
  return { flipAt: 0.2 * tuning.pumpReloadStart };
}
/** ...and the moments of the closing rack, seconds after 'reloadEnd'. */
export function pumpCloseTimes(): { yankAt: number; openAt: number; shutStart: number; shutAt: number } {
  return {
    yankAt: CLOSE_HAND_TIME,
    openAt: CLOSE_HAND_TIME + travelTime(PUMP_TRAVEL, PUMP_PULL),
    shutStart: CLOSE_RACK_BACK_UNTIL,
    shutAt: CLOSE_RACK_BACK_UNTIL + travelTime(PUMP_TRAVEL, PUMP_SHOVE),
  };
}

// --- The draw (weapon switch, viewmodel.ts DRAW_KEYS) ---------------------------------
/**
 * The pump's signature: it swings in with the fore-end pulled back, and the
 * hand SHOVES it home at this fraction of weaponSwitchTime: the "-CHK" lands
 * just before the gun is ready to fire.
 */
const DRAW_SHOVE_AT = 0.62;
/** When the draw's shove happens, seconds after 'weaponSwitch', for the sound. */
export function pumpDrawTimes(): { shutStart: number; shutAt: number } {
  const shutStart = DRAW_SHOVE_AT * tuning.weaponSwitchTime;
  return { shutStart, shutAt: shutStart + travelTime(PUMP_TRAVEL, PUMP_SHOVE) };
}

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
  /** The gun is drawn (weapon switch): it comes in with the fore-end back, and racks it home. */
  draw(): void;
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

  // Hands: the carbine's (see LEFT_HAND_OFFSET). The left arm hangs from a
  // group placed on its PALM: put the group on the fore-end and the hand
  // holds it; move it and the whole arm follows; turn it and the arm turns
  // around the hand, not around the shoulder. (A pivot, like the akimbo
  // spin's: a group at the point you want to rotate around.)
  const hands = createRifleHands();
  const palm = new THREE.Group();
  const cup = FORE_END_CENTER.clone().sub(LEFT_HAND_OFFSET); // where the palm is, in the arm model
  hands.left.position.copy(cup).negate();
  palm.add(hands.left);
  palm.position.copy(FORE_END_CENTER);
  frame.add(hands.right, palm);
  // The shell in the hand (reload): lies in the cupped palm, along the gun.
  const handShell = createShell();
  handShell.visible = false;
  palm.add(handShell);

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
  let punch = 0; // camera punch collected since the viewmodel last took it
  let wasReloading = false;
  let closeTime = Infinity; // seconds since the reload ended (the close plays while < CLOSE_TIME)
  let lastShellK = -1; // the shell's progress last frame (to catch the moment of the slap)
  const hand = new THREE.Vector3().copy(FORE_END_CENTER); // the palm's smoothed position
  const target = new THREE.Vector3();
  const onForeEnd = new THREE.Vector3();
  const shellAt = new THREE.Vector3();
  let drawTime = Infinity; // seconds since the gun was drawn

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
      closeTime = Infinity; // a shot cuts the close short: the pump cycle takes over
    },
    draw() {
      drawTime = 0;
      pump.reset();
      pump.pos = PUMP_TRAVEL; // pulled back: the hand shoves it home during the draw
      hand.copy(FORE_END_CENTER).setZ(FORE_END_CENTER.z + PUMP_TRAVEL);
    },
    cancel() {
      sinceShot = Infinity;
      drawTime = Infinity;
      closeTime = Infinity;
      wasReloading = false;
      pump.reset();
      ejected = true;
      shells.clear();
      handShell.visible = false;
    },
    update(dt, player) {
      const interval = fireInterval(player, 'shotgun'); // the pump's own interval (pumpFireInterval)
      // --- Where the reload is, from the simulation's timer ---
      // reloadTicks counts down: first the start (pumpReloadStart), then one
      // stretch per shell. openK = progress of the start (0..1), shellK = of
      // the shell being loaded; -1 = not in that part.
      const startTicks = Math.max(1, secondsToTicks(tuning.pumpReloadStart));
      const perShellTicks = secondsToTicks(tuning.pumpReloadPerShell);
      const r = player.reloadTicks;
      const reloading = r > 0;
      const openK = reloading && r > perShellTicks ? Math.max(0, 1 - (r - perShellTicks) / startTicks) : -1;
      const shellK = reloading && r <= perShellTicks ? 1 - r / perShellTicks : -1;
      // Is this the last shell? (Tube full or pocket empty after it.) Then the
      // hand goes straight back to the fore-end after the slap.
      const lastShell =
        player.loaded.shotgun + 1 >= magazineSize(player, 'shotgun') || (!tuning.infiniteAmmo && player.reserve.shells <= 1);
      // The reload just ended (done, or a click stopped it): the close.
      if (wasReloading && !reloading) closeTime = 0;
      wasReloading = reloading;
      // The slap: the moment the shell goes in.
      if (shellK >= SLAP_IN && lastShellK < SLAP_IN) {
        spring.vel.y += SLAP_KICK_Y;
        spring.vel.pitch += SLAP_KICK_PITCH;
        spring.vel.roll += SLAP_KICK_ROLL;
        punch += SLAP_PUNCH;
      }
      lastShellK = shellK;

      // --- Pump and gun pose, in small fixed steps (springs need them) ---
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        sinceShot += ELASTIC_STEP;
        closeTime += ELASTIC_STEP;
        drawTime += ELASTIC_STEP;
        const t = sinceShot / interval;
        const closing = closeTime < CLOSE_TIME;
        // Open (pulled back): during the pump cycle after a shot, and in the
        // rack that closes a reload. (Shut while reloading: the shells go into the tube.)
        const open = reloading
          ? false
          : drawTime < tuning.weaponSwitchTime
            ? drawTime < DRAW_SHOVE_AT * tuning.weaponSwitchTime // the draw: back, then shoved home
          : closing
            ? closeTime >= CLOSE_HAND_TIME && closeTime < CLOSE_RACK_BACK_UNTIL
            : t >= PUMP_BACK_AT && t < PUMP_FORWARD_AT;
        pump.step(open, ELASTIC_STEP);
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
        const goal = reloading
          ? openK >= 0
            ? poseAt(FLIP_KEYS, openK)
            : poseAt(SHELL_KEYS, shellK)
          : closing
            ? poseAt(CLOSE_KEYS, closeTime / CLOSE_TIME)
            : t < 1
              ? poseAt(CYCLE_KEYS, t)
              : Z;
        spring.step(goal, ELASTIC_STEP);
      }
      foreEnd.position.z = pump.pos; // +z = back toward you

      // --- The left hand: on the fore-end, or fetching and slapping in shells ---
      // Every move is up and down UNDER the gun: belt, under the port, the
      // port, and forward to the fore-end; none crosses the gun.
      onForeEnd.copy(FORE_END_CENTER).setZ(FORE_END_CENTER.z + pump.pos);
      if (openK >= 0) {
        // The start: lets go of the fore-end and drops to the belt.
        target.copy(onForeEnd).lerp(HAND_AWAY, smoothstep(phase(openK, LET_GO_AT, 1)));
      } else if (shellK >= 0) {
        if (shellK < FETCH_UNTIL) target.copy(HAND_AWAY); // down to the belt (from the last slap, or already there)
        else if (shellK < READY_AT) target.copy(HAND_AWAY).lerp(HAND_READY, smoothstep(phase(shellK, FETCH_UNTIL, READY_AT)));
        else if (shellK < SLAP_AT) target.copy(HAND_READY).lerp(HAND_WINDUP, smoothstep(phase(shellK, READY_AT, SLAP_AT)));
        else if (shellK < SLAP_IN) {
          // The slap: k² = it ACCELERATES into the gun (ease-in), fastest at the impact.
          const k = phase(shellK, SLAP_AT, SLAP_IN);
          target.copy(HAND_WINDUP).lerp(HAND_IN, k * k);
        } else target.copy(lastShell ? onForeEnd : HAND_IN); // the last one: forward, under the gun, to the fore-end
      } else target.copy(onForeEnd);
      // Smoothed only to hide the jumps between parts (or a reload cut short).
      // Once it has hold of the fore-end it rides it exactly: no lag on the pump.
      const holding = (openK >= 0 && openK < LET_GO_AT) || (!reloading && !(closeTime < CLOSE_HAND_TIME));
      if (holding && hand.distanceTo(onForeEnd) < 0.02) hand.copy(onForeEnd);
      else hand.lerp(target, 1 - Math.exp(-HAND_RATE * dt));
      palm.position.copy(hand);
      // The shell in the palm: from the moment it's grabbed until it's in.
      // In the last part of the slap the thumb pushes it out of the palm, up
      // into the port: its place in the GUN's coordinates (from the palm to
      // SHELL_IN), minus the palm's position, since it's a child of the palm.
      handShell.visible = shellK >= FETCH_UNTIL && shellK < SLAP_IN;
      const thumbed = phase(phase(shellK, SLAP_AT, SLAP_IN), SHELL_LEAVES_AT, 1);
      if (handShell.visible && thumbed > 0) handShell.position.copy(shellAt.copy(hand).lerp(SHELL_IN, thumbed * thumbed).sub(hand));
      else handShell.position.set(0, 0, 0);

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
