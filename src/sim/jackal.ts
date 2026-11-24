// "Lo Sciacallo", the fifth map event (docs/DESIGN.md §5): a TARGET ON THE RUN.
// A little devil with a sack of vildenaro shows up somewhere in town, far
// from you, and laughs at you. Get close and it runs. Kill it before its
// time is up (or before the wave ends) and the sack is yours, plus the
// fiches. Every hit makes it lose a few coins: even if it gets away, what you
// knocked out of it stays on the ground.
//
// It's slippery because of HOW IT MOVES, not because it's small: it runs,
// jumps, climbs the walls (the ones you can get up too) and rides the vents,
// on the ghouls' navigation graph. A bit slower than you on the street; hit,
// it bolts for a moment. Climbing is slow: that's where you catch it.
//
// Two files' worth in one, like the Ember Heart: the EVENT (when it shows up,
// when it's won or lost) and the jackal's AI (an entity, entities.ts, so every
// weapon, blast, kick and fire already hits it with no extra code).
//
// THE AI is a small state machine:
//
//   taunt ──(you get within jackalFleeRange, or you hit it)──▶ flee
//     ▲                                                          │
//     └──────(you're beyond jackalCalmRange for a second)────────┘
//
// and FLEE follows the ESCAPE MAP (nav.ts, computeFleeField): not "the
// neighbor farthest from you" (that leads into corners), but "the best place
// to be, minus the way to get there", so it runs toward the open streets,
// even past you if it must.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import { createJackal, type JackalEntity } from './entities';
import type { SimEvent } from './events';
import type { GameState } from './game';
import { climbWall, jumpTo, rideVent, VENT_RIDE_RADIUS } from './ghoul';
import { getFleeField, getNavGraph, nearestNode, type LinkFilter, type NavGraph } from './nav';
import { dropCoins } from './pickups';
import { PLAYER_CLIMB, playerReachable } from './ponyExpress';
import { randomInt } from './random';
import { healthForWave } from './waves';
import type { World } from './world';

/** The event while it's being played: plain data, inside the GameState. The jackal itself is an entity. */
export interface JackalEvent {
  kind: 'jackal';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** Which entity is the jackal (in game.entities). */
  entityId: number;
  /** Ticks before it escapes. */
  ticksLeft: number;
}

/** Fewer reachable nodes than this and the level can't host it. */
const MIN_NODES = 40;
/** No spot at the right distance (a small level): any spot at least this far from you (meters). */
const SPAWN_FALLBACK = 15;
/** How quickly it reaches its speed or turns, 1/s: snappier than a ghoul (4), it's a thief. */
const ACCEL = 10;
/** Standing (taunting), it stops quickly: 1/s. */
const GROUND_FRICTION = 8;
/** You must stay beyond jackalCalmRange this long before it stops to taunt you (seconds): no flickering at the edge. */
const CALM_TIME = 1;
/** Cornered (no way on the escape map) and you're closer than this: it runs straight away from you (meters). */
const CORNERED_RANGE = 10;
/** Within this distance of a jump's landing node it takes the leap (meters, like the sharpshooter). */
const JUMP_REACH = 2.8;
/** Within this distance of the foot of a wall it starts climbing (meters). */
const CLIMB_REACH = 1.5;

/**
 * The links YOU can follow too: everything, except the climbs taller than
 * you can get up (a jump plus two wall jumps, PLAYER_CLIMB). A jackal on top
 * of a 12 m cliff would be a jackal you can only snipe: not a chase.
 */
const PLAYER_LINKS: LinkFilter = (link, from, graph) =>
  link.kind !== 'climb' || graph.nodes[link.to].y - graph.nodes[from].y <= PLAYER_CLIMB;

/**
 * A new jackal hunt, or null if the level can't host it. The jackal shows up
 * on a node you can reach, jackalSpawnMin-Max meters from you: far enough
 * to have to look for it, close enough to hear it laugh.
 * It's the only event whose creation puts something in the world right away
 * (an entity): it gets the whole GameState, not only the random generator.
 */
export function createJackalEvent(world: World, game: GameState, wave: number): JackalEvent | null {
  const graph = getNavGraph(world);
  const spots = playerReachable(world, graph);
  if (spots.length < MIN_NODES) return null;
  const p = game.player;
  const min = Math.min(tuning.jackalSpawnMin, tuning.jackalSpawnMax);
  const max = Math.max(tuning.jackalSpawnMin, tuning.jackalSpawnMax);
  const away = (i: number) => Math.hypot(graph.nodes[i].x - p.x, graph.nodes[i].z - p.z);
  let pool = spots.filter((i) => away(i) >= min && away(i) <= max);
  if (pool.length === 0) pool = spots.filter((i) => away(i) >= SPAWN_FALLBACK);
  if (pool.length === 0) return null;
  const n = graph.nodes[pool[randomInt(game, pool.length)]];
  const jackal = createJackal(game.nextEntityId++, n.x, n.y + 0.05, n.z, healthForWave(tuning.jackalHealth, wave));
  game.entities.push(jackal);
  return { kind: 'jackal', wave, entityId: jackal.id, ticksLeft: secondsToTicks(tuning.jackalTime) };
}

/** The jackal of this event, if it's still in the world. */
export function jackalOf(ev: JackalEvent, game: GameState): JackalEntity | null {
  const e = game.entities.find((en) => en.id === ev.entityId);
  return e && e.type === 'jackal' ? e : null;
}

/**
 * One tick of the hunt: coins out of every hit of this tick (from the `hit`
 * events, like the bells read the shots), success when it's dead, failure
 * when its time runs out or it's gone (fell off the map). The wave ending
 * first is a failure too: the skeleton in mapEvents.ts takes care of that.
 * The AI is not here: it runs with the other enemies (game.ts), so a stunned
 * jackal is stunned like everyone else.
 */
export function stepJackalEvent(ev: JackalEvent, game: GameState, events: SimEvent[], firstEvent: number): 'running' | 'success' | 'failure' {
  const j = jackalOf(ev, game);
  if (!j || j.y < tuning.killY) return 'failure';
  // Copy the end: we push while reading.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type !== 'hit' || e.entityId !== j.id) continue;
    // The killing blow: the whole sack bursts (dropFromKills in pickups.ts already did it).
    if (e.killed) return 'success';
    if (e.damage <= 0) continue;
    dropCoins(game, j.x, j.y + 0.3, j.z, tuning.jackalCoinsPerHit);
    events.push({ type: 'jackalCoins', x: j.x, y: j.y + 0.8, z: j.z, coins: tuning.jackalCoinsPerHit });
  }
  if (j.state === 'dead') return 'success';
  if (--ev.ticksLeft <= 0) return 'failure';
  return 'running';
}

/**
 * The hunt is over: if the jackal is still alive, it gets away. It vanishes
 * in a puff of fire (the renderer reads jackalEscaped), taking the rest of
 * its sack with it. Called by the skeleton (mapEvents.ts) whatever the end.
 */
export function jackalEscapes(ev: JackalEvent, game: GameState, events: SimEvent[]): void {
  const j = jackalOf(ev, game);
  if (!j || j.state === 'dead') return;
  game.entities = game.entities.filter((e) => e !== j);
  events.push({ type: 'jackalEscaped', x: j.x, y: j.y, z: j.z });
}

// --- The AI ----------------------------------------------------------------------------

/** One tick of the jackal's AI (called by game.ts with the other enemies). */
export function stepJackal(j: JackalEntity, game: GameState, world: World, graph: NavGraph, dt: number): void {
  j.stateTicks++;
  // Hit since the last tick (its health went down): it bolts. The AI doesn't
  // read the hit events: comparing with last tick's health is enough, and it
  // catches every kind of damage (bullets, blasts, fire, boots).
  if (j.health < j.lastHealth && j.state !== 'dead') {
    j.panicTicks = secondsToTicks(tuning.jackalPanicTime);
    if (j.state === 'taunt') setState(j, 'flee');
  }
  j.lastHealth = j.health;
  if (j.panicTicks > 0) j.panicTicks--;

  // Partway up a wall: nothing else until it's over the edge (a dead one just falls).
  if (j.state === 'dead') j.climbTo = -1;
  if (j.climbTo >= 0) {
    climbWall(j, graph.nodes[j.climbFrom], graph.nodes[j.climbTo], tuning.jackalRadius, tuning.jackalHeight, tuning.jackalClimbSpeed, world, dt);
    return;
  }
  // Where is it on the graph? (Only with its feet down: in the air it keeps the last one.)
  if (j.onGround) {
    const node = nearestNode(graph, j.x, j.y, j.z);
    if (node >= 0) j.navNode = node;
  }

  const p = game.player;
  if (j.state === 'dead') {
    standStill(j, world, dt);
    return;
  }
  if (j.state === 'taunt') {
    standStill(j, world, dt);
    faceToward(j, p.x, p.z);
    if (Math.hypot(p.x - j.x, p.z - j.z) < tuning.jackalFleeRange) setState(j, 'flee');
    return;
  }

  // FLEE. You've stayed far for a while (and it isn't panicking): it stops to taunt you.
  const far = Math.hypot(p.x - j.x, p.z - j.z) > tuning.jackalCalmRange;
  j.calmTicks = far && j.panicTicks === 0 ? j.calmTicks + 1 : 0;
  if (j.onGround && j.calmTicks >= secondsToTicks(CALM_TIME)) {
    j.calmTicks = 0;
    setState(j, 'taunt');
    return;
  }
  flee(j, game, world, graph, dt);
}

function setState(j: JackalEntity, state: JackalEntity['state']): void {
  j.state = state;
  j.stateTicks = 0;
}

/** Gravity, friction, walls: standing (taunting, cornered) or lying dead. */
function standStill(j: JackalEntity, world: World, dt: number): void {
  if (j.onGround) {
    const k = Math.min(1, GROUND_FRICTION * dt);
    j.vx -= j.vx * k;
    j.vz -= j.vz * k;
  }
  j.vy -= tuning.gravity * dt;
  j.onGround = moveAndCollide(j, tuning.jackalRadius, tuning.jackalHeight, world.boxes, dt).landed;
}

function faceToward(j: JackalEntity, x: number, z: number): void {
  const d = Math.hypot(x - j.x, z - j.z);
  if (d < 0.01) return;
  j.dirX = (x - j.x) / d;
  j.dirZ = (z - j.z) / d;
}

/**
 * Running away: from the node it stands on, the link the escape map says
 * (downhill on the map), handling the special ones when in position: the
 * same moves as the sharpshooter walking to its perch, toward "away from you"
 * instead of toward a perch.
 */
function flee(j: JackalEntity, game: GameState, world: World, graph: NavGraph, dt: number): void {
  const p = game.player;
  // The escape map away from your node (cached: recomputed only when you change node, see getFleeField).
  const field = getFleeField(graph, game.navGoal, tuning.jackalFleeScale, PLAYER_LINKS, tuning.jackalHeightBonus);
  const link = j.navNode >= 0 ? field.next[j.navNode] : null;
  let wishX = 0;
  let wishZ = 0;
  let speed = j.panicTicks > 0 ? tuning.jackalPanicSpeed : tuning.jackalSpeed;
  if (link) {
    const t = link.via ?? graph.nodes[link.to];
    const d = Math.hypot(t.x - j.x, t.z - j.z);
    if (d > 0.01) {
      wishX = (t.x - j.x) / d;
      wishZ = (t.z - j.z) / d;
    }
    // A vent launches only from the middle of the grate (rideVent): slow down onto it, or it runs past.
    if (link.kind === 'vent') speed *= Math.min(1, d / (VENT_RIDE_RADIUS * 4));
  }
  // No link = the best spot it knows (a local best of the map, or off the
  // graph): it stays and watches you, until you move and the map changes
  // under it... unless you're right on it: then it bolts straight away from
  // you, and finds the graph again wherever it lands.
  else if (Math.hypot(p.x - j.x, p.z - j.z) < CORNERED_RANGE) {
    const d = Math.hypot(j.x - p.x, j.z - p.z) || 1;
    wishX = (j.x - p.x) / d;
    wishZ = (j.z - p.z) / d;
  }

  if (j.onGround) {
    const k = Math.min(1, ACCEL * dt);
    j.vx += (wishX * speed - j.vx) * k;
    j.vz += (wishZ * speed - j.vz) * k;
  }

  // Special links, when in position.
  if (link && j.onGround) {
    const t = graph.nodes[link.to];
    const here = graph.nodes[j.navNode];
    if (link.kind === 'jump' && Math.hypot(t.x - j.x, t.z - j.z) < JUMP_REACH) {
      jumpTo(j, t, world.boxes, tuning.jackalRadius, tuning.jackalHeight);
    } else if (link.kind === 'climb' && Math.hypot(here.x - j.x, here.z - j.z) < CLIMB_REACH) {
      j.climbFrom = j.navNode;
      j.climbTo = link.to;
      j.climbTicks = 0;
      faceToward(j, t.x, t.z); // facing the wall: from where you stand you see its back
      return;
    } else if (link.kind === 'vent') {
      rideVent(j, link, world);
    }
    // 'walk' and 'drop' need nothing special: running off the edge IS dropping.
  }

  j.vy -= tuning.gravity * dt;
  const r = tuning.jackalRadius;
  const h = tuning.jackalHeight;
  const speedBefore = Math.hypot(j.vx, j.vz);
  j.onGround = moveAndCollide(j, r, h, world.boxes, dt).landed;

  // Bumped into something low (cutting a corner, a crate): hop over it, like the ghouls.
  const speedAfter = Math.hypot(j.vx, j.vz);
  if (j.onGround && (wishX || wishZ) && speedBefore > 0.2 && speedAfter < speedBefore * 0.5) {
    const jumpHeight = tuning.ghoulJumpHeight;
    if (!overlapsAny(j.x + wishX * 0.4, j.y + jumpHeight, j.z + wishZ * 0.4, r, h, world.boxes)) {
      j.vy = Math.sqrt(2 * tuning.gravity * (jumpHeight + 0.15));
      j.onGround = false;
    }
  }

  // Facing: where it runs; standing (cornered), toward you.
  if (speedAfter > 0.5) {
    j.dirX = j.vx / speedAfter;
    j.dirZ = j.vz / speedAfter;
  } else {
    faceToward(j, p.x, p.z);
  }
}
