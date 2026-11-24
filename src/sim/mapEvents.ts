// Map events (docs/DESIGN.md §5, "Eventi sulla mappa"): every 4-5 waves, at
// the start of a wave, an optional challenge shows up somewhere on the map.
// Complete it and you earn fiches (player.fiches), to spend on the barman's drinks (the pacts).
//
// This file is the SKELETON shared by every event: WHEN one appears, its
// lifecycle (active → success or failure), the prize and the events it
// reports. What each event asks you to do lives in its own file (bells.ts):
// a create function and a step function that says "running / success /
// failure". If the wave ends first, the event fails.
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
import { hasDrink, maxHealth } from './drinks';
import { tuning } from './config';
import type { SimEvent } from './events';
import type { GameState } from './game';
import { randomInt, type RandomState } from './random';
import { isSmithWave } from './waves';
import type { World } from './world';
import { createBellsEvent, stepBells, type BellsEvent } from './bells';

/**
 * Which event. One for now (the first one we built, docs/DESIGN.md); adding
 * one = its file (like bells.ts), its type in ActiveMapEvent, its id here.
 */
export type MapEventKind = ActiveMapEvent['kind'];

/**
 * The event being played right now. A DISCRIMINATED UNION (one type per
 * kind, told apart by `kind`), like the SimEvents: each event has its own
 * fields (the bells' list, the jackal's position...) and TypeScript knows
 * which ones after a check on `kind`. Every kind has `kind` and `wave` (the
 * wave it showed up in: it ends with it).
 */
export type ActiveMapEvent = BellsEvent;

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

/**
 * A new event of some kind, or null if this level can't host it (no bell
 * spots...). Only one kind exists for now; with more, a weighted pick like
 * the waves' roster, trying another kind when one can't be built.
 */
function createEvent(world: World, rng: RandomState, wave: number): ActiveMapEvent | null {
  return createBellsEvent(world, rng, wave);
}

/**
 * One tick of the map events. Reads this tick's events (from `firstEvent`
 * on: `events` may hold earlier ticks of the same frame) and pushes its own.
 * Called by stepGame after stepWaves, so it sees this tick's waveStart/waveEnd
 * (and the shots and blasts of the tick, for the objectives).
 */
export function stepMapEvents(game: GameState, world: World, events: SimEvent[], firstEvent: number): void {
  const state = game.mapEvent;
  // The objective first: completed in the last instant of the wave, it counts.
  const active = state.active;
  if (active) {
    // Each kind has its own step; it says whether it's done.
    const result = state.forceSuccess ? 'success' : stepBells(active, world, game.player, events, firstEvent);
    if (result !== 'running') finish(game, events, result === 'success');
  }
  state.forceSuccess = false;

  // Copy the end: we push while reading, and our own events don't concern us.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type === 'waveEnd' && state.active) {
      // The wave is over and the objective isn't done: failed.
      finish(game, events, false);
    } else if (e.type === 'waveStart') {
      // Never two at once (a debug jump to another wave skips the waveEnd).
      if (state.active) finish(game, events, false);
      // ">=" and not "===": a Smith wave just leaves it pending, so it shows
      // up in the next one (and a debug jump past it doesn't lose it).
      if (e.wave >= state.nextWave && !isSmithWave(e.wave)) start(game, world, events, e.wave);
    }
  }
}

function start(game: GameState, world: World, events: SimEvent[], wave: number): void {
  const ev = createEvent(world, game, wave);
  // This level can't host it: try again after another gap.
  if (!ev) {
    game.mapEvent.nextWave = wave + rollGap(game);
    return;
  }
  game.mapEvent.active = ev;
  events.push({ type: 'mapEventStart', kind: ev.kind, wave });
}

/**
 * The event is over, either way. The next one is scheduled from the wave this
 * one was in: in wave 5 → the next in wave 9 or 10.
 */
function finish(game: GameState, events: SimEvent[], success: boolean): void {
  const state = game.mapEvent;
  const ended = state.active!;
  state.active = null;
  state.nextWave = ended.wave + rollGap(game);
  // The prize: fiches straight into your pocket (no pickup to run to: the
  // event already made you run). Failing gives nothing here; an event that
  // leaves something anyway (the jackal's coins) does it on its own.
  // Drink "Mano del baro": double the fiches when you win, max health when you lose.
  const sharp = hasDrink(game.player, 'cardSharp');
  const fiches = success ? tuning.mapEventFiches * (sharp ? tuning.cardSharpFichesScale : 1) : 0;
  game.player.fiches += fiches;
  if (!success && sharp) {
    game.player.cardSharpPenalty += tuning.cardSharpHealthCost;
    game.player.health = Math.min(game.player.health, maxHealth(game.player));
  }
  events.push({ type: 'mapEventEnd', kind: ended.kind, success, fiches });
}

/** Debug: the next wave has an event (if it's not a Smith wave: then the one after). */
export function forceMapEventNextWave(state: MapEventState, currentWave: number): void {
  state.nextWave = currentWave + 1;
}
