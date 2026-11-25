// The LASSO in your hands (the simulation is in src/sim/lasso.ts and kick.ts).
//
// What you see: the right fist up on the right, spinning the NOOSE above it
// in a tilted circle (the honda runs round, the wrist makes small circles in
// step with it), and the left hand low on the left holding the COIL, with the
// running line sagging between the two hands. All the rope that bends is a
// tube rebuilt every frame (ropeMesh.ts); the coil and the noose are the
// model (public/models/lasso.glb, made by tools/blender/lasso.py).
//
// When the loop LEAVES your hand it isn't here any more: the rope flying out
// into the world is drawn in the world scene (render/lassoRope.ts), starting
// from the point this view says the fist is (handPoint). Here only what the
// hands do, a small state machine driven by the simulation's events:
//
//   idle ──(throw: left button / F)──► throw ──(it catches)──► yank ──► back ──► idle
//                                          └──(nothing)───────────────► back
//   idle ──(hook: right button)──────► hook ──(let go)─────────────────► back
//
// - THROW: anticipation (the fist cocks back and up, the loop spins FASTER:
//   you hear and see it wind up), then the punch forward: the loop leaves at
//   RELEASE (a fraction of the wind-up) and flies until the catch.
// - YANK: the fist rips back toward your shoulder, a jolt to your view: the
//   enemy comes flying at you (the simulation threw it).
// - HOOK: the arm reaches toward where the hook holds (it AIMS at the
//   anchor, like a dog on a leash pulling the hand) and shakes with tension.
// - BACK: the rope comes back (RETRACT_TIME, the same in lassoRope.ts), the
//   noose reappears in the hand spinning up (REGROW_TIME).
// The poses go through a damped spring (PoseSpring of elastic.ts, below
// critical damping: it overshoots), so every jerk snaps past and settles.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { SimEvent } from '../../sim/events';
import type { PlayerState } from '../../sim/player';
import { ELASTIC_STEP, PoseSpring, poseAt, ZERO_POSE, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';
import { createHands } from './hands';
import { createRope, layRope } from './ropeMesh';
import { playLassoWhirl } from '../../audio/sfx';

/** Mutable so the debug panel can change them (cartella "Lasso"). Camera space: x right, y up, -z forward. */
export const lassoSettings = {
  /** The right fist at rest (the origin of Arm_R: the hand around a revolver grip, here around the rope). */
  fistX: 0.19,
  fistY: -0.11,
  fistZ: -0.36,
  /** Fist raised (pitch up), turned in, rolled: the forearm comes up from below the screen. */
  fistPitch: 0.75,
  fistYaw: 0.25,
  fistRoll: -0.25,
  /** The noose spinning: its center, its tilt (the plane's normal, leaning toward you and to the left). */
  nooseX: 0.27,
  nooseY: 0.1,
  nooseZ: -0.6,
  nooseTiltX: 0.55,
  nooseTiltZ: 0.25,
  /** Its size in your hand (1 = the model's 24 cm radius). */
  nooseSize: 0.72,
  /** Turns per second at rest, and while winding up to throw. */
  spin: 1.6,
  spinWindup: 3.6,
  /** The wrist's small circles in step with the loop, meters. */
  wristCircle: 0.018,
  /** The left hand with the coil. */
  palmX: -0.2,
  palmY: -0.115,
  palmZ: -0.34,
  palmPitch: 0.25,
  palmYaw: 0.45,
  palmRoll: 0.35,
  /** The pose spring: stiffness (1/s²) and damping ratio (< 1 overshoots). */
  stiffness: 520,
  damping: 0.42,
  /** The view punch at the yank, and when the hook catches, radians. */
  yankPunch: 0.05,
  hookPunch: 0.025,
};

/** When the loop leaves the hand: fraction of the wind-up (tuning.lassoWindup). The rest is its flight. */
export const RELEASE = 0.45;
/** The hook leaves almost at once (the simulation's hook starts flying on the press). */
const HOOK_RELEASE = 0.04;
/** How long the fist keeps pulling after the catch, seconds (the enemy is in the air), then the rope comes back. */
export const YANK_TIME = 0.24;
/** Seconds for the rope to come back into your hand (lassoRope.ts uses the same). */
export const RETRACT_TIME = 0.2;
/** Seconds for the noose to open again in your hand and spin up. */
const REGROW_TIME = 0.18;

/** The throw, in fractions of the wind-up: cocked back and up, then PUNCHED forward past the rest. */
const THROW_KEYS: [number, GunPose][] = [
  [0, ZERO_POSE],
  [RELEASE * 0.8, { x: 0.04, y: 0.07, z: 0.1, pitch: 0.55, yaw: -0.15, roll: -0.35 }], // wound up behind the head
  [RELEASE + 0.15, { x: -0.07, y: 0.02, z: -0.2, pitch: -0.7, yaw: 0.35, roll: 0.25 }], // the punch
  [1, { x: -0.05, y: -0.01, z: -0.15, pitch: -0.45, yaw: 0.25, roll: 0.15 }], // arm out, following the rope
];
/** The yank: ripped back toward the shoulder, hard (the spring overshoots it), then held while the enemy flies. */
const YANK_KEYS: [number, GunPose][] = [
  [0, { x: -0.05, y: -0.01, z: -0.15, pitch: -0.45, yaw: 0.25, roll: 0.15 }],
  [0.2, { x: 0.05, y: -0.04, z: 0.12, pitch: 0.95, yaw: -0.25, roll: 0.5 }],
  [1, { x: 0.04, y: -0.03, z: 0.08, pitch: 0.7, yaw: -0.15, roll: 0.35 }],
];
/** The hook: arm out toward the anchor (the aim is added on top, see update). */
const HOOK_POSE: GunPose = { x: -0.06, y: 0.03, z: -0.13, pitch: -0.25, yaw: 0.2, roll: 0.1 };
/** Coming back: from wherever the arm is to rest, catching the loop with a little bump. */
const BACK_POSE: GunPose = { x: 0.02, y: -0.03, z: 0.04, pitch: 0.25, yaw: 0, roll: 0.1 };

/** Where the rope comes out of the fist, in the fist's coordinates (where a revolver's hammer would be). */
const FIST_EXIT = new THREE.Vector3(-0.015, 0.012, -0.005);
/** Where the running line goes into the bottom of the fist. */
const FIST_BOTTOM = new THREE.Vector3(-0.01, -0.065, 0.025);
/** The honda (the knot the loop runs through) in the noose's own coordinates (see lasso.py: NOOSE_R at +X). */
const HONDA = new THREE.Vector3(0.235, 0.01, 0);
/** The top of the coil (where the line leaves it), in the palm's coordinates. */
const COIL_TOP = new THREE.Vector3(0.075, -0.05, -0.01);

type Cast = 'idle' | 'throw' | 'yank' | 'hook' | 'back';

export interface LassoView {
  root: THREE.Group;
  /** A throw starts (left button or F): the wind-up. */
  throwLoop(): void;
  /** The simulation's events (the catch, the hook). */
  handle(events: SimEvent[]): void;
  /** The view's jolts since the last call (yank, hook catch), radians: the viewmodel adds them to its view kick. */
  takePunch(): number;
  /**
   * Where the rope leaves the fist, camera space (lassoRope.ts draws the
   * flying rope from there). Valid after update.
   */
  handPoint(out: THREE.Vector3): THREE.Vector3;
  /** Is the loop out of the hand (the world rope is drawing it)? */
  readonly ropeOut: boolean;
  /**
   * Advance. `offset` = the shared motion of the viewmodel (sway, bob, the
   * draw coming up from below); `anchor` = where the hook holds, in camera
   * space, or null.
   */
  update(dt: number, player: PlayerState, offset: GunPose, anchor: THREE.Vector3 | null): void;
}

export function createLassoView(): LassoView {
  const s = lassoSettings;
  const root = new THREE.Group();
  root.visible = false;

  // The right fist (the revolver's hand: a fist around a grip is a fist around a rope).
  const hands = createHands();
  const fist = new THREE.Group();
  fist.rotation.order = 'YXZ';
  fist.add(hands.right);
  // The left hand, palm down, holding the coil by its tie.
  const palm = new THREE.Group();
  palm.rotation.order = 'YXZ';
  palm.add(hands.left);
  root.add(fist, palm);

  // The rope's material: the model's, once it's loaded (a plain color until then).
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0xc49e62, roughness: 1, metalness: 0 });
  const noose = new THREE.Group();
  const coilHolder = new THREE.Group();
  palm.add(coilHolder);
  root.add(noose);
  loadGunModel('lasso.glb', (model) => {
    const n = model.getObjectByName('noose');
    const c = model.getObjectByName('coil');
    if (n) noose.add(n);
    if (c) coilHolder.add(c);
    n?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        ropeMaterial.map = m.map;
        ropeMaterial.color.set(0xffffff);
        ropeMaterial.needsUpdate = true;
      }
    });
  });
  // The coil hangs with its loops half turned toward you.
  coilHolder.rotation.set(-0.25, -0.75, -0.35);
  coilHolder.position.set(0.06, -0.03, -0.02);
  coilHolder.scale.setScalar(0.75);

  // The two bending ropes: from the fist to the honda (the spoke), from the coil to the fist (the running line).
  const spoke = createRope(6, 0.0085, ropeMaterial);
  const running = createRope(10, 0.0085, ropeMaterial);
  root.add(spoke.mesh, running.mesh);
  const spokePts = Array.from({ length: spoke.count }, () => new THREE.Vector3());
  const runningPts = Array.from({ length: running.count }, () => new THREE.Vector3());

  let spring = new PoseSpring(s.stiffness, s.damping);
  let springFor = `${s.stiffness}|${s.damping}`; // rebuilt when the debug panel changes them
  let pending = 0;
  let cast: Cast = 'idle';
  let castTime = 0;
  let regrow = 1; // 0 = the noose just came back (small), 1 = open
  let angle = 0; // the loop's spin
  let punch = 0;
  let hooked = false; // the hook is holding (not just flying)

  const exit = new THREE.Vector3();
  const bottom = new THREE.Vector3();
  const honda = new THREE.Vector3();
  const coilTop = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const across = new THREE.Vector3();
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  const spinQ = new THREE.Quaternion();
  const tiltQ = new THREE.Quaternion();

  function set(next: Cast): void {
    cast = next;
    castTime = 0;
  }

  const view: LassoView = {
    root,
    get ropeOut() {
      if (cast === 'throw') return castTime >= RELEASE * tuning.lassoWindup;
      if (cast === 'hook') return castTime >= HOOK_RELEASE;
      return cast === 'yank' || cast === 'back';
    },
    throwLoop() {
      set('throw');
    },
    handle(events) {
      for (const e of events) {
        if (e.type === 'kickLand' && e.tool === 'lasso') {
          if (e.hits > 0) {
            set('yank');
            punch += s.yankPunch;
          } else set('back');
        } else if (e.type === 'hookThrow') {
          set('hook');
          hooked = false;
        } else if (e.type === 'hookAttach') {
          hooked = true;
          punch += s.hookPunch;
        } else if (e.type === 'hookRelease') {
          set('back');
          hooked = false;
        }
      }
    },
    takePunch() {
      const p = punch;
      punch = 0;
      return p;
    },
    handPoint(out) {
      return out.copy(exit);
    },
    update(dt, _player, offset, anchor) {
      castTime += dt;
      // The state machine's clocks.
      if (cast === 'yank' && castTime >= YANK_TIME) set('back');
      if (cast === 'back' && castTime >= RETRACT_TIME) {
        set('idle');
        regrow = 0;
      }
      if (cast === 'throw' && castTime >= tuning.lassoWindup + 0.4) set('back'); // (safety: no event came)
      regrow = Math.min(1, regrow + dt / REGROW_TIME);

      // --- The target pose of the fist, offsets from rest ---
      let target: GunPose = ZERO_POSE;
      if (cast === 'throw') target = poseAt(THROW_KEYS, Math.min(0.999, castTime / tuning.lassoWindup));
      else if (cast === 'yank') target = poseAt(YANK_KEYS, Math.min(0.999, castTime / YANK_TIME));
      else if (cast === 'back') target = BACK_POSE;
      else if (cast === 'hook') {
        // Reaching toward the anchor: turn (yaw, pitch) toward its direction,
        // half way (the elbow does the rest), and shake when it's taut.
        target = { ...HOOK_POSE };
        if (anchor) {
          w.copy(anchor).normalize();
          target.yaw += Math.atan2(-w.x, -w.z) * 0.6;
          target.pitch += Math.asin(THREE.MathUtils.clamp(w.y, -1, 1)) * 0.6;
          target.x += w.x * 0.05;
          target.y += w.y * 0.05;
        }
        if (hooked) {
          const shake = 0.006;
          target.x += (Math.random() * 2 - 1) * shake;
          target.y += (Math.random() * 2 - 1) * shake;
          target.pitch += (Math.random() * 2 - 1) * shake * 4;
        }
      }
      if (springFor !== `${s.stiffness}|${s.damping}`) {
        spring = new PoseSpring(s.stiffness, s.damping);
        springFor = `${s.stiffness}|${s.damping}`;
      }
      pending += dt;
      while (pending >= ELASTIC_STEP) {
        spring.step(target, ELASTIC_STEP);
        pending -= ELASTIC_STEP;
      }
      const p = spring.pose;

      // --- The spin: faster while winding up ---
      const winding = cast === 'throw' && castTime < RELEASE * tuning.lassoWindup;
      const turnsBefore = Math.floor(angle / (Math.PI * 2));
      angle += dt * Math.PI * 2 * (winding ? s.spinWindup : s.spin) * (regrow < 1 ? 1.5 : 1);
      // A "whup" of air at every turn of the loop (louder while winding up).
      if (Math.floor(angle / (Math.PI * 2)) !== turnsBefore && cast !== 'hook' && !view.ropeOut) playLassoWhirl(winding ? 1.6 : 0.6);
      // The plane of the loop: its normal tilted from straight up.
      normal.set(-s.nooseTiltZ, 1, s.nooseTiltX).normalize();
      // Two axes in that plane (u, w), for the wrist's circles.
      u.set(1, 0, 0).addScaledVector(normal, -normal.x).normalize();
      w.crossVectors(normal, u);
      const cx = Math.cos(angle) * s.wristCircle;
      const cy = Math.sin(angle) * s.wristCircle;

      // --- The fist ---
      fist.position.set(
        s.fistX + p.x + offset.x + u.x * cx + w.x * cy,
        s.fistY + p.y + offset.y + u.y * cx + w.y * cy,
        s.fistZ + p.z + offset.z + u.z * cx + w.z * cy,
      );
      fist.rotation.set(s.fistPitch + p.pitch + offset.pitch, s.fistYaw + p.yaw + offset.yaw, s.fistRoll + p.roll + offset.roll);

      // --- The left hand with the coil: it follows the throw a little (the body turns) ---
      palm.position.set(
        s.palmX + offset.x - p.x * 0.3,
        s.palmY + offset.y + p.y * 0.2 - (cast === 'yank' ? 0.02 : 0),
        s.palmZ + offset.z + p.z * 0.4,
      );
      palm.rotation.set(s.palmPitch + offset.pitch, s.palmYaw + offset.yaw - p.yaw * 0.3, s.palmRoll + offset.roll);

      // --- The noose: spinning above the fist, gone while it's out ---
      const out = view.ropeOut;
      noose.visible = !out && cast !== 'back';
      // While winding up the loop is swung back over the head with the fist.
      noose.position.set(
        s.nooseX + p.x * 1.4 + offset.x,
        s.nooseY + p.y * 1.4 + offset.y,
        s.nooseZ + p.z * 1.2 + offset.z,
      );
      tiltQ.setFromUnitVectors(up, normal);
      spinQ.setFromAxisAngle(up, angle);
      noose.quaternion.copy(tiltQ).multiply(spinQ);
      noose.scale.setScalar(s.nooseSize * (0.35 + 0.65 * regrow));

      // --- The ropes: positions in camera space (root has no transform of its own) ---
      root.updateMatrixWorld(true);
      exit.copy(FIST_EXIT).applyMatrix4(fist.matrixWorld);
      bottom.copy(FIST_BOTTOM).applyMatrix4(fist.matrixWorld);
      coilTop.copy(COIL_TOP).applyMatrix4(palm.matrixWorld);
      spoke.mesh.visible = noose.visible;
      if (noose.visible) {
        honda.copy(HONDA).applyMatrix4(noose.matrixWorld);
        across.set(0, 0, 1);
        layRope(spokePts, exit, honda, 0.005, 0, 0, across);
        spoke.setPoints(spokePts);
      }
      // The running line hangs between the hands; tighter when the loop is out (it's paying out rope).
      across.set(0, 0, 1);
      layRope(runningPts, coilTop, bottom, out ? 0.015 : 0.035, 0, 0, across);
      running.setPoints(runningPts);
    },
  };
  return view;
}
