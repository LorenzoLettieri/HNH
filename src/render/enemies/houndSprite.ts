// The hellhound's sprite sheet, painted pixel by pixel: a lean, charred
// hound with exposed ribs and spine, small horns, a spiked brass collar
// (the steampunk touch) and ember cracks glowing through its hide.
//
// Unlike the ghoul (always seen from the front), the hound circles around
// you, so it has THREE VIEWS, like Doom's sprites: SIDE (facing right; the
// renderer mirrors it for the left), FRONT (coming at you) and BACK (running
// away). The renderer picks the view from the angle between where the hound
// is going and where the camera is (see hounds.ts).
//
// One frame is 48 × 36 px: at 32 px/m it's 1.5 × 1.125 m. Feet on the
// bottom row. Frame indices: see FRAMES.
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 48;
export const FRAME_H = 36;
export const FRAMES = {
  side: { run: [0, 1, 2, 3], bite: 4, hurt: 5 },
  front: { run: [6, 7], bite: 8, hurt: 9 },
  back: { run: [10, 11] },
  dead: 12,
};

const C = {
  outline: 0x0e0606,
  hide: 0x3c1a15,
  hideDark: 0x240e0c,
  hideLight: 0x5c2a20,
  belly: 0x6a3a2c,
  bone: 0xc8b89a,
  boneDark: 0x8a7a60,
  ember: 0xff8a2a,
  brass: 0xb08a3a,
  brassLight: 0xe0c070,
  mouth: 0x1a0404,
  teeth: 0xe8e0c8,
  eye: 0xffd060,
};

type P = [number, number];

// --- Side view (facing right: the head is at high x) ------------------------

/** One side pose: where each paw is (n = near legs, f = far legs), body bounce, jaw. */
interface SidePose {
  frontNear: P;
  frontFar: P;
  backNear: P;
  backFar: P;
  /** Whole body shifted down by this many pixels (the bounce of the gallop). */
  bob: number;
  /** Jaw open (bite, hurt). */
  jawOpen: boolean;
  /** Head raised by this many pixels (hurt: thrown back). */
  headLift?: number;
}

/**
 * A FRONT leg: shoulder → wrist → paw. The wrist is a bit behind the
 * straight line (dogs' front legs bend backward at the wrist).
 */
function frontLeg(f: PixelFrame, s: P, paw: P, c: number, cDark: number): void {
  const wx = s[0] + (paw[0] - s[0]) * 0.55 - 1;
  const wy = s[1] + (paw[1] - s[1]) * 0.6;
  f.limb(s[0], s[1], wx, wy, 4, c, cDark);
  f.limb(wx, wy, paw[0], paw[1] - 1, 2, c, cDark);
  f.rect(paw[0] - 1, paw[1] - 1, 3, 2, cDark);
  f.set(paw[0] + 2, paw[1], C.bone); // claw
}

/**
 * A HIND leg: hip → knee (forward) → hock (back) → paw. That zig-zag is what
 * makes a dog's back leg read as a dog's leg: two segments wouldn't.
 */
function hindLeg(f: PixelFrame, hip: P, paw: P, c: number, cDark: number): void {
  const kx = hip[0] + (paw[0] - hip[0]) * 0.4 + 3;
  const ky = hip[1] + 5;
  const hx = paw[0] - 2;
  const hy = paw[1] - 5;
  f.limb(hip[0], hip[1], kx, ky, 5, c, cDark); // thigh
  f.limb(kx, ky, hx, hy, 3, c, cDark);
  f.limb(hx, hy, paw[0], paw[1] - 1, 2, c, cDark);
  f.rect(paw[0] - 1, paw[1] - 1, 3, 2, cDark);
  f.set(paw[0] + 2, paw[1], C.bone);
}

/** Glowing cracks: a few pixels painted ember AND marked in the glow mask. */
function embers(f: PixelFrame, pixels: P[]): void {
  for (const [x, y] of pixels) f.set(x, y, C.ember, true);
}

function paintSide(p: SidePose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  const shoulder: P = [31, 21 + b];
  const hip: P = [15, 19 + b];

  // Far legs first (darker: in shadow, behind the body).
  frontLeg(f, shoulder, p.frontFar, C.hideDark, C.outline);
  hindLeg(f, hip, p.backFar, C.hideDark, C.outline);

  // Tail: thin, swept back, with a smoldering tip.
  f.limb(12, 17 + b, 6, 13 + b, 2, C.hide, C.hideDark);
  f.limb(6, 13 + b, 2, 15 + b, 2, C.hide, C.hideDark);
  embers(f, [[2, 15 + b], [1, 16 + b]]);

  // Body, column by column: the top follows the spine (slightly arched),
  // the bottom goes from the tucked belly (back) to the deep chest (front).
  for (let x = 11; x <= 35; x++) {
    const t = (x - 11) / 24;
    const top = Math.round(16 - Math.sin(t * Math.PI) * 1.5) + b;
    const bottom = Math.round(t < 0.4 ? 22 - t * 3 : 21 + (t - 0.4) * 11) + b;
    f.rect(x, top, 1, bottom - top + 1, C.hide);
    // A mane of embers along the spine: a glowing line that draws the
    // hound's outline even against the dark (or the orange haze of noon).
    f.set(x, top, C.ember, true);
    f.set(x, bottom, C.hideDark);
    f.set(x, bottom - 1, C.hideDark);
    // Spine ridges: a bone spike every 3 pixels.
    if (x % 3 === 0 && x > 12 && x < 33) f.set(x, top - 1, C.bone);
  }
  // Exposed ribs on the flank.
  for (let x = 23; x <= 29; x += 2) {
    f.rect(x, 19 + b, 1, 5, C.bone);
    f.set(x, 23 + b, C.boneDark);
  }
  // Ember cracks on the haunch and the shoulder.
  embers(f, [[16, 18 + b], [17, 19 + b], [17, 20 + b], [18, 21 + b], [31, 17 + b], [32, 18 + b], [32, 19 + b]]);

  // Neck and head.
  // hy: head offset (2 px lower than the ears' max height: a hunting dog carries its head low).
  const hy = b + 2 - (p.headLift ?? 0);
  f.limb(33, 19 + b, 38, 12 + hy, 6, C.hide, C.hideDark);
  f.rect(36, 7 + hy, 8, 7, C.hide); // skull
  f.rect(36, 7 + hy, 8, 1, C.hideLight);
  embers(f, [[36, 7 + hy], [37, 7 + hy]]); // the mane goes up to the head
  f.rect(43, 10 + hy, 4, 3, C.hide); // snout (upper jaw)
  f.set(46, 10 + hy, C.outline); // nose
  f.triangle(36, 8 + hy, 39, 8 + hy, 33, 3 + hy, C.hide); // ear, swept back
  f.limb(39, 7 + hy, 41, 4 + hy, 1, C.bone, C.boneDark); // horn
  f.set(42, 3 + hy, C.bone);
  // Eyes: big and glowing, the first thing you notice.
  for (const x of [39, 40, 41]) f.set(x, 9 + hy, C.eye, true);
  f.set(40, 10 + hy, C.eye, true);
  f.rect(39, 8 + hy, 3, 1, C.hideDark); // brow
  if (p.jawOpen) {
    // The lower jaw drops: a dark mouth with fangs and a glowing throat.
    f.triangle(38, 13 + hy, 46, 13 + hy, 41, 18 + hy, C.mouth);
    f.limb(38, 14 + hy, 45, 18 + hy, 2, C.hide, C.hideDark);
    for (const x of [42, 44, 46]) f.set(x, 13 + hy, C.teeth);
    for (const x of [41, 43]) f.set(x, 16 + hy, C.teeth);
    f.set(40, 14 + hy, C.ember, true);
  } else {
    f.rect(39, 13 + hy, 7, 2, C.hide);
    f.rect(40, 13 + hy, 6, 1, C.mouth);
    f.set(43, 13 + hy, C.teeth);
    f.set(45, 13 + hy, C.teeth);
  }

  // Spiked brass collar around the neck.
  f.limb(34, 13 + hy, 36, 19 + b, 2, C.brass, C.brassLight);
  f.set(37, 13 + hy, C.brassLight);
  f.set(37, 16 + b, C.brassLight);

  // Near legs last, in front of the body.
  frontLeg(f, shoulder, p.frontNear, C.hide, C.hideDark);
  hindLeg(f, hip, p.backNear, C.hide, C.hideDark);

  f.outline(C.outline);
  return f;
}

/** Dead: on its back, stiff legs up (cartoonish, but it reads from far away). */
function paintDead(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  for (const [x0, x1] of [[29, 36], [26, 31], [17, 22], [13, 18]] as const) {
    f.limb(x0, 27, x1, 19, 2, C.hide, C.hideDark);
    f.set(x1 + 1, 18, C.bone);
  }
  f.rect(10, 26, 26, 8, C.hide);
  f.rect(10, 26, 26, 2, C.belly);
  for (let x = 22; x <= 30; x += 2) f.rect(x, 28, 1, 4, C.bone);
  f.rect(36, 28, 9, 6, C.hide); // head on the ground
  f.rect(40, 32, 5, 2, C.mouth); // jaw hanging open
  f.set(42, 32, C.teeth);
  f.triangle(36, 29, 38, 33, 32, 34, C.hide); // ear
  f.limb(10, 30, 3, 33, 2, C.hide, C.hideDark); // limp tail
  // No glow: the fire inside went out.
  f.outline(C.outline);
  return f;
}

// --- Front view (coming at you) ----------------------------------------------

interface FrontPose {
  /** Pixels each front leg is lifted (running). */
  liftL: number;
  liftR: number;
  bob: number;
  jawOpen: boolean;
}

function paintFront(p: FrontPose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  // Hind legs, peeking out behind the chest.
  f.rect(17, 27 + b, 3, 8 - b, C.hideDark);
  f.rect(29, 27 + b, 3, 8 - b, C.hideDark);
  // Chest, with ribs showing on the sides and ember cracks in the middle.
  f.rect(18, 17 + b, 13, 12, C.hide);
  f.rect(18, 17 + b, 1, 12, C.hideLight);
  f.rect(30, 17 + b, 1, 12, C.hideDark);
  for (const y of [21, 23, 25]) {
    f.rect(19, y + b, 2, 1, C.bone);
    f.rect(28, y + b, 2, 1, C.bone);
  }
  embers(f, [[23, 21 + b], [24, 22 + b], [24, 23 + b], [25, 24 + b]]);
  // Front legs: one lifted at a time.
  for (const [x, lift] of [[19, p.liftL], [27, p.liftR]] as const) {
    f.rect(x, 26 + b, 3, 8 - b - lift, C.hide);
    f.rect(x, 26 + b, 1, 8 - b - lift, C.hideLight);
    f.rect(x - 1, 33 - lift, 5, 2, C.hideDark); // paw
    f.set(x - 1, 34 - lift, C.bone);
    f.set(x + 1, 34 - lift, C.bone);
    f.set(x + 3, 34 - lift, C.bone);
  }
  // Collar with spikes.
  f.rect(18, 16 + b, 13, 2, C.brass);
  for (let x = 19; x <= 29; x += 3) f.set(x, 15 + b, C.brassLight);

  // Head: skull, muzzle, ears, horns, eyes.
  f.triangle(18, 8 + b, 22, 8 + b, 16, 1 + b, C.hide); // ears
  f.triangle(27, 8 + b, 31, 8 + b, 33, 1 + b, C.hide);
  f.rect(18, 6 + b, 13, 8, C.hide);
  for (let x = 18; x <= 30; x++) f.set(x, 6 + b, C.ember, true); // the mane, seen head-on
  f.limb(20, 6 + b, 18, 3 + b, 1, C.bone, C.boneDark); // horns
  f.limb(29, 6 + b, 31, 3 + b, 1, C.bone, C.boneDark);
  f.rect(21, 12 + b, 7, 5, C.hide); // muzzle
  f.rect(21, 12 + b, 1, 5, C.hideLight);
  f.rect(23, 12 + b, 3, 1, C.outline); // nose
  // Slanted brows over glowing eyes: the "angry" look.
  f.set(19, 8 + b, C.hideDark);
  f.rect(20, 9 + b, 2, 1, C.hideDark);
  f.rect(27, 9 + b, 2, 1, C.hideDark);
  f.set(29, 8 + b, C.hideDark);
  for (const x of [20, 21, 27, 28]) {
    f.set(x, 10 + b, C.eye, true);
    f.set(x, 11 + b, C.eye, true);
  }
  if (p.jawOpen) {
    // Mouth wide open: fangs top and bottom, fire in the throat.
    f.rect(21, 15 + b, 7, 6, C.mouth);
    for (const x of [21, 23, 25, 27]) f.set(x, 15 + b, C.teeth);
    for (const x of [22, 26]) f.set(x, 20 + b, C.teeth);
    embers(f, [[24, 17 + b], [24, 18 + b], [23, 18 + b], [25, 18 + b]]);
    f.rect(21, 21 + b, 7, 1, C.hide); // chin
  } else {
    f.rect(22, 15 + b, 5, 1, C.mouth);
    f.set(22, 16 + b, C.teeth);
    f.set(26, 16 + b, C.teeth);
  }
  f.outline(C.outline);
  return f;
}

// --- Back view (running away) -------------------------------------------------

function paintBack(stride: number): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  // Head and ears, behind the body (only the top shows).
  f.triangle(18, 13, 22, 13, 17, 6, C.hideDark);
  f.triangle(27, 13, 31, 13, 32, 6, C.hideDark);
  f.rect(19, 10, 11, 6, C.hideDark);
  // Hind legs: thighs and paws, alternating.
  for (const [x, lift] of [[18, stride], [27, 2 - stride]] as const) {
    f.rect(x, 24, 4, 10 - lift, C.hide);
    f.rect(x, 24, 1, 10 - lift, C.hideLight);
    f.rect(x, 33 - lift, 4, 2, C.hideDark);
  }
  // Rump, with the spine ridge down the middle and cracks on the haunches.
  f.rect(18, 15, 13, 12, C.hide);
  f.rect(18, 15, 13, 1, C.hideLight);
  for (const [x, y] of [[18, 15], [30, 15], [18, 26], [30, 26]]) f.set(x, y, -1); // rounded corners
  for (let y = 15; y < 26; y++) f.set(24, y, C.ember, true); // the mane down the spine
  embers(f, [[20, 19], [21, 20], [21, 21], [28, 18], [27, 19], [27, 20]]);
  // Tail up, smoldering tip.
  f.limb(24, 15, 23, 9, 2, C.hide, C.hideDark);
  f.limb(23, 9, 25, 5, 2, C.hide, C.hideDark);
  embers(f, [[25, 4], [26, 4]]);
  f.outline(C.outline);
  return f;
}

/**
 * Gallop, 4 frames: stretched in the air → front paws land → all four
 * gathered under the body → hind legs push off. (The order a real dog's
 * legs hit the ground at full speed: it's a "rotary gallop".)
 */
const SIDE_RUN: SidePose[] = [
  { frontNear: [41, 31], frontFar: [38, 30], backNear: [5, 31], backFar: [8, 30], bob: -1, jawOpen: false },
  { frontNear: [36, 34], frontFar: [33, 34], backNear: [10, 30], backFar: [13, 31], bob: 0, jawOpen: false },
  { frontNear: [27, 33], frontFar: [30, 34], backNear: [24, 34], backFar: [21, 33], bob: 1, jawOpen: false },
  { frontNear: [33, 30], frontFar: [30, 29], backNear: [14, 34], backFar: [11, 34], bob: 0, jawOpen: false },
];

/** Every frame, in the order of FRAMES. Exported for the preview tool. */
export function paintHoundFrames(): PixelFrame[] {
  return [
    ...SIDE_RUN.map(paintSide),
    paintSide({ frontNear: [39, 34], frontFar: [36, 34], backNear: [9, 34], backFar: [12, 34], bob: 0, jawOpen: true }),
    paintSide({ frontNear: [37, 33], frontFar: [30, 34], backNear: [8, 34], backFar: [18, 33], bob: 0, jawOpen: true, headLift: 2 }),
    paintFront({ liftL: 2, liftR: 0, bob: 0, jawOpen: false }),
    paintFront({ liftL: 0, liftR: 2, bob: 1, jawOpen: false }),
    paintFront({ liftL: 0, liftR: 0, bob: 0, jawOpen: true }),
    paintFront({ liftL: 1, liftR: 1, bob: 1, jawOpen: true }),
    paintBack(0),
    paintBack(2),
    paintDead(),
  ];
}

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function houndSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(paintHoundFrames());
  return sheet;
}
