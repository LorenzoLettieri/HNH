// Bull AI: a big, tough brute that doesn't chase you, it CHARGES you.
// The idea: it's dangerous, but only if you don't move. Dodge first, then
// punish it.
//
//   approach ──(close, straight line to you)──▶ aim (the WARNING: it stops,
//      ▲   ▲                                     │   paws the ground, snorts)
//      │   │                                     ▼
//      │   └──── skid ◀──(it overshot you)──── charge (straight, no steering)
//      │                                         │
//      └────────── stunned ◀──(hit a wall)───────┘
//
// - APPROACH: walks toward you on the flow field, slowly (you can walk away).
// - AIM: stops and turns toward where you WILL be. In the last moment it
//   stops turning (direction locked, head down): that's your cue.
// - CHARGE: runs along the locked direction, very fast, and never steers.
//   Anything in its way stops it: walls, but also low obstacles (it doesn't
//   jump while charging). If it runs you over: big damage, and you fly.
// - SKID: it missed you and ran past: it slows down, then starts over.
// - STUNNED: it crashed into something. Dazed for a couple of seconds, and
//   every hit is critical (see weapon.ts): that's the reward for dodging
//   with a wall behind you.
//
// Kicks and shotgun blasts don't push it (see knockBack in kick.ts): it's
// too heavy. It doesn't climb or ride vents: if you're on a roof it waits below.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { BullEntity, Entity } from './entities';
import type { SimEvent } from './events';
import { interceptTime } from './eyebat';
import { jumpTo } from './ghoul';
import { knockBack } from './kick';
import { nearestNode, type FlowField, type NavGraph, type NavLink } from './nav';
import { hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/**
 * Height of the ray that checks "is the way to you clear?", meters. Low, at
 * knee height: a water trough would stop the charge, so it must see it.
 */
const PATH_RAY_HEIGHT = 0.5;
/**
 * The charge "crashed" when a collision took away more than this fraction of
 * its speed. Hitting a wall head-on loses everything; grazing it at a shallow
 * angle loses little, and it slides along the wall instead.
 */
const CRASH_SPEED_LOSS = 0.3;

export function stepBull(
  b: BullEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  b.stateTicks++;
  if (b.chargeCooldownTicks > 0) b.chargeCooldownTicks--;

  if (b.state === 'dead' || b.state === 'stunned' || b.state === 'skid') {
    slowDown(b, world, dt);
    if (b.state === 'stunned' && b.stateTicks >= secondsToTicks(tuning.bullStunTime)) endCharge(b);
    if (b.state === 'skid' && b.stateTicks >= secondsToTicks(tuning.bullSkidTime)) endCharge(b);
    return;
  }

  if (b.onGround) {
    const node = nearestNode(graph, b.x, b.y, b.z);
    if (node >= 0) b.navNode = node;
  }
  const dist = Math.hypot(player.x - b.x, player.z - b.z);

  if (b.state === 'approach') approach(b, player, dist, others, world, graph, flow, dt, events);
  else if (b.state === 'aim') aim(b, player, world, dt, events);
  else charge(b, player, others, world, dt, events);
}

/** Walks toward you; when it has a straight line to you, starts aiming. */
function approach(
  b: BullEntity,
  player: PlayerState,
  dist: number,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  const canCharge =
    b.onGround &&
    b.chargeCooldownTicks === 0 &&
    dist < tuning.bullChargeRange &&
    Math.abs(player.y - b.y) < 1.5 &&
    player.health > 0 &&
    clearPath(b, player, dist, world);
  if (canCharge) {
    setState(b, 'aim');
    events.push({ type: 'bullAim', entityId: b.id });
    return;
  }

  // Where to walk: straight at you if it can, otherwise the flow field.
  let tx = player.x;
  let tz = player.z;
  let link: NavLink | null = null;
  if (!clearPath(b, player, dist, world)) {
    const next = b.navNode >= 0 ? flow.next[b.navNode] : null;
    // Climbs and vents are for ghouls: a bull waits below.
    if (next && next.kind !== 'climb' && next.kind !== 'vent') {
      tx = graph.nodes[next.to].x;
      tz = graph.nodes[next.to].z;
      link = next;
    }
  }
  const dx = tx - b.x;
  const dz = tz - b.z;
  const d = Math.hypot(dx, dz);
  let wishX = d > 0.3 ? dx / d : 0;
  let wishZ = d > 0.3 ? dz / d : 0;
  if (d > 0.3) {
    b.dirX = wishX;
    b.dirZ = wishZ;
  }
  // Separation from the other bulls (the same "boids" push as the ghouls):
  // without it two bulls walking the same path merge into one.
  const minGap = tuning.bullRadius * 2 + 0.6;
  for (const o of others) {
    if (o === b || o.type !== 'bull' || o.state === 'dead') continue;
    const ox = b.x - o.x;
    const oz = b.z - o.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.001 && od < minGap) {
      const push = (minGap - od) / minGap;
      wishX += (ox / od) * push * 1.5;
      wishZ += (oz / od) * push * 1.5;
    }
  }
  const len = Math.hypot(wishX, wishZ);
  if (len > 1) {
    wishX /= len;
    wishZ /= len;
  }

  if (b.onGround) {
    const k = Math.min(1, tuning.bullAccel * dt);
    b.vx += (wishX * tuning.bullSpeed - b.vx) * k;
    b.vz += (wishZ * tuning.bullSpeed - b.vz) * k;
    if (link && link.kind === 'jump' && d < 3) jumpTo(b, graph.nodes[link.to], world.boxes, tuning.bullRadius, tuning.bullHeight);
  }
  b.vy -= tuning.gravity * dt;

  // Move; if a low obstacle stopped it, step over it (same trick as the hound).
  const speedBefore = Math.hypot(b.vx, b.vz);
  const { landed } = moveAndCollide(b, tuning.bullRadius, tuning.bullHeight, world.boxes, dt);
  b.onGround = landed;
  const blocked = speedBefore > 0.2 && Math.hypot(b.vx, b.vz) < speedBefore * 0.5;
  if (b.onGround && blocked && d > 0.3) {
    const room = !overlapsAny(
      b.x + wishX * 0.4, b.y + tuning.bullJumpHeight, b.z + wishZ * 0.4,
      tuning.bullRadius, tuning.bullHeight, world.boxes,
    );
    if (room) {
      b.vy = Math.sqrt(2 * tuning.gravity * (tuning.bullJumpHeight + 0.15));
      b.onGround = false;
    }
  }
}

/**
 * Stands still and turns toward where you'll be when the charge arrives.
 *
 * Lead (like the eye-bat's shots): it aims where you'll be when it arrives,
 * if you keep your velocity. Two parts:
 * 1. Until the charge starts it can't move: by then you'll be at
 *    you + velocity × untilCharge.
 * 2. From there it's the eye-bat's problem, an INTERCEPT: a "ball" (the
 *    bull) at bullChargeSpeed against a target moving at your velocity
 *    (interceptTime solves it exactly).
 * Then it aims at  you + velocity × (untilCharge + intercept) × bullLeadFactor.
 *
 * It turns at most bullAimTurnRate degrees per second: circle around it fast
 * enough (close by, the angle changes fast) and it can't keep up.
 */
function aim(b: BullEntity, player: PlayerState, world: World, dt: number, events: SimEvent[]): void {
  slowDown(b, world, dt);
  const lockAt = secondsToTicks(tuning.bullAimTime - tuning.bullAimLockTime);
  if (b.stateTicks < lockAt) {
    const untilCharge = Math.max(0, tuning.bullAimTime - b.stateTicks * dt);
    const rx = player.x + player.vx * untilCharge - b.x;
    const rz = player.z + player.vz * untilCharge - b.z;
    const run = interceptTime(rx, 0, rz, player.vx, 0, player.vz, tuning.bullChargeSpeed);
    const t = (untilCharge + run) * tuning.bullLeadFactor;
    const tx = player.x + player.vx * t;
    const tz = player.z + player.vz * t;
    // Angles in the player's yaw convention: direction (sin a, cos a).
    const current = Math.atan2(b.dirX, b.dirZ);
    const wanted = Math.atan2(tx - b.x, tz - b.z);
    const diff = Math.atan2(Math.sin(wanted - current), Math.cos(wanted - current)); // shortest way, [-π, π]
    const maxTurn = ((tuning.bullAimTurnRate * Math.PI) / 180) * dt;
    const a = current + Math.max(-maxTurn, Math.min(maxTurn, diff));
    b.dirX = Math.sin(a);
    b.dirZ = Math.cos(a);
  }
  if (b.stateTicks >= secondsToTicks(tuning.bullAimTime)) {
    setState(b, 'charge');
    b.chargeHit = false;
    b.trampled = [];
    events.push({ type: 'bullCharge', entityId: b.id });
  }
}

/** Straight ahead at full speed. Ends against a wall (stunned) or past you (skid). */
function charge(b: BullEntity, player: PlayerState, others: Entity[], world: World, dt: number, events: SimEvent[]): void {
  // No acceleration curve and no steering: on the ground its velocity IS the
  // charge direction × speed. (In the air, off a ledge, it keeps flying.)
  if (b.onGround) {
    b.vx = b.dirX * tuning.bullChargeSpeed;
    b.vz = b.dirZ * tuning.bullChargeSpeed;
  }
  b.vy -= tuning.gravity * dt;
  const speedBefore = Math.hypot(b.vx, b.vz);
  const { landed } = moveAndCollide(b, tuning.bullRadius, tuning.bullHeight, world.boxes, dt);
  b.onGround = landed;

  // Ran you over? Circle against circle on the ground (its collider and
  // yours, plus a bit: the horns stick out), and your feet must be low
  // enough: jump at the right moment and it passes under you (bullTrampleHeight).
  // At 17 m/s it moves ~0.3 m per tick, much less than the 1.35 m reach: it
  // can't skip over you between two ticks.
  const reach = tuning.bullRadius + tuning.playerRadius + 0.3;
  const overlapY = player.y < b.y + tuning.bullTrampleHeight && player.y + tuning.playerHeight > b.y;
  if (!b.chargeHit && player.health > 0 && overlapY && Math.hypot(player.x - b.x, player.z - b.z) < reach) {
    b.chargeHit = true;
    hurtPlayer(player, tuning.bullChargeDamage, b.x, b.z, 0);
    // Thrown along the charge, and a bit to the side you were on (out of its way), and up.
    const side = (player.x - b.x) * b.dirZ - (player.z - b.z) * b.dirX >= 0 ? 1 : -1;
    const k = tuning.bullChargeKnockback;
    player.vx += b.dirX * k + b.dirZ * side * k * 0.4;
    player.vz += b.dirZ * k - b.dirX * side * k * 0.4;
    player.vy = Math.max(player.vy, tuning.bullChargeLift);
    events.push({ type: 'playerHurt', damage: tuning.bullChargeDamage, fromX: b.x, fromZ: b.z });
  }
  trample(b, others);

  if (speedBefore > 1 && Math.hypot(b.vx, b.vz) < speedBefore * (1 - CRASH_SPEED_LOSS)) {
    setState(b, 'stunned');
    events.push({ type: 'bullCrash', entityId: b.id });
    return;
  }
  // How far ahead of it you are, along the charge (dot product). Negative =
  // you're behind it: it overshot you.
  const ahead = (player.x - b.x) * b.dirX + (player.z - b.z) * b.dirZ;
  if (ahead < -tuning.bullOvershoot || b.stateTicks > secondsToTicks(tuning.bullChargeMaxTime)) {
    // It ran past you without touching you: a dodge. How far to the side you
    // were (cross product with its direction): the style wants it close.
    if (!b.chargeHit && ahead < -tuning.bullOvershoot) {
      const side = Math.abs((player.x - b.x) * b.dirZ - (player.z - b.z) * b.dirX);
      events.push({ type: 'bullMiss', entityId: b.id, side });
    }
    setState(b, 'skid');
  }
}

/**
 * Other enemies in the way get shoved aside: same test as for you (circle on
 * the ground + heights), then a throw via knockBack (the kick's), out of its
 * path. NO damage: the bull clears the way, it doesn't kill the horde for you
 * (a ghoul thrown this way is still down for a moment, like after a kick).
 * The charge doesn't slow down. Each enemy only once per charge.
 */
function trample(b: BullEntity, others: Entity[]): void {
  const reach = tuning.bullRadius + 0.8;
  for (const o of others) {
    // Not other bulls, and not the Smith: as heavy as a bull.
    if (o.type === 'target' || o.type === 'bull' || o.type === 'smith' || o.state === 'dead' || b.trampled.includes(o.id)) continue;
    const dx = o.x - b.x;
    const dz = o.z - b.z;
    if (Math.hypot(dx, dz) > reach || o.y > b.y + tuning.bullHeight || o.y + 1.5 < b.y) continue;
    b.trampled.push(o.id);
    // Throw: forward along the charge, plus sideways toward the side it was on.
    const side = dx * b.dirZ - dz * b.dirX >= 0 ? 1 : -1;
    let tx = b.dirX + b.dirZ * side;
    let tz = b.dirZ - b.dirX * side;
    const len = Math.hypot(tx, tz);
    tx /= len;
    tz /= len;
    knockBack(o, tx, tz, tuning.bullTrampleKnockback, tuning.bullTrampleLift);
  }
}

function setState(b: BullEntity, state: BullEntity['state']): void {
  b.state = state;
  b.stateTicks = 0;
}

/** Back to walking, with a pause before the next charge. */
function endCharge(b: BullEntity): void {
  setState(b, 'approach');
  b.chargeCooldownTicks = secondsToTicks(tuning.bullChargeCooldown);
}

/** No steering: strong friction on the ground, gravity, collisions. */
function slowDown(b: BullEntity, world: World, dt: number): void {
  if (b.onGround) {
    const k = Math.min(1, 5 * dt);
    b.vx -= b.vx * k;
    b.vz -= b.vz * k;
  }
  b.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(b, tuning.bullRadius, tuning.bullHeight, world.boxes, dt);
  b.onGround = landed;
}

/** Is the straight line to you clear? A ray at knee height (low obstacles count: they'd stop the charge). */
function clearPath(b: BullEntity, player: PlayerState, dist: number, world: World): boolean {
  if (dist < 0.01) return true;
  const dx = (player.x - b.x) / dist;
  const dz = (player.z - b.z) / dist;
  return raycastBoxes(b.x, b.y + PATH_RAY_HEIGHT, b.z, dx, 0, dz, dist, world.boxes) === null;
}
