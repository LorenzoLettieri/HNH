// Player settings (the "Impostazioni" menu): values the player chooses,
// saved in the browser's localStorage so they survive a page reload.
// For now there is only the mouse sensitivity.
import { controlSettings } from './controls';

/** localStorage key. One JSON object holds all the settings. */
const STORAGE_KEY = 'hnh.settings';

// Sensitivity uses the same scale as Quake / Counter-Strike: one mouse
// "count" (the smallest step the mouse reports) turns the view by
// sensitivity × 0.022 degrees. So your CS/Quake value feels the same here
// (with the same mouse DPI: we read raw input, without OS acceleration).
const DEGREES_PER_COUNT = 0.022;

export const SENSITIVITY_MIN = 0.1;
export const SENSITIVITY_MAX = 20;

export const settings = {
  /** Mouse sensitivity, Quake/CS scale. 5.2 ≈ the old fixed value (0.002 rad/px). */
  sensitivity: 5.2,
};

/** Copies the settings into the systems that use them. */
function apply(): void {
  const degreesPerCount = settings.sensitivity * DEGREES_PER_COUNT;
  controlSettings.mouseSensitivity = degreesPerCount * (Math.PI / 180); // the view math works in radians
}

/** Reads the saved settings (if any) and applies them. Call once at startup. */
export function loadSettings(): void {
  // localStorage can throw (private mode, storage disabled) and the saved
  // text can be anything (old version, edited by hand): trust nothing.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof saved === 'object' && saved !== null && 'sensitivity' in saved) {
      const s = Number(saved.sensitivity);
      if (Number.isFinite(s)) settings.sensitivity = clampSensitivity(s);
    }
  } catch {
    // Nothing usable saved: keep the defaults.
  }
  apply();
}

/** Changes the sensitivity, applies it right away and saves it. */
export function setSensitivity(value: number): void {
  settings.sensitivity = clampSensitivity(value);
  apply();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Can't save (e.g. private mode): the value still works until reload.
  }
}

function clampSensitivity(v: number): number {
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v));
}
