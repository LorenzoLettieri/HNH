// "Le Campane del Giudizio", the first map event (docs/DESIGN.md §5).
// A few bells hang on the rooftops, far apart. Ring the first one and a timer
// starts: ring the others IN ORDER before it runs out. A bell rings when a
// bullet or a pellet passes close to it, when a blast reaches it, or when you
// touch it (run into it, kick it). Parkour across the roofs with the horde
// behind you: an event that makes you move, never one that makes you camp.
//
// The bells are NOT entities: they don't block bullets, enemies ignore them.
// They're points in the level (world.bellSpots) plus a few numbers here.
// To know if a shot "touched" a bell we don't change the weapons: we read
// the `shot` events they already report (where each bullet started and
// stopped) and measure the distance between that SEGMENT and the bell.
import { tuning, secondsToTicks } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { currentHeight } from './player';
import { randomInt, type RandomState } from './random';
import type { World } from './world';

/** The bells event while it's being played: plain data, inside the GameState. */
export interface BellsEvent {
  kind: 'bells';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** The bells to ring, in order: indices into world.bellSpots. */
  bells: number[];
  /** How many are rung already (bells[rung] is the next one). */
  rung: number;
  /** Ticks left on the timer; -1 = not started (it starts with the first bell). */
  ticksLeft: number;
}

/** How high above its spot the middle of the bell hangs (the frame stands on the roof). Shared with the renderer. */
export const BELL_HANG = 1.5;

/** Where bell i's middle is. */
export function bellCenter(world: World, spot: number): { x: number; y: number; z: number } {
  const s = world.bellSpots![spot];
  return { x: s.x, y: s.y + BELL_HANG, z: s.z };
}

/**
 * Picks the bells for a new event: `tuning.bellsCount` spots, each at least
 * `bellsMinSpacing` meters from the one before it (so going from one to the
 * next is a real trip across town, not a step). Random from the game's
 * seeded generator. Null if the level doesn't have enough spots.
 *
 * How: a random first one, then for each next one the spots far enough from
 * the previous and not taken; pick one of them at random. If none is left
 * (a level with few spots), give up.
 */
export function createBellsEvent(world: World, rng: RandomState, wave: number): BellsEvent | null {
  const spots = world.bellSpots ?? [];
  if (spots.length < tuning.bellsCount) return null;
  const bells = [randomInt(rng, spots.length)];
  while (bells.length < tuning.bellsCount) {
    const last = spots[bells[bells.length - 1]];
    const far = spots
      .map((_, i) => i)
      .filter((i) => !bells.includes(i) && Math.hypot(spots[i].x - last.x, spots[i].z - last.z) >= tuning.bellsMinSpacing);
    if (far.length === 0) return null;
    bells.push(far[randomInt(rng, far.length)]);
  }
  return { kind: 'bells', wave, bells, rung: 0, ticksLeft: -1 };
}

/**
 * One tick of the bells event. Reads this tick's events (from `firstEvent`)
 * for shots and blasts, checks your body, and pushes `bellRung`.
 * Returns what happened: still going, done, or failed (the timer ran out).
 */
export function stepBells(
  ev: BellsEvent,
  world: World,
  player: PlayerState,
  events: SimEvent[],
  firstEvent: number,
): 'running' | 'success' | 'failure' {
  if (ev.ticksLeft > 0) {
    ev.ticksLeft--;
    if (ev.ticksLeft === 0) return 'failure';
  }
  const c = bellCenter(world, ev.bells[ev.rung]);
  if (bellTouched(c, player, events, firstEvent)) {
    ev.rung++;
    // The first bell starts the clock (going there is the choice to play).
    if (ev.ticksLeft < 0) ev.ticksLeft = secondsToTicks(tuning.bellsTime);
    const last = ev.rung === ev.bells.length;
    events.push({ type: 'bellRung', index: ev.rung - 1, count: ev.bells.length, x: c.x, y: c.y, z: c.z, last });
    if (last) return 'success';
  }
  return 'running';
}

/** Did anything reach the bell at `c` this tick? One bell per tick at most: the next one waits for the next tick. */
function bellTouched(c: { x: number; y: number; z: number }, player: PlayerState, events: SimEvent[], firstEvent: number): boolean {
  // Your body: the distance from the bell to your chest. Running into it, or
  // kicking it (the kick's reach is about this much).
  const chestY = player.y + currentHeight(player) * 0.6;
  if (Math.hypot(player.x - c.x, chestY - c.y, player.z - c.z) < tuning.bellTouchReach) return true;
  for (let i = firstEvent; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'shot' && distanceToSegment(c, e.from, e.to) < tuning.bellRadius) return true;
    // A blast: any explosion of yours (dynamite, Ultimo colpo) whose radius reaches it.
    if (e.type === 'explosion' && Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z) < e.radius + tuning.bellRadius) return true;
  }
  return false;
}

/**
 * Distance from point p to the segment a-b. The idea (the same as the near
 * misses in projectiles.ts): project p onto the line through a and b with
 * the DOT PRODUCT, which says how far along the segment the closest point
 * is (t from 0 = at a to 1 = at b); clamp t into the segment, then measure.
 * Also used by the Pony Express (ponyExpress.ts): your chest's path past a ring.
 */
export function distanceToSegment(
  p: { x: number; y: number; z: number },
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / length2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z);
}
