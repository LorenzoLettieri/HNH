// "Il Pozzo delle Anime", the sixth map event (docs/DESIGN.md §5): a
// COLLECTION. The town well in the square wakes up when you walk to it;
// from then on every enemy you kill leaves its SOUL floating over the floor
// where it died, a little ghost that goes out in a few seconds. Grab it
// (run through it: up close it flies to you by itself) and carry it to the
// well; fill the well before the wave ends and the event is won.
//
// Why it makes you move: the souls are where the fight is, the well is in
// the middle of the town, and the souls on the ground don't wait. You can't
// camp the well (the horde comes to you there, but the souls of the ones you
// kill from afar go out before you get there), and you can't stay out in the
// streets forever (the souls in your hands only count once they're IN the
// well). It's the "run back to the base" loop of capture the flag, with the
// flags made of the enemies you kill.
//
// Souls, not kills, like the Ember Heart: an enemy's soul is worth as much as
// it weighs in the waves (enemyCost: a ghoul 1, a bull 5), and the well wants
// a share of the wave's whole weight (waveBudget × soulWellShare).
//
// Souls in your hands are safe: they don't go out and you don't drop them.
// The clock is on the ones lying in the streets.
//
// Pure simulation: the souls are plain data in the event's state (like the
// pickups in the GameState), the renderer reads them.
import { secondsToTicks, tuning, TICK_DT } from './config';
import type { SimEvent } from './events';
import type { GameState } from './game';
import { isEnemy } from './entities';
import { currentHeight } from './player';
import { raycastBoxes } from './raycast';
import { enemyCost, waveBudget } from './waves';
import type { World } from './world';

/** A soul floating over the floor where its enemy died. */
export interface Soul {
  /** Unique (shares the counter with the entities): the renderer keeps one sprite per id. */
  id: number;
  /** Its middle. */
  x: number;
  y: number;
  z: number;
  /** Where it was last tick (the renderer interpolates: it sinks, and flies to you). */
  px: number;
  py: number;
  pz: number;
  /** The height it settles at: soulHover over the floor under it. */
  restY: number;
  /** What it's worth: the enemy's weight. */
  value: number;
  /** Ticks before it goes out, and how many it had (the renderer flickers it at the end). */
  ticksLeft: number;
  ticksTotal: number;
}

/** The well while it's being played: plain data, inside the GameState. */
export interface SoulWellEvent {
  kind: 'soulWell';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** Asleep until you walk to it: only then do the kills leave souls. */
  awake: boolean;
  /** The middle of the well's mouth (world.soulWell). */
  x: number;
  y: number;
  z: number;
  /** Souls on the ground, waiting for you. */
  souls: Soul[];
  /** What you're carrying (sum of the values). */
  carried: number;
  /** What's in the well so far, and what it wants. */
  filled: number;
  goal: number;
}

/** How far down a dead enemy's soul looks for a floor (meters): over a pit, no floor, no soul. */
const FALL_REACH = 40;
/** A soul starts this high over the enemy's feet (its chest), then sinks to its resting height. */
const SOUL_START = 0.8;

/** A new well, or null if the level has none (the test arena). */
export function createSoulWellEvent(world: World, _game: GameState, wave: number): SoulWellEvent | null {
  const well = world.soulWell;
  if (!well) return null;
  return {
    kind: 'soulWell',
    wave,
    awake: false,
    x: well.x,
    y: well.y,
    z: well.z,
    souls: [],
    carried: 0,
    filled: 0,
    goal: Math.max(1, Math.round(waveBudget(wave) * tuning.soulWellShare)),
  };
}

/**
 * One tick of the well. Asleep: waits for you. Awake: the kills of this
 * tick leave souls, the souls sink, fly to you, go out; standing at the
 * well empties your hands into it. Says 'success' when it's full; the wave
 * ending first is a failure (the skeleton in mapEvents.ts sees to that).
 */
export function stepSoulWell(
  ev: SoulWellEvent,
  game: GameState,
  world: World,
  events: SimEvent[],
  firstEvent: number,
): 'running' | 'success' {
  const p = game.player;
  const alive = p.health > 0;
  const atWell = alive && nearWell(ev, p.x, p.y, p.z);

  if (!ev.awake) {
    if (!atWell) return 'running';
    ev.awake = true;
    events.push({ type: 'soulWellWake', x: ev.x, y: ev.y, z: ev.z });
    return 'running';
  }

  releaseSouls(ev, game, world, events, firstEvent);

  // The souls on the ground: they sink to their height, come to you when
  // you're close, are caught, or go out.
  const chestY = p.y + currentHeight(p) * 0.6;
  ev.souls = ev.souls.filter((s) => {
    s.px = s.x;
    s.py = s.y;
    s.pz = s.z;
    if (--s.ticksLeft <= 0) {
      events.push({ type: 'soulFaded', x: s.x, y: s.y, z: s.z });
      return false;
    }
    const dx = p.x - s.x;
    const dy = chestY - s.y;
    const dz = p.z - s.z;
    const d = Math.hypot(dx, dy, dz);
    if (alive && d <= tuning.soulMagnetRange) {
      // The MAGNET: a straight line toward your chest at a fixed speed, never
      // past it. Ghosts: through walls and all (you can grab one through a
      // fence, it doesn't get stuck behind a crate).
      const step = Math.min(d, tuning.soulMagnetSpeed * TICK_DT);
      if (d > 0) {
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
        s.z += (dz / d) * step;
      }
    } else if (s.y !== s.restY) {
      // Sinking (or rising) to its resting height: an eye-bat's soul comes
      // down from the sky to where you can reach it.
      const step = tuning.soulSinkSpeed * TICK_DT;
      s.y = Math.abs(s.restY - s.y) <= step ? s.restY : s.y + Math.sign(s.restY - s.y) * step;
    }
    if (!alive || Math.hypot(p.x - s.x, chestY - s.y, p.z - s.z) > tuning.soulCollectReach) return true;
    ev.carried += s.value;
    events.push({ type: 'soulCollected', x: s.x, y: s.y, z: s.z, value: s.value, carried: ev.carried });
    return false;
  });

  // At the well with souls in your hands: all of them go in.
  if (atWell && ev.carried > 0) {
    const souls = ev.carried;
    ev.carried = 0;
    ev.filled = Math.min(ev.goal, ev.filled + souls);
    events.push({ type: 'soulsDeposited', souls, total: ev.filled, goal: ev.goal });
    if (ev.filled >= ev.goal) return 'success';
  }
  return 'running';
}

/**
 * Close enough to the well to wake it and to drop the souls in: within
 * soulWellReach meters of its middle on the ground plane, and at about its
 * height (on the ground around it, on its little roof; not on the roof of
 * the saloon across the street).
 */
function nearWell(ev: SoulWellEvent, x: number, y: number, z: number): boolean {
  return Math.hypot(x - ev.x, z - ev.z) <= tuning.soulWellReach && y > ev.y - 2.5 && y < ev.y + 3;
}

/**
 * A soul for every enemy killed this tick (from the `hit` events with
 * `killed`, like the drops in pickups.ts), worth its weight. It starts at
 * the enemy's chest and will settle soulHover over the floor under it: a
 * ray straight down finds the floor (the holy fire's trick). No floor (it
 * died over a pit): the soul is lost.
 */
function releaseSouls(ev: SoulWellEvent, game: GameState, world: World, events: SimEvent[], firstEvent: number): void {
  const ticks = secondsToTicks(tuning.soulLifetime);
  for (let i = firstEvent; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'hit' || !e.killed) continue;
    const enemy = game.entities.find((en) => en.id === e.entityId);
    if (!enemy || !isEnemy(enemy) || enemy.type === 'jackal') continue;
    const y = enemy.y + SOUL_START;
    const floor = raycastBoxes(enemy.x, y, enemy.z, 0, -1, 0, FALL_REACH, world.boxes);
    if (!floor) continue;
    ev.souls.push({
      id: game.nextEntityId++,
      x: enemy.x,
      y,
      z: enemy.z,
      px: enemy.x,
      py: y,
      pz: enemy.z,
      restY: floor.y + tuning.soulHover,
      value: enemyCost(enemy),
      ticksLeft: ticks,
      ticksTotal: ticks,
    });
  }
}
