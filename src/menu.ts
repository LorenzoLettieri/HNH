// The pause / start menu shown over the game (the "overlay" in index.html).
// Pure DOM: the markup lives in index.html, here we only wire the buttons.
//
// Pages: "main" (Gioca, Classifica, Impostazioni, Comandi, Schermo intero), "leaderboard", "settings", "controls".
// Every page is a <div class="menu-page" data-page="..."> and every button
// with data-goto="..." switches to that page: like a tiny client-side router.
import { SENSITIVITY_MAX, SENSITIVITY_MIN, set, settings, type Settings } from './settings';
import { DEFAULT_NAME, LEADERBOARD_SIZE, NAME_MAX_LENGTH } from './leaderboard';
import { fillScoreTable } from './render/scoreTable';
import { canLockEscape, isFullscreen, toggleFullscreen, watchFullscreen } from './fullscreen';

export interface Menu {
  /** Shows the menu (back on the main page) or hides it. */
  setOpen(open: boolean): void;
  /** After the first game start: "Gioca" becomes "Riprendi", the title "PAUSA". */
  markStarted(): void;
}

export function createMenu(options: { onPlay: () => void }): Menu {
  const overlay = document.getElementById('overlay')!;
  const title = document.getElementById('overlay-title')!;
  const playButton = document.getElementById('menu-play')!;
  const pages = overlay.querySelectorAll<HTMLElement>('.menu-page');

  function showPage(name: string): void {
    currentPage = name;
    for (const page of pages) page.hidden = page.dataset.page !== name;
    if (name === 'leaderboard') void refreshLeaderboard();
  }

  // --- Leaderboard page -----------------------------------------------------
  const nameBox = document.getElementById('set-name') as HTMLInputElement;
  nameBox.maxLength = NAME_MAX_LENGTH;
  nameBox.placeholder = DEFAULT_NAME;
  // 'change', not 'input': the name is cleaned (spaces at the ends removed),
  // and cleaning on every keystroke would eat the space before you type the
  // next word. 'change' fires when you leave the box or press Enter.
  nameBox.addEventListener('change', () => {
    set('playerName', nameBox.value);
    nameBox.value = settings.playerName;
  });
  const board = document.getElementById('leaderboard-rows')!;

  /** Fills the table (top 10 + your best if it's further down: scoreTable.ts). */
  async function refreshLeaderboard(): Promise<void> {
    nameBox.value = settings.playerName;
    await fillScoreTable(board, LEADERBOARD_SIZE);
  }

  for (const button of overlay.querySelectorAll<HTMLElement>('[data-goto]')) {
    button.addEventListener('click', () => showPage(button.dataset.goto!));
  }
  playButton.addEventListener('click', options.onPlay);

  // Esc inside a sub-page goes back to the main page; on the main page it
  // resumes the game (like "Riprendi"). The browser lets us grab the mouse
  // again only if the game itself had freed it: in full screen with the Esc
  // key ours (fullscreen.ts). Otherwise the request is just refused.
  let currentPage = 'main';
  window.addEventListener('keydown', (e) => {
    // defaultPrevented = main.ts already used this Esc (e.g. it closed the end
    // screen and that opened this menu during the same key press).
    if (e.code !== 'Escape' || e.repeat || e.defaultPrevented || overlay.style.display === 'none') return;
    if (currentPage !== 'main') showPage('main');
    else options.onPlay();
  });

  // Full screen (fullscreen.ts): the button says what a click will do.
  const fullscreenButton = document.getElementById('menu-fullscreen')!;
  const escHint = document.getElementById('menu-esc-hint')!;
  const showFullscreen = (): void => {
    fullscreenButton.textContent = isFullscreen() ? 'Esci dallo schermo intero' : 'Schermo intero';
    escHint.hidden = !canLockEscape();
  };
  fullscreenButton.addEventListener('click', () => void toggleFullscreen());
  watchFullscreen(showFullscreen);
  showFullscreen();

  // --- Settings controls --------------------------------------------------
  // Every control writes through set() (applies + saves) and every refresh
  // reads `settings` back, so the menu always shows the real (clamped) value.
  const refreshers: (() => void)[] = [];
  const refreshAll = (): void => refreshers.forEach((r) => r());

  /**
   * A slider + a number box for the same number setting, kept in sync.
   * The slider covers the common range, the box accepts any valid value
   * (set() clamps it) with finer steps.
   */
  function bindNumber(sliderId: string, boxId: string, key: 'sensitivity' | 'volume'): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const box = document.getElementById(boxId) as HTMLInputElement;
    const show = (): void => {
      slider.value = String(settings[key]);
      box.value = String(settings[key]);
    };
    slider.addEventListener('input', () => {
      set(key, slider.valueAsNumber);
      box.value = String(settings[key]);
    });
    // 'input' fires on every keystroke: while typing "5." the value is not a
    // number yet, so we just skip it. 'change' fires when you leave the box
    // (or press Enter): then we rewrite it with the clamped value.
    box.addEventListener('input', () => {
      if (Number.isFinite(box.valueAsNumber)) {
        set(key, box.valueAsNumber);
        slider.value = String(settings[key]);
      }
    });
    box.addEventListener('change', show);
    refreshers.push(show);
  }

  /** A checkbox for an on/off setting. */
  function bindToggle(id: string, key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]): void {
    const box = document.getElementById(id) as HTMLInputElement;
    box.addEventListener('change', () => set(key, box.checked));
    refreshers.push(() => (box.checked = settings[key]));
  }

  const sensBox = document.getElementById('set-sens-num') as HTMLInputElement;
  sensBox.min = String(SENSITIVITY_MIN);
  sensBox.max = String(SENSITIVITY_MAX);
  bindNumber('set-sens', 'set-sens-num', 'sensitivity');
  bindNumber('set-volume', 'set-volume-num', 'volume');
  bindToggle('set-ear-ringing', 'earRinging');
  bindToggle('set-hit-muffle', 'hitMuffle');
  refreshAll();

  return {
    setOpen(open) {
      overlay.style.display = open ? 'flex' : 'none';
      if (open) {
        showPage('main');
        refreshAll();
      }
    },
    markStarted() {
      title.textContent = 'PAUSA';
      playButton.textContent = 'Riprendi';
    },
  };
}
