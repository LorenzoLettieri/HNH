// The preacher's sprite ("Spettacolo Cruento", src/sim/sermon.ts), painted
// pixel by pixel like the barman (barmanSprite.ts): a gaunt hellfire
// preacher, more corpse than man. A wide flat-brimmed black hat with a
// blood-red band, grey-green skin pulled over the skull, burning eyes deep
// in their sockets, the white preacher's bands under the chin (with a drop
// of blood on them), a long black frock coat over a red waistcoat, and his
// book: red leather, a gold cross on the cover.
//
// One frame is 32 × 64 px: at 32 px/m, 1 × 2 m. He stands on his soapbox
// (render/sermon.ts puts the sprite on top of it).
// Frames:
//   0 = asleep: reading, head down, the book open in both hands;
//   1 = preaching: the book against his chest, the other arm up, a finger to the sky;
//   2 = ecstasy ("AMEN!"): both arms up in a V, the book held high, mouth open.
// Coordinates: x right, y DOWN, row 63 = his feet. Light from the upper left.
// paintPreacherFrames() doesn't touch the DOM: it can be painted outside the
// browser for a preview.
import { buildSheet, PixelFrame, type SpriteSheet } from './enemies/spriteSheet';

export const PREACHER_W = 32;
export const PREACHER_H = 64;
export const PREACHER_FRAMES = 3;
/** The frames by name (render/sermon.ts picks one from the state of the show). */
export const PREACHER_FRAME = { reading: 0, preaching: 1, ecstasy: 2 } as const;

const C = {
  outline: 0x0a0608,
  // skin: a corpse's, grey-green, stretched over the bones
  skin: 0x8a9482,
  skinLight: 0xb0b8a4,
  skinDark: 0x56604e,
  socket: 0x1a1414,
  eye: 0xff3412,
  mouth: 0x200606,
  teeth: 0xd8d0b0,
  // the hat
  hat: 0x161012,
  hatLight: 0x302628,
  hatBand: 0x7a0e0e,
  // clothes
  coat: 0x1c1618,
  coatLight: 0x342a2e,
  coatDark: 0x0c0809,
  bands: 0xe8e2d2,
  bandsDark: 0xa8a090,
  blood: 0xa01010,
  vest: 0x6e0c0c,
  vestDark: 0x420606,
  brass: 0xc8982e,
  pants: 0x221c1e,
  boots: 0x120c0c,
  // the book
  cover: 0x7e1212,
  coverDark: 0x4a0808,
  pages: 0xe0d4b0,
  pagesDark: 0xa89c7c,
  gold: 0xe0b038,
};

/** The book closed, its spine on the left: `w` × `h` with the gold cross (glowing a little). */
function closedBook(f: PixelFrame, x: number, y: number, w: number, h: number): void {
  f.rect(x, y, w, h, C.cover);
  f.rect(x, y, 1, h, C.coverDark); // the spine
  f.rect(x + 1, y + h - 1, w - 1, 1, C.pagesDark); // the page edges at the bottom
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2) - 1;
  f.set(cx, cy - 2, C.gold, true);
  f.set(cx, cy - 1, C.gold, true);
  f.set(cx, cy, C.gold, true);
  f.set(cx, cy + 1, C.gold, true);
  f.set(cx - 1, cy - 1, C.gold, true);
  f.set(cx + 1, cy - 1, C.gold, true);
}

/** The head: skull-like face under the hat. `down` = 1 when he reads (eyes lower, half shut), `shout` = mouth open. */
function head(f: PixelFrame, down: number, shout: boolean): void {
  // Neck, thin, and the face: long, cheeks sunken.
  f.rect(14, 17, 4, 3, C.skinDark);
  f.rect(12, 8, 8, 9, C.skin);
  f.rect(13, 17, 6, 1, C.skin); // a narrow chin: the corners are cut
  f.rect(12, 8, 1, 9, C.skinLight); // lit side
  f.rect(19, 8, 1, 9, C.skinDark); // shaded side
  f.rect(13, 13 + down, 1, 2, C.skinDark); // sunken cheeks
  f.rect(18, 13 + down, 1, 2, C.skinDark);
  // The sockets, dark, and the burning eyes in them (half shut when he reads).
  f.rect(13, 10 + down, 2, 2, C.socket);
  f.rect(17, 10 + down, 2, 2, C.socket);
  if (down) {
    f.set(14, 11 + down, C.eye, true);
    f.set(17, 11 + down, C.eye, true);
  } else {
    f.set(13, 11, C.eye, true);
    f.set(14, 11, C.eye, true);
    f.set(17, 11, C.eye, true);
    f.set(18, 11, C.eye, true);
  }
  f.set(16, 12 + down, C.skinDark); // the nose: two holes, almost a skull's
  f.set(15, 13 + down, C.skinDark);
  if (shout) {
    // Wide open: a dark hole with the teeth on top and bottom.
    f.rect(14, 14, 4, 3, C.mouth);
    f.rect(14, 14, 4, 1, C.teeth);
    f.set(15, 16, C.teeth);
    f.set(17, 16, C.teeth);
  } else {
    f.rect(14, 15 + down, 4, 1, C.mouth); // a thin, grim line
    f.set(14, 16 + down, C.skinDark);
  }
  // The hat: a tall flat crown with a red band, a wide flat brim casting a shadow on the forehead.
  f.rect(11, 1, 10, 5, C.hat);
  f.rect(12, 1, 3, 1, C.hatLight);
  f.rect(11, 5, 10, 1, C.hatBand);
  f.rect(5, 6, 22, 2, C.hat);
  f.rect(5, 6, 8, 1, C.hatLight);
  f.rect(12, 8, 8, 1, C.skinDark); // the brim's shadow
}

/** Coat, waistcoat, bands, legs: the same in every frame. */
function body(f: PixelFrame): void {
  // Legs and boots, thin, between the coat tails.
  f.rect(12, 52, 3, 9, C.pants);
  f.rect(17, 52, 3, 9, C.pants);
  f.rect(11, 60, 4, 4, C.boots);
  f.rect(17, 60, 5, 4, C.boots);
  // The frock coat: narrow shoulders, long, the tails flaring out to the knees.
  f.rect(9, 20, 14, 4, C.coat); // shoulders
  f.rect(10, 24, 12, 22, C.coat);
  f.rect(9, 44, 6, 12, C.coat); // the tails
  f.rect(17, 44, 6, 12, C.coat);
  f.set(8, 55, C.coat);
  f.set(23, 55, C.coat);
  f.rect(9, 20, 1, 36, C.coatLight); // lit edge
  f.rect(22, 20, 1, 36, C.coatDark); // shaded edge
  f.rect(15, 46, 2, 6, C.coatDark); // the slit between the tails
  // The red waistcoat under the open coat, brass buttons.
  f.rect(13, 22, 6, 20, C.vest);
  f.rect(18, 22, 1, 20, C.vestDark);
  for (const y of [26, 30, 34, 38]) f.set(15, y, C.brass);
  f.rect(12, 22, 1, 22, C.coatLight); // the lapels
  f.rect(19, 22, 1, 22, C.coatDark);
  // The preacher's bands: two white tabs under the chin, a drop of blood on one.
  f.rect(15, 20, 1, 5, C.bands);
  f.rect(16, 20, 1, 5, C.bandsDark);
  f.set(15, 23, C.blood);
}

function paint(frame: number): PixelFrame {
  const f = new PixelFrame(PREACHER_W, PREACHER_H);
  body(f);

  if (frame === PREACHER_FRAME.reading) {
    head(f, 1, false);
    // Both forearms forward to the book, open in front of the belly.
    f.limb(10, 22, 9, 30, 3, C.coat, C.coatDark);
    f.limb(22, 22, 23, 30, 3, C.coat, C.coatDark);
    f.limb(10, 31, 12, 31, 2, C.skin, C.skinDark); // the hands under the cover
    f.limb(22, 31, 20, 31, 2, C.skin, C.skinDark);
    f.rect(11, 28, 10, 4, C.cover); // the cover, open
    f.rect(12, 27, 4, 3, C.pages); // two pages
    f.rect(16, 27, 4, 3, C.pages);
    f.rect(16, 27, 1, 3, C.pagesDark); // the fold
    f.rect(13, 28, 2, 1, C.pagesDark); // lines of text
    f.rect(17, 28, 2, 1, C.pagesDark);
  } else if (frame === PREACHER_FRAME.preaching) {
    head(f, 0, false);
    // Left (on screen): the book held against the chest.
    f.limb(10, 22, 8, 30, 3, C.coat, C.coatDark);
    f.limb(8, 30, 11, 32, 2, C.skin, C.skinDark);
    closedBook(f, 9, 26, 6, 8);
    // Right: the arm up, a bony finger to the sky.
    f.limb(22, 22, 26, 15, 3, C.coat, C.coatDark);
    f.limb(26, 15, 27, 8, 3, C.coat, C.coatDark);
    f.rect(26, 5, 3, 3, C.skin); // the fist
    f.set(26, 5, C.skinLight);
    f.rect(27, 1, 1, 4, C.skin); // the finger
  } else {
    head(f, 0, true);
    // Both arms up in a V: the book high in the left hand, the right hand open.
    f.limb(10, 22, 6, 14, 3, C.coat, C.coatDark);
    f.limb(6, 14, 4, 8, 3, C.coat, C.coatDark);
    f.rect(3, 6, 3, 2, C.skin);
    closedBook(f, 1, 0, 6, 7);
    f.limb(22, 22, 26, 14, 3, C.coat, C.coatDark);
    f.limb(26, 14, 28, 8, 3, C.coat, C.coatDark);
    f.rect(27, 5, 3, 3, C.skin); // the open hand, fingers spread
    f.set(26, 4, C.skin);
    f.set(28, 3, C.skin);
    f.set(30, 4, C.skin);
  }

  f.outline(C.outline);
  return f;
}

/** The frames, as pixels (no DOM): for buildSheet, or for a preview outside the browser. */
export function paintPreacherFrames(): PixelFrame[] {
  return [paint(0), paint(1), paint(2)];
}

export function preacherSheet(): SpriteSheet {
  return buildSheet(paintPreacherFrames());
}
