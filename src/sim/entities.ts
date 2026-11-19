// Entities: everything in the game that isn't the level or the player and
// can be shot: practice targets and enemies. Pure data, like the player state.
import { secondsToTicks, tuning } from './config';
import { box, type Box, type World } from './world';

/** Fields every entity has. */
interface EntityBase {
  id: number;
  /** Position (feet / base). */
  x: number;
  y: number;
  z: number;
  /** Position at the previous tick: the renderer interpolates between the two. */
  px: number;
  py: number;
  pz: number;
  health: number;
}

export interface TargetEntity extends EntityBase {
  type: 'target';
  /** Direction the plate faces, radians (same convention as the player's yaw). */
  yaw: number;
  /** Ticks until it stands up again after being knocked down (0 = standing). */
  respawnTicks: number;
}

export interface GhoulEntity extends EntityBase {
  type: 'ghoul';
  /** Runners are faster (and have red eyes). */
  runner: boolean;
  /** Killed by a headshot: the head is gone (for the death animation). */
  headless: boolean;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /** What it's doing: walking to you, swinging its claws, or lying dead. */
  state: 'chase' | 'attack' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Ticks before it can attack again. */
  attackCooldownTicks: number;
  /** Going around an obstacle: ticks left, and which side (+1 / -1). */
  detourTicks: number;
  detourSide: number;
  /** Ticks spent blocked: if it lasts, the detour switches side (it's in a dead end). */
  stuckTicks: number;
  /** Navigation: the graph node it's standing on (-1 = unknown). */
  navNode: number;
  /** Climbing a wall toward this node (-1 = not climbing). */
  climbTo: number;
  /** The node at the foot of the wall: it climbs up THIS column (known to be free). */
  climbFrom: number;
  /** Ticks spent climbing (safety: give up if it takes too long). */
  climbTicks: number;
}

/** The "Malocchio": a flying eyeball with bat wings. Position = bottom of its body. */
export interface EyebatEntity extends EntityBase {
  type: 'eyebat';
  vx: number;
  vy: number;
  vz: number;
  /** Killed by a shot in the pupil: the eye bursts (for the death animation). */
  popped: boolean;
  /** Flying around you, or dead (falling, then lying on the ground). */
  state: 'fly' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Which way it circles around the player (+1 / -1). */
  orbitSide: number;
}

export type Entity = TargetEntity | GhoulEntity | EyebatEntity;
/** Everything that fights you (not the practice targets). */
export type Enemy = GhoulEntity | EyebatEntity;

export function isEnemy(e: Entity): e is Enemy {
  return e.type !== 'target';
}

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
    px: t.x,
    py: t.y,
    pz: t.z,
    yaw: (t.rotation * Math.PI) / 180,
    health: tuning.targetHealth,
    respawnTicks: 0,
  }));
}

export function createGhoul(
  id: number,
  x: number,
  y: number,
  z: number,
  health = tuning.ghoulHealth,
  runner = false,
): GhoulEntity {
  return {
    id,
    type: 'ghoul',
    runner,
    headless: false,
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    health,
    onGround: false,
    state: 'chase',
    stateTicks: 0,
    attackCooldownTicks: 0,
    detourTicks: 0,
    // Half of them go around obstacles on the left, half on the right. Based on
    // the id, not Math.random(): the simulation must be deterministic (same
    // inputs → same result), so a server or a replay make the same choices.
    detourSide: id % 2 === 0 ? 1 : -1,
    stuckTicks: 0,
    navNode: -1,
    climbTo: -1,
    climbFrom: -1,
    climbTicks: 0,
  };
}

export function createEyebat(id: number, x: number, y: number, z: number, health = tuning.eyebatHealth): EyebatEntity {
  return {
    id,
    type: 'eyebat',
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    health,
    popped: false,
    state: 'fly',
    stateTicks: 0,
    orbitSide: id % 2 === 0 ? 1 : -1, // deterministic, like the ghoul's detour side
  };
}

export function isAlive(e: Entity): boolean {
  return e.health > 0;
}

/**
 * The box bullets can hit. For the target, the plate is a thin disc that can
 * face any direction, but our raycast only knows axis-aligned boxes: we use a
 * cube around the plate (a bit generous on the corners, nobody will notice).
 */
export function hitBox(e: Entity): Box {
  if (e.type === 'ghoul') {
    const r = tuning.ghoulRadius;
    return box(e.x, e.y, e.z, r * 2, tuning.ghoulHeight, r * 2);
  }
  if (e.type === 'eyebat') {
    // A cube around the eye. The wings are NOT in it: shooting a thin wing
    // and getting a kill would feel wrong, and missing "through" it is fine.
    const r = tuning.eyebatRadius;
    return box(e.x, e.y, e.z, r * 2, r * 2, r * 2);
  }
  const r = TARGET_PLATE_RADIUS;
  return box(e.x, e.y + TARGET_PLATE_HEIGHT - r, e.z, r * 2, r * 2, r * 2);
}

/** Applies damage. Returns true if this hit killed / knocked down the entity. */
export function damage(e: Entity, amount: number): boolean {
  if (!isAlive(e)) return false;
  e.health -= amount;
  if (e.health > 0) return false;
  e.health = 0;
  if (e.type === 'target') {
    e.respawnTicks = secondsToTicks(tuning.targetRespawnTime);
  } else {
    e.state = 'dead';
    e.stateTicks = 0;
  }
  return true;
}

/** Targets: knocked-down ones stand up again after a while. */
export function stepTarget(e: TargetEntity): void {
  if (e.respawnTicks > 0) {
    e.respawnTicks--;
    if (e.respawnTicks === 0) e.health = tuning.targetHealth;
  }
}
