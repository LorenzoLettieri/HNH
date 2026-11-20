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
  /** Card "Fiato di drago": ticks of fire left (status.ts). Optional: most entities never burn. */
  burnTicks?: number;
  /** Card "Calcio di piombo": ticks left in which hitting a wall hurts (status.ts), and its speed last tick. */
  slamTicks?: number;
  slamSpeed?: number;
  /** Card "Marchio": marked by a carbine hit, the next carbine hit on it does double damage. */
  marked?: boolean;
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
  /**
   * What it's doing: walking to you, swinging its claws, pouncing at you
   * (crouch, then a leap), getting up after a pounce, thrown by your kick
   * (flying, then down for a moment), or lying dead.
   */
  state: 'chase' | 'attack' | 'lunge' | 'recover' | 'staggered' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Ticks before it can attack again. */
  attackCooldownTicks: number;
  /** Ticks before it can pounce again. */
  lungeCooldownTicks: number;
  /** This pounce already hit you (it only hurts once per leap). */
  lungeHit: boolean;
  /** It saw you at the last check (on its level, in range, nothing in between): pursuit mode. */
  seesPlayer: boolean;
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
  /** Flying around you, charging a shot (slowed down, glowing), or dead (falling, then lying on the ground). */
  state: 'fly' | 'charge' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Which way it circles around the player (+1 / -1). */
  orbitSide: number;
  /** Ticks before it can start charging another shot. */
  shootCooldownTicks: number;
}

/** The hellhound: a fast four-legged hunter. Position = feet. */
export interface HoundEntity extends EntityBase {
  type: 'hound';
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /**
   * The ambush cycle (see hound.ts): stalking you out of sight, charging
   * (after the howl), biting, running away after the bite, skidding to a
   * stop after a charge that missed you. Plus thrown by a kick/blast
   * (flying, then down for a moment), and dead.
   */
  state: 'stalk' | 'charge' | 'bite' | 'retreat' | 'skid' | 'staggered' | 'dead';
  /**
   * Direction of the charge (unit vector on the ground). Picked at the howl,
   * then it can only turn by houndChargeTurnRate: a late sidestep dodges it.
   */
  chargeDirX: number;
  chargeDirZ: number;
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Ticks before it can bite again. */
  biteCooldownTicks: number;
  /** Navigation: the graph node it's standing on (-1 = unknown). */
  navNode: number;
  /** You were looking at it at the last check (in your view cone, nothing in between). */
  seen: boolean;
  /** Ticks since you last looked at it. */
  unseenTicks: number;
  /** When it's right in front of you, which way it goes around you (+1 / -1). */
  stalkSide: number;
}

/** The bull: a big brute that aims and charges in a straight line. Position = feet. */
export interface BullEntity extends EntityBase {
  type: 'bull';
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /**
   * The charge cycle (see bull.ts): walking toward you, aiming (the warning:
   * it stops and paws the ground), charging straight, skidding to a stop
   * after a miss, dazed after crashing into a wall, dead.
   */
  state: 'approach' | 'aim' | 'charge' | 'skid' | 'stunned' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /**
   * Where it's facing, a unit vector on the ground. While aiming it turns
   * toward you; while charging it's the (locked) direction of the charge.
   */
  dirX: number;
  dirZ: number;
  /** Ticks before it can start another charge. */
  chargeCooldownTicks: number;
  /** This charge already ran you over (it only hurts once per charge). */
  chargeHit: boolean;
  /** Ids of the enemies this charge already ran over (each one only once per charge). */
  trampled: number[];
  /** Navigation: the graph node it's standing on (-1 = unknown). */
  navNode: number;
}

/** The sharpshooter: a skeleton with a Winchester that shoots from afar. Position = feet. */
export interface SharpshooterEntity extends EntityBase {
  type: 'sharpshooter';
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  /**
   * What it's doing (see sharpshooter.ts): walking/climbing to a perch
   * (doesn't shoot), waiting (laser off), aiming (the laser follows you),
   * locked (the laser stops and blinks, the shot is coming), dead.
   */
  state: 'move' | 'idle' | 'aim' | 'lock' | 'dead';
  /** Ticks spent in the current state. */
  stateTicks: number;
  /** Where the rifle points: a unit vector in 3D (the laser goes this way). While walking: where it walks. */
  aimX: number;
  aimY: number;
  aimZ: number;
  /** Ticks before it can start aiming again. */
  shootCooldownTicks: number;
  /** Ticks in a row it couldn't see you while aiming. */
  lostSightTicks: number;
  /** Ticks in a row it couldn't see you while waiting: too many and it moves (sharpshooterRelocateTime). */
  unseenTicks: number;
  /** The node (ghouls' graph) of the perch it's going to or standing on; -1 = none, choose one. */
  perchNode: number;
  /** The graph node it's standing on (-1 = unknown). */
  navNode: number;
  /** Climbing a wall: from the node at its foot to the one on top (-1 = not climbing). */
  climbFrom: number;
  climbTo: number;
  climbTicks: number;
  /** Ticks left to reach the perch before it gives up (stuck, pushed away...). */
  moveTicksLeft: number;
  /** Killed by a headshot: the skull is gone (for the death animation). */
  headless: boolean;
}

export type Entity = TargetEntity | GhoulEntity | EyebatEntity | HoundEntity | BullEntity | SharpshooterEntity;
/** Everything that fights you (not the practice targets). */
export type Enemy = GhoulEntity | EyebatEntity | HoundEntity | BullEntity | SharpshooterEntity;

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
    // The first pounce comes 1-2.5 s after spawning, staggered by id: a horde
    // arriving together doesn't pounce in sync.
    lungeCooldownTicks: secondsToTicks(1 + (id % 6) * 0.3),
    lungeHit: false,
    seesPlayer: false,
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
    // First shot after 1.5-2.7 s: a group spawned together doesn't open fire all at once.
    shootCooldownTicks: secondsToTicks(1.5 + (id % 5) * 0.3),
  };
}

export function createHound(id: number, x: number, y: number, z: number, health = tuning.houndHealth): HoundEntity {
  return {
    id,
    type: 'hound',
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
    state: 'stalk',
    stateTicks: 0,
    biteCooldownTicks: 0,
    navNode: -1,
    seen: false,
    unseenTicks: 0,
    chargeDirX: 0,
    chargeDirZ: 1,
    stalkSide: id % 2 === 0 ? 1 : -1, // deterministic, like the ghoul's detour side
  };
}

export function createBull(id: number, x: number, y: number, z: number, health = tuning.bullHealth): BullEntity {
  return {
    id,
    type: 'bull',
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
    state: 'approach',
    stateTicks: 0,
    dirX: 0,
    dirZ: 1,
    // First charge 1-2 s after spawning, staggered by id (deterministic).
    chargeCooldownTicks: secondsToTicks(1 + (id % 4) * 0.3),
    chargeHit: false,
    trampled: [],
    navNode: -1,
  };
}

export function createSharpshooter(
  id: number,
  x: number,
  y: number,
  z: number,
  health = tuning.sharpshooterHealth,
): SharpshooterEntity {
  return {
    id,
    type: 'sharpshooter',
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
    // Born moving with no perch: the first thing it does is choose where to go.
    state: 'move',
    stateTicks: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 1,
    // First aim 1-2.2 s after spawning, staggered by id (deterministic):
    // a group doesn't light up all its lasers at once.
    shootCooldownTicks: secondsToTicks(1 + (id % 5) * 0.3),
    lostSightTicks: 0,
    unseenTicks: 0,
    perchNode: -1,
    navNode: -1,
    climbFrom: -1,
    climbTo: -1,
    climbTicks: 0,
    moveTicksLeft: 0,
    headless: false,
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
  // The HITBOX (what bullets and kicks hit) is NOT the collider (the box that
  // walks into walls, ghoulRadius / eyebatRadius). The collider must be slim
  // to fit through alleys; the hitbox should match what you SEE, and a bit
  // more: in a fast game, a shot that visibly touches the sprite must count.
  // Every shooter does this (generous hitboxes), it's not cheating.
  if (e.type === 'ghoul') {
    return box(e.x, e.y, e.z, tuning.ghoulHitWidth, tuning.ghoulHitHeight, tuning.ghoulHitWidth);
  }
  if (e.type === 'hound') {
    return box(e.x, e.y, e.z, tuning.houndHitWidth, tuning.houndHitHeight, tuning.houndHitWidth);
  }
  if (e.type === 'sharpshooter') {
    return box(e.x, e.y, e.z, tuning.sharpshooterHitWidth, tuning.sharpshooterHitHeight, tuning.sharpshooterHitWidth);
  }
  if (e.type === 'bull') {
    // A box, the same from every side (our raycast only knows axis-aligned
    // boxes, and the bull is long): as wide as it is long, a bit generous
    // from the front, about right from the side.
    return box(e.x, e.y, e.z, tuning.bullHitWidth, tuning.bullHitHeight, tuning.bullHitWidth);
  }
  if (e.type === 'eyebat') {
    // A cube around the eye, a bit bigger than the eye itself (it includes
    // where the wings join the body, not the wing tips).
    const h = tuning.eyebatHitRadius;
    const centerY = e.y + tuning.eyebatRadius; // e.y is the bottom of the (collider) body
    return box(e.x, centerY - h, e.z, h * 2, h * 2, h * 2);
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
