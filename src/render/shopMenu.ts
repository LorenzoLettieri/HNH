// The shop on screen: the "E · COMMERCIA" prompt when you're next to a vendor,
// and the panel that opens over the game (docs/DESIGN.md: the menu does NOT
// pause, the horde keeps coming; the mouse is free to click, so meanwhile you
// can't aim, but you can still move with WASD).
//
// This file only DRAWS: what's for sale, prices and "is the vendor within
// reach" come from the simulation (src/sim/shop.ts, src/sim/upgrades.ts).
//
// Two panels:
// - the MAIN one (right): every weapon. One you don't own has its price and is
//   bought with TWO clicks on its box: the first turns it into "CONFERMA", the
//   second buys (a misclick in a hurry, with the horde at the door, shouldn't
//   cost 800). One you own says "POTENZIA": a click opens...
// - ...the UPGRADE panel, to the left of the main one: the cards on that
//   weapon's counter (src/sim/upgrades.ts), its level as pips, bought with the
//   same double click. A click on the same weapon again closes it.
// A purchase click doesn't buy anything by itself: it queues a request
// (queueBuy in controls.ts) that the next tick carries to the simulation, and
// the answer comes back as an event ('purchase' / 'purchaseFailed', see onEvents).
// Opening and closing (E, Esc, walking away) are wired in main.ts.
// Markup and CSS in index.html (#shop, #shop-upgrades, #shop-prompt, #grab-hint).
import { canAfford } from '../sim/drinks';
import { mainKeyName, onKeybindsChange } from '../keybinds';
import { playPurchase, playPurchaseDenied } from '../audio/sfx';
import { queueBuy } from '../controls';
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { ownsItem, shopCatalog, type PurchaseId, type ShopItemId } from '../sim/shop';
import { upgradeLevel, upgradeOffer, upgradePrice, type CardId } from '../sim/upgrades';
import type { GearId } from '../sim/weapon';
import type { ShopSpawn } from '../sim/world';
import { createForgeRows, FORGE_GREETING } from './forgeMenu';
import { BAR_GREETING, createBarRows } from './barMenu';
import './fonts';

/** Name and one line of description for each item: the UI's words, not the simulation's. */
const ITEM_TEXT: Record<ShopItemId, { name: string; desc: string }> = {
  revolver: {
    name: 'Revolver',
    desc: 'Sei colpi, preciso, in testa fa male. Tasto destro: il fanning svuota il tamburo in un attimo.',
  },
  shotgun: {
    name: 'Doppietta a canne mozze',
    desc: 'Due colpi, rosata larga. Da vicino non perdona, e a bruciapelo li manda a gambe all’aria.',
  },
  rifle: {
    name: 'Carabina a leva',
    desc: 'Otto colpi, stesse cartucce del revolver. Lenta, ma da lontano e in testa non sbaglia. Tasto destro per mirare.',
  },
  dynamite: {
    name: 'Lancia-dinamite',
    desc: 'Cinque candelotti nel tamburo. Rimbalzano e scoppiano dopo un attimo, o subito se toccano qualcuno. Ai tuoi piedi: un salto fino ai tetti.',
  },
  shovel: {
    name: 'Badile da becchino',
    desc: 'Prende il posto dello stivale (F). Più lungo, più largo, tre volte il danno. Scava fosse, ne riempie altre.',
  },
};

/** The upgrade cards' words (docs/DESIGN.md §6c). Every card needs one: a missing one is a compile error. */
const CARD_TEXT: Record<CardId, { name: string; desc: string }> = {
  undertakerCylinder: {
    name: 'Tamburo del becchino',
    desc: 'Otto colpi nel tamburo invece di sei. Il fanning li svuota tutti.',
  },
  fastCylinder: {
    name: 'Tamburo veloce',
    desc: 'Ricarichi in due terzi del tempo. Le dita sanno già dove andare.',
  },
  slideReload: {
    name: 'Ricarica in scivolata',
    desc: 'Mentre scivoli col revolver in mano, un colpo entra nel tamburo ogni 0,3 secondi.',
  },
  riderShot: {
    name: 'Colpo da cavaliere',
    desc: 'Il primo colpo dopo un salto sul muro è sempre critico, ovunque colpisca. Finché non tocchi terra.',
  },
  quickHand: {
    name: 'Mano lesta',
    desc: 'Il fanning è più stretto e più veloce. Ogni uccisione durante la raffica le aggiunge un colpo, gratis.',
  },
  ricochet: {
    name: 'Ricochet',
    desc: 'Dopo un colpo critico il proiettile rimbalza nel corpo del nemico più vicino.',
  },
  lastShot: {
    name: 'Ultimo colpo',
    desc: 'L’ultimo proiettile del tamburo esplode dove colpisce. Buono contro i gruppi.',
  },
  longBarrels: {
    name: 'Canne lunghe',
    desc: 'Rosata più stretta, e il danno pieno arriva due metri più lontano.',
  },
  dragonBreath: {
    name: 'Fiato di drago',
    desc: 'Pallini incendiari: chi li prende brucia per due secondi.',
  },
  mule: {
    name: 'Mulo',
    desc: 'Il doppio del contraccolpo. Sparati ai piedi e vola. Non va d’accordo col Calcio di piombo.',
  },
  leadStock: {
    name: 'Calcio di piombo',
    desc: 'Nessun contraccolpo, il doppio della spinta. Chi sbatte contro un muro si fa male. Non va d’accordo col Mulo.',
  },
  pointBlankLuck: {
    name: 'Bruciapelo fortunato',
    desc: 'Un’uccisione a bruciapelo ti rimette la cartuccia nella canna.',
  },
  doubleBang: {
    name: 'Doppio botto',
    desc: 'Con tutte e due le canne cariche, il primo colpo le spara insieme.',
  },
  leadFlight: {
    name: 'Volo di piombo',
    desc: 'Se in volo dopo uno shotgun jump uccidi qualcuno, la cartuccia ti torna indietro.',
  },
  bouncingPellets: {
    name: 'Pallini rimbalzanti',
    desc: 'I pallini che colpiscono il pavimento rimbalzano una volta.',
  },
  groupPush: {
    name: 'Spinta di gruppo',
    desc: 'La spinta a bruciapelo travolge anche chi sta dietro al primo nemico.',
  },
  duelist: {
    name: 'Duellante',
    desc: 'Dopo un secondo e mezzo senza sparare, il colpo dopo fa il doppio. Un tic ti dice quando è pronto.',
  },
  gunslingerLever: {
    name: 'Leva da pistolero',
    desc: 'Precisa anche dall’anca, e la leva gira più veloce.',
  },
  piercing: {
    name: 'Perforante',
    desc: 'Il proiettile attraversa tutti i nemici in fila.',
  },
  hawkEye: {
    name: 'Occhio di falco',
    desc: 'Mirando fino in fondo, il colpo critico vale sei volte invece di quattro.',
  },
  quickscope: {
    name: 'Quickscope',
    desc: 'Un colpo sparato appena alzi il mirino (entro 0,2 secondi) è sempre critico.',
  },
  mark: {
    name: 'Marchio',
    desc: 'Il colpo marchia il nemico: il prossimo colpo su di lui fa il doppio.',
  },
  twoAtATime: {
    name: 'Due alla volta',
    desc: 'La ricarica infila due colpi per volta.',
  },
  shortFuse: {
    name: 'Miccia corta',
    desc: 'La miccia brucia in metà tempo. Meno rimbalzi, più precisione: scoppia dove la vuoi.',
  },
  powderKeg: {
    name: 'Botte di polvere',
    desc: 'Più polvere in ogni candelotto: l’esplosione è larga il 40% in più.',
  },
  sticky: {
    name: 'Appiccicosa',
    desc: 'Il candelotto si incolla dove tocca: muro, soffitto o pavimento. Lì aspetta la miccia, o il primo dannato che ci passa.',
  },
  rocket: {
    name: 'Razzo',
    desc: 'Vola dritto e veloce per mezzo secondo e scoppia al primo contatto, anche col terreno. Ai tuoi piedi: un salto molto più alto.',
  },
  cluster: {
    name: 'A grappolo',
    desc: 'Scoppiando lancia tre candelotti più piccoli tutt’intorno, che esplodono un attimo dopo. Per le orde ammassate.',
  },
  hellBounce: {
    name: 'Rimbalzo infernale',
    desc: 'Ogni rimbalzo fa più male: +25% di danno a rimbalzo, fino a quattro. I tiri di sponda pagano.',
  },
};

/** Weapon names in the upgrade panel's title. */
const WEAPON_NAMES: Record<GearId, string> = {
  revolver: 'Revolver',
  shotgun: 'Doppietta',
  rifle: 'Carabina',
  dynamite: 'Lancia-dinamite',
  shovel: 'Badile',
};

/** What he says after a purchase, and when you can't pay. */
const THANKS = '“Affare fatto. Trattala bene, e lei tratterà bene te.”';
const CARD_THANKS = '“Ora sì che ragiona. Torna quando vuoi altro ferro buono.”';
const NO_MONEY = '“Con quei quattro spiccioli? Torna quando avrai il vildenaro, straniero.”';
/** The upgrade panel when there's nothing to choose. */
const MAXED = 'Al massimo. Nemmeno il diavolo sa fare di meglio.';
const NOTHING_LEFT = 'Per quest’arma non ho niente, per ora.';

/** Seconds the "CONFERMA" stays up waiting for the second click, then the box goes back to normal. */
const CONFIRM_TIME = 3;

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
   * Every frame. `inReach` = the shop within reach right now (null = none): it drives the prompt.
   * `wager` = the devil's table is within reach (wager.ts): the same prompt says "SCOMMETTI".
   */
  update(player: PlayerState, inReach: ShopSpawn | null, paused: boolean, wager: boolean): void;
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

/** One clickable box: a weapon in the main panel or a card in the upgrade panel. */
interface Row {
  id: PurchaseId;
  /** The weapon this row is about (a card's weapon, for a card). */
  weapon: GearId;
  /** A card is never "already yours": once bought it leaves the counter. */
  card: boolean;
  price: number;
  el: HTMLButtonElement;
  label: HTMLElement;
  /** The pending setTimeout that cancels "CONFERMA" (0 = not confirming). */
  confirmTimer: number;
  /** Not enough vildenaro (updated every frame by update()). */
  poor: boolean;
  /** A weapon you own: the box opens its upgrades instead of buying. */
  owned: boolean;
}

export function createShopMenu(options: { onCloseClick: () => void }): ShopMenu {
  const panel = document.getElementById('shop')!;
  const greeting = document.getElementById('shop-greeting')!;
  const list = document.getElementById('shop-items')!;
  const moneyEl = document.getElementById('shop-money')!;
  const upPanel = document.getElementById('shop-upgrades')!;
  const upTitle = document.getElementById('shop-upgrades-title')!;
  const upPips = document.getElementById('shop-upgrades-pips')!;
  const upList = document.getElementById('shop-upgrades-cards')!;
  const upNote = document.getElementById('shop-upgrades-note')!;
  const prompt = document.getElementById('shop-prompt')!;
  const grabHint = document.getElementById('grab-hint')!;
  const closeButton = document.getElementById('shop-close')!;
  const title = document.getElementById('shop-title')!;
  const walletLabel = document.getElementById('shop-wallet-label')!;
  const promptWord = document.getElementById('shop-prompt-word')!;
  closeButton.addEventListener('click', options.onCloseClick);
  // The key on the labels ("E · COMMERCIA", "E Chiudi") is the one bound to
  // the shop (keybinds.ts): written again whenever the keys change.
  const showKey = (): void => {
    for (const kbd of [prompt, closeButton].map((el) => el.querySelector('kbd')!)) kbd.textContent = mainKeyName('interact');
  };
  onKeybindsChange(showKey);
  showKey();
  noFocus(closeButton);
  // At a Forge the same panel shows the Forge's rows instead of the weapons (forgeMenu.ts).
  const forge = createForgeRows(noFocus);
  let forgeBuilt = false;
  // At the saloon: the barman's drinks (barMenu.ts).
  const bar = createBarRows(noFocus);

  let isOpen = false;
  let kind: ShopSpawn['kind'] = 'weapons';
  /** The weapon whose upgrade panel is open (null = closed). */
  let selected: GearId | null = null;
  /** The weapons (main panel) and the cards (upgrade panel). Their state changes every frame. */
  let rows: Row[] = [];
  let cardRows: Row[] = [];

  /** Back to the normal face (timeout, a click on another item, a purchase). */
  function cancelConfirm(r: Row): void {
    clearTimeout(r.confirmTimer);
    r.confirmTimer = 0;
    r.el.classList.remove('confirming');
  }
  function cancelAllConfirms(): void {
    for (const r of rows) cancelConfirm(r);
    for (const r of cardRows) cancelConfirm(r);
  }

  /**
   * A click on a box.
   * - A weapon you own: open (or close) its upgrade panel.
   * - Otherwise, first click: "CONFERMA" (and any other box waiting for
   *   confirmation goes back to normal). Second click: buy. Not enough money:
   *   no point in confirming, the request goes straight to the simulation,
   *   which refuses it (and the vendor has his say).
   */
  function onItemClick(r: Row): void {
    if (r.owned) {
      cancelAllConfirms();
      selected = selected === r.weapon ? null : r.weapon;
      return; // update() opens or closes the panel
    }
    if (r.poor || r.confirmTimer) {
      cancelConfirm(r);
      queueBuy(r.id); // only asks: the simulation will answer with an event
      return;
    }
    cancelAllConfirms();
    r.el.classList.add('confirming');
    r.confirmTimer = window.setTimeout(() => cancelConfirm(r), CONFIRM_TIME * 1000);
  }

  /** Builds one box (same markup for weapons and cards: two faces, see onItemClick). */
  function makeRow(
    parent: HTMLElement,
    id: PurchaseId,
    weapon: GearId,
    text: { name: string; desc: string },
    price: number,
    card: boolean,
  ): Row {
    // The whole box is ONE button (spans inside, not divs: a <button> may
    // only contain "phrasing" elements). Two faces, CSS shows one of them:
    // the item, or "CONFERMA" (class .confirming on the button).
    const row = document.createElement('button');
    row.className = card ? 'shop-item shop-card' : 'shop-item';
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
    row.querySelector('.shop-confirm-price')!.textContent = `paga ${price} vildenaro`;
    const r: Row = {
      id,
      weapon,
      card,
      price,
      el: row,
      label: row.querySelector<HTMLElement>('.shop-price')!,
      confirmTimer: 0,
      poor: false,
      owned: false,
    };
    row.addEventListener('click', () => onItemClick(r));
    noFocus(row);
    parent.append(row);
    return r;
  }

  /**
   * A string that changes whenever what a list shows changes. update()
   * compares it every frame and rebuilds a list only when it differs: cheaper
   * and simpler than tracking every way it can change (a purchase, a price
   * slider in the debug panel...). Same idea as the `key` of a list in React or Vue.
   */
  let weaponsBuiltFor = '';
  let cardsBuiltFor = '';
  function weaponsSignature(): string {
    return kind + '|' + shopCatalog(kind).map((i) => `${i.id}:${i.price}`).join('|');
  }
  function cardsSignature(player: PlayerState): string {
    if (selected === null) return '';
    const w = selected;
    return `${w}:${upgradeLevel(player, w)}:${upgradePrice(player, w)}:${upgradeOffer(player, w).join(',')}`;
  }

  /** The main panel: one box per weapon. */
  function buildWeapons(): void {
    for (const r of rows) cancelConfirm(r);
    list.replaceChildren();
    rows = shopCatalog(kind).map((item) => makeRow(list, item.id, item.id, ITEM_TEXT[item.id], item.price, false));
    weaponsBuiltFor = weaponsSignature();
  }

  /** The upgrade panel of the selected weapon: title, level, the cards on the counter. */
  function buildCards(player: PlayerState): void {
    for (const r of cardRows) cancelConfirm(r);
    upList.replaceChildren();
    cardRows = [];
    cardsBuiltFor = cardsSignature(player);
    if (selected === null) return;
    const w = selected;
    const level = upgradeLevel(player, w);
    const price = upgradePrice(player, w);
    const offer = upgradeOffer(player, w);
    upTitle.textContent = `Potenzia: ${WEAPON_NAMES[w]}`;
    // The level as pips: filled = cards bought, empty = still to buy.
    upPips.textContent = '◆'.repeat(level) + '◇'.repeat(Math.max(0, tuning.upgradeMaxLevel - level));
    upNote.hidden = price === null || offer.length === 0; // "choose one" only when there's something to choose
    if (price === null || offer.length === 0) {
      const note = document.createElement('div');
      note.className = 'shop-maxed';
      note.textContent = price === null ? MAXED : NOTHING_LEFT;
      upList.append(note);
      return;
    }
    cardRows = offer.map((card) => makeRow(upList, card, w, CARD_TEXT[card], price, true));
  }

  /** Every frame: prices in red, "POTENZIA" on your weapons, which one is selected. */
  function refreshRow(r: Row, player: PlayerState): void {
    r.owned = !r.card && ownsItem(player, r.id as ShopItemId);
    r.poor = !r.owned && !canAfford(player, r.price); // (Debito col diavolo: below zero is fine)
    r.el.classList.toggle('owned', r.owned);
    r.el.classList.toggle('poor', r.poor);
    r.el.classList.toggle('selected', r.owned && selected === r.weapon);
    if (r.owned && r.confirmTimer) cancelConfirm(r);
    r.label.textContent = r.owned ? 'POTENZIA' : String(r.price);
  }

  /** Shake a box: restart a CSS animation (remove the class, force a layout so the browser notices, add it back). */
  function shake(r: Row): void {
    r.el.classList.remove('shake');
    void r.el.offsetWidth;
    r.el.classList.add('shake');
  }

  return {
    get isOpen() {
      return isOpen;
    },
    open(k) {
      kind = k;
      isOpen = true;
      selected = null;
      title.textContent = { weapons: 'ARMERIA', forge: 'FORGIA', saloon: 'SALOON' }[k];
      walletLabel.textContent = { weapons: 'Il tuo vildenaro', forge: 'Il tuo Ferro Dannato', saloon: 'Le tue fiches' }[k];
      greeting.textContent =
        k === 'forge' ? FORGE_GREETING
        : k === 'saloon' ? BAR_GREETING
        : GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
      weaponsBuiltFor = cardsBuiltFor = ''; // built by the next update(), which has the player
      forgeBuilt = false;
      bar.reset();
      list.replaceChildren();
      panel.hidden = false;
    },
    close() {
      isOpen = false;
      selected = null;
      panel.hidden = true;
      upPanel.hidden = true;
      cancelAllConfirms(); // reopening never shows a stale "CONFERMA"
      forge.reset();
      bar.reset();
    },
    update(player, inReach, paused, wager) {
      // The prompt: next to a vendor (or the devil's table), shop closed, game running.
      prompt.hidden = isOpen || paused || (inReach === null && !wager);
      promptWord.textContent = inReach?.kind === 'forge' ? 'FORGIA' : inReach?.kind === 'saloon' ? 'ORDINA' : inReach ? 'COMMERCIA' : 'SCOMMETTI';
      if (!isOpen) return;
      if (kind === 'saloon') {
        bar.refresh(list, player);
        upPanel.hidden = true;
        moneyEl.textContent = String(player.fiches);
        return;
      }
      if (kind === 'forge') {
        if (!forgeBuilt) forge.build(list);
        forgeBuilt = true;
        upPanel.hidden = true;
        moneyEl.textContent = String(player.damnedIron);
        forge.refresh(player);
        return;
      }
      if (weaponsSignature() !== weaponsBuiltFor) buildWeapons();
      if (selected !== null && !player.owned[selected]) selected = null; // (died with the panel open)
      if (cardsSignature(player) !== cardsBuiltFor) buildCards(player);
      upPanel.hidden = selected === null;
      moneyEl.textContent = String(player.money);
      for (const r of rows) refreshRow(r, player);
      for (const r of cardRows) refreshRow(r, player);
    },
    onEvents(events) {
      const forgeLine = forge.onEvents(events);
      if (forgeLine) greeting.textContent = forgeLine;
      const barLine = bar.onEvents(events);
      if (barLine) greeting.textContent = barLine;
      for (const e of events) {
        if (e.type === 'purchase') {
          playPurchase();
          greeting.textContent = e.item in CARD_TEXT ? CARD_THANKS : THANKS;
        } else if (e.type === 'purchaseFailed' && e.reason === 'money') {
          playPurchaseDenied();
          greeting.textContent = NO_MONEY;
          const row = [...rows, ...cardRows].find((r) => r.id === e.item);
          if (row) shake(row);
        }
      }
    },
    setGrabHint(visible) {
      grabHint.hidden = !visible;
    },
  };
}
