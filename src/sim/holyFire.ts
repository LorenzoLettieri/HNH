// HOLY FIRE: the Forge's dynamite (docs/DESIGN.md §6d). Its sticks are
// soaked in holy water: where one blows up, the water splashes down onto the
// floor and keeps burning there for a few seconds, a pool of BLUE fire.
// Every enemy that walks through it catches fire (the holy burn of
// status.ts, which keeps burning for a while after it leaves). The player
// doesn't: it's holy, it burns only the damned.
//
// A pool is plain data in a list in the GameState, like the sticks and the
// pickups (serializable, no Three.js); the renderer draws it from the
// 'holyFire' event and the list (render/holyFire.ts).
//
// Why a pool and not a bigger explosion: it DENIES SPACE. An alley full of
// blue fire is a wall for the horde for five seconds, and you choose where
// to put it: it fits "the enemies attack the space" turned around.
import { secondsToTicks, tuning } from './config';
import { isAlive, isEnemy, type Entity } from './entities';
import type { SimEvent } from './events';
import { raycastBoxes } from './raycast';
import { ignite } from './status';
import type { World } from './world';

export interface HolyFire {
  /** Unique (shares the counter with the entities): the renderer keeps one mesh per id. */
  id: number;
  /** The center, ON the floor. */
  x: number;
  y: number;
  z: number;
  /** Meters. */
  radius: number;
  /** Ticks before it goes out, and how many it had (the renderer fades it at the end). */
  ticksLeft: number;
  ticksTotal: number;
  /**
   * Holy (the Forge's dynamite: blue, the holy burn) or plain (the drink
   * "Scia di brace": orange patches left by a slide, the ordinary burn).
   */
  holy: boolean;
}

/**
 * How far down the holy water falls looking for a floor, meters: a stick
 * that blows up in the air over a roof splashes onto the roof; one over a
 * pit (nothing below) leaves no pool.
 */
const FALL_REACH = 30;
/**
 * Who stands IN the pool: feet from this much below its surface (a stair
 * step, a slope of boxes) to this much above it (a ghoul mid-stride, a
 * hound's hop). The eye-bat flies higher: it never catches fire, unless it
 * dives into it.
 */
const BELOW = 0.4;
const ABOVE = 0.8;

/** Splash a pool of holy fire under an explosion at (x, y, z), if there's a floor. */
export function spawnHolyFire(
  fires: HolyFire[],
  id: number,
  x: number, y: number, z: number,
  world: World,
  events: SimEvent[],
): void {
  // A ray straight down: the first box under the blast is the floor.
  const floor = raycastBoxes(x, y + 0.05, z, 0, -1, 0, FALL_REACH, world.boxes);
  if (!floor) return;
  const ticks = secondsToTicks(tuning.holyFireTime);
  const fire: HolyFire = { id, x, y: floor.y, z, radius: tuning.holyFireRadius, ticksLeft: ticks, ticksTotal: ticks, holy: true };
  fires.push(fire);
  events.push({ type: 'holyFire', x, y: floor.y, z, radius: fire.radius });
}

/**
 * Drink "Scia di brace": a patch of ordinary fire where you slide, on the
 * floor under your feet (you're on the ground: no ray needed).
 */
export function spawnEmberPatch(fires: HolyFire[], id: number, x: number, y: number, z: number): void {
  const ticks = secondsToTicks(tuning.emberTrailTime);
  fires.push({ id, x, y, z, radius: tuning.emberTrailRadius, ticksLeft: ticks, ticksTotal: ticks, holy: false });
}

/** One tick: every pool burns the enemies standing in it, and burns out. Returns the pools still burning. */
export function stepHolyFire(fires: HolyFire[], entities: Entity[]): HolyFire[] {
  for (const f of fires) {
    for (const e of entities) {
      if (!isEnemy(e) || !isAlive(e)) continue;
      if (e.y < f.y - BELOW || e.y > f.y + ABOVE) continue;
      // Inside the circle (a little generous: a body is not a point).
      if (Math.hypot(e.x - f.x, e.z - f.z) > f.radius + 0.3) continue;
      // Relit every tick it stands there: it burns as long as it stays,
      // and holyBurnTime more after it leaves.
      ignite(e, f.holy);
    }
    f.ticksLeft--;
  }
  return fires.filter((f) => f.ticksLeft > 0);
}
