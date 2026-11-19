// Sharpshooter AI: a skeleton with a cowboy hat and a Winchester. It doesn't
// chase you: it goes up to a high spot (a "perch") and SHOOTS you from afar.
// A fast bullet (much faster than a fireball), so the fairness is all in the
// WARNING (docs/DESIGN.md, "leggibilità"): a red laser shows exactly where
// the rifle points.
//
//   move ──(on its perch, or nowhere better to go)──▶ idle ──(cooldown over, you're in sight)──▶ aim
//    ▲                                                 │ ▲                                         │
//    └────(hasn't seen you for RelocateTime)───────────┘ └──── fires the bullet ◀──── lock ◀──────┘
//
// - MOVE: choose a perch (perch.ts: high up, at the right distance, with a
//   view of you) and go there along the ghouls' navigation graph: walking,
//   jumping, dropping, climbing walls, riding vents. It doesn't shoot while
//   it moves: that's your chance to close in (or to shoot it off a wall).
// - IDLE: laser off, the rifle getting ready. If it can't see you for a while
//   (you hid, you went elsewhere), it looks for a new perch.
// - AIM: the laser glides toward where you WILL be when the bullet arrives
//   (the same "lead" as the eye-bat). Lose its line of sight for a moment
//   and it gives up.
// - LOCK: the laser freezes. The bullet will go exactly there: it's your cue
//   to change direction (jump, slide, cut back). Keep running straight and
//   the lead gets you; stand still and the laser is on you.
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { SharpshooterEntity } from './entities';
import type { SimEvent } from './events';
import { interceptTime } from './eyebat';
import type { GameState } from './game';
import { climbWall, jumpTo } from './ghoul';
import { computeFlowField, launchFromVent, nearestNode, type FlowField, type NavGraph, type NavLink } from './nav';
import { choosePerch, clearShot } from './perch';
import { currentHeight, type PlayerState } from './player';
import { ventUnder } from './props';
import type { World } from './world';

/**
 * How far in front of its body the muzzle is, meters (along the aim).
 *
 * Small on purpose: the sharpshooter is drawn as a flat sprite that faces
 * you (a cardboard cutout), and when it aims at you the muzzle you SEE is
 * painted on that cardboard. A point 0.55 m in front of the cardboard would
 * line up with the painted muzzle only seen straight on: from a roof or from
 * below, perspective shifts it (parallax) and the laser would come out of its
 * belly. 0.1 m keeps the two together from any angle, and keeps the muzzle
 * inside its collider (never inside a wall it stands against).
 */
const MUZZLE_FORWARD = 0.1;
/** On the ground it stops quickly (pushed by a kick, it slides a bit), 1/s. */
const GROUND_FRICTION = 8;
/** Walking: how quickly it reaches its speed or turns (1/s, like ghoulAccel). */
const WALK_ACCEL = 8;
/** On its perch when its feet are this close to the node, meters. */
const ARRIVE_DIST = 0.4;
/** Just arrived: it takes position for this long before it can aim, seconds. */
const SETTLE_TIME = 0.6;

export function stepSharpshooter(
  s: SharpshooterEntity,
  game: GameState,
  world: World,
  graph: NavGraph,
  dt: number,
  events: SimEvent[],
): void {
  const player = game.player;
  s.stateTicks++;
  if (s.shootCooldownTicks > 0) s.shootCooldownTicks--;

  // Partway up a wall: nothing else until it's over the edge (a dead one just falls).
  if (s.state === 'dead') s.climbTo = -1;
  if (s.climbTo >= 0) {
    const from = graph.nodes[s.climbFrom];
    const to = graph.nodes[s.climbTo];
    climbWall(s, from, to, tuning.sharpshooterRadius, tuning.sharpshooterHeight, tuning.sharpshooterClimbSpeed, world, dt);
    return;
  }
  // Where is it on the graph? (Only with its feet down: in the air it keeps the last one.)
  if (s.onGround) {
    const node = nearestNode(graph, s.x, s.y, s.z);
    if (node >= 0) s.navNode = node;
  }
  if (s.state === 'move') {
    stepMove(s, game, world, graph, dt);
    return;
  }

  // Standing: gravity and friction (pushed by a kick, it slides a bit).
  if (s.onGround) {
    const k = Math.min(1, GROUND_FRICTION * dt);
    s.vx -= s.vx * k;
    s.vz -= s.vz * k;
  }
  s.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(s, tuning.sharpshooterRadius, tuning.sharpshooterHeight, world.boxes, dt);
  s.onGround = landed;
  if (s.state === 'dead') return;

  if (s.state === 'idle') {
    // Laser off: the rifle simply turns toward you (the renderer uses the aim
    // to know which way it faces).
    pointAt(s, player.x, chestY(player), player.z, Math.PI);
    const sees = player.health > 0 && canSee(s, player, world);
    s.unseenTicks = sees ? 0 : s.unseenTicks + 1;
    if (s.onGround && s.unseenTicks >= secondsToTicks(tuning.sharpshooterRelocateTime)) {
      // It's lost you: this spot is useless now, time to find a better one.
      s.unseenTicks = 0;
      s.perchNode = -1;
      setState(s, 'move');
      return;
    }
    if (s.shootCooldownTicks === 0 && sees) {
      setState(s, 'aim');
      s.lostSightTicks = 0;
      events.push({ type: 'sharpshooterAim', entityId: s.id });
    }
    return;
  }

  if (s.state === 'aim') {
    if (canSee(s, player, world)) {
      s.lostSightTicks = 0;
      // Follow where you'll be. The rifle doesn't SNAP onto that point: it
      // turns toward it at most TurnRate degrees per second, so a sudden cut
      // leaves the laser behind for a moment, and you can see it catching up.
      const [tx, ty, tz] = leadPoint(s, player);
      pointAt(s, tx, ty, tz, ((tuning.sharpshooterTurnRate * Math.PI) / 180) * dt);
    } else if (++s.lostSightTicks >= secondsToTicks(tuning.sharpshooterLoseSightTime)) {
      // You ducked behind a wall: it gives up, and tries again soon.
      setState(s, 'idle');
      s.shootCooldownTicks = secondsToTicks(0.5);
      return;
    }
    if (s.stateTicks >= secondsToTicks(tuning.sharpshooterAimTime)) {
      setState(s, 'lock');
      events.push({ type: 'sharpshooterLock', entityId: s.id });
    }
    return;
  }

  // LOCK: the aim doesn't move any more. Even if you hide now, it fires
  // anyway (into the wall): the decision was taken.
  if (s.stateTicks >= secondsToTicks(tuning.sharpshooterLockTime)) {
    fire(s, game, events);
    setState(s, 'idle');
    // Next aim: the interval plus 0-1 s, "random" but deterministic (id and tick).
    const jitter = ((s.id * 41 + game.tick) % 60) / 60;
    s.shootCooldownTicks = secondsToTicks(tuning.sharpshooterShootInterval + jitter);
  }
}

function setState(s: SharpshooterEntity, state: SharpshooterEntity['state']): void {
  s.state = state;
  s.stateTicks = 0;
}

/** Where the laser and the bullet start: the rifle's muzzle. Also used by the renderer. */
export function muzzlePosition(s: SharpshooterEntity): [number, number, number] {
  // In front of the body along the aim, but only horizontally: aiming
  // up or down the muzzle stays at shoulder height.
  const h = Math.hypot(s.aimX, s.aimZ) || 1;
  return [
    s.x + (s.aimX / h) * MUZZLE_FORWARD,
    s.y + tuning.sharpshooterMuzzleHeight,
    s.z + (s.aimZ / h) * MUZZLE_FORWARD,
  ];
}

/** Where it aims on your body: the chest (a big target, like the eye-bat's fireball). */
function chestY(p: PlayerState): number {
  return p.y + currentHeight(p) * 0.6;
}

/**
 * Turns the aim toward a point, by at most `maxAngle` radians.
 *
 * Why a speed limit and not "a fraction of the way each tick" (the smooth
 * lerp we use elsewhere)? A lerp chasing a MOVING point always stays behind
 * it by the same amount (speed / rate: here about 1 m), so it would miss
 * anyone running straight. With a speed limit it's exact as long as it can
 * keep up, and late only when you move faster than it can turn.
 *
 * The angle between two unit vectors is acos of their dot product. To turn
 * part of the way we blend the two vectors and normalize again ("nlerp"):
 * not exactly the same angle as a true rotation, but close enough for the
 * small steps of one tick, and no yaw/pitch angles involved (no wrap-around at ±180°).
 */
function pointAt(s: SharpshooterEntity, tx: number, ty: number, tz: number, maxAngle: number): void {
  const [mx, my, mz] = muzzlePosition(s);
  const dx = tx - mx;
  const dy = ty - my;
  const dz = tz - mz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.001) return;
  const dot = Math.max(-1, Math.min(1, s.aimX * (dx / d) + s.aimY * (dy / d) + s.aimZ * (dz / d)));
  const angle = Math.acos(dot);
  const k = angle <= maxAngle ? 1 : maxAngle / angle;
  const ax = s.aimX + (dx / d - s.aimX) * k;
  const ay = s.aimY + (dy / d - s.aimY) * k;
  const az = s.aimZ + (dz / d - s.aimZ) * k;
  const len = Math.hypot(ax, ay, az) || 1;
  s.aimX = ax / len;
  s.aimY = ay / len;
  s.aimZ = az / len;
}

/**
 * Where you'll be when the bullet arrives, if it locked RIGHT NOW: the lock
 * time (the rifle waits that long before firing) plus the bullet's flight
 * (intercept, as for the eye-bat). Only your horizontal velocity: a jump
 * is a curve, leading it would aim over your head.
 */
function leadPoint(s: SharpshooterEntity, p: PlayerState): [number, number, number] {
  const [mx, my, mz] = muzzlePosition(s);
  const px = p.x + p.vx * tuning.sharpshooterLockTime;
  const pz = p.z + p.vz * tuning.sharpshooterLockTime;
  const py = chestY(p);
  const flight = interceptTime(px - mx, py - my, pz - mz, p.vx, 0, p.vz, tuning.sharpshooterBulletSpeed);
  const t = (tuning.sharpshooterLockTime + flight) * tuning.sharpshooterLeadFactor;
  return [p.x + p.vx * t, py, p.z + p.vz * t];
}

/** Are you in range, with no wall between its rifle and your chest? */
function canSee(s: SharpshooterEntity, p: PlayerState, world: World): boolean {
  const [mx, my, mz] = muzzlePosition(s);
  const dx = p.x - mx;
  const dy = chestY(p) - my;
  const dz = p.z - mz;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > tuning.sharpshooterRange || dist < 0.001) return false;
  return raycastBoxes(mx, my, mz, dx / dist, dy / dist, dz / dist, dist, world.boxes) === null;
}

/** Fires along the (locked) aim: the bullet goes exactly where the laser points. */
function fire(s: SharpshooterEntity, game: GameState, events: SimEvent[]): void {
  const [mx, my, mz] = muzzlePosition(s);
  const v = tuning.sharpshooterBulletSpeed;
  const id = game.nextEntityId++;
  game.projectiles.push({
    id,
    kind: 'bullet',
    damage: tuning.sharpshooterBulletDamage,
    knockback: tuning.sharpshooterBulletKnockback,
    radius: tuning.sharpshooterBulletRadius,
    x: mx,
    y: my,
    z: mz,
    px: mx,
    py: my,
    pz: mz,
    vx: s.aimX * v,
    vy: s.aimY * v,
    vz: s.aimZ * v,
    // Long enough to cross its whole range, and a bit more.
    ticksLeft: secondsToTicks((tuning.sharpshooterRange * 1.5) / v),
  });
  events.push({ type: 'sharpshooterShot', entityId: s.id, projectileId: id });
}
