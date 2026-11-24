// What the map events say on screen (the simulation is in src/sim/mapEvents.ts).
// A Record over every MapEventKind: a new event with no text here is a
// compile error, like the cards' CARD_TEXT in shopMenu.ts.
import type { MapEventKind } from '../sim/mapEvents';
import type { WagerCurse } from '../sim/wager';

export const MAP_EVENT_TEXT: Record<MapEventKind, { title: string; goal: string }> = {
  bells: { title: 'LE CAMPANE DEL GIUDIZIO', goal: 'suona le campane sui tetti prima che finisca l’ondata' },
  ponyExpress: { title: 'PONY EXPRESS DELL’INFERNO', goal: 'attraversa gli anelli di fuoco: ognuno ti dà qualche secondo' },
  wager: { title: 'LA SCOMMESSA DEL DIAVOLO', goal: 'un tavolo da gioco nella piazza del pozzo: scommetti sulla prossima ondata' },
  emberHeart: { title: 'IL CUORE DI BRACE', goal: 'risveglia il cristallo, resta nel suo cerchio e uccidi' },
  jackal: { title: 'LO SCIACALLO', goal: 'un diavoletto scappa col sacco del vildenaro: prendilo prima che fugga' },
};

/**
 * The devil's stakes (wager.ts): `name` for the HUD line and the banners,
 * `rule` = what it does to you, said plainly. A Record again: a new curse
 * with no text is a compile error.
 */
export const WAGER_CURSE_TEXT: Record<WagerCurse, { name: string; rule: string }> = {
  noMedkits: { name: 'NIENTE MEDIKIT', rule: 'per tutta l’ondata i medikit non cadono e non curano' },
  oneGun: { name: 'UNA SOLA ARMA', rule: 'per tutta l’ondata tieni l’arma che hai in mano' },
  fastEnemies: { name: 'NEMICI PIÙ VELOCI', rule: 'per tutta l’ondata il tempo dei nemici corre più veloce' },
  darkness: { name: 'BUIO', rule: 'per tutta l’ondata è notte fonda, e la mappa non mostra i nemici' },
};
