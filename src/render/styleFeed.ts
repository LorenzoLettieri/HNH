// The style feed: under the style meter, a short list of the stylish actions
// you just did and what they were worth ("HEADSHOT +30"). The simulation
// decides the actions and the points (src/sim/style.ts, 'styleAward' events);
// here we only show them.
//
// Each line is a <div> that lives for a moment: it SLAMS in from the right
// (CSS animation .feed-in), stays for LINE_LIFE seconds, then slides away
// (.feed-out) and is removed. The newest line is on top and pushes the others
// down. The same action again while its line is still on screen doesn't add a
// line: it adds up ("COLPO ×3 +15") and the number pops, so a shotgun blast or
// a fast streak doesn't flood the screen.
// Markup and CSS in index.html (#style-feed, .feed-line).
import type { SimEvent } from '../sim/events';
import type { StyleAward } from '../sim/style';

/**
 * The name on screen of each action. Record<StyleAward, …>: a new action in
 * style.ts without a name here is a compile error.
 * `minor` = small stuff (every hit): dimmer and smaller, so the big ones stand out.
 * `name` can be a function of the award's `count` (how many kills in a streak...).
 */
interface AwardLook {
  name: string | ((count: number) => string);
  minor?: boolean;
  /** Continuous (speed): repeats add up the points, without "×n". */
  plain?: boolean;
}
const STYLE_AWARD_NAMES: Record<StyleAward, AwardLook> = {
  hit: { name: 'COLPO', minor: true },
  kill: { name: 'UCCISIONE' },
  headshot: { name: 'HEADSHOT' },
  pupil: { name: "NELL'OCCHIO" },
  matador: { name: 'MATADOR' },
  airKill: { name: 'DAL CIELO' },
  slideKill: { name: 'IN SCIVOLATA' },
  kickKill: { name: 'KUNG FU' },
  shovelKill: { name: 'BONK' },
  lassoKill: { name: 'YEEHAW' },
  quickSwitch: { name: 'CAMBIO LAMPO' },
  quickscope: { name: 'QUICKSCOPE' },
  noscope: { name: 'NOSCOPE' },
  pointBlank: { name: 'A BRUCIAPELO' },
  longShot: { name: 'DA LONTANO' },
  lastRound: { name: 'ULTIMO COLPO' },
  closeCall: { name: 'PER UN PELO' },
  multiKill: { name: (n) => (n === 2 ? 'DUE PICCIONI' : `STRAGE ×${n}`) },
  streak: { name: (n) => STREAK_NAMES[n - 2] ?? `MASSACRO ×${n}` },
  speed: { name: 'VELOCITÀ', minor: true, plain: true },
  airTime: { name: (tenths) => `IN VOLO ${(tenths / 10).toFixed(1).replace('.', ',')} s` },
  wallJump: { name: (n) => (n > 1 ? `WALL JUMP ×${n}` : 'WALL JUMP') },
  bhop: { name: (n) => (n > 1 ? `BHOP ×${n}` : 'BHOP'), minor: true },
  slideJump: { name: 'SLIDE JUMP', minor: true },
  vent: { name: 'UIIII', minor: true },
  grapple: { name: 'AL LAZO', minor: true },
  nearMiss: { name: 'PER UN PELO' },
  torero: { name: 'OLÉ!' },
};
/** Kills in quick sequence: the name for 2, 3, 4, 5 kills; then MASSACRO ×n. */
const STREAK_NAMES = ['DOPPIA', 'TRIPLA', 'QUADRUPLA', 'CINQUINA'];

function awardName(award: StyleAward, count: number): string {
  const { name } = STYLE_AWARD_NAMES[award];
  return typeof name === 'string' ? name : name(count);
}

/** Seconds a line stays on screen (each repeat of the same action restarts it). */
const LINE_LIFE = 1.4;
/** Seconds of the exit animation (must match .feed-out in index.html). */
const OUT_TIME = 0.25;
/** At most this many lines: a new one pushes the oldest out at once. */
const MAX_LINES = 6;

interface Line {
  el: HTMLElement;
  name: HTMLElement;
  points: HTMLElement;
  /** The award has its own count (a streak): the name changes, no "×n". */
  counted: boolean;
  award: StyleAward;
  count: number;
  total: number;
  /** Seconds left before it starts leaving. */
  life: number;
  leaving: boolean;
}

const feed = document.getElementById('style-feed')!;
const lines: Line[] = []; // newest first

/** Same trick as hud.ts: remove the class, force a layout, add it back = the animation plays again. */
function restart(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function pointsText(line: Line): string {
  return line.count > 1 && !line.counted ? `×${line.count} +${line.total}` : `+${line.total}`;
}

function leave(line: Line): void {
  if (line.leaving) return;
  line.leaving = true;
  line.el.classList.add('feed-out');
  // Removed when the exit animation is over. (A timer, not 'animationend':
  // with the tab in the background animations may not run, the timer does.)
  setTimeout(() => line.el.remove(), OUT_TIME * 1000);
}

function add(award: StyleAward, points: number, count: number | undefined): void {
  // The same action as a line still on screen: add it up there (it doesn't
  // move: the lines keep their order, only the numbers change and pop).
  const same = lines.find((l) => l.award === award && !l.leaving);
  if (same) {
    same.total += points;
    same.life = LINE_LIFE;
    if (count === undefined) same.count++;
    else {
      // A streak going on: DOPPIA becomes TRIPLA, the whole line pops.
      same.count = count;
      same.name.textContent = awardName(award, count);
      restart(same.el, 'feed-pop');
    }
    same.points.textContent = pointsText(same);
    restart(same.points, 'feed-pop');
    return;
  }

  const look = STYLE_AWARD_NAMES[award];
  const el = document.createElement('div');
  el.className = 'feed-line feed-in' + (look.minor ? ' minor' : '');
  const name = document.createElement('span');
  name.className = 'feed-name';
  name.textContent = awardName(award, count ?? 1);
  const pts = document.createElement('span');
  pts.className = 'feed-points';
  el.append(name, pts);
  feed.prepend(el); // newest on top

  const line: Line = {
    el,
    name,
    points: pts,
    counted: count !== undefined || look.plain === true,
    award,
    count: count ?? 1,
    total: points,
    life: LINE_LIFE,
    leaving: false,
  };
  pts.textContent = pointsText(line);
  lines.unshift(line);

  // Too many: the oldest still-visible ones leave right away.
  let visible = 0;
  for (const l of lines) {
    if (l.leaving) continue;
    if (++visible > MAX_LINES) leave(l);
  }
}

export function updateStyleFeed(events: SimEvent[], dt: number): void {
  for (const e of events) {
    if (e.type === 'styleAward') add(e.award, e.points, e.count);
    // Dead, or the climax is over: the style starts from zero, so does the list.
    if (e.type === 'playerDied' || e.type === 'highNoonEnd') for (const l of lines) leave(l);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    l.life -= dt;
    if (l.life <= 0) leave(l);
    if (l.leaving) lines.splice(i, 1); // the element removes itself when its animation is over
  }
}
