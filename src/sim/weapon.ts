// The player's guns: switching, firing, cooldown, ammo and reloading. Pure
// simulation: what happens visually/audibly is decided elsewhere, from the events.
//
// Three weapons (you start with the revolver, the others are bought):
// - the REVOLVER: one precise hitscan bullet, 6 rounds;
// - the DOUBLE-BARREL SHOTGUN ("la doppietta"): a cone of pellets, 2 shells,
//   devastating up close, weak far away, and its recoil pushes YOU in the air;
// - the LEVER-ACTION CARBINE ("la carabina a leva"): slow (you work the lever
//   after every shot), hard-hitting, made for far targets and critical hits.
//   From the hip it's a bit imprecise; AIMING DOWN THE SIGHTS (right mouse
//   button, the "alternate fire") makes it perfectly accurate. It reloads one
//   round at a time through the loading gate, and a click interrupts the
//   reload to shoot.
// The shared rules (one click = one shot, fire buffer, reload, switching) are
// written once; only "what comes out of the barrel" differs.
//
// AMMO has two levels, like in Doom/Quake: the rounds IN the gun (cylinder,
// barrels, magazine tube: `p.loaded`) and the spare ones in your pockets
// (`p.reserve`). Firing uses the first, reloading moves the second into the
// first. The pockets are refilled only by pickups: whoever stands still runs dry.
// The pockets hold AMMO TYPES, not weapons: the revolver and the carbine
// shoot the same cartridge (.44-40, like the real Colt and Winchester of the
// 1870s: cowboys loved them for exactly this), so they share the bullets.
//
// FANNING (the revolver's alternate fire, right mouse button): one press
// empties the whole cylinder in a quick burst, the left hand slapping the
// hammer back each time. Lots of damage in a fraction of a second, but every
// bullet goes a little off the aim: it's for things up close (a ghoul in
// your face, a bull stunned against a wall), not for far targets.
//
// BOTTOMLESS (the HIGH NOON climax, see style.ts): the gun in your hands is
// always full and firing doesn't use rounds. No reloading: you just shoot.
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';
import { damage, hitBox, isAlive, isEnemy, type Entity, type EyebatEntity } from './entities';
import { knockBack } from './kick';
import { random, type RandomState } from './random';
import { hasCard } from './upgrades';

export type WeaponId = 'revolver' | 'shotgun' | 'rifle';
/** Weapon slots, in order: key 1 = revolver, key 2 = shotgun, key 3 = carbine. */
export const WEAPONS: readonly WeaponId[] = ['revolver', 'shotgun', 'rifle'];

/** What's in your pockets: kinds of cartridges. */
export type AmmoType = 'bullets' | 'shells';
/** Which cartridges each weapon shoots (and so which pocket its reload empties). */
export const AMMO_TYPE: Record<WeaponId, AmmoType> = { revolver: 'bullets', shotgun: 'shells', rifle: 'bullets' };

/**
 * Rounds a full weapon holds. (Functions, not constants: tuning changes at
 * runtime, and the upgrade cards change some weapons.)
 */
export function magazineSize(p: PlayerState, w: WeaponId): number {
  switch (w) {
    case 'revolver':
      return tuning.revolverAmmo + (hasCard(p, 'undertakerCylinder') ? tuning.undertakerExtraRounds : 0);
    case 'shotgun':
      return tuning.shotgunAmmo;
    case 'rifle':
      return tuning.rifleAmmo;
  }
}
function fireInterval(w: WeaponId): number {
  switch (w) {
    case 'revolver':
      return tuning.revolverFireInterval;
    case 'shotgun':
      return tuning.shotgunFireInterval;
    case 'rifle':
      return tuning.rifleFireInterval;
  }
}
/** Seconds of a reload. For the carbine: the FIRST round (bringing the gun to the gate + one round). */
function reloadTime(w: WeaponId): number {
  switch (w) {
    case 'revolver':
      return tuning.revolverReloadTime;
    case 'shotgun':
      return tuning.shotgunReloadTime;
    case 'rifle':
      return tuning.rifleReloadStart + tuning.rifleReloadPerRound;
  }
}
/**
 * Does it reload one round at a time? (The carbine: each round is pushed
 * through the loading gate on its own, so a reload can be stopped halfway.)
 */
export function reloadsOneByOne(w: WeaponId): boolean {
  return w === 'rifle';
}
/** Rounds left in the weapon you're holding. */
export function currentAmmo(p: PlayerState): number {
  return p.loaded[p.weapon];
}
function setCurrentAmmo(p: PlayerState, n: number): void {
  p.loaded[p.weapon] = n;
}

/** How far into aiming down the sights you are: 0 = from the hip, 1 = fully aimed. */
export function adsAmount(p: PlayerState): number {
  const full = secondsToTicks(tuning.rifleAdsTime);
  return full > 0 ? Math.min(1, p.adsTicks / full) : p.adsTicks > 0 ? 1 : 0;
}

export function stepWeapon(
  p: PlayerState,
  cmd: InputCommand,
  world: World,
  entities: Entity[],
  events: SimEvent[],
  /** HIGH NOON: the magazine never empties. */
  bottomless: boolean,
  /** The game's random generator (the carbine's hip-fire spread). */
  rng: RandomState,
): void {
  // Timers.
  if (p.fireCooldownTicks > 0) p.fireCooldownTicks--;
  if (p.fireBufferTicks > 0) p.fireBufferTicks--;
  if (p.switchTicks > 0) p.switchTicks--;

  // Bottomless: the gun in your hands is topped up for free (also when the
  // climax starts with an empty cylinder, or you switch to an empty gun), and
  // a reload in progress is pointless: dropped (like when you switch weapon).
  if (bottomless) {
    setCurrentAmmo(p, magazineSize(p, p.weapon));
    p.reloadTicks = 0;
  }

  // Switching: the new weapon is in your hands at once, but it needs
  // weaponSwitchTime to come up before it can fire. A reload in progress is
  // CANCELLED (no free ammo: the rounds weren't in yet).
  const target = selectedWeapon(p, cmd.weaponSelect);
  if (target !== p.weapon) switchWeapon(p, target, events);

  const pocket = AMMO_TYPE[p.weapon];
  const oneByOne = reloadsOneByOne(p.weapon);
  const full = magazineSize(p, p.weapon);

  // Reloading: count down, then move rounds from the pockets into the gun.
  // The rounds are taken only at the END: a reload interrupted by a weapon
  // switch costs nothing (and gives nothing). The carbine moves ONE round
  // each time, then starts counting again for the next one, until the tube
  // is full or the pocket is empty.
  if (p.reloadTicks > 0) {
    p.reloadTicks--;
    if (p.reloadTicks === 0) {
      const loaded = currentAmmo(p);
      const wanted = oneByOne ? 1 : full - loaded;
      const moved = Math.min(wanted, tuning.infiniteAmmo ? Infinity : p.reserve[pocket]);
      setCurrentAmmo(p, loaded + moved);
      if (!tuning.infiniteAmmo) p.reserve[pocket] -= moved;
      if (oneByOne && moved > 0) events.push({ type: 'reloadRound' });
      const more = oneByOne && currentAmmo(p) < full && (tuning.infiniteAmmo || p.reserve[pocket] > 0);
      if (more) p.reloadTicks = secondsToTicks(tuning.rifleReloadPerRound);
      else events.push({ type: 'reloadEnd' });
    }
  }

  // Semi-automatic: a shot needs a NEW click (pressed now, not pressed the
  // tick before). The click is buffered a little, like the jump.
  const clicked = cmd.fire && !p.fireHeld;
  p.fireHeld = cmd.fire;
  if (clicked) {
    p.fireBufferTicks = secondsToTicks(tuning.revolverFireBuffer);
    p.fanQueued = false;
  }
  // Fanning (the revolver's right click) uses the same buffer: the press is
  // remembered for a moment, and when the gun is ready the burst starts.
  // For the rest of the code it's a click like any other (an empty
  // cylinder: reload or dry click), only the shot is different.
  const altClicked = cmd.altFire && !p.altFireHeld;
  p.altFireHeld = cmd.altFire;
  const fanClicked = altClicked && p.weapon === 'revolver';
  if (fanClicked) {
    p.fireBufferTicks = secondsToTicks(tuning.revolverFireBuffer);
    p.fanQueued = true;
  }
  const pressed = clicked || fanClicked;

  // A click during a one-by-one reload, with at least one round in: stop
  // reloading and shoot (after a moment: the gun comes back up from the gate).
  if (oneByOne && p.reloadTicks > 0 && clicked && currentAmmo(p) > 0) {
    p.reloadTicks = 0;
    p.fireCooldownTicks = Math.max(p.fireCooldownTicks, secondsToTicks(tuning.rifleReloadInterrupt));
    events.push({ type: 'reloadEnd' });
  }

  // Aiming down the sights (the carbine's alternate fire, right mouse
  // button): it takes rifleAdsTime to get the gun up to the eye, and the
  // same to lower it. Not while reloading or bringing the gun up.
  const aimAllowed = cmd.altFire && p.weapon === 'rifle' && p.reloadTicks === 0 && p.switchTicks === 0;
  const adsFull = secondsToTicks(tuning.rifleAdsTime);
  p.adsTicks = aimAllowed ? Math.min(adsFull, p.adsTicks + 1) : Math.max(0, p.adsTicks - 1);

  const ammo = currentAmmo(p);
  // Nothing in the pockets = no reload. You hear the click and that's it:
  // switch weapon, kick, or go find ammo.
  const canReload = tuning.infiniteAmmo || p.reserve[pocket] > 0;
  if (ammo === 0 && pressed && !canReload && p.reloadTicks === 0 && p.switchTicks === 0) {
    events.push({ type: 'dryFire' });
    p.fireBufferTicks = 0;
  }
  // The shotgun reloads by itself when both barrels are empty (once the
  // second shot's cooldown is over): with 2 shells, pressing R every time
  // would be a chore. The revolver waits for R or a click on an empty cylinder.
  const autoReload = p.weapon === 'shotgun' && ammo === 0 && p.fireCooldownTicks === 0;
  // (Not in the middle of a fanning burst: R waits for the burst to end.)
  const wantsReload = canReload && ((cmd.reload && ammo < full) || (ammo === 0 && pressed) || autoReload);
  if (wantsReload && p.reloadTicks === 0 && p.switchTicks === 0 && p.fanShotsLeft === 0) {
    if (ammo === 0 && pressed && !autoReload) events.push({ type: 'dryFire' });
    p.reloadTicks = secondsToTicks(reloadTime(p.weapon));
    p.fireBufferTicks = 0;
    events.push({ type: 'reloadStart', weapon: p.weapon });
    return;
  }

  const ready = p.fireCooldownTicks === 0 && p.reloadTicks === 0 && p.switchTicks === 0 && ammo > 0;
  // A queued right click on the revolver starts the burst: as many shots as
  // there are rounds in the cylinder. From then on the gun fires by itself,
  // one shot every revolverFanInterval, until the burst is over.
  if (p.fireBufferTicks > 0 && ready && p.fanQueued && p.weapon === 'revolver') {
    p.fanShotsLeft = ammo;
  }
  const fanning = p.fanShotsLeft > 0;
  if ((p.fireBufferTicks > 0 || fanning) && ready) {
    if (fanning) {
      events.push({ type: 'fire', weapon: 'revolver', barrel: 0 });
      fireFanned(p, world, entities, events, rng);
    } else if (p.weapon === 'shotgun') {
      // Right barrel first (2 shells left), then the left one.
      events.push({ type: 'fire', weapon: 'shotgun', barrel: tuning.shotgunAmmo - ammo === 0 ? 0 : 1 });
      fireShotgun(p, world, entities, events);
    } else if (p.weapon === 'rifle') {
      events.push({ type: 'fire', weapon: 'rifle', barrel: 0 });
      fireRifle(p, world, entities, events, rng);
    } else {
      events.push({ type: 'fire', weapon: 'revolver', barrel: 0 });
      fireRevolver(p, world, entities, events);
    }
    if (!bottomless) setCurrentAmmo(p, ammo - 1);
    p.fireCooldownTicks = secondsToTicks(fireInterval(p.weapon));
    p.fireBufferTicks = 0;
    p.fanQueued = false;
    if (fanning) {
      p.fanShotsLeft--;
      // The next shot of the burst comes quickly; after the last one the
      // hand needs a moment before the revolver is back to normal.
      p.fireCooldownTicks = secondsToTicks(p.fanShotsLeft > 0 ? tuning.revolverFanInterval : tuning.revolverFanRecovery);
    }
  }
}

/** Puts `w` in your hands. Also used by the shop: a weapon you just bought goes straight to your hands. */
export function switchWeapon(p: PlayerState, w: WeaponId, events: SimEvent[]): void {
  p.weapon = w;
  p.switchTicks = secondsToTicks(tuning.weaponSwitchTime);
  p.reloadTicks = 0;
  p.fireCooldownTicks = 0;
  p.adsTicks = 0;
  p.fanShotsLeft = 0; // a fanning burst stops: the revolver is put away
  p.fanQueued = false;
  events.push({ type: 'weaponSwitch', weapon: w });
}

/**
 * Which weapon the command asks for (see InputCommand.weaponSelect).
 * Only weapons you OWN: a slot you haven't bought is ignored, and Q/the
 * wheel skip it (with just the revolver, they do nothing).
 */
function selectedWeapon(p: PlayerState, select: number): WeaponId {
  const current = p.weapon;
  if (select === 0) return current;
  if (select > 0) {
    const slot = WEAPONS[select - 1];
    return slot && p.owned[slot] ? slot : current;
  }
  // Cycle: step forward (or back) until the next weapon you own.
  const step = select === -1 ? 1 : -1;
  const n = WEAPONS.length;
  let i = WEAPONS.indexOf(current);
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n;
    if (p.owned[WEAPONS[i]]) return WEAPONS[i];
  }
  return current;
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
  // - hound: same as the ghoul, above houndHeadHeight (head and ears).
  // - sharpshooter: same, above sharpshooterHeadHeight (skull and hat).
  // - bull: no weak spot while it's up. Stunned against a wall, EVERY hit is
  //   critical: the reward for making it crash.
  const headshot =
    target !== null &&
    ((target.type === 'ghoul' && hit!.y - target.y > tuning.ghoulHeadHeight) ||
      (target.type === 'hound' && hit!.y - target.y > tuning.houndHeadHeight) ||
      (target.type === 'sharpshooter' && hit!.y - target.y > tuning.sharpshooterHeadHeight) ||
      (target.type === 'bull' && target.state === 'stunned') ||
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
function applyGunDamage(
  target: Entity,
  amount: number,
  headshot: boolean,
  source: WeaponId,
  distance: number,
  events: SimEvent[],
): void {
  const killed = damage(target, amount);
  if (killed && headshot && (target.type === 'ghoul' || target.type === 'sharpshooter')) target.headless = true;
  if (killed && headshot && target.type === 'eyebat') target.popped = true;
  events.push({
    type: 'hit',
    entityId: target.id,
    damage: amount,
    killed,
    surface: isEnemy(target) ? 'flesh' : 'metal',
    headshot,
    source,
    distance,
    target: target.type,
  });
}

/** Revolver: one hitscan bullet, straight where you look. */
function fireRevolver(p: PlayerState, world: World, entities: Entity[], events: SimEvent[]): void {
  const { ox, oy, oz, dx, dy, dz } = aim(p);
  const hit = trace(ox, oy, oz, dx, dy, dz, tuning.weaponRange, world, entities.filter(isAlive), false, events);
  if (hit) {
    const amount = tuning.revolverDamage * (hit.headshot ? tuning.headshotMultiplier : 1);
    applyGunDamage(hit.target, amount, hit.headshot, 'revolver', hit.distance, events);
  }
}

/**
 * One bullet of a fanning burst: the revolver's bullet (same damage, same
 * critical hits), but off the aim by up to revolverFanSpread degrees, in a
 * random direction: the hand slapping the hammer shakes the gun. The same
 * "random point in a disc" as the carbine's hip fire (see fireRifle).
 */
function fireFanned(p: PlayerState, world: World, entities: Entity[], events: SimEvent[], rng: RandomState): void {
  const a = aim(p);
  const spread = Math.tan((tuning.revolverFanSpread * Math.PI) / 180);
  const angle = random(rng) * Math.PI * 2;
  const r = Math.sqrt(random(rng));
  const [dx, dy, dz] = tilt(p, a, Math.cos(angle) * r, Math.sin(angle) * r, spread);
  const hit = trace(a.ox, a.oy, a.oz, dx, dy, dz, tuning.weaponRange, world, entities.filter(isAlive), false, events);
  if (hit) {
    const amount = tuning.revolverDamage * (hit.headshot ? tuning.headshotMultiplier : 1);
    applyGunDamage(hit.target, amount, hit.headshot, 'revolver', hit.distance, events);
  }
}

/**
 * Carbine: one hitscan bullet like the revolver's, but heavier and with a
 * bigger critical multiplier (a headshot kills almost anything). From the
 * hip it goes a little off the aim: a random direction inside a cone of
 * rifleHipSpread degrees, which shrinks to nothing as you aim down the
 * sights. "Random inside a disc": a random angle around the aim and a
 * random distance from the center, sqrt(r) so that the points are spread
 * evenly over the disc (without the sqrt they would bunch up in the middle).
 */
function fireRifle(p: PlayerState, world: World, entities: Entity[], events: SimEvent[], rng: RandomState): void {
  const a = aim(p);
  const spread = Math.tan((tuning.rifleHipSpread * Math.PI) / 180) * (1 - adsAmount(p));
  const angle = random(rng) * Math.PI * 2;
  const r = Math.sqrt(random(rng));
  const [dx, dy, dz] = tilt(p, a, Math.cos(angle) * r, Math.sin(angle) * r, spread);
  const hit = trace(a.ox, a.oy, a.oz, dx, dy, dz, tuning.weaponRange, world, entities.filter(isAlive), false, events);
  if (hit) {
    const amount = tuning.rifleDamage * (hit.headshot ? tuning.rifleHeadshotMultiplier : 1);
    applyGunDamage(hit.target, amount, hit.headshot, 'rifle', hit.distance, events);
  }
}

/**
 * The aim direction tilted by (ax, ay) × spread: ax to the right, ay up
 * (a point of a unit disc), spread = tan of the cone's half-angle.
 * Two directions perpendicular to the aim do the tilting: `right` is
 * horizontal (it only depends on the yaw), `up` = right × forward.
 */
function tilt(p: PlayerState, a: ReturnType<typeof aim>, ax: number, ay: number, spread: number): [number, number, number] {
  const { dx, dy, dz } = a;
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const ux = -rz * dy; // cross product (rx, 0, rz) × (dx, dy, dz), simplified
  const uy = rz * dx - rx * dz;
  const uz = rx * dy;
  const px = dx + (rx * ax + ux * ay) * spread;
  const py = dy + uy * ay * spread;
  const pz = dz + (rz * ax + uz * ay) * spread;
  const len = Math.hypot(px, py, pz);
  return [px / len, py / len, pz / len];
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
  const a = aim(p);
  const { ox, oy, oz, dx, dy, dz } = a;
  const living = entities.filter(isAlive);
  // Damage is summed per entity and applied once at the end: one hitmarker,
  // one 'hit' event, one kill, even if 10 pellets hit the same ghoul.
  const totals = new Map<Entity, { amount: number; headshot: boolean; pellets: number; distance: number }>();
  const spread = Math.tan((tuning.shotgunSpread * Math.PI) / 180);
  const barrelTwist = p.loaded.shotgun === tuning.shotgunAmmo ? 0 : Math.PI / 7;
  for (const [ax, ay] of pelletPattern(tuning.shotgunPellets, barrelTwist)) {
    const [px, py, pz] = tilt(p, a, ax, ay, spread);
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
    applyGunDamage(target, Math.round(t.amount), t.headshot, 'shotgun', t.distance, events);
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
