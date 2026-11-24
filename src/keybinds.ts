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

/** Every rebindable action, with its default keys and the name shown in the menu. */
export const ACTIONS = {
  forward: { label: 'Avanti', keys: ['KeyW'] },
  back: { label: 'Indietro', keys: ['KeyS'] },
  left: { label: 'Sinistra', keys: ['KeyA'] },
  right: { label: 'Destra', keys: ['KeyD'] },
  jump: { label: 'Salta', keys: ['Space'] },
  crouch: { label: 'Accovacciati / slide', keys: ['ShiftLeft', 'KeyC'] },
  fire: { label: 'Spara', keys: ['Mouse0'] },
  altFire: { label: 'Fuoco alternativo', keys: ['Mouse2'] },
  reload: { label: 'Ricarica', keys: ['KeyR'] },
  kick: { label: 'Calcio', keys: ['KeyF'] },
  weapon1: { label: 'Revolver', keys: ['Digit1'] },
  weapon2: { label: 'Doppietta', keys: ['Digit2'] },
  weapon3: { label: 'Carabina', keys: ['Digit3'] },
  weapon4: { label: 'Lancia-dinamite', keys: ['Digit4'] },
  nextWeapon: { label: 'Arma successiva', keys: ['KeyQ', 'WheelDown'] },
  prevWeapon: { label: 'Arma precedente', keys: ['WheelUp'] },
  interact: { label: 'Shop', keys: ['KeyE'] },
  map: { label: 'Mappa (tieni premuto)', keys: ['Tab'] },
} satisfies Record<string, { label: string; keys: string[] }>;
export type Action = keyof typeof ACTIONS;

/** localStorage key (the other settings are in 'hnh.settings', settings.ts). */
const STORAGE_KEY = 'hnh.keys';

/** The current bindings: starts as a copy of the defaults, loadKeybinds() overwrites it. */
export const bindings = Object.fromEntries(
  Object.entries(ACTIONS).map(([action, def]) => [action, [...def.keys]]),
) as Record<Action, string[]>;

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
      if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) bindings[action] = [...keys];
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
