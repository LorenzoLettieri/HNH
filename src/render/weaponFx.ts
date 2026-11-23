// Turns weapon events from the simulation into things you see and hear:
// impact holes, sparks, the muzzle flash lighting up the world, sounds.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { tuning } from '../sim/config';
import {
  playDryFire,
  playDynamiteLaunch,
  playDynamiteReload,
  playDuelReady,
  playFireballHit,
  playRicochet,
  playHeadshot,
  playKickImpact,
  playKickSwing,
  playShovelBonk,
  playShovelSwing,
  playAkimboSpin,
  playReload,
  playRevolverDraw,
  playCarbineShot,
  playCarbineDraw,
  playCarbineLever,
  playCarbineReloadStart,
  playCarbineRoundIn,
  playPumpClose,
  playPumpDraw,
  playPumpRack,
  playPumpReloadStart,
  playPumpShellIn,
  playShot,
  playShotgun,
  playShotgunDraw,
  playShotgunReload,
  playTargetDown,
  playTargetHit,
} from '../audio/sfx';
import type { WeaponId } from '../sim/weapon';
import type { MeleeTool } from '../sim/kick';
import { createImpacts } from './impacts';
import { hitStopSettings, requestHitStop } from './hitStop';
import { leverTimes, rifleDrawTimes } from './weapons/rifleView';
import { shotgunDrawTimes } from './weapons/shotgunView';
import { drumTimes } from './weapons/dynamiteView';
import { revolverDrawTimes } from './weapons/revolverDraw';
import { pumpCloseTimes, pumpDrawTimes, pumpReloadTimes, pumpTimes } from './weapons/pumpView';
import { showHitmarker } from './hitmarker';
import { spawnBlood, spawnSnort, spawnSparks } from './particles';
import { soundAt } from './soundPosition';
import { spinTurnTimes } from './weapons/akimboSpin';

/** How long the muzzle flash lights up the surroundings, seconds. */
const FLASH_DURATION = 0.07;
const FLASH_INTENSITY = 40;
/** The shotgun's flash is bigger. */
const SHOTGUN_FLASH_INTENSITY = 80;
/** Card "Ultimo colpo": the explosion's flash, and how many fire puffs and sparks it throws. */
const EXPLOSION_FLASH_INTENSITY = 120;
/** Particles where the shovel lands, for each enemy hit. */
const SHOVEL_SPARKS = 12;
const SHOVEL_BLOOD = 18;
const EXPLOSION_PUFFS = 10;
const EXPLOSION_SPARKS = 30;

export interface WeaponFx {
  handle(events: SimEvent[], camera: THREE.Camera): void;
  update(dt: number): void;
  /** Listeners for other modules (e.g. the viewmodel recoil). */
  /** `forged` = the gun reinforced at the Forge (the shotgun: the pump-action). */
  onShot: ((weapon: WeaponId, barrel: number, forged: boolean) => void)[];
  /** A reload starts: which weapon, and how many seconds it lasts (the simulation says: cards can change it). */
  onReload: ((weapon: WeaponId, seconds: number, forged: boolean) => void)[];
  onKick: ((tool: MeleeTool) => void)[];
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
            if (e.weapon === 'shotgun') {
              playShotgun();
              // The pump-action: ch-CHK, timed on the animation (pumpView.ts). Once
              // per shot: "Doppio botto" sends two fire events, the pump is racked once.
              if (e.forged && e.barrel === 0) playPumpRack(pumpTimes(e.seconds));
            } else if (e.weapon === 'rifle') {
              playCarbineShot();
              playCarbineLever(leverTimes(e.seconds)); // cla-CLACK, timed on the animation (the event says how long)
            } else if (e.weapon === 'dynamite') playDynamiteLaunch(drumTimes(e.seconds)); // the drum's CLACK on the animation
            else playShot();
            camera.getWorldDirection(forward);
            flash.position.copy(camera.position).addScaledVector(forward, 0.8);
            flashTime = FLASH_DURATION;
            flashPeak = e.weapon === 'shotgun' ? SHOTGUN_FLASH_INTENSITY : FLASH_INTENSITY;
            for (const f of fx.onShot) f(e.weapon, e.barrel, e.forged);
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
            // Each gun is drawn its own way (render/weapons/*View.ts): its
            // signature sound lands when the gun is ready to fire.
            if (e.weapon === 'shotgun' && e.forged) playPumpDraw(pumpDrawTimes());
            else if (e.weapon === 'shotgun') playShotgunDraw(shotgunDrawTimes());
            else if (e.weapon === 'revolver') playRevolverDraw(revolverDrawTimes(), e.forged);
            else playCarbineDraw(rifleDrawTimes());
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
            if (e.kind !== 'lastShot') break; // the dynamite's big blast: explosions.ts
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
            if (e.tool === 'shovel') playShovelSwing(tuning.shovelWindup);
            else playKickSwing();
            for (const f of fx.onKick) f(e.tool);
            break;
          case 'kickLand':
            if (e.hits === 0) break;
            if (e.tool === 'kick') {
              playKickImpact(e.hits);
              break;
            }
            // The shovel: BONK, sparks off the blade and blood where it lands, and the whole game stops for an instant.
            playShovelBonk(e.hits);
            for (const c of e.at) {
              point.set(c.x, c.y, c.z);
              // Toward you: the blood and the sparks fly back off the face of the blade.
              normal.set(camera.position.x - c.x, 0, camera.position.z - c.z).normalize();
              normal.y = 0.6;
              spawnSparks(point, normal, SHOVEL_SPARKS);
              if (c.flesh) spawnBlood(point, normal, SHOVEL_BLOOD);
            }
            requestHitStop(hitStopSettings.shovel + hitStopSettings.perExtraHit * (e.hits - 1));
            break;
          case 'dryFire':
            playDryFire();
            break;
          case 'reloadStart':
            if (e.weapon === 'shotgun' && e.forged) playPumpReloadStart(pumpReloadTimes()); // flung up: a rush of air
            else if (e.weapon === 'shotgun') playShotgunReload(e.seconds);
            else if (e.weapon === 'rifle') playCarbineReloadStart();
            else if (e.weapon === 'dynamite') playDynamiteReload(e.seconds);
            else if (e.forged) playAkimboSpin(spinTurnTimes(e.seconds), e.seconds);
            else playReload(e.seconds);
            for (const f of fx.onReload) f(e.weapon, e.seconds, e.forged);
            break;
          case 'reloadRound':
            // (Only the pump-action's shells are slapped in; the carbine's and the slide reload's click in.)
            if (e.weapon === 'shotgun') playPumpShellIn();
            else playCarbineRoundIn();
            break;
          case 'reloadEnd':
            if (e.weapon === 'shotgun' && e.forged) playPumpClose(pumpCloseTimes()); // the closing rack, ch-CHK
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
