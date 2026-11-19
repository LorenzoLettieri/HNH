// The "viewmodel": the gun you see in your hand. It lives in its OWN scene,
// with its own camera, drawn on top of the world after clearing the depth
// buffer. That's the classic FPS trick:
// - the gun never sinks into walls when you stand close to them;
// - it has its own field of view, so it doesn't stretch when the world FOV
//   widens with speed.
// Everything here is cosmetic: firing and ammo are decided by the simulation.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import type { Atmosphere } from '../atmospheres';
import { directionFromAngles } from '../sky';
import { PixelCanvas } from '../props/pixelCanvas';
import { createRevolverModel } from './revolverModel';
import { createHands, poseLeftHand } from './hands';
import { createKickLeg } from './kickLeg';

/** Mutable so the debug panel can change them. */
export const viewmodelSettings = {
  /** Field of view of the gun's camera, degrees (independent of the world FOV). */
  fov: 55,
  /** Where the gun rests relative to the eye, meters (right, up, forward is -z). */
  x: 0.11,
  y: -0.115,
  z: -0.36,
  /** How much the gun kicks up on each shot, radians. */
  recoil: 0.55,
  /** How fast it recovers from the kick (higher = snappier). */
  recoilRecovery: 10,
  /** Camera "punch" on each shot, radians (visual only: your aim doesn't move). */
  viewKick: 0.025,
  /** Lag when turning the mouse. */
  sway: 0.5,
  /** Up-down/side bob while running. */
  bob: 0.012,
  /** Duration of the left-hand fanning swipe, seconds (if longer than the fire interval, fast shooting restarts it midway). */
  fanDuration: 0.4,
  /** Camera dip when the boot lands, radians (visual only). */
  kickViewPunch: 0.03,
};

/** Smoothly moves `current` toward `target` (same exponential easing as cameraFeel). */
function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** A star-shaped burst for the muzzle flash, drawn pixel by pixel. */
function flashTexture(): THREE.Texture {
  const S = 16;
  const c = new PixelCanvas(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - S / 2 + 0.5;
      const dy = y - S / 2 + 0.5;
      const r = Math.hypot(dx, dy) / (S / 2);
      const angle = Math.atan2(dy, dx);
      // 6 rays: the radius reaches farther along 6 directions.
      const reach = 0.45 + 0.55 * Math.pow(Math.abs(Math.cos(angle * 3)), 6);
      if (r > reach) continue;
      const heat = 1 - r / reach;
      c.set(x, y, heat > 0.6 ? 0xfff8e0 : heat > 0.3 ? 0xffc040 : 0xff6010);
    }
  }
  return c.toTexture();
}

export interface Viewmodel {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onShot(): void;
  onReload(): void;
  /** The kick started: play the leg animation (see kickLeg.ts). */
  onKick(): void;
  applyAtmosphere(a: Atmosphere): void;
  setAspect(aspect: number): void;
  /**
   * Call every frame. `viewDeltaYaw/Pitch`: how much the view turned since
   * the last frame (for the sway). Returns the visual camera punch (radians).
   */
  update(dt: number, player: PlayerState, worldCamera: THREE.Camera, viewDeltaYaw: number, viewDeltaPitch: number): number;
}

export function createViewmodel(): Viewmodel {
  const s = viewmodelSettings;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(s.fov, 1, 0.01, 10);

  // Lights: an ambient fill and a "sun" whose direction follows the real sun
  // (converted into camera space every frame: see update()).
  const ambient = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  // Key light: fixed above-left of the eye, so the gun is ALWAYS readable,
  // even with the sun behind you. Real games cheat like this all the time.
  const key = new THREE.DirectionalLight(0xfff0dd, 1.4);
  key.position.set(-1, 2, 1.5);
  scene.add(ambient, sun, sun.target, key);
  // The flash lights up the gun itself for an instant.
  const flashLight = new THREE.PointLight(0xffb060, 0, 1.5);
  scene.add(flashLight);

  const gun = createRevolverModel();
  // `holder` is the gun's rest pose; all animations offset the gun inside it.
  const holder = new THREE.Group();
  holder.add(gun.root);

  // Hands: the right one is part of the gun (recoils with it); the left one
  // lives in the holder and fans the hammer at every shot.
  const hands = createHands();
  gun.root.add(hands.right);
  holder.add(hands.left);
  let fanTime = 1; // 0..1 progress of the fanning swipe (≥ 1 = idle)
  scene.add(holder);

  // The kicking leg: directly in the scene (not in the holder), so the gun's
  // sway and bob don't shake it.
  const leg = createKickLeg();
  scene.add(leg.root);
  let kickTime = Infinity; // seconds since the kick started (Infinity = none)
  let kickPunched = true; // the camera dip of this kick already happened

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flashTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(1, 1, 1).multiplyScalar(5), // HDR: blooms
    }),
  );
  flash.position.copy(gun.muzzle);
  flash.visible = false;
  gun.root.add(flash);

  // Animation state.
  let kick = 0; // 0..1, recoil amount
  let viewKick = 0;
  let flashTime = 0;
  let cylinderAngle = 0;
  let cylinderTarget = 0;
  let hammerTime = 1; // seconds since the last shot
  let reloadTime = -1; // seconds since the reload started (-1 = not reloading)
  let swayX = 0;
  let swayY = 0;
  let bobPhase = 0;
  let bobAmount = 0;
  let fallOffset = 0;
  let slideTilt = 0;

  const sunDir = new THREE.Vector3(0, 1, 0);
  const inverseCamera = new THREE.Quaternion();

  return {
    scene,
    camera,
    onShot() {
      fanTime = 0;
      kick = 1;
      viewKick = s.viewKick;
      flashTime = 0.05;
      cylinderTarget += Math.PI / 3; // next chamber: 360° / 6
      hammerTime = 0;
      flash.material.rotation = Math.random() * Math.PI;
      flash.scale.setScalar(0.09 + Math.random() * 0.05);
    },
    onReload() {
      reloadTime = 0;
    },
    onKick() {
      kickTime = 0;
      kickPunched = false;
      leg.play();
    },
    applyAtmosphere(a) {
      ambient.color.set(a.ambientSky);
      ambient.groundColor.set(a.ambientGround);
      // A bit brighter than the world: the gun must always be readable.
      ambient.intensity = a.ambientIntensity * 1.5 + 0.4;
      key.color.set(a.sunLightColor).lerp(new THREE.Color(0xffffff), 0.6);
      sun.color.set(a.sunLightColor);
      sun.intensity = a.sunLightIntensity * 0.8;
      sunDir.copy(directionFromAngles(a.sunElevation, a.sunAzimuth));
    },
    setAspect(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    update(dt, player, worldCamera, dYaw, dPitch) {
      if (camera.fov !== s.fov) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
      }

      // Sun direction from world space into camera space: rotate it by the
      // INVERSE of the camera rotation (the gun scene is "glued" to the eye).
      inverseCamera.copy(worldCamera.quaternion).invert();
      sun.position.copy(sunDir).applyQuaternion(inverseCamera).multiplyScalar(5);

      // --- Recoil, flash, view kick: instant hit, exponential recovery ---
      kick = approach(kick, 0, s.recoilRecovery, dt);
      viewKick = approach(viewKick, 0, 12, dt);
      flashTime -= dt;
      flash.visible = flashTime > 0;
      flashLight.intensity = flashTime > 0 ? 3 : 0;
      flashLight.position.copy(gun.muzzle).applyMatrix4(gun.root.matrixWorld);

      // --- Cylinder turns to the next chamber; hammer re-cocks after a shot ---
      cylinderAngle = approach(cylinderAngle, cylinderTarget, 25, dt);
      hammerTime += dt;
      const cocked = Math.min(1, Math.max(0, (hammerTime - 0.06) / (tuning.revolverFireInterval * 0.6)));
      gun.hammer.rotation.x = -0.6 * cocked; // 0 = down (just fired), -0.6 = cocked

      // --- Reload: tilt the gun away, spin the cylinder, bring it back ---
      let reload = 0;
      if (reloadTime >= 0) {
        reloadTime += dt;
        const t = reloadTime / tuning.revolverReloadTime;
        if (t >= 1) reloadTime = -1;
        else {
          reload = Math.sin(Math.PI * t); // 0 → 1 → 0: down, then back up
          cylinderAngle += dt * 25 * reload; // the classic cylinder spin
          cylinderTarget = cylinderAngle;
        }
      }
      gun.cylinder.rotation.z = cylinderAngle;

      // --- Left hand: fanning swipe after each shot (hidden while reloading) ---
      fanTime = Math.min(1, fanTime + dt / s.fanDuration);
      poseLeftHand(hands.left, fanTime);
      hands.left.position.y -= reload * 0.15; // tucked away during the reload

      // --- Kick: the boot swings out; the gun is pulled aside to make room ---
      // (the body twists when you kick). At the moment of contact, a small
      // camera dip: the "weight" of the impact.
      kickTime += dt;
      const legOut = leg.update(dt);
      if (!kickPunched && kickTime >= tuning.kickWindup) {
        kickPunched = true;
        viewKick -= s.kickViewPunch;
      }

      // --- Sway: the gun lags behind when you turn the mouse ---
      swayX = approach(swayX, THREE.MathUtils.clamp(dYaw * s.sway, -0.04, 0.04), 12, dt);
      swayY = approach(swayY, THREE.MathUtils.clamp(-dPitch * s.sway, -0.04, 0.04), 12, dt);

      // --- Bob while running on the ground ---
      const speed = Math.hypot(player.vx, player.vz);
      const running = player.onGround && !player.sliding ? Math.min(speed / tuning.maxGroundSpeed, 1.5) : 0;
      bobAmount = approach(bobAmount, running, 8, dt);
      bobPhase += dt * (4 + speed * 0.9);
      const bobX = Math.sin(bobPhase) * s.bob * bobAmount;
      const bobY = -Math.abs(Math.cos(bobPhase)) * s.bob * bobAmount;

      // --- Falling lifts the gun, jumping lowers it (inertia) ---
      fallOffset = approach(fallOffset, THREE.MathUtils.clamp(-player.vy * 0.003, -0.03, 0.03), 10, dt);

      // --- Sliding: the gun tilts inward and drops a little ---
      slideTilt = approach(slideTilt, player.sliding ? 1 : 0, 10, dt);

      // --- Compose the final pose ---
      holder.position.set(
        s.x + swayX + bobX - reload * 0.04 - slideTilt * 0.02 + legOut * 0.04,
        s.y + swayY + bobY + fallOffset - reload * 0.07 - slideTilt * 0.03 - legOut * 0.05,
        s.z + kick * 0.05,
      );
      holder.rotation.set(
        kick * s.recoil + reload * 0.4 - swayY * 2,
        -0.04 + swayX * 2,
        reload * 1.1 + slideTilt * 0.35 - legOut * 0.25,
      );
      return viewKick;
    },
  };
}
