// The wager's "darkness" curse (src/sim/wager.ts): while it's on you, the
// town fades into DEVIL_NIGHT (atmospheres.ts) and back when the cursed
// wave is over. Like the eclipse it READS the state (player.curse), it never
// counts events: dying, a debug jump... it's always right.
import type { PlayerState } from '../sim/player';
import { createFade } from './eclipse';

/** Seconds for night to fall (and to lift): quicker than the eclipse, it's a curse, not the sky moving. */
export const DARKNESS_TIME = 3;

export interface Darkness {
  /** Every frame: how dark (0..1, eased), or null if nothing changed (no need to re-apply the atmosphere). */
  update(dt: number, player: PlayerState): number | null;
}

export function createDarkness(): Darkness {
  const fade = createFade(DARKNESS_TIME);
  return { update: (dt, player) => fade(dt, player.curse === 'darkness') };
}
