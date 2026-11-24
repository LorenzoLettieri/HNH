// The Fire Eclipse: during the Damned Smith's waves (9, 19, 29...: isSmithWave
// in sim/waves.ts) a black moon slides over the sun (FIRE_ECLIPSE in
// atmospheres.ts), and slides away when the wave is over. Purely visual: it
// only READS the wave from the game state.
//
// Reading the state (and not the waveStart/waveEnd events) means it's always
// right: jumping to a wave from the debug panel, restarting after death...
// Like a React component that renders from props instead of counting clicks.

import { isSmithWave } from '../sim/waves';
import type { WaveState } from '../sim/waves';

/** Seconds for the moon to cover the sun (and to uncover it). */
export const ECLIPSE_TIME = 6;

export interface Eclipse {
  /**
   * Call every frame. Returns how far the eclipse is (0 = normal sky,
   * 1 = full eclipse, already eased), or null if nothing changed since the
   * last frame: then there's no need to re-apply the atmosphere.
   */
  update(dt: number, wave: WaveState): number | null;
}

export function createEclipse(): Eclipse {
  const fade = createFade(ECLIPSE_TIME);
  return {
    update: (dt, wave) => fade(dt, isSmithWave(wave.number) && wave.phase === 'active'),
  };
}

/**
 * A slow fade toward "on" or "off", in `seconds`: call it every frame with
 * whether you want it on. Returns how far it is (0..1, already eased), or
 * null if nothing changed since the last frame. Shared by the eclipse and
 * the wager's darkness (darkness.ts).
 */
export function createFade(seconds: number): (dt: number, on: boolean) => number | null {
  let progress = 0; // linear 0..1
  let first = true;
  return (dt, on) => {
    const want = on ? 1 : 0;
    if (progress === want && !first) return null;
    first = false;
    // Move toward the goal at a constant speed, without passing it.
    const step = dt / seconds;
    progress = want > progress ? Math.min(want, progress + step) : Math.max(want, progress - step);
    // Smoothstep: starts and ends gently (3t² − 2t³), like CSS "ease-in-out".
    return progress * progress * (3 - 2 * progress);
  };
}
