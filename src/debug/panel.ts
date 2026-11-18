// A tiny live-tweaking panel built with plain DOM elements (no library).
// Each control is bound to a property of a JS object: moving a slider writes
// straight into that object, and the game reads it on the next frame.

type Obj = Record<string, unknown>;

export interface Folder {
  /** Slider + number box for a numeric property. */
  number(obj: Obj, key: string, min: number, max: number, step: number, onChange?: () => void): void;
  /** Checkbox for a boolean property. */
  boolean(obj: Obj, key: string, onChange?: () => void): void;
  /** Color picker for a color stored as a hex number (0xff8800). */
  color(obj: Obj, key: string, onChange?: () => void): void;
  button(label: string, onClick: () => void): void;
  /** Removes all controls (to rebuild the folder for another object). */
  clear(): void;
  setTitle(title: string): void;
}

export interface Panel {
  folder(title: string): Folder;
  toggle(): void;
  readonly visible: boolean;
}

export function createPanel(): Panel {
  const root = document.createElement('div');
  root.id = 'debug-panel';
  root.hidden = true;
  document.body.appendChild(root);

  return {
    get visible() {
      return !root.hidden;
    },
    toggle() {
      root.hidden = !root.hidden;
    },
    folder(title) {
      // <details> gives us a collapsible section for free, no JS needed.
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = title;
      const body = document.createElement('div');
      details.append(summary, body);
      root.appendChild(details);
      return createFolder(summary, body);
    },
  };
}

function createFolder(summary: HTMLElement, body: HTMLElement): Folder {
  function row(label: string, ...controls: HTMLElement[]): void {
    const div = document.createElement('label');
    div.className = 'row';
    const span = document.createElement('span');
    span.textContent = label;
    div.append(span, ...controls);
    body.appendChild(div);
  }

  return {
    number(obj, key, min, max, step, onChange) {
      const slider = document.createElement('input');
      slider.type = 'range';
      const box = document.createElement('input');
      box.type = 'number';
      for (const input of [slider, box]) {
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(obj[key]);
        // 'input' fires continuously while dragging: live feedback.
        input.addEventListener('input', () => {
          const value = Number(input.value);
          if (Number.isNaN(value)) return;
          obj[key] = value;
          slider.value = box.value = String(value);
          onChange?.();
        });
      }
      row(key, slider, box);
    },

    boolean(obj, key, onChange) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(obj[key]);
      checkbox.addEventListener('change', () => {
        obj[key] = checkbox.checked;
        onChange?.();
      });
      row(key, checkbox);
    },

    color(obj, key, onChange) {
      const picker = document.createElement('input');
      picker.type = 'color';
      // <input type="color"> speaks "#rrggbb"; our objects store 0xrrggbb numbers.
      picker.value = '#' + (obj[key] as number).toString(16).padStart(6, '0');
      picker.addEventListener('input', () => {
        obj[key] = parseInt(picker.value.slice(1), 16);
        onChange?.();
      });
      row(key, picker);
    },

    button(label, onClick) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', onClick);
      body.appendChild(button);
    },

    clear() {
      body.replaceChildren();
    },

    setTitle(title) {
      summary.textContent = title;
    },
  };
}

/**
 * Turns an object into TypeScript-like source you can paste back into the
 * code: `key: value,` lines, with colors written as hex.
 */
export function toSource(obj: Obj, colorKeys: string[] = []): string {
  return Object.entries(obj)
    .map(([key, value]) => {
      if (colorKeys.includes(key) && typeof value === 'number') {
        return `  ${key}: 0x${value.toString(16).padStart(6, '0')},`;
      }
      return `  ${key}: ${JSON.stringify(value)},`;
    })
    .join('\n');
}

/** Copies text to the clipboard and briefly confirms on the button's folder. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard can be blocked (e.g. no permission): print it instead.
    console.log(text);
    alert('Clipboard not available: values printed in the browser console.');
  }
}
