// Player settings (the "Impostazioni" menu): values the player chooses,
// saved in the browser's localStorage so they survive a page reload.
// Mouse: sensitivity. Audio: volume, ear ringing, muffled world when hit.
// Video (the "Video" page): resolution, retro colors, brightness, fog, FOV,
// and the comfort options (shakes, flashes, speed FOV, view roll, crosshair):
// accessibility, for who can't see well in the dark or with big pixels, or
// gets motion sick. Leaderboard: the name your scores are saved under.
//
// Every change goes through set(), which applies it to the system that uses
// it and saves everything. The menu (menu.ts) only calls set() and reads
// `settings` back.
import { controlSettings } from './controls';
import { setVolume, sfxSettings } from './audio/sfx';
import { cleanName } from './leaderboard';
import { randomName } from './randomName';
import { postSettings } from './render/postprocess';
import { cameraFeelSettings } from './render/cameraFeel';
import { CROSSHAIR_COLORS, type CrosshairColor, videoChanged, videoSettings } from './render/videoSettings';

/** localStorage key. One JSON object holds all the settings. */
const STORAGE_KEY = 'hnh.settings';

// Sensitivity uses the same scale as Quake / Counter-Strike: one mouse
// "count" (the smallest step the mouse reports) turns the view by
// sensitivity × 0.022 degrees. So your CS/Quake value feels the same here
// (with the same mouse DPI: we read raw input, without OS acceleration).
const DEGREES_PER_COUNT = 0.022;

export const SENSITIVITY_MIN = 0.1;
export const SENSITIVITY_MAX = 20;

/**
 * Resolutions the menu offers: rows of the low-res image (postprocess.ts).
 * 0 = the screen's full resolution, no pixel art. 270 is the game's look;
 * the others keep the pixels but make them smaller (405 = 1.5×, 540 = 2×, 720).
 */
export const RESOLUTIONS = [270, 405, 540, 720, 0] as const;

/** Ranges of the number settings: [min, max]. The menu's sliders use the same. */
export const RANGES = {
  sensitivity: [SENSITIVITY_MIN, SENSITIVITY_MAX],
  volume: [0, 100],
  brightness: [50, 200],
  fog: [25, 100],
  fov: [60, 110],
  shake: [0, 100],
  flashes: [0, 100],
  crosshairSize: [1, 3],
} as const;

export const settings = {
  /** Mouse sensitivity, Quake/CS scale. 5.2 ≈ the old fixed value (0.002 rad/px). */
  sensitivity: 5.2,
  /** Master volume, 0..100 as shown in the menu (see volumeToGain). */
  volume: 70,
  /** Ringing in the ears after hard hits. */
  earRinging: true,
  /** The world goes muffled for a moment when you get hit. */
  hitMuffle: true,
  /** Name on the leaderboard. Never empty after loadSettings: no name = a random one (randomName.ts). */
  playerName: '',

  // --- Video ---
  /** Rows of the pixel-art image (one of RESOLUTIONS; 0 = full resolution). */
  resolution: 270 as number,
  /** Retro colors: few shades per channel and dithering. */
  colorReduction: true,
  /** Brightness, %: 100 = as designed, 200 = the darks come up a lot (a gamma curve, postprocess.ts). */
  brightness: 100,
  /** Fog, %: 100 = as designed, 25 = you see 4× farther. */
  fog: 100,
  /** Vertical field of view, degrees. */
  fov: 75,
  /** Camera shakes (hits, explosions, shots, landings), %. */
  shake: 100,
  /** Full-screen flashes (hits, pickups, HIGH NOON), %. */
  flashes: 100,
  /** The FOV widens at high speed. */
  speedFov: true,
  /** The view tilts when strafing and sliding. */
  viewRoll: true,
  crosshairColor: 'warm' as CrosshairColor,
  crosshairSize: 1,
  crosshairOutline: false,
};
export type Settings = typeof settings;

/** The defaults, copied before anything saved is loaded (for "Ripristina"). */
const DEFAULTS: Settings = { ...settings };

/** The settings of the Video page, for its "Ripristina" button. */
const VIDEO_KEYS = [
  'resolution', 'colorReduction', 'brightness', 'fog', 'fov', 'shake', 'flashes',
  'speedFov', 'viewRoll', 'crosshairColor', 'crosshairSize', 'crosshairOutline',
] as const satisfies readonly (keyof Settings)[];

/** Puts every video setting back to its default (and saves). */
export function resetVideo(): void {
  for (const key of VIDEO_KEYS) (settings[key] as Settings[typeof key]) = DEFAULTS[key];
  set('fov', DEFAULTS.fov); // set() applies and saves everything
}

/**
 * Menu value 0..100 → gain 0..1. Not linear: we hear loudness on a roughly
 * logarithmic scale, so with a linear slider the whole upper half would sound
 * almost the same and all the change would be squeezed at the bottom.
 * Squaring is the usual cheap approximation (70 → 0.49, about the old 0.5).
 */
function volumeToGain(volume: number): number {
  return (volume / 100) ** 2;
}

/** Copies the settings into the systems that use them. */
function apply(): void {
  const degreesPerCount = settings.sensitivity * DEGREES_PER_COUNT;
  controlSettings.mouseSensitivity = degreesPerCount * (Math.PI / 180); // the view math works in radians
  setVolume(volumeToGain(settings.volume));
  sfxSettings.earRinging = settings.earRinging;
  sfxSettings.hitMuffle = settings.hitMuffle;

  postSettings.pixelArt = settings.resolution > 0;
  if (settings.resolution > 0) postSettings.pixelHeight = settings.resolution;
  postSettings.colorReduction = settings.colorReduction;
  postSettings.gamma = settings.brightness / 100;
  cameraFeelSettings.baseFov = settings.fov;
  videoSettings.fog = settings.fog / 100;
  videoSettings.shake = settings.shake / 100;
  videoSettings.flashes = settings.flashes / 100;
  videoSettings.speedFov = settings.speedFov;
  videoSettings.viewRoll = settings.viewRoll;
  videoSettings.crosshairColor = settings.crosshairColor;
  videoSettings.crosshairSize = settings.crosshairSize;
  videoSettings.crosshairOutline = settings.crosshairOutline;
  videoChanged(); // the ones drawn only on a change: fog, crosshair
}

/** Keeps a value valid: numbers in range, booleans as booleans, names cleaned. */
function clean<K extends keyof Settings>(key: K, value: unknown): Settings[K] | undefined {
  const fallback = settings[key];
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? (value as Settings[K]) : undefined;
  if (key === 'crosshairColor') return typeof value === 'string' && value in CROSSHAIR_COLORS ? (value as Settings[K]) : undefined;
  if (typeof fallback === 'string') {
    if (typeof value !== 'string') return undefined;
    // An empty name means "pick one for me" (set() draws it), anything else
    // goes through the same cleaning the leaderboard applies.
    return (value.trim() === '' ? '' : cleanName(value)) as Settings[K];
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  // A list of choices: only those (an old or hand-edited value falls back to the default).
  if (key === 'resolution') return (RESOLUTIONS as readonly number[]).includes(n) ? (n as Settings[K]) : undefined;
  const [min, max] = RANGES[key as keyof typeof RANGES];
  const clamped = Math.min(max, Math.max(min, n));
  // Sensitivity keeps its decimals, the rest are whole numbers.
  return (key === 'sensitivity' ? clamped : Math.round(clamped)) as Settings[K];
}

/** Reads the saved settings (if any) and applies them. Call once at startup. */
export function loadSettings(): void {
  // localStorage can throw (private mode, storage disabled) and the saved
  // text can be anything (old version, edited by hand): trust nothing.
  // Each key is checked on its own: a missing or broken one keeps its default,
  // so adding a new setting doesn't throw away the ones saved before it.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof saved === 'object' && saved !== null) {
      for (const key of Object.keys(settings) as (keyof Settings)[]) {
        if (!(key in saved)) continue;
        const value = clean(key, (saved as Record<string, unknown>)[key]);
        if (value !== undefined) (settings[key] as Settings[typeof key]) = value;
      }
    }
  } catch {
    // Nothing usable saved: keep the defaults.
  }
  apply();
  // No name yet (first visit, or saved back when nameless players were all
  // "Pistolero"): draw one now and SAVE it, so every game goes on the same row.
  if (settings.playerName === '') set('playerName', '');
}

/** Changes one setting, applies it right away and saves them all. */
export function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  let v = clean(key, value);
  if (v === undefined) return;
  // Emptying the name box = a new random name (a free "reroll").
  if (key === 'playerName' && v === '') v = randomName() as Settings[K];
  settings[key] = v;
  apply();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Can't save (e.g. private mode): the value still works until reload.
  }
}
