// Events: things that HAPPENED during a tick, that the rest of the game may
// want to react to (sounds, visual effects, HUD). The simulation only
// appends them to a list; it doesn't know or care who listens.
// (On a future server, the same events would be sent to the clients.)

import type { WeaponId } from './weapon';
import type { PickupKind } from './pickups';

export type SimEvent =
  /** A weapon fired (sound, flash, recoil). For the shotgun, `barrel` is 0 = right, 1 = left. */
  | { type: 'fire'; weapon: WeaponId; barrel: number }
  /** You switched weapon: the new one is coming up. */
  | { type: 'weaponSwitch'; weapon: WeaponId }
  /** One bullet or pellet: where it went and what it hit (impacts, blood). A shotgun blast is many of these. */
  | {
      type: 'shot';
      /** A shotgun pellet (smaller effects) rather than a revolver bullet. */
      pellet: boolean;
      /** Where the bullet started (the player's eye). */
      from: { x: number; y: number; z: number };
      /** Where it stopped: the hit point, or max range if it hit nothing. */
      to: { x: number; y: number; z: number };
      /** Normal of the surface hit, or null if it hit nothing. */
      normal: { x: number; y: number; z: number } | null;
      /** Id of the entity hit, if the bullet hit one (instead of the level). */
      entityId: number | null;
      /** What was hit, for the right effect: wall (hole + sparks), steel, or flesh (blood). */
      surface: 'level' | 'metal' | 'flesh' | null;
      headshot: boolean;
    }
  | {
      type: 'hit';
      entityId: number;
      damage: number;
      killed: boolean;
      surface: 'metal' | 'flesh';
      headshot: boolean;
      /** An enemy hurt another (a bull's charge): blood and sounds yes, but no hitmarker, score or drop. */
      byEnemy?: boolean;
    }
  | { type: 'playerHurt'; damage: number; fromX: number; fromZ: number }
  | { type: 'playerDied'; wave: number; kills: number; score: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveEnd'; wave: number }
  | { type: 'ghoulAttack'; entityId: number }
  | { type: 'ghoulLunge'; entityId: number } // starts crouching for a pounce (the warning)
  /** A hound starts its ambush: the howl (the warning). */
  | { type: 'houndHowl'; entityId: number }
  /** A hound opens its jaws: the bite lands in houndBiteWindup seconds. */
  | { type: 'houndBite'; entityId: number }
  /** A bull stops to aim a charge: pawing and snorting (the warning). */
  | { type: 'bullAim'; entityId: number }
  /** A bull starts its charge (direction locked). */
  | { type: 'bullCharge'; entityId: number }
  /** A charging bull slams into a wall: dazed. */
  | { type: 'bullCrash'; entityId: number }
  /** An eye-bat starts charging a shot (the warning: glow + whine). */
  | { type: 'eyebatCharge'; entityId: number }
  /** An eye-bat fires: a projectile leaves its eye. */
  | { type: 'eyebatShot'; entityId: number; projectileId: number }
  /** A projectile hit the level or the player (where, and the surface normal). */
  | { type: 'projectileHit'; x: number; y: number; z: number; nx: number; ny: number; nz: number; player: boolean }
  /** The kick starts (the leg swings: whoosh). */
  | { type: 'kickStart' }
  /** The foot lands: how many things it hit (0 = kicked the air). */
  | { type: 'kickLand'; hits: number }
  | { type: 'dryFire' } // pulled the trigger with an empty cylinder
  | { type: 'reloadStart'; weapon: WeaponId }
  | { type: 'reloadEnd' }
  /** You collected a pickup (sound, flash on the HUD). */
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; z: number };
