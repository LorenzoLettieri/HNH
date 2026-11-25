// The HIGH NOON climax on screen (the mechanic is in src/sim/style.ts).
//
// The screen tint: when the climax starts, a white-hot flash, like looking
// straight into the sun at noon; then, for the whole climax, the picture
// is hot (warm tint) and the borders of the screen burn, pulsing like heat;
// it all fades away at the end. Two layers in index.html (#high-noon-heat,
// #high-noon); from here we only animate their CSS variables.
//
// The sounds: a deep bell and a duel whistle when it starts, for the whole
// climax a canyon echo on every sound, and a hiss of steam when it ends (the
// white-hot letter of the style meter is quenched: see styleMeter.ts).
import { TICK_DT } from '../sim/config';
import type { SimEvent } from '../sim/events';
import { isHighNoon, type StyleState } from '../sim/style';
import { playHighNoon, playQuench, setCanyonEcho } from '../audio/sfx';
import { videoSettings } from './videoSettings';

/** The flash at the start: how long it lasts (s), how strong in the middle and at the borders (0..1). */
const FLASH_TIME = 0.7;
const FLASH_CORE = 0.85;
const FLASH_EDGE = 0.6;
/** During the climax: warm tint of the picture, haze in the middle, burning borders (base ± pulse). */
const HEAT = 0.5;
const HAZE_CORE = 0.04;
const GLOW_EDGE = 0.4;
const GLOW_PULSE = 0.12;
/** Pulses of the burning borders per second. */
const GLOW_HZ = 1.2;
/** Seconds over which the tint fades away at the end of the climax. */
const END_FADE = 0.6;

const heatLayer = document.getElementById('high-noon-heat')!;
const lightLayer = document.getElementById('high-noon')!;
let flash = 0; // 1 → 0 after the climax starts
let clock = 0; // seconds, for the pulse
let echoOn = false;

/** Sets the CSS variables of a layer, or takes it out of the page when it adds nothing. */
function setLayer(layer: HTMLElement, vars: Record<string, number>): void {
  // Nothing to add: hidden, so the browser doesn't blend a full-screen layer every frame for nothing.
  layer.hidden = Object.values(vars).every((v) => v < 0.002);
  if (layer.hidden) return;
  for (const [name, value] of Object.entries(vars)) layer.style.setProperty(name, value.toFixed(3));
}

export function updateHighNoon(style: StyleState, events: readonly SimEvent[], dt: number): void {
  // The echo follows the STATE, not the events: dying mid-climax resets the
  // style with no 'highNoonEnd', and an echo that never turns off would stay
  // for the rest of the game. "Is it HIGH NOON? Then the echo is on" can't get stuck.
  const highNoon = isHighNoon(style);
  if (highNoon !== echoOn) {
    echoOn = highNoon;
    setCanyonEcho(highNoon);
  }
  for (const e of events) {
    if (e.type === 'highNoon') {
      flash = 1;
      playHighNoon();
    }
    if (e.type === 'highNoonEnd') playQuench();
  }
  clock += dt;
  flash = Math.max(0, flash - dt / FLASH_TIME);

  // How much the climax is "on": 1 for the whole climax, down to 0 in its last END_FADE seconds.
  const on = highNoon ? Math.min(1, (style.highNoonTicks * TICK_DT) / END_FADE) : 0;
  const pulse = Math.sin(clock * GLOW_HZ * Math.PI * 2);
  // Squared: it drops fast, then lingers a little. Scaled by the menu's "Lampi a schermo".
  const f = flash * flash * videoSettings.flashes;

  setLayer(heatLayer, { '--heat': HEAT * on });
  setLayer(lightLayer, {
    '--core': HAZE_CORE * on + FLASH_CORE * f,
    '--edge': (GLOW_EDGE + GLOW_PULSE * pulse) * on + FLASH_EDGE * f,
  });
}
