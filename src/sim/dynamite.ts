// The dynamite launcher's sticks: the first PLAYER projectile of the game.
// The guns are hitscan (the bullet arrives the instant you click); a stick is
// a little object that flies with gravity, bounces off the floor and the
// walls, rolls, and blows up when its fuse runs out, or right away if it
// touches an enemy (the direct hit). The explosion itself is explosion.ts.
//
// Like the enemy projectiles (projectiles.ts) and the pickups (pickups.ts)
// they are plain data in a list in the GameState: serializable, no Three.js.
// The renderer reads them (render/dynamite.ts) and never changes them.
//
// Written generic on purpose: the Dynamiter (the enemy in docs/DESIGN.md)
// will throw the same sticks.
import { tuning, TICK_RATE } from './config';
import { moveAndCollide } from './collision';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { hitBox, isAlive, isEnemy, type Entity } from './entities';
import { dynamiteBlast, explode } from './explosion';
import { raycastBoxes } from './raycast';
import type { Box, World } from './world';

/** Half the size of the stick's collision box, meters (a 12 cm cube: a stick seen from any side). */
export const DYNAMITE_RADIUS = 0.06;

/**
 * Longest move per sub-step, meters. moveAndCollide moves the body and THEN
 * looks for overlaps: at 22 m/s a stick moves 37 cm per tick, more than a
 * thin plank (10-30 cm), so in one tick it could jump from in front of a
 * wall to behind it without ever touching it ("tunneling"). Cutting the tick
 * into steps no longer than the stick itself, it can't skip anything.
 * (The enemy projectiles solve it another way, a ray along the segment: a
 * ray is perfect for a straight line, but a stick also bounces and rolls,
 * and moveAndCollide already knows how to slide along floors and walls.)
 */
const MAX_STEP = DYNAMITE_RADIUS * 2;

/** How far in front of your eyes a stick is born, meters (not inside your head). */
const SPAWN_AHEAD = 0.4;

/** Below this speed into a surface (m/s) a hit makes no sound (rolling, resting). */
const BOUNCE_SOUND_MIN = 1.5;

export interface Dynamite {
  /** Unique (shares the counter with the entities): the renderer keeps one mesh per id. */
  id: number;
  /** Position: the BOTTOM of the collision box (like every body in collision.ts). */
  x: number;
  y: number;
  z: number;
  /** Position at the previous tick: the renderer interpolates between the two. */
  px: number;
  py: number;
  pz: number;
  /** Velocity, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Ticks before it blows up. */
  fuseTicks: number;
  /** The fuse's whole length in ticks (the renderer shows how much is left: fuseTicks / fuseTotal). */
  fuseTotal: number;
  /** Resting on the floor (it rolls instead of bouncing). */
  rolling: boolean;
}

/**
 * Throws a stick from the player's eyes, where they look.
 * Its velocity = aim × speed + a bit of lift + part of the player's velocity.
 * That last part is the "inherited velocity" of most shooters with slow
 * projectiles: without it, throwing while running forward, the stick would
 * seem to slow down in front of you (it's slower than it looks, relative to you).
 */
export function throwDynamite(p: PlayerState, world: World, nextId: number): Dynamite {
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;
  const s = tuning.dynamiteSpeed;
  const k = tuning.dynamiteInherit;
  // Born a bit in front of the eyes and centered on the aim: y is the
  // BOTTOM of its box, so half its size lower.
  // With your nose against a wall, 40 cm ahead would be INSIDE it: then it
  // is born just before the wall (and bounces off it right away).
  const eyeY = p.y + currentEyeHeight(p);
  const wall = raycastBoxes(p.x, eyeY, p.z, dx, dy, dz, SPAWN_AHEAD + DYNAMITE_RADIUS * 2, world.boxes);
  const ahead = wall ? Math.max(0, wall.distance - DYNAMITE_RADIUS * 2) : SPAWN_AHEAD;
  const x = p.x + dx * ahead;
  const y = eyeY + dy * ahead - DYNAMITE_RADIUS;
  const z = p.z + dz * ahead;
  return {
    id: nextId,
    x, y, z,
    px: x, py: y, pz: z,
    vx: dx * s + p.vx * k,
    vy: dy * s + tuning.dynamiteLift + p.vy * k,
    vz: dz * s + p.vz * k,
    fuseTicks: Math.round(tuning.dynamiteFuse * TICK_RATE),
    fuseTotal: Math.round(tuning.dynamiteFuse * TICK_RATE),
    rolling: false,
  };
}

/**
 * One tick for every stick: fly, bounce, roll; blow up against an enemy
 * (direct hit) or when the fuse runs out. Returns the sticks still alive.
 * The explosions are YOURS (the player's): damage, kills and score count
 * like a gunshot (stepGame runs this among the player's attacks).
 */
export function stepDynamite(
  sticks: Dynamite[],
  player: PlayerState,
  world: World,
  entities: Entity[],
  dt: number,
  events: SimEvent[],
): Dynamite[] {
  const alive: Dynamite[] = [];
  // The enemies' hitboxes, grown by the stick's size on every side: the same
  // trick as the enemy projectiles (the "Minkowski sum"): a small box
  // touching a hitbox = its center (a point) inside the grown hitbox.
  const r = DYNAMITE_RADIUS;
  const targets: Box[] = [];
  for (const e of entities) {
    if (!isEnemy(e) || !isAlive(e)) continue;
    const b = hitBox(e);
    targets.push({ ...b, minX: b.minX - r, maxX: b.maxX + r, minY: b.minY - r, maxY: b.maxY + r, minZ: b.minZ - r, maxZ: b.maxZ + r });
  }

  for (const d of sticks) {
    d.px = d.x;
    d.py = d.y;
    d.pz = d.z;
    let boom = --d.fuseTicks <= 0;
    // Sub-steps: as many as needed so that none moves farther than MAX_STEP.
    const speed = Math.hypot(d.vx, d.vy, d.vz) + tuning.gravity * dt;
    const steps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP));
    let impact = 0; // the hardest hit against the level in this tick (for the sound)
    for (let i = 0; i < steps && !boom; i++) {
      const ax = d.x;
      const ay = d.y + r;
      const az = d.z;
      impact = Math.max(impact, move(d, world, dt / steps));
      boom = touches(ax, ay, az, d, targets);
    }
    // One "tonk" per tick at most, and only for real hits: rolling makes
    // tiny impacts on every tick, and a sound for each would be a buzz.
    if (!boom && impact > BOUNCE_SOUND_MIN) {
      events.push({ type: 'dynamiteBounce', x: d.x, y: d.y + r, z: d.z, speed: impact });
    }
    if (boom) {
      // The center of the box, not its bottom: that's where the powder is.
      explode(player, { x: d.x, y: d.y + r, z: d.z }, dynamiteBlast(), world, entities, events);
      continue;
    }
    if (d.y < tuning.killY) continue; // fell off the map
    alive.push(d);
  }
  return alive;
}

/**
 * Did the stick's center, going from (ax, ay, az) to where it is now, enter
 * a grown hitbox? A ray along that little segment (it could pass through a
 * thin eye-bat between two sub-steps), or ending up inside one (the ray
 * doesn't report boxes it starts in). If so, the stick is moved to the
 * touching point: it blows up ON the enemy, not behind it.
 */
function touches(ax: number, ay: number, az: number, d: Dynamite, targets: Box[]): boolean {
  if (targets.length === 0) return false;
  const bx = d.x;
  const by = d.y + DYNAMITE_RADIUS;
  const bz = d.z;
  for (const t of targets) {
    if (bx > t.minX && bx < t.maxX && by > t.minY && by < t.maxY && bz > t.minZ && bz < t.maxZ) return true;
  }
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (len < 1e-6) return false;
  const hit = raycastBoxes(ax, ay, az, (bx - ax) / len, (by - ay) / len, (bz - az) / len, len, targets);
  if (!hit) return false;
  d.x = hit.x;
  d.y = hit.y - DYNAMITE_RADIUS;
  d.z = hit.z;
  return true;
}

/**
 * One sub-step of physics. moveAndCollide stops the body against a surface by
 * ZEROING the velocity on that axis. We remember the velocity from before:
 * if an axis went to zero, we hit something on that axis, and the bounce is
 * that velocity turned around and shrunk (× dynamiteBounce, the "coefficient
 * of restitution", the same idea as the shovel's bounce in shovelView.ts),
 * while the other two axes lose a bit to the friction of the impact.
 * Boxes only have faces along the axes, so "which axis" = "which face".
 * Returns the speed it hit a surface with (0 = it touched nothing): the sound of the bounce.
 */
function move(d: Dynamite, world: World, dt: number): number {
  d.vy -= tuning.gravity * dt;
  const vx = d.vx;
  const vy = d.vy;
  const vz = d.vz;
  const { landed } = moveAndCollide(d, DYNAMITE_RADIUS, DYNAMITE_RADIUS * 2, world.boxes, dt);
  const bounce = tuning.dynamiteBounce;
  const grip = tuning.dynamiteBounceGrip;
  let impact = 0;

  // Walls (X and Z faces): back out, the same way on every hit.
  if (vx !== 0 && d.vx === 0) {
    impact = Math.max(impact, Math.abs(vx));
    d.vx = -vx * bounce;
    d.vy *= grip;
    d.vz *= grip;
  }
  if (vz !== 0 && d.vz === 0) {
    impact = Math.max(impact, Math.abs(vz));
    d.vz = -vz * bounce;
    d.vy *= grip;
    d.vx *= grip;
  }
  // Ceiling: back down.
  if (vy > 0 && d.vy === 0) {
    impact = Math.max(impact, vy);
    d.vy = -vy * bounce;
  }

  if (landed) {
    impact = Math.max(impact, -vy);
    if (-vy > tuning.dynamiteBounceMinSpeed) {
      // Hit the floor hard: bounce up, and lose some speed along the floor.
      d.vy = -vy * bounce;
      d.vx *= grip;
      d.vz *= grip;
      d.rolling = false;
    } else {
      // Too slow to bounce: it stays on the floor and rolls.
      d.vy = 0;
      d.rolling = true;
    }
  } else if (vy < 0) {
    // Falling and nothing under it: it rolled off an edge.
    d.rolling = false;
  }

  // Rolling: the floor slows it down by a fixed amount per second (not a
  // percentage): so it really comes to a stop, instead of creeping forever.
  if (d.rolling) {
    const h = Math.hypot(d.vx, d.vz);
    if (h > 0) {
      const slower = Math.max(0, h - tuning.dynamiteRollFriction * dt);
      d.vx *= slower / h;
      d.vz *= slower / h;
    }
  }
  return impact;
}
