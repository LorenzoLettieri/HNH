// The shop on screen: the "E · COMMERCIA" prompt when you're next to a vendor,
// and the panel that opens over the game (docs/DESIGN.md: the menu does NOT
// pause, the horde keeps coming; the mouse is free to click, so meanwhile you
// can't aim, but you can still move with WASD).
//
// This file only DRAWS: what's for sale, prices and "is the vendor within
// reach" come from the simulation (src/sim/shop.ts). A click on "Compra"
// doesn't buy anything by itself: it queues a request (queueBuy in
// controls.ts) that the next tick carries to the simulation, and the answer
// comes back as an event ('purchase' / 'purchaseFailed', see onEvents).
// Opening and closing (E, Esc, walking away) are wired in main.ts.
// Markup and CSS in index.html (#shop, #shop-prompt, #grab-hint).
import { playPurchase, playPurchaseDenied } from '../audio/sfx';
import { queueBuy } from '../controls';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { ownsItem, shopCatalog, type ShopItemId } from '../sim/shop';
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
/** What he says after a purchase, and when you can't pay. */
const THANKS = '\u201CAffare fatto. Trattala bene, e lei tratter\u00E0 bene te.\u201D';
const NO_MONEY = '\u201CCon quei quattro spiccioli? Torna quando avrai il vildenaro, straniero.\u201D';

const GREETINGS = [
  '“Benvenuto, straniero. Qui si paga in vildenaro, niente credito.”',
  '“Fa’ in fretta: i tuoi amici morti non aspettano.”',
  '“Roba buona, prezzi onesti. Beh, prezzi.”',
];

export interface ShopMenu {
  readonly isOpen: boolean;
  open(kind: ShopSpawn['kind']): void;
  close(): void;
  /** Every frame. `inReach` = the shop within reach right now (null = none): it drives the prompt. */
  update(player: PlayerState, inReach: ShopSpawn | null, paused: boolean): void;
  /** The simulation's answers to the purchases (sounds, the vendor's line). */
  onEvents(events: SimEvent[]): void;
  /** "Clicca per riprendere la mira": the shop closed but the browser didn't give the mouse back. */
  setGrabHint(visible: boolean): void;
}

export function createShopMenu(options: { onCloseClick: () => void }): ShopMenu {
  const panel = document.getElementById('shop')!;
  const greeting = document.getElementById('shop-greeting')!;
  const list = document.getElementById('shop-items')!;
  const moneyEl = document.getElementById('shop-money')!;
  const prompt = document.getElementById('shop-prompt')!;
  const grabHint = document.getElementById('grab-hint')!;
  document.getElementById('shop-close')!.addEventListener('click', options.onCloseClick);

  let isOpen = false;
  let kind: ShopSpawn['kind'] = 'weapons';
  /** One row per item: its state changes every frame (affordable? already yours?). */
  let rows: { id: ShopItemId; price: number; el: HTMLElement; button: HTMLButtonElement; label: HTMLElement }[] = [];

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
        <button class="shop-buy"><span class="shop-price"></span></button>`;
      // textContent, not innerHTML, for the words: never build HTML out of strings
      // with data inside (same reason you escape output in a Blade template).
      row.querySelector('.shop-item-name')!.textContent = text.name;
      row.querySelector('.shop-item-desc')!.textContent = text.desc;
      const button = row.querySelector<HTMLButtonElement>('.shop-buy')!;
      const label = row.querySelector<HTMLElement>('.shop-price')!;
      // The click only asks: the simulation will answer with an event.
      button.addEventListener('click', () => queueBuy(item.id));
      list.append(row);
      return { id: item.id, price: item.price, el: row, button, label };
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
    update(player, inReach, paused) {
      // The prompt: next to a vendor, shop closed, game running.
      prompt.hidden = isOpen || paused || inReach === null;
      if (!isOpen) return;
      moneyEl.textContent = String(player.money);
      for (const r of rows) {
        const owned = ownsItem(player, r.id);
        r.el.classList.toggle('owned', owned);
        r.el.classList.toggle('poor', !owned && player.money < r.price);
        // Bought: the button becomes a label. Not enough money: still
        // clickable, so the vendor can tell you what he thinks of you.
        r.button.disabled = owned;
        r.label.textContent = owned ? 'TUA' : String(r.price);
      }
    },
    onEvents(events) {
      for (const e of events) {
        if (e.type === 'purchase') {
          playPurchase();
          greeting.textContent = THANKS;
        } else if (e.type === 'purchaseFailed' && e.reason === 'money') {
          playPurchaseDenied();
          greeting.textContent = NO_MONEY;
          const row = rows.find((r) => r.id === e.item);
          // Shake the row: restart a CSS animation (remove the class, force a
          // layout so the browser notices, add it back).
          if (row) {
            row.el.classList.remove('shake');
            void row.el.offsetWidth;
            row.el.classList.add('shake');
          }
        }
      }
    },
    setGrabHint(visible) {
      grabHint.hidden = !visible;
    },
  };
}
