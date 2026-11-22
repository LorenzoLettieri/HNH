// The Damned Smith's sprite, painted pixel by pixel (PLACEHOLDER: one view,
// the front, and few frames; the real sprite comes in a later step).
// 48 × 96 px at 32 px per meter = 1.5 × 3 m. Coordinates: x right, y DOWN,
// row 95 = the floor.
//
// What must match the simulation: the HEAD is above smithHeadHeight (2.25 m
// = 72 px above the floor = row 24). Everything above row 24 is the helmet:
// where you see the helmet, a hit is critical.
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 48;
export const FRAME_H = 96;
export const FRAMES = { walk: [0, 1], windup: 2, slam: 3, dead: 4 } as const;
export const SMITH_FRAME_COUNT = 5;

const C = {
  outline: 0x0c0806,
  iron: 0x4a4650,
  ironLight: 0x76727e,
  ironDark: 0x2a2830,
  leather: 0x6a4024,
  leatherDark: 0x442810,
  wood: 0x5a3a20,
  ember: 0xff5a18,
  hot: 0xffc060,
};

/** Row where the head starts (above it: helmet = critical zone). */
const NECK = 24;

/** The helmet: a black iron bucket with a glowing eye slit and rivets. */
function head(f: PixelFrame, dx = 0): void {
  f.rect(15 + dx, 8, 18, 16, C.iron);
  f.rect(15 + dx, 8, 18, 2, C.ironLight); // the rim catches the light
  f.rect(31 + dx, 10, 2, 14, C.ironDark);
  f.rect(17 + dx, 15, 14, 2, C.ironDark); // the slit's shadow...
  for (let x = 18; x < 30; x++) f.set(x + dx, 15, x % 3 === 0 ? C.hot : C.ember, true); // ...and the fire behind it
  for (const x of [17, 24, 30]) f.set(x + dx, 20, C.ironLight);
}

/** Torso: wide iron shoulders, a leather apron, red-hot cracks on the chest plate. */
function torso(f: PixelFrame): void {
  f.rect(6, NECK, 36, 8, C.iron); // pauldrons
  f.rect(6, NECK, 36, 2, C.ironLight);
  f.rect(11, NECK + 6, 26, 26, C.ironDark); // chest
  f.rect(14, NECK + 12, 20, 26, C.leather); // apron
  f.rect(14, NECK + 12, 2, 26, C.leatherDark);
  for (const [x, y] of [[20, 31], [21, 32], [22, 33], [26, 30], [27, 31], [25, 33]]) f.set(x, y, C.ember, true);
}

/** Legs, apart, with heavy boots; `stride` moves one forward (the walk). */
function legs(f: PixelFrame, stride: number): void {
  f.limb(19, 62, 17 - stride, 90, 6, C.ironDark, C.outline);
  f.limb(29, 62, 31 + stride, 90, 6, C.ironDark, C.outline);
  f.rect(13 - stride, 89, 9, 6, C.iron);
  f.rect(27 + stride, 89, 9, 6, C.iron);
}

/** The hammer: a wooden handle from (x0, y0) to (x1, y1), a big iron head at the end. */
function hammer(f: PixelFrame, x0: number, y0: number, x1: number, y1: number, hotEdge: boolean): void {
  f.limb(x0, y0, x1, y1, 3, C.wood, C.leatherDark);
  f.rect(x1 - 7, y1 - 5, 14, 10, C.iron);
  f.rect(x1 - 7, y1 - 5, 14, 2, C.ironLight);
  if (hotEdge) for (let x = x1 - 7; x < x1 + 7; x++) f.set(x, y1 + 4, C.hot, true);
}

function walk(stride: number): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  legs(f, stride);
  torso(f);
  head(f);
  f.limb(9, 30, 7, 52, 6, C.iron, C.ironDark); // left arm
  f.limb(39, 30, 41, 52, 6, C.iron, C.ironDark); // right arm, holding the hammer down by its side
  hammer(f, 41, 50, 41, 78, false);
  f.outline(C.outline);
  return f;
}

/** Hammer raised high over the helmet with both arms: the warning. */
function windup(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  legs(f, 2);
  torso(f);
  f.limb(10, 30, 18, 12, 6, C.iron, C.ironDark);
  f.limb(38, 30, 30, 12, 6, C.iron, C.ironDark);
  hammer(f, 24, 12, 24, 4, true); // the head glows: it's coming
  head(f);
  f.outline(C.outline);
  return f;
}

/** The hammer smashed into the ground in front of it, bent forward. */
function slam(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  legs(f, 4);
  f.rect(6, NECK + 4, 36, 8, C.iron); // shoulders lower: it's bent over
  f.rect(11, NECK + 10, 26, 24, C.ironDark);
  f.rect(14, NECK + 16, 20, 22, C.leather);
  head(f, 0);
  f.limb(10, 36, 22, 66, 6, C.iron, C.ironDark);
  f.limb(38, 36, 26, 66, 6, C.iron, C.ironDark);
  hammer(f, 24, 64, 24, 89, true);
  f.outline(C.outline);
  return f;
}

/** A heap of armor on the ground, the helmet rolled to one side. */
function dead(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  f.rect(4, 80, 40, 15, C.ironDark);
  f.rect(8, 76, 26, 8, C.iron);
  f.rect(12, 82, 18, 10, C.leather);
  f.rect(34, 84, 12, 11, C.iron); // the helmet
  f.set(37, 89, C.ember, true);
  f.limb(2, 93, 22, 88, 3, C.wood, C.leatherDark); // the hammer handle
  f.outline(C.outline);
  return f;
}

/** All the frames in a sheet, in the order of FRAMES. */
export function smithSheet(): SpriteSheet {
  return buildSheet([walk(-3), walk(3), windup(), slam(), dead()]);
}
