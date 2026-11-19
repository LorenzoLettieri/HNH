// The shop on screen: the "E · COMMERCIA" prompt when you're next to a vendor,
// and the panel that opens over the game (docs/DESIGN.md: the menu does NOT
// pause, the horde keeps coming; the mouse is free to click, so meanwhile you
// can't aim, but you can still move with WASD).
//
// This file only DRAWS: what's for sale, prices and "is the vendor within
// reach" come from the simulation (src/sim/shop.ts). Opening and closing
// (E, Esc, the mouse) are wired in main.ts.
// Markup and CSS in index.html (#shop, #shop-prompt).
import { shopCatalog, type ShopItemId } from '../sim/shop';
import type { ShopSpawn } from '../sim/world';
import './fonts';

/** Name and one line of description for each item: the UI's words, not the simulation's. */
const ITEM_TEXT: Record<ShopItemId, { name: string; desc: string }> = {
  shotgun: {
    name: 'Doppietta a canne mozze',
    desc: 'Due colpi, rosata larga. Da vicino non perdona, e a bruciapelo li manda a gambe all’aria.',
  },
};

/** What the vendor says when you open the shop (one at random). */
const GREETINGS = [
  '“Benvenuto, straniero. Qui si paga in vildenaro, niente credito.”',
  '“Fa’ in fretta: i tuoi amici morti non aspettano.”',
  '“Roba buona, prezzi onesti. Beh, prezzi.”',
];

export interface ShopMenu {
  readonly isOpen: boolean;
  open(kind: ShopSpawn['kind']): void;
  close(): void;
  /**
   * Every frame. `inReach` = the shop within reach right now (null = none):
   * it drives the prompt, and greys out the panel if you walk away with it open.
   */
  update(money: number, inReach: ShopSpawn | null, paused: boolean): void;
}

export function createShopMenu(options: { onCloseClick: () => void }): ShopMenu {
  const panel = document.getElementById('shop')!;
  const greeting = document.getElementById('shop-greeting')!;
  const list = document.getElementById('shop-items')!;
  const moneyEl = document.getElementById('shop-money')!;
  const away = document.getElementById('shop-away')!;
  const prompt = document.getElementById('shop-prompt')!;
  document.getElementById('shop-close')!.addEventListener('click', options.onCloseClick);

  let isOpen = false;
  let kind: ShopSpawn['kind'] = 'weapons';
  /** The price elements, to color them red when you can't afford them. */
  let rows: { price: number; el: HTMLElement }[] = [];

  /** Builds the item list. Only when opening: prices can change from the debug panel. */
  function fill(): void {
    list.replaceChildren();
    rows = shopCatalog(kind).map((item) => {
      const text = ITEM_TEXT[item.id];
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="shop-item-text">
          <div class="shop-item-name"></div>
          <div class="shop-item-desc"></div>
        </div>
        <button class="shop-buy" disabled><span class="shop-price"></span></button>`;
      // textContent, not innerHTML, for the words: never build HTML out of strings
      // with data inside (same reason you escape output in a Blade template).
      row.querySelector('.shop-item-name')!.textContent = text.name;
      row.querySelector('.shop-item-desc')!.textContent = text.desc;
      row.querySelector('.shop-price')!.textContent = String(item.price);
      list.append(row);
      return { price: item.price, el: row };
    });
  }

  return {
    get isOpen() {
      return isOpen;
    },
    open(k) {
      kind = k;
      isOpen = true;
      greeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
      fill();
      panel.hidden = false;
    },
    close() {
      isOpen = false;
      panel.hidden = true;
    },
    update(money, inReach, paused) {
      // The prompt: next to a vendor, shop closed, game running.
      prompt.hidden = isOpen || paused || inReach === null;
      if (!isOpen) return;
      moneyEl.textContent = String(money);
      // Walked away with the panel open: it stays (closing it would pause the
      // game: the browser won't give the mouse back without a click), but
      // greyed out with a note. The simulation will refuse purchases anyway.
      const far = inReach === null;
      away.hidden = !far;
      panel.classList.toggle('far', far);
      for (const r of rows) r.el.classList.toggle('poor', money < r.price);
    },
  };
}
