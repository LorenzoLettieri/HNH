// The dynamite launcher in your hand (public/models/dynamiteLauncher.glb,
// made by tools/blender/dynamite_launcher.py), and its SHOT animation.
//
// A heavy gun held with TWO hands. The model is in the viewmodel's
// conventions (barrel along -Z, origin = the right hand on the wrist of the
// stock) and it was built around the carbine's hands (rifleArms.glb): the
// right one on the wrist, the left one under the walnut fore-end. So the
// carbine's arms hold it, children of the gun like on the carbine, and it's
// held in the carbine's hip pose (the arms are posed for it).
//
// The moving parts, found by name (see the top of the Blender script):
//   drum       origin on the drum's axis: rotation.z turns it (three.js -Z = the barrel)
//   stick_0..4 the sticks in the chambers, children of the drum, origin at
//              their back end (stick_0 is the one in front of the barrel)
//   muzzle     an empty at the mouth: where the flash goes
//
// THE SHOT (timeline in fractions of dynamiteFireInterval, like the carbine's
// lever and the pump; the badass rule of CLAUDE.md):
//   0      the stick is gone from its chamber (it's flying), the recoil
//          (recoil.ts) bucks the gun up; on top of it the gun ROCKS BACK, heavy
//   ~0.3   a flick the other way (anticipation), then the gun is CANTED onto
//          its left side: the cage full of sticks turns toward you...
//   ~0.4   ...and the DRUM is thrown round one chamber (1/5 of a turn) by the
//          ratchet: it accelerates all the way and SLAMS into the stop, CLACK,
//          bounces; the slam jolts the gun and punches your view
//   ~0.7   snapped back past its rest pose, bounces home, ready (0.88)
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { magazineSize } from '../../sim/weapon';
import { ELASTIC_STEP, PoseSpring, poseAt, Stroke, travelTime, ZERO_POSE, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';
import { createRifleHands } from './hands';
import { viewmodelSettings } from './viewmodel';

/**
 * Where the muzzle is, in the model's coordinates: the same numbers as the
 * Blender script (BARREL_END + 1 cm, BARREL_Z), converted to three.js axes
 * (Blender y → three.js −z). Used until the file has loaded; then the
 * `muzzle` empty of the file wins.
 */
const MUZZLE = new THREE.Vector3(0, 0.081, -0.65);

/**
 * The carbine's right hand grips the LOWER BAR of the carbine's lever, not
 * its wrist: the hole of the fist is 7.2 cm below the origin (measured on
 * the vertices of rifleArms.glb). The arm is lifted by that much, so the fist
 * closes around this gun's wrist (at the origin, as thick as the hole; the
 * Blender script has the same number: RIGHT_FIST).
 */
const FIST = new THREE.Vector3(0.003, 0.072, 0);

// --- The drum ------------------------------------------------------------------------
/** Chambers in the drum (the Blender script's STICKS). */
const CHAMBERS = 5;
/** One chamber, radians: what the ratchet turns at each shot. */
const STEP = (2 * Math.PI) / CHAMBERS;
/** When the ratchet throws the drum round, fraction of dynamiteFireInterval. */
const DRUM_TURN_AT = 0.38;
/** How hard it's thrown, rad/s²: a constant push, so it's fastest right at the CLACK (~0.1 s of travel). */
const DRUM_THROW = 260;
/** Speed kept when it slams into the stop: a heavy brass cage, a short bounce. */
const DRUM_BOUNCE = 0.25;
const DRUM_REST_SPEED = 0.8;
/** The slam's jolt to the gun (spring speed per rad/s of impact) and the punch to your view. */
const JOLT_ROLL = -0.04;
const JOLT_PITCH = -0.025;
const JOLT_Y = -0.006;
const PUNCH = 0.0005;

// --- The gun's pose: a damped spring chasing keyframes ---------------------------------
const POSE_STIFFNESS = 700; // a bit softer than the carbine's: it's a heavier gun
/** Below 1 it overshoots its keyframes and swings back: lower = more swagger. */
const POSE_DAMPING_RATIO = 0.34;
const Z = ZERO_POSE;
/**
 * [t, pose] of the shot (t = fraction of dynamiteFireInterval). Rolled onto
 * its LEFT side (roll +, like the carbine's lever throw): the cage turns its
 * flank toward you, and the left arm, rigid with the gun, drops out of view
 * instead of swinging over the screen.
 */
const CYCLE_KEYS: [number, GunPose][] = [
  [0, Z],
  [0.12, { x: 0.005, y: 0.012, z: 0.03, pitch: 0.1, yaw: 0.02, roll: -0.04 }], // rocked back, heavy
  [DRUM_TURN_AT - 0.06, { x: 0.006, y: 0.012, z: 0.04, pitch: 0.08, yaw: 0, roll: -0.12 }], // anticipation: canted the other way
  [DRUM_TURN_AT + 0.08, { x: -0.025, y: 0.02, z: 0.03, pitch: 0.12, yaw: 0.07, roll: 0.5 }], // CANTED: the cage in view, the drum turning
  [0.6, { x: -0.028, y: 0.022, z: 0.03, pitch: 0.12, yaw: 0.08, roll: 0.55 }], // hang
  [0.72, { x: 0.006, y: -0.004, z: -0.03, pitch: -0.02, yaw: -0.02, roll: -0.08 }], // snapped back past the rest
  [0.88, Z],
  [1, Z],
];

/** When the drum moves, seconds after the shot (the sounds follow the animation). */
export interface DrumTimes {
  turnAt: number;
  clackAt: number;
}
export function drumTimes(interval: number): DrumTimes {
  const turnAt = DRUM_TURN_AT * interval;
  return { turnAt, clackAt: turnAt + travelTime(STEP, DRUM_THROW) };
}

export interface DynamiteView {
  root: THREE.Group;
  /** Where the flash goes (model coordinates). */
  muzzle: THREE.Vector3;
  onShot(): void;
  /** Stop every animation (weapon switched away). */
  cancel(): void;
  /** The camera punch of the drum's slams since the last call (radians), for the viewmodel. */
  takePunch(): number;
  /** Advance the animations. Returns the pose offsets of the whole gun. */
  update(dt: number, player: PlayerState): GunPose;
}

export function createDynamiteView(): DynamiteView {
  const muzzle = MUZZLE.clone();
  // Parts, filled in when the file has loaded (until then empty stand-ins).
  let drum = new THREE.Object3D();
  let sticks: THREE.Object3D[] = [];
  const root = loadGunModel('dynamiteLauncher.glb', (model) => {
    const m = model.getObjectByName('muzzle');
    if (m) muzzle.copy(m.position);
    drum = model.getObjectByName('drum') ?? drum;
    sticks = [];
    for (let k = 0; k < CHAMBERS; k++) {
      const s = model.getObjectByName(`stick_${k}`);
      if (s) sticks.push(s);
    }
  });
  // The carbine's arms: the launcher was built around their hands.
  // The RIGHT arm, though, is posed to grab the carbine's lever from below:
  // lifted (FIST) so the fist wraps this wrist, then hung from a PIVOT on the
  // wrist (the origin), which can be turned (debug panel): the hand stays
  // wrapped around the wrist, only the forearm swings (the shoulder is off
  // screen anyway).
  const hands = createRifleHands();
  const fist = new THREE.Group();
  hands.right.position.copy(FIST);
  fist.add(hands.right);
  root.add(fist, hands.left);

  const spring = new PoseSpring(POSE_STIFFNESS, POSE_DAMPING_RATIO);
  // The drum's ratchet: a Stroke (elastic.ts) from 0 to one chamber. The
  // drum's angle = `turned` whole chambers + the stroke. At every shot the
  // finished stroke becomes one more whole chamber and restarts from 0 (the
  // sum doesn't jump); then, at DRUM_TURN_AT, it's thrown to its stop.
  const ratchet = new Stroke(STEP, DRUM_THROW, DRUM_THROW, DRUM_BOUNCE, DRUM_BOUNCE, DRUM_REST_SPEED);
  let turned = 0; // whole chambers already turned
  let cycling = false; // a shot's cycle is running (the ratchet has a turn to make)
  /** The chamber in front of the barrel once the drum has turned: the next stick to fire. */
  let top = 0;
  let leftover = 0;
  let sinceShot = Infinity;
  let punch = 0;

  /** The turn in progress counts as done: one more whole chamber. */
  function settle(): void {
    if (cycling) turned++;
    cycling = false;
    ratchet.reset();
  }

  return {
    root,
    muzzle,
    onShot() {
      settle();
      cycling = true;
      sinceShot = 0;
      top = (top + 1) % CHAMBERS;
    },
    cancel() {
      settle(); // put away mid-cycle: the drum finishes its turn off screen
      sinceShot = Infinity;
      punch = 0;
    },
    takePunch() {
      const p = punch;
      punch = 0;
      return p;
    },
    update(dt, player) {
      const s = viewmodelSettings;
      fist.rotation.set(s.dynamiteHandPitch, s.dynamiteHandYaw, s.dynamiteHandRoll);
      const interval = tuning.dynamiteFireInterval;

      // In small fixed steps: springs and strokes need them (elastic.ts).
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        sinceShot += ELASTIC_STEP;
        const t = sinceShot / interval;
        ratchet.step(cycling && t >= DRUM_TURN_AT, ELASTIC_STEP);
        if (ratchet.impact > 0) {
          // CLACK: the heavy cage hits the stop, the whole gun feels it.
          const k = ratchet.impact;
          spring.vel.roll += JOLT_ROLL * k;
          spring.vel.pitch += JOLT_PITCH * k;
          spring.vel.y += JOLT_Y * k;
          punch -= PUNCH * k;
        }
        ratchet.impact = 0;
        spring.step(t < 1 ? poseAt(CYCLE_KEYS, t) : Z, ELASTIC_STEP);
      }
      // +Z in three.js turns the chambers the right way: chamber k+1 comes up
      // to where chamber k was (see `chamber` in the Blender script).
      drum.rotation.z = (turned + ratchet.pos / STEP) * STEP;

      // The sticks: the chambers from `top` onward hold the rounds the gun
      // still has (the simulation counts them); the others are empty.
      const loaded = Math.min(player.loaded.dynamite, magazineSize(player, 'dynamite'));
      sticks.forEach((stick, k) => {
        stick.visible = (k - top + CHAMBERS) % CHAMBERS < loaded;
      });

      return { ...spring.pose };
    },
  };
}
