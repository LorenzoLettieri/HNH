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
import { drinkDamageMultiplier } from './drinks';
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';
import { hitBox, isAlive, isEnemy, type Entity, type EyebatEntity } from './entities';
import { knockBack } from './kick';
import { random, type RandomState } from './random';
import { ignite, markSlam } from './status';
import { hasCard } from './upgrades';
import { applyGunDamage, hitCenter, lineFree } from './gunDamage';
import { explode, lastShotBlast } from './explosion';

export type WeaponId = 'revolver' | 'shotgun' | 'rifle' | 'dynamite';
/** Weapon slots, in order: key 1 = revolver, key 2 = shotgun, key 3 = carbine, key 4 = dynamite launcher. */
export const WEAPONS: readonly WeaponId[] = ['revolver', 'shotgun', 'rifle', 'dynamite'];

/**
 * The reinforced revolver is AKIMBO (the Forge, docs/DESIGN.md §6d): a
 * second revolver in the left hand. Same bullets (forgeMultiplier), two
 * cylinders, the guns fire in turn.
 */
export function isAkimbo(p: PlayerState): boolean {
  return p.forged.revolver > 0;
}

/**
 * The reinforced shotgun is a PUMP-ACTION (the Forge): one barrel, a tube of
 * pumpAmmo shells, the pump racked between shots (pumpFireInterval), loaded
 * one shell at a time like the carbine.
 */
export function isPump(p: PlayerState): boolean {
  return p.forged.shotgun > 0;
}

/**
 * Which gun fires the next revolver shot: 0 = right, 1 = left (the 'fire'
 * event's `barrel`, like the shotgun's two barrels). Akimbo, they alternate:
 * it follows from how many rounds have been fired since the last reload,
 * so there's no extra state to keep. Not akimbo: always the right one.
 */
function revolverHand(p: PlayerState, full: number, ammo: number): number {
  return isAkimbo(p) ? (full - ammo) % 2 : 0;
}

/**
 * How much harder a gun hits because of the Forge: 1 when plain,
 * forgeDamageMultiplier when reinforced. It multiplies only the gun's own
 * bullet (or pellet) damage: what the cards add on top (ricochet, explosion,
 * fire) stays the same for now.
 */
export function forgeMultiplier(p: PlayerState, weapon: WeaponId): number {
  return p.forged[weapon] > 0 ? tuning.forgeDamageMultiplier : 1;
}

/**
 * Everything you can OWN and UPGRADE: the guns, plus the shovel. The shovel
 * isn't a slot (you never hold it in your hands instead of a gun): once
 * bought it takes the boot's place on the melee key (kick.ts). Same idea as
 * the bowie knife in CoD Zombies. Kept apart from WeaponId so that
 * everything about slots, magazines and ammo (WEAPONS, loaded, AMMO_TYPE)
 * doesn't have to pretend the shovel has bullets.
 */
export type GearId = WeaponId | 'shovel';
/** Every piece of gear, in the order the shop lists it. */
export const GEAR: readonly GearId[] = [...WEAPONS, 'shovel'];

/** What's in your pockets: kinds of cartridges. */
export type AmmoType = 'bullets' | 'shells' | 'sticks';
/** Which cartridges each weapon shoots (and so which pocket its reload empties). */
export const AMMO_TYPE: Record<WeaponId, AmmoType> = { revolver: 'bullets', shotgun: 'shells', rifle: 'bullets', dynamite: 'sticks' };

/**
 * Rounds a full weapon holds. (Functions, not constants: tuning changes at
 * runtime, and the upgrade cards change some weapons.)
 */
export function magazineSize(p: PlayerState, w: WeaponId): number {
  switch (w) {
    case 'revolver': {
      // Akimbo: two cylinders, so twice the rounds (cards included: 8 + 8 with "Tamburo del becchino").
      const cylinder = tuning.revolverAmmo + (hasCard(p, 'undertakerCylinder') ? tuning.undertakerExtraRounds : 0);
      return cylinder * (isAkimbo(p) ? 2 : 1);
    }
    case 'shotgun':
      return isPump(p) ? tuning.pumpAmmo : tuning.shotgunAmmo;
    case 'rifle':
      return tuning.rifleAmmo;
    case 'dynamite':
      return tuning.dynamiteAmmo;
  }
}
/** Seconds between two shots (for the carbine: the lever's cycle). The player, because cards can change it. */
export function fireInterval(p: PlayerState, w: WeaponId): number {
  switch (w) {
    case 'revolver':
      return tuning.revolverFireInterval * (isAkimbo(p) ? tuning.akimboFireIntervalScale : 1);
    case 'shotgun':
      return isPump(p) ? tuning.pumpFireInterval : tuning.shotgunFireInterval;
    case 'rifle':
      return tuning.rifleFireInterval * (hasCard(p, 'gunslingerLever') ? tuning.gunslingerLeverScale : 1);
    case 'dynamite':
      return tuning.dynamiteFireInterval;
  }
}
/**
 * Seconds of a reload. For the carbine: the FIRST round (bringing the gun to
 * the gate + one round). The player, because cards can change it.
 */
function reloadTime(p: PlayerState, w: WeaponId): number {
  switch (w) {
    case 'revolver': {
      // Akimbo: the gunslinger's spin (both guns twirled round the finger), its own length.
      const base = isAkimbo(p) ? tuning.akimboReloadTime : tuning.revolverReloadTime;
      return base * (hasCard(p, 'fastCylinder') ? tuning.fastCylinderReloadScale : 1);
    }
    case 'shotgun':
      return isPump(p) ? tuning.pumpReloadStart + tuning.pumpReloadPerShell : tuning.shotgunReloadTime;
    case 'rifle':
      return tuning.rifleReloadStart + tuning.rifleReloadPerRound;
    case 'dynamite':
      return tuning.dynamiteReloadTime;
  }
}
/**
 * Does it reload one round at a time? The carbine (each round pushed through
 * the loading gate) and the pump-action (each shell into the tube): a reload
 * can be stopped halfway. The player, because the pump is the Forge's shotgun.
 */
export function reloadsOneByOne(p: PlayerState, w: WeaponId): boolean {
  return w === 'rifle' || (w === 'shotgun' && isPump(p));
}
/** Seconds for each further round of a one-by-one reload. */
export function reloadPerRound(w: WeaponId): number {
  return w === 'shotgun' ? tuning.pumpReloadPerShell : tuning.rifleReloadPerRound;
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
  p.quietTicks++;
  // "Duellante": the tic when the carbine's double-damage shot is ready.
  if (p.quietTicks === secondsToTicks(tuning.duelistTime) && p.weapon === 'rifle' && hasCard(p, 'duelist')) {
    events.push({ type: 'duelReady' });
  }
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
  const oneByOne = reloadsOneByOne(p, p.weapon);
  const full = magazineSize(p, p.weapon);
  stepSlideReload(p, full, events);

  // Reloading: count down, then move rounds from the pockets into the gun.
  // The rounds are taken only at the END: a reload interrupted by a weapon
  // switch costs nothing (and gives nothing). The carbine moves ONE round
  // each time, then starts counting again for the next one, until the tube
  // is full or the pocket is empty.
  if (p.reloadTicks > 0) {
    p.reloadTicks--;
    if (p.reloadTicks === 0) {
      const loaded = currentAmmo(p);
      const twoAtATime = p.weapon === 'rifle' && hasCard(p, 'twoAtATime'); // "Due alla volta" (a carbine card)
      const wanted = oneByOne ? (twoAtATime ? 2 : 1) : full - loaded;
      const moved = Math.min(wanted, full - loaded, tuning.infiniteAmmo ? Infinity : p.reserve[pocket]);
      setCurrentAmmo(p, loaded + moved);
      if (!tuning.infiniteAmmo) p.reserve[pocket] -= moved;
      if (oneByOne && moved > 0) events.push({ type: 'reloadRound', weapon: p.weapon });
      const more = oneByOne && currentAmmo(p) < full && (tuning.infiniteAmmo || p.reserve[pocket] > 0);
      if (more) p.reloadTicks = secondsToTicks(reloadPerRound(p.weapon));
      else endReload(p, events, 0);
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
    endReload(p, events, tuning.rifleReloadInterrupt);
  }

  // Aiming down the sights (the carbine's alternate fire, right mouse
  // button): it takes rifleAdsTime to get the gun up to the eye, and the
  // same to lower it. Not while reloading or bringing the gun up.
  const aimAllowed = cmd.altFire && p.weapon === 'rifle' && p.reloadTicks === 0 && p.switchTicks === 0;
  const adsFull = secondsToTicks(tuning.rifleAdsTime);
  p.adsTicks = aimAllowed ? Math.min(adsFull, p.adsTicks + 1) : Math.max(0, p.adsTicks - 1);
  p.aimHeldTicks = aimAllowed ? p.aimHeldTicks + 1 : 0; // "Quickscope": since when you're aiming

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
    const seconds = reloadTime(p, p.weapon);
    p.reloadTicks = secondsToTicks(seconds);
    p.fireBufferTicks = 0;
    events.push({ type: 'reloadStart', weapon: p.weapon, seconds, forged: p.forged[p.weapon] > 0 });
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
    // The last round in the cylinder (card "Ultimo colpo"). Not during
    // HIGH NOON: the cylinder never empties, there's no last round.
    const lastRound = ammo === 1 && !bottomless;
    const eventsBefore = events.length;
    /** Rounds this shot takes out of the gun (the shotgun's cards can make it 2, or 0). */
    let shells = 1;
    if (fanning) {
      events.push({ type: 'fire', weapon: 'revolver', barrel: revolverHand(p, full, ammo), seconds: fireInterval(p, 'revolver'), forged: p.forged.revolver > 0 });
      fireFanned(p, world, entities, events, rng, lastRound);
    } else if (p.weapon === 'shotgun') {
      // Right barrel first (2 shells left), then the left one. Card "Doppio
      // botto": with both loaded, both go off together.
      // The pump-action has one barrel: "Doppio botto" fires two shells at once only on the
      // FIRST shot of a full tube (the double barrel's "both barrels loaded").
      const pump = isPump(p);
      const both = hasCard(p, 'doubleBang') && ammo >= 2 && (!pump || ammo === full);
      const fire = (barrel: number) =>
        events.push({ type: 'fire', weapon: 'shotgun', barrel, seconds: fireInterval(p, 'shotgun'), forged: pump });
      if (pump) {
        fire(0);
        if (both) fire(1); // two shells through the same barrel: a second blast
        shells = fireShotgun(p, world, entities, events, both ? [0, Math.PI / 7] : [0]);
      } else {
        if (both || ammo === tuning.shotgunAmmo) fire(0);
        if (both || ammo !== tuning.shotgunAmmo) fire(1);
        shells = fireShotgun(p, world, entities, events, both ? [0, Math.PI / 7] : [ammo === tuning.shotgunAmmo ? 0 : Math.PI / 7]);
      }
    } else if (p.weapon === 'rifle') {
      events.push({ type: 'fire', weapon: 'rifle', barrel: 0, seconds: fireInterval(p, 'rifle'), forged: p.forged.rifle > 0 });
      fireRifle(p, world, entities, events, rng);
    } else if (p.weapon === 'dynamite') {
      // Not hitscan: the weapon only says "a stick leaves the barrel"; the
      // stick itself (a projectile with its own physics) is created by
      // stepGame when it reads this event, because the list of sticks lives
      // in the GameState and the weapon doesn't know about it.
      events.push({ type: 'fire', weapon: 'dynamite', barrel: 0, seconds: fireInterval(p, 'dynamite'), forged: p.forged.dynamite > 0 });
    } else {
      events.push({ type: 'fire', weapon: 'revolver', barrel: revolverHand(p, full, ammo), seconds: fireInterval(p, 'revolver'), forged: p.forged.revolver > 0 });
      fireRevolver(p, world, entities, events, lastRound);
    }
    if (!bottomless) setCurrentAmmo(p, Math.min(full, ammo - shells));
    p.quietTicks = 0; // "Duellante": the wait starts over
    p.wallJumpShot = false; // the wall jump's shot is fired (hit or miss)
    p.fireCooldownTicks = secondsToTicks(fireInterval(p, p.weapon));
    p.fireBufferTicks = 0;
    p.fanQueued = false;
    if (fanning) {
      p.fanShotsLeft--;
      // Card "Mano lesta": every kill of this shot adds a shot to the burst,
      // with a free round to fire it (the burst never stops on a kill streak).
      if (hasCard(p, 'quickHand')) {
        const kills = events.slice(eventsBefore).filter((e) => e.type === 'hit' && e.killed).length;
        p.fanShotsLeft += kills;
        setCurrentAmmo(p, currentAmmo(p) + kills);
      }
      // The next shot of the burst comes quickly; after the last one the
      // hand needs a moment before the revolver is back to normal.
      const interval = tuning.revolverFanInterval * (hasCard(p, 'quickHand') ? tuning.quickHandIntervalScale : 1);
      p.fireCooldownTicks = secondsToTicks(p.fanShotsLeft > 0 ? interval : tuning.revolverFanRecovery);
    }
  }
}

/**
 * Card "Ricarica in scivolata": while you slide with the revolver in your
 * hands, a round goes from the pocket into the cylinder every
 * slideReloadInterval seconds. Not during a normal reload or a fanning
 * burst (they own the cylinder). The timer restarts at every new slide:
 * a short slide gives nothing, so it can't be spammed with taps.
 */
function stepSlideReload(p: PlayerState, full: number, events: SimEvent[]): void {
  const active =
    p.sliding && p.weapon === 'revolver' && hasCard(p, 'slideReload') && p.reloadTicks === 0 && p.fanShotsLeft === 0;
  if (!active) {
    p.slideReloadTicks = 0;
    return;
  }
  if (p.slideReloadTicks === 0) p.slideReloadTicks = secondsToTicks(tuning.slideReloadInterval);
  if (--p.slideReloadTicks > 0) return;
  const pocket = AMMO_TYPE.revolver;
  if (currentAmmo(p) < full && (tuning.infiniteAmmo || p.reserve[pocket] > 0)) {
    setCurrentAmmo(p, currentAmmo(p) + 1);
    if (!tuning.infiniteAmmo) p.reserve[pocket]--;
    events.push({ type: 'reloadRound', weapon: 'revolver' });
  }
  p.slideReloadTicks = secondsToTicks(tuning.slideReloadInterval); // next round, if you keep sliding
}

/**
 * A reload is over (done, or stopped by a click). `cooldown` = seconds before
 * the gun can fire (the carbine coming back up from the gate after a click).
 * The pump-action always waits at least pumpReloadClose: the hand goes back
 * to the fore-end and slams it shut.
 */
function endReload(p: PlayerState, events: SimEvent[], cooldown: number): void {
  const pump = p.weapon === 'shotgun' && isPump(p);
  const seconds = pump ? Math.max(cooldown, tuning.pumpReloadClose) : cooldown;
  p.fireCooldownTicks = Math.max(p.fireCooldownTicks, secondsToTicks(seconds));
  events.push({ type: 'reloadEnd', weapon: p.weapon, forged: p.forged[p.weapon] > 0 });
}

/** Puts `w` in your hands. Also used by the shop: a weapon you just bought goes straight to your hands. */
export function switchWeapon(p: PlayerState, w: WeaponId, events: SimEvent[]): void {
  p.weapon = w;
  // (max: switching during the shovel's swing doesn't bring the gun back sooner.)
  p.switchTicks = Math.max(p.switchTicks, secondsToTicks(tuning.weaponSwitchTime));
  p.reloadTicks = 0;
  p.fireCooldownTicks = 0;
  p.adsTicks = 0;
  p.fanShotsLeft = 0; // a fanning burst stops: the revolver is put away
  p.fanQueued = false;
  events.push({ type: 'weaponSwitch', weapon: w, forged: p.forged[w] > 0 });
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

/** Where a traced bullet stopped (see trace's `end`). */
interface TraceEnd {
  x: number;
  y: number;
  z: number;
  /** It hit something (the level or an entity), not the sky. */
  hit: boolean;
  /** Vertical part of the surface's normal: ~1 = a floor. */
  ny: number;
  /** How far it went. */
  distance: number;
}
function newEnd(): TraceEnd {
  return { x: 0, y: 0, z: 0, hit: false, ny: 0, distance: 0 };
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
  /** If given, filled with where the bullet stopped, whether it hit anything (level or entity) and the surface's normal. */
  end?: TraceEnd,
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
  // - Damned Smith: armored everywhere except the head (above smithHeadHeight).
  const headshot =
    target !== null &&
    ((target.type === 'ghoul' && hit!.y - target.y > tuning.ghoulHeadHeight) ||
      (target.type === 'smith' && hit!.y - target.y > tuning.smithHeadHeight) ||
      (target.type === 'hound' && hit!.y - target.y > tuning.houndHeadHeight) ||
      (target.type === 'sharpshooter' && hit!.y - target.y > tuning.sharpshooterHeadHeight) ||
      (target.type === 'bull' && target.state === 'stunned') ||
      (target.type === 'eyebat' && pupilHit(target, ox, oy, oz, dx, dy, dz)));

  const to = hit
    ? { x: hit.x, y: hit.y, z: hit.z }
    : { x: ox + dx * range, y: oy + dy * range, z: oz + dz * range };
  if (end) {
    end.x = to.x;
    end.y = to.y;
    end.z = to.z;
    end.hit = hit !== null;
    end.ny = hit ? hit.ny : 0;
    end.distance = hit ? hit.distance : range;
  }
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

/** Revolver: one hitscan bullet, straight where you look. */
function fireRevolver(p: PlayerState, world: World, entities: Entity[], events: SimEvent[], lastRound: boolean): void {
  const { ox, oy, oz, dx, dy, dz } = aim(p);
  revolverBullet(p, ox, oy, oz, dx, dy, dz, world, entities, events, lastRound);
}

/**
 * One revolver bullet along a ray (a normal shot or a fanned one): the
 * trace, the damage, and what the cards add.
 * - "Colpo da cavaliere": the first shot after a wall jump is a critical hit
 *   wherever it lands (wallJumpShot is cleared by every shot, in stepWeapon:
 *   a miss wastes it).
 * - "Ricochet": a critical hit bounces into another enemy.
 * - "Ultimo colpo": the cylinder's last round explodes where it lands.
 */
function revolverBullet(
  p: PlayerState,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  world: World,
  entities: Entity[],
  events: SimEvent[],
  lastRound: boolean,
): void {
  const end = newEnd();
  const hit = trace(ox, oy, oz, dx, dy, dz, tuning.weaponRange, world, entities.filter(isAlive), false, events, end);
  if (hit) {
    const critical = hit.headshot || (p.wallJumpShot && hasCard(p, 'riderShot'));
    const amount = tuning.revolverDamage * forgeMultiplier(p, 'revolver') * drinkDamageMultiplier(p) * (critical ? tuning.headshotMultiplier : 1);
    applyGunDamage(hit.target, amount, critical, 'revolver', hit.distance, events);
    if (critical && hasCard(p, 'ricochet')) ricochet(p, end, hit.target, world, entities, events);
  }
  // Into the sky: nothing to explode against.
  if (lastRound && end.hit && hasCard(p, 'lastShot')) {
    // The impact point is ON the wall: a line from there could start inside
    // it. The blast starts from a point pulled back a little toward you.
    const eye = currentEyeHeight(p);
    const bx = end.x - p.x;
    const by = end.y - (p.y + eye);
    const bz = end.z - p.z;
    const back = Math.hypot(bx, by, bz) || 1;
    const at = { x: end.x - (bx / back) * 0.15, y: end.y - (by / back) * 0.15, z: end.z - (bz / back) * 0.15 };
    explode(p, at, lastShotBlast(), world, entities, events);
  }
}

/**
 * Card "Ricochet": from the point where the critical hit landed, the bullet
 * flies on toward the BODY of the nearest living enemy (not the one it just
 * hit) within ricochetRange and in sight. It's a new bullet: a 'shot' event
 * (blood where it lands) and plain body damage. It doesn't bounce again: no
 * chain reactions across the whole horde.
 */
function ricochet(
  p: PlayerState,
  from: { x: number; y: number; z: number },
  first: Entity,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  let best: Entity | null = null;
  let bestDistance = tuning.ricochetRange;
  for (const e of entities) {
    if (e === first || !isEnemy(e) || !isAlive(e)) continue;
    const c = hitCenter(e);
    const d = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z);
    if (d < bestDistance && lineFree(world, from.x, from.y, from.z, c.x, c.y, c.z)) {
      best = e;
      bestDistance = d;
    }
  }
  if (!best) return;
  events.push({ type: 'ricochet', x: from.x, y: from.y, z: from.z });
  const c = hitCenter(best);
  const dx = (c.x - from.x) / bestDistance;
  const dy = (c.y - from.y) / bestDistance;
  const dz = (c.z - from.z) / bestDistance;
  // Only the target is in the list: on the way the bullet can't hit the
  // first enemy again (it starts inside its hitbox).
  const hit = trace(from.x, from.y, from.z, dx, dy, dz, bestDistance + 1, world, [best], false, events);
  if (hit) {
    const distance = Math.hypot(c.x - p.x, c.z - p.z);
    applyGunDamage(hit.target, tuning.ricochetDamage, false, 'revolver', distance, events);
  }
}

/**
 * One bullet of a fanning burst: the revolver's bullet (same damage, same
 * critical hits), but off the aim by up to revolverFanSpread degrees, in a
 * random direction: the hand slapping the hammer shakes the gun. The same
 * "random point in a disc" as the carbine's hip fire (see fireRifle).
 */
function fireFanned(
  p: PlayerState,
  world: World,
  entities: Entity[],
  events: SimEvent[],
  rng: RandomState,
  lastRound: boolean,
): void {
  const a = aim(p);
  const steady = hasCard(p, 'quickHand') ? tuning.quickHandSpreadScale : 1; // "Mano lesta"
  const spread = Math.tan((tuning.revolverFanSpread * steady * Math.PI) / 180);
  const angle = random(rng) * Math.PI * 2;
  const r = Math.sqrt(random(rng));
  const [dx, dy, dz] = tilt(p, a, Math.cos(angle) * r, Math.sin(angle) * r, spread);
  revolverBullet(p, a.ox, a.oy, a.oz, dx, dy, dz, world, entities, events, lastRound);
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
  // "Leva da pistolero": no spread from the hip.
  const hip = hasCard(p, 'gunslingerLever') ? 0 : tuning.rifleHipSpread;
  const spread = Math.tan((hip * Math.PI) / 180) * (1 - adsAmount(p));
  const angle = random(rng) * Math.PI * 2;
  const r = Math.sqrt(random(rng));
  const [dx, dy, dz] = tilt(p, a, Math.cos(angle) * r, Math.sin(angle) * r, spread);

  // The cards that change the damage of THIS shot (read before the loop: a
  // piercing bullet carries them through every enemy it crosses).
  const aimed = adsAmount(p) >= 1;
  const critMultiplier = hasCard(p, 'hawkEye') && aimed ? tuning.scopeCritMultiplier : tuning.rifleHeadshotMultiplier;
  const quickscope = hasCard(p, 'quickscope') && p.aimHeldTicks > 0 && p.aimHeldTicks <= secondsToTicks(tuning.quickscopeWindow);
  const duel = hasCard(p, 'duelist') && p.quietTicks >= secondsToTicks(tuning.duelistTime) ? tuning.duelistMultiplier : 1;
  const marks = hasCard(p, 'mark');

  // "Perforante": after an enemy, the same ray goes on, without that enemy
  // in the list, until it hits the level (or nothing). Without the card it
  // stops at the first one, as always.
  let living = entities.filter(isAlive);
  const pierce = hasCard(p, 'piercing');
  for (let i = 0; i < 16; i++) {
    const hit = trace(a.ox, a.oy, a.oz, dx, dy, dz, tuning.weaponRange, world, living, false, events);
    if (!hit) break;
    const critical = hit.headshot || quickscope;
    let amount = tuning.rifleDamage * forgeMultiplier(p, 'rifle') * drinkDamageMultiplier(p) * (critical ? critMultiplier : 1) * duel;
    // "Marchio": a marked enemy takes double and loses the mark; an unmarked one gets it.
    const wasMarked = marks && hit.target.marked === true;
    if (wasMarked) {
      amount *= tuning.markMultiplier;
      hit.target.marked = false;
    }
    applyGunDamage(hit.target, amount, critical, 'rifle', hit.distance, events);
    if (marks && !wasMarked && isAlive(hit.target) && isEnemy(hit.target)) hit.target.marked = true;
    if (!pierce) break;
    living = living.filter((e) => e !== hit.target);
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
 * the second shot fills the gaps of the first. The pattern is a wide, short
 * ELLIPSE: it covers the ghouls standing next to the one you aim at.
 *
 * The damage of each pellet drops with distance (falloff): that's what makes
 * it a close-range weapon, together with the spread.
 */
function fireShotgun(p: PlayerState, world: World, entities: Entity[], events: SimEvent[], barrels: number[]): number {
  const a = aim(p);
  const { ox, oy, oz, dx, dy, dz } = a;
  // What the pellets can still hit. A target leaves this list as soon as the
  // pellets so far are enough to kill it (see count below).
  let targets = entities.filter(isAlive);
  // Damage is summed per entity and applied once at the end: one hitmarker,
  // one 'hit' event, one kill, even if 10 pellets hit the same ghoul.
  const totals = new Map<Entity, { amount: number; headshot: boolean; pellets: number; distance: number }>();
  const tight = hasCard(p, 'longBarrels') ? tuning.longBarrelsSpreadScale : 1; // "Canne lunghe"
  // The pattern is drawn in a unit disc; stretching x and y by different
  // amounts turns the disc into an ellipse (a scale matrix, diagonal).
  // tan(angle) = how far off the aim per meter traveled.
  const spreadH = Math.tan((tuning.shotgunSpreadHorizontal * tight * Math.PI) / 180);
  const spreadV = Math.tan((tuning.shotgunSpreadVertical * tight * Math.PI) / 180);
  const count = (hit: ReturnType<typeof trace>, travelled: number) => {
    if (!hit) return;
    const amount =
      tuning.shotgunPelletDamage *
      forgeMultiplier(p, 'shotgun') * drinkDamageMultiplier(p) *
      falloff(p, travelled + hit.distance) *
      (hit.headshot ? tuning.shotgunHeadshotMultiplier : 1);
    const t = totals.get(hit.target) ?? { amount: 0, headshot: false, pellets: 0, distance: Infinity };
    t.amount += amount;
    t.headshot ||= hit.headshot;
    t.pellets++;
    t.distance = Math.min(t.distance, travelled + hit.distance);
    totals.set(hit.target, t);
    // OVERKILL GOES THROUGH: once this shot has dealt enough to kill it, the
    // target is already "dead" for the pellets that follow, and they fly on
    // to whoever is behind it. Without this, 12 pellets on a 50-health ghoul
    // waste more than two thirds of the shot; with it, a ghoul in front of
    // another is a shield that breaks, and a packed horde gets mowed down.
    // (The damage itself is still applied at the end, all at once.)
    if (Math.round(t.amount) >= hit.target.health) targets = targets.filter((e) => e !== hit.target);
  };
  // One pattern per barrel fired (two with "Doppio botto"); the second
  // barrel's pattern is rotated, so it fills the gaps of the first.
  for (const twist of barrels) {
    for (const [ax, ay] of pelletPattern(tuning.shotgunPellets, twist)) {
      const [px, py, pz] = tilt(p, a, ax * spreadH, ay * spreadV, 1);
      const end = newEnd();
      const hit = trace(ox, oy, oz, px, py, pz, tuning.shotgunRange, world, targets, true, events, end);
      count(hit, 0);
      // "Pallini rimbalzanti": a pellet that hit the FLOOR bounces once.
      // A mirror on a horizontal surface only flips the vertical part of
      // the direction. It starts a hair above the floor, with the range it
      // has left, and its falloff counts the whole path.
      if (!hit && end.hit && end.ny > 0.7 && hasCard(p, 'bouncingPellets')) {
        const rest = tuning.shotgunRange - end.distance;
        count(trace(end.x, end.y + 0.02, end.z, px, -py, pz, rest, world, targets, true, events), end.distance);
      }
    }
  }

  let pointBlankKill = false;
  for (const [target, t] of totals) {
    applyGunDamage(target, Math.round(t.amount), t.headshot, 'shotgun', t.distance, events);
    if (hasCard(p, 'dragonBreath') && isAlive(target)) ignite(target); // "Fiato di drago"
    if (!isAlive(target) && t.distance < tuning.shotgunKnockbackRange) pointBlankKill = true;
    blastBack(p, target, t.pellets, t.distance, entities);
  }
  // The recoil on you, once per barrel. "Calcio di piombo": none.
  const flying = !p.onGround;
  if (!hasCard(p, 'leadStock')) for (let i = 0; i < barrels.length; i++) recoil(p, dx, dy, dz);
  // "Volo di piombo": a shot fired downward in the air is a shotgun jump; its
  // shells come back if you kill something before landing.
  if (flying && dy < 0 && hasCard(p, 'leadFlight')) p.leadFlightShells += barrels.length;
  // "Bruciapelo fortunato": a point-blank kill gives one shell back.
  const refund = pointBlankKill && hasCard(p, 'pointBlankLuck') ? 1 : 0;
  return barrels.length - refund;
}

/**
 * Card "Volo di piombo": called by stepGame with this tick's hits (gun and
 * boot). A kill while you're still in the air after a shotgun jump puts the
 * shells back: in the barrels if there's room, else in the pocket.
 */
export function refundLeadFlight(p: PlayerState, hits: SimEvent[]): void {
  if (p.leadFlightShells === 0 || p.onGround) return;
  if (!hits.some((e) => e.type === 'hit' && e.killed)) return;
  const toGun = Math.min(p.leadFlightShells, magazineSize(p, 'shotgun') - p.loaded.shotgun);
  p.loaded.shotgun += toGun;
  p.reserve.shells = Math.min(tuning.shotgunReserveMax, p.reserve.shells + p.leadFlightShells - toGun);
  p.leadFlightShells = 0;
}

/**
 * Point-blank knockback: an enemy that took the blast up close flies back,
 * like a kick. The strength is the product of two fractions, each 0..1:
 * - how close it was (1 at 0 m, 0 at shotgunKnockbackRange);
 * - how many pellets hit it (all of them = 1): a grazing shot barely pushes.
 * Below shotgunKnockbackMin: nothing. Otherwise every weak hit would put the
 * ghoul in its 'staggered' state and you could stun-lock a crowd from afar.
 */
function blastBack(p: PlayerState, target: Entity, pellets: number, distance: number, entities: Entity[]): void {
  const closeness = 1 - distance / tuning.shotgunKnockbackRange;
  const strength =
    Math.max(0, closeness) *
    Math.min(1, pellets / tuning.shotgunPellets) *
    (hasCard(p, 'leadStock') ? tuning.leadStockKnockbackScale : 1); // "Calcio di piombo"
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
  throwBody(p, target, kx, kz, strength);
  // "Spinta di gruppo": whoever stands right behind it (farther from you,
  // within groupPushRadius of it) is thrown the same way, a bit less hard.
  if (hasCard(p, 'groupPush')) {
    const tx = (b.minX + b.maxX) / 2;
    const tz = (b.minZ + b.maxZ) / 2;
    const reach = Math.hypot(tx - p.x, tz - p.z);
    for (const other of entities) {
      if (other === target || !isEnemy(other) || !isAlive(other)) continue;
      const near = Math.hypot(other.x - tx, other.z - tz) < tuning.groupPushRadius;
      const behind = Math.hypot(other.x - p.x, other.z - p.z) > reach;
      if (near && behind) throwBody(p, other, kx, kz, strength * tuning.groupPushScale);
    }
  }
}

/** One body thrown by the blast (and, with "Calcio di piombo", hurt if it hits a wall). */
function throwBody(p: PlayerState, e: Entity, kx: number, kz: number, strength: number): void {
  knockBack(e, kx, kz, tuning.shotgunKnockback * strength, tuning.shotgunKnockbackLift * strength);
  if (hasCard(p, 'leadStock')) markSlam(e);
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
  const push = tuning.shotgunSelfPush * (hasCard(p, 'mule') ? tuning.muleRecoilScale : 1); // "Mulo"

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

/**
 * Damage multiplier for a pellet that traveled `distance` meters: 1, then a
 * straight line down to the minimum. "Canne lunghe" moves both ends farther.
 */
function falloff(p: PlayerState, distance: number): number {
  const extra = hasCard(p, 'longBarrels') ? tuning.longBarrelsFalloffExtra : 0;
  const start = tuning.shotgunFalloffStart + extra;
  const end = tuning.shotgunFalloffEnd + extra;
  const min = tuning.shotgunFalloffMin;
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
