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
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import type { RevolverModel } from './revolverModel';

/** How far the crane swings the cylinder out, radians. */
const CRANE_OPEN = 1.45;
/** How far back the ejector pushes the cases, meters. */
const EJECT_STROKE = 0.035;
/** Gravity for the falling cases, m/s² (a bit less than real: we want to see them go). */
const FALL_GRAVITY = 6;
/** How long a new round takes to slide in, as a fraction of the reload. */
const INSERT_TIME = 0.055;

// Timeline (fractions of the reload time).
const OPEN_START = 0.03; // the flick throws the cylinder out...
const OPEN_END = 0.1; // ...and it bounces against its stop
const EJECT_START = 0.14; // muzzle up: the ejector pushes the cases back
const FALL_START = 0.2; // then they fall
const FALL_END = 0.33; // gone
const INSERT_START = 0.38; // round i slides in from INSERT_START + i·INSERT_TIME
const CLOSE_START = 0.8; // the flick the other way snaps it shut
const CLOSE_END = 0.84;
const SPIN_END = 1; // the cylinder spins down until the end

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

// [t, pose]. Between two keys the pose is blended with smoothstep.
const KEYS: [number, GunPose][] = [
  [0, ZERO],
  [0.05, { x: 0.01, y: 0.005, z: 0, pitch: 0.05, yaw: 0, roll: -0.35 }], // FLICK clockwise
  [0.12, { x: -0.02, y: 0.01, z: 0, pitch: 0.15, yaw: 0.1, roll: 0.45 }], // swing back: cylinder out
  [0.2, { x: -0.04, y: 0.03, z: 0.02, pitch: 0.95, yaw: 0.15, roll: 0.35 }], // muzzle up: cases out
  [0.3, { x: -0.04, y: 0.03, z: 0.02, pitch: 0.95, yaw: 0.15, roll: 0.35 }],
  [0.38, { x: -0.03, y: 0.05, z: 0.07, pitch: 0.1, yaw: 0.45, roll: 0.5 }], // loading: closer, cylinder toward you
  [0.76, { x: -0.03, y: 0.05, z: 0.07, pitch: 0.1, yaw: 0.45, roll: 0.5 }],
  [0.8, { x: -0.03, y: 0.03, z: 0.04, pitch: 0.05, yaw: 0.25, roll: 0.95 }], // FLICK the other way
  [0.87, { x: -0.01, y: 0, z: 0, pitch: 0, yaw: 0, roll: -0.08 }], // small overshoot
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
/** Overshoots a little past 1 and settles back ("ease out back"): something hitting a stop. */
function easeOutBack(t: number): number {
  const c = 1.7;
  const k = t - 1;
  return 1 + (c + 1) * k * k * k + c * k * k;
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

export function createRevolverReload(): RevolverReload {
  let time = -1; // seconds since the reload started (-1 = not reloading)
  const down = new THREE.Vector3();
  const q = new THREE.Quaternion();
  return {
    get active() {
      return time >= 0;
    },
    start() {
      time = 0;
    },
    cancel() {
      time = -1;
    },
    update(dt, duration, gun) {
      let t = -1;
      if (time >= 0) {
        time += dt;
        t = time / duration;
        if (t >= 1) {
          time = -1;
          t = -1;
        }
      }

      // --- Crane: thrown open by the first flick, snapped shut by the second ---
      let crane = 0;
      if (t >= 0) {
        // Opening hits its stop and bounces (ease out back); closing accelerates
        // into the frame (squared: slow start, fast end) and stops dead.
        crane = CRANE_OPEN * easeOutBack(phase(t, OPEN_START, OPEN_END)) * (1 - phase(t, CLOSE_START, CLOSE_END) ** 2);
      }
      gun.crane.rotation.z = crane;

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
      const spin = t >= CLOSE_END ? 40 * (1 - phase(t, CLOSE_END, SPIN_END)) : 0;
      return { pose: t < 0 ? ZERO : poseAt(t), spin };
    },
  };
}
