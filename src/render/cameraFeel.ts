// Camera "feel": small visual effects that make movement read as fast and
// physical. Purely cosmetic: they never touch the simulation.
// - field of view widens with speed (the classic "sense of speed" trick);
// - the camera tilts (rolls) a little when strafing, more while sliding;
// - crouching lowers the eyes smoothly instead of snapping.
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
};

let fov = cameraFeelSettings.baseFov;
let roll = 0;
let eyeHeight = tuning.eyeHeight;

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
  camera.rotation.z = roll;

  // 3. Eye height: glide toward standing or crouched height.
  const targetEye = player.crouched ? tuning.crouchEyeHeight : tuning.eyeHeight;
  eyeHeight = approach(eyeHeight, targetEye, s.eyeRate, dt);
  return eyeHeight;
}
