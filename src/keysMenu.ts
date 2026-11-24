// The menu's "Comandi" page: a table of every action (ACTIONS in keybinds.ts)
// with its keys as buttons. Click one, it starts blinking "premi un tasto…",
// and the next key, mouse button or wheel notch becomes that key.
//
// "Listening" for a key is a tiny state machine: idle → listening(action,
// slot) → idle. While listening we catch the input BEFORE everyone else:
// listeners in the capture phase on window run first (the event travels
// window → document → … → target, then back up), and stopImmediatePropagation
// stops it there. So input.ts doesn't see the key, and an Esc here cancels
// instead of going back to the main menu page (menu.ts).
import {
  ACTIONS,
  GROUPS,
  SLOTS,
  actionInfo,
  bindKey,
  bindRefusal,
  bindings,
  clearKey,
  keyName,
  onKeybindsChange,
  resetKeybinds,
  type Action,
} from './keybinds';

/** How long the note under the table ("Q tolto da …") stays, seconds. */
const NOTE_TIME = 4;

export interface KeysPage {
  /** Stops listening for a key (the menu closes, or you change page). */
  cancel(): void;
}

export function createKeysPage(): KeysPage {
  const table = document.getElementById('keys-table') as HTMLTableElement;
  const note = document.getElementById('keys-note')!;
  const resetButton = document.getElementById('keys-reset')!;

  /** The buttons of every action, by slot. Built once, their text refreshed. */
  const buttons = new Map<Action, HTMLButtonElement[]>();
  let listening: { action: Action; slot: number } | null = null;
  let noteTimer = 0;

  function say(text: string): void {
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (note.textContent = ''), NOTE_TIME * 1000);
  }

  // --- The table ----------------------------------------------------------
  // Built from ACTIONS with createElement + textContent (never HTML strings
  // with data inside, as in shopMenu.ts).
  for (const group of GROUPS) {
    const head = table.insertRow();
    const th = document.createElement('th');
    th.colSpan = 2;
    th.textContent = group;
    head.append(th);
    for (const action of Object.keys(ACTIONS) as Action[]) {
      const info = actionInfo(action);
      if (info.group !== group) continue;
      const row = table.insertRow();
      const keysCell = row.insertCell();
      const nameCell = row.insertCell();
      nameCell.textContent = info.label;
      if (info.note) {
        const small = document.createElement('span');
        small.className = 'action-note';
        small.textContent = info.note;
        nameCell.append(small);
      }
      const slots: HTMLButtonElement[] = [];
      for (let slot = 0; slot < SLOTS; slot++) {
        const button = document.createElement('button');
        button.className = 'bind';
        button.addEventListener('click', () => startListening(action, slot));
        // Right click = remove the key. (Not while listening: then a right
        // click IS the key to bind, and the mousedown handler takes it.)
        button.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (listening) return;
          clearKey(action, slot);
        });
        keysCell.append(button);
        slots.push(button);
      }
      buttons.set(action, slots);
    }
  }

  /** Writes the current keys on the buttons. */
  function refresh(): void {
    for (const [action, slots] of buttons) {
      slots.forEach((button, slot) => {
        const code = bindings[action][slot];
        const isListening = listening?.action === action && listening.slot === slot;
        button.classList.toggle('listening', isListening);
        button.classList.toggle('empty', !code && !isListening);
        button.textContent = isListening ? 'premi un tasto…' : code ? keyName(code) : '—';
      });
    }
  }
  onKeybindsChange(refresh); // after bindKey, clearKey, reset, and when the keyboard layout arrives

  // --- Listening for a key --------------------------------------------------
  function startListening(action: Action, slot: number): void {
    listening = { action, slot };
    refresh();
  }
  function stopListening(): void {
    listening = null;
    refresh();
  }

  /** The key (or button) that arrived while listening. */
  function take(code: string): void {
    if (!listening) return;
    const { action, slot } = listening;
    const refusal = bindRefusal(action, code);
    if (refusal) {
      say(`${refusal}: ${keyName(code)}`);
      return; // still listening: try another key
    }
    listening = null; // before bindKey: its refresh must draw the new key, not "premi un tasto…"
    const lost = bindKey(action, slot, code);
    if (lost.length > 0) {
      say(`${keyName(code)} tolto da: ${lost.map((a) => actionInfo(a).label).join(', ')}`);
    }
    // A quick flash on the button just bound: "done".
    const button = buttons.get(action)![bindings[action].indexOf(code)];
    button?.classList.add('flash');
    window.setTimeout(() => button?.classList.remove('flash'), 200);
  }

  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  window.addEventListener(
    'keydown',
    (e) => {
      if (!listening) return;
      swallow(e); // nobody else sees it: not input.ts, not the menu's Esc
      if (e.repeat) return;
      if (e.code === 'Escape') stopListening();
      else take(e.code);
    },
    { capture: true },
  );
  window.addEventListener(
    'mousedown',
    (e) => {
      if (!listening) return;
      swallow(e);
      take(`Mouse${e.button}`);
      // The click that follows this mousedown would land on whatever button
      // is under the cursor (maybe another key: it would start listening
      // again). Eat that one click too. Only the left button makes a 'click'
      // (the others don't), so only then: or the trap would eat a later click.
      if (e.button === 0) window.addEventListener('click', swallow, { capture: true, once: true });
    },
    { capture: true },
  );
  // No context menu while binding the right button.
  window.addEventListener('contextmenu', (e) => listening && swallow(e), { capture: true });
  // passive: false, or the browser ignores preventDefault on wheel (the page would scroll).
  window.addEventListener(
    'wheel',
    (e) => {
      if (!listening || e.deltaY === 0) return;
      swallow(e);
      take(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
    },
    { capture: true, passive: false },
  );

  resetButton.addEventListener('click', () => {
    stopListening();
    resetKeybinds();
    say('Comandi di default ripristinati');
  });

  refresh();
  return { cancel: stopListening };
}
