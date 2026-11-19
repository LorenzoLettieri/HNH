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
export const MUZZLE_FORWARD = 0.1;
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
  const cy = chestY(p);
  if (Math.hypot(p.x - mx, cy - my, p.z - mz) > tuning.sharpshooterRange) return false;
  return clearShot(mx, my, mz, p.x, cy, p.z, world);
}

// --- Moving to a perch ---------------------------------------------------------------

/**
 * MOVE: choose a perch if it has none, then walk the graph to it. The same
 * way the ghouls follow the flow field toward you, but toward ITS perch:
 * from the node it stands on, take the link the flow field says, and handle
 * the special ones (jump, climb, vent) when it's in position.
 */
function stepMove(s: SharpshooterEntity, game: GameState, world: World, graph: NavGraph, dt: number): void {
  // No destination yet (just spawned, or it lost you): choose one. It must
  // know where it stands, so only with its feet on the ground.
  if (s.perchNode < 0 && s.onGround && s.navNode >= 0) {
    // Spots already taken: where the other sharpshooters stand or are going.
    const taken = game.entities.flatMap((o) =>
      o !== s && o.type === 'sharpshooter' && o.state !== 'dead' ? [o.perchNode >= 0 ? graph.nodes[o.perchNode] : o] : [],
    );
    s.perchNode = choosePerch(graph, s.navNode, game.player, chestY(game.player), taken, world);
    const cost = s.perchNode >= 0 ? perchFlow(graph, s.perchNode).dist[s.navNode] : Infinity;
    if (cost === Infinity) {
      // Nowhere better to go: it stays here and waits (and tries again later).
      stopMoving(s);
      return;
    }
    // Twice the time the trip should take, plus a bit: if it isn't there by
    // then (stuck, kicked off the path...), something went wrong: give up.
    s.moveTicksLeft = secondsToTicks((cost / tuning.sharpshooterWalkSpeed) * 2 + 3);
  }
  if (s.perchNode >= 0 && --s.moveTicksLeft <= 0) {
    stopMoving(s);
    return;
  }

  // Where to walk: the next node along the flow field (or, on the perch's own
  // node, the exact spot). For a vent: the middle of the grate first.
  let wishX = 0;
  let wishZ = 0;
  let link: NavLink | null = null;
  if (s.perchNode >= 0 && s.navNode >= 0) {
    const perch = graph.nodes[s.perchNode];
    let tx = perch.x;
    let tz = perch.z;
    if (s.navNode === s.perchNode) {
      if (s.onGround && Math.hypot(perch.x - s.x, perch.z - s.z) < ARRIVE_DIST) {
        // Arrived. A moment to take position, then the usual shot cycle.
        setState(s, 'idle');
        s.unseenTicks = 0;
        s.shootCooldownTicks = Math.max(s.shootCooldownTicks, secondsToTicks(SETTLE_TIME));
        return;
      }
    } else {
      link = perchFlow(graph, s.perchNode).next[s.navNode];
      if (!link) {
        // No way from here (knocked off the path onto a dead end): choose again.
        s.perchNode = -1;
        return;
      }
      const t = link.via ?? graph.nodes[link.to];
      tx = t.x;
      tz = t.z;
    }
    const d = Math.hypot(tx - s.x, tz - s.z);
    if (d > 0.01) {
      wishX = (tx - s.x) / d;
      wishZ = (tz - s.z) / d;
    }
  }

  // Accelerate toward the wished velocity (only with its feet down: no steering in the air).
  const speed = tuning.sharpshooterWalkSpeed;
  if (s.onGround) {
    const k = Math.min(1, WALK_ACCEL * dt);
    s.vx += (wishX * speed - s.vx) * k;
    s.vz += (wishZ * speed - s.vz) * k;
  }

  // Special links, when in position (the same rules as the ghouls).
  if (link && s.onGround) {
    const t = graph.nodes[link.to];
    const here = graph.nodes[s.navNode];
    if (link.kind === 'jump' && Math.hypot(t.x - s.x, t.z - s.z) < 2.8) {
      jumpTo(s, t);
    } else if (link.kind === 'climb' && Math.hypot(here.x - s.x, here.z - s.z) < 1.5) {
      s.climbFrom = s.navNode;
      s.climbTo = link.to;
      s.climbTicks = 0;
      // Facing the wall (from the foot of it toward the top): the renderer
      // picks the view from this, so you see its back if the wall faces you.
      const d = Math.hypot(t.x - here.x, t.z - here.z);
      if (d > 0.01) {
        s.aimX = (t.x - here.x) / d;
        s.aimY = 0;
        s.aimZ = (t.z - here.z) / d;
      }
      return;
    } else if (link.kind === 'vent' && link.via && Math.hypot(link.via.x - s.x, link.via.z - s.z) < 0.25) {
      const vent = ventUnder(world.props, s.x, s.y, s.z);
      if (vent) {
        launchFromVent(s, vent);
        s.onGround = false;
      }
    }
    // 'walk' and 'drop' need nothing special: walking off the edge IS dropping.
  }

  s.vy -= tuning.gravity * dt;
  const r = tuning.sharpshooterRadius;
  const h = tuning.sharpshooterHeight;
  const speedBefore = Math.hypot(s.vx, s.vz);
  const { landed } = moveAndCollide(s, r, h, world.boxes, dt);
  s.onGround = landed;

  // Bumped into something low (cutting a corner, a crate): hop over it, like the ghouls.
  const speedAfter = Math.hypot(s.vx, s.vz);
  if (s.onGround && (wishX || wishZ) && speedBefore > 0.2 && speedAfter < speedBefore * 0.5) {
    const jumpHeight = tuning.ghoulJumpHeight;
    if (!overlapsAny(s.x + wishX * 0.4, s.y + jumpHeight, s.z + wishZ * 0.4, r, h, world.boxes)) {
      s.vy = Math.sqrt(2 * tuning.gravity * (jumpHeight + 0.15));
      s.onGround = false;
    }
  }

  // Facing: where it walks (the renderer will need it for the side views).
  if (speedAfter > 0.5) {
    s.aimX = s.vx / speedAfter;
    s.aimY = 0;
    s.aimZ = s.vz / speedAfter;
  }
}

/** Stops moving: back to waiting, with a full RelocateTime before it tries again. */
function stopMoving(s: SharpshooterEntity): void {
  setState(s, 'idle');
  s.unseenTicks = 0;
}

/**
 * The flow field toward a perch. Like the ghouls' one, it's DERIVED data
 * (graph + perch node, nothing else), not game state: it lives in a cache,
 * and the entity only stores WHICH perch (a plain number, serializable).
 * A handful of perches at a time: when the cache grows, it's simply emptied.
 */
const perchFlows = new WeakMap<NavGraph, Map<number, FlowField>>();
function perchFlow(graph: NavGraph, perch: number): FlowField {
  let fields = perchFlows.get(graph);
  if (!fields) {
    fields = new Map();
    perchFlows.set(graph, fields);
  }
  let field = fields.get(perch);
  if (!field) {
    if (fields.size >= 16) fields.clear();
    field = computeFlowField(graph, perch);
    fields.set(perch, field);
  }
  return field;
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
