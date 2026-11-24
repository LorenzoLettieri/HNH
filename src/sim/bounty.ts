// "La Taglia", the fourth map event (docs/DESIGN.md §5): the ELITE event.
// A WANTED poster goes up: an outlaw is in town, an enemy like the others
// but tougher (bountyHealthScale × its health) and with a MODIFIER that
// changes how you fight it. Kill it before the wave ends and its bounty
// bursts out of the body in coins; let the wave end first and it gets away.
//
// The modifiers (one per bounty, drawn at random):
// - swift: its TIME runs faster (the wager's "faster enemies" trick, but for
//   one enemy only: game.ts gives it extra AI steps, entity.timeDebt);
// - shielded: a shield that soaks up damage before the health (damage() in
//   entities.ts) and grows back if you stop hitting it for a moment:
//   you have to keep the pressure on;
// - explosive: when it dies, a short fuse and then it BLOWS UP, hurting you
//   (and the enemies around it, as your kills): kill it from afar, or kill
//   it in the middle of the horde.
//
// It's a small state machine inside the skeleton's one (mapEvents.ts):
//
//   posted ──(bountyDelay: the poster's moment)──▶ hunting ──(killed)──▶ success
//                                                    │   └──(explosive: killed)──▶ fuse ──(boom)──▶ success
//                                                    └──(the wave ends first)──▶ escaped: failure
//
// The outlaw does NOT count for the end of the wave (waves.ts skips it):
// otherwise the wave could never end before you killed it, and the bounty
// could never be missed. So the race is "kill it before the last of the
// others". Like the wager, it reads the wave events itself: a wave ending
// during the fuse must not fail an event that's already won.
//
// The modifier is stored on the ENTITY (entity.bounty), not only on the
// event: damage() (shield) and game.ts (time) read it there, and they don't
// need to know map events exist (the same idea as player.curse).
import { secondsToTicks, tuning } from './config';
import { createBull, createEyebat, createGhoul, createHound, createSharpshooter, isEnemy, type Enemy } from './entities';
import type { SimEvent } from './events';
import { explode, type Blast } from './explosion';
import type { GameState } from './game';
import { hitCenter, lineFree } from './gunDamage';
import { currentHeight, hurtPlayer } from './player';
import { randomInt, type RandomState } from './random';
import { healthForWave, pickSpawn } from './waves';
import type { World } from './world';

export type BountyModifier = 'swift' | 'shielded' | 'explosive';
export const BOUNTY_MODIFIERS: BountyModifier[] = ['swift', 'shielded', 'explosive'];

/** Which enemies can be wanted (not the Smith: it's already a boss of its own). */
export type BountyTarget = Exclude<Enemy['type'], 'smith'>;

/** The outlaws, with the wave they can show up from (the same as in the waves: no hound before you met one). */
const TARGETS: { type: BountyTarget; fromWave: () => number }[] = [
  { type: 'ghoul', fromWave: () => 1 },
  { type: 'eyebat', fromWave: () => tuning.eyebatFromWave },
  { type: 'hound', fromWave: () => tuning.houndFromWave },
  { type: 'sharpshooter', fromWave: () => tuning.sharpshooterFromWave },
  { type: 'bull', fromWave: () => tuning.bullFromWave },
];

/** The bounty while it's being played: plain data, inside the GameState. */
export interface BountyEvent {
  kind: 'bounty';
  wave: number;
  phase: 'posted' | 'hunting' | 'fuse';
  modifier: BountyModifier;
  target: BountyTarget;
  /**
   * The outlaw's NAME, as a number: the renderer turns it into "Randy
   * Coffin" with the same lists as the player names (randomName.ts). Words
   * are the renderer's business; the simulation only keeps the choice.
   */
  nameSeed: number;
  /** The outlaw's entity id once it's in town (-1 while the poster is going up). */
  entityId: number;
  /** posted: ticks until it shows up; fuse: ticks until it blows up. */
  ticks: number;
  /** Where it died (the fuse burns there: the corpse may be removed, the blast stays put). */
  x: number;
  y: number;
  z: number;
  /** Shielded: the shield was up at the last tick (to report it breaking and coming back). */
  shieldUp: boolean;
}

/** A new bounty, or null if this level has nowhere to spawn enemies. */
export function createBountyEvent(world: World, rng: RandomState, wave: number): BountyEvent | null {
  if (!world.enemySpawns || world.enemySpawns.length === 0) return null;
  const targets = TARGETS.filter((t) => wave >= t.fromWave());
  return {
    kind: 'bounty',
    wave,
    phase: 'posted',
    modifier: BOUNTY_MODIFIERS[randomInt(rng, BOUNTY_MODIFIERS.length)],
    target: targets[randomInt(rng, targets.length)].type,
    nameSeed: randomInt(rng, 0x7fffffff),
    entityId: -1,
    ticks: secondsToTicks(tuning.bountyDelay),
    x: 0,
    y: 0,
    z: 0,
    shieldUp: false,
  };
}

/** The outlaw's entity, if it's still in the list. */
export function bountyEntity(ev: BountyEvent, game: GameState): Enemy | null {
  const e = game.entities.find((en) => en.id === ev.entityId);
  return e && isEnemy(e) ? e : null;
}

/**
 * One tick of the bounty. Reads the waves' events (from `firstEvent` on)
 * itself, like the wager (mapEvents.ts leaves them to it).
 */
export function stepBounty(
  ev: BountyEvent,
  game: GameState,
  world: World,
  events: SimEvent[],
  firstEvent: number,
): 'running' | 'success' | 'failure' {
  if (ev.phase === 'hunting') {
    const e = bountyEntity(ev, game);
    if (!e) return 'failure'; // gone without dying (a debug clear): nobody to claim
    // The kill first: killed in the same tick the wave ends (one stick for
    // the last ghoul and the outlaw) still counts.
    if (e.state === 'dead') {
      // The coins burst out of the body on their own (pickups.ts reads entity.bounty).
      if (ev.modifier !== 'explosive') return 'success';
      const c = hitCenter(e);
      ev.x = c.x;
      ev.y = c.y;
      ev.z = c.z;
      ev.phase = 'fuse';
      ev.ticks = secondsToTicks(tuning.bountyFuse);
      events.push({ type: 'bountyFuse', entityId: e.id, x: c.x, y: c.y, z: c.z });
      return 'running';
    }
    if (ev.modifier === 'shielded') stepShield(ev, e, events);
  }

  // A wave that ends while the poster is up or the outlaw is alive = it got
  // away. During the fuse it's already won: the wave can end in peace.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if ((e.type === 'waveEnd' || e.type === 'waveStart') && ev.phase !== 'fuse') {
      escape(ev, game, events);
      return 'failure';
    }
  }

  if (ev.phase === 'posted') {
    if (--ev.ticks > 0) return 'running';
    // Off screen and ahead of you, like every other enemy (waves.ts). No
    // free spot right now: try again next tick.
    const at = pickSpawn(game, world);
    if (!at) return 'running';
    const outlaw = createOutlaw(ev, game, at.x, at.y, at.z);
    game.entities.push(outlaw);
    ev.entityId = outlaw.id;
    ev.phase = 'hunting';
    ev.shieldUp = (outlaw.shield ?? 0) > 0;
    events.push({ type: 'bountySpawned', entityId: outlaw.id, modifier: ev.modifier, x: at.x, y: at.y, z: at.z });
    return 'running';
  }
  if (ev.phase === 'hunting') return 'running';

  // fuse
  if (--ev.ticks > 0) return 'running';
  blowUp(ev, game, world, events);
  return 'success';
}

/** The outlaw: the same enemy as in the waves, tougher, with the modifier written on it. */
function createOutlaw(ev: BountyEvent, game: GameState, x: number, y: number, z: number): Enemy {
  const id = game.nextEntityId++;
  const health = (base: number) => healthForWave(base, ev.wave) * tuning.bountyHealthScale;
  let e: Enemy;
  if (ev.target === 'eyebat') e = createEyebat(id, x, y + tuning.eyebatSpawnHeight, z, health(tuning.eyebatHealth));
  else if (ev.target === 'hound') e = createHound(id, x, y, z, health(tuning.houndHealth));
  else if (ev.target === 'bull') e = createBull(id, x, y, z, health(tuning.bullHealth));
  else if (ev.target === 'sharpshooter') e = createSharpshooter(id, x, y, z, health(tuning.sharpshooterHealth));
  else e = createGhoul(id, x, y, z, health(tuning.ghoulHealth), true); // an outlaw ghoul is always a runner
  e.bounty = ev.modifier;
  if (ev.modifier === 'shielded') {
    e.shieldMax = e.health * tuning.bountyShieldScale;
    e.shield = e.shieldMax;
    e.shieldTicks = 0;
  }
  if (ev.modifier === 'swift') e.timeDebt = 0;
  return e;
}

/**
 * The shield grows back: after bountyShieldRegenDelay seconds without a hit
 * (damage() resets shieldTicks), it refills in bountyShieldRegenTime seconds,
 * a straight line. Reports the moment it breaks and the moment it's full again.
 */
function stepShield(ev: BountyEvent, e: Enemy, events: SimEvent[]): void {
  const max = e.shieldMax ?? 0;
  if (max <= 0) return;
  e.shieldTicks = (e.shieldTicks ?? 0) + 1;
  const shield = e.shield ?? 0;
  if (e.shieldTicks > secondsToTicks(tuning.bountyShieldRegenDelay) && shield < max) {
    e.shield = Math.min(max, shield + max / Math.max(1, secondsToTicks(tuning.bountyShieldRegenTime)));
  }
  const up = (e.shield ?? 0) > 0;
  const c = hitCenter(e);
  if (ev.shieldUp && !up) events.push({ type: 'bountyShield', entityId: e.id, up: false, x: c.x, y: c.y, z: c.z });
  // "Back up" only once it's full: a sliver of shield isn't news.
  if (!ev.shieldUp && (e.shield ?? 0) >= max) events.push({ type: 'bountyShield', entityId: e.id, up: true, x: c.x, y: c.y, z: c.z });
  if (!up) ev.shieldUp = false;
  else if ((e.shield ?? 0) >= max) ev.shieldUp = true;
}

/** The wave ended with the outlaw alive: it's gone (the renderer shows a puff of smoke where it was). */
function escape(ev: BountyEvent, game: GameState, events: SimEvent[]): void {
  const e = bountyEntity(ev, game);
  if (!e) return;
  game.entities = game.entities.filter((en) => en !== e);
  if (e.state === 'dead') return; // killed this very tick, but the wave ended first: no escape to show
  const c = hitCenter(e);
  events.push({ type: 'bountyEscaped', entityId: e.id, x: c.x, y: c.y, z: c.z });
}

/**
 * The explosive outlaw's last word. The enemies in the radius take the
 * damage as YOUR kills (explode() from explosion.ts: score, drops, style);
 * you take bountyBlastDamage at the center, fading to the edge, unless a
 * wall is in between. No dynamite jump: this one is meant to hurt.
 */
function blowUp(ev: BountyEvent, game: GameState, world: World, events: SimEvent[]): void {
  const blast: Blast = {
    kind: 'bounty',
    radius: tuning.bountyBlastRadius,
    damage: tuning.bountyBlastEnemyDamage,
    edge: 0.4,
    source: 'dynamite',
    knockback: tuning.dynamiteKnockback,
    lift: tuning.dynamiteKnockbackLift,
    selfPush: 0,
    smithScale: tuning.dynamiteSmithScale,
  };
  const at = { x: ev.x, y: ev.y, z: ev.z };
  explode(game.player, at, blast, world, game.entities, events);

  const p = game.player;
  if (p.health <= 0) return;
  // From the blast to your nearest point (like the enemies: a hitbox, not a center).
  const top = p.y + currentHeight(p);
  const ny = Math.max(p.y, Math.min(at.y, top));
  const d = Math.hypot(p.x - at.x, ny - at.y, p.z - at.z);
  if (d > blast.radius) return;
  if (!lineFree(world, at.x, at.y, at.z, p.x, (p.y + top) / 2, p.z)) return;
  const amount = Math.round(tuning.bountyBlastDamage * (1 - 0.6 * (d / blast.radius)));
  hurtPlayer(p, amount, at.x, at.z, tuning.bountyBlastPush);
  events.push({ type: 'playerHurt', damage: amount, fromX: at.x, fromZ: at.z });
}

