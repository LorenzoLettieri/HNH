// Events: things that HAPPENED during a tick, that the rest of the game may
// want to react to (sounds, visual effects, HUD). The simulation only
// appends them to a list; it doesn't know or care who listens.
// (On a future server, the same events would be sent to the clients.)

export type SimEvent =
  | {
      type: 'shot';
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
  | { type: 'hit'; entityId: number; damage: number; killed: boolean; surface: 'metal' | 'flesh'; headshot: boolean }
  | { type: 'playerHurt'; damage: number; fromX: number; fromZ: number }
  | { type: 'playerDied'; wave: number; kills: number; score: number }
  | { type: 'waveStart'; wave: number }
  | { type: 'waveEnd'; wave: number }
  | { type: 'ghoulAttack'; entityId: number }
  /** An eye-bat starts charging a shot (the warning: glow + whine). */
  | { type: 'eyebatCharge'; entityId: number }
  /** An eye-bat fires: a projectile leaves its eye. */
  | { type: 'eyebatShot'; entityId: number; projectileId: number }
  /** A projectile hit the level or the player (where, and the surface normal). */
  | { type: 'projectileHit'; x: number; y: number; z: number; nx: number; ny: number; nz: number; player: boolean }
  | { type: 'dryFire' } // pulled the trigger with an empty cylinder
  | { type: 'reloadStart' }
  | { type: 'reloadEnd' };
