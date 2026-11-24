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
import { drinkDamageMultiplier } from './drinks';
import { tuning, TICK_RATE } from './config';
import { moveAndCollide } from './collision';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { hitBox, isAlive, isEnemy, type Entity } from './entities';
import { dynamiteBlast, explode } from './explosion';
import { raycastBoxes } from './raycast';
import type { Box, World } from './world';
import { hasCard } from './upgrades';

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
  /** Soaked in holy water (thrown by the launcher reinforced at the Forge): it leaves a pool of holy fire. */
  holy: boolean;
  /**
   * The blast's radius, meters: decided at the throw, like everything the
   * cards change (card "Botte di polvere"). The stick carries the rules it
   * was fired with: buying a card while it flies doesn't change it.
   */
  radius: number;
  /** Card "Rimbalzo infernale": it counts its bounces (each one adds damage). Off: no counting. */
  hellBounce: boolean;
  /** Real bounces so far (not the rolling): the renderer makes its ember angrier with each one. */
  bounces: number;
  /** Resting on the floor (it rolls instead of bouncing). */
  rolling: boolean;
  /** Card "Appiccicosa": it sticks where it first touches the level... */
  sticky: boolean;
  /** ...and once it has, it doesn't move again (an enemy walking into it still sets it off). */
  stuck: boolean;
  /** Card "Razzo": it blows up on any contact; it flies with no gravity while rocketTicks > 0. */
  rocket: boolean;
  rocketTicks: number;
  /** Card "A grappolo": its blast throws mini sticks around. */
  cluster: boolean;
  /** One of those mini sticks: smaller, weaker, and it doesn't split again. */
  mini: boolean;
  /**
   * Ticks before a direct hit can set it off. The mini sticks are born INSIDE
   * a blast, maybe inside an enemy still standing: without this they would
   * all go off at once, right there.
   */
  armTicks: number;
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
  // Card "Razzo": faster, and no lift (it flies straight where you aim).
  const rocket = hasCard(p, 'rocket');
  const s = tuning.dynamiteSpeed * (rocket ? tuning.rocketSpeedScale : 1);
  const lift = rocket ? 0 : tuning.dynamiteLift;
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
  // Card "Miccia corta": the fuse burns faster.
  const fuse = Math.max(1, Math.round(tuning.dynamiteFuse * (hasCard(p, 'shortFuse') ? tuning.shortFuseScale : 1) * TICK_RATE));
  return {
    id: nextId,
    x, y, z,
    px: x, py: y, pz: z,
    vx: dx * s + p.vx * k,
    vy: dy * s + lift + p.vy * k,
    vz: dz * s + p.vz * k,
    fuseTicks: fuse,
    fuseTotal: fuse,
    holy: p.forged.dynamite > 0,
    radius: tuning.dynamiteRadius * (hasCard(p, 'powderKeg') ? tuning.powderKegRadiusScale : 1),
    hellBounce: hasCard(p, 'hellBounce'),
    bounces: 0,
    rolling: false,
    sticky: hasCard(p, 'sticky'),
    stuck: false,
    rocket,
    rocketTicks: rocket ? Math.round(tuning.rocketTime * TICK_RATE) : 0,
    cluster: hasCard(p, 'cluster'),
    mini: false,
    armTicks: 0,
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
  /** A new id for a new stick (the mini sticks of "A grappolo"): the game's entity counter. */
  nextId: () => number,
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
    if (d.armTicks > 0) d.armTicks--;
    const falling = d.rocketTicks <= 0; // "Razzo": no gravity while its rocket burns
    if (d.rocketTicks > 0) d.rocketTicks--;
    // Sub-steps: as many as needed so that none moves farther than MAX_STEP.
    const speed = Math.hypot(d.vx, d.vy, d.vz) + tuning.gravity * dt;
    const steps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP));
    let impact = 0; // the hardest hit against the level in this tick (for the sound)
    for (let i = 0; i < steps && !boom; i++) {
      const ax = d.x;
      const ay = d.y + r;
      const az = d.z;
      // Stuck ("Appiccicosa"): it doesn't move, but an enemy walking into it still sets it off.
      const hit = d.stuck ? 0 : move(d, world, dt / steps, falling);
      impact = Math.max(impact, hit);
      if (hit > 0 && d.rocket) boom = true; // "Razzo": any contact, the floor too
      if (hit > 0 && d.sticky && !d.stuck) {
        // "Appiccicosa": glued right where it touched.
        d.stuck = true;
        d.vx = d.vy = d.vz = 0;
      }
      boom = boom || (d.armTicks <= 0 && touches(ax, ay, az, d, targets));
    }
    // One "tonk" per tick at most, and only for real hits: rolling makes
    // tiny impacts on every tick, and a sound for each would be a buzz.
    if (!boom && impact > BOUNCE_SOUND_MIN) {
      events.push({ type: 'dynamiteBounce', x: d.x, y: d.y + r, z: d.z, speed: impact });
    }
    // A REAL bounce (hard enough to leave the surface, not rolling): one more for "Rimbalzo infernale".
    if (impact > tuning.dynamiteBounceMinSpeed) d.bounces++;
    if (boom) {
      // Card "Rimbalzo infernale": every bounce (up to hellBounceMax) adds damage.
      const bonus = d.hellBounce ? 1 + tuning.hellBounceBonus * Math.min(d.bounces, tuning.hellBounceMax) : 1;
      // The center of the box, not its bottom: that's where the powder is.
      const push = d.rocket ? tuning.rocketSelfPushScale : d.mini ? tuning.clusterDamageScale : 1; // "Razzo": a stronger dynamite jump
      const damage = bonus * (d.mini ? tuning.clusterDamageScale : 1) * drinkDamageMultiplier(player); // × Latte del Diavolo
      explode(player, { x: d.x, y: d.y + r, z: d.z }, dynamiteBlast(d.holy, d.radius, damage, push), world, entities, events);
      // "A grappolo": the mini sticks fly out of the blast.
      if (d.cluster) for (const m of clusterOf(d, nextId)) alive.push(m);
      continue;
    }
    if (d.y < tuning.killY) continue; // fell off the map
    alive.push(d);
  }
  return alive;
}

/**
 * Card "A grappolo": the mini sticks a blast throws. Evenly spaced around the
 * circle (360°/n apart, like the loot of a dead enemy: never two side by
 * side), the whole fan turned by an angle taken from the stick's id (a
 * deterministic "random": same game, same fan), up and out. Each one's fuse
 * a little longer than the one before: they pop one after the other, a
 * rattle, not a single bang.
 */
function clusterOf(d: Dynamite, nextId: () => number): Dynamite[] {
  const n = Math.max(0, Math.round(tuning.clusterCount));
  const turn = (d.id * 2.399963) % (Math.PI * 2); // the golden angle: ids next to each other give far apart turns
  const out: Dynamite[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2;
    const fuse = Math.max(1, Math.round((tuning.clusterFuse + i * tuning.clusterStagger) * TICK_RATE));
    const y = d.y + DYNAMITE_RADIUS; // a bit up: out of the floor
    out.push({
      id: nextId(),
      x: d.x, y, z: d.z,
      px: d.x, py: y, pz: d.z,
      vx: Math.cos(a) * tuning.clusterSpeed,
      vy: tuning.clusterLift,
      vz: Math.sin(a) * tuning.clusterSpeed,
      fuseTicks: fuse,
      fuseTotal: fuse,
      holy: false, // (no pools of holy fire from the minis: one per stick is plenty)
      radius: tuning.clusterRadius,
      hellBounce: false,
      bounces: 0,
      rolling: false,
      sticky: false,
      stuck: false,
      rocket: false,
      rocketTicks: 0,
      cluster: false, // a mini never splits again
      mini: true,
      armTicks: 12, // 0.2 s
    });
  }
  return out;
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
function move(d: Dynamite, world: World, dt: number, gravity = true): number {
  if (gravity) d.vy -= tuning.gravity * dt;
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
