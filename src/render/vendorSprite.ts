// The vendor's sprite, painted pixel by pixel like the enemies: an infernal
// merchant with a tall top hat, a long frock coat over a mustard waistcoat,
// a gold watch chain, glowing eyes, a grin full of gold teeth, and a
// MECHANICAL right arm in brass (an elbow gear, a piston, a three-finger claw).
// He stands behind his counter: hands resting at counter height (1 m = row 31).
//
// One frame is 32 × 64 px: at 32 px/m, 1 × 2 m (hat included). Frames:
//   0: still   1: the claw's fingers raised (he drums them on the counter,
//                impatient: the animation is in vendors.ts)
// Coordinates: x right, y DOWN, row 63 = the floor. Light from the upper left.
import { buildSheet, PixelFrame, type SpriteSheet } from './enemies/spriteSheet';

export const VENDOR_W = 32;
export const VENDOR_H = 64;
export const VENDOR_FRAMES = 2;

const C = {
  outline: 0x0e0806,
  // top hat
  hat: 0x1c1618,
  hatLight: 0x3a3236,
  band: 0x6a1a14,
  // face: pale, a bit grey, not quite alive
  skin: 0xb4aa98,
  skinDark: 0x7a6e60,
  skinLight: 0xd4ccb8,
  eye: 0xff4018,
  mouth: 0x1a0806,
  gold: 0xe0a830,
  goldLight: 0xffe890,
  hair: 0x221a16,
  // frock coat (oxblood, almost black) and waistcoat (mustard)
  coat: 0x3a1a1c,
  coatDark: 0x240e10,
  coatLight: 0x5a2a2a,
  vest: 0x9a7a28,
  vestDark: 0x6a5218,
  shirt: 0xd8d0bc,
  pants: 0x2a2424,
  boots: 0x181210,
  // the mechanical arm
  brass: 0xc89a40,
  brassLight: 0xf0d878,
  brassDark: 0x7a5a20,
  steam: 0xd8d4cc,
};

/** A gear: a disc with teeth around it (every other pixel of the rim) and a dark hub. */
function gear(f: PixelFrame, cx: number, cy: number): void {
  for (let y = -3; y <= 3; y++) {
    for (let x = -3; x <= 3; x++) {
      const d = Math.hypot(x, y);
      if (d <= 2.2) f.set(cx + x, cy + y, x + y < 0 ? C.brassLight : C.brass);
      else if (d <= 3.2 && (x + y) % 2 === 0) f.set(cx + x, cy + y, C.brassDark); // teeth
    }
  }
  f.set(cx, cy, C.brassDark); // the hub
}

function paint(tapping: boolean): PixelFrame {
  const f = new PixelFrame(VENDOR_W, VENDOR_H);

  // Legs and boots (mostly hidden by the counter, but the silhouette needs them).
  f.rect(12, 50, 3, 10, C.pants);
  f.rect(17, 50, 3, 10, C.pants);
  f.rect(11, 60, 5, 4, C.boots);
  f.rect(16, 60, 5, 4, C.boots);

  // Frock coat: shoulders, then a long body with tails down to the knees.
  f.rect(7, 24, 18, 4, C.coat);
  f.rect(8, 28, 16, 28, C.coat);
  f.rect(8, 24, 1, 32, C.coatLight); // lit side
  f.rect(23, 26, 1, 30, C.coatDark); // shaded side
  // The coat is open in front: waistcoat, then trousers below it.
  f.rect(13, 27, 6, 17, C.vest);
  f.rect(18, 27, 1, 17, C.vestDark);
  f.rect(13, 44, 6, 12, C.pants);
  // Lapels: two dark diagonals from the collar down to the waistcoat.
  for (let i = 0; i < 6; i++) {
    f.set(13 + Math.floor(i / 2), 25 + i, C.coatLight);
    f.set(18 - Math.floor(i / 2), 25 + i, C.coatDark);
  }
  f.rect(15, 24, 2, 3, C.shirt); // shirt collar
  f.set(15, 26, C.band); // and a red cravat
  f.set(16, 26, C.band);
  // Brass buttons and the gold watch chain (it catches the light: glow).
  for (const y of [31, 34, 37, 40]) f.set(15, y, C.brass);
  for (let x = 13; x <= 18; x++) f.set(x, 36 + (x === 13 || x === 18 ? 0 : 1), x % 2 ? C.gold : C.goldLight, x === 14);

  // Left arm (on screen): the sleeve goes down and forward, the hand rests
  // on the counter holding a coin (a glint of gold).
  f.limb(8, 26, 6, 30, 3, C.coat, C.coatDark);
  f.limb(6, 30, 10, 32, 3, C.coat, C.coatDark);
  f.rect(10, 31, 3, 2, C.skin);
  f.set(12, 30, C.goldLight, true); // the coin

  // Right arm: brass. Upper arm, the elbow gear, a piston forward to the claw.
  f.limb(23, 26, 26, 30, 3, C.brass, C.brassDark);
  f.limb(26, 31, 21, 32, 2, C.brassDark, C.brassDark); // the piston rod
  f.rect(21, 31, 3, 2, C.brass); // the wrist
  gear(f, 26, 30);
  // The claw: three fingers resting on the counter... or lifted (drumming).
  const fy = tapping ? 30 : 33;
  for (const x of [19, 21, 23]) f.rect(x, fy, 1, 2, x === 19 ? C.brassLight : C.brass);
  if (tapping) {
    // A puff of steam from the elbow: the arm works on pressure.
    f.set(28, 27, C.steam);
    f.set(29, 26, C.steam);
    f.set(28, 25, C.steam);
  }

  // Head: long and narrow, pale, sunken cheeks.
  f.rect(11, 12, 10, 11, C.skin);
  f.rect(12, 23, 8, 1, C.skin); // jaw
  f.rect(11, 12, 1, 11, C.skinLight);
  f.rect(20, 12, 1, 11, C.skinDark);
  f.rect(12, 18, 1, 3, C.skinDark); // cheekbones
  f.rect(19, 18, 1, 3, C.skinDark);
  // Eyes: dark sockets with a burning point (glow).
  f.rect(12, 15, 3, 2, C.skinDark);
  f.rect(17, 15, 3, 2, C.skinDark);
  f.set(13, 15, C.eye, true);
  f.set(18, 15, C.eye, true);
  // A thin mustache curled up at the ends, and a pointed goatee.
  f.rect(13, 19, 6, 1, C.hair);
  f.set(12, 18, C.hair);
  f.set(19, 18, C.hair);
  f.rect(15, 23, 2, 2, C.hair);
  f.set(15, 25, C.hair);
  // The grin: a dark mouth full of gold teeth. No glow on them: in the
  // glow color they'd read as a second pair of eyes.
  f.rect(13, 21, 6, 1, C.mouth);
  for (const x of [13, 15, 16, 18]) f.set(x, 21, C.gold);

  // Top hat: crown, a red band, and a wide brim.
  f.rect(11, 1, 10, 10, C.hat);
  f.rect(11, 1, 1, 10, C.hatLight);
  f.rect(11, 8, 10, 2, C.band);
  f.set(19, 8, C.brass); // a small brass buckle on the band
  f.set(19, 9, C.brass);
  f.rect(8, 11, 16, 1, C.hat);
  f.rect(9, 11, 3, 1, C.hatLight);

  f.outline(C.outline);
  return f;
}

export function vendorSheet(): SpriteSheet {
  return buildSheet([paint(false), paint(true)]);
}
