// The gunslinger's reload of the revolver, all in one hand:
//
//   1. a flick of the wrist (the gun snaps clockwise and back): by inertia
//      the cylinder swings out to the left on its crane;
//   2. muzzle up: the six spent cases slide back and fall out;
//   3. the gun comes closer, cylinder toward you: six new rounds slide in, one by one;
//   4. a flick the other way: the cylinder snaps shut, then a spin for show.
//
// Like the shotgun, it's a TIMELINE written in code with phases as fractions
// of the reload time (tuning.revolverReloadTime, changeable from the debug
// panel: the timeline stretches with it). The sounds in audio/sfx.ts
// (playReload) use the same fractions.
//
// Two kinds of motion:
//   - the POSE of the whole gun (flicks, muzzle up/down): keyframes of
//     offsets that viewmodel.ts adds to the gun's rest pose;
//   - the PARTS: crane angle, rounds sliding out/in (they are children of
//     the cylinder, which is a child of the crane: moving the crane carries
//     them along, like nested elements in the DOM).
// ELASTIC: the keyframes are only where the gun WANTS to be. The real pose
// follows them through a damped spring (like cameraFeel's hurt kick): it
// lags a little, overshoots and settles, so every move has momentum. Before
// each flick there's a small wind-up the other way (anticipation, the oldest
// trick of animation). And the cylinder is not animated at all: it's a
// little PHYSICS simulation, pushed by the gun's angular acceleration
// (inertia: whip the gun clockwise and the cylinder stays behind, i.e. it
// swings out), with hard stops it bounces against and a weak spring that
// makes sure it ends up open/shut.
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import type { RevolverModel } from './revolverModel';

/** How far the crane swings the cylinder out, radians (the stop it bounces against). */
const CRANE_OPEN = 1.45;
/** How much the gun's angular acceleration throws the cylinder (inertia). */
const CRANE_INERTIA = 1.5;
/** The weak spring that makes sure the cylinder ends up open/shut, and its damping. */
const CRANE_ASSIST = 300;
const CRANE_DAMPING = 9;
/** How much speed the cylinder keeps when it hits the open stop (0 = dead stop, 1 = full bounce). */
const CRANE_BOUNCE = 0.35;
/** The spring the gun pose follows the keyframes with: stiffness (ω², 1/s²) and damping ratio (< 1 = overshoots). */
const POSE_STIFFNESS = 1400;
const POSE_DAMPING_RATIO = 0.42;
/** How far back the ejector pushes the cases, meters. */
const EJECT_STROKE = 0.035;
/** Gravity for the falling cases, m/s² (a bit less than real: we want to see them go). */
const FALL_GRAVITY = 6;
/** How long a new round takes to slide in, as a fraction of the reload. */
const INSERT_TIME = 0.055;

// Timeline (fractions of the reload time).
const OPEN_START = 0.04; // the cylinder is unlatched: the flick throws it out
const EJECT_START = 0.14; // muzzle up: the ejector pushes the cases back
const FALL_START = 0.2; // then they fall
const FALL_END = 0.33; // gone
const INSERT_START = 0.38; // round i slides in from INSERT_START + i·INSERT_TIME
const CLOSE_START = 0.78; // the flick the other way throws it shut (and it latches)
const SPIN_START = 0.85; // a spin for show...
const SPIN_END = 1; // ...that slows down until the end

/** Pose of the whole gun: offsets from its rest pose (meters and radians). */
export interface GunPose {
  x: number;
  y: number;
  z: number;
  pitch: number; // + = muzzle up
  yaw: number; // + = muzzle to the left
  roll: number; // + = tilted left (counterclockwise as you see it)
}
const ZERO: GunPose = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };

// [t, pose]: where the gun wants to be (the spring adds the elasticity).
const KEYS: [number, GunPose][] = [
  [0, ZERO],
  [0.025, { x: -0.005, y: 0, z: 0, pitch: -0.03, yaw: 0, roll: 0.18 }], // wind-up...
  [0.06, { x: 0.012, y: 0.005, z: 0, pitch: 0.05, yaw: 0, roll: -0.45 }], // ...FLICK clockwise
  [0.13, { x: -0.02, y: 0.01, z: 0, pitch: 0.15, yaw: 0.1, roll: 0.45 }], // swing back: cylinder out
  [0.2, { x: -0.04, y: 0.03, z: 0.02, pitch: 0.95, yaw: 0.15, roll: 0.35 }], // muzzle up: cases out
  [0.3, { x: -0.04, y: 0.03, z: 0.02, pitch: 0.95, yaw: 0.15, roll: 0.35 }],
  [0.38, { x: -0.03, y: 0.05, z: 0.07, pitch: 0.1, yaw: 0.45, roll: 0.5 }], // loading: closer, cylinder toward you
  [0.74, { x: -0.03, y: 0.05, z: 0.07, pitch: 0.1, yaw: 0.45, roll: 0.5 }],
  [0.77, { x: -0.03, y: 0.045, z: 0.06, pitch: 0.12, yaw: 0.4, roll: 0.25 }], // wind-up...
  [0.8, { x: -0.03, y: 0.03, z: 0.04, pitch: 0.05, yaw: 0.25, roll: 1.05 }], // ...FLICK the other way
  [0.88, ZERO],
  [1, ZERO],
];

function smoothstep(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}
/** Progress 0..1 of `t` between `a` and `b` (clamped). */
function phase(t: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}
function poseAt(t: number): GunPose {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [ta, a] = KEYS[i];
    const [tb, b] = KEYS[i + 1];
    if (t <= tb) {
      const k = smoothstep((t - ta) / (tb - ta));
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        pitch: a.pitch + (b.pitch - a.pitch) * k,
        yaw: a.yaw + (b.yaw - a.yaw) * k,
        roll: a.roll + (b.roll - a.roll) * k,
      };
    }
  }
  return ZERO;
}

export interface RevolverReload {
  start(): void;
  cancel(): void;
  /** True while the reload is playing. */
  readonly active: boolean;
  /**
   * Advances the reload and moves the crane and the rounds. Returns the pose
   * offsets for the whole gun and how fast to spin the cylinder (rad/s).
   */
  update(dt: number, duration: number, gun: RevolverModel): { pose: GunPose; spin: number };
}

const CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll'] as const;
/** Small fixed steps for the springs: stable even when a frame is long. */
const STEP = 1 / 240;

export function createRevolverReload(): RevolverReload {
  let time = -1; // seconds since the reload started (-1 = not reloading)
  // The gun pose and its velocity (per channel): the spring's state.
  const pose: GunPose = { ...ZERO };
  const vel: GunPose = { ...ZERO };
  // The crane: angle, angular velocity, latched shut.
  let crane = 0;
  let craneVel = 0;
  let latched = true;
  let leftover = 0; // time not yet simulated (less than one STEP)
  const down = new THREE.Vector3();
  const q = new THREE.Quaternion();
  return {
    get active() {
      return time >= 0;
    },
    start() {
      time = 0;
      latched = true;
    },
    cancel() {
      time = -1;
      crane = 0;
      craneVel = 0;
      latched = true;
    },
    update(dt, duration, gun) {
      // --- Springs and the crane, in small fixed steps ---
      leftover += Math.min(dt, 0.1);
      const damping = 2 * POSE_DAMPING_RATIO * Math.sqrt(POSE_STIFFNESS);
      while (leftover >= STEP) {
        leftover -= STEP;
        if (time >= 0) {
          time += STEP;
          if (time >= duration) time = -1;
        }
        const t = time >= 0 ? time / duration : -1;
        const target = t < 0 ? ZERO : poseAt(t);
        // Gun pose: each channel is a damped spring pulled toward the keyframes
        // (semi-implicit Euler: velocity first, then position with the new velocity).
        let rollAcc = 0;
        for (const c of CHANNELS) {
          const acc = POSE_STIFFNESS * (target[c] - pose[c]) - damping * vel[c];
          vel[c] += acc * STEP;
          pose[c] += vel[c] * STEP;
          if (c === 'roll') rollAcc = acc;
        }
        // Crane: inertia (the gun turns clockwise = negative roll acceleration,
        // the cylinder lags behind = it swings OUT) + a weak spring toward
        // where it should be + damping.
        const open = t >= OPEN_START && t < CLOSE_START;
        if (open) latched = false;
        if (latched) {
          crane = 0;
          craneVel = 0;
          continue;
        }
        const goal = open ? CRANE_OPEN : 0;
        const craneAcc = -CRANE_INERTIA * rollAcc + CRANE_ASSIST * (goal - crane) - CRANE_DAMPING * craneVel;
        craneVel += craneAcc * STEP;
        crane += craneVel * STEP;
        if (crane > CRANE_OPEN) {
          crane = CRANE_OPEN; // the stop: bounce back a little
          craneVel = -craneVel * CRANE_BOUNCE;
        }
        if (crane <= 0) {
          crane = 0;
          craneVel = 0;
          if (!open) latched = true; // shut and latched: CLICK
        }
      }
      gun.crane.rotation.z = crane;

      const t = time >= 0 ? time / duration : -1;

      // --- Rounds ---
      // "Down" for the falling cases is the screen's down (the viewmodel scene
      // is in camera space), turned into the cylinder's own coordinates: the
      // INVERSE of its world rotation.
      gun.cylinder.getWorldQuaternion(q);
      down.set(0, -1, 0).applyQuaternion(q.invert());
      gun.rounds.forEach((round, i) => {
        const rest = gun.roundRest[i];
        round.position.copy(rest);
        round.rotation.set(0, 0, 0);
        round.visible = true;
        if (t < 0) return;
        if (t < INSERT_START) {
          // Spent cases: pushed back by the ejector, then they fall and tumble.
          const push = smoothstep(phase(t, EJECT_START, FALL_START));
          round.position.z += EJECT_STROKE * push;
          const fall = Math.max(0, t - FALL_START - i * 0.006) * duration; // seconds falling (a bit staggered)
          round.position.addScaledVector(down, 0.5 * FALL_GRAVITY * fall * fall);
          round.position.x += rest.x * 3 * fall; // they spread out (the cylinder's axis is its origin)
          round.position.y += rest.y * 3 * fall;
          round.rotation.x = 9 * fall * (i % 2 ? 1 : -1);
          round.visible = t < FALL_END;
        } else {
          // New rounds: each one appears behind its chamber and slides in.
          const a = INSERT_START + i * INSERT_TIME;
          const k = smoothstep(phase(t, a, a + INSERT_TIME));
          round.visible = t >= a;
          round.position.z += 0.05 * (1 - k);
        }
      });

      // --- Spin: once shut, a flourish that slows down ---
      const spin = t >= SPIN_START ? 40 * (1 - phase(t, SPIN_START, SPIN_END)) : 0;
      return { pose: { ...pose }, spin };
    },
  };
}
