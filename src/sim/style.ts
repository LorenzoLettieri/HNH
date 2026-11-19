// The style meter (see docs/DESIGN.md §2): rewards playing with flair.
//
// Style is a CHAIN, like a Tony Hawk combo:
// - every stylish action adds points AND restarts a short timer (styleChainTime);
// - if the timer runs out (a few seconds without anything stylish) the chain
//   BREAKS and the points drop to zero at once. No slow drain: either you keep
//   the chain going, or you start over.
// - taking damage costs points (more for a bigger hit), but doesn't break the chain.
// The points decide the rank: one rank every `styleRankPoints`, up to HIGH NOON.
//
// Step 1: only hits and kills give style. Movement (speed, air time, wall
// jumps), variety and the HIGH NOON climax come in the next steps.
import type { SimEvent } from './events';
import { secondsToTicks, tuning } from './config';

export interface StyleState {
  /** Points of the current chain (0 = no chain). */
  points: number;
  /** Ticks left before the chain breaks, if nothing stylish happens. 0 = no chain. */
  chainTicks: number;
}

/** The ranks, lowest first (western names: proposals, see DESIGN.md). */
export const STYLE_RANKS = [
  { letter: 'D', name: 'Dusty' },
  { letter: 'C', name: 'Cowpoke' },
  { letter: 'B', name: 'Bandit' },
  { letter: 'A', name: 'Desperado' },
  { letter: 'S', name: 'Sharpshooter' },
  { letter: 'SS', name: 'Showdown' },
  { letter: 'HN', name: 'HIGH NOON' },
] as const;

export function createStyle(): StyleState {
  return { points: 0, chainTicks: 0 };
}

/** Index in STYLE_RANKS for these points: 0 = D, the last one = HIGH NOON. */
export function styleRank(points: number): number {
  return Math.min(STYLE_RANKS.length - 1, Math.floor(points / tuning.styleRankPoints));
}

/**
 * Updates the style with what happened in this tick: `events` from index `from`
 * on (the array may also hold the events of earlier ticks of the same frame).
 */
export function stepStyle(style: StyleState, events: readonly SimEvent[], from: number): void {
  let gained = 0;
  let lost = 0;
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    // Your hits on enemies, not the steel targets (metal). (A bull's charge
    // shoves enemies without damage: it never produces 'hit' events.)
    if (e.type === 'hit' && e.surface === 'flesh') {
      gained += tuning.styleHit;
      if (e.killed) gained += tuning.styleKill + (e.headshot ? tuning.styleHeadshotKill : 0);
    } else if (e.type === 'playerHurt') {
      lost += e.damage * tuning.styleHurtPerDamage;
    }
  }

  // Something stylish: more points, and the countdown starts again from the top.
  if (gained > 0) {
    style.points += gained;
    style.chainTicks = secondsToTicks(tuning.styleChainTime);
  }
  style.points = Math.max(0, style.points - lost);

  // The countdown. When it reaches zero the chain breaks: everything is lost at once.
  if (style.chainTicks > 0) {
    style.chainTicks--;
    if (style.chainTicks === 0) style.points = 0;
  }
}
