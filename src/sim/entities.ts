// Entities: everything in the game that isn't the level or the player and
// can be shot. For now only practice targets; enemies will join this list.
// Pure data, like the player state.
import { secondsToTicks, tuning } from './config';
import { box, type Box, type World } from './world';

export interface TargetEntity {
  id: number;
  type: 'target';
  /** Position of the post's base. */
  x: number;
  y: number;
  z: number;
  /** Direction the plate faces, radians (same convention as the player's yaw). */
  yaw: number;
  health: number;
  /** Ticks until it stands up again after being knocked down (0 = standing). */
  respawnTicks: number;
}

export type Entity = TargetEntity;

/** Height of the target plate's center above the base, meters. */
export const TARGET_PLATE_HEIGHT = 1.5;
/** Radius of the round steel plate, meters. */
export const TARGET_PLATE_RADIUS = 0.3;

export function createEntities(world: World): Entity[] {
  return (world.targets ?? []).map((t, i) => ({
    id: i + 1,
    type: 'target',
    x: t.x,
    y: t.y,
    z: t.z,
    yaw: (t.rotation * Math.PI) / 180,
    health: tuning.targetHealth,
    respawnTicks: 0,
  }));
}

export function isAlive(e: Entity): boolean {
  return e.health > 0;
}

/**
 * The box bullets can hit. The plate is a thin disc that can face any
 * direction, but our raycast only knows axis-aligned boxes: we use a cube
 * around the plate. A bit generous on the corners, nobody will notice.
 */
export function hitBox(e: Entity): Box {
  const r = TARGET_PLATE_RADIUS;
  return box(e.x, e.y + TARGET_PLATE_HEIGHT - r, e.z, r * 2, r * 2, r * 2);
}

/** Applies damage. Returns true if this hit knocked the entity down. */
export function damage(e: Entity, amount: number): boolean {
  if (!isAlive(e)) return false;
  e.health -= amount;
  if (e.health <= 0) {
    e.health = 0;
    e.respawnTicks = secondsToTicks(tuning.targetRespawnTime);
    return true;
  }
  return false;
}

/** Advances the entities by one tick: knocked-down targets stand up again. */
export function stepEntities(entities: Entity[]): void {
  for (const e of entities) {
    if (e.respawnTicks > 0) {
      e.respawnTicks--;
      if (e.respawnTicks === 0) e.health = tuning.targetHealth;
    }
  }
}
