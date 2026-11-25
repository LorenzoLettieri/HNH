// What the map events say on screen (the simulation is in src/sim/mapEvents.ts).
// A Record over every MapEventKind: a new event with no text here is a
// compile error, like the cards' CARD_TEXT in shopMenu.ts.
import type { MapEventKind } from '../sim/mapEvents';
import type { WagerCurse } from '../sim/wager';
import type { BountyModifier, BountyTarget } from '../sim/bounty';

export const MAP_EVENT_TEXT: Record<MapEventKind, { title: string; goal: string }> = {
  bells: { title: 'LE CAMPANE DEL GIUDIZIO', goal: 'suona le campane sui tetti prima che finisca l’ondata' },
  ponyExpress: { title: 'PONY EXPRESS DELL’INFERNO', goal: 'attraversa gli anelli di fuoco: ognuno ti dà qualche secondo' },
  wager: { title: 'LA SCOMMESSA DEL DIAVOLO', goal: 'un tavolo da gioco nella piazza del pozzo: scommetti sulla prossima ondata' },
  emberHeart: { title: 'IL CUORE DI BRACE', goal: 'risveglia il cristallo, resta nel suo cerchio e uccidi' },
  jackal: { title: 'LO SCIACALLO', goal: 'un diavoletto scappa col sacco del vildenaro: prendilo prima che fugga' },
  sermon: { title: 'SPETTACOLO CRUENTO', goal: 'un predicatore davanti alla chiesa vuole sangue: raggiungi HIGH NOON nel suo cerchio' },
  soulWell: { title: 'IL POZZO DELLE ANIME', goal: 'vai al pozzo nella piazza, poi portagli le anime dei nemici che uccidi' },
  bounty: { title: 'LA TAGLIA', goal: 'un ricercato è in città: uccidilo prima che finisca l’ondata' },
};

/**
 * La Taglia (src/sim/bounty.ts): the outlaw's modifier. `name` = the
 * adjective on the poster and in the HUD line, `rule` = what it means for
 * you, said plainly. A Record: a new modifier with no text is a compile error.
 */
export const BOUNTY_MODIFIER_TEXT: Record<BountyModifier, { name: string; rule: string }> = {
  swift: { name: 'LESTO', rule: 'è più veloce di tutti: corre, salta e attacca prima' },
  shielded: { name: 'CORAZZATO', rule: 'uno scudo para i colpi e ricresce se smetti di colpirlo' },
  explosive: { name: 'POLVERIERA', rule: 'ti lancia candelotti di dinamite dove stai per andare: non stare fermo' },
};

/** What kind of enemy the outlaw is, as the poster says it. */
export const BOUNTY_TARGET_TEXT: Record<BountyTarget, string> = {
  ghoul: 'GHOUL',
  eyebat: 'MALOCCHIO',
  hound: 'CANE INFERNALE',
  bull: 'TORO',
  sharpshooter: 'TIRATORE SCELTO',
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
