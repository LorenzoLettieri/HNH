// "Pony Express dell'Inferno", the second map event (docs/DESIGN.md §5).
// A trail of burning rings across town: run through the first one and a
// timer starts; every ring you pass adds a few seconds, run out and it's
// failed. A race against the clock through the horde, the purest "move"
// event: you can't do it standing still, and the fastest line is the one
// with the jumps, the slides and the wall runs.
//
// WHERE the rings go: on the ghouls' navigation graph (nav.ts). Every node
// of that graph is a point where a body can stand AND that it can reach
// walking, jumping, climbing: so a ring placed a little above a node is
// always reachable, on any level, without placing anything by hand (the
// bells needed a list of spots; a new building gets rings for free).
// Each ring is between ponyMinGap and ponyMaxGap meters from the one before
// it: a trail, not a random scatter across the map.
// One catch: the graph is the GHOULS' one, and a ghoul climbs walls up to
// 15 m (the canyon cliffs!). You don't: a few wall jumps, ~3 m. So only the
// nodes YOU can reach are candidates (playerReachable: a flood fill from
// your spawn that refuses the climbs too tall for you).
//
// WHEN you pass one: a SWEPT test, like the projectiles. Not "is your chest
// inside the ring now?" but "did the segment your chest covered in this tick
// pass close to its middle?". At 15 m/s you cover 25 cm per tick, so a
// point test would still work... but with the dynamite jump or a vent you
// fly much faster, and a sweep never skips a ring.
import { tuning, secondsToTicks } from './config';
import type { SimEvent } from './events';
import { getNavGraph, nearestNode, type NavGraph } from './nav';
import type { PlayerState } from './player';
import { currentHeight } from './player';
import { randomInt, type RandomState } from './random';
import type { World } from './world';
import { distanceToSegment } from './bells';

type Vec3 = { x: number; y: number; z: number };

/** The Pony Express event while it's being played: plain data, inside the GameState. */
export interface PonyExpressEvent {
  kind: 'ponyExpress';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** The rings, in order: where their middle is (fixed when the event is created). */
  rings: Vec3[];
  /** How many you have passed (rings[passed] is the next one). */
  passed: number;
  /** Ticks left on the timer; -1 = not started (it starts with the first ring). */
  ticksLeft: number;
  /** Where your chest was last tick: the start of the swept test. Null before the first tick. */
  lastChest: Vec3 | null;
}

/** Meters in one tick beyond which a move is a teleport, not a run. */
const TELEPORT = 3;

/**
 * The tallest climb link YOU can follow (meters up): a jump plus a couple of
 * wall jumps (≈ 1.2 + 2 × 1.05). Taller ones are the ghouls' business.
 */
export const PLAYER_CLIMB = 3.3;

/**
 * How high above the graph node (the floor) the ring's middle floats: just
 * over the ring's radius (1.5 m), so its rim doesn't sink into the floor;
 * your chest (≈ 1.1 m) passes half a meter under the middle, well inside.
 */
export const RING_HEIGHT = 1.6;

/**
 * Picks the trail for a new event: `tuning.ponyRings` points on the nav
 * graph, each between ponyMinGap and ponyMaxGap meters (on the ground plane)
 * from the one before it. Random from the game's seeded generator. Null if
 * the level can't host it (no graph, or a trail that gets stuck).
 */
export function createPonyExpressEvent(world: World, rng: RandomState, wave: number): PonyExpressEvent | null {
  const graph = getNavGraph(world);
  const nodes = graph.nodes;
  const reachable = playerReachable(world, graph);
  if (reachable.length === 0) return null;
  // A trail can get stuck (it walked into a corner of the map with nothing
  // left at the right distance): start over from another first ring.
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const picked = pickTrail(nodes, reachable, rng);
    if (!picked) continue;
    const rings = picked.map((i) => ({ x: nodes[i].x, y: nodes[i].y + RING_HEIGHT, z: nodes[i].z }));
    return { kind: 'ponyExpress', wave, rings, passed: 0, ticksLeft: -1, lastChest: null };
  }
  return null;
}

/** Tries to build a new trail before giving up (then the event picker tries another kind). */
const ATTEMPTS = 5;

/** One try at a trail: node indices, or null if it got stuck. */
function pickTrail(nodes: NavGraph['nodes'], reachable: number[], rng: RandomState): number[] | null {
  const minGap = Math.min(tuning.ponyMinGap, tuning.ponyMaxGap);
  const maxGap = Math.max(tuning.ponyMinGap, tuning.ponyMaxGap);
  const picked = [reachable[randomInt(rng, reachable.length)]];
  while (picked.length < tuning.ponyRings) {
    const last = nodes[picked[picked.length - 1]];
    // Candidates: far enough, not too far, and not near a ring already in the
    // trail (a trail that comes back on itself would put two rings in one place).
    const near: number[] = [];
    for (const i of reachable) {
      const n = nodes[i];
      const d = Math.hypot(n.x - last.x, n.z - last.z);
      if (d < minGap || d > maxGap) continue;
      if (picked.some((p) => Math.hypot(nodes[p].x - n.x, nodes[p].z - n.z) < minGap)) continue;
      near.push(i);
    }
    if (near.length === 0) return null;
    picked.push(near[randomInt(rng, near.length)]);
  }
  return picked;
}

// Derived from the level only, like the graph: computed once, kept in a cache.
const reachCache = new WeakMap<World, number[]>();

/**
 * The nodes of the graph the player can get to from the spawn: a FLOOD FILL
 * (a breadth-first search, the "paint bucket" of image editors) along the
 * links, skipping the climbs taller than PLAYER_CLIMB. Walks, jumps, drops
 * and vents are all yours too. No costs: here we only ask "can I get there?",
 * not "how fast?" (that's computeReach's Dijkstra in nav.ts).
 */
export function playerReachable(world: World, graph: NavGraph): number[] {
  const cached = reachCache.get(world);
  if (cached) return cached;
  const start = nearestNode(graph, world.spawn.x, world.spawn.y, world.spawn.z);
  const result: number[] = [];
  if (start >= 0) {
    const seen = new Uint8Array(graph.nodes.length);
    seen[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head];
      result.push(from);
      for (const link of graph.links[from]) {
        if (seen[link.to]) continue;
        if (link.kind === 'climb' && graph.nodes[link.to].y - graph.nodes[from].y > PLAYER_CLIMB) continue;
        seen[link.to] = 1;
        queue.push(link.to);
      }
    }
  }
  reachCache.set(world, result);
  return result;
}

/**
 * One tick of the Pony Express. Checks the segment your chest covered and
 * pushes `ringPassed`. Returns what happened: still going, done, or failed
 * (the timer ran out).
 */
export function stepPonyExpress(ev: PonyExpressEvent, player: PlayerState, events: SimEvent[]): 'running' | 'success' | 'failure' {
  if (ev.ticksLeft > 0) {
    ev.ticksLeft--;
    if (ev.ticksLeft === 0) return 'failure';
  }
  const chest = { x: player.x, y: player.y + currentHeight(player) * 0.6, z: player.z };
  const from = ev.lastChest ?? chest;
  ev.lastChest = chest;
  // Dead, you don't run. And a jump of meters in one tick is a teleport (a
  // respawn, a debug ?pos=), not a run through the rings: nothing flies 3 m
  // in 1/60 s (180 m/s).
  if (player.health <= 0) return 'running';
  if (Math.hypot(chest.x - from.x, chest.y - from.y, chest.z - from.z) > TELEPORT) return 'running';

  const ring = ev.rings[ev.passed];
  if (distanceToSegment(ring, from, chest) >= tuning.ponyRingRadius) return 'running';
  ev.passed++;
  // The first ring starts the clock (going there is the choice to play);
  // every next one adds time, capped so a fast start can't bank a minute.
  const bonus = secondsToTicks(ev.passed === 1 ? tuning.ponyStartTime : tuning.ponyRingBonus);
  ev.ticksLeft = Math.min(Math.max(ev.ticksLeft, 0) + bonus, secondsToTicks(tuning.ponyMaxTime));
  const last = ev.passed === ev.rings.length;
  events.push({ type: 'ringPassed', index: ev.passed - 1, count: ev.rings.length, x: ring.x, y: ring.y, z: ring.z, last });
  return last ? 'success' : 'running';
}
