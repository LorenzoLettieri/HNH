// The barman's sprite (the saloon, docs/DESIGN.md §5: his drinks are the
// pacts), painted pixel by pixel like the vendor (vendorSprite.ts): a big,
// slick-haired innkeeper of hell. Two little horns through the pomade, a
// waxed handlebar mustache, glowing eyes, a black bow tie, a blood-red
// waistcoat over a white shirt with sleeve garters, a stained apron. He
// polishes a glass with a rag, forever: the animation.
//
// One frame is 32 × 64 px: at 32 px/m, 1 × 2 m. He stands behind the
// counter (1.1 m = row 29): what's below it is hidden anyway, but drawn.
// Frames: 0 and 1 = the rag on one side of the glass, then on the other.
// Coordinates: x right, y DOWN, row 63 = the floor. Light from the upper left.
import { buildSheet, PixelFrame, type SpriteSheet } from './enemies/spriteSheet';

export const BARMAN_W = 32;
export const BARMAN_H = 64;
export const BARMAN_FRAMES = 2;

const C = {
  outline: 0x0e0806,
  // skin: ruddy, sweaty, a bit too warm
  skin: 0xc48a6a,
  skinLight: 0xe0aa86,
  skinDark: 0x8a5a44,
  hair: 0x16100e,
  hairLight: 0x3a2e2a, // the shine of the pomade
  horn: 0xd8c8a0,
  hornDark: 0x8a7a58,
  eye: 0xff4018,
  mouth: 0x2a0806,
  // clothes
  shirt: 0xd8d0bc,
  shirtDark: 0xa49c88,
  garter: 0x9a1c14,
  vest: 0x7a1414,
  vestDark: 0x4a0a0a,
  vestLight: 0xa02a22,
  bow: 0x141010,
  apron: 0xc8c0aa,
  apronDark: 0x8e8672,
  stain: 0x6a2a1a,
  pants: 0x2a2424,
  boots: 0x181210,
  brass: 0xc89a40,
  // the glass and the rag
  glass: 0x9ab8b0,
  glassLight: 0xe8fff8,
  whiskey: 0xd07a20,
  rag: 0xb8ae98,
};

function paint(frame: number): PixelFrame {
  const f = new PixelFrame(BARMAN_W, BARMAN_H);

  // Legs and boots (behind the counter, but the silhouette needs them).
  f.rect(11, 50, 4, 10, C.pants);
  f.rect(17, 50, 4, 10, C.pants);
  f.rect(10, 60, 5, 4, C.boots);
  f.rect(17, 60, 5, 4, C.boots);

  // A big body: shirt, waistcoat over it, belly.
  f.rect(6, 23, 20, 5, C.shirt); // shoulders
  f.rect(7, 28, 18, 22, C.vest);
  f.rect(6, 34, 20, 12, C.vest); // the belly sticks out a bit
  f.rect(7, 28, 1, 22, C.vestLight); // lit side
  f.rect(24, 28, 1, 22, C.vestDark); // shaded side
  f.rect(15, 28, 2, 18, C.shirt); // the waistcoat is open in the middle...
  for (const y of [30, 34, 38, 42]) {
    f.set(14, y, C.brass); // ...brass buttons on its edge
  }
  f.rect(9, 27, 14, 1, C.vestDark); // the waistcoat's collar line
  // The apron, tied high, with a stain or two.
  f.rect(8, 40, 16, 14, C.apron);
  f.rect(8, 40, 16, 1, C.apronDark); // the string
  f.rect(22, 41, 2, 13, C.apronDark);
  f.rect(11, 45, 2, 2, C.stain);
  f.set(19, 49, C.stain);
  // Bow tie.
  f.rect(13, 24, 6, 2, C.bow);
  f.set(16, 24, C.garter);

  // Arms: white sleeves rolled to the elbow with red garters, forearms
  // forward to the glass held in front of the belly (above the counter).
  f.limb(7, 24, 5, 31, 4, C.shirt, C.shirtDark); // left upper arm (on screen)
  f.rect(4, 29, 4, 1, C.garter);
  f.limb(25, 24, 27, 31, 4, C.shirt, C.shirtDark); // right upper arm
  f.rect(25, 29, 4, 1, C.garter);
  f.limb(6, 32, 12, 30, 3, C.skin, C.skinDark); // forearms to the middle
  f.limb(26, 32, 19, 30, 3, C.skin, C.skinDark);
  // The glass: a whiskey tumbler, whiskey glowing a little.
  f.rect(13, 25, 6, 6, C.glass);
  f.rect(13, 28, 6, 3, C.whiskey);
  for (let x = 14; x < 18; x++) f.set(x, 28, C.whiskey, true); // only the surface glows: the whole glass was a blob
  f.set(14, 26, C.glassLight);
  f.set(14, 27, C.glassLight);
  // The rag, on one side of the glass or the other: he polishes it.
  const rx = frame === 0 ? 10 : 17;
  f.rect(rx, 26, 5, 4, C.rag);
  f.set(rx + 1, 30, C.rag);
  f.set(rx + 3, 30, C.rag);

  // Head: broad, ruddy, with a double chin.
  f.rect(10, 10, 12, 12, C.skin);
  f.rect(11, 22, 10, 1, C.skinDark); // the double chin's shadow
  f.rect(10, 10, 1, 12, C.skinLight);
  f.rect(21, 10, 1, 12, C.skinDark);
  // Slick black hair, parted in the middle, shining with pomade.
  f.rect(10, 7, 12, 4, C.hair);
  f.rect(12, 7, 3, 1, C.hairLight);
  f.rect(17, 7, 3, 1, C.hairLight);
  f.set(16, 7, C.skin); // the parting
  // Two small horns through the pomade.
  f.rect(10, 4, 2, 3, C.horn);
  f.set(9, 3, C.horn);
  f.set(11, 6, C.hornDark);
  f.rect(20, 4, 2, 3, C.horn);
  f.set(22, 3, C.horn);
  f.set(20, 6, C.hornDark);
  // Eyes under heavy brows, a burning point in each (glow).
  f.rect(12, 13, 3, 1, C.hair);
  f.rect(17, 13, 3, 1, C.hair);
  f.set(13, 14, C.eye, true);
  f.set(18, 14, C.eye, true);
  // The nose, and the waxed handlebar mustache curling up past the cheeks.
  f.rect(15, 15, 2, 3, C.skinDark);
  f.rect(12, 18, 8, 1, C.hair);
  f.rect(10, 17, 2, 1, C.hair);
  f.rect(20, 17, 2, 1, C.hair);
  f.set(9, 16, C.hair);
  f.set(22, 16, C.hair);
  // A thin smile under it.
  f.rect(14, 20, 4, 1, C.mouth);

  f.outline(C.outline);
  return f;
}

export function barmanSheet(): SpriteSheet {
  return buildSheet([paint(0), paint(1)]);
}
