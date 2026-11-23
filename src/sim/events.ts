// Events: things that HAPPENED during a tick, that the rest of the game may
// want to react to (sounds, visual effects, HUD). The simulation only
// appends them to a list; it doesn't know or care who listens.
// (On a future server, the same events would be sent to the clients.)

import type { WeaponId } from './weapon';
import type { Entity } from './entities';
import type { MeleeTool } from './kick';
import type { PickupKind } from './pickups';
import type { PurchaseId } from './shop';
import type { ForgeRefusal } from './forge';
import type { StyleAward } from './style';
import type { Stats } from './stats';

/** What hit an enemy ('hit' events). */
export type HitSource = WeaponId | MeleeTool | 'dynamite';

export type SimEvent =
  /** A weapon fired (sound, flash, recoil). For the shotgun, `barrel` is 0 = right, 1 = left. */
  /** `seconds` = time before it can fire again (the carbine's lever cycle follows it: cards can change it). */
  /**
   * `forged` = the gun reinforced at the Forge (akimbo revolvers: `barrel` 0 = right
   * gun, 1 = left; the pump-action: the pump is racked after the shot).
   */
  | { type: 'fire'; weapon: WeaponId; barrel: number; seconds: number; forged: boolean }
  /** You switched weapon: the new one is coming up. `forged`: its reinforced version (each gun is drawn its own way). */
  | { type: 'weaponSwitch'; weapon: WeaponId; forged: boolean }
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
      /** What hit it: a gun, your boot, the shovel or a dynamite stick (the style rewards some of them). */
      source: HitSource;
      /** How far it was from you, meters. */
      distance: number;
      /** What kind of entity it was (the eye-bat's pupil is a headshot, but it gets its own name). */
      target: Entity['type'];
    }
  | { type: 'playerHurt'; damage: number; fromX: number; fromZ: number }
  /** Card "Duellante": the carbine's next shot is ready to do double damage (the tic). */
  | { type: 'duelReady' }
  /** Card "Ricochet": a bullet bounced off a head toward another enemy (the ptiiing). From where. */
  | { type: 'ricochet'; x: number; y: number; z: number }
  /** Card "Ultimo colpo": the last round exploded. Where, and how big. */
  | { type: 'explosion'; x: number; y: number; z: number; radius: number }
  /** You jumped off the ground. `hop` = right after landing (bunny hop), `slide` = out of a slide. */
  | { type: 'jump'; hop: boolean; slide: boolean }
  /** You kicked off a wall. `left` = wall jumps still available before touching the ground. */
  | { type: 'wallJump'; left: number }
  /** A steam vent launched you. */
  | { type: 'ventLaunch' }
  /** You touched the ground after `airTicks` ticks in the air. */
  | { type: 'land'; airTicks: number }
  /** An enemy projectile flew past you, close, without hitting you. */
  | { type: 'nearMiss'; kind: 'fireball' | 'bullet' }
  /** A charging bull missed you: it ran past (it skids). `side` = how far to its side you were, meters. */
  | { type: 'bullMiss'; entityId: number; side: number }
  /** A stylish action gave you style points (the HUD lists them under the meter). */
  | { type: 'styleAward'; award: StyleAward; points: number; count?: number }
  /** You reached the top style rank: the HIGH NOON climax starts (bottomless guns for a few seconds). */
  | { type: 'highNoon' }
  /** The HIGH NOON climax is over: the style starts over from zero. */
  | { type: 'highNoonEnd' }
  /** Game over: how far you got and the game's statistics (stats.ts), for the end screen. */
  | { type: 'playerDied'; wave: number; stats: Stats }
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
  /** The Damned Smith raises its hammer (the warning: the slam comes in smithSlamWindup). */
  | { type: 'smithWindup'; entityId: number }
  /** The hammer hits the ground at (x, y, z): a shockwave ring starts spreading from there. */
  | { type: 'smithSlam'; entityId: number; x: number; y: number; z: number }
  /** The Smith starts swinging its chain (the warning: the hook flies in smithHookWindup). */
  | { type: 'smithHookAim'; entityId: number }
  /** The hook leaves its hand. */
  | { type: 'smithHookThrow'; entityId: number }
  /** The hook bit you: the pull starts. */
  | { type: 'smithHookHit'; entityId: number }
  /** The hook missed (a wall, out of range) or the chain snapped: it comes back. */
  | { type: 'smithHookEnd'; entityId: number }
  /** A Damned Smith joined the wave (the announcement). */
  | { type: 'smithArrived'; entityId: number }
  /** An eye-bat starts charging a shot (the warning: glow + whine). */
  | { type: 'eyebatCharge'; entityId: number }
  /** An eye-bat fires: a projectile leaves its eye. */
  | { type: 'eyebatShot'; entityId: number; projectileId: number }
  /** A sharpshooter starts aiming: the red laser lights up (the warning). */
  | { type: 'sharpshooterAim'; entityId: number }
  /** The laser stops following you: the shot comes in sharpshooterLockTime seconds. */
  | { type: 'sharpshooterLock'; entityId: number }
  /** A sharpshooter fires: a bullet leaves the rifle. */
  | { type: 'sharpshooterShot'; entityId: number; projectileId: number }
  /** A projectile hit the level or the player (where, and the surface normal). */
  | { type: 'projectileHit'; kind: 'fireball' | 'bullet'; x: number; y: number; z: number; nx: number; ny: number; nz: number; player: boolean }
  /** The melee attack starts (the leg or the shovel swings: whoosh). */
  | { type: 'kickStart'; tool: MeleeTool }
  /**
   * The foot (or the blade) lands: how many things it hit (0 = hit the air),
   * and WHERE on each one (the side of its body facing you, at chest
   * height): sparks go there, and blood if it's `flesh` (not a steel target).
   */
  | { type: 'kickLand'; tool: MeleeTool; hits: number; at: { x: number; y: number; z: number; flesh: boolean }[] }
  | { type: 'dryFire' } // pulled the trigger with an empty cylinder
  /**
   * A reload starts; `seconds` = how long it lasts (cards can change it: the
   * animation and the sounds follow). `forged` = the gun reinforced at the
   * Forge: the akimbo revolvers' reload is the spin (both guns twirled round
   * the finger), the pump-action's is one shell at a time.
   */
  | { type: 'reloadStart'; weapon: WeaponId; seconds: number; forged: boolean }
  /**
   * One round pushed into a gun: the carbine's or the pump-action's one-by-one
   * reload, or the revolver's "Ricarica in scivolata" card.
   */
  | { type: 'reloadRound'; weapon: WeaponId }
  /** A reload is over (done or stopped by a click). `forged`: the pump-action slams its fore-end shut now. */
  | { type: 'reloadEnd'; weapon: WeaponId; forged: boolean }
  /** You bought something at a shop (sound, the panel's thanks). */
  | { type: 'purchase'; item: PurchaseId; price: number }
  /**
   * A purchase the simulation refused: not enough money, already yours, too far from the vendor,
   * or (a card) not on the counter / weapon not yours / weapon maxed out.
   */
  | { type: 'purchaseFailed'; item: PurchaseId; reason: 'money' | 'owned' | 'far' | 'unavailable' }
  /** A gun reinforced at the Forge (forge.ts): sound, the panel's line. */
  | { type: 'forged'; weapon: WeaponId; level: number }
  /** The Forge said no (forge.ts, ForgeRefusal). */
  | { type: 'forgeFailed'; weapon: WeaponId; reason: ForgeRefusal }
  /** You collected a pickup (sound, flash on the HUD). */
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; z: number };
