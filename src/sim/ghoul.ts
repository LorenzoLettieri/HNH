// Ghoul AI: the basic horde enemy (think CoD zombies).
// - Far away, or on a different level: it follows the navigation flow field
//   (nav.ts): walking, jumping across gaps and onto steps, dropping down,
//   and CLIMBING walls to reach you on the rooftops.
// - Close and on your level: it walks straight at you, hopping over low
//   obstacles and going around tall ones.
// - Always: it keeps a little distance from its friends (the horde spreads
//   instead of stacking), and claws you when it gets close (still walking:
//   running past it is not a free pass).
// - A few meters away, with a clear line: it POUNCES. A short crouch with a
//   screech (the warning), then a low, fast leap aimed where you'll be.
//   After landing it needs a moment to get up: the time to punish it.
//      chase ──(2-6 m, in sight)──▶ lunge: crouch ──▶ leap ──(lands)──▶ recover ──▶ chase
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { GhoulEntity, Entity } from './entities';
import type { SimEvent } from './events';
import { launchFromVent, nearestNode, type FlowField, type NavGraph, type NavLink, type NavNode } from './nav';
import { ventUnder } from './props';
import { ghoulSpeed } from './waves';
import { hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** Turn a direction (x, z) by `angle` radians around the vertical axis. */
function rotate(x: number, z: number, angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c - z * s, x * s + z * c];
}

export function stepGhoul(
  g: GhoulEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  g.stateTicks++;
  if (g.attackCooldownTicks > 0) g.attackCooldownTicks--;
  if (g.lungeCooldownTicks > 0) g.lungeCooldownTicks--;
  if (g.detourTicks > 0) g.detourTicks--;

  if (g.climbTo >= 0) {
    climb(g, graph.nodes[g.climbFrom], graph.nodes[g.climbTo], world, dt);
    return;
  }
  if (g.state === 'lunge' || g.state === 'recover') {
    stepLunge(g, player, world, dt, events);
    return;
  }

  // --- 1. Where is it on the graph, and where should it go? ---
  if (g.onGround) {
    const node = nearestNode(graph, g.x, g.y, g.z);
    if (node >= 0) g.navNode = node;
  }
  const distToPlayer = Math.hypot(player.x - g.x, player.z - g.z);
  const sameLevel = Math.abs(player.y - g.y) < 0.8;
  const direct = distToPlayer < tuning.ghoulDirectChaseRange && sameLevel;

  // In "direct" mode the target is the player; otherwise the next node
  // along the flow field. (No link = already at the player's node, or the
  // player is unreachable: fall back to walking straight at them.)
  let link: NavLink | null = null;
  let targetX = player.x;
  let targetZ = player.z;
  if (!direct && g.navNode >= 0 && flow.next[g.navNode]) {
    link = flow.next[g.navNode];
    // For a vent, first walk onto the vent itself (the launch does the rest).
    const t = link!.via ?? graph.nodes[link!.to];
    targetX = t.x;
    targetZ = t.z;
  }

  // --- 2. Wished direction: toward the target, plus separation ---
  let wishX = 0;
  let wishZ = 0;
  if (g.state === 'chase' || g.state === 'attack') {
    const dx = targetX - g.x;
    const dz = targetZ - g.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      wishX = dx / dist;
      wishZ = dz / dist;
    }
    // Going around an obstacle (direct mode only): walk almost parallel to it.
    if (!link && g.detourTicks > 0) [wishX, wishZ] = rotate(wishX, wishZ, g.detourSide * 1.5);

    // Separation: a push away from every ghoul that's too close, stronger the
    // closer it is. Classic "boids" steering: each one only looks at its
    // neighbors, and the crowd spreads out on its own.
    for (const o of others) {
      if (o === g || o.type !== 'ghoul' || o.state === 'dead') continue;
      const ox = g.x - o.x;
      const oz = g.z - o.z;
      const d = Math.hypot(ox, oz);
      if (d > 0.001 && d < tuning.ghoulSeparation) {
        const push = (tuning.ghoulSeparation - d) / tuning.ghoulSeparation;
        wishX += (ox / d) * push * 1.5;
        wishZ += (oz / d) * push * 1.5;
      }
    }
  }

  // --- 3. Accelerate toward the wished velocity (only with feet on the ground) ---
  // While swinging it keeps coming, a bit slower: the swipe can catch you
  // even if you're running past it.
  const speed = ghoulSpeed(g) * (g.state === 'attack' ? tuning.ghoulAttackMoveFactor : 1);
  const len = Math.hypot(wishX, wishZ);
  const targetVx = len > 0 ? (wishX / len) * speed : 0;
  const targetVz = len > 0 ? (wishZ / len) * speed : 0;
  const k = Math.min(1, tuning.ghoulAccel * dt);
  if (g.onGround) {
    g.vx += (targetVx - g.vx) * k;
    g.vz += (targetVz - g.vz) * k;
  }

  // --- 4. Special links: jump or start climbing when in position ---
  if (link && g.onGround && g.state === 'chase') {
    const t = graph.nodes[link.to];
    const here = graph.nodes[g.navNode];
    const toTarget = Math.hypot(t.x - g.x, t.z - g.z);
    if (link.kind === 'jump' && toTarget < 2.8) {
      jumpTo(g, t);
    } else if (link.kind === 'climb' && Math.hypot(here.x - g.x, here.z - g.z) < 1.5) {
      // Close to the foot of the wall (it may already be pressing against it,
      // a bit past the node): start climbing.
      g.climbFrom = g.navNode;
      g.climbTo = link.to;
      g.climbTicks = 0;
      return;
    }
    // VENT: walk onto it; once on the grate, it launches you (from standing
    // still, exactly as the graph simulated). Vents only launch ghouls that
    // CHOSE to ride them: one just crossing the street would otherwise end up
    // stranded on top of a tower.
    // It waits until it's at the CENTER of the grate: that's where the graph
    // simulated the launch, so the prediction matches what really happens.
    // (Launched from the edge, the trajectory shifts and may hit a roof's eave.)
    if (link.kind === 'vent' && link.via && Math.hypot(link.via.x - g.x, link.via.z - g.z) < 0.25) {
      const vent = ventUnder(world.props, g.x, g.y, g.z);
      if (vent) {
        launchFromVent(g, vent);
        g.onGround = false;
      }
    }
    // 'walk' and 'drop' need nothing special: walking off the edge IS dropping.
  }

  g.vy -= tuning.gravity * dt;

  // --- 5. Move with collisions (the same code the player uses) ---
  const wantedSpeed = Math.hypot(targetVx, targetVz);
  const speedBefore = Math.hypot(g.vx, g.vz);
  const { landed } = moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  g.onGround = landed;

  // --- 6. Blocked? Hop over it if it's low, otherwise go around it ---
  // "Blocked" = the COLLISION stopped us (we were moving, now we aren't).
  // (Pushing against a wall, the collision zeroes our speed every tick, so
  // speedBefore stays small: the threshold must be low.)
  const speedAfter = Math.hypot(g.vx, g.vz);
  const blocked = speedBefore > 0.2 && speedAfter < speedBefore * 0.5;
  if (g.state === 'chase' && g.onGround && wantedSpeed > 0.5 && blocked) {
    const aheadX = g.x + (targetVx / wantedSpeed) * 0.4;
    const aheadZ = g.z + (targetVz / wantedSpeed) * 0.4;
    const r = tuning.ghoulRadius;
    // Is there room for its body a jump-height higher, just ahead?
    const lowObstacle = !overlapsAny(aheadX, g.y + tuning.ghoulJumpHeight, aheadZ, r, tuning.ghoulHeight, world.boxes);
    if (lowObstacle) {
      g.vy = Math.sqrt(2 * tuning.gravity * (tuning.ghoulJumpHeight + 0.15));
      g.onGround = false;
    } else if (!link) {
      // Direct mode: start (or keep extending) a detour around the obstacle.
      // The side stays the same (flipping at random would make it dither in
      // place)... unless it stays stuck for a while: then it's in a dead end.
      g.detourTicks = secondsToTicks(1.2);
      g.stuckTicks++;
      if (g.stuckTicks > secondsToTicks(1.5)) {
        g.detourSide = -g.detourSide;
        g.stuckTicks = 0;
      }
    }
  } else if (speedAfter > wantedSpeed * 0.6) {
    g.stuckTicks = 0; // moving freely again
  }

  // --- 7. Pounce from a few meters away (needs feet on the ground and a clear line) ---
  if (
    g.state === 'chase' &&
    g.onGround &&
    g.lungeCooldownTicks === 0 &&
    distToPlayer > tuning.ghoulLungeMinRange &&
    distToPlayer < tuning.ghoulLungeRange &&
    Math.abs(player.y - g.y) < 1 &&
    clearLine(g, player, distToPlayer, world)
  ) {
    g.state = 'lunge';
    g.stateTicks = 0;
    g.lungeHit = false;
    events.push({ type: 'ghoulLunge', entityId: g.id });
    return;
  }

  // --- 8. Attack when close: wind up, then the swipe lands at a precise moment ---
  const sameHeight = Math.abs(player.y - g.y) < 1.5; // can't claw you from below a roof
  if (g.state === 'chase' && distToPlayer < tuning.ghoulAttackRange && sameHeight && g.attackCooldownTicks === 0) {
    g.state = 'attack';
    g.stateTicks = 0;
    events.push({ type: 'ghoulAttack', entityId: g.id });
  }
  const hitTick = Math.round(secondsToTicks(tuning.ghoulAttackTime) * tuning.ghoulHitMoment);
  if (g.state === 'attack' && g.stateTicks === hitTick) {
    // The claws come down: does it still reach you? Moving away during the
    // wind-up dodges the hit: a little window that rewards movement.
    if (distToPlayer < tuning.ghoulAttackRange + 0.4 && sameHeight && player.health > 0) {
      hurtPlayer(player, tuning.ghoulDamage, g.x, g.z, tuning.ghoulKnockback);
      events.push({ type: 'playerHurt', damage: tuning.ghoulDamage, fromX: g.x, fromZ: g.z });
    }
  }
  if (g.state === 'attack' && g.stateTicks >= secondsToTicks(tuning.ghoulAttackTime)) {
    g.state = 'chase';
    g.stateTicks = 0;
    g.attackCooldownTicks = secondsToTicks(tuning.ghoulAttackCooldown);
  }
}

/**
 * The pounce, in three phases (all in the 'lunge' and 'recover' states):
 * 1. crouch (ghoulLungeWindup): it stops and gets ready. The warning.
 * 2. leap: a low ballistic jump toward where you'll be when it lands.
 *    Touching you in the air hurts you (once per leap).
 * 3. recover: landed, it stands still for a moment. Then back to chasing.
 */
function stepLunge(g: GhoulEntity, player: PlayerState, world: World, dt: number, events: SimEvent[]): void {
  const windupTicks = secondsToTicks(tuning.ghoulLungeWindup);
  const onFeet = g.onGround;

  if (g.state === 'lunge' && g.stateTicks === windupTicks) {
    // Launch. Flight time of a jump that starts and ends at the same height:
    // up at vy, gravity brings it back down after t = 2·vy / g.
    const vy = tuning.ghoulLungeUpSpeed;
    const flightTime = Math.max(0.1, (2 * vy) / tuning.gravity);
    // Aim where you'll be when it lands (only part of the way: ghoulLungeLead).
    const lead = flightTime * tuning.ghoulLungeLead;
    const dx = player.x + player.vx * lead - g.x;
    const dz = player.z + player.vz * lead - g.z;
    const dist = Math.hypot(dx, dz) || 1;
    // Horizontal speed to cover that distance in the flight time, capped.
    const hSpeed = Math.min(tuning.ghoulLungeSpeed, dist / flightTime);
    g.vx = (dx / dist) * hSpeed;
    g.vz = (dz / dist) * hSpeed;
    g.vy = vy;
    g.onGround = false;
  } else if (onFeet) {
    // Crouching or getting up: feet planted, it slides to a stop quickly.
    const k = Math.min(1, 12 * dt);
    g.vx -= g.vx * k;
    g.vz -= g.vz * k;
  }

  g.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  g.onGround = landed;

  const airborne = g.state === 'lunge' && g.stateTicks > windupTicks;
  // In the air: did it reach you? Its box against yours, a little generous
  // (claws stretched forward).
  if (airborne && !g.lungeHit && player.health > 0) {
    const reach = tuning.ghoulRadius + tuning.playerRadius + 0.35;
    const touching =
      Math.hypot(player.x - g.x, player.z - g.z) < reach &&
      g.y < player.y + tuning.playerHeight &&
      g.y + tuning.ghoulHeight > player.y;
    if (touching) {
      g.lungeHit = true;
      hurtPlayer(player, tuning.ghoulLungeDamage, g.x, g.z, tuning.ghoulKnockback);
      events.push({ type: 'playerHurt', damage: tuning.ghoulLungeDamage, fromX: g.x, fromZ: g.z });
    }
  }
  // Landed (or flying for way too long, e.g. stuck on an edge): get up.
  if (airborne && (g.onGround || g.stateTicks > windupTicks + secondsToTicks(2))) {
    g.state = 'recover';
    g.stateTicks = 0;
  } else if (g.state === 'recover' && g.stateTicks >= secondsToTicks(tuning.ghoulLungeRecover)) {
    g.state = 'chase';
    g.stateTicks = 0;
    // Next pounce: cooldown + 0-1.5 s, deterministic from the id (like the eye-bat).
    g.lungeCooldownTicks = secondsToTicks(tuning.ghoulLungeCooldown + ((g.id * 7) % 16) * 0.1);
    g.attackCooldownTicks = 0;
  }
}

/** Nothing between its chest and yours? (It won't pounce through a wall or a fence.) */
function clearLine(g: GhoulEntity, player: PlayerState, dist: number, world: World): boolean {
  if (dist < 0.001) return true;
  const chest = 1.1;
  const dx = player.x - g.x;
  const dy = player.y - g.y;
  const dz = player.z - g.z;
  const d = Math.hypot(dx, dy, dz);
  return raycastBoxes(g.x, g.y + chest, g.z, dx / d, dy / d, dz / d, d, world.boxes) === null;
}

/**
 * A jump that lands on `t`: ballistics, the physics of a thrown ball.
 * 1. Pick how high to go: a bit above the higher of start and target.
 * 2. Vertical speed to reach that height: v = √(2·g·h).
 * 3. Flight time = time to go up + time to fall down to the target's height.
 * 4. Horizontal speed = distance / flight time: it lands right on it.
 */
function jumpTo(g: GhoulEntity, t: NavNode): void {
  const G = tuning.gravity;
  const dy = t.y - g.y;
  const peak = Math.max(dy, 0) + 0.7;
  const vy = Math.sqrt(2 * G * peak);
  const flightTime = vy / G + Math.sqrt((2 * (peak - dy)) / G);
  const dx = t.x - g.x;
  const dz = t.z - g.z;
  const dist = Math.hypot(dx, dz) || 1;
  const hSpeed = Math.max(dist / flightTime, 1.5);
  g.vx = (dx / dist) * hSpeed;
  g.vz = (dz / dist) * hSpeed;
  g.vy = vy;
  g.onGround = false;
}

/**
 * Climbing a wall: go straight up at climbing speed (no gravity) along the
 * column above `from` (the graph checked it's free all the way up: no roof
 * eaves to bump into), then, once above the edge, step over onto `to`.
 */
function climb(g: GhoulEntity, from: NavNode, to: NavNode, world: World, dt: number): void {
  g.climbTicks++;
  const above = g.y >= to.y + 0.1;
  // Below the edge: drift toward the free column. Above it: move onto the top.
  const tx = above ? to.x : from.x;
  const tz = above ? to.z : from.z;
  const dx = tx - g.x;
  const dz = tz - g.z;
  const dist = Math.hypot(dx, dz);
  const hSpeed = above ? 2.5 : Math.min(1.5, dist * 4); // slows down as it lines up
  g.vx = dist > 0.01 ? (dx / dist) * hSpeed : 0;
  g.vz = dist > 0.01 ? (dz / dist) * hSpeed : 0;
  g.vy = above ? 0 : tuning.ghoulClimbSpeed;
  moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  // Done: over the edge (or it's been climbing way too long: give up).
  if ((above && dist < 0.8) || g.climbTicks > secondsToTicks(12)) {
    g.climbTo = -1;
    g.onGround = false;
  }
}
