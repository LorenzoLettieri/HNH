// Camera "feel": small visual effects that make movement read as fast and
// physical. Purely cosmetic: they never touch the simulation.
// - field of view widens with speed (the classic "sense of speed" trick);
// - the camera tilts (rolls) a little when strafing, more while sliding;
// - crouching lowers the eyes smoothly instead of snapping;
// - getting hit snaps the head away from the hit (a damped spring).
import * as THREE from 'three';
import { tuning } from '../sim/config';
import type { PlayerState } from '../sim/player';

/** Mutable so the debug panel can change them. */
export const cameraFeelSettings = {
  /** Vertical field of view at normal speed, degrees. */
  baseFov: 75,
  /** Extra degrees of FOV at full speed. */
  speedFovExtra: 12,
  /** Speed (m/s) where the FOV starts widening... */
  speedFovStart: 8.5,
  /** ...and the speed where it reaches the full extra. */
  speedFovFull: 16,
  /** Camera roll when strafing at run speed, degrees. */
  strafeRoll: 1.2,
  /** Extra roll while sliding, degrees. */
  slideRoll: 3,
  /** How fast the effects follow their target (higher = snappier). */
  fovRate: 6,
  rollRate: 10,
  eyeRate: 18,
  /** Head snap when you get hit by hurtKickDamage damage, degrees (bigger hits: more, up to 2×). */
  hurtKick: 7,
  hurtKickDamage: 20,
  /** The spring that brings the head back: stiffness and damping ratio (<1 = a small bounce). */
  hurtStiffness: 250,
  hurtDamping: 0.45,
  /** Shake on top of the snap: random jitter of the view at a hit of hurtKickDamage, degrees... */
  hurtShake: 1.5,
  /** ...and how fast it dies out (higher = shorter). */
  hurtShakeDecay: 10,
};

let fov = cameraFeelSettings.baseFov;
let roll = 0;
let eyeHeight = tuning.eyeHeight;
// Hit snap: one damped spring per axis (angle in radians and its speed).
const snap = { pitch: 0, pitchVel: 0, roll: 0, rollVel: 0 };
let shake = 0; // current shake amplitude, radians

/**
 * The player got hit from `angle` (screen angle: 0 = in front, +π/2 = right,
 * ±π = behind; see damageIndicator.ts). The head is pushed AWAY from the hit:
 * from the front it snaps back (looks up), from the right it tilts left.
 * We don't set the angle, we give the spring a kick in SPEED: the spring then
 * moves the head out and back by itself, with a natural curve.
 */
export function hurtKick(angle: number, damage: number): void {
  const s = cameraFeelSettings;
  const size = THREE.MathUtils.degToRad(s.hurtKick) * Math.min(2, damage / s.hurtKickDamage);
  // For a damped spring kicked with speed v the head goes out by about v/ω × peak
  // (ω = sqrt(stiffness), peak ≈ 0.57 with damping 0.45): solve for v.
  const omega = Math.sqrt(s.hurtStiffness);
  const v = (size * omega) / 0.57;
  snap.pitchVel += Math.cos(angle) * v;
  snap.rollVel += Math.sin(angle) * v;
  // Shake: the snap is one smooth movement, the shake adds the "rattle".
  shake = Math.max(shake, THREE.MathUtils.degToRad(s.hurtShake) * Math.min(2, damage / s.hurtKickDamage));
}

/**
 * One step of a damped spring: the force pulls toward 0 (stiffness × angle)
 * and the damping resists the speed. Semi-implicit Euler: update the speed
 * first, then move with the NEW speed (more stable than the other order).
 */
function stepSpring(angle: number, vel: number, dt: number): [number, number] {
  const k = cameraFeelSettings.hurtStiffness;
  const c = 2 * cameraFeelSettings.hurtDamping * Math.sqrt(k);
  vel += (-k * angle - c * vel) * dt;
  return [angle + vel * dt, vel];
}

/**
 * Moves `current` toward `target` by a fraction that depends on the frame
 * time: fast at first, then easing in. Same result at any frame rate
 * (the same exponential decay used by the landing dip).
 */
function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Call every frame. Returns the eye height to use; updates FOV and roll on the camera. */
export function updateCameraFeel(
  camera: THREE.PerspectiveCamera,
  player: PlayerState,
  dt: number,
): number {
  const s = cameraFeelSettings;
  const speed = Math.hypot(player.vx, player.vz);

  // 1. Speed FOV: 0 below speedFovStart, 1 at speedFovFull, linear in between.
  const t = THREE.MathUtils.clamp((speed - s.speedFovStart) / (s.speedFovFull - s.speedFovStart), 0, 1);
  fov = approach(fov, s.baseFov + s.speedFovExtra * t, s.fovRate, dt);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix(); // the projection matrix depends on the FOV
  }

  // 2. Roll. How much of our velocity goes sideways relative to the view?
  //    Dot product with the "right" direction (yes, the dot product again).
  const rightX = Math.cos(player.yaw);
  const rightZ = -Math.sin(player.yaw);
  const sideways = (player.vx * rightX + player.vz * rightZ) / tuning.maxGroundSpeed;
  let targetRoll = -THREE.MathUtils.clamp(sideways, -1, 1) * s.strafeRoll;
  if (player.sliding) targetRoll -= s.slideRoll * (sideways >= 0 ? 1 : -1);
  roll = approach(roll, THREE.MathUtils.degToRad(targetRoll), s.rollRate, dt);
  // Hit snap, on top of the view and the roll: only visual, aim is unaffected.
  // Small substeps: a stiff spring with a long frame (a hitch) could explode.
  for (let left = Math.min(dt, 0.1); left > 0; left -= 1 / 120) {
    const h = Math.min(left, 1 / 120);
    [snap.pitch, snap.pitchVel] = stepSpring(snap.pitch, snap.pitchVel, h);
    [snap.roll, snap.rollVel] = stepSpring(snap.roll, snap.rollVel, h);
  }
  // Shake: a new random offset every frame, smaller and smaller (exponential decay).
  shake *= Math.exp(-s.hurtShakeDecay * dt);
  const jitter = () => (Math.random() * 2 - 1) * shake;
  camera.rotation.z = roll + snap.roll + jitter();
  camera.rotation.x += snap.pitch + jitter();
  camera.rotation.y += jitter();

  // 3. Eye height: glide toward standing or crouched height.
  const targetEye = player.crouched ? tuning.crouchEyeHeight : tuning.eyeHeight;
  eyeHeight = approach(eyeHeight, targetEye, s.eyeRate, dt);
  return eyeHeight;
}
