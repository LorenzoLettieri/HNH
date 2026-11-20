// Turns weapon events from the simulation into things you see and hear:
// impact holes, sparks, the muzzle flash lighting up the world, sounds.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import {
  playDryFire,
  playDuelReady,
  playFireballHit,
  playRicochet,
  playHeadshot,
  playKickImpact,
  playKickSwing,
  playReload,
  playCarbineShot,
  playCarbineLever,
  playCarbineReloadStart,
  playCarbineRoundIn,
  playShot,
  playShotgun,
  playShotgunReload,
  playTargetDown,
  playTargetHit,
  playWeaponSwitch,
} from '../audio/sfx';
import type { WeaponId } from '../sim/weapon';
import { createImpacts } from './impacts';
import { leverTimes } from './weapons/rifleView';
import { showHitmarker } from './hitmarker';
import { spawnBlood, spawnSnort, spawnSparks } from './particles';
import { soundAt } from './soundPosition';

/** How long the muzzle flash lights up the surroundings, seconds. */
const FLASH_DURATION = 0.07;
const FLASH_INTENSITY = 40;
/** The shotgun's flash is bigger. */
const SHOTGUN_FLASH_INTENSITY = 80;
/** Card "Ultimo colpo": the explosion's flash, and how many fire puffs and sparks it throws. */
const EXPLOSION_FLASH_INTENSITY = 120;
const EXPLOSION_PUFFS = 10;
const EXPLOSION_SPARKS = 30;

export interface WeaponFx {
  handle(events: SimEvent[], camera: THREE.Camera): void;
  update(dt: number): void;
  /** Listeners for other modules (e.g. the viewmodel recoil). */
  onShot: ((weapon: WeaponId, barrel: number) => void)[];
  /** A reload starts: which weapon, and how many seconds it lasts (the simulation says: cards can change it). */
  onReload: ((weapon: WeaponId, seconds: number) => void)[];
  onKick: (() => void)[];
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
            else if (e.weapon === 'rifle') {
              playCarbineShot();
              playCarbineLever(leverTimes(e.seconds)); // cla-CLACK, timed on the animation (the event says how long)
            } else playShot();
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
          case 'duelReady':
            playDuelReady(); // "Duellante": the next carbine shot does double damage
            break;
          case 'ricochet':
            // Card "Ricochet": the bullet bounced off a head (ptiiing + a few sparks).
            point.set(e.x, e.y, e.z);
            playRicochet(soundAt(camera, e.x, e.y, e.z));
            spawnSparks(point, up, 6);
            break;
          case 'explosion': {
            // Card "Ultimo colpo": a burst of fire puffs in every direction
            // (a ring, tilted up), sparks, and the flash lighting the walls.
            point.set(e.x, e.y, e.z);
            playFireballHit(soundAt(camera, e.x, e.y, e.z));
            for (let i = 0; i < EXPLOSION_PUFFS; i++) {
              const a = (i / EXPLOSION_PUFFS) * Math.PI * 2;
              normal.set(Math.cos(a), 0.6, Math.sin(a)).normalize();
              spawnSnort(point, normal, 3);
            }
            spawnSparks(point, up, EXPLOSION_SPARKS);
            flash.position.copy(point);
            flashTime = FLASH_DURATION * 2;
            flashPeak = EXPLOSION_FLASH_INTENSITY;
            break;
          }
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
            if (e.weapon === 'shotgun') playShotgunReload(e.seconds);
            else if (e.weapon === 'rifle') playCarbineReloadStart();
            else playReload(e.seconds);
            for (const f of fx.onReload) f(e.weapon, e.seconds);
            break;
          case 'reloadRound':
            playCarbineRoundIn();
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
