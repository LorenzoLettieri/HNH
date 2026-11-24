// "La Scommessa del Diavolo", the third map event (docs/DESIGN.md §5).
// The only RISK event: nothing to run to and back. When it shows up, a
// gambling table appears in the town square, with the stake already on it:
// a CURSE. Walk up to it and press E (the shop's key) and you've taken the
// bet: the NEXT wave is played with that curse on you. Survive it and you
// win the fiches. Don't go to the table and nothing happens: when the next
// wave starts the table is gone, no prize and no penalty (declining a bet
// isn't losing it: the "Mano del baro" drink doesn't charge you for it).
//
// Unlike the other events it lives across TWO waves, so it's a state
// machine of its own inside the skeleton's one:
//
//   offered ──(E at the table)──▶ accepted ──(next wave starts)──▶ cursed ──(that wave ends)──▶ success
//      └──(next wave starts first)──▶ declined                         └──(you die)────────────▶ (game over)
//
// The curse is a field on the PLAYER (player.curse), not on the event: the
// code that applies it (pickups.ts, weapon.ts) asks the player "what are you
// suffering?", the same way it asks hasDrink, and never needs to know about
// map events. Here we only switch it on and off.
import type { InputCommand } from './command';
import type { ActiveMapEvent } from './mapEvents';
import { tuning } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { randomInt, type RandomState } from './random';
import type { World } from './world';

/**
 * The curses the devil can put on the table. One per bet, drawn at random.
 * - noMedkits: no medkits drop, and the ones already on the ground don't heal.
 * - oneGun: you're stuck with the gun in your hands when the wave starts.
 * - fastEnemies: the enemies' time runs faster (game.ts, wagerFastEnemiesScale).
 * - darkness: night falls on the town, the fog closes in, the map (Tab)
 *   doesn't show the enemies. Only the RENDERER reads it (render/darkness.ts):
 *   it's still in the simulation, because it's part of the game's state and
 *   one day the server decides it.
 * Adding one = an id here, its effect where it applies (with hasCurse), its
 * text in WAGER_CURSE_TEXT (render/mapEventText.ts) and its card on the
 * table (render/wagerTable.ts).
 */
export type WagerCurse = 'noMedkits' | 'oneGun' | 'fastEnemies' | 'darkness';
export const CURSES: WagerCurse[] = ['noMedkits', 'oneGun', 'fastEnemies', 'darkness'];

/** The bet while it's being played: plain data, inside the GameState. */
export interface WagerEvent {
  kind: 'wager';
  /**
   * The wave it belongs to. While offered: the wave the table showed up in.
   * Once the cursed wave starts: that wave (the event ends with it).
   */
  wave: number;
  phase: 'offered' | 'accepted' | 'cursed';
  /** The stake on the table: the curse you'll play the next wave with. */
  curse: WagerCurse;
  /** Where the table stands (feet level), from world.wagerTable. */
  x: number;
  y: number;
  z: number;
}

/** Is this curse on you right now? (Like hasDrink: the rest of the code asks this.) */
export function hasCurse(p: PlayerState, curse: WagerCurse): boolean {
  return p.curse === curse;
}

/** A new bet, or null if the level has no spot for the table. */
export function createWagerEvent(world: World, rng: RandomState, wave: number): WagerEvent | null {
  const t = world.wagerTable;
  if (!t) return null;
  return { kind: 'wager', wave, phase: 'offered', curse: CURSES[randomInt(rng, CURSES.length)], x: t.x, y: t.y, z: t.z };
}

/**
 * Close enough to the table to bet? The same reach as the shops (horizontal
 * distance, same floor). Used by the simulation to accept the bet and by the
 * page to show "E · SCOMMETTI".
 */
export function wagerInReach(ev: ActiveMapEvent | null, p: PlayerState): boolean {
  if (!ev || ev.kind !== 'wager' || ev.phase !== 'offered') return false;
  const near = Math.hypot(p.x - ev.x, p.z - ev.z) < tuning.shopReach;
  return near && Math.abs(p.y - ev.y) < tuning.shopReachHeight;
}

/**
 * One tick of the bet. Unlike the other events it reads the waves' own
 * events (from `firstEvent` on), because it spans two of them:
 * - offered: E at the table → accepted. A wave starting first → declined.
 * - accepted: the next wave starts → the curse goes on you, phase cursed.
 * - cursed: the wave ends → success, the curse comes off. A wave starting
 *   without the end (a debug jump) → failure.
 * 'declined' = it's over, with no prize and no penalty (mapEvents.ts).
 */
export function stepWager(
  ev: WagerEvent,
  p: PlayerState,
  cmd: InputCommand,
  events: SimEvent[],
  firstEvent: number,
): 'running' | 'success' | 'failure' | 'declined' {
  if (ev.phase === 'offered' && cmd.wager && wagerInReach(ev, p)) {
    ev.phase = 'accepted';
    events.push({ type: 'wagerAccepted', curse: ev.curse });
  }
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type === 'waveStart') {
      if (ev.phase === 'offered') return 'declined';
      if (ev.phase === 'cursed') {
        p.curse = null;
        return 'failure';
      }
      // accepted: this is the wave you bet on.
      ev.phase = 'cursed';
      ev.wave = e.wave;
      p.curse = ev.curse;
      events.push({ type: 'wagerCurse', curse: ev.curse, wave: e.wave });
    } else if (e.type === 'waveEnd' && ev.phase === 'cursed') {
      p.curse = null;
      return 'success';
    }
  }
  return 'running';
}

