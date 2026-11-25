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
// The MELEE WEAPONS (bought at the armory: the shovel, the lasso) take the
// boot's place: same key, same code, only the numbers change (longer reach,
// wider arc, more damage). The numbers are picked once per attack by
// meleeStats(): the attack doesn't care WHAT hits, only how far, how wide,
// how hard. (Like a Laravel controller that receives a config array instead
// of an if per case.) They are also SLOTS (keys 5, 6: weapon.ts): with one in
// your hands, the LEFT button attacks with it too, like F.
//
// The LASSO is the odd one: not a cone around you but a loop thrown in front
// of you, 9 m: it catches ONE enemy (lassoTarget in lasso.ts, picked at the
// press so the loop on screen flies at it) and YANKS it toward you (yank).
import { hasDrink } from './drinks';
import { stun } from './status';
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import { damage, hitBox, isAlive, isEnemy, type Entity } from './entities';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';
import type { MeleeId } from './weapon';
import { lassoMissPoint, lassoTarget } from './lasso';
import { hitCenter } from './gunDamage';

/** What swings when you press F: your boot, or the melee weapon you own (the last held or bought). */
export type MeleeTool = 'kick' | MeleeId;

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
  return p.melee ?? 'kick';
}

/** With a gun in your hands: seconds from the press to the gun coming back up (the boot never puts it away). */
export function meleeGunBack(tool: MeleeTool): number {
  return tool === 'lasso' ? tuning.lassoGunBack : tuning.shovelGunBack;
}

function meleeStats(tool: MeleeTool): MeleeStats {
  if (tool === 'lasso') {
    // (Range and angle aren't a cone for the lasso: see lassoTarget.)
    return {
      windup: tuning.lassoWindup,
      cooldown: tuning.lassoCooldown,
      range: tuning.lassoRange,
      angle: 0,
      damage: tuning.lassoDamage,
      knockback: 0,
      lift: tuning.lassoYankLift,
    };
  }
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

  // New press (not held from before) and ready: start a kick. With a melee
  // weapon in your hands the left button is its attack too (the same press:
  // either of the two). Not while it's still being drawn, and the lasso not
  // while its rope is out as a grappling hook.
  const inHand = p.meleeDrawn && p.melee !== null;
  const want = cmd.kick || (inHand && cmd.fire);
  const pressed = want && !p.kickHeld;
  p.kickHeld = want;
  const busy = (inHand && p.switchTicks > 0) || (tool === 'lasso' && p.hook.phase !== 'idle');
  if (pressed && p.kickCooldownTicks === 0 && !busy) {
    p.kickTicks = 1;
    p.kickCooldownTicks = secondsToTicks(stats.cooldown);
    // A melee weapon swung from F with a gun in your hands: the gun goes away for it.
    p.kickGunAway = !inHand && tool !== 'kick';
    if (p.kickGunAway) putGunAway(p, tool);
    if (tool === 'lasso') {
      // The loop's target is picked NOW: it flies at it during the wind-up.
      const target = lassoTarget(p, entities, world);
      p.lassoTargetId = target ? target.id : -1;
      const to = target ? hitCenter(target) : lassoMissPoint(p, world, tuning.lassoRange);
      events.push({ type: 'kickStart', tool, targetId: p.lassoTargetId, to });
    } else events.push({ type: 'kickStart', tool });
    // (With a wind-up of 0 the foot lands on this very tick: falls through.)
  } else if (p.kickTicks > 0) {
    p.kickTicks++;
  }

  // The swing is over: the gun comes back up, drawn like a switch
  // (same animation and sound; `melee` so it isn't a "quick switch" for the Style).
  if (p.kickGunAway && p.kickTicks === secondsToTicks(meleeGunBack(tool))) {
    events.push({ type: 'weaponSwitch', weapon: p.weapon, forged: p.forged[p.weapon] > 0, melee: true });
  }

  // The foot lands exactly once, at the end of the wind-up.
  if (p.kickTicks > 0 && p.kickTicks === Math.max(1, secondsToTicks(stats.windup))) {
    if (tool === 'lasso') landLasso(p, stats, world, entities, events);
    else landKick(p, tool, stats, world, entities, events);
  }
  // The kick is "over" when the cooldown is: the renderer reads kickTicks to animate the leg.
  if (p.kickCooldownTicks === 0) {
    p.kickTicks = 0;
    p.kickGunAway = false;
  }
}

/**
 * The shovel takes both hands (and so does the lasso: one spins the loop, the
 * other holds the coil), so the gun goes away for the swing (CoD's melee): it can't fire until it's back up and drawn (switchTicks, the same
 * timer as a weapon switch: every check "is the gun ready?" already reads it),
 * and what the hands were doing stops: a reload in progress is cancelled (no
 * free rounds), the fanning burst ends, the sights come down. The boot
 * doesn't do any of this: kicking while you reload is its whole point.
 */
function putGunAway(p: PlayerState, tool: MeleeTool): void {
  const busy = secondsToTicks(meleeGunBack(tool) + tuning.weaponSwitchTime);
  p.switchTicks = Math.max(p.switchTicks, busy);
  p.reloadTicks = 0;
  p.fanShotsLeft = 0;
  p.adsTicks = 0;
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
    if (hasDrink(p, 'hardHoof')) stun(e); // drink "Zoccolo duro"
  }
  events.push({ type: 'kickLand', tool, hits, at });
}

/**
 * The lasso catches (the end of its wind-up). The target picked at the press,
 * if it's still there and within reach (a little more: it may have stepped
 * back); otherwise whatever is in the loop's way now. Caught: a little damage,
 * and the YANK.
 */
function landLasso(p: PlayerState, stats: MeleeStats, world: World, entities: Entity[], events: SimEvent[]): void {
  const picked = entities.find((e) => e.id === p.lassoTargetId && isAlive(e));
  const stillThere = picked && lassoTarget(p, [picked], world, 1.4) === picked;
  const e = stillThere ? picked : lassoTarget(p, entities, world);
  p.lassoTargetId = -1;
  if (!e) return void events.push({ type: 'kickLand', tool: 'lasso', hits: 0, at: [] });
  const c = hitCenter(e);
  const dist = Math.hypot(c.x - p.x, c.z - p.z);
  const killed = damage(e, stats.damage);
  events.push({
    type: 'hit',
    entityId: e.id,
    damage: stats.damage,
    killed,
    surface: isEnemy(e) ? 'flesh' : 'metal',
    headshot: false,
    source: 'lasso',
    distance: dist,
    target: e.type,
  });
  if (!killed) yank(e, p, stats.lift);
  events.push({ type: 'kickLand', tool: 'lasso', hits: 1, at: [{ ...c, flesh: isEnemy(e) }] });
}

/**
 * The lasso's yank: the enemy flies TOWARD you on an arc and lands
 * lassoYankStop meters in front of you. Ballistics backwards: an upward
 * speed `lift` keeps it in the air for T = 2·lift/g (up and down again), so to
 * cover `d` meters in that time the horizontal speed is d / T. Thrown with
 * knockBack, like the boot's kick but pointing at you: a ghoul in the air
 * can't steer, it really flies. The heavy ones don't budge: the rope holds
 * them still instead (the stun of status.ts: no AI for a moment).
 */
function yank(e: Entity, p: PlayerState, lift: number): void {
  if (e.type === 'bull' || e.type === 'smith') {
    e.stunTicks = Math.max(e.stunTicks ?? 0, secondsToTicks(tuning.lassoHeavyHold));
    return;
  }
  const c = hitCenter(e);
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  const flight = (2 * lift) / tuning.gravity;
  const speed = Math.min(tuning.lassoYankMaxSpeed, Math.max(0, d - tuning.lassoYankStop) / flight);
  knockBack(e, dx / d, dz / d, speed, lift);
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
  } else if (e.type === 'jackal' && e.state !== 'dead') {
    // Light as a cat: it flies, lands and runs on (kicked off a wall, it falls).
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
