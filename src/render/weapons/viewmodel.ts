// The "viewmodel": the gun you see in your hand. It lives in its OWN scene,
// with its own camera, drawn on top of the world after clearing the depth
// buffer. That's the classic FPS trick:
// - the gun never sinks into walls when you stand close to them;
// - it has its own field of view, so it doesn't stretch when the world FOV
//   widens with speed.
// Everything here is cosmetic: firing and ammo are decided by the simulation.
import * as THREE from 'three';
import { secondsToTicks, tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import type { Atmosphere } from '../atmospheres';
import { directionFromAngles } from '../sky';
import { PixelCanvas } from '../props/pixelCanvas';
import { createRevolverModel } from './revolverModel';
import { createHands, poseLeftHand } from './hands';
import { createKickLeg } from './kickLeg';
import { createShotgunView } from './shotgunView';
import type { WeaponId } from '../../sim/weapon';

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

  // --- Shotgun (the origin of its model is the right hand on the grip) ---
  shotgunX: 0.11,
  shotgunY: -0.15,
  shotgunZ: -0.26,
  /** Turned inward, toward the crosshair, radians. */
  shotgunYaw: 0.12,
  /** Tilted on its side (roll), radians: shows a bit more of the gun's flank. */
  shotgunRoll: 0.1,
  /** Kick up on each shot, radians: heavier than the revolver... */
  shotgunRecoil: 0.35,
  /** ...and it slams back into your shoulder, meters. */
  shotgunRecoilBack: 0.09,
  shotgunRecoilRecovery: 7,
  shotgunViewKick: 0.06,

  /** How far below the screen a weapon starts when you switch to it, meters. */
  switchDrop: 0.22,
};

/** How far the revolver's hammer falls forward when it fires, radians (the model has it cocked, at 0). */
const HAMMER_FIRED = 0.5;

/** Smoothly moves `current` toward `target` (same exponential easing as cameraFeel). */
function approach(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** A muzzle flash sprite: additive (it adds light), HDR bright (it blooms). */
function createFlash(texture: THREE.Texture): THREE.Sprite {
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: new THREE.Color(1, 1, 1).multiplyScalar(5),
    }),
  );
  flash.visible = false;
  return flash;
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
  onShot(weapon: WeaponId, barrel: number): void;
  onReload(weapon: WeaponId): void;
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
  // Everything that belongs to the revolver, to show/hide it in one go.
  const revolver = new THREE.Group();
  revolver.add(gun.root, hands.left);
  holder.add(revolver);
  let fanTime = 1; // 0..1 progress of the fanning swipe (≥ 1 = idle)
  scene.add(holder);

  // The shotgun, with its own hands and animations (see shotgunView.ts).
  const shotgun = createShotgunView();
  shotgun.root.visible = false;
  holder.add(shotgun.root);
  let shownWeapon: WeaponId = 'revolver';
  let switchDrop = 0; // 1 = the gun is fully below the screen, 0 = in place

  // The kicking leg: directly in the scene (not in the holder), so the gun's
  // sway and bob don't shake it.
  const leg = createKickLeg();
  scene.add(leg.root);
  let kickTime = Infinity; // seconds since the kick started (Infinity = none)
  let kickPunched = true; // the camera dip of this kick already happened

  const flashMap = flashTexture();
  const flash = createFlash(flashMap);
  flash.position.copy(gun.muzzle);
  gun.root.add(flash);
  const shotgunFlash = createFlash(flashMap);
  shotgun.root.add(shotgunFlash);

  // Animation state.
  let kick = 0; // 0..1, recoil amount
  let kickWeapon: WeaponId = 'revolver'; // which gun's recoil numbers apply
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
    onShot(weapon, barrel) {
      kick = 1;
      kickWeapon = weapon;
      flashTime = 0.05;
      if (weapon === 'shotgun') {
        viewKick = s.shotgunViewKick;
        shotgunFlash.position.copy(shotgun.muzzles[barrel]);
        shotgunFlash.material.rotation = Math.random() * Math.PI;
        shotgunFlash.scale.setScalar(0.15 + Math.random() * 0.06);
        return;
      }
      fanTime = 0;
      viewKick = s.viewKick;
      cylinderTarget += Math.PI / 3; // next chamber: 360° / 6
      hammerTime = 0;
      flash.material.rotation = Math.random() * Math.PI;
      flash.scale.setScalar(0.09 + Math.random() * 0.05);
    },
    onReload(weapon) {
      if (weapon === 'shotgun') shotgun.onReload();
      else reloadTime = 0;
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

      // --- Weapon switch: the new gun pops in from below the screen ---
      // (The old one simply disappears: it's already out of view in a
      // fraction of a second, animating it down too would only add delay.)
      if (player.weapon !== shownWeapon) {
        shownWeapon = player.weapon;
        switchDrop = 1;
        reloadTime = -1; // a reload in progress was cancelled by the switch
        shotgun.cancel();
        flashTime = 0;
      }
      revolver.visible = shownWeapon === 'revolver';
      shotgun.root.visible = shownWeapon === 'shotgun';
      const switchTotal = secondsToTicks(tuning.weaponSwitchTime);
      const switchTarget = switchTotal > 0 ? player.switchTicks / switchTotal : 0;
      switchDrop = approach(switchDrop, Math.min(switchDrop, switchTarget), 30, dt);
      const isShotgun = shownWeapon === 'shotgun';

      // --- Recoil, flash, view kick: instant hit, exponential recovery ---
      kick = approach(kick, 0, kickWeapon === 'shotgun' ? s.shotgunRecoilRecovery : s.recoilRecovery, dt);
      viewKick = approach(viewKick, 0, 12, dt);
      flashTime -= dt;
      flash.visible = flashTime > 0 && !isShotgun;
      shotgunFlash.visible = flashTime > 0 && isShotgun;
      flashLight.intensity = flashTime > 0 ? (isShotgun ? 5 : 3) : 0;
      const activeFlash = isShotgun ? shotgunFlash : flash;
      flashLight.position.copy(activeFlash.position).applyMatrix4(activeFlash.parent!.matrixWorld);

      // --- Cylinder turns to the next chamber; hammer re-cocks after a shot ---
      cylinderAngle = approach(cylinderAngle, cylinderTarget, 25, dt);
      hammerTime += dt;
      const cocked = Math.min(1, Math.max(0, (hammerTime - 0.06) / (tuning.revolverFireInterval * 0.6)));
      gun.hammer.rotation.x = HAMMER_FIRED * (1 - cocked); // 0 = cocked, as modeled

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

      // --- Shotgun: reload swing (see shotgunView.ts) ---
      const shotgunReload = shotgun.update(dt, player);
      if (isShotgun) reload = 0; // the revolver's reload pose doesn't apply

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
      // Each weapon has its own rest pose and recoil; everything else
      // (sway, bob, slide, kick, switch) is shared.
      const rest = isShotgun
        ? { x: s.shotgunX, y: s.shotgunY, z: s.shotgunZ, yaw: s.shotgunYaw, roll: s.shotgunRoll }
        : { x: s.x, y: s.y, z: s.z, yaw: -0.04, roll: 0 };
      const recoilUp = kickWeapon === 'shotgun' ? s.shotgunRecoil : s.recoil;
      const recoilBack = kickWeapon === 'shotgun' ? s.shotgunRecoilBack : 0.05;
      // Shotgun reload: the gun swings across, muzzle to the left, so you
      // see it from the side: the barrels drop, the shells fly out.
      const sr = shotgunReload;
      holder.position.set(
        rest.x + swayX + bobX - reload * 0.04 - slideTilt * 0.02 + legOut * 0.04 - sr * 0.04,
        rest.y + swayY + bobY + fallOffset - reload * 0.07 - slideTilt * 0.03 - legOut * 0.05 + sr * 0.03
          - switchDrop * s.switchDrop,
        rest.z + kick * recoilBack - sr * 0.05,
      );
      holder.rotation.set(
        kick * recoilUp + reload * 0.4 - swayY * 2 - switchDrop * 0.6 + sr * 0.2,
        rest.yaw + swayX * 2 + sr * 0.75,
        rest.roll + reload * 1.1 + slideTilt * 0.35 - legOut * 0.25 + sr * 0.15,
      );
      return viewKick;
    },
  };
}
