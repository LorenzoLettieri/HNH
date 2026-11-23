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
// - When it SEES you on its own level (pursuit mode): it doesn't follow your
//   footsteps, it runs to where you're GOING (cutting you off), each ghoul
//   aiming a bit to one side of you: the horde fans out and surrounds you
//   instead of forming a conga line behind you.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, TICK_DT, tuning } from './config';
import type { GhoulEntity, Entity } from './entities';
import type { SimEvent } from './events';
import { launchFromVent, nearestNode, type FlowField, type NavGraph, type NavLink, type NavNode } from './nav';
import { ventUnder } from './props';
import { ghoulSpeed, lerp } from './waves';
import { hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { Box, World } from './world';

/** Air control: the horizontal speed it can reach on its own in mid-air, m/s, and how fast, m/s². */
const GHOUL_AIR_SPEED = 1.5;
const GHOUL_AIR_ACCEL = 10;

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
  /** How aggressive the current wave is, 0-1 (see wavePressure in waves.ts). */
  pressure = 0,
): void {
  g.stateTicks++;
  if (g.attackCooldownTicks > 0) g.attackCooldownTicks--;
  if (g.lungeCooldownTicks > 0) g.lungeCooldownTicks--;
  if (g.detourTicks > 0) g.detourTicks--;

  if (g.climbTo >= 0) {
    climbWall(g, graph.nodes[g.climbFrom], graph.nodes[g.climbTo], tuning.ghoulRadius, tuning.ghoulHeight, tuning.ghoulClimbSpeed, world, dt);
    return;
  }
  if (g.state === 'lunge' || g.state === 'recover') {
    stepLunge(g, player, world, dt, events, pressure);
    return;
  }
  if (g.state === 'staggered') {
    stepStaggered(g, world, dt);
    return;
  }

  // --- 1. Where is it on the graph, and where should it go? ---
  if (g.onGround) {
    const node = nearestNode(graph, g.x, g.y, g.z);
    if (node >= 0) g.navNode = node;
  }
  const distToPlayer = Math.hypot(player.x - g.x, player.z - g.z);
  const sameLevel = Math.abs(player.y - g.y) < 0.8;
  // Can it see you? A raycast is the most expensive thing here, so it's
  // refreshed only every 6 ticks (10 times a second: plenty for a zombie),
  // staggered by id so the ghouls don't all do it on the same tick.
  if ((g.stateTicks + g.id) % 6 === 0) {
    g.seesPlayer = sameLevel && distToPlayer < tuning.ghoulPursuitRange && clearLine(g, player, distToPlayer, world);
  }
  // Close by, it walks straight at you... only if it SEES you. Through a wall
  // the straight line leads nowhere: it would press against it forever,
  // while the graph knows the way around (the door).
  const direct = distToPlayer < tuning.ghoulDirectChaseRange && sameLevel && g.seesPlayer;
  const pursuit = !direct && g.onGround && sameLevel && g.seesPlayer;

  // In "direct" mode the target is the player; in "pursuit" mode a point
  // ahead of you and to one side (see pursuitTarget); otherwise the next
  // node along the flow field. (No link = already at the player's node, or
  // the player is unreachable: fall back to walking straight at them.)
  let link: NavLink | null = null;
  let targetX = player.x;
  let targetZ = player.z;
  if (pursuit) {
    [targetX, targetZ] = pursuitTarget(g, player, distToPlayer, world);
  } else if (!direct && g.navNode >= 0 && flow.next[g.navNode]) {
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

  // --- 3. Accelerate toward the wished velocity ---
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
  } else if (len > 0 && link?.kind !== 'vent') {
    // AIR CONTROL, a little, Quake style (like the player's air acceleration):
    // it can ADD speed toward where it wants to go, up to GHOUL_AIR_SPEED,
    // never brake. A ballistic jump (already faster than that toward its
    // target) flies untouched; but a ghoul that jumped while pressed against
    // the wall under a window sill (the collision zeroed its forward speed on
    // the first tick) gets pushing forward again, and as soon as it's higher
    // than the sill it's over it. Not on a vent: that flight was simulated
    // in advance, and the target is still the grate behind it.
    const wx = wishX / len;
    const wz = wishZ / len;
    const along = g.vx * wx + g.vz * wz; // speed it already has in that direction (dot product)
    const add = Math.min(GHOUL_AIR_SPEED - along, GHOUL_AIR_ACCEL * dt);
    if (add > 0) {
      g.vx += wx * add;
      g.vz += wz * add;
    }
  }

  // --- 4. Special links: jump or start climbing when in position ---
  if (link && g.onGround && g.state === 'chase') {
    const t = graph.nodes[link.to];
    const here = graph.nodes[g.navNode];
    const toTarget = Math.hypot(t.x - g.x, t.z - g.z);
    if (link.kind === 'jump' && toTarget < 2.8) {
      jumpTo(g, t, world.boxes, tuning.ghoulRadius, tuning.ghoulHeight);
    } else if (link.kind === 'climb' && Math.hypot(here.x - g.x, here.z - g.z) < 1.5) {
      // Close to the foot of the wall (it may already be pressing against it,
      // a bit past the node): start climbing.
      g.climbFrom = g.navNode;
      g.climbTo = link.to;
      g.climbTicks = 0;
      return;
    }
    // VENT: walk onto the grate, and it launches you (see rideVent).
    rideVent(g, link, world);
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
      // ...and FORWARD: the collision that stopped us has just zeroed the
      // speed toward the obstacle, and in the air there's no steering. Without
      // this it jumps straight up in front of a window sill, lands in the same
      // spot, and jumps again, forever.
      g.vx = targetVx;
      g.vz = targetVz;
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
    clearLine(g, player, distToPlayer, world) &&
    roomToLunge(g, player, distToPlayer, world)
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
function stepLunge(g: GhoulEntity, player: PlayerState, world: World, dt: number, events: SimEvent[], pressure: number): void {
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
    const reach = tuning.ghoulRadius + tuning.playerRadius + tuning.ghoulLungeReach;
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
    // Next pounce: cooldown (shorter in later waves) + 0-1.5 s, deterministic
    // from the id (like the eye-bat).
    const cooldown = tuning.ghoulLungeCooldown * lerp(1, tuning.peakLungeCooldownFactor, pressure);
    g.lungeCooldownTicks = secondsToTicks(cooldown + ((g.id * 7) % 16) * 0.1);
    g.attackCooldownTicks = 0;
  }
}

/**
 * Kicked (see kick.ts): no steering at all, it's just a falling body.
 * Gravity + collisions, like a thrown ball; on the ground it slides to a stop
 * (friction), and stays down for kickStun seconds after landing.
 * The timer counts only on the ground: kicked off a roof, it doesn't get up
 * in mid-air.
 */
function stepStaggered(g: GhoulEntity, world: World, dt: number): void {
  if (g.onGround) {
    const k = Math.min(1, 8 * dt);
    g.vx -= g.vx * k;
    g.vz -= g.vz * k;
  } else {
    g.stateTicks = 0; // still flying: the "down" timer hasn't started
  }
  g.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  g.onGround = landed;
  if (g.onGround && g.stateTicks >= secondsToTicks(tuning.kickStun)) {
    g.state = 'chase';
    g.stateTicks = 0;
    g.attackCooldownTicks = secondsToTicks(0.3); // a moment to get its bearings
  }
}

/**
 * Pursuit: where to run when it sees you. Two ideas, added together:
 * 1. INTERCEPT: not where you are, but where you'll be by the time it gets
 *    there (your velocity × the time it needs, capped). Like a dog that
 *    cuts the corner instead of running behind the ball.
 * 2. FLANK: each ghoul aims a few meters to one side of that point
 *    (perpendicular to its line toward you). Its side and distance come
 *    from its id, so a group spreads in a fan. The offset shrinks as it
 *    gets close: at the end they all close in on you, from different sides.
 * If that point is inside a wall, or the way there is blocked, it falls
 * back to running straight at you.
 */
function pursuitTarget(g: GhoulEntity, player: PlayerState, dist: number, world: World): [number, number] {
  const lead = Math.min(dist / ghoulSpeed(g), tuning.ghoulPursuitMaxLead) * tuning.ghoulPursuitLead;
  let tx = player.x + player.vx * lead;
  let tz = player.z + player.vz * lead;
  // Unit vector from the ghoul toward the point, and its perpendicular (−z, x).
  const dx = tx - g.x;
  const dz = tz - g.z;
  const d = Math.hypot(dx, dz) || 1;
  // A value in [-1, 1] that's different for every id: the "golden ratio"
  // trick (id × 0.618..., keep the decimals) spreads them evenly.
  const side = ((g.id * 0.6180339) % 1) * 2 - 1;
  const offset = side * Math.min(tuning.ghoulFlankDistance, dist * 0.4);
  tx += (-dz / d) * offset;
  tz += (dx / d) * offset;
  // Is the spot reachable in a straight line? (Ray at knee height: low
  // obstacles are fine, it hops over them.)
  const rx = tx - g.x;
  const rz = tz - g.z;
  const rd = Math.hypot(rx, rz);
  const r = tuning.ghoulRadius;
  const blocked =
    overlapsAny(tx, g.y + 0.05, tz, r, tuning.ghoulHeight, world.boxes) ||
    (rd > 0.01 && raycastBoxes(g.x, g.y + tuning.ghoulJumpHeight + 0.2, g.z, rx / rd, 0, rz / rd, rd, world.boxes) !== null);
  return blocked ? [player.x, player.z] : [tx, tz];
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
 * Is there room for its whole BODY along the straight line to you? clearLine
 * only looks from chest to chest: through a window you can see each other,
 * but the leap is low and slams into the wall under the sill (then it gets
 * up, sees you again, and leaps again, forever). So we also slide its
 * collider along the line, every half meter, a little above its feet (low
 * bumps like a porch step don't count).
 */
function roomToLunge(g: GhoulEntity, player: PlayerState, dist: number, world: World): boolean {
  const steps = Math.ceil(dist / 0.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = g.x + (player.x - g.x) * t;
    const z = g.z + (player.z - g.z) * t;
    if (overlapsAny(x, g.y + 0.3, z, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes)) return false;
  }
  return true;
}

/** What jumpTo needs from a body: position, velocity, feet. (Ghouls and hounds both have them.) */
interface JumpingBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

/**
 * How high above the higher of start and target a jump may go, meters, best
 * first. 0.7 is the comfortable arc; the lower ones are for tight spots: a
 * window is 2.2 m tall, and a 1.8 m ghoul jumping 0.7 m above the sill
 * bangs its head on the lintel, falls back and tries again forever.
 */
const JUMP_PEAKS = [0.7, 0.55, 0.4, 0.3, 0.2, 0.12];

/**
 * How close to the center of the grate a body must be to get launched, meters.
 * Steering toward a point, stop wishing to move only inside this radius,
 * or it stops just short of it.
 */
export const VENT_RIDE_RADIUS = 0.25;

/**
 * Riding a vent (ghouls, hounds, bulls): when the next link is a vent and the
 * body is at the CENTER of the grate, it's launched (from standing still,
 * exactly as the graph simulated: so the prediction matches what really
 * happens; launched from the edge, the trajectory shifts and may hit a
 * roof's eave). Vents only launch enemies that CHOSE to ride them: one just
 * crossing the street would otherwise end up stranded on top of a tower.
 * Returns whether it took off.
 */
export function rideVent(b: JumpingBody, link: NavLink | null, world: World): boolean {
  if (!link || link.kind !== 'vent' || !link.via || !b.onGround) return false;
  if (Math.hypot(link.via.x - b.x, link.via.z - b.z) >= VENT_RIDE_RADIUS) return false;
  const vent = ventUnder(world.props, b.x, b.y, b.z);
  if (!vent) return false;
  launchFromVent(b, vent);
  b.onGround = false;
  return true;
}
/** Closer than this to the target, it jumps even if no arc checks out (better than freezing). */
const JUMP_FORCE_DIST = 1.2;

/**
 * A jump that lands on `t`: ballistics, the physics of a thrown ball.
 * 1. Pick how high to go: a bit above the higher of start and target.
 * 2. Vertical speed to reach that height: v = √(2·g·h).
 * 3. Flight time = time to go up + time to fall down to the target's height.
 * 4. Horizontal speed = distance / flight time: it lands right on it.
 *
 * ...on paper. The math knows nothing about ceilings and lintels, so before
 * jumping we SIMULATE the jump (same physics, same collisions as the real
 * one, like the graph does for the vents) and keep the first arc, from the
 * highest down, that really lands on the target. None does? From far away it
 * doesn't jump at all and keeps walking closer (from nearer, a lower arc
 * fits); from close by it jumps anyway with the default arc.
 * `boxes`, `radius`, `height`: the level and the body's collider.
 * Returns whether it jumped.
 */
export function jumpTo(g: JumpingBody, t: NavNode, boxes: Box[], radius: number, height: number): boolean {
  const dist = Math.hypot(t.x - g.x, t.z - g.z);
  // Each arc twice: with the usual minimum push forward (it helps to clear
  // edges), then without it, purely ballistic: from right under a window sill
  // that push would carry it past the sill, while a jump almost straight up
  // lands on it.
  for (const minSpeed of [JUMP_MIN_SPEED, 0]) {
    for (const peak of JUMP_PEAKS) {
      const v = jumpVelocity(g, t, peak, minSpeed);
      if (landsOn(g, v, t, boxes, radius, height)) {
        launch(g, v);
        return true;
      }
    }
  }
  if (dist > JUMP_FORCE_DIST) return false;
  launch(g, jumpVelocity(g, t, JUMP_PEAKS[0], JUMP_MIN_SPEED));
  return true;
}

/** Minimum horizontal speed of a jump, m/s. */
const JUMP_MIN_SPEED = 1.5;

/** The launch velocity of a ballistic jump from `g` onto `t`, going `peak` meters above the higher of the two. */
function jumpVelocity(g: JumpingBody, t: NavNode, peak: number, minSpeed: number): { vx: number; vy: number; vz: number } {
  const G = tuning.gravity;
  const dy = t.y - g.y;
  const top = Math.max(dy, 0) + peak;
  const vy = Math.sqrt(2 * G * top);
  const flightTime = vy / G + Math.sqrt((2 * (top - dy)) / G);
  const dx = t.x - g.x;
  const dz = t.z - g.z;
  const dist = Math.hypot(dx, dz) || 1;
  const hSpeed = Math.max(dist / flightTime, minSpeed);
  return { vx: (dx / dist) * hSpeed, vy, vz: (dz / dist) * hSpeed };
}

function launch(g: JumpingBody, v: { vx: number; vy: number; vz: number }): void {
  g.vx = v.vx;
  g.vy = v.vy;
  g.vz = v.vz;
  g.onGround = false;
}

/**
 * Does a jump with this velocity land on `t`? A "ghost" copy of the body
 * flies tick by tick (gravity, then the move with collisions: the same
 * order as the real step) until it touches down, at most 2 seconds.
 */
function landsOn(
  g: JumpingBody,
  v: { vx: number; vy: number; vz: number },
  t: NavNode,
  boxes: Box[],
  radius: number,
  height: number,
): boolean {
  const ghost = { x: g.x, y: g.y, z: g.z, ...v };
  for (let tick = 0; tick < 2 / TICK_DT; tick++) {
    ghost.vy -= tuning.gravity * TICK_DT;
    if (moveAndCollide(ghost, radius, height, boxes, TICK_DT).landed) {
      return Math.abs(ghost.y - t.y) < 0.15 && Math.hypot(ghost.x - t.x, ghost.z - t.z) < 0.75;
    }
  }
  return false;
}

/** What climbWall needs: a body that can be partway up a wall (ghouls and sharpshooters). */
export interface ClimbingBody extends JumpingBody {
  /** The node at the top it's climbing to (-1 = not climbing). */
  climbTo: number;
  climbTicks: number;
}

/**
 * Climbing a wall: go straight up at climbing `speed` (no gravity) along the
 * column above `from` (the graph checked it's free all the way up: no roof
 * eaves to bump into), then, once above the edge, step over onto `to`.
 * `radius` and `height`: the body's collider.
 */
export function climbWall(
  g: ClimbingBody,
  from: NavNode,
  to: NavNode,
  radius: number,
  height: number,
  speed: number,
  world: World,
  dt: number,
): void {
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
  g.vy = above ? 0 : speed;
  moveAndCollide(g, radius, height, world.boxes, dt);
  // Done: over the edge (or it's been climbing way too long: give up).
  if ((above && dist < 0.8) || g.climbTicks > secondsToTicks(12)) {
    g.climbTo = -1;
    g.onGround = false;
  }
}
