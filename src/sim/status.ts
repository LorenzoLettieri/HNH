// Status effects on enemies, from the upgrade cards (docs/DESIGN.md §6c).
// Things that last a while after the shot, so they need a timer on the
// entity and a step every tick:
// - BURNING: damage every so often. Two fires: the card "Fiato di drago"
//   (dragonBurn*) and the HOLY blue fire of the Forge's dynamite (holyBurn*,
//   lit by the pools of holy fire, holyFire.ts);
// - SLAMMED (card "Calcio di piombo"): thrown by the shotgun, it takes damage
//   if it hits a wall while still flying.
// It runs right after your weapon in stepGame, so its kills count as YOUR
// kills (score, coins, style), like a shot.
import { secondsToTicks, tuning } from './config';
import { damage, isAlive, isEnemy, type Entity } from './entities';
import type { HitSource, SimEvent } from './events';
import type { PlayerState } from './player';

export function stepStatus(player: PlayerState, entities: Entity[], events: SimEvent[]): void {
  for (const e of entities) {
    if (!isEnemy(e) || !isAlive(e)) {
      e.burnTicks = 0;
      e.slamTicks = 0;
      continue;
    }
    stepBurn(player, e, events);
    stepSlam(player, e, events);
  }
}

/**
 * Sets an enemy on fire (again: a new hit restarts the timer, it doesn't
 * stack). The holy fire wins over the ordinary one: a holy burn is never
 * turned back into a "Fiato di drago" burn.
 */
export function ignite(e: Entity, holy = false): void {
  if (!isEnemy(e)) return;
  if (e.burnHoly && e.burnTicks && !holy) return;
  if (!e.burnTicks) e.burnClock = 0; // a new fire: the first chunk comes after one interval
  e.burnHoly = holy;
  e.burnTicks = secondsToTicks(holy ? tuning.holyBurnTime : tuning.dragonBurnTime);
}

/** Thrown by a "Calcio di piombo" blast: for a moment, a wall hurts. */
export function markSlam(e: Entity): void {
  // Only the bodies a blast really throws (the bull doesn't budge, the
  // eye-bat flies: its own steering changes its speed all the time).
  if (e.type !== 'ghoul' && e.type !== 'hound' && e.type !== 'sharpshooter') return;
  e.slamTicks = secondsToTicks(tuning.leadStockSlamTime);
  e.slamSpeed = Math.hypot(e.vx, e.vz);
}

/**
 * Burning: a chunk of damage every interval (not a sliver every tick: each
 * chunk is a 'hit' event, so a hitmarker and a sound, and 60 of them a second
 * would be noise). HOW LONG it burns (burnTicks) and WHEN it hurts
 * (burnClock) are two separate counters: standing in a pool of holy fire
 * relights the enemy every tick, restarting burnTicks; if the chunks were
 * timed on burnTicks, they would never come.
 */
function stepBurn(player: PlayerState, e: Entity, events: SimEvent[]): void {
  if (!e.burnTicks) return;
  e.burnTicks--;
  e.burnClock = (e.burnClock ?? 0) + 1;
  const holy = !!e.burnHoly;
  const interval = Math.max(1, secondsToTicks(holy ? tuning.holyBurnInterval : tuning.dragonBurnInterval));
  if (e.burnClock < interval) return;
  e.burnClock = 0;
  hurt(player, e, holy ? tuning.holyBurnDamage : tuning.dragonBurnDamage, events, holy ? 'dynamite' : 'shotgun');
}

/**
 * Slammed into a wall? There's no "collision" event from the enemies' AI,
 * so we look at the speed: the collisions zero the velocity into a wall,
 * while the ground friction only takes ~13% a tick. If more than half of
 * the speed vanished in one tick, it hit something.
 */
function stepSlam(player: PlayerState, e: Entity, events: SimEvent[]): void {
  if (!e.slamTicks || !('vx' in e)) return;
  e.slamTicks--;
  const speed = Math.hypot(e.vx, e.vz);
  const before = e.slamSpeed ?? 0;
  e.slamSpeed = speed;
  if (before > 3 && speed < before * 0.5) {
    e.slamTicks = 0; // once per throw
    hurt(player, e, tuning.leadStockSlamDamage, events);
  }
}

/** Damage from a status, reported as a hit of the gun that caused it (score, coins, style count it as yours). */
function hurt(player: PlayerState, e: Entity, amount: number, events: SimEvent[], source: HitSource = 'shotgun'): void {
  const killed = damage(e, amount);
  events.push({
    type: 'hit',
    entityId: e.id,
    damage: amount,
    killed,
    surface: 'flesh',
    headshot: false,
    source,
    distance: Math.hypot(e.x - player.x, e.z - player.z),
    target: e.type,
  });
}
