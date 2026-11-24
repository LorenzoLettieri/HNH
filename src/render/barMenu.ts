// The saloon's rows in the counter panel: the barman's drinks, the pacts
// (simulation: src/sim/drinks.ts). The panel itself (frame, title, close
// button, E/Esc) is the shop's: shopMenu.ts shows these rows when the
// counter within reach is the saloon, like the Forge's (forgeMenu.ts).
//
// One box per drink on the counter (barOffer), the same double click as the
// shop: fiches are rare, a misclick must not waste one. The click only
// queues a request (queueDrink); the answer comes back as an event
// ('drinkBought' / 'drinkFailed'). Under the boxes, the drinks you've had.
import { playDrink, playPurchaseDenied } from '../audio/sfx';
import { queueDrink } from '../controls';
import { tuning } from '../sim/config';
import { barOffer, DRINKS, drinkLevel, drinkMaxLevel, type DrinkId } from '../sim/drinks';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';

/**
 * What each drink is called and does. `gift` = what you get at the NEXT
 * level; `cost` = the pact's price (only the devil's drinks have one).
 * A Record: a new drink with no text is a compile error.
 */
const DRINK_TEXT: Record<DrinkId, { name: string; gift: string; cost?: string }> = {
  undertakerWhiskey: { name: 'Whiskey del Becchino', gift: `+${tuning.whiskeyHealth} salute massima.` },
  bloodyMary: { name: 'Bloody Mary', gift: `Ogni uccisione ti cura di ${tuning.bloodyMaryHeal}.` },
  steamArmor: { name: 'Corazza di vapore', gift: `Sopra i ${tuning.steamArmorSpeed} m/s i proiettili ti fanno metà danno.` },
  deadMansHand: { name: 'Mano del morto', gift: `L'ultimo colpo di ogni caricatore fa danno ×${tuning.deadHandMultiplier}. Tutte le armi.` },
  quickDraw: { name: 'Cambio lampo', gift: `Per ${tuning.quickDrawWindow} s dopo un cambio arma, il primo colpo è un critico.` },
  lightningShine: { name: 'Acquavite Fulmine', gift: `Corri più veloce: +${tuning.shineSpeed} m/s.` },
  deadMansRum: { name: 'Rum del Morto', gift: `La catena dello Stile dura ${tuning.rumChainSeconds} s in più.` },
  devilsMilk: {
    name: 'Latte del Diavolo',
    gift: `+${tuning.devilsMilkDamage * 100}% di danno con tutto.`,
    cost: `−${tuning.devilsMilkHealthCost} salute massima.`,
  },
  hellfireBourbon: {
    name: 'Bourbon Infernale',
    gift: `+${tuning.bourbonMultiplier} al moltiplicatore di punti e vildenaro.`,
    cost: `Prendi il ${tuning.bourbonHurt * 100}% di danno in più.`,
  },
  crookedHorseshoe: {
    name: 'Ferro di cavallo storto',
    gift: `Le monete valgono il doppio.`,
    cost: 'Schizzano il doppio più lontano: corrigli dietro.',
  },
  greed: { name: 'Avidità', gift: 'Le monete non spariscono più.', cost: 'Ogni moneta vale la metà.' },
};

/** Roman numerals for the levels: I, II, III (it's a saloon, not a spreadsheet). */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** "Whiskey del Becchino II"; no numeral for a drink with one level only (it has no II). */
function levelName(drink: DrinkId, level: number): string {
  const name = DRINK_TEXT[drink].name;
  return drinkMaxLevel(drink) > 1 ? `${name} ${ROMAN[level] ?? level}` : name;
}

/** The barman's lines. */
export const BAR_GREETING = '“Siediti, straniero. Qui non si paga in vildenaro: si paga in fiches. E qualcos’altro.”';
const POURED_LINES = ['“Alla salute. Alla tua, almeno.”', '“Tutto d’un fiato. Così si fa.”', '“Ne vuoi un altro? Tutti ne vogliono un altro.”'];
const NO_FICHES_LINE = '“Niente fiches, niente bicchiere. Là fuori c’è chi ne regala: va’ a guadagnartele.”';
const EMPTY_LINE = 'Hai bevuto tutto quello che il barista ha da offrire.';

/** Seconds the "CONFERMA" stays up waiting for the second click. */
const CONFIRM_TIME = 3;

interface DrinkRow {
  drink: DrinkId;
  el: HTMLButtonElement;
  confirmTimer: number;
}

export interface BarRows {
  /** Every frame: rebuilds the list when the counter changes, prices in red without fiches. */
  refresh(list: HTMLElement, player: PlayerState): void;
  /** The simulation's answers: a sound, and the barman's line (null = keep it). */
  onEvents(events: SimEvent[]): string | null;
  /** Forget the list (the panel closed or switched counter): rebuilt by the next refresh. */
  reset(): void;
}

export function createBarRows(noFocus: (el: HTMLElement) => void): BarRows {
  let rows: DrinkRow[] = [];
  let builtFor = '';

  function cancelConfirm(r: DrinkRow): void {
    clearTimeout(r.confirmTimer);
    r.confirmTimer = 0;
    r.el.classList.remove('confirming');
  }

  function onClick(r: DrinkRow): void {
    // Without fiches nothing to confirm: the request goes through and the
    // refusal comes back as an event (with the barman's line).
    if (r.el.classList.contains('poor') || r.confirmTimer) {
      cancelConfirm(r);
      queueDrink(r.drink);
      return;
    }
    for (const other of rows) cancelConfirm(other);
    r.el.classList.add('confirming');
    r.confirmTimer = window.setTimeout(() => cancelConfirm(r), CONFIRM_TIME * 1000);
  }

  /** A box: the name with the level it'd become, what it gives, the pact's price in red. */
  function makeRow(list: HTMLElement, player: PlayerState, drink: DrinkId): DrinkRow {
    const text = DRINK_TEXT[drink];
    const next = drinkLevel(player, drink) + 1;
    const el = document.createElement('button');
    el.className = text.cost ? 'shop-item drink pact' : 'shop-item drink';
    el.innerHTML = `
      <span class="shop-item-face">
        <span class="shop-item-text">
          <span class="shop-item-name"></span>
          <span class="shop-item-desc"></span>
          <span class="drink-cost"></span>
        </span>
        <span class="shop-price"></span>
      </span>
      <span class="shop-item-confirm">
        <span class="shop-confirm-word">CONFERMA</span>
        <span class="shop-confirm-price"></span>
      </span>`;
    el.querySelector('.shop-item-name')!.textContent = levelName(drink, next);
    el.querySelector('.shop-item-desc')!.textContent = text.gift;
    el.querySelector('.drink-cost')!.textContent = text.cost ? `Il prezzo: ${text.cost}` : '';
    el.querySelector('.shop-price')!.textContent = `${tuning.drinkPrice} FICHE`;
    el.querySelector('.shop-confirm-price')!.textContent = `paga ${tuning.drinkPrice} fiche`;
    const r: DrinkRow = { drink, el, confirmTimer: 0 };
    el.addEventListener('click', () => onClick(r));
    noFocus(el);
    list.append(el);
    return r;
  }

  /** What you've had: "Whiskey del Becchino II · Latte del Diavolo I". */
  function summary(list: HTMLElement, player: PlayerState): void {
    const had = DRINKS.filter((d) => drinkLevel(player, d) > 0).map((d) => levelName(d, drinkLevel(player, d)));
    if (had.length === 0) return;
    const note = document.createElement('div');
    note.className = 'shop-maxed';
    note.textContent = `Hai già bevuto: ${had.join(' · ')}`;
    list.append(note);
  }

  return {
    refresh(list, player) {
      // Rebuild only when the counter changes (a drink taken, a new game):
      // the same "key" idea as the shop's lists.
      const offer = barOffer(player);
      const key = offer.join(',') + '|' + DRINKS.map((d) => drinkLevel(player, d)).join('');
      if (key !== builtFor) {
        for (const r of rows) cancelConfirm(r);
        list.replaceChildren();
        rows = offer.map((d) => makeRow(list, player, d));
        if (offer.length === 0) {
          const note = document.createElement('div');
          note.className = 'shop-maxed';
          note.textContent = EMPTY_LINE;
          list.append(note);
        }
        summary(list, player);
        builtFor = key;
      }
      const poor = player.fiches < tuning.drinkPrice;
      for (const r of rows) r.el.classList.toggle('poor', poor);
    },
    onEvents(events) {
      let line: string | null = null;
      for (const e of events) {
        if (e.type === 'drinkBought') {
          playDrink();
          line = POURED_LINES[Math.floor(Math.random() * POURED_LINES.length)];
        } else if (e.type === 'drinkFailed' && e.reason === 'fiches') {
          playPurchaseDenied();
          line = NO_FICHES_LINE;
          const row = rows.find((r) => r.drink === e.drink);
          if (row) {
            row.el.classList.remove('shake');
            void row.el.offsetWidth; // force a layout: the animation restarts
            row.el.classList.add('shake');
          }
        }
      }
      return line;
    },
    reset() {
      for (const r of rows) cancelConfirm(r);
      rows = [];
      builtFor = '';
    },
  };
}
