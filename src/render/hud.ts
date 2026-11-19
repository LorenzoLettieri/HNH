// HUD: health plate (healthPlate.ts), red flash, direction arc (damageIndicator.ts)
// and head snap (cameraFeel.ts) when you get hit, low health (lowHealth.ts),
// wave number, score, wave banners, the style meter (styleMeter.ts)
// and the death summary.
// Plain HTML/CSS elements (see index.html), updated from here.
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { playBell, playPickup, playPlayerHurt } from '../audio/sfx';
import type { GameState } from '../sim/game';
import { updateStyleMeter } from './styleMeter';
import { updateHighNoon } from './highNoon';
import { updateHealthPlate } from './healthPlate';
import { updateLowHealth } from './lowHealth';
import { addHurtArc, screenAngle, updateHurtArcs } from './damageIndicator';
import { hurtKick } from './cameraFeel';

const damage = document.getElementById('damage')!;
const pickupFlash = document.getElementById('pickup-flash')!;
const death = document.getElementById('death')!;
const deathStats = document.getElementById('death-stats')!;
const waveHud = document.getElementById('wave')!;
const waveBox = document.getElementById('wave-box')!;
const scoreHud = document.getElementById('score')!;
const killsHud = document.getElementById('kills')!;
const banner = document.getElementById('banner')!;
let bannerTime = 0;

function showBanner(text: string, seconds: number): void {
  banner.textContent = text;
  bannerTime = seconds;
}

let flash = 0; // 0..1, the red flash after a hit
/** Damage of a "full strength" hit, for sounds and flash. */
const HARD_HIT = 40;
/** How far (% of the screen) the red flash's center moves away from the hit. */
const FLASH_SHIFT = 30;
/** How fast the red flash fades (per second). */
const FLASH_FADE = 2;
/** Screen tint for each pickup: same colors as their glow (render/pickups.ts). */
const PICKUP_TINTS = { bullets: 'rgb(255, 200, 70)', shells: 'rgb(255, 90, 40)', medkit: 'rgb(70, 255, 100)' };
let pickupTime = 0; // 0..1, the short flash when you collect something
let deathTime = 0; // seconds left of the death message

export function updateHud(game: GameState, events: SimEvent[], dt: number): void {
  const player: PlayerState = game.player;
  for (const e of events) {
    if (e.type === 'playerHurt') {
      // How hard: 0..1 (a hound bite 0.4, a ghoul claw 0.5, a bull charge 1).
      const strength = Math.min(1, e.damage / HARD_HIT);
      const angle = screenAngle(player, e.fromX, e.fromZ);
      playPlayerHurt(strength);
      // Where it came from: an arc around the crosshair, the head snapping away...
      addHurtArc(e.fromX, e.fromZ, e.damage);
      hurtKick(angle, e.damage);
      // ...and the red flash thicker on the hit's side: the center of the
      // vignette's gradient moves AWAY from the hit (CSS variables in index.html).
      flash = Math.max(flash, 0.6 + 0.4 * strength);
      damage.style.setProperty('--hx', `${Math.sin(angle) * FLASH_SHIFT}%`);
      damage.style.setProperty('--hy', `${Math.cos(angle) * FLASH_SHIFT}%`);
    }
    if (e.type === 'pickup') {
      // Doom's "bonus flash": the whole screen tinted for a moment, in the
      // pickup's color (a CSS variable read by #pickup-flash in index.html).
      pickupTime = 1;
      pickupFlash.style.setProperty('--tint', PICKUP_TINTS[e.kind]);
      playPickup(e.kind);
    }
    if (e.type === 'playerDied') {
      deathTime = 4;
      deathStats.textContent = `Ondata ${e.wave} · ${e.kills} uccisioni · ${e.score} punti`;
    }
    if (e.type === 'waveStart') {
      // Every waveHealthStep waves the ghouls get tougher: tell the player.
      const tougher = e.wave % tuning.waveHealthStep === 0;
      showBanner(tougher ? `ONDATA ${e.wave}\nsono più resistenti: mira alla testa` : `ONDATA ${e.wave}`, tougher ? 4 : 3);
      playBell(2); // the church bell tolls: here they come
    }
    if (e.type === 'waveEnd') {
      showBanner('ONDATA SUPERATA', 2.5);
      playBell(1, 240);
    }
    // The banner says what the climax gives you; tint and sounds are in highNoon.ts.
    if (e.type === 'highNoon') showBanner('HIGH NOON\ncaricatore infinito', 2.5);
  }

  // Wave number and score, always visible. During the break: a countdown.
  const w = game.wave;
  waveBox.hidden = w.number === 0; // nothing to show before the first wave
  waveHud.textContent = String(w.number);
  scoreHud.textContent = String(game.stats.score);
  killsHud.textContent = `${game.stats.kills} UCCISIONI`;
  if (w.phase === 'break' && w.number > 0 && w.breakTicks < 60 * 5 && bannerTime <= 0) {
    banner.textContent = `ondata ${w.number + 1} tra ${Math.ceil(w.breakTicks / 60)}`;
    banner.style.opacity = '0.8';
  } else {
    bannerTime = Math.max(0, bannerTime - dt);
    banner.style.opacity = String(Math.min(1, bannerTime));
  }

  updateStyleMeter(game.style, dt);
  updateHighNoon(game.style, events, dt);

  const health = player.health / tuning.playerMaxHealth;
  updateLowHealth(health, player.health <= 0, dt); // first: it moves the heartbeat
  updateHealthPlate(player.health, dt);

  // Red vignette: a flash on each hit (low health has its own effect, lowHealth.ts).
  flash = Math.max(0, flash - dt * FLASH_FADE);
  updateHurtArcs(player, dt);
  damage.style.opacity = String(flash);

  pickupTime = Math.max(0, pickupTime - dt * 5); // gone in 0.2 s
  pickupFlash.style.opacity = String(pickupTime * 0.35);

  deathTime = Math.max(0, deathTime - dt);
  death.style.opacity = String(Math.min(1, deathTime));
  deathStats.style.opacity = death.style.opacity;
}
