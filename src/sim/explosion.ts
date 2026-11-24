// Explosions: the card "Ultimo colpo" (the revolver's last round) and the
// dynamite sticks. One function, the differences are numbers (a `Blast`).
//
// An explosion is NOT a projectile and not a ray: it's a SPHERE. Everything
// inside it is hit at once, with damage that fades from the center to the
// edge (a linear "falloff"). Two rules keep it fair:
// - distance measured to the NEAREST POINT of the enemy's hitbox, not to its
//   center: a bull is 2.4 m wide, a blast against its flank must count even
//   if its center is out of the radius;
// - nothing through walls: a line from the blast to the enemy's center must
//   be free of level boxes (hiding behind a wall works, for them and for you).
import { tuning } from './config';
import type { ExplosionKind, HitSource, SimEvent } from './events';
import { hitBox, isAlive, isEnemy, type Entity } from './entities';
import { applyGunDamage, hitCenter, lineFree } from './gunDamage';
import { knockBack } from './kick';
import { currentHeight, type PlayerState } from './player';
import type { Box, World } from './world';

export interface Blast {
  /** Which one: only the renderer cares (how big the effect, which sound). */
  kind: ExplosionKind;
  /** Meters. */
  radius: number;
  /** Damage at the center. */
  damage: number;
  /** Fraction of the damage left at the edge of the radius (1 = the same everywhere). */
  edge: number;
  /** What did it (the style and the stats read it from the 'hit' events). */
  source: HitSource;
  /** Enemies thrown away from the center: horizontal speed and lift, m/s, at the center (0 = no push). */
  knockback: number;
  lift: number;
  /** Speed added to YOU at the center, m/s (0 = it doesn't touch you): the dynamite jump. */
  selfPush: number;
  /** The Damned Smith's armor: its damage × this. */
  smithScale: number;
}

/** "Ultimo colpo": the same damage in the whole radius, no push. */
export function lastShotBlast(): Blast {
  return {
    kind: 'lastShot',
    radius: tuning.lastShotRadius,
    damage: tuning.lastShotDamage,
    edge: 1,
    source: 'revolver',
    knockback: 0,
    lift: 0,
    selfPush: 0,
    smithScale: 1,
  };
}

/**
 * A dynamite stick. `holy`: a stick of the launcher reinforced at the Forge
 * (holy water): the Forge's extra damage (like every reinforced gun), and
 * its own kind (stepGame lights a pool of holy fire under it).
 */
export function dynamiteBlast(holy = false, radius = tuning.dynamiteRadius, damageScale = 1): Blast {
  return {
    kind: holy ? 'holyDynamite' : 'dynamite',
    radius,
    damage: tuning.dynamiteDamage * (holy ? tuning.forgeDamageMultiplier : 1) * damageScale,
    edge: tuning.dynamiteEdgeDamage,
    source: 'dynamite',
    knockback: tuning.dynamiteKnockback,
    lift: tuning.dynamiteKnockbackLift,
    selfPush: tuning.dynamiteSelfPush,
    smithScale: tuning.dynamiteSmithScale,
  };
}

/**
 * Blows up at `at` (the point the wall checks start from: it must be in the
 * open air, not inside a wall). Damages and pushes the enemies in the
 * radius, pushes you, and reports an 'explosion' event (the effect).
 */
export function explode(
  p: PlayerState,
  at: { x: number; y: number; z: number },
  blast: Blast,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  events.push({ type: 'explosion', kind: blast.kind, x: at.x, y: at.y, z: at.z, radius: blast.radius });
  for (const e of entities) {
    if (!isEnemy(e) || !isAlive(e)) continue;
    const d = distanceToBox(at, hitBox(e));
    if (d > blast.radius) continue;
    const c = hitCenter(e);
    if (!lineFree(world, at.x, at.y, at.z, c.x, c.y, c.z)) continue;
    const near = falloff(d, blast); // 1 at the center, blast.edge at the edge
    let amount = blast.damage * near;
    if (e.type === 'smith') amount *= blast.smithScale;
    applyGunDamage(e, amount, false, blast.source, Math.hypot(c.x - p.x, c.z - p.z), events);
    if (blast.knockback > 0) {
      // Away from the center, horizontally (knockBack wants a unit vector;
      // right under the blast there's no "away": just the lift).
      const hx = c.x - at.x;
      const hz = c.z - at.z;
      const h = Math.hypot(hx, hz);
      const strength = 1 - 0.5 * Math.min(1, d / blast.radius); // 100% at the center → 50% at the edge
      knockBack(e, h > 1e-3 ? hx / h : 0, h > 1e-3 ? hz / h : 0, blast.knockback * strength, blast.lift * strength);
    }
  }
  if (blast.selfPush > 0) pushPlayer(p, at, blast, world);
}

/** 1 at the center of the blast, blast.edge at its edge, in a straight line between. */
function falloff(distance: number, blast: Blast): number {
  const t = Math.min(1, distance / blast.radius);
  return 1 - (1 - blast.edge) * t;
}

/**
 * Distance from a point to a box: clamp the point inside the box on each
 * axis (the nearest point of the box), then measure. 0 if it's inside.
 */
function distanceToBox(at: { x: number; y: number; z: number }, b: Box): number {
  const x = Math.max(b.minX, Math.min(at.x, b.maxX));
  const y = Math.max(b.minY, Math.min(at.y, b.maxY));
  const z = Math.max(b.minZ, Math.min(at.z, b.maxZ));
  return Math.hypot(x - at.x, y - at.y, z - at.z);
}

/**
 * The DYNAMITE JUMP (Quake's rocket jump): the blast ADDS speed to you,
 * away from it, stronger the closer you are. No damage (a decision: docs/DESIGN.md).
 * Added, not set: a jump plus a stick under your feet = higher than either.
 * The direction is from the blast to your CENTER: a stick at your feet
 * pushes you straight up, one beside you mostly sideways.
 */
function pushPlayer(p: PlayerState, at: { x: number; y: number; z: number }, blast: Blast, world: World): void {
  if (p.health <= 0) return;
  const height = currentHeight(p);
  const body: Box = {
    minX: p.x - tuning.playerRadius,
    maxX: p.x + tuning.playerRadius,
    minY: p.y,
    maxY: p.y + height,
    minZ: p.z - tuning.playerRadius,
    maxZ: p.z + tuning.playerRadius,
  };
  const d = distanceToBox(at, body);
  if (d > blast.radius) return;
  const cy = p.y + height / 2;
  if (!lineFree(world, at.x, at.y, at.z, p.x, cy, p.z)) return;
  const dx = p.x - at.x;
  const dy = cy - at.y;
  const dz = p.z - at.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const push = blast.selfPush * (1 - d / blast.radius);
  p.vx += (dx / len) * push;
  p.vz += (dz / len) * push;
  const up = (dy / len) * push;
  if (up > 0) {
    // Falling? The blast first cancels the fall, then lifts (like the
    // shotgun jump): a stick thrown under you while falling saves you.
    p.vy = Math.max(p.vy, 0) + up;
    p.onGround = false;
  } else {
    p.vy += up;
  }
}
