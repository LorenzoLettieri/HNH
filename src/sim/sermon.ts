// "Spettacolo Cruento", the seventh map event (docs/DESIGN.md §5; on paper
// it was "Il Sermone di Sangue"): a STYLE challenge. A hellfire preacher
// stands on his soapbox in front of the church and wants a SHOW: reach HIGH
// NOON (the top of the style meter, style.ts) inside his circle.
//
// Why it makes you move: HIGH NOON is built with movement and variety (the
// style chain), not by standing still; the circle (a column, like the Ember
// Heart's, so the church roof counts) keeps the show in front of him, and the
// horde follows you in. The wave is the clock: if it ends first, the event fails.
//
// What counts is the MOMENT HIGH NOON STARTS: it must start while you're in
// the circle. A HIGH NOON that starts outside doesn't count (the preacher
// didn't see it: event 'sermonMissed'), and walking in already in HIGH NOON
// doesn't either: you have to light it up under his eyes. When it's over the
// style starts from zero, and you can try again.
//
// It doesn't touch the style: it only READS it. stepMapEvents runs before
// stepStyle in the tick, so the HIGH NOON seen here is the one that started
// at the end of the last tick: one tick late, nobody can tell.
//
// Pure simulation: the preacher isn't an entity (enemies ignore him, bullets
// go through him, like the vendors), only a point of the level.
import { tuning } from './config';
import type { SimEvent } from './events';
import type { GameState } from './game';
import type { PlayerState } from './player';
import { isHighNoon } from './style';
import type { World } from './world';

/** The show while it's being played: plain data, inside the GameState. */
export interface SermonEvent {
  kind: 'sermon';
  /** The wave it showed up in (it ends with it). */
  wave: number;
  /** Asleep (reading his book) until you walk to him: only then does the show count. */
  awake: boolean;
  /** Where he stands: feet on the ground, in front of his soapbox (world.preacher). */
  x: number;
  y: number;
  z: number;
  /** Was HIGH NOON on, last tick? Only the switch from off to on counts. */
  wasHighNoon: boolean;
}

/** A new show, or null if the level has no preacher's spot (the test arena). */
export function createSermonEvent(world: World, game: GameState, wave: number): SermonEvent | null {
  const spot = world.preacher;
  if (!spot) return null;
  return { kind: 'sermon', wave, awake: false, x: spot.x, y: spot.y, z: spot.z, wasHighNoon: isHighNoon(game.style) };
}

/**
 * Inside his circle: within sermonRadius of him on the ground plane, at any
 * height (a column: the rooftops around him count, he looks up too). Only
 * while he's awake. The HUD and the renderer ask it too.
 */
export function inSermonCircle(ev: SermonEvent, p: PlayerState): boolean {
  return ev.awake && Math.hypot(p.x - ev.x, p.z - ev.z) <= tuning.sermonRadius;
}

/**
 * One tick of the show. Asleep: waits for you to come close. Awake: watches
 * for HIGH NOON starting. Says 'success' when it starts in the circle; the
 * wave ending first is a failure (the skeleton in mapEvents.ts sees to that).
 */
export function stepSermon(ev: SermonEvent, game: GameState, events: SimEvent[]): 'running' | 'success' {
  const p = game.player;
  const highNoon = isHighNoon(game.style);
  const started = highNoon && !ev.wasHighNoon;
  ev.wasHighNoon = highNoon;
  if (p.health <= 0) return 'running';

  if (!ev.awake) {
    // Close to him and at about his height (on the forecourt, not on the church roof above him).
    const near = Math.hypot(p.x - ev.x, p.z - ev.z) <= tuning.sermonWakeReach && Math.abs(p.y - ev.y) < 3;
    if (!near) return 'running';
    ev.awake = true;
    events.push({ type: 'sermonWake', x: ev.x, y: ev.y, z: ev.z });
    return 'running';
  }

  if (!started) return 'running';
  if (inSermonCircle(ev, p)) return 'success';
  events.push({ type: 'sermonMissed' });
  return 'running';
}
