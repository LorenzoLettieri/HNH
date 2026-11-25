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
// - explosive ("Polveriera"): it THROWS DYNAMITE at you. When it sees you,
//   it lights a stick (the warning: bountyThrowWindup) and lobs it in an arc
//   to where you'll be; the stick bounces, its fuse burns, and it blows up
//   on you (only on you: an enemy's blast never hurts the enemies). You have
//   to keep moving, and get it out of sight.
//
// It's a small state machine inside the skeleton's one (mapEvents.ts):
//
//   posted ──(bountyDelay: the poster's moment)──▶ hunting ──(killed)──▶ success
//                                                    └──(the wave ends first)──▶ escaped: failure
//
// The outlaw does NOT count for the end of the wave (waves.ts skips it):
// otherwise the wave could never end before you killed it, and the bounty
// could never be missed. So the race is "kill it before the last of the
// others". Like the wager, it reads the wave events itself (it checks the
// kill first: killed in the same tick as the last of the others still counts).
//
// The modifier is stored on the ENTITY (entity.bounty), not only on the
// event: damage() (shield) and game.ts (time) read it there, and they don't
// need to know map events exist (the same idea as player.curse).
import { secondsToTicks, tuning } from './config';
import { createBull, createEyebat, createGhoul, createHound, createSharpshooter, hitBox, isEnemy, type Enemy, type GhoulEntity } from './entities';
import type { SimEvent } from './events';
import { DYNAMITE_RADIUS, enemyStick } from './dynamite';
import { moveAndCollide } from './collision';
import type { GameState } from './game';
import { hitCenter, lineFree } from './gunDamage';
import { currentHeight } from './player';
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
  phase: 'posted' | 'hunting';
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
  /** posted: ticks until it shows up. */
  ticks: number;
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
    // (The coins burst out of the body on their own: pickups.ts reads entity.bounty.)
    if (e.state === 'dead') return 'success';
    if (ev.modifier === 'shielded') stepShield(ev, e, events);
    if (ev.modifier === 'explosive') stepThrower(e, game, world, events);
  }

  // A wave that ends while the poster is up or the outlaw is alive = it got away.
  const end = events.length;
  for (let i = firstEvent; i < end; i++) {
    const e = events[i];
    if (e.type === 'waveEnd' || e.type === 'waveStart') {
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
  return 'running';
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
  // The first stick a moment after it shows up (it has to find you first anyway).
  if (ev.modifier === 'explosive') {
    e.throwCooldown = secondsToTicks(tuning.bountyThrowInterval * 0.5);
    e.throwWindup = 0;
  }
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
 * "Polveriera": the outlaw throws dynamite at you. A tiny state machine of
 * its own, on top of whatever its kind's AI is doing (a ghoul keeps running
 * at you, a hound keeps stalking: the throw is an EXTRA), with two counters
 * on the entity:
 *
 *   cooldown ──(over, and it sees you, in range)──▶ windup (the stick lit: the warning) ──▶ throw ──▶ cooldown
 *
 * Seeing you = a free line from its chest to yours, between
 * bountyThrowMinRange and bountyThrowMaxRange meters. Lost sight during the
 * windup: it keeps the stick lit and throws as soon as it sees you again.
 */
function stepThrower(e: Enemy, game: GameState, world: World, events: SimEvent[]): void {
  if ((e.stunTicks ?? 0) > 0) return; // stunned: hands busy (drink "Zoccolo duro")
  const p = game.player;
  const from = throwPoint(e);
  const chest = p.y + currentHeight(p) * 0.6;
  const range = Math.hypot(p.x - from.x, p.z - from.z);
  const sees = p.health > 0 && range >= tuning.bountyThrowMinRange && range <= tuning.bountyThrowMaxRange
    && lineFree(world, from.x, from.y, from.z, p.x, chest, p.z);
  if ((e.throwWindup ?? 0) > 0) {
    e.throwWindup = (e.throwWindup ?? 0) - 1;
    if (e.throwWindup > 0) return;
    if (!sees) {
      e.throwWindup = 1; // ready, waiting for a clear line
      return;
    }
    throwAt(e, game, from, events);
    e.throwCooldown = secondsToTicks(tuning.bountyThrowInterval);
    return;
  }
  if ((e.throwCooldown ?? 0) > 0) {
    e.throwCooldown = (e.throwCooldown ?? 0) - 1;
    return;
  }
  if (!sees) return;
  e.throwWindup = secondsToTicks(tuning.bountyThrowWindup);
  events.push({ type: 'bountyWindup', entityId: e.id, x: from.x, y: from.y, z: from.z });
}

/**
 * The ghoul "Polveriera" keeps its DISTANCE (the other kinds already fight
 * from afar: the sharpshooter from a perch, the eye-bat orbiting, the bull
 * and the hound with their own windups). A plain ghoul runs straight into
 * your face, under the 3 m it needs to throw: as an outlaw it would never use
 * its dynamite. So, when it sees you and you're within bountyHoldRange, its
 * ghoul AI is skipped (the same trick as the stun: game.ts runs this
 * INSTEAD of stepGhoul) and it:
 * - backs off, walking straight away from you, if you're closer than
 *   bountyBackOffRange (a wall behind it stops it: moveAndCollide);
 * - otherwise stands its ground, braking, facing you, and throws.
 * Cornered (under bountyThrowMinRange), out of sight, or farther than
 * bountyHoldRange: back to the ghoul AI (it claws at you, or it comes to
 * find you). A pounce or a stagger already started is never interrupted.
 * Returns true if it took over this tick.
 */
export function stepHoldGround(g: GhoulEntity, game: GameState, world: World, dt: number): boolean {
  if (g.bounty !== 'explosive' || g.state !== 'chase' || !g.onGround) return false;
  const p = game.player;
  const dx = g.x - p.x;
  const dz = g.z - p.z;
  const d = Math.hypot(dx, dz);
  if (p.health <= 0 || d < tuning.bountyThrowMinRange || d > tuning.bountyHoldRange) return false;
  const from = throwPoint(g);
  if (!lineFree(world, from.x, from.y, from.z, p.x, p.y + currentHeight(p) * 0.6, p.z)) return false;
  // Backing off: a target velocity away from you, reached quickly (like the
  // ghoul's own acceleration); standing: the same with a zero target, i.e. braking.
  const back = d < tuning.bountyBackOffRange ? tuning.ghoulSpeed * tuning.bountyBackOffSpeed : 0;
  const wantX = (dx / d) * back;
  const wantZ = (dz / d) * back;
  const k = Math.min(1, 12 * dt);
  g.vx += (wantX - g.vx) * k;
  g.vz += (wantZ - g.vz) * k;
  g.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(g, tuning.ghoulRadius, tuning.ghoulHeight, world.boxes, dt);
  g.onGround = landed;
  if (landed && g.vy < 0) g.vy = 0;
  g.stateTicks++;
  return true;
}

/** Where the stick leaves its hand: the top of its hitbox, a bit lower (a raised arm). */
function throwPoint(e: Enemy): { x: number; y: number; z: number } {
  const c = hitCenter(e);
  const top = hitBox(e).maxY;
  return { x: c.x, y: Math.max(c.y, top - 0.3), z: c.z };
}

/**
 * The throw: a BALLISTIC arc that lands where you'll be. Pick the flight
 * time T first (longer for farther throws: a lob, not a fastball), then the
 * velocity that covers the distance in T against gravity:
 *   horizontal: v = d / T (no forces sideways);
 *   vertical: y(T) = vy·T − ½·g·T² = dy → vy = (dy + ½·g·T²) / T.
 * The target is your position + your velocity × T × bountyThrowLead: an
 * INTERCEPTION (like the eye-bat's fireballs), only partial, so running in
 * a straight line doesn't save you but a change of direction does. The fuse
 * = the flight + bountyStickFuse: it lands, you see it, you have a moment to run.
 */
function throwAt(e: Enemy, game: GameState, from: { x: number; y: number; z: number }, events: SimEvent[]): void {
  const p = game.player;
  const range = Math.hypot(p.x - from.x, p.z - from.z);
  const T = Math.min(1.6, 0.5 + range * 0.04);
  const lead = tuning.bountyThrowLead * T;
  const tx = p.x + p.vx * lead;
  const tz = p.z + p.vz * lead;
  const ty = p.y; // your feet: it lands on the floor next to you
  const vx = (tx - from.x) / T;
  const vz = (tz - from.z) / T;
  const vy = (ty - from.y + 0.5 * tuning.gravity * T * T) / T;
  const fuse = secondsToTicks(T + tuning.bountyStickFuse);
  game.dynamite.push(enemyStick(game.nextEntityId++, from.x, from.y - DYNAMITE_RADIUS, from.z, vx, vy, vz, fuse));
  events.push({ type: 'bountyThrow', entityId: e.id, x: from.x, y: from.y, z: from.z });
}
