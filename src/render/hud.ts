// HUD for the player's health: the health bar, the red flash when you get
// hit, the red vignette when you're low on health, and the death message.
// Plain HTML/CSS elements (see index.html), updated from here.
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { playPlayerHurt } from '../audio/sfx';

const healthFill = document.getElementById('health-fill')!;
const damage = document.getElementById('damage')!;
const death = document.getElementById('death')!;

let flash = 0; // 0..1, the red flash after a hit
let deathTime = 0; // seconds left of the death message

export function updateHud(player: PlayerState, events: SimEvent[], dt: number): void {
  for (const e of events) {
    if (e.type === 'playerHurt') {
      flash = 1;
      playPlayerHurt();
    }
    if (e.type === 'playerDied') deathTime = 2;
  }

  const health = player.health / tuning.playerMaxHealth;
  healthFill.style.width = `${health * 100}%`;

  // Red vignette: a flash on each hit, plus a constant glow when below 40%.
  flash = Math.max(0, flash - dt * 3);
  const lowHealth = Math.max(0, (0.4 - health) / 0.4) * 0.6;
  damage.style.opacity = String(Math.min(1, Math.max(flash, lowHealth)));

  deathTime = Math.max(0, deathTime - dt);
  death.style.opacity = String(Math.min(1, deathTime));
}
