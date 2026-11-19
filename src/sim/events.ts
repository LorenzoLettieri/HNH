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
    }
  | { type: 'hit'; entityId: number; damage: number; killed: boolean; surface: 'metal' | 'flesh' }
  | { type: 'dryFire' } // pulled the trigger with an empty cylinder
  | { type: 'reloadStart' }
  | { type: 'reloadEnd' };
