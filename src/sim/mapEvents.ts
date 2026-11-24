// Map events (docs/DESIGN.md §5, "Eventi sulla mappa"): every 4-5 waves, at
// the start of a wave, an optional challenge shows up somewhere on the map.
// Complete it and you earn fiches (player.fiches), to spend on the barman's drinks (the pacts).
//
// This file is the SKELETON shared by every event: WHEN one appears, its
// lifecycle (active → success or failure), the prize and the events it
// reports. What each event asks you to do lives in its own file (bells.ts, ponyExpress.ts, wager.ts, emberHeart.ts, jackal.ts):
// a create function and a step function that says "running / success /
// failure". If the wave ends first, the event fails. One exception: the
// devil's wager (wager.ts) spans two waves (the bet, then the cursed wave),
// so it reads the wave events itself and the skeleton leaves them to it.
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
import { createPonyExpressEvent, stepPonyExpress, type PonyExpressEvent } from './ponyExpress';
import { createWagerEvent, stepWager, type WagerEvent } from './wager';
import { createEmberHeartEvent, stepEmberHeart, type EmberHeartEvent } from './emberHeart';
import { createJackalEvent, jackalEscapes, stepJackalEvent, type JackalEvent } from './jackal';
import type { InputCommand } from './command';

/**
 * Which event. Adding one = its file (like bells.ts), its type in
 * ActiveMapEvent, its create function in CREATORS and its step in stepEvent.
 */
export type MapEventKind = ActiveMapEvent['kind'];

/**
 * The event being played right now. A DISCRIMINATED UNION (one type per
 * kind, told apart by `kind`), like the SimEvents: each event has its own
 * fields (the bells' list, the jackal's position...) and TypeScript knows
 * which ones after a check on `kind`. Every kind has `kind` and `wave` (the
 * wave it showed up in: it ends with it).
 */
export type ActiveMapEvent = BellsEvent | PonyExpressEvent | WagerEvent | EmberHeartEvent | JackalEvent;

/**
 * How to build each kind. A Record over every MapEventKind: a kind with no
 * creator is a compile error. The order is also the order the picker tries
 * them in (after shuffling). They get the whole GameState: most only need its
 * random generator (the GameState IS one: it has the rng field), the jackal
 * also puts itself in the world. A creator that takes a RandomState fits
 * here anyway: a GameState is a RandomState and more.
 */
const CREATORS: Record<MapEventKind, (world: World, game: GameState, wave: number) => ActiveMapEvent | null> = {
  bells: createBellsEvent,
  ponyExpress: createPonyExpressEvent,
  wager: createWagerEvent,
  emberHeart: createEmberHeartEvent,
  jackal: createJackalEvent,
};
const KINDS = Object.keys(CREATORS) as MapEventKind[];

export interface MapEventState {
  /** First wave the next event may show up in (a Smith wave pushes it one later). */
  nextWave: number;
  /** The event being played, or null. Plain data: serializable like the rest of the GameState. */
  active: ActiveMapEvent | null;
  /** Debug: the objective counts as done on the next tick (button in the debug panel). */
  forceSuccess: boolean;
  /** The kind of the last event: the next one is a different kind, if the level can host another. */
  lastKind: MapEventKind | null;
  /** Debug: the next event is of this kind (buttons in the debug panel). Null = random. */
  forceKind: MapEventKind | null;
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
  return { nextWave: rollGap(rng), active: null, forceSuccess: false, lastKind: null, forceKind: null };
}

/**
 * A new event, or null if this level can't host any (no bell spots, no
 * graph...). Which kind: at random, but never the same as the last one
 * (two Pony Express in a row is less fun than one of each). How: the kinds
 * in random order (a Fisher-Yates shuffle with the seeded generator), the
 * last one moved to the end, and the first one that can be built wins: a
 * level with no bell spots just never gets the bells, without a special case.
 */
function createEvent(state: MapEventState, world: World, game: GameState, wave: number): ActiveMapEvent | null {
  const order = [...KINDS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(game, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.sort((a, b) => Number(a === state.lastKind) - Number(b === state.lastKind)); // stable: only the last kind moves
  if (state.forceKind) order.unshift(state.forceKind);
  state.forceKind = null;
  for (const kind of order) {
    const ev = CREATORS[kind](world, game, wave);
    if (ev) return ev;
  }
  return null;
}

/**
 * How an event's tick went. 'declined' = over without being played (a bet
 * nobody took): no prize, and not a failure either.
 */
type EventResult = 'running' | 'success' | 'failure' | 'declined';

/** One tick of the event being played: each kind has its own step, and says whether it's done. */
function stepEvent(ev: ActiveMapEvent, game: GameState, world: World, cmd: InputCommand, events: SimEvent[], firstEvent: number): EventResult {
  // The `switch` on `kind` NARROWS the type: inside each case TypeScript
  // knows which event it is (and which fields it has).
  switch (ev.kind) {
    case 'bells':
      return stepBells(ev, world, game.player, events, firstEvent);
    case 'ponyExpress':
      return stepPonyExpress(ev, game.player, events);
    case 'wager':
      return stepWager(ev, game.player, cmd, events, firstEvent);
    case 'emberHeart':
      return stepEmberHeart(ev, game, world, events, firstEvent);
    case 'jackal':
      return stepJackalEvent(ev, game, events, firstEvent);
  }
}

/**
 * One tick of the map events. Reads this tick's events (from `firstEvent`
 * on: `events` may hold earlier ticks of the same frame) and pushes its own.
 * Called by stepGame after stepWaves, so it sees this tick's waveStart/waveEnd
 * (and the shots and blasts of the tick, for the objectives).
 */
export function stepMapEvents(game: GameState, world: World, cmd: InputCommand, events: SimEvent[], firstEvent: number): void {
  const state = game.mapEvent;
  // The objective first: completed in the last instant of the wave, it counts.
  const active = state.active;
  if (active) {
    const result = state.forceSuccess ? 'success' : stepEvent(active, game, world, cmd, events, firstEvent);
    if (result !== 'running') finish(game, events, result);
  }
  state.forceSuccess = false;

  // Copy the end: we push while reading, and our own events don't concern us.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    // The wager handles the waves itself (it has already seen them, in stepEvent above).
    const ownsWaves = state.active?.kind === 'wager';
    if (e.type === 'waveEnd' && state.active && !ownsWaves) {
      // The wave is over and the objective isn't done: failed.
      finish(game, events, 'failure');
    } else if (e.type === 'waveStart') {
      // Never two at once (a debug jump to another wave skips the waveEnd).
      if (state.active && !ownsWaves) finish(game, events, 'failure');
      // ">=" and not "===": a Smith wave just leaves it pending, so it shows
      // up in the next one (and a debug jump past it doesn't lose it).
      if (!state.active && e.wave >= state.nextWave && !isSmithWave(e.wave)) start(game, world, events, e.wave);
    }
  }
}

function start(game: GameState, world: World, events: SimEvent[], wave: number): void {
  const ev = createEvent(game.mapEvent, world, game, wave);
  // This level can't host it: try again after another gap.
  if (!ev) {
    game.mapEvent.nextWave = wave + rollGap(game);
    return;
  }
  game.mapEvent.active = ev;
  game.mapEvent.lastKind = ev.kind;
  events.push({ type: 'mapEventStart', kind: ev.kind, wave });
}

/**
 * The event is over, either way. The next one is scheduled from the wave this
 * one was in: in wave 5 → the next in wave 9 or 10.
 */
function finish(game: GameState, events: SimEvent[], result: Exclude<EventResult, 'running'>): void {
  const state = game.mapEvent;
  const ended = state.active!;
  state.active = null;
  state.nextWave = ended.wave + rollGap(game);
  game.player.curse = null; // the wager's curse never outlives its event (the debug "complete" button too)
  if (ended.kind === 'jackal') jackalEscapes(ended, game, events); // not dead: it gets away with the rest of its sack
  const success = result === 'success';
  const declined = result === 'declined';
  // The prize: fiches straight into your pocket (no pickup to run to: the
  // event already made you run). Failing gives nothing here; an event that
  // leaves something anyway (the jackal's coins) does it on its own.
  // Drink "Mano del baro": double the fiches when you win, max health when you lose.
  const sharp = hasDrink(game.player, 'cardSharp');
  const prize = ended.kind === 'wager' ? tuning.wagerFiches : tuning.mapEventFiches;
  const fiches = success ? prize * (sharp ? tuning.cardSharpFichesScale : 1) : 0;
  game.player.fiches += fiches;
  if (!success && !declined && sharp) {
    game.player.cardSharpPenalty += tuning.cardSharpHealthCost;
    game.player.health = Math.min(game.player.health, maxHealth(game.player));
  }
  events.push({ type: 'mapEventEnd', kind: ended.kind, success, declined, fiches });
}

/** Debug: the next wave has an event (if it's not a Smith wave: then the one after), of this kind if given. */
export function forceMapEventNextWave(state: MapEventState, currentWave: number, kind: MapEventKind | null = null): void {
  state.nextWave = currentWave + 1;
  state.forceKind = kind;
}
