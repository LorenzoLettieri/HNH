// What the map events say on screen (the simulation is in src/sim/mapEvents.ts).
// A Record over every MapEventKind: a new event with no text here is a
// compile error, like the cards' CARD_TEXT in shopMenu.ts.
import type { MapEventKind } from '../sim/mapEvents';

export const MAP_EVENT_TEXT: Record<MapEventKind, { title: string; goal: string }> = {
  bells: { title: 'LE CAMPANE DEL GIUDIZIO', goal: 'suona le campane sui tetti prima che finisca l’ondata' },
};
