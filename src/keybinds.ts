// Key bindings: which physical keys (or mouse buttons) do each ACTION.
//
// Until now controls.ts asked "is W down?". Now it asks "is the 'forward'
// action down?", and this file answers by looking up which keys are bound to
// it. It's one level of indirection, the same idea as a route name in
// Laravel: the code says route('shop'), the URL behind it can change.
//
// Keys are KeyboardEvent.code values ("KeyW", "Space", "ShiftLeft"): the
// PHYSICAL position on the keyboard, not the letter printed on it. So WASD
// stays in the same place on an AZERTY keyboard (where it reads ZQSD).
// Mouse buttons and the wheel use the names input.ts gives them: "Mouse0"
// (left), "Mouse2" (right), "WheelUp", "WheelDown".
//
// Every action can have more than one key (crouch = Shift OR C).
// Saved in localStorage under its own key: only the actions you changed
// would matter, but saving them all is simpler and the object is tiny.
import { isKeyDown, wasPressed } from './input';

/** The menu's sections (the headings of the Comandi page, in this order). */
export const GROUPS = ['Movimento', 'Combattimento', 'Armi', 'Gioco'] as const;

/**
 * Every rebindable action: its default keys, the name shown in the menu, its
 * section, an optional note. `keyboardOnly`: main.ts handles it in a keydown
 * listener, which never sees the mouse, so a mouse button can't be bound to it
 * (and a click in the shop's panel must not close the shop).
 */
export const ACTIONS = {
  forward: { label: 'Avanti', group: 'Movimento', keys: ['KeyW'] },
  back: { label: 'Indietro', group: 'Movimento', keys: ['KeyS'] },
  left: { label: 'Sinistra', group: 'Movimento', keys: ['KeyA'] },
  right: { label: 'Destra', group: 'Movimento', keys: ['KeyD'] },
  jump: { label: 'Salta', group: 'Movimento', keys: ['Space'], note: 'in aria vicino a un muro: wall jump' },
  crouch: { label: 'Accovacciati', group: 'Movimento', keys: ['ShiftLeft', 'KeyC'], note: 'in corsa: slide' },
  fire: { label: 'Spara', group: 'Combattimento', keys: ['Mouse0'] },
  altFire: {
    label: 'Fuoco alternativo',
    group: 'Combattimento',
    keys: ['Mouse2'],
    note: 'tieni premuto · revolver: fanning · carabina: mira',
  },
  reload: { label: 'Ricarica', group: 'Combattimento', keys: ['KeyR'] },
  kick: { label: 'Calcio', group: 'Combattimento', keys: ['KeyF'], note: 'col badile, se l’hai comprato' },
  weapon1: { label: 'Revolver', group: 'Armi', keys: ['Digit1'] },
  weapon2: { label: 'Doppietta', group: 'Armi', keys: ['Digit2'] },
  weapon3: { label: 'Carabina a leva', group: 'Armi', keys: ['Digit3'] },
  weapon4: { label: 'Lancia-dinamite', group: 'Armi', keys: ['Digit4'] },
  nextWeapon: { label: 'Arma successiva', group: 'Armi', keys: ['KeyQ', 'WheelDown'] },
  prevWeapon: { label: 'Arma precedente', group: 'Armi', keys: ['WheelUp'] },
  interact: {
    label: 'Interagisci',
    group: 'Gioco',
    keys: ['KeyE'],
    note: 'vicino a un bancone: apri/chiudi · tra un’ondata e l’altra: inizia subito · solo tastiera',
    keyboardOnly: true,
  },
  map: { label: 'Mappa', group: 'Gioco', keys: ['Tab'], note: 'tieni premuto' },
} satisfies Record<string, ActionInfo>;
export type Action = keyof typeof ACTIONS;

/** One action's definition with every optional field (note, keyboardOnly) visible to TypeScript. */
export interface ActionInfo {
  label: string;
  group: (typeof GROUPS)[number];
  keys: string[];
  note?: string;
  keyboardOnly?: boolean;
}
export function actionInfo(action: Action): ActionInfo {
  return ACTIONS[action];
}

/** localStorage key (the other settings are in 'hnh.settings', settings.ts). */
const STORAGE_KEY = 'hnh.keys';

/** Keys per action in the menu: a main one and a second one (crouch = Shift OR C). */
export const SLOTS = 2;

/** Keys nobody can take: Esc (pause, and it cancels "press a key…") and the debug panel's key. */
export const RESERVED = ['Escape', 'Backquote'];

/** A fresh copy of the default keys (a copy: the menu edits the arrays). */
function defaults(): Record<Action, string[]> {
  return Object.fromEntries(Object.entries(ACTIONS).map(([action, def]) => [action, [...def.keys]])) as Record<
    Action,
    string[]
  >;
}

/** The current bindings: starts as the defaults, loadKeybinds() overwrites it. */
export const bindings = defaults();

/** Who wants to know when a key changes (the shop's "E · COMMERCIA" label). */
const listeners: (() => void)[] = [];
export function onKeybindsChange(fn: () => void): void {
  listeners.push(fn);
}
function changed(): void {
  saveKeybinds();
  for (const fn of listeners) fn();
}

/** Can this key go on this action? A reason why not, or null. */
export function bindRefusal(action: Action, code: string): string | null {
  if (RESERVED.includes(code)) return 'Tasto riservato';
  if (actionInfo(action).keyboardOnly && (code.startsWith('Mouse') || code.startsWith('Wheel'))) return 'Solo tasti della tastiera';
  return null;
}

/**
 * Puts `code` in slot `slot` of the action. A key does ONE thing: if another
 * action had it, it loses it (its other key stays). Returns the actions that
 * lost it, so the menu can say so.
 */
export function bindKey(action: Action, slot: number, code: string): Action[] {
  const lost: Action[] = [];
  for (const other of Object.keys(bindings) as Action[]) {
    if (other === action || !bindings[other].includes(code)) continue;
    bindings[other] = bindings[other].filter((k) => k !== code);
    lost.push(other);
  }
  // The same key already in the action's other slot: move it, don't double it.
  const keys = bindings[action].filter((k) => k !== code);
  // A slot past the end (the second key of an action that has one): it goes last.
  if (slot < keys.length) keys[slot] = code;
  else keys.push(code);
  bindings[action] = keys.slice(0, SLOTS);
  changed();
  return lost;
}

/** Empties one slot of the action (the menu: right click on a key). */
export function clearKey(action: Action, slot: number): void {
  bindings[action] = bindings[action].filter((_, i) => i !== slot);
  changed();
}

/** Back to the default keys for everything. */
export function resetKeybinds(): void {
  Object.assign(bindings, defaults());
  changed();
}

// --- Key names --------------------------------------------------------------
// KeyboardEvent.code is the POSITION ("KeyW"), not what's printed on it. To
// show the real letter, Chrome and Edge can tell us the layout of the
// keyboard (Keyboard API: getLayoutMap, code → character: on AZERTY "KeyW" →
// "z"). Other browsers don't: there we show the QWERTY name, still right for
// most keyboards.
let layout: Map<string, string> | null = null;
interface KeyboardWithLayout {
  getLayoutMap?: () => Promise<Map<string, string>>;
}
/** Asks the browser for the keyboard layout (once, at startup); then tells the listeners. */
export async function loadKeyNames(): Promise<void> {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
  try {
    layout = (await keyboard?.getLayoutMap?.()) ?? null;
  } catch {
    layout = null; // e.g. inside an iframe it's refused
  }
  if (layout) for (const fn of listeners) fn();
}

/** Names for the keys without a printed character. */
const NAMES: Record<string, string> = {
  Space: 'Spazio',
  Escape: 'Esc',
  Backquote: 'tasto sotto Esc',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift destro',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl destro',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  MetaLeft: 'Win',
  MetaRight: 'Win destro',
  Tab: 'Tab',
  CapsLock: 'Bloc Maiusc',
  Enter: 'Invio',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'Click sinistro',
  Mouse1: 'Click centrale',
  Mouse2: 'Click destro',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  WheelUp: 'Rotellina su',
  WheelDown: 'Rotellina giù',
};

/** What to write on the key in the menu and on screen ("KeyW" → "W"). */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  const printed = layout?.get(code);
  if (printed) return printed.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3); // KeyW → W
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 → 1
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Mouse')) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code; // F1..F12, Home, PageUp...: the code is already readable
}

/** The action's main key, for labels like "E · COMMERCIA" ("—" if it has none). */
export function mainKeyName(action: Action): string {
  const code = bindings[action][0];
  return code ? keyName(code) : '—';
}

/** Is any key of the action held down right now? (crouch, aim: things you hold) */
export function actionDown(action: Action): boolean {
  return bindings[action].some(isKeyDown);
}

/**
 * Was any key of the action pressed since the last tick? (weapon switch:
 * one press = one switch.) Asks EVERY key, not just until the first "yes":
 * wasPressed also forgets the press, and a press left behind on the second
 * key would fire the action again on the next tick.
 */
export function actionPressed(action: Action): boolean {
  let pressed = false;
  for (const code of bindings[action]) if (wasPressed(code)) pressed = true;
  return pressed;
}

/** "Held OR pressed since the last tick": a tap shorter than a tick still counts (jump, fire). */
export function actionActive(action: Action): boolean {
  const pressed = actionPressed(action); // first, so it's always consumed
  return pressed || actionDown(action);
}

/** Is this key (from a keydown event) bound to the action? For the keys main.ts handles itself (E, Tab). */
export function isBound(action: Action, code: string): boolean {
  return bindings[action].includes(code);
}

/** Reads the saved bindings, if any. Call once at startup. */
export function loadKeybinds(): void {
  // Trust nothing (as in settings.ts): each action on its own, a broken or
  // missing one keeps its defaults, so a new action added later just works.
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof saved !== 'object' || saved === null) return;
    for (const action of Object.keys(ACTIONS) as Action[]) {
      const keys = (saved as Record<string, unknown>)[action];
      if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) continue;
      bindings[action] = keys.filter((k) => bindRefusal(action, k) === null).slice(0, SLOTS);
    }
  } catch {
    // Nothing usable saved: keep the defaults.
  }
}

/** Saves the current bindings (the menu calls it after every change). */
export function saveKeybinds(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Can't save (private mode): the bindings still work until reload.
  }
}
