// The relics in the HUD, Risk of Rain style: a row of icons at the top of the
// screen, one per relic you own, in the order you found them, with "×N" in
// the corner once you have more than one. Under the row, a TOAST when the
// coffin gives you one: its name and what a copy does.
//
// It reads only the player's relic counts (src/sim/relics.ts) and the
// 'coffinOpened' events. Markup and CSS in index.html (#relic-bar, #relic-toast).
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { RELICS, type RelicId } from '../sim/relics';
import { relicIconCopy } from './relicIcons';
import { RELIC_TEXT } from './relicText';
import './fonts';

/**
 * Seconds before the toast and the new icon show up: the relic first rises
 * out of the coffin and flies to you (coffin.ts, RISE_TIME + FLY_TIME).
 */
const ARRIVE_DELAY = 1.05;
/** Seconds the toast stays (then it fades, CSS). */
const TOAST_TIME = 3.2;

const bar = document.getElementById('relic-bar')!;
const toast = document.getElementById('relic-toast')!;
const toastName = document.getElementById('relic-toast-name')!;
const toastEffect = document.getElementById('relic-toast-effect')!;
const toastIcon = document.getElementById('relic-toast-icon') as HTMLCanvasElement;

interface Slot {
  el: HTMLElement;
  count: HTMLElement;
  shown: number;
}
/** One slot per relic you have, in the order they came. */
const slots = new Map<RelicId, Slot>();
/** Relics on their way (they're still flying out of the coffin): what and when they "land". */
const arriving: { id: RelicId; count: number; at: number }[] = [];
let clock = 0;
let toastLeft = 0;

export function updateRelicHud(p: PlayerState, events: SimEvent[], dt: number): void {
  clock += dt;
  for (const e of events) {
    if (e.type === 'coffinOpened') arriving.push({ id: e.relic, count: e.count, at: clock + ARRIVE_DELAY });
  }
  // Died while one was flying: it never lands.
  for (let i = arriving.length - 1; i >= 0; i--) if (arriving[i].count > p.relics[arriving[i].id]) arriving.splice(i, 1);
  while (arriving.length > 0 && arriving[0].at <= clock) {
    const a = arriving.shift()!;
    show(a.id, a.count, true);
    showToast(a.id);
  }
  // Died (every count back to 0), or a debug button gave one: follow the
  // player's counts, but never ahead of a relic that's still flying.
  for (const id of RELICS) {
    const flying = arriving.filter((a) => a.id === id).length;
    const target = p.relics[id] - flying;
    const slot = slots.get(id);
    if ((slot?.shown ?? 0) !== target) show(id, target, false);
  }
  if (toastLeft > 0) {
    toastLeft -= dt;
    if (toastLeft <= 0) toast.classList.remove('show');
  }
}

/** Shows `count` copies of a relic (0 = removes its slot). `fresh` = it just arrived: the icon pops. */
function show(id: RelicId, count: number, fresh: boolean): void {
  let slot = slots.get(id);
  if (count <= 0) {
    slot?.el.remove();
    slots.delete(id);
    return;
  }
  if (!slot) {
    const el = document.createElement('div');
    el.className = 'relic';
    el.title = `${RELIC_TEXT[id].name}: ${RELIC_TEXT[id].effect}`;
    const c = document.createElement('span');
    c.className = 'relic-count';
    el.append(relicIconCopy(id), c);
    bar.append(el); // new relics go at the end: the row tells the story of the game
    slot = { el, count: c, shown: 0 };
    slots.set(id, slot);
  }
  slot.shown = count;
  slot.count.textContent = count > 1 ? `×${count}` : '';
  if (fresh) restart(slot.el, 'pop');
}

function showToast(id: RelicId): void {
  toastName.textContent = RELIC_TEXT[id].name;
  toastEffect.textContent = RELIC_TEXT[id].effect;
  const g = toastIcon.getContext('2d')!;
  g.clearRect(0, 0, toastIcon.width, toastIcon.height);
  g.drawImage(relicIconCopy(id), 0, 0);
  toast.classList.add('show');
  restart(toast, 'pop');
  toastLeft = TOAST_TIME;
}

/** Restarts a CSS animation: remove the class, force a layout (offsetWidth), add it back. */
function restart(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
