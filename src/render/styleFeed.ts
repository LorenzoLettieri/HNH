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
 */
const STYLE_AWARD_NAMES: Record<StyleAward, { name: string; minor?: boolean }> = {
  hit: { name: 'COLPO', minor: true },
  kill: { name: 'UCCISIONE' },
  headshot: { name: 'HEADSHOT' },
};

/** Seconds a line stays on screen (each repeat of the same action restarts it). */
const LINE_LIFE = 1.4;
/** Seconds of the exit animation (must match .feed-out in index.html). */
const OUT_TIME = 0.25;
/** At most this many lines: a new one pushes the oldest out at once. */
const MAX_LINES = 5;

interface Line {
  el: HTMLElement;
  points: HTMLElement;
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
  return line.count > 1 ? `×${line.count} +${line.total}` : `+${line.total}`;
}

function leave(line: Line): void {
  if (line.leaving) return;
  line.leaving = true;
  line.el.classList.add('feed-out');
  // Removed when the exit animation is over. (A timer, not 'animationend':
  // with the tab in the background animations may not run, the timer does.)
  setTimeout(() => line.el.remove(), OUT_TIME * 1000);
}

function add(award: StyleAward, points: number): void {
  // The same action as the newest line, still on screen: add it up.
  const top = lines[0];
  if (top && top.award === award && !top.leaving) {
    top.count++;
    top.total += points;
    top.life = LINE_LIFE;
    top.points.textContent = pointsText(top);
    restart(top.points, 'feed-pop');
    return;
  }

  const look = STYLE_AWARD_NAMES[award];
  const el = document.createElement('div');
  el.className = 'feed-line feed-in' + (look.minor ? ' minor' : '');
  const name = document.createElement('span');
  name.className = 'feed-name';
  name.textContent = look.name;
  const pts = document.createElement('span');
  pts.className = 'feed-points';
  el.append(name, pts);
  feed.prepend(el); // newest on top

  const line: Line = { el, points: pts, award, count: 1, total: points, life: LINE_LIFE, leaving: false };
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
    if (e.type === 'styleAward') add(e.award, e.points);
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
