// The statistics of a game, for the end-of-game screen (CoD Zombies style).
//
// Counted in the simulation, from the events of each tick: the same events
// the renderer turns into sounds and effects. Nothing new has to report to
// the stats, they just listen. In the simulation and not in the HUD because
// one day the server will keep them (and a leaderboard can't trust the client).
import type { SimEvent } from './events';
import { isHighNoon, styleRank, STYLE_RANKS, type StyleState } from './style';

export interface Stats {
  /** Points (scoreHits in waves.ts). */
  score: number;
  kills: number;
  /** Hits in the head (or in the eye-bat's pupil), kills or not. */
  headshots: number;
  /** Trigger pulls (one per shotgun blast, not per pellet). */
  shots: number;
  /** Trigger pulls that hit at least one enemy: accuracy = shotsHit / shots. */
  shotsHit: number;
  /** Best style rank reached, index in STYLE_RANKS (HIGH NOON = the last one). */
  bestRank: number;
  /** How many times you reached HIGH NOON. */
  highNoons: number;
  /** Vildenaro picked up in the whole game (spent or not). */
  moneyEarned: number;
  /** How long the game lasted, ticks. */
  ticks: number;
}

export function createStats(): Stats {
  return { score: 0, kills: 0, headshots: 0, shots: 0, shotsHit: 0, bestRank: 0, highNoons: 0, moneyEarned: 0, ticks: 0 };
}

/**
 * One tick of counting. `events` = everything that happened this tick
 * (kills and points are counted by scoreHits, money in pickups.ts).
 */
export function countStats(stats: Stats, events: SimEvent[], style: StyleState): void {
  stats.ticks++;
  let fired = 0;
  let hitSomething = false;
  for (const e of events) {
    if (e.type === 'fire') fired++;
    if (e.type === 'highNoon') stats.highNoons++;
    if (e.type !== 'hit' || e.surface !== 'flesh') continue;
    if (e.headshot) stats.headshots++;
    // Only gun hits count for accuracy (the boot and the shovel aren't "shots").
    if (e.source !== 'kick' && e.source !== 'shovel' && e.source !== 'lasso') hitSomething = true;
  }
  stats.shots += fired;
  // A trigger pull and its hits happen in the same tick (hitscan). Almost
  // never two pulls in one tick (fanning is 5 ticks apart), so one tick
  // with a hit = one pull that hit.
  if (fired > 0 && hitSomething) stats.shotsHit++;
  const rank = isHighNoon(style) ? STYLE_RANKS.length - 1 : styleRank(style.points);
  stats.bestRank = Math.max(stats.bestRank, rank);
}
