// The kick: a melee attack with the boot. It doesn't use the gun, so you can
// kick while reloading (that's the point: it saves you when the cylinder is
// empty and a ghoul is in your face).
//
// How it works:
// 1. One press = one kick (like the revolver's trigger), then a cooldown.
// 2. A tiny wind-up (kickWindup), then the foot "lands": on that tick we look
//    for everything inside a CONE in front of you (an area attack, not a
//    ray like the bullet): close enough, inside the angle, at body height,
//    and not behind a wall.
// 3. Everything in the cone takes damage and gets an impulse: thrown back and
//    a bit up. A ghoul lifted off its feet can't steer (its AI only
//    accelerates on the ground), so it really flies, then stays down for a
//    moment (state 'staggered', see ghoul.ts).
//
// The SHOVEL (bought at the armory) takes the boot's place: same key, same
// code, only the numbers change (longer reach, wider arc, more damage). The
// numbers are picked once per attack by meleeStats(): the attack doesn't
// care WHAT hits, only how far, how wide, how hard. (Like a Laravel
// controller that receives a config array instead of an if per case.)
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import { damage, hitBox, isAlive, isEnemy, type Entity } from './entities';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** What swings when you press F: your boot, or the shovel once you own it. */
export type MeleeTool = 'kick' | 'shovel';

/** The numbers of a melee attack (read from tuning every time: the debug panel can change them). */
interface MeleeStats {
  windup: number;
  cooldown: number;
  range: number;
  angle: number;
  damage: number;
  knockback: number;
  lift: number;
}

export function meleeTool(p: PlayerState): MeleeTool {
  return p.owned.shovel ? 'shovel' : 'kick';
}

function meleeStats(tool: MeleeTool): MeleeStats {
  if (tool === 'shovel') {
    return {
      windup: tuning.shovelWindup,
      cooldown: tuning.shovelCooldown,
      range: tuning.shovelRange,
      angle: tuning.shovelAngle,
      damage: tuning.shovelDamage,
      knockback: tuning.shovelKnockback,
      lift: tuning.shovelLift,
    };
  }
  return {
    windup: tuning.kickWindup,
    cooldown: tuning.kickCooldown,
    range: tuning.kickRange,
    angle: tuning.kickAngle,
    damage: tuning.kickDamage,
    knockback: tuning.kickKnockback,
    lift: tuning.kickLift,
  };
}

export function stepKick(p: PlayerState, cmd: InputCommand, world: World, entities: Entity[], events: SimEvent[]): void {
  const tool = meleeTool(p);
  const stats = meleeStats(tool);
  if (p.kickCooldownTicks > 0) p.kickCooldownTicks--;

  // New press (not held from before) and ready: start a kick.
  const pressed = cmd.kick && !p.kickHeld;
  p.kickHeld = cmd.kick;
  if (pressed && p.kickCooldownTicks === 0) {
    p.kickTicks = 1;
    p.kickCooldownTicks = secondsToTicks(stats.cooldown);
    events.push({ type: 'kickStart', tool });
    // (With a wind-up of 0 the foot lands on this very tick: falls through.)
  } else if (p.kickTicks > 0) {
    p.kickTicks++;
  }

  // The foot lands exactly once, at the end of the wind-up.
  if (p.kickTicks > 0 && p.kickTicks === Math.max(1, secondsToTicks(stats.windup))) {
    landKick(p, tool, stats, world, entities, events);
  }
  // The kick is "over" when the cooldown is: the renderer reads kickTicks to animate the leg.
  if (p.kickCooldownTicks === 0) p.kickTicks = 0;
}

function landKick(
  p: PlayerState,
  tool: MeleeTool,
  stats: MeleeStats,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  // Where you look, flattened on the ground (a kick doesn't care about pitch:
  // looking down at a ghoul in front of you still kicks it).
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  // Comparing the dot product with cos(angle) instead of computing angles:
  // dot(a, b) = |a|·|b|·cos(angle between them). With unit vectors it IS the
  // cosine, and "angle < 45°" becomes "dot > cos 45°". No acos needed.
  const minDot = Math.cos((stats.angle * Math.PI) / 180);
  const hipY = p.y + 0.9;

  let hits = 0;
  const at: { x: number; y: number; z: number; flesh: boolean }[] = [];
  for (const e of entities) {
    if (!isAlive(e)) continue;
    const b = hitBox(e);
    // Vertical: its body must overlap your legs-to-head (+ a bit of reach).
    if (b.minY > p.y + tuning.playerHeight + 0.2 || b.maxY < p.y - 0.3) continue;

    // Horizontal: center of its box, distance and direction from you.
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const radius = (b.maxX - b.minX) / 2;
    const dx = cx - p.x;
    const dz = cz - p.z;
    const dist = Math.hypot(dx, dz);
    // Distance between the EDGES of the two bodies, not the centers.
    if (dist - radius - tuning.playerRadius > stats.range) continue;
    // Inside the cone? (If it's basically on top of you, it counts.)
    const dirX = dist > 0.01 ? dx / dist : fx;
    const dirZ = dist > 0.01 ? dz / dist : fz;
    if (dist > radius + tuning.playerRadius && dirX * fx + dirZ * fz < minDot) continue;

    // No kicking through a fence: ray from your hip to its center.
    const cy = Math.min((b.minY + b.maxY) / 2, p.y + tuning.playerHeight);
    const ry = cy - hipY;
    const rLen = Math.hypot(dx, ry, dz);
    if (rLen > 0.01 && raycastBoxes(p.x, hipY, p.z, dx / rLen, ry / rLen, dz / rLen, rLen, world.boxes)) continue;

    hits++;
    // Contact point: from its center, one radius toward you, at the height
    // you'd hit it (your chest, kept inside its body).
    const toYou = dist > 0.01 ? radius / dist : 0;
    at.push({
      x: cx - dx * toYou,
      y: Math.max(b.minY, Math.min(b.maxY, p.y + 1.2)),
      z: cz - dz * toYou,
      flesh: isEnemy(e),
    });
    const killed = damage(e, stats.damage);
    events.push({
      type: 'hit',
      entityId: e.id,
      damage: stats.damage,
      killed,
      surface: isEnemy(e) ? 'flesh' : 'metal',
      headshot: false,
      source: tool,
      distance: dist,
      target: e.type,
    });

    // Knockback direction: halfway between "away from you" and "where you
    // look". Pure "away" scatters a crowd sideways; pure "where you look"
    // pulls things that are on your side across your face. The mix feels aimed.
    let kx = dirX + fx;
    let kz = dirZ + fz;
    const kLen = Math.hypot(kx, kz) || 1;
    kx /= kLen;
    kz /= kLen;
    knockBack(e, kx, kz, stats.knockback, stats.lift);
  }
  events.push({ type: 'kickLand', tool, hits, at });
}

/**
 * Throws an enemy: horizontal speed along (dirX, dirZ) (a unit vector) and
 * a lift upward. Shared by the kick and the point-blank shotgun blast.
 * A ghoul lifted off its feet can't steer (its AI only accelerates on the
 * ground), so it really flies, then stays down a moment ('staggered').
 */
export function knockBack(e: Entity, dirX: number, dirZ: number, speed: number, lift: number): void {
  if (e.type === 'ghoul' && e.state !== 'dead') {
    e.vx = dirX * speed;
    e.vz = dirZ * speed;
    e.vy = lift;
    e.onGround = false;
    e.climbTo = -1; // knocked off the wall
    e.state = 'staggered'; // interrupts claws and pounces too
    e.stateTicks = 0;
  } else if (e.type === 'hound' && e.state !== 'dead') {
    e.vx = dirX * speed;
    e.vz = dirZ * speed;
    e.vy = lift;
    e.onGround = false;
    e.state = 'staggered'; // interrupts the bite too
    e.stateTicks = 0;
  } else if (e.type === 'sharpshooter' && e.state !== 'dead') {
    // A light skeleton: it flies back (and keeps aiming: being kicked doesn't
    // interrupt the laser, for now). Kicked while climbing: it falls off the wall.
    e.vx = dirX * speed;
    e.vz = dirZ * speed;
    e.vy = lift;
    e.onGround = false;
    e.climbTo = -1;
  } else if (e.type === 'bull' || e.type === 'smith') {
    // Too heavy: it takes the damage, but doesn't budge.
  } else if (e.type === 'eyebat') {
    // It flies: no lift needed. Its steering brings it back in a moment
    // (or, if the hit killed it, it falls while flying away).
    e.vx = dirX * speed;
    e.vz = dirZ * speed;
    e.vy += lift * 0.5;
  }
}
