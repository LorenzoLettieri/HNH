// Hellhound AI: an AMBUSH hunter. It doesn't run at you like a ghoul: it
// stalks you at a distance, waits until you're not looking, then charges.
//
//   stalk ──(out of your sight for a moment)──▶ charge (HOWL: the warning)
//     ▲  ▲                                         │   │
//     │  └──────────── skid ◀──(it ran past you)───┘   │ (close)
//     │                                                ▼
//   retreat ◀──(teeth close, hit or miss)────── bite
//
// - STALK: far away, it follows the flow field like the ghouls. Within
//   ~houndStalkDistance it circles around you at that distance, always
//   moving toward your BACK (the side you're not looking at).
// - CHARGE: once it's been out of your view cone (or behind a wall) for
//   houndUnseenTime, it howls and sprints at you at houndChargeSpeed. The
//   howl is the warning (readability pillar): you hear where it comes from,
//   and turning around in time is enough to shoot it or dodge it.
//   It also charges if you let it get too close (cornered), or if it has
//   been stalking for too long (staring at it doesn't keep it away forever).
//   The charge is COMMITTED: at the howl it aims at where you'll be, then it
//   can only bend its run slowly (houndChargeTurnRate), like a real animal
//   at full speed. Running in a straight line doesn't save you (it predicts
//   it); a sidestep or a change of direction at the right moment does.
// - SKID: it ran past you (or into a wall). It brakes, sliding, for a
//   moment: the time to punish it.
// - BITE: a short wind-up, then the teeth close.
// - RETREAT: hit and run. It runs away for a moment, then stalks again.
//
// A dog: it jumps gaps and hops low obstacles, but doesn't climb walls or
// ride vents. When the way to you needs a climb, it waits below.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { Entity, HoundEntity } from './entities';
import type { SimEvent } from './events';
import { interceptTime } from './eyebat';
import { jumpTo } from './ghoul';
import { nearestNode, type FlowField, type NavGraph, type NavLink } from './nav';
import { currentEyeHeight, hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** Height of its "chest" above the feet, meters: where line-of-sight rays start and end. */
const CHEST = 0.6;
/** Max angle it moves around you per step of the stalking ring, radians (see ringTarget). */
const RING_STEP = 0.5;

export function stepHound(
  h: HoundEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  h.stateTicks++;
  if (h.biteCooldownTicks > 0) h.biteCooldownTicks--;

  // Dead or thrown by a kick: no steering, just a falling body.
  if (h.state === 'dead' || h.state === 'staggered') {
    fall(h, world, dt);
    return;
  }

  if (h.onGround) {
    const node = nearestNode(graph, h.x, h.y, h.z);
    if (node >= 0) h.navNode = node;
  }
  const dist = Math.hypot(player.x - h.x, player.z - h.z);
  const sameLevel = Math.abs(player.y - h.y) < 0.8;
  // Are you looking at it? Refreshed 10 times a second (it costs a raycast),
  // staggered by id like the ghouls' line-of-sight check.
  if ((h.stateTicks + h.id) % 6 === 0) h.seen = seenByPlayer(h, player, world);
  h.unseenTicks = h.seen ? 0 : h.unseenTicks + 1;

  // --- 1. Decide: state changes ---
  if (h.state === 'stalk') {
    const inRange = dist < tuning.houndChargeRange && sameLevel && clearPath(h, player, dist, world);
    const ambush = inRange && h.unseenTicks >= secondsToTicks(tuning.houndUnseenTime);
    const cornered = dist < tuning.houndCloseCharge && sameLevel;
    const impatient = inRange && h.stateTicks > secondsToTicks(tuning.houndStalkMaxTime);
    if (ambush || cornered || impatient) {
      setState(h, 'charge');
      // Commit to a direction: at where you'll be.
      const [ax, az] = leadPoint(h, player);
      const ad = Math.hypot(ax - h.x, az - h.z) || 1;
      h.chargeDirX = (ax - h.x) / ad;
      h.chargeDirZ = (az - h.z) / ad;
      events.push({ type: 'houndHowl', entityId: h.id });
    }
  } else if (h.state === 'charge') {
    if (dist < tuning.houndBiteRange && Math.abs(player.y - h.y) < 1.2 && h.biteCooldownTicks === 0) {
      setState(h, 'bite');
      events.push({ type: 'houndBite', entityId: h.id });
    } else if ((player.x - h.x) * h.chargeDirX + (player.z - h.z) * h.chargeDirZ < 0) {
      // You're BEHIND its charge direction (negative dot product): it ran past you.
      setState(h, 'skid');
    } else if (h.stateTicks > secondsToTicks(tuning.houndChargeMaxTime)) {
      setState(h, 'stalk'); // you got away: start over
    }
  } else if (h.state === 'bite') {
    if (h.stateTicks >= secondsToTicks(tuning.houndBiteWindup)) {
      // The teeth close: are you still there? (A bit of extra reach: it lunges with its neck.)
      if (dist < tuning.houndBiteRange + 0.4 && Math.abs(player.y - h.y) < 1.2 && player.health > 0) {
        hurtPlayer(player, tuning.houndBiteDamage, h.x, h.z, tuning.houndBiteKnockback);
        events.push({ type: 'playerHurt', damage: tuning.houndBiteDamage, fromX: h.x, fromZ: h.z });
      }
      setState(h, 'retreat');
      h.biteCooldownTicks = secondsToTicks(tuning.houndBiteCooldown);
    }
  } else if (h.state === 'retreat' && h.stateTicks > secondsToTicks(tuning.houndRetreatTime)) {
    setState(h, 'stalk');
  } else if (h.state === 'skid' && h.stateTicks > secondsToTicks(tuning.houndSkidTime)) {
    setState(h, 'stalk');
  }

  // --- 2. Where to run, and how fast, in each state ---
  let target: [number, number] = [player.x, player.z];
  let link: NavLink | null = null;
  let speed = tuning.houndSpeed;
  if (h.state === 'stalk') {
    const ring = sameLevel && dist < tuning.houndStalkDistance + 4 ? ringTarget(h, player, world) : null;
    if (ring) target = ring;
    else [target, link] = followFlow(h, graph, flow, target);
  } else if (h.state === 'charge') {
    speed = tuning.houndChargeSpeed;
    // Bend the charge toward where you'll be, but at most houndChargeTurnRate.
    // Angles in the same convention as the yaw: direction (sin a, cos a).
    const a = Math.atan2(h.chargeDirX, h.chargeDirZ);
    const [ax, az] = leadPoint(h, player);
    const want = Math.atan2(ax - h.x, az - h.z);
    const diff = Math.atan2(Math.sin(want - a), Math.cos(want - a)); // shortest way round, [-π, π]
    const maxTurn = ((tuning.houndChargeTurnRate * Math.PI) / 180) * dt;
    const turned = a + Math.max(-maxTurn, Math.min(maxTurn, diff));
    h.chargeDirX = Math.sin(turned);
    h.chargeDirZ = Math.cos(turned);
    // A point far ahead along that direction: no path-finding, it's a straight sprint.
    target = [h.x + h.chargeDirX * 10, h.z + h.chargeDirZ * 10];
  } else if (h.state === 'skid') {
    speed = 0; // brakes: the "accelerate toward the wished velocity" below becomes a slow slide to a stop
    target = [h.x, h.z];
  } else if (h.state === 'bite') {
    speed = tuning.houndSpeed * 0.6; // jaws open, it slows down (otherwise it would overshoot you)
  } else {
    // Retreat: straight away from you.
    const d = dist || 1;
    target = [h.x + ((h.x - player.x) / d) * 5, h.z + ((h.z - player.z) / d) * 5];
  }

  // --- 3. Wished direction: toward the target, plus separation ---
  // Same "boids" push as the ghouls, from every ground enemy.
  let wishX = 0;
  let wishZ = 0;
  const dx = target[0] - h.x;
  const dz = target[1] - h.z;
  const toTarget = Math.hypot(dx, dz);
  if (toTarget > 0.3) {
    wishX = dx / toTarget;
    wishZ = dz / toTarget;
  }
  for (const o of others) {
    if (o === h || (o.type !== 'hound' && o.type !== 'ghoul') || o.state === 'dead') continue;
    const ox = h.x - o.x;
    const oz = h.z - o.z;
    const d = Math.hypot(ox, oz);
    if (d > 0.001 && d < tuning.ghoulSeparation) {
      const push = (tuning.ghoulSeparation - d) / tuning.ghoulSeparation;
      wishX += (ox / d) * push * 1.5;
      wishZ += (oz / d) * push * 1.5;
    }
  }

  // --- 4. Accelerate toward the wished velocity (only with feet on the ground) ---
  const len = Math.hypot(wishX, wishZ);
  const targetVx = len > 0 ? (wishX / Math.max(1, len)) * speed : 0;
  const targetVz = len > 0 ? (wishZ / Math.max(1, len)) * speed : 0;
  if (h.onGround) {
    // Skidding the paws slip: a quarter of the grip, so it slides past you.
    const grip = h.state === 'skid' ? tuning.houndAccel * 0.25 : tuning.houndAccel;
    const k = Math.min(1, grip * dt);
    h.vx += (targetVx - h.vx) * k;
    h.vz += (targetVz - h.vz) * k;
    // Jump links (gaps, steps): the same ballistic jump as the ghoul.
    if (link && link.kind === 'jump' && toTarget < 3) jumpTo(h, graph.nodes[link.to]);
  }
  h.vy -= tuning.gravity * dt;

  // --- 5. Move; if a low obstacle stopped it, hop over ---
  const speedBefore = Math.hypot(h.vx, h.vz);
  const { landed } = moveAndCollide(h, tuning.houndRadius, tuning.houndHeight, world.boxes, dt);
  h.onGround = landed;
  const blocked = speedBefore > 0.2 && Math.hypot(h.vx, h.vz) < speedBefore * 0.5;
  if (h.onGround && blocked && len > 0) {
    const aheadX = h.x + (wishX / len) * 0.4;
    const aheadZ = h.z + (wishZ / len) * 0.4;
    const room = !overlapsAny(aheadX, h.y + tuning.houndJumpHeight, aheadZ, tuning.houndRadius, tuning.houndHeight, world.boxes);
    if (room) {
      h.vy = Math.sqrt(2 * tuning.gravity * (tuning.houndJumpHeight + 0.15));
      h.onGround = false;
    } else if (h.state === 'charge') {
      setState(h, 'skid'); // ran into a wall it can't hop: dazed for a moment
    }
  }
}

/**
 * Where to charge: where you'll be when it gets there, if you keep going the
 * same way. interceptTime (from eyebat.ts) solves "when do a runner at
 * houndChargeSpeed and you meet?"; then you + your velocity × that time
 * × houndLeadFactor. That's why only a CHANGE of direction makes it miss.
 */
function leadPoint(h: HoundEntity, player: PlayerState): [number, number] {
  const t = interceptTime(player.x - h.x, 0, player.z - h.z, player.vx, 0, player.vz, tuning.houndChargeSpeed);
  const lead = t * tuning.houndLeadFactor;
  return [player.x + player.vx * lead, player.z + player.vz * lead];
}

function setState(h: HoundEntity, state: HoundEntity['state']): void {
  h.state = state;
  h.stateTicks = 0;
}

/**
 * Next point along the flow field (the ghouls' shared map of "which way to
 * the player"). Climbs and vents are for ghouls: in that case, or with no
 * path at all, it keeps the fallback target.
 */
function followFlow(
  h: HoundEntity,
  graph: NavGraph,
  flow: FlowField,
  fallback: [number, number],
): [[number, number], NavLink | null] {
  const next = h.navNode >= 0 ? flow.next[h.navNode] : null;
  if (!next || next.kind === 'climb' || next.kind === 'vent') return [fallback, null];
  const n = graph.nodes[next.to];
  return [[n.x, n.z], next];
}

/**
 * Stalking: a point on a circle around you (radius houndStalkDistance),
 * a bit further around toward your BACK than where the hound is now.
 *
 * Angles around you use the same convention as the player's yaw: a point at
 * angle a is at (sin a, cos a) from you. You look toward (−sin yaw, −cos yaw),
 * so your back is exactly at angle `yaw`. The hound is at angle `here`; it
 * moves at most RING_STEP toward `yaw` each time: it circles around you
 * instead of cutting through your field of view.
 *
 * Returns null if that point is inside a wall or the way there is blocked:
 * then it follows the flow field instead.
 */
function ringTarget(h: HoundEntity, player: PlayerState, world: World): [number, number] | null {
  const here = Math.atan2(h.x - player.x, h.z - player.z);
  // Shortest signed angle from here to your back, in [-π, π].
  const diff = Math.atan2(Math.sin(player.yaw - here), Math.cos(player.yaw - here));
  // Right in front of you (diff ≈ ±π) "left" and "right" are equally good:
  // a fixed side per hound, otherwise it would dither between the two.
  const step = Math.abs(diff) > 2.8 ? h.stalkSide * RING_STEP : Math.max(-RING_STEP, Math.min(RING_STEP, diff));
  const a = here + step;
  const tx = player.x + Math.sin(a) * tuning.houndStalkDistance;
  const tz = player.z + Math.cos(a) * tuning.houndStalkDistance;
  const rx = tx - h.x;
  const rz = tz - h.z;
  const rd = Math.hypot(rx, rz);
  const blocked =
    overlapsAny(tx, h.y + 0.05, tz, tuning.houndRadius, tuning.houndHeight, world.boxes) ||
    (rd > 0.01 && raycastBoxes(h.x, h.y + tuning.houndJumpHeight + 0.2, h.z, rx / rd, 0, rz / rd, rd, world.boxes) !== null);
  return blocked ? null : [tx, tz];
}

/**
 * Are you looking at it? Two tests:
 * 1. Angle: the direction to the hound is within houndSeenAngle of where you
 *    look (horizontal only). The cosine of the angle between two unit
 *    vectors is their dot product: compare it with cos(houndSeenAngle).
 * 2. Nothing in between: a ray from your eyes to its chest.
 */
function seenByPlayer(h: HoundEntity, player: PlayerState, world: World): boolean {
  const dx = h.x - player.x;
  const dz = h.z - player.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  const lookX = -Math.sin(player.yaw);
  const lookZ = -Math.cos(player.yaw);
  const cos = (dx / d) * lookX + (dz / d) * lookZ;
  if (cos < Math.cos((tuning.houndSeenAngle * Math.PI) / 180)) return false;
  const ey = player.y + currentEyeHeight(player);
  const dy = h.y + CHEST - ey;
  const len = Math.hypot(dx, dy, dz);
  return raycastBoxes(player.x, ey, player.z, dx / len, dy / len, dz / len, len, world.boxes) === null;
}

/** Can it run straight at you? A ray at knee height (low obstacles are fine: it hops them). */
function clearPath(h: HoundEntity, player: PlayerState, dist: number, world: World): boolean {
  if (dist < 0.01) return true;
  const dx = (player.x - h.x) / dist;
  const dz = (player.z - h.z) / dist;
  return raycastBoxes(h.x, h.y + tuning.houndJumpHeight + 0.2, h.z, dx, 0, dz, dist, world.boxes) === null;
}

/**
 * No steering: gravity, collisions and friction on the ground. Used when
 * thrown (kick, shotgun) and when dead (a hound shot in mid-jump falls,
 * it doesn't hang in the air). Thrown: back on its feet kickStun seconds
 * after landing, then it backs off (retreat) and starts stalking again.
 */
function fall(h: HoundEntity, world: World, dt: number): void {
  if (h.onGround) {
    const k = Math.min(1, 8 * dt);
    h.vx -= h.vx * k;
    h.vz -= h.vz * k;
  } else if (h.state === 'staggered') {
    h.stateTicks = 0; // still flying: the "down" timer hasn't started
  }
  h.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(h, tuning.houndRadius, tuning.houndHeight, world.boxes, dt);
  h.onGround = landed;
  if (h.state === 'staggered' && h.onGround && h.stateTicks >= secondsToTicks(tuning.kickStun)) {
    setState(h, 'retreat'); // kicked away: it backs off, then stalks again
    h.biteCooldownTicks = secondsToTicks(0.3);
  }
}
