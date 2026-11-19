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
// HIGH NOON, the top rank, is a CLIMAX, not a place to stay: reaching it starts
// a countdown (styleHighNoonTime) during which the guns never run dry
// (weapon.ts, "bottomless"). Meanwhile the style is frozen at the top: no
// gains, no losses, the chain doesn't run out. When the countdown ends, the
// style starts over from zero: HIGH NOON is something to chase again.
//
// The style also MULTIPLIES what you earn (styleMultiplier): score and
// vildenaro. Who moves well gets richer, and stronger, sooner: a snowball
// effect, on purpose (DESIGN.md, "movement as power").
//
// For now only hits and kills give style. Movement (speed, air time, wall
// jumps) and variety come in the next steps.
import type { SimEvent } from './events';
import { secondsToTicks, tuning } from './config';

export interface StyleState {
  /** Points of the current chain (0 = no chain). */
  points: number;
  /** Ticks left before the chain breaks, if nothing stylish happens. 0 = no chain. */
  chainTicks: number;
  /** Ticks left of the HIGH NOON climax. 0 = not in progress. */
  highNoonTicks: number;
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
  return { points: 0, chainTicks: 0, highNoonTicks: 0 };
}

/** Index in STYLE_RANKS for these points: 0 = D, the last one = HIGH NOON. */
export function styleRank(points: number): number {
  return Math.min(STYLE_RANKS.length - 1, Math.floor(points / tuning.styleRankPoints));
}

/** The multiplier of a rank: ×1 at D, then + styleMultiplierPerRank for every rank up. */
export function rankMultiplier(rank: number): number {
  return 1 + rank * tuning.styleMultiplierPerRank;
}

/**
 * How much the style multiplies score and vildenaro RIGHT NOW. No chain = ×1
 * (the points are 0, so the rank is D anyway). During HIGH NOON the points
 * are frozen at the top: the maximum multiplier for the whole climax.
 */
export function styleMultiplier(style: StyleState): number {
  return rankMultiplier(isHighNoon(style) ? STYLE_RANKS.length - 1 : styleRank(style.points));
}

/** Is the HIGH NOON climax in progress? (The guns never run dry.) */
export function isHighNoon(style: StyleState): boolean {
  return style.highNoonTicks > 0;
}

/**
 * Updates the style with what happened in this tick: `events` from index `from`
 * on (the array may also hold the events of earlier ticks of the same frame).
 * Appends 'highNoon' / 'highNoonEnd' when the climax starts / ends.
 */
export function stepStyle(style: StyleState, events: SimEvent[], from: number): void {
  // HIGH NOON in progress: everything else is frozen, only the climax runs out.
  if (style.highNoonTicks > 0) {
    style.highNoonTicks--;
    if (style.highNoonTicks === 0) {
      // Over: back to zero, with no chain (the meter fades out, the next hit starts from D).
      style.points = 0;
      style.chainTicks = 0;
      events.push({ type: 'highNoonEnd' });
    }
    return;
  }

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

  // Reached the top rank: HIGH NOON! (Points above zero mean the chain is
  // still going: when it breaks they drop to zero, right above.)
  if (styleRank(style.points) === STYLE_RANKS.length - 1) {
    style.highNoonTicks = secondsToTicks(tuning.styleHighNoonTime);
    events.push({ type: 'highNoon' });
  }
}
