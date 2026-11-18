// The game's debug panel: which values can be tweaked live, and their ranges.
// To expose a new value, add one line here.
import { tuning } from '../sim/config';
import { controlSettings } from '../controls';
import { postSettings } from '../render/postprocess';
import type { Atmosphere } from '../render/atmospheres';
import { copyToClipboard, createPanel, toSource, type Folder } from './panel';

const ATMOSPHERE_COLORS = [
  'skyTop',
  'skyHorizon',
  'sunColor',
  'sunLightColor',
  'lanternColor',
  'dustColor',
  'ambientSky',
  'ambientGround',
];

export interface DebugPanel {
  toggle(): void;
  /** Rebuilds the atmosphere section for the preset now in use. */
  showAtmosphere(a: Atmosphere): void;
}

export function createDebugPanel(options: {
  onAtmosphereChange: () => void;
  onPostSizeChange: () => void;
}): DebugPanel {
  const panel = createPanel();

  // --- Movement ---
  const move = panel.folder('Movement (src/sim/config.ts)');
  move.number(controlSettings, 'mouseSensitivity', 0.0005, 0.006, 0.0001);
  move.number(tuning, 'maxGroundSpeed', 2, 25, 0.1);
  move.number(tuning, 'groundAccel', 1, 40, 0.5);
  move.number(tuning, 'groundFriction', 0, 20, 0.5);
  move.number(tuning, 'stopSpeed', 0, 6, 0.1);
  move.number(tuning, 'gravity', 5, 50, 0.5);
  move.number(tuning, 'jumpSpeed', 2, 15, 0.1);
  move.boolean(tuning, 'autoBhop');
  move.number(tuning, 'coyoteTime', 0, 0.3, 0.01);
  move.number(tuning, 'jumpBufferTime', 0, 0.3, 0.01);
  move.number(tuning, 'airAccel', 0, 50, 0.5);
  move.number(tuning, 'airSpeedCap', 0, 10, 0.1);
  move.number(tuning, 'eyeHeight', 1, 1.8, 0.05);
  move.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Post-processing ---
  const post = panel.folder('Post-processing (src/render/postprocess.ts)');
  post.number(postSettings, 'pixelHeight', 120, 720, 10, options.onPostSizeChange);
  post.number(postSettings, 'colorLevels', 2, 64, 1);
  post.number(postSettings, 'dither', 0, 1, 0.05);
  post.number(postSettings, 'bloomThreshold', 0, 3, 0.05);
  post.number(postSettings, 'bloomStrength', 0, 3, 0.05);
  post.number(postSettings, 'bloomPasses', 0, 6, 1);
  post.button('Copy values', () => copyToClipboard(toSource(postSettings)));

  // --- Atmosphere (rebuilt when switching preset with T) ---
  const atmo = panel.folder('Atmosphere');

  function fillAtmosphere(folder: Folder, a: Atmosphere): void {
    folder.clear();
    folder.setTitle(`Atmosphere: ${a.name} (src/render/atmospheres.ts)`);
    const obj = a as unknown as Record<string, unknown>;
    const apply = options.onAtmosphereChange;
    for (const key of ATMOSPHERE_COLORS) folder.color(obj, key, apply);
    folder.number(obj, 'skyCurve', 0.1, 2, 0.05, apply);
    folder.number(obj, 'sunSize', 0.5, 20, 0.5, apply);
    folder.number(obj, 'sunElevation', -5, 90, 1, apply);
    folder.number(obj, 'sunAzimuth', -180, 180, 1, apply);
    folder.number(obj, 'sunGlow', 0, 3, 0.05, apply);
    folder.number(obj, 'sunGlowTightness', 1, 30, 0.5, apply);
    folder.number(obj, 'sunBrightness', 0.5, 8, 0.1, apply);
    folder.number(obj, 'stars', 0, 1, 0.05, apply);
    folder.number(obj, 'sunLightIntensity', 0, 8, 0.1, apply);
    folder.number(obj, 'lanternIntensity', 0, 40, 0.5, apply);
    folder.number(obj, 'dustAmount', 0, 1, 0.05, apply);
    folder.number(obj, 'dustAlpha', 0, 2, 0.05, apply);
    folder.number(obj, 'dustWindX', -6, 6, 0.1, apply);
    folder.number(obj, 'dustWindZ', -6, 6, 0.1, apply);
    folder.number(obj, 'dustBlink', 0, 1, 0.05, apply);
    folder.number(obj, 'fogNear', 0, 60, 1, apply);
    folder.number(obj, 'fogFar', 5, 150, 1, apply);
    folder.number(obj, 'groundFogDensity', 0, 0.2, 0.005, apply);
    folder.number(obj, 'groundFogFalloff', 0.05, 3, 0.05, apply);
    folder.number(obj, 'godRays', 0, 3, 0.05, apply);
    folder.number(obj, 'ambientIntensity', 0, 3, 0.05, apply);
    folder.button('Copy values', () => copyToClipboard(toSource(obj, ATMOSPHERE_COLORS)));
  }

  return {
    toggle: () => panel.toggle(),
    showAtmosphere: (a) => fillAtmosphere(atmo, a),
  };
}
