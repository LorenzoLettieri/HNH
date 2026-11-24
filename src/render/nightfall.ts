// Nightfall: during the Damned Smith's waves (9, 19, 29...: isSmithWave in
// sim/waves.ts) the day turns into High Midnight, and back to day when the
// wave is over. Purely visual: it only READS the wave from the game state.
//
// Reading the state (and not the waveStart/waveEnd events) means it's always
// right: jumping to a wave from the debug panel, restarting after death...
// Like a React component that renders from props instead of counting clicks.

import { isSmithWave } from '../sim/waves';
import type { WaveState } from '../sim/waves';

/** Seconds for the sky to go from day to night (and back). */
export const NIGHTFALL_TIME = 4;

export interface Nightfall {
  /**
   * Call every frame. Returns how "night" it is (0 = day, 1 = night, already
   * eased), or null if nothing changed since the last frame: then there's no
   * need to re-apply the atmosphere.
   */
  update(dt: number, wave: WaveState): number | null;
}

export function createNightfall(): Nightfall {
  let night = 0; // linear progress 0..1
  let first = true;
  return {
    update(dt, wave) {
      const want = isSmithWave(wave.number) && wave.phase === 'active' ? 1 : 0;
      if (night === want && !first) return null;
      first = false;
      // Move toward the goal at a constant speed, without passing it.
      const step = dt / NIGHTFALL_TIME;
      night = want > night ? Math.min(want, night + step) : Math.max(want, night - step);
      // Smoothstep: starts and ends gently (3t² − 2t³), like CSS "ease-in-out".
      return night * night * (3 - 2 * night);
    },
  };
}
