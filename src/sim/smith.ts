// The Damned Smith's AI (docs/DESIGN.md §6d): the special enemy of waves 9,
// 19, 29... Inspired by CoD Zombies' Panzer Soldat in its ROLE (tough, with
// attacks unlike anyone else's), not in its looks: here it's hell's own
// blacksmith, armored, with a huge hammer. Only its head takes critical hits.
//
//   approach ──(you're close and on its level)──▶ windup (hammer raised: the WARNING)
//      ▲                                             │
//      └──────── recover (hammer stuck in the ground) ◀── slam → SHOCKWAVE
//
// - APPROACH: walks toward you on the bulls' navigation graph (it has the
//   bull's collider), slowly. It doesn't need to catch you: its attack reaches far.
// - WINDUP: stops, turns to face you, raises the hammer. You hear it, you see it.
// - SLAM: the hammer hits the ground in front of it and a SHOCKWAVE starts
//   there: a ring that spreads along the ground. If you're standing on the
//   ground when the ring passes under you, it hits you; JUMP over it.
//   Movement is the heart of the game: the counter to its attack is a jump
//   at the right moment, not hiding behind a wall.
// - RECOVER: the hammer stays stuck for a moment: the time to shoot its head.
//
// It ignores kicks and shotgun blasts (kick.ts) and the bulls' charges: too heavy.
// It doesn't climb: if you're on a roof it waits below (and the ring runs on
// ITS ground, so up there it can't reach you either).
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { Entity, SmithEntity } from './entities';
import type { SimEvent } from './events';
import { jumpTo } from './ghoul';
import { nearestNode, type FlowField, type NavGraph, type NavLink } from './nav';
import { hurtPlayer, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** How far in front of it the hammer hits the ground (where the ring starts), meters. */
const HAMMER_REACH = 1.6;

export function stepSmith(
  s: SmithEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  s.stateTicks++;
  if (s.slamCooldownTicks > 0) s.slamCooldownTicks--;
  // The wave keeps running even if the Smith dies right after the slam.
  stepWave(s, player, dt, events);

  if (s.state === 'dead') {
    stand(s, world, dt);
    return;
  }
  if (s.onGround) {
    const node = nearestNode(graph, s.x, s.y, s.z);
    if (node >= 0) s.navNode = node;
  }
  const dist = Math.hypot(player.x - s.x, player.z - s.z);

  if (s.state === 'approach') {
    const canSlam =
      s.onGround &&
      s.slamCooldownTicks === 0 &&
      dist < tuning.smithSlamRange &&
      Math.abs(player.y - s.y) < 1.5 &&
      player.health > 0;
    if (canSlam) {
      setState(s, 'windup');
      events.push({ type: 'smithWindup', entityId: s.id });
    } else {
      walk(s, player, dist, others, world, graph, flow, dt);
    }
  } else if (s.state === 'windup') {
    stand(s, world, dt);
    face(s, player.x, player.z);
    if (s.stateTicks >= secondsToTicks(tuning.smithSlamWindup)) {
      // BOOM: the ring starts where the hammer lands, in front of it.
      setState(s, 'recover');
      s.waveTicks = 0;
      s.waveX = s.x + s.dirX * HAMMER_REACH;
      s.waveY = s.y;
      s.waveZ = s.z + s.dirZ * HAMMER_REACH;
      s.waveHit = false;
      events.push({ type: 'smithSlam', entityId: s.id, x: s.waveX, y: s.waveY, z: s.waveZ });
    }
  } else {
    // Recover: the hammer is stuck in the ground.
    stand(s, world, dt);
    if (s.stateTicks >= secondsToTicks(tuning.smithSlamRecover)) {
      setState(s, 'approach');
      s.slamCooldownTicks = secondsToTicks(tuning.smithSlamCooldown);
    }
  }
}

/**
 * The shockwave: a ring around (waveX, waveZ) whose radius grows by
 * smithWaveSpeed × dt every tick. Does it hit you THIS tick?
 *
 * The ring moves 0.2 m per tick: checking "are you exactly on the ring now"
 * could miss you between two ticks. So we check the whole band it SWEPT this
 * tick, from last tick's radius to this tick's (plus half the thickness on
 * both sides): the same idea as the enemy projectiles' swept collision.
 * And you must be on the ground: your feet no higher than smithWaveHeight
 * above the ground the ring runs on (and not far below: another floor).
 */
function stepWave(s: SmithEntity, player: PlayerState, dt: number, events: SimEvent[]): void {
  if (s.waveTicks < 0) return;
  const before = s.waveTicks * dt * tuning.smithWaveSpeed;
  s.waveTicks++;
  const now = s.waveTicks * dt * tuning.smithWaveSpeed;
  if (before > tuning.smithWaveRange) {
    s.waveTicks = -1; // spent
    return;
  }
  if (s.waveHit || player.health <= 0) return;
  const half = tuning.smithWaveThickness / 2;
  const d = Math.hypot(player.x - s.waveX, player.z - s.waveZ);
  const feet = player.y - s.waveY;
  const onItsGround = feet > -0.5 && feet < tuning.smithWaveHeight;
  if (onItsGround && d >= before - half && d <= now + half) {
    s.waveHit = true;
    hurtPlayer(player, tuning.smithWaveDamage, s.waveX, s.waveZ, tuning.smithWaveKnockback);
    player.vy = Math.max(player.vy, tuning.smithWaveLift);
    events.push({ type: 'playerHurt', damage: tuning.smithWaveDamage, fromX: s.waveX, fromZ: s.waveZ });
  }
}

/** Walks toward you: straight if the way is clear, otherwise along the flow field (like the bull). */
function walk(
  s: SmithEntity,
  player: PlayerState,
  dist: number,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
): void {
  let tx = player.x;
  let tz = player.z;
  let link: NavLink | null = null;
  if (!clearPath(s, player, dist, world)) {
    const next = s.navNode >= 0 ? flow.next[s.navNode] : null;
    if (next && next.kind !== 'climb' && next.kind !== 'vent') {
      tx = graph.nodes[next.to].x;
      tz = graph.nodes[next.to].z;
      link = next;
    }
  }
  const dx = tx - s.x;
  const dz = tz - s.z;
  const d = Math.hypot(dx, dz);
  let wishX = d > 0.3 ? dx / d : 0;
  let wishZ = d > 0.3 ? dz / d : 0;
  if (d > 0.3) face(s, tx, tz);
  // Separation from the other big bodies (bulls, another Smith): the boids push.
  const minGap = tuning.smithRadius * 2 + 0.6;
  for (const o of others) {
    if (o === s || (o.type !== 'smith' && o.type !== 'bull') || o.state === 'dead') continue;
    const ox = s.x - o.x;
    const oz = s.z - o.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.001 && od < minGap) {
      const push = (minGap - od) / minGap;
      wishX += (ox / od) * push * 1.5;
      wishZ += (oz / od) * push * 1.5;
    }
  }
  const len = Math.hypot(wishX, wishZ);
  if (len > 1) {
    wishX /= len;
    wishZ /= len;
  }
  if (s.onGround) {
    const k = Math.min(1, tuning.smithAccel * dt);
    s.vx += (wishX * tuning.smithSpeed - s.vx) * k;
    s.vz += (wishZ * tuning.smithSpeed - s.vz) * k;
    if (link && link.kind === 'jump' && d < 3) jumpTo(s, graph.nodes[link.to]);
  }
  s.vy -= tuning.gravity * dt;
  // Move; if a low obstacle stopped it, step over it (same trick as the bull).
  const speedBefore = Math.hypot(s.vx, s.vz);
  const { landed } = moveAndCollide(s, tuning.smithRadius, tuning.smithHeight, world.boxes, dt);
  s.onGround = landed;
  const blocked = speedBefore > 0.2 && Math.hypot(s.vx, s.vz) < speedBefore * 0.5;
  if (s.onGround && blocked && d > 0.3) {
    const step = tuning.bullJumpHeight; // same body as the bull: same steps
    const room = !overlapsAny(
      s.x + wishX * 0.4, s.y + step, s.z + wishZ * 0.4,
      tuning.smithRadius, tuning.smithHeight, world.boxes,
    );
    if (room) {
      s.vy = Math.sqrt(2 * tuning.gravity * (step + 0.15));
      s.onGround = false;
    }
  }
}

/** Turn to face a point (at once: it's slow, turning isn't where its danger is). */
function face(s: SmithEntity, x: number, z: number): void {
  const dx = x - s.x;
  const dz = z - s.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  s.dirX = dx / d;
  s.dirZ = dz / d;
}

/** Standing still: friction on the ground, gravity, collisions. */
function stand(s: SmithEntity, world: World, dt: number): void {
  if (s.onGround) {
    const k = Math.min(1, 6 * dt);
    s.vx -= s.vx * k;
    s.vz -= s.vz * k;
  }
  s.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(s, tuning.smithRadius, tuning.smithHeight, world.boxes, dt);
  s.onGround = landed;
}

function setState(s: SmithEntity, state: SmithEntity['state']): void {
  s.state = state;
  s.stateTicks = 0;
}

/** Is the straight line to you clear? A ray at knee height (like the bull's). */
function clearPath(s: SmithEntity, player: PlayerState, dist: number, world: World): boolean {
  if (dist < 0.01) return true;
  const dx = (player.x - s.x) / dist;
  const dz = (player.z - s.z) / dist;
  return raycastBoxes(s.x, s.y + 0.5, s.z, dx, 0, dz, dist, world.boxes) === null;
}
