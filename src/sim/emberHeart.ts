// "Il Cuore di Brace", the fourth map event (docs/DESIGN.md §5): a ZONE THAT MOVES.
// A crystal of hellfire sleeps somewhere in the streets. Touch it and it
// wakes up: it starts wandering around town, a bit slower than you, with a
// circle of fire around it. Every enemy you kill while YOU stand INSIDE the
// circle feeds it its soul; fill it before the wave ends and the event is won.
//
// What counts is where YOU are when the enemy dies, not where the enemy is
// (the user's choice, after a first version that counted the enemy): you
// can't camp outside and snipe in, you have to walk with the heart, in the
// middle of the horde it drags along. Where the enemy is doesn't matter: a
// sharpshooter on a far roof counts, if you shoot it from inside. The circle
// is a COLUMN (only the distance on the ground plane counts): standing on a
// roof inside it counts too.
// Souls, not kills: an enemy feeds the heart as much as it weighs in the
// waves (enemyCost: a ghoul 1, a bull 5). How many it wants depends on the
// wave: a share of the wave's whole weight (waveBudget), so it's always
// about half the horde, at wave 4 or at wave 24. No clock: the wave IS the
// clock. Every enemy you kill from outside the circle is a soul wasted.
//
// HOW IT MOVES: on the ghouls' navigation graph (nav.ts), like the enemies,
// but only along the WALK links: it floats over the streets, it doesn't jump
// or climb (a zone that leaps onto a roof would leave you behind). It picks
// a destination at random some tens of meters away, follows a flow field
// toward it (the same Dijkstra the ghouls use toward you: here toward a node
// it chose), stops a moment, and picks another one. "Wandering" this way is
// the simplest AI there is, and enough: the point isn't where it goes, it's
// that it doesn't stand still.
import { tuning, secondsToTicks, TICK_DT } from './config';
import type { SimEvent } from './events';
import type { GameState } from './game';
import { isEnemy } from './entities';
import { getFlowField, getNavGraph, nearestNode, type LinkFilter, type NavGraph } from './nav';
import { currentHeight, type PlayerState } from './player';
import { randomInt, type RandomState } from './random';
import { enemyCost, waveBudget } from './waves';
import type { World } from './world';

/** The heart while it's being played: plain data, inside the GameState. */
export interface EmberHeartEvent {
  kind: 'emberHeart';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** Asleep until you touch it: then it moves, and the kills count. */
  awake: boolean;
  /** Souls fed so far, and how many it wants. */
  souls: number;
  goal: number;
  /** Where it floats: x, z on the graph, y = the floor under it (its middle is HEART_HOVER higher). */
  x: number;
  y: number;
  z: number;
  /** Where it was last tick (the renderer interpolates between the two). */
  px: number;
  py: number;
  pz: number;
  /** The graph node it's leaving, and the one it's going to (-1 = standing on `node`). */
  node: number;
  next: number;
  /** Meters already covered between `node` and `next`. */
  along: number;
  /** The node it's wandering to. */
  goalNode: number;
  /** Ticks it still rests before leaving again. */
  restTicks: number;
}

/** How high above the floor the crystal's middle floats (meters). Shared with the renderer. */
export const HEART_HOVER = 1.5;

/** Only the walk links: it floats along the streets, it never jumps, drops or climbs. */
const WALK_ONLY: LinkFilter = (link) => link.kind === 'walk';

/** Fewer nodes than this and the level can't host it (the test arena has plenty). */
const MIN_NODES = 40;

/**
 * A new heart, or null if the level can't host it. It sleeps on a random
 * node of the streets (see `places`), where it'll wait for you.
 */
export function createEmberHeartEvent(world: World, rng: RandomState, wave: number): EmberHeartEvent | null {
  const graph = getNavGraph(world);
  const spots = places(world, graph);
  if (spots.length < MIN_NODES) return null;
  const node = spots[randomInt(rng, spots.length)];
  const n = graph.nodes[node];
  const goal = Math.max(1, Math.round(waveBudget(wave) * tuning.emberHeartShare));
  return {
    kind: 'emberHeart',
    wave,
    awake: false,
    souls: 0,
    goal,
    x: n.x,
    y: n.y,
    z: n.z,
    px: n.x,
    py: n.y,
    pz: n.z,
    node,
    next: -1,
    along: 0,
    goalNode: node,
    restTicks: 0,
  };
}

/**
 * One tick of the heart. Asleep: waits for your touch. Awake: wanders, and
 * eats the souls of the enemies killed in its circle (from this tick's
 * `hit` events). Says 'success' when it's full; the wave ending first is a
 * failure (the skeleton in mapEvents.ts takes care of that).
 */
export function stepEmberHeart(
  ev: EmberHeartEvent,
  game: GameState,
  world: World,
  events: SimEvent[],
  firstEvent: number,
): 'running' | 'success' {
  ev.px = ev.x;
  ev.py = ev.y;
  ev.pz = ev.z;
  const p = game.player;

  if (!ev.awake) {
    // Your chest close to the crystal's middle: run into it.
    const chestY = p.y + currentHeight(p) * 0.6;
    const d = Math.hypot(p.x - ev.x, chestY - (ev.y + HEART_HOVER), p.z - ev.z);
    if (p.health <= 0 || d > tuning.emberHeartWakeReach) return 'running';
    ev.awake = true;
    ev.restTicks = secondsToTicks(tuning.emberHeartRest); // a moment to unfold its circle before it leaves
    events.push({ type: 'emberHeartWake', x: ev.x, y: ev.y + HEART_HOVER, z: ev.z });
    return 'running';
  }

  wander(ev, game, world);

  // Out of the circle (or dead): this tick's kills feed nothing.
  if (p.health <= 0 || !inEmberCircle(ev, p)) return 'running';
  // The souls of this tick's kills. Copy the end: we push while reading.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type !== 'hit' || !e.killed || e.target === 'target') continue;
    const enemy = game.entities.find((en) => en.id === e.entityId);
    if (!enemy || !isEnemy(enemy)) continue;
    const souls = enemyCost(enemy);
    ev.souls = Math.min(ev.goal, ev.souls + souls);
    events.push({
      type: 'emberHeartFed',
      fromX: enemy.x,
      fromY: enemy.y,
      fromZ: enemy.z,
      souls,
      total: ev.souls,
      goal: ev.goal,
    });
    if (ev.souls >= ev.goal) return 'success';
  }
  return 'running';
}

/**
 * Are you inside the awake heart's circle? Distance on the ground plane only
 * (it's a column). Used here to count the kills and by the HUD to warn you
 * when you've stepped out.
 */
export function inEmberCircle(ev: EmberHeartEvent, p: PlayerState): boolean {
  return ev.awake && Math.hypot(p.x - ev.x, p.z - ev.z) <= tuning.emberHeartRadius;
}

/**
 * One tick of wandering: rest, or move `emberHeartSpeed × dt` meters along
 * the links of the flow field toward goalNode, node after node. At the
 * goal: rest, then a new goal.
 */
function wander(ev: EmberHeartEvent, game: GameState, world: World): void {
  if (ev.restTicks > 0) {
    ev.restTicks--;
    return;
  }
  const graph = getNavGraph(world);
  let budget = tuning.emberHeartSpeed * TICK_DT; // meters left to move this tick
  // A few links per tick at most (they're 1.5-2 m, it moves ~8 cm): no endless loop if something goes wrong.
  for (let guard = 0; guard < 4 && budget > 0; guard++) {
    if (ev.next < 0) {
      if (ev.node === ev.goalNode) {
        ev.goalNode = pickGoal(ev.node, graph, world, game);
        if (ev.goalNode === ev.node) return;
      }
      // The flow field toward the goal (cached: recomputed only when the goal changes).
      const link = getFlowField(graph, ev.goalNode, WALK_ONLY).next[ev.node];
      if (!link) {
        ev.goalNode = ev.node; // unreachable (it shouldn't happen: see `places`): pick another next tick
        return;
      }
      ev.next = link.to;
      ev.along = 0;
    }
    const a = graph.nodes[ev.node];
    const b = graph.nodes[ev.next];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const step = Math.min(budget, length - ev.along);
    ev.along += step;
    budget -= step;
    const t = length > 0 ? ev.along / length : 1;
    ev.x = a.x + (b.x - a.x) * t;
    ev.y = a.y + (b.y - a.y) * t;
    ev.z = a.z + (b.z - a.z) * t;
    if (ev.along >= length - 1e-6) {
      ev.node = ev.next;
      ev.next = -1;
      if (ev.node === ev.goalNode) {
        ev.restTicks = secondsToTicks(tuning.emberHeartRest);
        return;
      }
    }
  }
}

/**
 * Where to wander next: a random place between emberHeartLegMin and
 * emberHeartLegMax meters away (on the ground plane). If none (a small
 * level), any place.
 */
function pickGoal(from: number, graph: NavGraph, world: World, rng: RandomState): number {
  const spots = places(world, graph);
  const a = graph.nodes[from];
  const min = Math.min(tuning.emberHeartLegMin, tuning.emberHeartLegMax);
  const max = Math.max(tuning.emberHeartLegMin, tuning.emberHeartLegMax);
  const near = spots.filter((i) => {
    const d = Math.hypot(graph.nodes[i].x - a.x, graph.nodes[i].z - a.z);
    return d >= min && d <= max;
  });
  const pool = near.length > 0 ? near : spots;
  return pool[randomInt(rng, pool.length)];
}

// Derived from the level only, like the graph: computed once, kept in a cache.
const placesCache = new WeakMap<World, number[]>();

/**
 * Where the heart may sleep and wander to: the nodes connected to the
 * player's spawn by WALK links only (a flood fill, like the Pony Express's
 * playerReachable: the streets, not the roofs), and only those under the
 * open sky (no box above them: not inside the saloon, where its column of
 * light couldn't be seen). It can still CROSS an interior on its way, if
 * that's the shortest path: fine, its circle goes through the walls.
 */
function places(world: World, graph: NavGraph): number[] {
  const cached = placesCache.get(world);
  if (cached) return cached;
  const result: number[] = [];
  const start = nearestNode(graph, world.spawn.x, world.spawn.y, world.spawn.z);
  if (start >= 0) {
    const seen = new Uint8Array(graph.nodes.length);
    seen[start] = 1;
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head];
      const n = graph.nodes[from];
      const covered = world.boxes.some((b) => n.x > b.minX && n.x < b.maxX && n.z > b.minZ && n.z < b.maxZ && b.minY > n.y);
      if (!covered) result.push(from);
      for (const link of graph.links[from]) {
        if (link.kind !== 'walk' || seen[link.to]) continue;
        seen[link.to] = 1;
        queue.push(link.to);
      }
    }
  }
  placesCache.set(world, result);
  return result;
}
