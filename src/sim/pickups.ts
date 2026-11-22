// Pickups: things lying on the ground that you collect by walking over them.
// For now they only come from killed enemies ("drops"), and there are three kinds:
// - BULLETS: spare rounds for the revolver;
// - SHELLS: spare shells for the shotgun;
// - MEDKIT: health (the only way to heal: there's no regeneration).
// Plus the COINS (the vildenaro, the game's money), which work differently:
// every enemy ALWAYS drops some (see dropCoins), and you ALWAYS collect them.
// Ammo is split ON PURPOSE: if the shells don't come for a while, you're
// forced to play with the revolver (and the other way around).
//
// Drops are GENERIC, not a loot table per enemy: the chance of a drop grows
// with the enemy's weight (the same `*Cost` the waves use), so a hound (3)
// drops something more often than a ghoul (1). Then a second roll decides
// what: a "weighted" choice (see pickKind).
//
// Drops VANISH after a while: one more reason to keep moving (and to dive
// into the fight to grab them).
//
// Drops BURST OUT of the body: each one is launched with its own little arc
// (up and outward), falls with gravity, bounces once and settles. The drops
// of one kill fan out at evenly spaced angles, so they never pile up on the
// same spot (coins and ammo would hide each other).
//
// Pure simulation, like everything in src/sim: the renderer reads the list.
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import type { Enemy } from './entities';
import type { GameState } from './game';
import { random } from './random';
import { moveAndCollide } from './collision';
import { enemyCost } from './waves';
import { styleMultiplier } from './style';
import { AMMO_TYPE, WEAPONS, type AmmoType, type WeaponId } from './weapon';
import type { World } from './world';

/** 'iron' = the Damned Iron, dropped only by the Damned Smith (smith.ts), spent at the Forge. */
export type PickupKind = 'bullets' | 'shells' | 'medkit' | 'coin' | 'iron';

/**
 * Is this kind of ammo any use to you? Yes if you own at least one weapon
 * that shoots it (bullets: the revolver, which you always have, and the
 * carbine; shells: the shotgun). The pickup kinds 'bullets' and 'shells'
 * are the same names as the pockets (AmmoType in weapon.ts).
 */
function usesAmmo(owned: Record<WeaponId, boolean>, ammo: AmmoType): boolean {
  return WEAPONS.some((w) => owned[w] && AMMO_TYPE[w] === ammo);
}

export interface Pickup {
  /** Unique (shares the counter with the entities): the renderer keeps one mesh per id. */
  id: number;
  kind: PickupKind;
  /** Position: the bottom of the pickup (on the floor once it has landed). */
  x: number;
  y: number;
  z: number;
  /** Position at the previous tick: the renderer interpolates between the two (they fly now). */
  px: number;
  py: number;
  pz: number;
  /** Velocity while it's flying out of the body, m/s. */
  vx: number;
  vy: number;
  vz: number;
  /** Settled on the floor: stops moving (and the renderer shows its pool of light). */
  landed: boolean;
  /** Ticks left before it vanishes. */
  ticksLeft: number;
  /**
   * Vildenaro it's worth (coins only, 0 for the rest). Stored on the coin,
   * decided when it's dropped: the style multiplier counts at the moment of
   * the KILL, not of the pickup.
   */
  value: number;
}

/**
 * Looks at this tick's events and drops things where each enemy died.
 * Kills come from the 'hit' events (killed = true) that weapons and the kick
 * already emit: we don't touch the weapon code at all, we just listen.
 */
export function dropFromKills(game: GameState, events: SimEvent[]): void {
  for (const ev of events) {
    if (ev.type !== 'hit' || !ev.killed) continue;
    const enemy = game.entities.find((e) => e.id === ev.entityId);
    if (!enemy || enemy.type === 'target') continue; // steel targets drop nothing
    burst(game, enemy, whatDrops(game, enemy));
  }
}

/** One thing to drop: its kind and (coins only) what it's worth. */
interface Loot {
  kind: PickupKind;
  value: number;
}

/**
 * What one dead enemy leaves behind:
 * - COINS (the vildenaro): ALWAYS, as many as its weight × coinsPerWeight
 *   (ghoul 1, bull 5). Each is worth coinValue × the style multiplier at the
 *   moment of the KILL, written on the coin: if the chain breaks before you
 *   pick it up, it's still worth the same.
 * - maybe ONE item: chance = weight × dropChancePerWeight, capped
 *   (ghoul 1 → 30%, eye-bat 2 → 60%, hound 3 → 80%), kind from pickKind.
 */
function whatDrops(game: GameState, enemy: Enemy): Loot[] {
  const loot: Loot[] = [];
  const coins = Math.round(enemyCost(enemy) * tuning.coinsPerWeight);
  const coinValue = Math.round(tuning.coinValue * styleMultiplier(game.style));
  for (let i = 0; i < coins; i++) loot.push({ kind: 'coin', value: coinValue });
  // The Damned Smith ALWAYS leaves its Damned Iron (the reason to kill it).
  if (enemy.type === 'smith') loot.push({ kind: 'iron', value: 0 });
  const chance = Math.min(tuning.dropChanceMax, enemyCost(enemy) * tuning.dropChancePerWeight);
  if (random(game) < chance) loot.push({ kind: pickKind(random(game), game.player.owned), value: 0 });
  return loot;
}

/**
 * Launches the loot out of the body, like a little explosion.
 *
 * DIRECTIONS: n drops get n angles evenly spaced around the circle (360°/n
 * apart), the whole fan rotated by a random amount, plus a little jitter on
 * each so it doesn't look like a perfect star. Fully random angles would
 * often put two drops side by side: evenly spaced ones never overlap.
 *
 * SPEED: each one gets an outward speed between dropBurstSpeedMin and Max
 * and the same upward kick (dropBurstUp). Flight time ≈ 2 × up / gravity
 * (5 m/s up, gravity 20 → half a second), so the distance ≈ speed × 0.5 s:
 * 1–2 m from the body. Everything comes from the seeded generator: same
 * seed, same burst.
 */
function burst(game: GameState, enemy: Enemy, loot: Loot[]): void {
  const n = loot.length;
  const fan = random(game) * Math.PI * 2;
  loot.forEach((item, i) => {
    const jitter = (random(game) - 0.5) * (Math.PI / n) * 0.6;
    const angle = fan + (i / n) * Math.PI * 2 + jitter;
    const speed = tuning.dropBurstSpeedMin + random(game) * (tuning.dropBurstSpeedMax - tuning.dropBurstSpeedMin);
    // From the middle of the body (not the feet: a body sinking in the floor
    // must not launch things from under it).
    const d = createPickup(game, item.kind, enemy.x, enemy.y + 0.5, enemy.z, item.value);
    d.vx = Math.cos(angle) * speed;
    d.vz = Math.sin(angle) * speed;
    d.vy = tuning.dropBurstUp * (0.85 + 0.3 * random(game));
    game.pickups.push(d);
  });
}

/** A new pickup at rest at a point (it falls from there). Used by the drops and the debug J key. */
export function createPickup(game: GameState, kind: PickupKind, x: number, y: number, z: number, value = 0): Pickup {
  return {
    id: game.nextEntityId++,
    kind,
    x, y, z,
    px: x, py: y, pz: z,
    vx: 0, vy: 0, vz: 0,
    landed: false,
    ticksLeft: secondsToTicks(
      kind === 'coin' ? tuning.coinLifetime : kind === 'iron' ? tuning.ironLifetime : tuning.dropLifetime,
    ),
    value,
  };
}

/**
 * Weighted random choice. Each kind has a weight (dropWeight* in config.ts):
 * line them up one after the other, like segments on a ruler of total length
 * = sum of the weights, throw a dart (`roll` × total) and see which segment
 * it lands in. Bullets 5, shells 4, medkit 3 → 42%, 33%, 25%. Weights instead
 * of percentages: you can change one without having to fix the others to
 * make 100. (Loot tables in every game work like this.)
 */
function pickKind(roll: number, owned: Record<WeaponId, boolean>): PickupKind {
  // Ammo for a weapon you don't own never drops: its weight becomes 0
  // (the other kinds split its share: that's the beauty of weights).
  const ammo = (kind: AmmoType, w: number) => (usesAmmo(owned, kind) ? w : 0);
  const weights: [PickupKind, number][] = [
    ['bullets', ammo('bullets', tuning.dropWeightBullets)],
    ['shells', ammo('shells', tuning.dropWeightShells)],
    ['medkit', tuning.dropWeightMedkit],
  ];
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let dart = roll * total;
  for (const [kind, w] of weights) {
    if (dart < w) return kind;
    dart -= w;
  }
  return weights[weights.length - 1][0]; // only reached if every weight is 0
}

/** Size of a pickup for its collisions with the level (a small box), meters. */
const PICKUP_RADIUS = 0.15;
const PICKUP_HEIGHT = 0.25;

/**
 * A flying pickup: the same physics as the player, in miniature. Gravity
 * pulls it down, moveAndCollide (the player's own collision code) stops it
 * against walls and on floors. When it hits the floor fast enough it bounces
 * once (a fraction of the speed back up, and it slows down horizontally:
 * the floor "eats" energy), otherwise it settles and stops for good.
 */
function fly(d: Pickup, world: World, dt: number): void {
  d.vy -= tuning.gravity * dt;
  const impact = d.vy; // the speed it's hitting with, before the collision zeroes it
  const { landed } = moveAndCollide(d, PICKUP_RADIUS, PICKUP_HEIGHT, world.boxes, dt);
  if (!landed) return;
  if (-impact > tuning.dropBounceMinSpeed) {
    d.vy = -impact * tuning.dropBounce;
    d.vx *= 0.5;
    d.vz *= 0.5;
  } else {
    d.vx = d.vy = d.vz = 0;
    d.landed = true;
  }
}

/** Every tick: pickups age (and vanish), and the player collects the ones touching them. */
export function stepPickups(game: GameState, world: World, dt: number, events: SimEvent[]): void {
  const p = game.player;
  game.pickups = game.pickups.filter((d) => {
    if (--d.ticksLeft <= 0) return false;
    d.px = d.x;
    d.py = d.y;
    d.pz = d.z;
    if (!d.landed) fly(d, world, dt);
    if (d.y < tuning.killY) return false; // flew off a roof edge into a pit
    // It can be collected while still flying: you run THROUGH the burst.
    // Touching: close enough horizontally (a cylinder around the player, a bit
    // generous: you're running, you shouldn't have to stop on top of it),
    // and vertically from well below the feet (so jumping over it still counts)
    // to a bit above the head.
    const near = Math.hypot(d.x - p.x, d.z - p.z) < tuning.pickupRadius;
    const level =
      d.y > p.y - tuning.pickupReachBelow &&
      d.y < p.y + tuning.playerHeight + tuning.pickupReachAbove;
    if (!near || !level) return true;
    // Doom rule: if you don't need it, it stays on the ground (for later).
    if (!collect(game, d)) return true;
    events.push({ type: 'pickup', kind: d.kind, x: d.x, y: d.y, z: d.z });
    return false;
  });
}

/** Gives the pickup to the player. Returns false if it would be wasted entirely. */
function collect(game: GameState, d: Pickup): boolean {
  const p = game.player;
  const kind = d.kind;
  // Money is never "not needed": no maximum, always collected.
  if (kind === 'coin') {
    p.money += d.value;
    game.stats.moneyEarned += d.value;
    return true;
  }
  // The Damned Iron goes into the inventory (player.ts), for the Forge.
  if (kind === 'iron') {
    p.damnedIron++;
    return true;
  }
  if (kind === 'medkit') {
    if (p.health >= tuning.playerMaxHealth) return false;
    p.health = Math.min(tuning.playerMaxHealth, p.health + tuning.medkitHeal);
    return true;
  }
  // Ammo: rounds for one pocket, up to what it holds.
  if (!usesAmmo(p.owned, kind)) return false; // (the J debug key can drop it anyway: it stays on the ground)
  const max = kind === 'shells' ? tuning.shotgunReserveMax : tuning.revolverReserveMax;
  if (p.reserve[kind] >= max) return false;
  const amount = kind === 'shells' ? tuning.ammoPickupShells : tuning.ammoPickupBullets;
  p.reserve[kind] = Math.min(max, p.reserve[kind] + amount);
  return true;
}
