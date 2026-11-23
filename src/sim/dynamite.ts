// The dynamite launcher's sticks: the first PLAYER projectile of the game.
// The guns are hitscan (the bullet arrives the instant you click); a stick is
// a little object that flies with gravity, bounces off the floor and the
// walls, rolls, and blows up when its fuse runs out.
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
import type { World } from './world';

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
export function throwDynamite(p: PlayerState, nextId: number): Dynamite {
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;
  const s = tuning.dynamiteSpeed;
  const k = tuning.dynamiteInherit;
  // Born a bit in front of the eyes (not inside your head) and centered on
  // the aim: y is the BOTTOM of its box, so half its size lower.
  const x = p.x + dx * 0.4;
  const y = p.y + currentEyeHeight(p) + dy * 0.4 - DYNAMITE_RADIUS;
  const z = p.z + dz * 0.4;
  return {
    id: nextId,
    x, y, z,
    px: x, py: y, pz: z,
    vx: dx * s + p.vx * k,
    vy: dy * s + tuning.dynamiteLift + p.vy * k,
    vz: dz * s + p.vz * k,
    fuseTicks: Math.round(tuning.dynamiteFuse * TICK_RATE),
    rolling: false,
  };
}

/**
 * One tick for every stick: fly, bounce, roll, and blow up when the fuse
 * runs out. Returns the sticks still alive.
 */
export function stepDynamite(sticks: Dynamite[], world: World, dt: number, events: SimEvent[]): Dynamite[] {
  const alive: Dynamite[] = [];
  for (const d of sticks) {
    d.px = d.x;
    d.py = d.y;
    d.pz = d.z;
    if (--d.fuseTicks <= 0) {
      // The center of the box, not its bottom: that's where the powder is.
      events.push({ type: 'explosion', x: d.x, y: d.y + DYNAMITE_RADIUS, z: d.z, radius: tuning.dynamiteRadius });
      continue;
    }
    // Sub-steps: as many as needed so that none moves farther than MAX_STEP.
    const speed = Math.hypot(d.vx, d.vy, d.vz) + tuning.gravity * dt;
    const steps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP));
    for (let i = 0; i < steps; i++) move(d, world, dt / steps);
    if (d.y < tuning.killY) continue; // fell off the map
    alive.push(d);
  }
  return alive;
}

/**
 * One sub-step of physics. moveAndCollide stops the body against a surface by
 * ZEROING the velocity on that axis. We remember the velocity from before:
 * if an axis went to zero, we hit something on that axis, and the bounce is
 * that velocity turned around and shrunk (× dynamiteBounce, the "coefficient
 * of restitution", the same idea as the shovel's bounce in shovelView.ts),
 * while the other two axes lose a bit to the friction of the impact.
 * Boxes only have faces along the axes, so "which axis" = "which face".
 */
function move(d: Dynamite, world: World, dt: number): void {
  d.vy -= tuning.gravity * dt;
  const vx = d.vx;
  const vy = d.vy;
  const vz = d.vz;
  const { landed } = moveAndCollide(d, DYNAMITE_RADIUS, DYNAMITE_RADIUS * 2, world.boxes, dt);
  const bounce = tuning.dynamiteBounce;
  const grip = tuning.dynamiteBounceGrip;

  // Walls (X and Z faces): back out, the same way on every hit.
  if (vx !== 0 && d.vx === 0) {
    d.vx = -vx * bounce;
    d.vy *= grip;
    d.vz *= grip;
  }
  if (vz !== 0 && d.vz === 0) {
    d.vz = -vz * bounce;
    d.vy *= grip;
    d.vx *= grip;
  }
  // Ceiling: back down.
  if (vy > 0 && d.vy === 0) d.vy = -vy * bounce;

  if (landed) {
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
}
