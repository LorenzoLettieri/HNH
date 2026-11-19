// Raw input handling: keeps track of which keys are held down and accumulates
// mouse movement while the pointer is locked. It knows nothing about the game:
// other code reads this state and decides what to do with it.

/** Keys currently held down, by physical position (KeyboardEvent.code, e.g. "KeyW"). */
const keysDown = new Set<string>();

/**
 * Keys pressed since the last time someone asked (see wasPressed). Needed
 * because the game only LOOKS at the keys once per tick: a click shorter
 * than a frame (pressed and released in between) would otherwise be lost.
 */
const pressedSinceCheck = new Set<string>();

/** Mouse movement accumulated since the last call to consumeMouseDelta(). */
let mouseDx = 0;
let mouseDy = 0;

export function isKeyDown(code: string): boolean {
  return keysDown.has(code);
}

/** True if `code` was pressed since the last call (even if already released). */
export function wasPressed(code: string): boolean {
  const pressed = pressedSinceCheck.has(code);
  pressedSinceCheck.delete(code);
  return pressed;
}

/** Returns the mouse movement since the last call, then resets it to zero. */
export function consumeMouseDelta(): { dx: number; dy: number } {
  const delta = { dx: mouseDx, dy: mouseDy };
  mouseDx = 0;
  mouseDy = 0;
  return delta;
}

/** True when the key event comes from an input field (slider, number box, ...). */
export function isTypingInField(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

export function isPointerLocked(): boolean {
  return document.pointerLockElement !== null;
}

/** Grabs the mouse (Pointer Lock): the cursor disappears and we get raw movement. */
export async function requestLock(target: HTMLElement): Promise<void> {
  if (isPointerLocked()) return;
  try {
    // unadjustedMovement = raw mouse input, without the OS acceleration curve.
    await target.requestPointerLock({ unadjustedMovement: true });
  } catch {
    // Some browsers/OSes don't support raw input: fall back to the normal one.
    // This can fail too: Chrome refuses a new lock for ~1 s after Esc. Just
    // ignore it, the player clicks again.
    await target.requestPointerLock().catch(() => {});
  }
}

/** Wires up the browser events. `target` is the element that grabs the mouse on click. */
export function initInput(target: HTMLElement, onLockChange: (locked: boolean) => void): void {
  window.addEventListener('keydown', (e) => {
    // Typing in a text field (e.g. the debug panel) must not move the player.
    if (isTypingInField(e)) return;
    if (!e.repeat) pressedSinceCheck.add(e.code);
    keysDown.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
  });
  // If the window loses focus we never receive the keyup: forget everything.
  window.addEventListener('blur', () => keysDown.clear());

  // Clicking the canvas grabs the mouse (when the menu is hidden, e.g. with the debug panel open).
  target.addEventListener('click', () => requestLock(target));

  document.addEventListener('pointerlockchange', () => {
    keysDown.clear();
    pressedSinceCheck.clear();
    // Back in the game: take keyboard focus away from any panel control,
    // otherwise keys would keep going to the last slider you touched.
    if (isPointerLocked() && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onLockChange(isPointerLocked());
  });

  // Mouse buttons go in the same Set as keys, with names like "Mouse0"
  // (left) and "Mouse2" (right), so the rest of the code treats them alike.
  document.addEventListener('mousedown', (e) => {
    if (!isPointerLocked()) return;
    keysDown.add(`Mouse${e.button}`);
    pressedSinceCheck.add(`Mouse${e.button}`);
  });
  document.addEventListener('mouseup', (e) => {
    keysDown.delete(`Mouse${e.button}`);
  });
  // No browser context menu on right click while playing.
  document.addEventListener('contextmenu', (e) => {
    if (isPointerLocked()) e.preventDefault();
  });

  // The mouse wheel becomes two more "keys" that can only be pressed, never
  // held: "WheelUp" and "WheelDown". A touchpad sends dozens of wheel events
  // per swipe, so after one "notch" we ignore the wheel for a moment.
  let lastWheel = 0;
  document.addEventListener('wheel', (e) => {
    if (!isPointerLocked() || e.deltaY === 0) return;
    if (e.timeStamp - lastWheel < 120) return;
    lastWheel = e.timeStamp;
    pressedSinceCheck.add(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked()) return;
    // movementX/Y = how far the mouse moved since the previous event, in pixels.
    mouseDx += e.movementX;
    mouseDy += e.movementY;
  });
}
