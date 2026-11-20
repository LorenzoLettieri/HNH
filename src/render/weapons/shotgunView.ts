// The double-barrel shotgun in your hands: public/models/doubleBarrel.glb,
// our own model, started from "Shotgun Double Barrel" by CreativeTrio (the
// original is in assets-src/double-barrel/). Already in the viewmodel's
// conventions (barrel along -Z, meters, origin = the right hand on the grip)
// and split into moving parts, each with its ORIGIN on its pivot:
//
//   stock         doesn't move
//   ├── barrels   barrels + fore-end, origin on the HINGE: rotate to break it open
//   │   ├── shell_R   the two cartridges (added by us), origin at the rim:
//   │   └── shell_L   slide them back to eject, forward to load
//   └── lever     the top lever, origin at its front end: swings aside to open
//
// The reload, one-handed and ELASTIC (like the revolver's, see elastic.ts):
//   1. thumb on the top lever, a small wind-up, then a hard JERK DOWN: when
//      the gun stops, the barrels keep going by inertia and swing open on
//      the hinge; the ejectors kick the spent shells out;
//   2. the gun swings across so you see the open breech: new shells slide in;
//   3. a dip, then a wrist FLICK UP: when the gun stops, the barrels keep
//      going up and snap shut; the lever springs back.
// The gun pose follows keyframes through a damped spring (it overshoots);
// the barrels are a physics hinge pushed by the gun's accelerations. The
// timeline is in fractions of tuning.shotgunReloadTime (debug panel), and
// the sounds in audio/sfx.ts (playShotgunReload) use the same numbers.
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { ELASTIC_STEP, Hinge, PoseSpring, ZERO_POSE, phase, poseAt, smoothstep, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';
import { createHands } from './hands';

/** The barrels' stop: how far they drop when the gun is broken open, radians. */
const OPEN_ANGLE = 0.75;
/** How much the gun's motion throws the barrels: per rad/s² of pitch, per m/s² of vertical acceleration. */
const BARREL_INERTIA_PITCH = 0.8;
const BARREL_INERTIA_LIFT = 5;
/** The weak spring that makes sure the barrels end up open/shut, damping, bounce on the stop. */
const BARREL_ASSIST = 500;
const BARREL_DAMPING = 14;
const BARREL_BOUNCE = 0.3;
/** How far the top lever swings aside, radians. */
const LEVER_ANGLE = 0.45;
/** The spring of the gun pose: stiffness (ω², 1/s²) and damping ratio (< 1 = overshoots). */
const POSE_STIFFNESS = 1100;
const POSE_DAMPING_RATIO = 0.42;

// Reload timeline, as fractions of the reload time (0 = start, 1 = done).
const UNLATCH = 0.055; // the lever has opened the lock: from now on the barrels may swing
const EJECT_ANGLE = 0.6; // the ejectors kick when the barrels are this open
const EJECT_TIME = 0.28; // ...and the shells fly for this long
const INSERT = [
  [0.44, 0.58], // right shell slides in
  [0.58, 0.72], // left shell
] as const;
const CLOSE_START = 0.79; // from here the barrels want to be shut (the flick does it)

const Z = ZERO_POSE;
// [t, pose]: where the gun wants to be (offsets from its rest pose).
const KEYS: [number, GunPose][] = [
  [0, Z],
  [0.03, { x: 0, y: 0.025, z: 0, pitch: 0.18, yaw: 0, roll: 0 }], // wind-up...
  [0.08, { x: 0, y: -0.04, z: 0, pitch: -0.3, yaw: 0, roll: 0 }], // ...JERK DOWN
  [0.26, { x: -0.04, y: 0.02, z: -0.03, pitch: 0.15, yaw: 0.6, roll: 0.2 }], // across, slowly: breech in view
  [0.72, { x: -0.04, y: 0.02, z: -0.03, pitch: 0.15, yaw: 0.6, roll: 0.2 }],
  [0.76, { x: -0.04, y: -0.005, z: -0.03, pitch: -0.12, yaw: 0.5, roll: 0.15 }], // dip...
  [0.81, { x: -0.02, y: 0.05, z: -0.01, pitch: 0.5, yaw: 0.25, roll: 0.05 }], // ...FLICK UP
  [0.9, Z],
  [1, Z],
];

export interface ShotgunView {
  /** Goes inside the viewmodel holder. Its origin is the right hand on the grip. */
  root: THREE.Group;
  /** Muzzle of each barrel (0 = right, 1 = left), in root coordinates. */
  muzzles: [THREE.Vector3, THREE.Vector3];
  onReload(): void;
  /** Stop any reload animation (weapon switched away). */
  cancel(): void;
  /** Advance the animations. Returns the pose offsets of the whole gun (elastic reload). */
  update(dt: number, player: PlayerState): GunPose;
}

export function createShotgunView(): ShotgunView {
  const root = new THREE.Group();

  // Parts of the model, filled in when the file has loaded.
  let barrels: THREE.Object3D | null = null;
  let lever: THREE.Object3D | null = null;
  const shells: THREE.Object3D[] = []; // index 0 = right barrel (fired first)
  const shellRest: THREE.Vector3[] = [];
  root.add(
    loadGunModel('doubleBarrel.glb', (model) => {
      barrels = model.getObjectByName('barrels') ?? null;
      lever = model.getObjectByName('lever') ?? null;
      for (const name of ['shell_R', 'shell_L']) {
        const shell = model.getObjectByName(name);
        if (shell) {
          shells.push(shell);
          shellRest.push(shell.position.clone());
        }
      }
    }),
  );

  // One hand only: the right arm posed on this gun's grip (see hands.ts).
  // The left hand stays out of view.
  root.add(createHands().rightShotgun);

  let time = -1; // seconds since the reload started (-1 = not reloading)
  const spring = new PoseSpring(POSE_STIFFNESS, POSE_DAMPING_RATIO);
  const hinge = new Hinge(OPEN_ANGLE, BARREL_ASSIST, BARREL_DAMPING, BARREL_BOUNCE);
  let ejectAt = -1; // seconds into the reload when the ejectors kicked (-1 = not yet)
  let leverOpen = 0;
  let leftover = 0;

  return {
    root,
    muzzles: [new THREE.Vector3(0.011, 0.077, -0.77), new THREE.Vector3(-0.003, 0.077, -0.77)],
    onReload() {
      time = 0;
      ejectAt = -1;
      hinge.reset();
    },
    cancel() {
      time = -1;
      hinge.reset();
    },
    update(dt, player) {
      const duration = tuning.shotgunReloadTime;
      // Interrupted (e.g. you died): back to normal.
      if (time >= 0 && player.reloadTicks === 0 && time < 0.9 * duration) {
        time = -1;
        hinge.reset();
      }
      // --- Gun pose spring and barrels hinge, in small fixed steps ---
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        if (time >= 0) {
          time += ELASTIC_STEP;
          if (time >= duration) time = -1;
        }
        const t = time >= 0 ? time / duration : -1;
        spring.step(t < 0 ? Z : poseAt(KEYS, t), ELASTIC_STEP);
        // Inertia: when the gun's muzzle ACCELERATES UPWARD (the jerk down
        // stopping, or the hinge pushed up), the barrels lag behind = they
        // drop open; when it decelerates going up (the flick stopping), they
        // keep going up = they close.
        const drive = BARREL_INERTIA_PITCH * spring.acc.pitch + BARREL_INERTIA_LIFT * spring.acc.y;
        hinge.step(drive, t >= UNLATCH && t < CLOSE_START, ELASTIC_STEP);
        if (ejectAt < 0 && hinge.angle > EJECT_ANGLE) ejectAt = time;
      }
      const t = time >= 0 ? time / duration : -1;
      if (barrels) barrels.rotation.x = -hinge.angle;

      // --- Top lever: pushed aside by the thumb, springs back when the barrels latch ---
      const leverWanted = t >= 0 && !(t >= CLOSE_START && hinge.latched) ? 1 : 0;
      leverOpen = leverWanted + (leverOpen - leverWanted) * Math.exp(-(leverWanted ? 25 : 60) * dt);
      if (lever) lever.rotation.y = -LEVER_ANGLE * leverOpen;

      // --- Shells: kicked out by the ejectors, the new ones slide in ---
      // (They are children of the barrels: their positions are in the
      // barrels' space, so "backward" is along the chambers even when open.)
      shells.forEach((shell, i) => {
        const rest = shellRest[i];
        shell.visible = true;
        shell.position.copy(rest);
        shell.rotation.set(0, 0, 0);
        if (t < 0) return;
        if (t < INSERT[0][0]) {
          if (ejectAt < 0) return; // still in the chambers
          // Ejected: out the back (+z) and up, then gravity pulls it down:
          // a parabola, y = up·k − fall·k². Tumbling as it goes.
          const k = (time - ejectAt) / (EJECT_TIME * duration) * (1 + i * 0.15);
          shell.position.z += 0.14 * k;
          shell.position.y += 0.2 * k - 0.5 * k * k;
          shell.position.x += (i === 0 ? 0.1 : 0.06) * k;
          shell.rotation.x = 7 * k;
          shell.visible = k < 1;
        } else {
          // Hidden until "picked up", then pushed into the chamber.
          const [a0, b0] = INSERT[i];
          const k = phase(t, a0, b0);
          shell.visible = t >= a0;
          shell.position.z += 0.07 * (1 - smoothstep(k));
          shell.position.y -= 0.025 * (1 - smoothstep(k * 1.6));
        }
      });

      return { ...spring.pose };
    },
  };
}
