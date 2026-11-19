// HUD: health bar, red flash when you get hit, red vignette when low on
// health, wave number, score, wave banners and the death summary.
// Plain HTML/CSS elements (see index.html), updated from here.
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { playBell, playPlayerHurt } from '../audio/sfx';
import type { GameState } from '../sim/game';

const healthFill = document.getElementById('health-fill')!;
const damage = document.getElementById('damage')!;
const death = document.getElementById('death')!;
const deathStats = document.getElementById('death-stats')!;
const waveHud = document.getElementById('wave')!;
const scoreHud = document.getElementById('score')!;
const banner = document.getElementById('banner')!;
let bannerTime = 0;

function showBanner(text: string, seconds: number): void {
  banner.textContent = text;
  bannerTime = seconds;
}

let flash = 0; // 0..1, the red flash after a hit
let deathTime = 0; // seconds left of the death message

export function updateHud(game: GameState, events: SimEvent[], dt: number): void {
  const player: PlayerState = game.player;
  for (const e of events) {
    if (e.type === 'playerHurt') {
      flash = 1;
      playPlayerHurt();
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
  }

  // Wave number and score, always visible. During the break: a countdown.
  const w = game.wave;
  waveHud.textContent = w.number > 0 ? String(w.number) : '';
  scoreHud.textContent = `${game.stats.score} pt · ${game.stats.kills} ☠`;
  if (w.phase === 'break' && w.number > 0 && w.breakTicks < 60 * 5 && bannerTime <= 0) {
    banner.textContent = `ondata ${w.number + 1} tra ${Math.ceil(w.breakTicks / 60)}`;
    banner.style.opacity = '0.8';
  } else {
    bannerTime = Math.max(0, bannerTime - dt);
    banner.style.opacity = String(Math.min(1, bannerTime));
  }

  const health = player.health / tuning.playerMaxHealth;
  healthFill.style.width = `${health * 100}%`;

  // Red vignette: a flash on each hit, plus a constant glow when below 40%.
  flash = Math.max(0, flash - dt * 3);
  const lowHealth = Math.max(0, (0.4 - health) / 0.4) * 0.6;
  damage.style.opacity = String(Math.min(1, Math.max(flash, lowHealth)));

  deathTime = Math.max(0, deathTime - dt);
  death.style.opacity = String(Math.min(1, deathTime));
  deathStats.style.opacity = death.style.opacity;
}
