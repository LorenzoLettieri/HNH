// Video and comfort settings, rendering side: the values the player picks in
// the menu's "Video" page (settings.ts saves them and writes them here).
// Every renderer that has one of these knobs reads this object, like the
// other *Settings objects; the ones that only redraw on a change (the fog of
// the atmosphere, the crosshair) listen with onVideoChange.
//
// Why a separate object and not settings.ts itself: settings.ts deals with
// what the PLAYER sees in the menu (0..100 %, names of colors), this is what
// the CODE wants (multipliers 0..1, CSS colors). Same split as the volume:
// 70 in the menu, 0.49 of gain in the audio.

/** Crosshair colors the menu offers: name in the menu → CSS color. */
export const CROSSHAIR_COLORS = {
  warm: '#ffe0a0', // the game's default warm white
  white: '#ffffff',
  green: '#40ff40',
  yellow: '#ffff20',
  cyan: '#20ffff',
  magenta: '#ff40ff',
} as const;
export type CrosshairColor = keyof typeof CROSSHAIR_COLORS;

export const videoSettings = {
  /** Fog amount: 1 = as the atmosphere wants, 0.25 = fog distances 4× longer, ground mist 4× thinner. */
  fog: 1,
  /** Every camera shake (hits, explosions, shot punch, landing dip): 1 = normal, 0 = none. */
  shake: 1,
  /** Full-screen flashes (red when hit, colored on pickups, the white of HIGH NOON): 1 = normal, 0 = none. */
  flashes: 1,
  /** The FOV widens at high speed. */
  speedFov: true,
  /** The view tilts when strafing and sliding. */
  viewRoll: true,
  crosshairColor: 'warm' as CrosshairColor,
  /** Crosshair size: 1, 2 or 3 times the pixels. */
  crosshairSize: 1,
  /** A dark outline around the crosshair: readable on bright and dark backgrounds alike. */
  crosshairOutline: false,
};

const listeners: (() => void)[] = [];

/** Calls `fn` every time a video setting changes. */
export function onVideoChange(fn: () => void): void {
  listeners.push(fn);
}

/** settings.ts calls this after writing new values. */
export function videoChanged(): void {
  for (const fn of listeners) fn();
}
