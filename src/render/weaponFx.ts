// Turns weapon events from the simulation into things you see and hear:
// impact holes, sparks, the muzzle flash lighting up the world, sounds.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { tuning } from '../sim/config';
import { playDryFire, playReload, playShot } from '../audio/sfx';
import { createImpacts } from './impacts';
import { spawnSparks } from './particles';

/** How long the muzzle flash lights up the surroundings, seconds. */
const FLASH_DURATION = 0.07;
const FLASH_INTENSITY = 40;

export interface WeaponFx {
  handle(events: SimEvent[], camera: THREE.Camera): void;
  update(dt: number): void;
  /** Listeners for other modules (e.g. the viewmodel recoil). */
  onShot: (() => void)[];
  onReload: (() => void)[];
}

export function createWeaponFx(scene: THREE.Scene): WeaponFx {
  const impacts = createImpacts(scene);

  // The flash: a warm point light placed in front of the camera for a few
  // hundredths of a second. In the dark (High Midnight) every shot lights up
  // the walls around you: a classic boomer shooter effect.
  const flash = new THREE.PointLight(0xffb060, 0, 12);
  scene.add(flash);
  let flashTime = 0;

  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const fx: WeaponFx = {
    onShot: [],
    onReload: [],
    handle(events, camera) {
      for (const e of events) {
        switch (e.type) {
          case 'shot':
            playShot();
            camera.getWorldDirection(forward);
            flash.position.copy(camera.position).addScaledVector(forward, 0.8);
            flashTime = FLASH_DURATION;
            if (e.normal) {
              point.set(e.to.x, e.to.y, e.to.z);
              normal.set(e.normal.x, e.normal.y, e.normal.z);
              impacts.add(point, normal);
              spawnSparks(point, normal);
            }
            for (const f of fx.onShot) f();
            break;
          case 'dryFire':
            playDryFire();
            break;
          case 'reloadStart':
            playReload(tuning.revolverReloadTime);
            for (const f of fx.onReload) f();
            break;
          case 'reloadEnd':
            break;
        }
      }
    },
    update(dt) {
      flashTime = Math.max(0, flashTime - dt);
      flash.intensity = FLASH_INTENSITY * (flashTime / FLASH_DURATION);
    },
  };
  return fx;
}
