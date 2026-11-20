// Full screen, and the Esc key for the game.
//
// Normally Esc belongs to the browser: it frees the mouse (exits Pointer
// Lock) and the page can't stop it. And a page may grab the mouse again only
// after a "user gesture" (a click, a key press)... where Esc doesn't count.
// So in a window, Esc can open the pause menu but can't close it.
//
// In full screen, Chrome and Edge offer the Keyboard Lock API:
// navigator.keyboard.lock(['Escape']) = "give me the Esc key". Then a short
// press of Esc reaches the page like any other key (holding it down still
// exits full screen: the user can always get out). The game uses it like
// this (main.ts): Esc while playing → the PAGE frees the mouse
// (exitPointerLock) and shows the pause menu; Esc in the menu → grab the
// mouse again. That second grab is allowed without a gesture because it was
// the page itself that released it (a rule of the Pointer Lock spec).
// Firefox and Safari don't have Keyboard Lock: there Esc stays the browser's.

/** The part of the Keyboard Lock API we use (not in every browser, nor in TypeScript's DOM types). */
interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}

function keyboard(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

let escapeLocked = false;

/** Is the page in full screen? */
export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

/** Does Esc reach the game (full screen with Keyboard Lock)? */
export function escapeIsOurs(): boolean {
  return escapeLocked && isFullscreen();
}

/** Can this browser give the Esc key to the game? */
export function canLockEscape(): boolean {
  return keyboard() !== undefined;
}

/** Enters or leaves full screen. Must be called from a click (a user gesture). */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // Refused (e.g. not allowed in an iframe): nothing changes.
  }
}

/** Calls `onChange` when full screen starts or ends; takes and releases the Esc key. */
export function watchFullscreen(onChange: () => void): void {
  document.addEventListener('fullscreenchange', () => {
    const kb = keyboard();
    if (isFullscreen() && kb) {
      kb.lock(['Escape'])
        .then(() => (escapeLocked = true))
        .catch(() => (escapeLocked = false))
        .finally(onChange);
    } else {
      kb?.unlock();
      escapeLocked = false;
    }
    onChange();
  });
}
