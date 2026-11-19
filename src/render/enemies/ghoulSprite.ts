// The ghoul's sprite sheet, painted pixel by pixel: an undead cowboy with a
// hat, a tattered duster coat, greenish skin and glowing eyes.
// Seen from the front (it always faces you while chasing), like Doom's sprites.
//
// One frame is 32 × 60 px: at our 32 px/m it's 1 × 1.875 m, the same texel
// density as the level. Frames, left to right:
//   0-3: walk cycle   4: attack wind-up   5: attack swipe   6: hurt
//   7: headless (killed by a headshot)
import { seededRandom } from '../props/pixelCanvas';
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 32;
export const FRAME_H = 60;
export const FRAMES = { walk: [0, 1, 2, 3], windup: 4, swipe: 5, hurt: 6, headless: 7 };
const FRAME_COUNT = 8;

const C = {
  outline: 0x120a08,
  skin: 0x8a9a6c,
  skinDark: 0x5c6a48,
  skinLight: 0xaab88a,
  coat: 0x4a3a2c,
  coatDark: 0x2e241c,
  coatLight: 0x5e4a38,
  shirt: 0x7a6a50,
  shirtDark: 0x564836,
  pants: 0x3a322a,
  boots: 0x241c16,
  hat: 0x3a2a1e,
  hatDark: 0x261a12,
  band: 0x6a2418,
  mouth: 0x1a0806,
  teeth: 0xd8d0b0,
  blood: 0x6a0c08,
  eye: 0xffc060,
};

/** One pose of the body: everything the frames differ in. */
interface Pose {
  /** Hands' positions (pixel coordinates in the frame). */
  handL: [number, number];
  handR: [number, number];
  /** How many pixels each foot is lifted (walking). */
  liftL: number;
  liftR: number;
  /** Whole body shifted down by this (the bounce of the walk). */
  bob: number;
  /** Mouth open (attack, hurt). */
  mouthOpen: boolean;
  /** Head tilted sideways by this many pixels (hurt). */
  headShift: number;
  /** No head at all: a bloody neck stump instead (headshot kill). */
  headless?: boolean;
}

function paint(pose: Pose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const rand = seededRandom(7);
  const b = pose.bob;

  // Legs: pants, then boots; a lifted foot is drawn higher and shorter.
  for (const [x, lift] of [[11, pose.liftL], [17, pose.liftR]] as const) {
    f.rect(x, 40 + b, 4, 15 - lift, C.pants);
    f.rect(x, 40 + b, 1, 15 - lift, C.coatDark); // inner shadow
    f.rect(x - 1, 55 - lift + b, 6, 4, C.boots);
  }

  // Coat: shoulders, body, and two tattered flaps hanging down.
  f.rect(8, 18 + b, 16, 4, C.coat);
  f.rect(9, 22 + b, 14, 18, C.coat);
  for (let x = 8; x < 24; x++) {
    if (x > 12 && x < 19) continue; // open front
    const ragged = Math.floor(rand() * 4); // tattered hem: each column a different length
    f.rect(x, 40 + b, 1, 3 + ragged, x < 10 || x > 21 ? C.coatDark : C.coat);
  }
  f.rect(8, 18 + b, 1, 22, C.coatLight); // light from the left
  // Shirt, visible through the open coat, with blood stains.
  f.rect(13, 20 + b, 6, 20, C.shirt);
  f.rect(15, 21 + b, 1, 18, C.shirtDark); // button line
  for (let i = 0; i < 9; i++) f.set(13 + rand() * 6, 24 + b + rand() * 14, C.blood);

  // Head (shifted sideways when hurt)... or a neck stump with blood spurting.
  const hx = 11 + pose.headShift;
  const hy = 6 + b;
  if (pose.headless) {
    f.rect(hx + 3, hy + 9, 4, 3, C.skinDark); // neck
    f.rect(hx + 3, hy + 9, 4, 1, C.blood);
    for (let i = 0; i < 10; i++) f.set(hx + 2 + rand() * 6, hy + 8 - rand() * 9, C.blood); // spurt
  } else {
  f.rect(hx, hy, 10, 10, C.skin);
  f.rect(hx + 1, hy + 10, 8, 2, C.skin); // chin
  f.rect(hx, hy, 1, 10, C.skinDark);
  f.rect(hx + 9, hy, 1, 10, C.skinLight);
  // Sunken eye sockets with glowing pupils.
  f.rect(hx + 1, hy + 3, 3, 3, C.skinDark);
  f.rect(hx + 6, hy + 3, 3, 3, C.skinDark);
  f.set(hx + 2, hy + 4, C.eye, true);
  f.set(hx + 7, hy + 4, C.eye, true);
  f.set(hx + 4, hy + 6, C.skinDark);
  f.set(hx + 5, hy + 7, C.skinDark); // nose hole
  // Mouth: a grin of teeth, or a gaping hole.
  if (pose.mouthOpen) {
    f.rect(hx + 3, hy + 8, 4, 4, C.mouth);
    f.set(hx + 3, hy + 8, C.teeth);
    f.set(hx + 6, hy + 8, C.teeth);
    f.set(hx + 4, hy + 11, C.blood);
  } else {
    f.rect(hx + 2, hy + 8, 6, 2, C.mouth);
    for (let i = 0; i < 6; i += 2) f.set(hx + 2 + i, hy + 8, C.teeth);
  }
  // Hat: wide brim and a dented crown with a band.
  f.rect(hx - 4, hy - 1, 18, 2, C.hat);
  f.rect(hx - 4, hy, 18, 1, C.hatDark);
  f.rect(hx - 1, hy - 5, 12, 4, C.hat); // (starts at row 1: row 0 is left for the outline)
  f.rect(hx - 1, hy - 2, 12, 1, C.band);
  f.rect(hx + 3, hy - 5, 4, 1, C.hatDark); // dent
  }

  // Arms last, in front of the body: from the shoulders to the hands.
  for (const [sx, [hxh, hyh]] of [[9, pose.handL], [22, pose.handR]] as const) {
    f.limb(sx, 20 + b, hxh, hyh + b, 3, C.coat, C.coatDark);
    f.rect(hxh - 2, hyh + b - 1, 4, 4, C.skin); // hand
    f.set(hxh - 2, hyh + b + 3, C.skinLight); // claws
    f.set(hxh, hyh + b + 3, C.skinLight);
  }

  f.outline(C.outline);
  return f;
}

const POSES: Pose[] = [
  // Walk cycle: alternate feet and arm heights, with a bounce on the passing frames.
  { handL: [9, 27], handR: [23, 30], liftL: 3, liftR: 0, bob: 0, mouthOpen: false, headShift: 0 },
  { handL: [10, 29], handR: [22, 29], liftL: 0, liftR: 0, bob: 1, mouthOpen: false, headShift: 0 },
  { handL: [9, 30], handR: [23, 27], liftL: 0, liftR: 3, bob: 0, mouthOpen: false, headShift: 0 },
  { handL: [10, 29], handR: [22, 29], liftL: 0, liftR: 0, bob: 1, mouthOpen: false, headShift: 0 },
  // Attack: claws raised above the head, then slashing down across the body.
  { handL: [6, 6], handR: [26, 6], liftL: 0, liftR: 0, bob: 0, mouthOpen: true, headShift: 0 },
  { handL: [18, 33], handR: [14, 35], liftL: 0, liftR: 2, bob: 1, mouthOpen: true, headShift: 0 },
  // Hurt: thrown back, arms out, head knocked aside.
  { handL: [5, 22], handR: [27, 20], liftL: 2, liftR: 0, bob: 0, mouthOpen: true, headShift: 1 },
  // Headless: same flailing pose, no head.
  { handL: [5, 24], handR: [27, 22], liftL: 2, liftR: 0, bob: 0, mouthOpen: true, headShift: 0, headless: true },
];

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function ghoulSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(POSES.map(paint));
  return sheet;
}

export const GHOUL_FRAME_COUNT = FRAME_COUNT;
