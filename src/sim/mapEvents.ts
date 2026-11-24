// Map events (docs/DESIGN.md §5, "Eventi sulla mappa"): every 4-5 waves, at
// the start of a wave, an optional challenge shows up somewhere on the map.
// Complete it and you earn fiches, to spend on the barman's drinks (the pacts).
//
// This file is the SKELETON shared by every event: WHEN one appears, its
// lifecycle (active → success or failure) and the events it reports. What
// each event asks you to do (ring the bells, kill the jackal...) will plug in
// here later; for now an event just lasts until the end of its wave and fails
// (or a debug button completes it).
//
// It's a small STATE MACHINE, the same idea as the enemies' AI:
//
//   no event ──(wave starts, it's time)──▶ active ──(objective done)──▶ success
//                                            └──(wave ends first)────▶ failure
//
// and back to "no event" right away, with the next one scheduled.
//
// It doesn't touch the wave system: it LISTENS to the waveStart/waveEnd events
// that waves.ts already reports (the same trick as the dynamite: the weapon
// only says "fire", game.ts creates the stick). waves.ts doesn't even know
// map events exist.
import { tuning } from './config';
import type { SimEvent } from './events';
import { randomInt, type RandomState } from './random';
import { isSmithWave } from './waves';

/**
 * Which event. One for now (the first one we'll build, docs/DESIGN.md);
 * adding one = a new id here, plus its objective.
 */
export type MapEventKind = 'bells';

/** The event being played right now. */
export interface ActiveMapEvent {
  kind: MapEventKind;
  /** The wave it showed up in (it ends with it). */
  wave: number;
}

export interface MapEventState {
  /** First wave the next event may show up in (a Smith wave pushes it one later). */
  nextWave: number;
  /** The event being played, or null. Plain data: serializable like the rest of the GameState. */
  active: ActiveMapEvent | null;
  /** Debug: the objective counts as done on the next tick (button in the debug panel). */
  forceSuccess: boolean;
}

/**
 * How many waves until the next event: between tuning.mapEventGapMin and
 * mapEventGapMax, both included ("every 4-5 waves" = 4 or 5, 50/50).
 * From the game's SEEDED generator, not Math.random(): ?seed=123 replays the
 * events too, and one day a server can replay a whole game and get the same.
 */
function rollGap(rng: RandomState): number {
  const min = Math.min(tuning.mapEventGapMin, tuning.mapEventGapMax);
  const max = Math.max(tuning.mapEventGapMin, tuning.mapEventGapMax);
  return min + randomInt(rng, max - min + 1); // randomInt(n) is 0..n-1: +1 includes max
}

/** At the start of a game: the first event comes after one gap, like every other one. */
export function createMapEventState(rng: RandomState): MapEventState {
  return { nextWave: rollGap(rng), active: null, forceSuccess: false };
}

/** Which event to play. Only one exists for now; then a weighted pick, like the waves' roster. */
function pickKind(_rng: RandomState): MapEventKind {
  return 'bells';
}

/**
 * One tick of the map events. Reads this tick's events (from `firstEvent`
 * on: `events` may hold earlier ticks of the same frame) and pushes its own.
 * Called by stepGame after stepWaves, so it sees this tick's waveStart/waveEnd.
 */
export function stepMapEvents(
  state: MapEventState,
  rng: RandomState,
  events: SimEvent[],
  firstEvent: number,
): void {
  // Success first: an objective completed in the last instant of the wave counts.
  if (state.active && state.forceSuccess) finish(state, rng, events, true);
  state.forceSuccess = false;

  // Copy the end: we push while reading, and our own events don't concern us.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type === 'waveEnd' && state.active) {
      // The wave is over and the objective isn't done: failed.
      finish(state, rng, events, false);
    } else if (e.type === 'waveStart') {
      // Never two at once (a debug jump to another wave skips the waveEnd).
      if (state.active) finish(state, rng, events, false);
      // ">=" and not "===": a Smith wave just leaves it pending, so it shows
      // up in the next one (and a debug jump past it doesn't lose it).
      if (e.wave >= state.nextWave && !isSmithWave(e.wave)) start(state, rng, events, e.wave);
    }
  }
}

function start(state: MapEventState, rng: RandomState, events: SimEvent[], wave: number): void {
  const kind = pickKind(rng);
  state.active = { kind, wave };
  events.push({ type: 'mapEventStart', kind, wave });
}

/**
 * The event is over, either way. The next one is scheduled from the wave this
 * one was in: in wave 5 → the next in wave 9 or 10.
 */
function finish(state: MapEventState, rng: RandomState, events: SimEvent[], success: boolean): void {
  const ended = state.active!;
  state.active = null;
  state.nextWave = ended.wave + rollGap(rng);
  events.push({ type: 'mapEventEnd', kind: ended.kind, success });
}

/** Debug: the next wave has an event (if it's not a Smith wave: then the one after). */
export function forceMapEventNextWave(state: MapEventState, currentWave: number): void {
  state.nextWave = currentWave + 1;
}
