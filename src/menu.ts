// The pause / start menu shown over the game (the "overlay" in index.html).
// Pure DOM: the markup lives in index.html, here we only wire the buttons.
//
// Pages: "main" (Gioca, Impostazioni, Comandi), "settings", "controls".
// Every page is a <div class="menu-page" data-page="..."> and every button
// with data-goto="..." switches to that page: like a tiny client-side router.
import { SENSITIVITY_MAX, SENSITIVITY_MIN, setSensitivity, settings } from './settings';

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
    for (const page of pages) page.hidden = page.dataset.page !== name;
  }

  for (const button of overlay.querySelectorAll<HTMLElement>('[data-goto]')) {
    button.addEventListener('click', () => showPage(button.dataset.goto!));
  }
  playButton.addEventListener('click', options.onPlay);

  // Esc inside a sub-page goes back to the main page.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && overlay.style.display !== 'none') showPage('main');
  });

  // --- Sensitivity: slider + number box, kept in sync -----------------------
  // The slider covers the common range, the box accepts any value in
  // [MIN, MAX] with finer steps. Both write through setSensitivity(), which
  // applies and saves; then we copy the (clamped) result back into both.
  const slider = document.getElementById('set-sens') as HTMLInputElement;
  const box = document.getElementById('set-sens-num') as HTMLInputElement;
  box.min = String(SENSITIVITY_MIN);
  box.max = String(SENSITIVITY_MAX);
  const showSensitivity = (): void => {
    slider.value = String(settings.sensitivity);
    box.value = String(settings.sensitivity);
  };
  slider.addEventListener('input', () => {
    setSensitivity(slider.valueAsNumber);
    box.value = String(settings.sensitivity);
  });
  // 'input' fires on every keystroke: while typing "5." the value is not a
  // number yet, so we just skip it. 'change' fires when you leave the box
  // (or press Enter): then we rewrite it with the clamped value.
  box.addEventListener('input', () => {
    if (Number.isFinite(box.valueAsNumber)) {
      setSensitivity(box.valueAsNumber);
      slider.value = String(settings.sensitivity);
    }
  });
  box.addEventListener('change', showSensitivity);
  showSensitivity();

  return {
    setOpen(open) {
      overlay.style.display = open ? 'flex' : 'none';
      if (open) {
        showPage('main');
        showSensitivity();
      }
    },
    markStarted() {
      title.textContent = 'PAUSA';
      playButton.textContent = 'Riprendi';
    },
  };
}
