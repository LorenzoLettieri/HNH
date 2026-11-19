// Hellhound AI, first version: a FAST runner. No tricks yet (the ambush
// behavior comes next): it follows the same flow field as the ghouls, runs
// at you faster than you can run on foot, and bites.
// - Far away: next node of the flow field (walk, drop, jump across gaps).
//   It does NOT climb walls or ride vents (it's a dog): when the way to you
//   needs a climb, it waits below, running at you as close as it can get.
// - Close and on your level: straight at you.
// - Blocked by something low: it hops over it.
// - In range: bite. A short wind-up (jaws open), then the teeth close:
//   still in range at that moment = you get bitten.
//      chase ──(in range)──▶ bite: wind-up ──▶ teeth ──▶ chase
import { moveAndCollide, overlapsAny } from './collision';
import { secondsToTicks, tuning } from './config';
import type { Entity, HoundEntity } from './entities';
import type { SimEvent } from './events';
import { jumpTo } from './ghoul';
import { nearestNode, type FlowField, type NavGraph, type NavLink } from './nav';
import { hurtPlayer, type PlayerState } from './player';
import type { World } from './world';

/** Within this distance, on your level, it stops following the graph and runs straight at you, meters. */
const DIRECT_RANGE = 6;

export function stepHound(
  h: HoundEntity,
  player: PlayerState,
  others: Entity[],
  world: World,
  graph: NavGraph,
  flow: FlowField,
  dt: number,
  events: SimEvent[],
): void {
  h.stateTicks++;
  if (h.biteCooldownTicks > 0) h.biteCooldownTicks--;

  // Dead or thrown by a kick: no steering, just a falling body.
  if (h.state === 'dead' || h.state === 'staggered') {
    fall(h, world, dt);
    return;
  }

  // --- 1. Where to go ---
  if (h.onGround) {
    const node = nearestNode(graph, h.x, h.y, h.z);
    if (node >= 0) h.navNode = node;
  }
  const distToPlayer = Math.hypot(player.x - h.x, player.z - h.z);
  const sameLevel = Math.abs(player.y - h.y) < 0.8;
  let link: NavLink | null = null;
  let targetX = player.x;
  let targetZ = player.z;
  if (!(sameLevel && distToPlayer < DIRECT_RANGE) && h.navNode >= 0 && flow.next[h.navNode]) {
    const next = flow.next[h.navNode]!;
    // Climbs and vents are for ghouls: a dog stays below and keeps "targetX/Z = you".
    if (next.kind !== 'climb' && next.kind !== 'vent') {
      link = next;
      targetX = graph.nodes[link.to].x;
      targetZ = graph.nodes[link.to].z;
    }
  }

  // --- 2. Wished direction: toward the target, plus separation ---
  // Same "boids" push as the ghouls, from every ground enemy: hounds and
  // ghouls don't stack on each other.
  let wishX = 0;
  let wishZ = 0;
  const dx = targetX - h.x;
  const dz = targetZ - h.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.01) {
    wishX = dx / dist;
    wishZ = dz / dist;
  }
  for (const o of others) {
    if (o === h || (o.type !== 'hound' && o.type !== 'ghoul') || o.state === 'dead') continue;
    const ox = h.x - o.x;
    const oz = h.z - o.z;
    const d = Math.hypot(ox, oz);
    if (d > 0.001 && d < tuning.ghoulSeparation) {
      const push = (tuning.ghoulSeparation - d) / tuning.ghoulSeparation;
      wishX += (ox / d) * push * 1.5;
      wishZ += (oz / d) * push * 1.5;
    }
  }

  // --- 3. Accelerate toward the wished velocity (only with feet on the ground) ---
  const len = Math.hypot(wishX, wishZ);
  const targetVx = len > 0 ? (wishX / len) * tuning.houndSpeed : 0;
  const targetVz = len > 0 ? (wishZ / len) * tuning.houndSpeed : 0;
  if (h.onGround) {
    const k = Math.min(1, tuning.houndAccel * dt);
    h.vx += (targetVx - h.vx) * k;
    h.vz += (targetVz - h.vz) * k;
    // Jump links (gaps, steps): the same ballistic jump as the ghoul.
    if (link && link.kind === 'jump' && dist < 3) jumpTo(h, graph.nodes[link.to]);
  }
  h.vy -= tuning.gravity * dt;

  // --- 4. Move; if a low obstacle stopped it, hop over ---
  const speedBefore = Math.hypot(h.vx, h.vz);
  const { landed } = moveAndCollide(h, tuning.houndRadius, tuning.houndHeight, world.boxes, dt);
  h.onGround = landed;
  const blocked = speedBefore > 0.2 && Math.hypot(h.vx, h.vz) < speedBefore * 0.5;
  if (h.onGround && blocked && len > 0) {
    const aheadX = h.x + (wishX / len) * 0.4;
    const aheadZ = h.z + (wishZ / len) * 0.4;
    const room = !overlapsAny(aheadX, h.y + tuning.houndJumpHeight, aheadZ, tuning.houndRadius, tuning.houndHeight, world.boxes);
    if (room) {
      h.vy = Math.sqrt(2 * tuning.gravity * (tuning.houndJumpHeight + 0.15));
      h.onGround = false;
    }
  }

  // --- 5. Bite ---
  const sameHeight = Math.abs(player.y - h.y) < 1.2;
  if (h.state === 'chase' && distToPlayer < tuning.houndBiteRange && sameHeight && h.biteCooldownTicks === 0) {
    h.state = 'bite';
    h.stateTicks = 0;
    events.push({ type: 'houndBite', entityId: h.id });
  }
  if (h.state === 'bite' && h.stateTicks >= secondsToTicks(tuning.houndBiteWindup)) {
    // The teeth close: are you still there? (A bit of extra reach: it lunges with its neck.)
    if (distToPlayer < tuning.houndBiteRange + 0.4 && sameHeight && player.health > 0) {
      hurtPlayer(player, tuning.houndBiteDamage, h.x, h.z, tuning.houndBiteKnockback);
      events.push({ type: 'playerHurt', damage: tuning.houndBiteDamage, fromX: h.x, fromZ: h.z });
    }
    h.state = 'chase';
    h.stateTicks = 0;
    h.biteCooldownTicks = secondsToTicks(tuning.houndBiteCooldown);
  }
}

/**
 * No steering: gravity, collisions and friction on the ground. Used when
 * thrown (kick, shotgun) and when dead (a hound shot in mid-jump falls,
 * it doesn't hang in the air). Thrown: back on its feet kickStun seconds
 * after landing.
 */
function fall(h: HoundEntity, world: World, dt: number): void {
  if (h.onGround) {
    const k = Math.min(1, 8 * dt);
    h.vx -= h.vx * k;
    h.vz -= h.vz * k;
  } else if (h.state === 'staggered') {
    h.stateTicks = 0; // still flying: the "down" timer hasn't started
  }
  h.vy -= tuning.gravity * dt;
  const { landed } = moveAndCollide(h, tuning.houndRadius, tuning.houndHeight, world.boxes, dt);
  h.onGround = landed;
  if (h.state === 'staggered' && h.onGround && h.stateTicks >= secondsToTicks(tuning.kickStun)) {
    h.state = 'chase';
    h.stateTicks = 0;
    h.biteCooldownTicks = secondsToTicks(0.3);
  }
}
