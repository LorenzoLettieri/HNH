// What the relics say on screen (src/sim/relics.ts): the name, and what ONE
// copy does (the HUD's toast shows it when you get one). A relic without its
// text doesn't compile (Record<RelicId, ...>).
import type { RelicId } from '../sim/relics';

export const RELIC_TEXT: Record<RelicId, { name: string; effect: string }> = {
  banditHeart: { name: 'Cuore del bandito', effect: '+15 salute massima' },
  tannedHide: { name: 'Pelle conciata', effect: 'meno danni subiti' },
  finePowder: { name: 'Polvere fine', effect: '+10% danno di tutte le armi' },
  gunslingerBelt: { name: 'Cinturone del pistolero', effect: '+25% munizioni in tasca' },
  buckskinGloves: { name: 'Guanti di daino', effect: 'ricariche più veloci' },
  prospectorMagnet: { name: 'Calamita del cercatore', effect: 'raccogli da più lontano' },
  rabbitFoot: { name: 'Zampa di coniglio', effect: 'più munizioni e medikit dai nemici' },
  coldBlood: { name: 'Sangue freddo', effect: 'la salute torna da sola, piano' },
};
