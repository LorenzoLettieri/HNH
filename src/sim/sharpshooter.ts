// Sharpshooter AI: a skeleton with a cowboy hat and a Winchester. It doesn't
// chase you: it SHOOTS you from afar. A fast bullet (much faster than a
// fireball), so the fairness is all in the WARNING (docs/DESIGN.md,
// "leggibilità"): a red laser shows exactly where the rifle points.
//
//   idle ──(cooldown over, you're in range and in sight)──▶ aim
//    ▲                                                       │ (laser on, it FOLLOWS
//    │                                                       │  where you'll be)
//    │                                                       ▼
//    └──────── fires the bullet ◀──(after LockTime)────── lock (laser stops, blinks)
//
// - AIM: the laser glides toward where you WILL be when the bullet arrives
//   (the same "lead" as the eye-bat). Lose its line of sight for a moment
//   and it gives up.
// - LOCK: the laser freezes. The bullet will go exactly there: it's your cue
//   to change direction (jump, slide, cut back). Keep running straight and
//   the lead gets you; stand still and the laser is on you.
//
// For now it stands where it spawned (gravity only). Climbing to high spots
// comes in a later step.
import { moveAndCollide } from './collision';
import { secondsToTicks, tuning } from './config';
import type { SharpshooterEntity } from './entities';
import type { SimEvent } from './events';
import { interceptTime } from './eyebat';
import type { GameState } from './game';
import { currentHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/**
 * How far in front of its body the muzzle is, meters (along the aim): the
 * laser and the bullet start at the tip of the rifle, not inside its ribs.
 */
const MUZZLE_FORWARD = 0.55;
/** On the ground it stops quickly (pushed by a kick, it slides a bit), 1/s. */
const GROUND_FRICTION = 8;

export function stepSharpshooter(s: SharpshooterEntity, game: GameState, world: World, dt: number, events: SimEvent[]): void {
  const player = game.player;
  s.stateTicks++;
  if (s.shootCooldownTicks > 0) s.shootCooldownTicks--;

  // Physics: just gravity and friction (it stands still, for now).
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
    if (s.shootCooldownTicks === 0 && player.health > 0 && canSee(s, player, world)) {
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
