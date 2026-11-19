// The player's guns: switching, firing, cooldown, ammo and reloading. Pure
// simulation: what happens visually/audibly is decided elsewhere, from the events.
//
// Two weapons for now, both available from the start:
// - the REVOLVER: one precise hitscan bullet, 6 rounds;
// - the DOUBLE-BARREL SHOTGUN ("la doppietta"): a cone of pellets, 2 shells,
//   devastating up close, weak far away, and its recoil pushes YOU in the air.
// The shared rules (one click = one shot, fire buffer, reload, switching) are
// written once; only "what comes out of the barrel" differs.
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';
import { damage, hitBox, isAlive, isEnemy, type Entity, type EyebatEntity } from './entities';
import { knockBack } from './kick';

export type WeaponId = 'revolver' | 'shotgun';
/** Weapon slots, in order: key 1 = revolver, key 2 = shotgun. */
export const WEAPONS: readonly WeaponId[] = ['revolver', 'shotgun'];

/** Rounds a full weapon holds. (Functions, not constants: tuning changes at runtime.) */
export function magazineSize(w: WeaponId): number {
  return w === 'shotgun' ? tuning.shotgunAmmo : tuning.revolverAmmo;
}
function fireInterval(w: WeaponId): number {
  return w === 'shotgun' ? tuning.shotgunFireInterval : tuning.revolverFireInterval;
}
export function reloadTime(w: WeaponId): number {
  return w === 'shotgun' ? tuning.shotgunReloadTime : tuning.revolverReloadTime;
}
/** Rounds left in the weapon you're holding. */
export function currentAmmo(p: PlayerState): number {
  return p.weapon === 'shotgun' ? p.shells : p.ammo;
}
function setCurrentAmmo(p: PlayerState, n: number): void {
  if (p.weapon === 'shotgun') p.shells = n;
  else p.ammo = n;
}

export function stepWeapon(
  p: PlayerState,
  cmd: InputCommand,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  // Timers.
  if (p.fireCooldownTicks > 0) p.fireCooldownTicks--;
  if (p.fireBufferTicks > 0) p.fireBufferTicks--;
  if (p.switchTicks > 0) p.switchTicks--;

  // Switching: the new weapon is in your hands at once, but it needs
  // weaponSwitchTime to come up before it can fire. A reload in progress is
  // CANCELLED (no free ammo: the rounds weren't in yet).
  const target = selectedWeapon(p.weapon, cmd.weaponSelect);
  if (target !== p.weapon) {
    p.weapon = target;
    p.switchTicks = secondsToTicks(tuning.weaponSwitchTime);
    p.reloadTicks = 0;
    p.fireCooldownTicks = 0;
    events.push({ type: 'weaponSwitch', weapon: target });
  }

  // Reloading: count down, then refill.
  if (p.reloadTicks > 0) {
    p.reloadTicks--;
    if (p.reloadTicks === 0) {
      setCurrentAmmo(p, magazineSize(p.weapon));
      events.push({ type: 'reloadEnd' });
    }
  }

  // Semi-automatic: a shot needs a NEW click (pressed now, not pressed the
  // tick before). The click is buffered a little, like the jump.
  const clicked = cmd.fire && !p.fireHeld;
  p.fireHeld = cmd.fire;
  if (clicked) p.fireBufferTicks = secondsToTicks(tuning.revolverFireBuffer);

  const ammo = currentAmmo(p);
  const full = magazineSize(p.weapon);
  // The shotgun reloads by itself when both barrels are empty (once the
  // second shot's cooldown is over): with 2 shells, pressing R every time
  // would be a chore. The revolver waits for R or a click on an empty cylinder.
  const autoReload = p.weapon === 'shotgun' && ammo === 0 && p.fireCooldownTicks === 0;
  const wantsReload = (cmd.reload && ammo < full) || (ammo === 0 && clicked) || autoReload;
  if (wantsReload && p.reloadTicks === 0 && p.switchTicks === 0) {
    if (ammo === 0 && clicked && !autoReload) events.push({ type: 'dryFire' });
    p.reloadTicks = secondsToTicks(reloadTime(p.weapon));
    p.fireBufferTicks = 0;
    events.push({ type: 'reloadStart', weapon: p.weapon });
    return;
  }

  const ready = p.fireCooldownTicks === 0 && p.reloadTicks === 0 && p.switchTicks === 0 && ammo > 0;
  if (p.fireBufferTicks > 0 && ready) {
    if (p.weapon === 'shotgun') {
      // Right barrel first (2 shells left), then the left one.
      events.push({ type: 'fire', weapon: 'shotgun', barrel: tuning.shotgunAmmo - ammo === 0 ? 0 : 1 });
      fireShotgun(p, world, entities, events);
    } else {
      events.push({ type: 'fire', weapon: 'revolver', barrel: 0 });
      fireRevolver(p, world, entities, events);
    }
    setCurrentAmmo(p, ammo - 1);
    p.fireCooldownTicks = secondsToTicks(fireInterval(p.weapon));
    p.fireBufferTicks = 0;
  }
}

/** Which weapon the command asks for (see InputCommand.weaponSelect). */
function selectedWeapon(current: WeaponId, select: number): WeaponId {
  if (select === 0) return current;
  const i = WEAPONS.indexOf(current);
  const n = WEAPONS.length;
  if (select === -1) return WEAPONS[(i + 1) % n];
  if (select === -2) return WEAPONS[(i - 1 + n) % n];
  return WEAPONS[select - 1] ?? current; // a slot with no weapon: ignore
}

/** Where the player's eye is and where it looks (a unit vector). Same yaw/pitch math as the camera. */
function aim(p: PlayerState) {
  const cosPitch = Math.cos(p.pitch);
  return {
    ox: p.x,
    oy: p.y + currentEyeHeight(p),
    oz: p.z,
    dx: -Math.sin(p.yaw) * cosPitch,
    dy: Math.sin(p.pitch),
    dz: -Math.cos(p.yaw) * cosPitch,
  };
}

/**
 * One bullet (or pellet) along a ray: what does it hit first? Pushes the
 * 'shot' event (for impacts and blood) and returns the entity hit, if any,
 * with the distance and whether it was a critical hit. Damage is up to the caller.
 */
function trace(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  range: number,
  world: World,
  living: Entity[],
  pellet: boolean,
  events: SimEvent[],
): { target: Entity; distance: number; headshot: boolean } | null {
  // Two raycasts: against the level and against the (living) entities.
  // The bullet stops at whichever is closer: a target behind a wall is safe.
  const levelHit = raycastBoxes(ox, oy, oz, dx, dy, dz, range, world.boxes);
  const entityHit = raycastBoxes(ox, oy, oz, dx, dy, dz, range, living.map(hitBox));
  const hitEntity = entityHit && (!levelHit || entityHit.distance < levelHit.distance);
  const hit = hitEntity ? entityHit : levelHit;
  const target = hitEntity ? living[entityHit.index] : null;

  // Critical hit ("headshot" in the events, so the gold hitmarker and the
  // sound work for every enemy):
  // - ghoul: the bullet hit the top of it (head and hat). Checking the
  //   height of the impact point is enough: no second hitbox.
  // - eye-bat: the bullet passed through the pupil (see pupilHit).
  const headshot =
    target !== null &&
    ((target.type === 'ghoul' && hit!.y - target.y > tuning.ghoulHeadHeight) ||
      (target.type === 'eyebat' && pupilHit(target, ox, oy, oz, dx, dy, dz)));

  const to = hit
    ? { x: hit.x, y: hit.y, z: hit.z }
    : { x: ox + dx * range, y: oy + dy * range, z: oz + dz * range };
  events.push({
    type: 'shot',
    pellet,
    from: { x: ox, y: oy, z: oz },
    to,
    normal: hit ? { x: hit.nx, y: hit.ny, z: hit.nz } : null,
    entityId: target ? target.id : null,
    surface: !hit ? null : !target ? 'level' : isEnemy(target) ? 'flesh' : 'metal',
    headshot,
  });
  return target ? { target, distance: hit!.distance, headshot } : null;
}

/** Deals damage to an entity hit by a gun and reports it (hitmarker, score, sounds). */
function applyGunDamage(target: Entity, amount: number, headshot: boolean, events: SimEvent[]): void {
  const killed = damage(target, amount);
  if (killed && headshot && target.type === 'ghoul') target.headless = true;
  if (killed && headshot && target.type === 'eyebat') target.popped = true;
  events.push({
    type: 'hit',
    entityId: target.id,
    damage: amount,
    killed,
    surface: isEnemy(target) ? 'flesh' : 'metal',
    headshot,
  });
}

/** Revolver: one hitscan bullet, straight where you look. */
function fireRevolver(p: PlayerState, world: World, entities: Entity[], events: SimEvent[]): void {
  const { ox, oy, oz, dx, dy, dz } = aim(p);
  const hit = trace(ox, oy, oz, dx, dy, dz, tuning.weaponRange, world, entities.filter(isAlive), false, events);
  if (hit) {
    const amount = tuning.revolverDamage * (hit.headshot ? tuning.headshotMultiplier : 1);
    applyGunDamage(hit.target, amount, hit.headshot, events);
  }
}

/**
 * Shotgun: many pellets in a cone. Each pellet is a hitscan ray like the
 * revolver's bullet, just slightly off the aim direction.
 *
 * The SPREAD is a fixed pattern (a dot in the center, an inner ring, an
 * outer ring), not random: the same shot always does the same thing, so
 * you learn what it can do (Quake Champions and many modern shooters do
 * this). The two barrels' patterns are rotated relative to each other, so
 * the second shot fills the gaps of the first.
 *
 * The damage of each pellet drops with distance (falloff): that's what makes
 * it a close-range weapon, together with the spread.
 */
function fireShotgun(p: PlayerState, world: World, entities: Entity[], events: SimEvent[]): void {
  const { ox, oy, oz, dx, dy, dz } = aim(p);
  // Two directions perpendicular to the aim, to tilt the pellets around it:
  // `right` is horizontal (it only depends on the yaw), `up` = right × forward.
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const ux = -rz * dy; // cross product (rx, 0, rz) × (dx, dy, dz), simplified
  const uy = rz * dx - rx * dz;
  const uz = rx * dy;

  const living = entities.filter(isAlive);
  // Damage is summed per entity and applied once at the end: one hitmarker,
  // one 'hit' event, one kill, even if 10 pellets hit the same ghoul.
  const totals = new Map<Entity, { amount: number; headshot: boolean; pellets: number; distance: number }>();
  const spread = Math.tan((tuning.shotgunSpread * Math.PI) / 180);
  const barrelTwist = p.shells === tuning.shotgunAmmo ? 0 : Math.PI / 7;
  for (const [ax, ay] of pelletPattern(tuning.shotgunPellets, barrelTwist)) {
    // Tilt the aim direction by (ax, ay) × spread, then normalize.
    let px = dx + (rx * ax + ux * ay) * spread;
    let py = dy + uy * ay * spread;
    let pz = dz + (rz * ax + uz * ay) * spread;
    const len = Math.hypot(px, py, pz);
    px /= len;
    py /= len;
    pz /= len;
    const hit = trace(ox, oy, oz, px, py, pz, tuning.shotgunRange, world, living, true, events);
    if (!hit) continue;
    const amount =
      tuning.shotgunPelletDamage *
      falloff(hit.distance) *
      (hit.headshot ? tuning.shotgunHeadshotMultiplier : 1);
    const t = totals.get(hit.target) ?? { amount: 0, headshot: false, pellets: 0, distance: Infinity };
    t.amount += amount;
    t.headshot ||= hit.headshot;
    t.pellets++;
    t.distance = Math.min(t.distance, hit.distance);
    totals.set(hit.target, t);
  }
  for (const [target, t] of totals) {
    applyGunDamage(target, Math.round(t.amount), t.headshot, events);
    blastBack(p, target, t.pellets, t.distance);
  }
  recoil(p, dx, dy, dz);
}

/**
 * Point-blank knockback: an enemy that took the blast up close flies back,
 * like a kick. The strength is the product of two fractions, each 0..1:
 * - how close it was (1 at 0 m, 0 at shotgunKnockbackRange);
 * - how many pellets hit it (all of them = 1): a grazing shot barely pushes.
 * Below shotgunKnockbackMin: nothing. Otherwise every weak hit would put the
 * ghoul in its 'staggered' state and you could stun-lock a crowd from afar.
 */
function blastBack(p: PlayerState, target: Entity, pellets: number, distance: number): void {
  const closeness = 1 - distance / tuning.shotgunKnockbackRange;
  const strength = Math.max(0, closeness) * Math.min(1, pellets / tuning.shotgunPellets);
  if (strength < tuning.shotgunKnockbackMin) return;
  // Direction: from you to it, flat on the ground.
  const b = hitBox(target);
  let kx = (b.minX + b.maxX) / 2 - p.x;
  let kz = (b.minZ + b.maxZ) / 2 - p.z;
  const len = Math.hypot(kx, kz);
  if (len < 0.01) {
    kx = -Math.sin(p.yaw); // right on top of you: where you look
    kz = -Math.cos(p.yaw);
  } else {
    kx /= len;
    kz /= len;
  }
  knockBack(target, kx, kz, tuning.shotgunKnockback * strength, tuning.shotgunKnockbackLift * strength);
}

/**
 * The shotgun's recoil on YOU: a push opposite to where you aim, but only
 * the parts of it that help you. Shooting where you're running must never
 * slow you down (moving is the heart of the game), so:
 * - HORIZONTAL: we split the push into the part along your current velocity
 *   and the part sideways (a projection, with the dot product). If the part
 *   along the velocity points backward (= a brake), we throw it away.
 *   Shoot behind you: the push is all forward, a free boost. Shoot ahead:
 *   nothing happens. Shoot sideways: a sideways nudge.
 * - VERTICAL, only in the air: up yes (shooting at your feet; it first
 *   cancels the fall, so it's a reliable mini double jump), down never
 *   (shooting at an eye-bat above you must not slam you to the ground).
 *   On the ground nothing vertical: no surprise launches.
 */
function recoil(p: PlayerState, dx: number, dy: number, dz: number): void {
  const push = tuning.shotgunSelfPush;
  if (push <= 0) return;
  let px = -dx * push;
  let pz = -dz * push;
  const speed = Math.hypot(p.vx, p.vz);
  if (speed > 0.1) {
    const ux = p.vx / speed; // unit vector of where you're going
    const uz = p.vz / speed;
    const along = px * ux + pz * uz; // how much of the push is along it
    if (along < 0) {
      px -= ux * along; // remove the braking part, keep the sideways one
      pz -= uz * along;
    }
  }
  p.vx += px;
  p.vz += pz;
  const up = -dy * push;
  if (!p.onGround && up > 0) {
    p.vy = Math.max(p.vy, 0) + up;
  }
}

/**
 * The pellet pattern: `count` points in a unit disc (x right, y up).
 * 1 in the center, ~1/3 of the rest on an inner ring at 45% of the radius,
 * the others on the outer ring. `twist` rotates the whole thing.
 */
function pelletPattern(count: number, twist: number): [number, number][] {
  const points: [number, number][] = [[0, 0]];
  const rest = Math.max(0, count - 1);
  const inner = Math.round(rest / 3);
  const outer = rest - inner;
  for (let i = 0; i < inner; i++) {
    const a = twist + (2 * Math.PI * i) / inner;
    points.push([Math.cos(a) * 0.45, Math.sin(a) * 0.45]);
  }
  for (let i = 0; i < outer; i++) {
    const a = twist + (2 * Math.PI * (i + 0.5)) / outer; // offset: between the inner ones
    points.push([Math.cos(a), Math.sin(a)]);
  }
  return points;
}

/** Damage multiplier for a pellet that traveled `distance` meters: 1, then a straight line down to the minimum. */
function falloff(distance: number): number {
  const { shotgunFalloffStart: start, shotgunFalloffEnd: end, shotgunFalloffMin: min } = tuning;
  if (distance <= start) return 1;
  if (distance >= end) return min;
  return 1 - ((distance - start) / (end - start)) * (1 - min);
}

/**
 * Did the bullet go through the eye-bat's pupil?
 *
 * The sprite always faces the camera, so the pupil is always the point of the
 * eye closest to the center as seen from the shooter. That turns the question
 * into: how close does the bullet's line pass to the center of the eye?
 *
 * Point-to-line distance: take the vector from the gun to the center (oc),
 * project it on the shot direction (t = oc · dir, how far along the line the
 * center is), and measure what's left over (the part of oc perpendicular to
 * the line). If that's smaller than the pupil, it's a critical hit.
 */
function pupilHit(b: EyebatEntity, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
  const r = tuning.eyebatRadius;
  const ocx = b.x - ox;
  const ocy = b.y + r - oy; // b.y is the bottom of the body: + r = its center
  const ocz = b.z - oz;
  const t = ocx * dx + ocy * dy + ocz * dz;
  const px = ocx - dx * t;
  const py = ocy - dy * t;
  const pz = ocz - dz * t;
  return Math.hypot(px, py, pz) < tuning.eyebatPupilRadius;
}
