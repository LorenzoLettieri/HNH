// The style meter on screen (src/sim/style.ts has the logic): on the right side,
// the rank letter, the rank's name and a bar with the progress towards the
// next rank. Markup and CSS are in index.html; from here we only change CSS
// variables (the colors of the rank), text and transforms.
import { tuning } from '../sim/config';
import { STYLE_RANKS, styleRank, type StyleState } from '../sim/style';
import './fonts'; // the letters are written in Rye

interface RankLook {
  /** Vertical gradient of the letter and of the bar: light on top, dark at the bottom. */
  top: string;
  mid: string;
  bottom: string;
  /** Radius of the halo around the letter, px (0 = none). */
  glow: number;
}

/**
 * The look of each rank, same order as STYLE_RANKS. The colors are those of
 * metal heating up in a forge: cold ash grey, then dull red, red, orange,
 * yellow and finally white-hot at HIGH NOON (the sun at its zenith).
 * Keyed by letter: the type is built from STYLE_RANKS ('D' | 'C' | … | 'HN'),
 * so adding a rank there without a look here is a compile error.
 */
type RankLetter = (typeof STYLE_RANKS)[number]['letter'];
const RANK_LOOKS: Record<RankLetter, RankLook> = {
  D: { top: '#d8d0c4', mid: '#8a8076', bottom: '#463e38', glow: 0 }, // Dusty: cold
  C: { top: '#f0a07c', mid: '#b8482a', bottom: '#521608', glow: 3 }, // Cowpoke: dull red
  B: { top: '#ffa070', mid: '#e03c18', bottom: '#701006', glow: 6 }, // Bandit: red-hot
  A: { top: '#ffd49a', mid: '#f47420', bottom: '#8c2a08', glow: 9 }, // Desperado: orange
  S: { top: '#fff2b8', mid: '#f8bc34', bottom: '#a65410', glow: 12 }, // Sharpshooter: yellow
  SS: { top: '#ffffff', mid: '#ffe27a', bottom: '#e88a22', glow: 15 }, // Showdown: pale yellow
  HN: { top: '#ffffff', mid: '#fff6dc', bottom: '#ffc04a', glow: 20 }, // HIGH NOON: white-hot
};

// --- Animation tuning ---
/** Seconds of the "stamp" when a chain starts or you reach a new rank. */
const STAMP_TIME = 0.22;
/** How much bigger the letter is at the start of the stamp (0.9 = 190%). */
const STAMP_SCALE = 0.9;
/** Rotation at the start of the stamp, degrees. */
const STAMP_TILT = -12;
/** Seconds and strength (px) of the shake when damage costs you a rank. */
const SHAKE_TIME = 0.35;
const SHAKE_PX = 7;
/** Fade speeds of the whole meter, in "opacity per second". */
const FADE_IN = 12;
const FADE_OUT = 2.5;
/** How fast the bar catches up with the real value (higher = snappier). */
const BAR_SPEED = 15;
/** HIGH NOON: the glow pulses, how much (fraction of its radius) and how fast (Hz). */
const HIGH_NOON_PULSE = 0.4;
const HIGH_NOON_PULSE_HZ = 3;

const meter = document.getElementById('style-meter')!;
const letter = document.getElementById('style-letter')!;
const rankName = document.getElementById('style-name')!;
const barFill = document.getElementById('style-bar-fill')!;

/** The rank on screen. Not always the real one: it stays put while the meter fades out after the chain breaks. */
let shownRank = 0;
let wasActive = false;
let opacity = 0;
let stamp = 0; // 1 → 0 during the stamp
let shake = 0; // 1 → 0 during the shake
let progress = 0; // the bar on screen, 0..1, follows the real value
let clock = 0; // seconds, for the HIGH NOON pulse

/** Changes the rank on screen: text and colors. Only called when the rank changes, not every frame. */
function showRank(rank: number): void {
  shownRank = rank;
  const { letter: text, name } = STYLE_RANKS[rank];
  const look = RANK_LOOKS[text];
  letter.textContent = text;
  rankName.textContent = name.toUpperCase();
  meter.style.setProperty('--top', look.top);
  meter.style.setProperty('--mid', look.mid);
  meter.style.setProperty('--bottom', look.bottom);
  meter.style.setProperty('--glow', `${look.glow}px`);
}

export function updateStyleMeter(style: StyleState, dt: number): void {
  clock += dt;
  const lastRank = STYLE_RANKS.length - 1;
  const active = style.chainTicks > 0;

  if (active) {
    const rank = styleRank(style.points);
    if (!wasActive || rank > shownRank) {
      // A new chain, or a new rank: stamp it on screen, the bar starts from empty.
      stamp = 1;
      progress = 0;
      showRank(rank);
    } else if (rank < shownRank) {
      // Damage cost you a rank: the letter shakes, the bar starts from full.
      shake = 1;
      progress = 1;
      showRank(rank);
    }
    // Progress inside the current rank: 0 = just reached, 1 = next rank. Full at the top rank.
    const target = rank === lastRank ? 1 : style.points / tuning.styleRankPoints - rank;
    // Exponential smoothing: every frame cover a fraction of the remaining distance.
    progress += (target - progress) * Math.min(1, dt * BAR_SPEED);
  }
  wasActive = active;

  // Fade in quickly when a chain starts, fade out slower when it breaks.
  opacity = active ? Math.min(1, opacity + dt * FADE_IN) : Math.max(0, opacity - dt * FADE_OUT);
  meter.style.opacity = String(opacity);

  // The stamp: `stamp` goes down linearly, but the size follows 2s - s², which
  // changes slowly at first and fastest at the end: the letter hovers, then
  // slams down onto the screen.
  stamp = Math.max(0, stamp - dt / STAMP_TIME);
  const slam = 2 * stamp - stamp * stamp;
  shake = Math.max(0, shake - dt / SHAKE_TIME);
  const dx = (Math.random() * 2 - 1) * SHAKE_PX * shake;
  const dy = (Math.random() * 2 - 1) * SHAKE_PX * shake;
  letter.style.transform =
    `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) ` +
    `scale(${(1 + STAMP_SCALE * slam).toFixed(3)}) rotate(${(STAMP_TILT * slam).toFixed(1)}deg)`;
  barFill.style.transform = `scaleX(${progress.toFixed(3)})`;

  // HIGH NOON: the white-hot glow breathes.
  if (shownRank === lastRank) {
    const pulse = 1 + HIGH_NOON_PULSE * Math.sin(clock * HIGH_NOON_PULSE_HZ * Math.PI * 2);
    meter.style.setProperty('--glow', `${(RANK_LOOKS.HN.glow * pulse).toFixed(1)}px`);
  }
}
