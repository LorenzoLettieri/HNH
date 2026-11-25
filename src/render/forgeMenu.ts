// The Forge's rows in the counter panel (docs/DESIGN.md §6d). The panel itself
// (frame, title, close button, E/Esc) is the shop's: shopMenu.ts shows these
// rows instead of the weapons when the counter within reach is a Forge.
//
// One box per gun, with the same double click as the shop (Damned Iron is
// rare: a misclick must not waste it). The box says what happens to the gun,
// or why it can't: forgeRefusal in src/sim/forge.ts, the same function the
// simulation uses to say no. The click only queues a request (queueForge);
// the answer comes back as an event ('forged' / 'forgeFailed').
import { playForge, playPurchaseDenied } from '../audio/sfx';
import { queueForge } from '../controls';
import type { SimEvent } from '../sim/events';
import { FORGEABLE, forgeCost, forgeRefusal, type ForgeableWeapon } from '../sim/forge';
import type { PlayerState } from '../sim/player';
import type { WeaponId } from '../sim/weapon';

/** What each gun becomes. For now only the damage changes; the new look comes later. */
const FORGE_TEXT: Record<ForgeableWeapon, { name: string; desc: string }> = {
  revolver: { name: 'Revolver → Akimbo', desc: 'Il doppio del danno. (Presto: un secondo revolver nell’altra mano.)' },
  shotgun: { name: 'Doppietta → Fucile a pompa', desc: 'Il doppio del danno. (Presto: il fucile a pompa.)' },
  dynamite: { name: 'Lancia-dinamite → Acqua santa', desc: 'Il doppio del danno, e i candelotti bagnati nell’acqua santa: dove scoppiano resta un fuoco blu che brucia i dannati. Non te.' },
  rifle: { name: 'Carabina → Tesla', desc: 'Il doppio del danno, un cannocchiale e proiettili elettrici: la scossa salta da un dannato all’altro, li ferisce e li stordisce.' },
};

/** The lines at the top of the panel: nobody behind this counter, the Forge "speaks" in italics. */
export const FORGE_GREETING = 'Il fuoco non si spegne mai. Porta il Ferro Dannato, e l’arma rinasce.';
const FORGED_LINE = 'Il ferro canta, poi tace. Ora l’arma è un’altra.';
const NO_IRON_LINE = 'Senza Ferro Dannato il fuoco non ti ascolta. Uccidi chi lo porta.';

/** Seconds the "CONFERMA" stays up waiting for the second click. */
const CONFIRM_TIME = 3;

interface ForgeRow {
  weapon: WeaponId;
  el: HTMLButtonElement;
  label: HTMLElement;
  /** "consuma N Ferro Dannato" under CONFERMA: N changes, so it's rewritten every refresh. */
  confirmPrice: HTMLElement;
  confirmTimer: number;
}

export interface ForgeRows {
  /** Fill the panel's list with one box per gun. */
  build(list: HTMLElement): void;
  /** Every frame: what each box says (and whether it can be clicked). */
  refresh(player: PlayerState): void;
  /** The simulation's answers: a sound, and the line to show at the top (null = keep it). */
  onEvents(events: SimEvent[]): string | null;
  /** Cancel any pending "CONFERMA" (the panel closed). */
  reset(): void;
}

export function createForgeRows(noFocus: (el: HTMLElement) => void): ForgeRows {
  let rows: ForgeRow[] = [];

  function cancelConfirm(r: ForgeRow): void {
    clearTimeout(r.confirmTimer);
    r.confirmTimer = 0;
    r.el.classList.remove('confirming');
  }

  function onClick(r: ForgeRow): void {
    // First click: "CONFERMA". Second: ask the simulation. Without iron there's
    // nothing to confirm: the request goes straight through, and the refusal
    // comes back as an event (with its line), like the shop does with money.
    const poor = r.el.classList.contains('poor');
    if (poor || r.confirmTimer) {
      cancelConfirm(r);
      queueForge(r.weapon);
      return;
    }
    for (const other of rows) cancelConfirm(other);
    r.el.classList.add('confirming');
    r.confirmTimer = window.setTimeout(() => cancelConfirm(r), CONFIRM_TIME * 1000);
  }

  return {
    build(list) {
      this.reset();
      list.replaceChildren();
      rows = FORGEABLE.map((weapon) => {
        // Same markup as the shop's boxes (index.html styles .shop-item).
        const el = document.createElement('button');
        el.className = 'shop-item';
        el.innerHTML = `
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
        el.querySelector('.shop-item-name')!.textContent = FORGE_TEXT[weapon].name;
        el.querySelector('.shop-item-desc')!.textContent = FORGE_TEXT[weapon].desc;
        const r: ForgeRow = {
          weapon,
          el,
          label: el.querySelector<HTMLElement>('.shop-price')!,
          confirmPrice: el.querySelector<HTMLElement>('.shop-confirm-price')!,
          confirmTimer: 0,
        };
        el.addEventListener('click', () => onClick(r));
        noFocus(el);
        list.append(el);
        return r;
      });
    },
    refresh(player) {
      for (const r of rows) {
        const refusal = forgeRefusal(player, r.weapon);
        // The price grows with every gun reinforced (forgeCost in src/sim/forge.ts).
        const cost = forgeCost(player);
        r.confirmPrice.textContent = `consuma ${cost} Ferro Dannato`;
        // Not yours, or already reinforced: nothing to click.
        r.el.disabled = refusal === 'notOwned' || refusal === 'maxed';
        r.el.classList.toggle('poor', refusal === 'noIron');
        r.el.classList.toggle('owned', refusal === 'maxed' || refusal === 'notOwned');
        if (r.el.disabled && r.confirmTimer) cancelConfirm(r);
        r.label.textContent =
          refusal === 'notOwned' ? 'NON È TUA' : refusal === 'maxed' ? 'RINFORZATA' : `${cost} FERRO`;
      }
    },
    onEvents(events) {
      let line: string | null = null;
      for (const e of events) {
        if (e.type === 'forged') {
          playForge();
          line = FORGED_LINE;
        } else if (e.type === 'forgeFailed' && e.reason === 'noIron') {
          playPurchaseDenied();
          line = NO_IRON_LINE;
          const row = rows.find((r) => r.weapon === e.weapon);
          if (row) {
            // Shake: restart the CSS animation (remove, force a layout, add back).
            row.el.classList.remove('shake');
            void row.el.offsetWidth;
            row.el.classList.add('shake');
          }
        }
      }
      return line;
    },
    reset() {
      for (const r of rows) cancelConfirm(r);
    },
  };
}
