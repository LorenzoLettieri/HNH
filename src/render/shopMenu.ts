// The shop on screen: the "E · COMMERCIA" prompt when you're next to a vendor,
// and the panel that opens over the game (docs/DESIGN.md: the menu does NOT
// pause, the horde keeps coming; the mouse is free to click, so meanwhile you
// can't aim, but you can still move with WASD).
//
// This file only DRAWS: what's for sale, prices and "is the vendor within
// reach" come from the simulation (src/sim/shop.ts). Buying takes TWO clicks
// on an item's box: the first turns it into "CONFERMA", the second buys (a
// misclick in a hurry, with the horde at the door, shouldn't cost 800).
// The second click doesn't buy anything by itself either: it queues a request (queueBuy in
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

/** Seconds the "CONFERMA" stays up waiting for the second click, then the box goes back to normal. */
const CONFIRM_TIME = 3;

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

/**
 * A clicked button keeps the keyboard FOCUS, and a focused button "clicks"
 * itself when you press Space or Enter. With the shop open you still move
 * and jump: Space would buy the shotgun (or confirm it) behind your back!
 * Cancelling the mousedown's default action stops the button from taking
 * the focus; the click still happens.
 */
function noFocus(el: HTMLElement): void {
  el.addEventListener('mousedown', (e) => e.preventDefault());
}

export function createShopMenu(options: { onCloseClick: () => void }): ShopMenu {
  const panel = document.getElementById('shop')!;
  const greeting = document.getElementById('shop-greeting')!;
  const list = document.getElementById('shop-items')!;
  const moneyEl = document.getElementById('shop-money')!;
  const prompt = document.getElementById('shop-prompt')!;
  const grabHint = document.getElementById('grab-hint')!;
  const closeButton = document.getElementById('shop-close')!;
  closeButton.addEventListener('click', options.onCloseClick);
  noFocus(closeButton);

  let isOpen = false;
  let kind: ShopSpawn['kind'] = 'weapons';
  /** One row per item: its state changes every frame (affordable? already yours?). */
  interface Row {
    id: ShopItemId;
    price: number;
    el: HTMLButtonElement;
    label: HTMLElement;
    /** The pending setTimeout that cancels "CONFERMA" (0 = not confirming). */
    confirmTimer: number;
    /** Not enough vildenaro (updated every frame by update()). */
    poor: boolean;
  }
  let rows: Row[] = [];

  /** Back to the normal face (timeout, a click on another item, a purchase). */
  function cancelConfirm(r: Row): void {
    clearTimeout(r.confirmTimer);
    r.confirmTimer = 0;
    r.el.classList.remove('confirming');
  }

  /**
   * A click on an item's box. First click: "CONFERMA" (and any other item
   * waiting for confirmation goes back to normal). Second click: buy.
   * Not enough money: no point in confirming, the request goes straight to
   * the simulation, which refuses it (and the vendor has his say).
   */
  function onItemClick(r: Row): void {
    if (r.poor || r.confirmTimer) {
      cancelConfirm(r);
      queueBuy(r.id); // only asks: the simulation will answer with an event
      return;
    }
    for (const other of rows) cancelConfirm(other);
    r.el.classList.add('confirming');
    r.confirmTimer = window.setTimeout(() => cancelConfirm(r), CONFIRM_TIME * 1000);
  }

  /** Builds the item list. Only when opening: prices can change from the debug panel. */
  function fill(): void {
    list.replaceChildren();
    rows = shopCatalog(kind).map((item) => {
      const text = ITEM_TEXT[item.id];
      // The whole box is ONE button (spans inside, not divs: a <button> may
      // only contain "phrasing" elements). Two faces, CSS shows one of them:
      // the item, or "CONFERMA" (class .confirming on the button).
      const row = document.createElement('button');
      row.className = 'shop-item';
      row.innerHTML = `
        <span class="shop-item-face">
          <span class="shop-item-text">
            <span class="shop-item-name"></span>
            <span class="shop-item-desc"></span>
          </span>
          <span class="shop-price"></span>
        </span>
        <span class="shop-item-confirm">
          <span class="shop-confirm-word">CONFERMA</span>
          <span class="shop-confirm-price"></span>
        </span>`;
      // textContent, not innerHTML, for the words: never build HTML out of strings
      // with data inside (same reason you escape output in a Blade template).
      row.querySelector('.shop-item-name')!.textContent = text.name;
      row.querySelector('.shop-item-desc')!.textContent = text.desc;
      row.querySelector('.shop-confirm-price')!.textContent = `paga ${item.price} vildenaro`;
      const r: Row = {
        id: item.id,
        price: item.price,
        el: row,
        label: row.querySelector<HTMLElement>('.shop-price')!,
        confirmTimer: 0,
        poor: false,
      };
      row.addEventListener('click', () => onItemClick(r));
      noFocus(row);
      list.append(row);
      return r;
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
      for (const r of rows) cancelConfirm(r); // reopening never shows a stale "CONFERMA"
    },
    update(player, inReach, paused) {
      // The prompt: next to a vendor, shop closed, game running.
      prompt.hidden = isOpen || paused || inReach === null;
      if (!isOpen) return;
      moneyEl.textContent = String(player.money);
      for (const r of rows) {
        const owned = ownsItem(player, r.id);
        r.el.classList.toggle('owned', owned);
        // Bought: the box is disabled, the price becomes "TUA". Not enough
        // money: still clickable, so the vendor can tell you what he thinks of you.
        r.el.classList.toggle('poor', r.poor);
        r.poor = !owned && player.money < r.price;
        r.el.disabled = owned;
        if (owned && r.confirmTimer) cancelConfirm(r);
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
