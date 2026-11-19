// The game's debug panel: which values can be tweaked live, and their ranges.
// To expose a new value, add one line here.
import { tuning } from '../sim/config';
import { controlSettings } from '../controls';
import { postSettings } from '../render/postprocess';
import { cameraFeelSettings } from '../render/cameraFeel';
import { viewmodelSettings } from '../render/weapons/viewmodel';
import { sfxSettings } from '../audio/sfx';
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
  move.number(tuning, 'airControl', 0, 20, 0.5);
  move.number(tuning, 'bhopGraceTime', 0, 0.4, 0.01);
  move.number(tuning, 'bhopBoost', 0, 4, 0.1);
  move.number(tuning, 'bhopBoostFalloff', 4, 30, 0.5);
  move.number(tuning, 'eyeHeight', 1, 1.8, 0.05);
  move.number(tuning, 'crouchEyeHeight', 0.4, 1.2, 0.05);
  move.number(tuning, 'crouchSpeed', 1, 8, 0.1);
  move.number(tuning, 'slideStartSpeed', 1, 12, 0.1);
  move.number(tuning, 'slideBoost', 0, 10, 0.1);
  move.number(tuning, 'slideBoostMaxSpeed', 5, 30, 0.5);
  move.number(tuning, 'slideBoostCooldown', 0, 2, 0.05);
  move.number(tuning, 'slideFriction', 0, 5, 0.05);
  move.number(tuning, 'slideStopSpeed', 0, 8, 0.1);
  move.number(tuning, 'slideSteer', 0, 30, 0.5);
  move.number(tuning, 'wallJumpReach', 0.05, 1, 0.05);
  move.number(tuning, 'wallJumpUp', 0, 15, 0.1);
  move.number(tuning, 'wallJumpPush', 0, 15, 0.1);
  move.number(tuning, 'wallJumpBoost', 0, 10, 0.1);
  move.number(tuning, 'wallJumpsMax', 0, 10, 1);
  move.number(tuning, 'wallJumpCooldown', 0, 1, 0.05);
  move.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Weapon ---
  const gun = panel.folder('Revolver (src/sim/config.ts + render/weapons/viewmodel.ts)');
  gun.number(tuning, 'revolverFireInterval', 0.05, 1, 0.01);
  gun.number(tuning, 'revolverFireBuffer', 0, 0.3, 0.01);
  gun.number(tuning, 'revolverReloadTime', 0.2, 3, 0.05);
  gun.number(tuning, 'revolverAmmo', 1, 12, 1);
  gun.number(viewmodelSettings, 'fov', 30, 100, 1);
  gun.number(viewmodelSettings, 'x', -0.3, 0.3, 0.005);
  gun.number(viewmodelSettings, 'y', -0.3, 0.1, 0.005);
  gun.number(viewmodelSettings, 'z', -0.6, -0.1, 0.005);
  gun.number(viewmodelSettings, 'recoil', 0, 1.5, 0.05);
  gun.number(viewmodelSettings, 'recoilRecovery', 2, 30, 0.5);
  gun.number(viewmodelSettings, 'viewKick', 0, 0.1, 0.005);
  gun.number(viewmodelSettings, 'sway', 0, 2, 0.05);
  gun.number(viewmodelSettings, 'bob', 0, 0.04, 0.001);
  gun.number(viewmodelSettings, 'fanDuration', 0.05, 0.6, 0.01);
  gun.number(sfxSettings, 'volume', 0, 1, 0.05);
  gun.button('Copy viewmodel values', () => copyToClipboard(toSource(viewmodelSettings)));

  // --- Ghouls ---
  const ghoul = panel.folder('Ghoul (src/sim/config.ts)');
  ghoul.boolean(tuning, 'wavesEnabled');
  ghoul.number(tuning, 'waveBaseCount', 1, 30, 1);
  ghoul.number(tuning, 'waveMaxAliveCap', 1, 60, 1);
  ghoul.number(tuning, 'waveHealthPerWave', 0, 100, 5);
  ghoul.number(tuning, 'waveBreak', 0, 30, 0.5);
  ghoul.number(tuning, 'ghoulRunnerSpeed', 1, 12, 0.1);
  ghoul.number(tuning, 'ghoulSpeed', 0.5, 10, 0.1);
  ghoul.number(tuning, 'ghoulAccel', 1, 20, 0.5);
  ghoul.number(tuning, 'ghoulHealth', 10, 500, 5);
  ghoul.number(tuning, 'ghoulJumpHeight', 0, 2, 0.05);
  ghoul.number(tuning, 'ghoulSeparation', 0, 3, 0.05);
  ghoul.number(tuning, 'ghoulAttackRange', 0.5, 3, 0.05);
  ghoul.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Camera feel ---
  const feel = panel.folder('Camera feel (src/render/cameraFeel.ts)');
  feel.number(cameraFeelSettings, 'baseFov', 50, 110, 1);
  feel.number(cameraFeelSettings, 'speedFovExtra', 0, 40, 1);
  feel.number(cameraFeelSettings, 'speedFovStart', 0, 20, 0.5);
  feel.number(cameraFeelSettings, 'speedFovFull', 1, 40, 0.5);
  feel.number(cameraFeelSettings, 'strafeRoll', 0, 6, 0.1);
  feel.number(cameraFeelSettings, 'slideRoll', 0, 10, 0.1);
  feel.number(cameraFeelSettings, 'fovRate', 1, 30, 0.5);
  feel.number(cameraFeelSettings, 'rollRate', 1, 30, 0.5);
  feel.number(cameraFeelSettings, 'eyeRate', 1, 40, 0.5);
  feel.button('Copy values', () => copyToClipboard(toSource(cameraFeelSettings)));

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
