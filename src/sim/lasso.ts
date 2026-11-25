// The LASSO (docs/DESIGN.md §6): a melee weapon you can hold in your hands
// (key 5: you carry one melee weapon), with two attacks.
//
// 1. LEFT BUTTON (or the melee key, F, even with a gun in your hands): the
//    loop is thrown in front of you, medium range, and CATCHES ONE enemy: it
//    takes a little damage and is YANKED toward you, flying, to land right in
//    front of your barrels. The heavy ones (the bull, the Smith) can't be
//    dragged: the rope holds them still for a moment instead (a stunned bull
//    in the middle of its charge!). The attack itself is in kick.ts, like
//    the boot and the shovel (same key, same rules); here only the aiming:
//    lassoTarget.
// 2. RIGHT BUTTON (the alternate fire): the GRAPPLING HOOK. The loop flies
//    where you look, catches whatever it touches (a beam, a roof edge, a
//    pole... or an enemy: then you fly to IT, like Doom Eternal's meat hook)
//    and reels you in while you hold the button. Let go and you keep all the
//    speed: a slingshot. It's movement, the heart of the game.
//
// The hook is a small state machine on the player (HookState, plain data):
//   idle → (press) flying → (it gets there) attached → (let go) idle
//                         ↘ (nothing there) idle
// The ROPE PHYSICS while attached (applyHook, called by stepPlayer before
// gravity) are two simple rules, applied to your velocity:
// - REEL: accelerate toward the anchor (lassoReelAccel), but only up to
//   lassoReelMaxSpeed along the rope: the rope pulls, it doesn't fire you.
// - ROPE: the rope never gets longer (its length only shortens as it reels
//   you in): if you'd move AWAY from the anchor at full length, that part
//   of your velocity is removed. What's left turns around the anchor: a
//   pendulum. That's all a swing is: "you can't go farther than L" + gravity.
//   (Projection again: along = v · u, the part of v along the rope; v − u·along
//   is v with that part removed, the sideways rest.)
import { secondsToTicks, TICK_DT, tuning } from './config';
import { damage, hitBox, isAlive, isEnemy, type Entity } from './entities';
import { ignite } from './status';
import { hasCard } from './upgrades';
import { knockBack } from './kick';
import type { SimEvent } from './events';
import { hitCenter } from './gunDamage';
import type { InputCommand } from './command';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

export type HookPhase = 'idle' | 'flying' | 'attached';

export interface HookState {
  phase: HookPhase;
  /** The loop's tip now, and one tick ago (the renderer interpolates between them). */
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  /** Where it's flying (or what it holds): a point of the level, or the center of `entityId`. */
  tx: number;
  ty: number;
  tz: number;
  /** The enemy it's flying at / holding, -1 = the level. */
  entityId: number;
  /** Thrown at nothing: it gets to the end of the rope and comes back. */
  miss: boolean;
  /** The rope's length while attached, meters: it only shortens (reeling in). */
  length: number;
  /** Ticks since it caught. */
  ticks: number;
  /** Ticks before it can be thrown again. */
  cooldownTicks: number;
  /** The right button held the tick before (one press = one throw). */
  held: boolean;
}

export function noHook(): HookState {
  return {
    phase: 'idle', x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0,
    entityId: -1, miss: false, length: 0, ticks: 0, cooldownTicks: 0, held: false,
  };
}

/** The hook's reach, meters (card "Rampino lungo": farther). */
function hookRange(p: PlayerState): number {
  return tuning.lassoHookRange * (hasCard(p, 'longRope') ? tuning.longRopeRangeScale : 1);
}

/** The reel's acceleration and top speed along the rope, × this (card "Rampino lungo": stronger). */
function reelScale(p: PlayerState): number {
  return hasCard(p, 'longRope') ? tuning.longRopeReelScale : 1;
}

/** Is the lasso in your hands (not just on the melee key)? */
export function lassoInHand(p: PlayerState): boolean {
  return p.meleeDrawn && p.melee === 'lasso';
}

/** The eye, where the rope is thrown from (and where it pulls: close enough to the hand). */
function eye(p: PlayerState): { x: number; y: number; z: number } {
  return { x: p.x, y: p.y + currentEyeHeight(p), z: p.z };
}

/** Where you look, a unit vector (same math as the camera and the guns). */
function aimDir(p: PlayerState): { x: number; y: number; z: number } {
  const c = Math.cos(p.pitch);
  return { x: -Math.sin(p.yaw) * c, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * c };
}

/**
 * The lasso's target (left button): the enemy the loop will catch, or null.
 * The loop catches inside a CYLINDER along your aim (radius lassoCatchRadius,
 * plus the enemy's own half-width, a bit wider far away): more forgiving than
 * a bullet, it's a loop of rope, not a needle. Of the ones inside, the one
 * closest to the middle of the aim wins (a bit of distance counts too:
 * between two equally centered, the nearer). Never through a wall.
 * `slack`: how much farther than lassoRange still counts (at the moment it
 * lands, an enemy that stepped back a little is still caught).
 */
export function lassoTarget(p: PlayerState, entities: Entity[], world: World, slack = 1): Entity | null {
  const o = eye(p);
  const d = aimDir(p);
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const e of entities) {
    if (!isAlive(e)) continue;
    const b = hitBox(e);
    const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    const c = hitCenter(e);
    const vx = c.x - o.x;
    const vy = c.y - o.y;
    const vz = c.z - o.z;
    // Projection on the aim: t = how far along it; the rest = how far off it.
    const t = vx * d.x + vy * d.y + vz * d.z;
    if (t < 0 || t > tuning.lassoRange * slack + half) continue;
    const off = Math.hypot(vx - d.x * t, vy - d.y * t, vz - d.z * t);
    const allowed = tuning.lassoCatchRadius + half + t * 0.05;
    if (off > allowed) continue;
    const dist = Math.hypot(vx, vy, vz);
    if (raycastBoxes(o.x, o.y, o.z, vx / dist, vy / dist, vz / dist, dist - half, world.boxes)) continue;
    const score = off / allowed + (0.3 * t) / tuning.lassoRange;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Where the loop flies when it has nothing to catch: the end of its reach, or the wall in the way. */
export function lassoMissPoint(p: PlayerState, world: World, range: number): { x: number; y: number; z: number } {
  const o = eye(p);
  const d = aimDir(p);
  const wall = raycastBoxes(o.x, o.y, o.z, d.x, d.y, d.z, range, world.boxes);
  const t = wall ? wall.distance : range;
  return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
}

/**
 * One tick of the grappling hook (after the weapon and the melee: stepGame).
 * Throw on a new right-button press with the lasso in your hands; fly; catch;
 * let go when you let go of the button (or something breaks it).
 */
export function stepHook(p: PlayerState, cmd: InputCommand, world: World, entities: Entity[], events: SimEvent[]): void {
  const h = p.hook;
  h.px = h.x;
  h.py = h.y;
  h.pz = h.z;
  if (h.cooldownTicks > 0) h.cooldownTicks--;
  const pressed = cmd.altFire && !h.held;
  h.held = cmd.altFire;
  const inHand = lassoInHand(p);

  if (h.phase === 'idle') {
    const ready = inHand && p.switchTicks === 0 && p.kickTicks === 0 && h.cooldownTicks === 0;
    if (pressed && ready) throwHook(p, world, entities, events);
    return;
  }
  // Let go of the button (or the lasso is put away): the rope comes back.
  if (!cmd.altFire || !inHand) return release(p, events);

  // Holding an enemy: the anchor is wherever its body is now.
  if (h.entityId >= 0) {
    const e = entities.find((x) => x.id === h.entityId);
    if (!e || !isAlive(e)) return release(p, events); // it died: nothing to hold on to
    const c = hitCenter(e);
    h.tx = c.x;
    h.ty = c.y;
    h.tz = c.z;
  }
  const o = eye(p);

  if (h.phase === 'flying') {
    // The loop flies at lassoHookSpeed toward the target (which may be moving).
    const step = tuning.lassoHookSpeed * TICK_DT;
    const dx = h.tx - h.x;
    const dy = h.ty - h.y;
    const dz = h.tz - h.z;
    const left = Math.hypot(dx, dy, dz);
    if (left > step) {
      h.x += (dx / left) * step;
      h.y += (dy / left) * step;
      h.z += (dz / left) * step;
      // An enemy that runs off faster than the rope: it never catches it.
      if (Math.hypot(h.x - o.x, h.y - o.y, h.z - o.z) > hookRange(p) * 1.2) release(p, events);
      return;
    }
    h.x = h.tx;
    h.y = h.ty;
    h.z = h.tz;
    if (h.miss) return release(p, events); // the end of the rope: nothing caught
    // Card "Corda rovente": the loop bites into an enemy red-hot.
    if (h.entityId >= 0 && hasCard(p, 'hotRope')) {
      const e = entities.find((x) => x.id === h.entityId);
      if (e) ignite(e);
    }
    return attach(p, events);
  }

  // Attached.
  h.x = h.tx;
  h.y = h.ty;
  h.z = h.tz;
  h.ticks++;
  const dx = h.x - o.x;
  const dy = h.y - o.y;
  const dz = h.z - o.z;
  const dist = Math.hypot(dx, dy, dz);
  // Arrived (closer to an enemy: you'd be inside its body), or held too long: let go, keep the speed.
  const arrive = h.entityId >= 0 ? tuning.lassoEnemyDetach : tuning.lassoHookDetach;
  if (dist < arrive && h.entityId >= 0 && hasCard(p, 'bootArrival')) {
    const e = entities.find((x) => x.id === h.entityId);
    if (e) bootArrival(p, e, events);
  }
  if (dist < arrive || h.ticks > secondsToTicks(tuning.lassoHookMaxTime)) return release(p, events);
  // The rope snagged on a corner between you and the anchor: it slips off.
  // (Stopping a bit short of the anchor: the last stretch is the surface it holds.)
  if (dist > 0.6 && raycastBoxes(o.x, o.y, o.z, dx / dist, dy / dist, dz / dist, dist - 0.5, world.boxes)) {
    return release(p, events);
  }
}

function throwHook(p: PlayerState, world: World, entities: Entity[], events: SimEvent[]): void {
  const h = p.hook;
  const o = eye(p);
  const d = aimDir(p);
  const range = hookRange(p);
  // Two rays, like a bullet: the level and the enemies. The nearer one wins.
  const level = raycastBoxes(o.x, o.y, o.z, d.x, d.y, d.z, range, world.boxes);
  const living = entities.filter(isAlive);
  const body = raycastBoxes(o.x, o.y, o.z, d.x, d.y, d.z, range, living.map(hitBox));
  h.phase = 'flying';
  h.x = h.px = o.x;
  h.y = h.py = o.y;
  h.z = h.pz = o.z;
  h.entityId = -1;
  h.miss = false;
  if (body && (!level || body.distance < level.distance)) {
    const e = living[body.index];
    const c = hitCenter(e);
    h.entityId = e.id;
    h.tx = c.x;
    h.ty = c.y;
    h.tz = c.z;
  } else {
    const t = level ? level.distance : range;
    h.miss = !level;
    h.tx = o.x + d.x * t;
    h.ty = o.y + d.y * t;
    h.tz = o.z + d.z * t;
  }
  events.push({ type: 'hookThrow', x: h.tx, y: h.ty, z: h.tz, miss: h.miss });
}

function attach(p: PlayerState, events: SimEvent[]): void {
  const h = p.hook;
  const o = eye(p);
  h.phase = 'attached';
  h.ticks = 0;
  h.length = Math.hypot(h.x - o.x, h.y - o.y, h.z - o.z);
  // Standing on the ground: a little hop, so the first pull lifts you off
  // instead of dragging your boots (on the ground friction would eat it).
  if (p.onGround) {
    p.vy = Math.max(p.vy, tuning.lassoHookHop);
    p.onGround = false;
  }
  events.push({ type: 'hookAttach', x: h.x, y: h.y, z: h.z, entityId: h.entityId });
}

/**
 * Card "Arrivo di stivale": pulled all the way to an enemy, you arrive boot
 * first (Doom Eternal's meat hook, plus a kick): damage, a push along the way
 * you were flying, and a stun. Reported as a kick: same sound, same Style.
 */
function bootArrival(p: PlayerState, e: Entity, events: SimEvent[]): void {
  if (!isEnemy(e) || !isAlive(e)) return;
  const c = hitCenter(e);
  const killed = damage(e, tuning.bootArrivalDamage);
  events.push({
    type: 'hit', entityId: e.id, damage: tuning.bootArrivalDamage, killed, surface: 'flesh',
    headshot: false, source: 'kick', distance: Math.hypot(c.x - p.x, c.z - p.z), target: e.type,
  });
  if (!killed) {
    // Along your flight (or straight away from you, if you came in slow).
    const speed = Math.hypot(p.vx, p.vz);
    const dx = speed > 0.1 ? p.vx : c.x - p.x;
    const dz = speed > 0.1 ? p.vz : c.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    knockBack(e, dx / len, dz / len, tuning.bootArrivalPush, 5);
    if (e.type !== 'smith') e.stunTicks = Math.max(e.stunTicks ?? 0, secondsToTicks(tuning.bootArrivalStun));
  }
  events.push({ type: 'kickLand', tool: 'kick', hits: 1, at: [{ ...c, flesh: true }], power: 1 });
}

function release(p: PlayerState, events: SimEvent[]): void {
  const h = p.hook;
  // Card "Fionda": let go in mid-air and the rope throws you on, along where
  // you were already going (scaling the velocity vector keeps its direction).
  let sling = false;
  if (h.phase === 'attached' && !p.onGround && hasCard(p, 'slingshot')) {
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    if (speed > 1) {
      const k = (speed + tuning.slingshotBoost) / speed;
      p.vx *= k;
      p.vy *= k;
      p.vz *= k;
      sling = true;
    }
  }
  events.push({ type: 'hookRelease', x: h.x, y: h.y, z: h.z, attached: h.phase === 'attached', sling });
  h.phase = 'idle';
  h.entityId = -1;
  h.cooldownTicks = secondsToTicks(tuning.lassoHookCooldown);
}

/** Is the rope pulling you right now? (stepPlayer: no ground friction, it would eat the pull.) */
export function hooked(p: PlayerState): boolean {
  return p.hook.phase === 'attached';
}

/**
 * The rope's pull on your velocity, once per tick (stepPlayer, after your own
 * movement and before gravity). See the top of the file: REEL + ROPE.
 */
export function applyHook(p: PlayerState, dt: number): void {
  const h = p.hook;
  if (h.phase !== 'attached') return;
  const o = eye(p);
  const dx = h.x - o.x;
  const dy = h.y - o.y;
  const dz = h.z - o.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.01) return;
  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;
  // REEL: speed toward the anchor, up to the reel's own top speed.
  let along = p.vx * ux + p.vy * uy + p.vz * uz;
  const top = tuning.lassoReelMaxSpeed * reelScale(p);
  if (along < top) {
    const add = Math.min(tuning.lassoReelAccel * reelScale(p) * dt, top - along);
    p.vx += ux * add;
    p.vy += uy * add;
    p.vz += uz * add;
    along += add;
  }
  // Part of the gravity is held by the rope (it's pulling you up, not only along): the pull doesn't sag.
  p.vy += tuning.gravity * tuning.lassoHookLift * dt;
  // ROPE: never longer than it is now. Moving away at full length: that part is removed.
  h.length = Math.min(h.length, dist);
  if (dist >= h.length - 0.01 && along < 0) {
    p.vx -= ux * along;
    p.vy -= uy * along;
    p.vz -= uz * along;
  }
}
