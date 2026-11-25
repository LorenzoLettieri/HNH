// The pause / start menu shown over the game (the "overlay" in index.html).
// Pure DOM: the markup lives in index.html, here we only wire the buttons.
//
// Pages: "main" (Gioca, Classifica, Impostazioni, Schermo intero), "leaderboard", "settings".
// The settings page has three TABS: "general" (mouse, audio), "video" (resolution,
// brightness, fog, FOV, comfort, crosshair), "controls" (the rebindable keys: keysMenu.ts).
// Every page is a <div class="menu-page" data-page="..."> and every button
// with data-goto="..." switches to that page: like a tiny client-side router.
import { RANGES, resetVideo, set, settings, type Settings } from './settings';
import { NAME_MAX_LENGTH } from './leaderboard';
import { fillScoreTable } from './render/scoreTable';
import { createKeysPage } from './keysMenu';
import { canLockEscape, isFullscreen, toggleFullscreen, watchFullscreen } from './fullscreen';

export interface Menu {
  /** Shows the menu (back on the main page) or hides it. */
  setOpen(open: boolean): void;
  /** After the first game start: "Gioca" becomes "Riprendi", the title "PAUSA". */
  markStarted(): void;
}

/** Players shown on the menu's leaderboard page (the server sends at most 50). */
const LEADERBOARD_ROWS = 25;

export function createMenu(options: { onPlay: () => void }): Menu {
  const overlay = document.getElementById('overlay')!;
  const title = document.getElementById('overlay-title')!;
  const playButton = document.getElementById('menu-play')!;
  const pages = overlay.querySelectorAll<HTMLElement>('.menu-page');

  // The "Comandi" page: rebindable keys (keysMenu.ts).
  const keysPage = createKeysPage();

  function showPage(name: string): void {
    keysPage.cancel(); // leaving the page while it waits for a key
    currentPage = name;
    for (const page of pages) page.hidden = page.dataset.page !== name;
    if (name === 'leaderboard') void refreshLeaderboard();
  }

  // --- Settings tabs ----------------------------------------------------------
  // Same idea as the pages, one level down: a button and a panel share a
  // data-tab name, a click shows that panel and hides the others. The tab you
  // were on stays chosen when you come back (it's just which panel isn't hidden).
  const tabButtons = overlay.querySelectorAll<HTMLElement>('.tab[data-tab]');
  const tabPanels = overlay.querySelectorAll<HTMLElement>('.settings-tab[data-tab]');
  function showTab(name: string): void {
    keysPage.cancel(); // switching tab while it waits for a key
    for (const panel of tabPanels) panel.hidden = panel.dataset.tab !== name;
    // aria-selected: screen readers say which tab is on, and the CSS colors it.
    for (const button of tabButtons) button.setAttribute('aria-selected', String(button.dataset.tab === name));
    // Back to the top of the box: a long tab scrolled halfway would open in the middle.
    document.getElementById('menu')!.scrollTop = 0;
  }
  for (const button of tabButtons) button.addEventListener('click', () => showTab(button.dataset.tab!));
  showTab('general');

  // --- Leaderboard page -----------------------------------------------------
  const nameBox = document.getElementById('set-name') as HTMLInputElement;
  nameBox.maxLength = NAME_MAX_LENGTH;
  // Seen only while the box is empty: leaving it empty draws a random name (settings.ts).
  nameBox.placeholder = 'Vuoto = nome a caso';
  // 'change', not 'input': the name is cleaned (spaces at the ends removed),
  // and cleaning on every keystroke would eat the space before you type the
  // next word. 'change' fires when you leave the box or press Enter.
  nameBox.addEventListener('change', () => {
    set('playerName', nameBox.value);
    nameBox.value = settings.playerName;
  });
  const board = document.getElementById('leaderboard-rows')!;

  /** Fills the table (the top players + you if you're further down: scoreTable.ts). */
  async function refreshLeaderboard(): Promise<void> {
    nameBox.value = settings.playerName;
    await fillScoreTable(board, LEADERBOARD_ROWS, settings.playerName);
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
  function bindNumber(sliderId: string, boxId: string, key: keyof typeof RANGES): void {
    const slider = document.getElementById(sliderId) as HTMLInputElement;
    const box = document.getElementById(boxId) as HTMLInputElement;
    // The box accepts the whole valid range (the slider may cover less of it).
    box.min = String(RANGES[key][0]);
    box.max = String(RANGES[key][1]);
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

  /**
   * A drop-down list (<select>) for a setting with a few choices. The
   * <option> values are strings: `parse` turns them back (Number for the
   * resolution); set() refuses anything that isn't one of the choices.
   */
  function bindSelect<K extends 'resolution' | 'crosshairColor'>(
    id: string,
    key: K,
    parse: (value: string) => Settings[K],
  ): void {
    const select = document.getElementById(id) as HTMLSelectElement;
    select.addEventListener('change', () => set(key, parse(select.value)));
    refreshers.push(() => (select.value = String(settings[key])));
  }

  bindNumber('set-sens', 'set-sens-num', 'sensitivity');
  bindNumber('set-volume', 'set-volume-num', 'volume');
  bindToggle('set-ear-ringing', 'earRinging');
  bindToggle('set-hit-muffle', 'hitMuffle');

  // Video page.
  bindSelect('set-resolution', 'resolution', Number);
  bindToggle('set-color-reduction', 'colorReduction');
  bindNumber('set-brightness', 'set-brightness-num', 'brightness');
  bindNumber('set-fog', 'set-fog-num', 'fog');
  bindNumber('set-fov', 'set-fov-num', 'fov');
  bindNumber('set-shake', 'set-shake-num', 'shake');
  bindNumber('set-flashes', 'set-flashes-num', 'flashes');
  bindToggle('set-speed-fov', 'speedFov');
  bindToggle('set-view-roll', 'viewRoll');
  bindSelect('set-crosshair-color', 'crosshairColor', (v) => v as Settings['crosshairColor']);
  bindNumber('set-crosshair-size', 'set-crosshair-size-num', 'crosshairSize');
  bindToggle('set-crosshair-outline', 'crosshairOutline');
  document.getElementById('video-reset')!.addEventListener('click', () => {
    resetVideo();
    refreshAll();
  });
  refreshAll();

  return {
    setOpen(open) {
      overlay.style.display = open ? 'flex' : 'none';
      keysPage.cancel();
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
