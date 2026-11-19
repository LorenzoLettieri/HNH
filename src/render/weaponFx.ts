// Turns weapon events from the simulation into things you see and hear:
// impact holes, sparks, the muzzle flash lighting up the world, sounds.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { tuning } from '../sim/config';
import {
  playDryFire,
  playHeadshot,
  playKickImpact,
  playKickSwing,
  playReload,
  playShot,
  playShotgun,
  playShotgunReload,
  playTargetDown,
  playTargetHit,
  playWeaponSwitch,
} from '../audio/sfx';
import type { WeaponId } from '../sim/weapon';
import { createImpacts } from './impacts';
import { spawnBlood, spawnSparks } from './particles';

/** How long the muzzle flash lights up the surroundings, seconds. */
const FLASH_DURATION = 0.07;
const FLASH_INTENSITY = 40;
/** The shotgun's flash is bigger. */
const SHOTGUN_FLASH_INTENSITY = 80;

export interface WeaponFx {
  handle(events: SimEvent[], camera: THREE.Camera): void;
  update(dt: number): void;
  /** Listeners for other modules (e.g. the viewmodel recoil). */
  onShot: ((weapon: WeaponId, barrel: number) => void)[];
  onReload: ((weapon: WeaponId) => void)[];
  onKick: (() => void)[];
}

/**
 * Hitmarker: the little X around the crosshair that confirms a hit.
 * Pure CSS: we add a class, and remove it after a moment. Restarting a CSS
 * animation needs a "reflow" in between (reading offsetWidth forces it).
 */
const hitmarker = document.getElementById('hitmarker');
function showHitmarker(kill: boolean, headshot: boolean): void {
  if (!hitmarker) return;
  hitmarker.classList.remove('hit', 'kill', 'head');
  void hitmarker.offsetWidth;
  hitmarker.classList.add(kill ? 'kill' : 'hit');
  if (headshot) hitmarker.classList.add('head');
}

export function createWeaponFx(scene: THREE.Scene): WeaponFx {
  const impacts = createImpacts(scene);

  // The flash: a warm point light placed in front of the camera for a few
  // hundredths of a second. In the dark (High Midnight) every shot lights up
  // the walls around you: a classic boomer shooter effect.
  const flash = new THREE.PointLight(0xffb060, 0, 12);
  scene.add(flash);
  let flashTime = 0;
  let flashPeak = FLASH_INTENSITY;

  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const fx: WeaponFx = {
    onShot: [],
    onReload: [],
    onKick: [],
    handle(events, camera) {
      for (const e of events) {
        switch (e.type) {
          case 'fire':
            // The gun went off: sound, light, recoil (once per trigger pull).
            if (e.weapon === 'shotgun') playShotgun();
            else playShot();
            camera.getWorldDirection(forward);
            flash.position.copy(camera.position).addScaledVector(forward, 0.8);
            flashTime = FLASH_DURATION;
            flashPeak = e.weapon === 'shotgun' ? SHOTGUN_FLASH_INTENSITY : FLASH_INTENSITY;
            for (const f of fx.onShot) f(e.weapon, e.barrel);
            break;
          case 'shot':
            // One bullet or pellet: where it landed. Pellets get smaller
            // effects, otherwise 12 of them would bury the screen in particles.
            if (e.normal) {
              point.set(e.to.x, e.to.y, e.to.z);
              normal.set(e.normal.x, e.normal.y, e.normal.z);
              // No holes on entities: they move (the hole would float in the air).
              if (e.surface === 'level') impacts.add(point, normal);
              if (e.surface === 'flesh' && e.headshot) {
                // Headshot: a big spray, mostly upward.
                spawnBlood(point, up, e.pellet ? 10 : 45);
              } else if (e.surface === 'flesh') spawnBlood(point, normal, e.pellet ? 5 : 14);
              else spawnSparks(point, normal, Math.ceil((e.surface === 'metal' ? 18 : 10) / (e.pellet ? 3 : 1)));
            }
            break;
          case 'weaponSwitch':
            playWeaponSwitch();
            break;
          case 'kickStart':
            playKickSwing();
            for (const f of fx.onKick) f();
            break;
          case 'kickLand':
            if (e.hits > 0) playKickImpact(e.hits);
            break;
          case 'dryFire':
            playDryFire();
            break;
          case 'reloadStart':
            if (e.weapon === 'shotgun') playShotgunReload(tuning.shotgunReloadTime);
            else playReload(tuning.revolverReloadTime);
            for (const f of fx.onReload) f(e.weapon);
            break;
          case 'reloadEnd':
            break;
          case 'hit':
            if (e.surface === 'metal') {
              if (e.killed) playTargetDown();
              else playTargetHit();
            }
            if (e.headshot) playHeadshot(e.killed);
            showHitmarker(e.killed, e.headshot);
            break;
        }
      }
    },
    update(dt) {
      flashTime = Math.max(0, flashTime - dt);
      flash.intensity = flashPeak * (flashTime / FLASH_DURATION);
    },
  };
  return fx;
}
