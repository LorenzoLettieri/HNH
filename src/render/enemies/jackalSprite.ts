// The jackal's sprite sheet ("Lo Sciacallo", src/sim/jackal.ts), painted pixel
// by pixel: a little hunched devil, red skin, tall jackal ears with two
// stubby horns between them, glowing yellow eyes, a grin with one gold tooth,
// a tattered vest, goat legs with hooves, a tail with an arrow tip, and a big
// burlap SACK of vildenaro with a "$" on it, coins glinting at its neck.
//
// THREE VIEWS like the hound and the bull (jackals.ts picks one from the
// angle): it spends its life running AWAY from you, so the back view
// matters as much as the front. One frame is 32 × 44 px: at 32 px/m it's
// 1 × 1.375 m. Frames, left to right (FRAMES below):
//   front: run 0-3, taunt 4-5 (shaking the sack over its head, laughing), hurt 6
//   side (facing right; mirrored by the renderer for the left): run 7-10, jump 11
//   back:  run 12-15, climb 16-17
//   18: dead (sprawled on the ground, the sack torn open)
//
// What must match the simulation: the feet on the bottom row, the head (face
// and ears) above row 13 = above tuning.jackalHeadHeight (0.95 m × 32 px =
// 30 px from the bottom): where you see the head, the hit is critical.
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 32;
export const FRAME_H = 44;
export const FRAMES = {
  front: { run: [0, 1, 2, 3], taunt: [4, 5], hurt: 6 },
  side: { run: [7, 8, 9, 10], jump: 11 },
  back: { run: [12, 13, 14, 15], climb: [16, 17] },
  dead: 18,
};

const C = {
  outline: 0x140806,
  skin: 0xa83224,
  skinDark: 0x6e1c14,
  skinLight: 0xd0503a,
  belly: 0xc4664a,
  ear: 0x4a0e0a,
  horn: 0xe8d8b0,
  hornDark: 0xa89870,
  eye: 0xffe040,
  mouth: 0x2a0806,
  teeth: 0xf0e8d0,
  gold: 0xffc030,
  vest: 0x3a2a1e,
  vestDark: 0x241810,
  vestLight: 0x54402c,
  sack: 0xb48a50,
  sackDark: 0x7a5a30,
  sackLight: 0xd4ac70,
  rope: 0x5a3a1a,
  ink: 0x3a2410,
  coin: 0xffd040,
  coinDark: 0xc08a20,
  hoof: 0x201410,
  claw: 0xe8d8b0,
};

interface Shade {
  base: number;
  dark: number;
  light: number;
}
const SKIN: Shade = { base: C.skin, dark: C.skinDark, light: C.skinLight };
const SACK: Shade = { base: C.sack, dark: C.sackDark, light: C.sackLight };

/** The color of a pixel inside a blob: its position and how lit it is (-1 = facing away from the light, 1 = facing it). */
type ColorAt = (x: number, y: number, lit: number) => number;

/**
 * Fills an ellipse: the basic shape of every round body part. Each pixel's
 * shade comes from its position on the ellipse: (nx, ny) is like the
 * surface's slope there, and its dot product with the light direction
 * (from the upper left) says how much it faces the light. Three bands of
 * color, like a cel-shaded ball: that's what makes a flat blob look round.
 */
function fill(f: PixelFrame, cx: number, cy: number, rx: number, ry: number, color: ColorAt): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      f.set(x, y, color(x, y, -(nx * 0.6 + ny * 0.8)));
    }
  }
}
const shaded = (s: Shade): ColorAt => (_x, _y, lit) => (lit > 0.45 ? s.light : lit < -0.35 ? s.dark : s.base);

/** Burlap: the sack's shading plus a weave of darker pixels on a diagonal grid. */
const burlap: ColorAt = (x, y, lit) => {
  const c = shaded(SACK)(x, y, lit);
  return (x + 2 * y) % 5 === 0 && c !== C.sackDark ? C.sackDark : c;
};

/** A tiny "$", 3 × 7 px, top-left at (x, y). */
function dollar(f: PixelFrame, x: number, y: number): void {
  const rows = ['.#.', '###', '#..', '###', '..#', '###', '.#.'];
  rows.forEach((row, j) => [...row].forEach((ch, i) => ch === '#' && f.set(x + i, y + j, C.ink)));
}

/**
 * The sack of vildenaro: a lumpy burlap ball, the rope around its neck and a
 * few coins glinting out of it (they glow: you spot the jackal by its loot).
 */
function sack(f: PixelFrame, cx: number, cy: number, r: number, sign: [number, number] | null): void {
  fill(f, cx, cy, r, r * 0.95, burlap);
  fill(f, cx - r * 0.35, cy + r * 0.35, r * 0.55, r * 0.5, burlap); // a lump: it's full
  f.rect(Math.round(cx - 2), Math.round(cy - r - 1), 4, 2, C.sackDark); // the gathered neck
  f.rect(Math.round(cx - 2), Math.round(cy - r + 1), 4, 1, C.rope);
  f.set(cx - 1, cy - r - 2, C.coin, true);
  f.set(cx + 1, cy - r - 2, C.coinDark, true);
  f.set(cx, cy - r - 3, C.coin, true);
  if (sign) dollar(f, sign[0], sign[1]);
}

/** A goat leg seen from the front or back: thigh, thin shin, hoof. `lift` raises the foot (running). */
function legFront(f: PixelFrame, x: number, top: number, lift: number, dark: boolean): void {
  const skin = dark ? C.skinDark : C.skin;
  f.rect(x - 1, top, 4, 5, skin);
  f.rect(x - 1, top, 1, 5, C.skinDark);
  f.rect(x, top + 5, 2, 7 - lift, dark ? C.ear : C.skinDark);
  f.rect(x - 1, 42 - lift, 4, 2, C.hoof);
}

/**
 * A goat leg in profile (digitigrade: it walks on its toes, the "knee" you
 * see bending backward is really its ankle). `reach` = how far forward the
 * hoof is (negative = behind), `lift` = how high.
 */
function legSide(f: PixelFrame, hipX: number, hipY: number, reach: number, lift: number, far: boolean): void {
  const c = far ? C.skinDark : C.skin;
  const cd = far ? C.ear : C.skinDark;
  const kneeX = hipX + 2 + reach * 0.4;
  const kneeY = hipY + 5;
  const hockX = hipX - 1 + reach * 0.7;
  const hockY = hipY + 9 - lift * 0.5;
  const hoofX = hipX + reach;
  const hoofY = 42 - lift;
  f.limb(hipX, hipY, kneeX, kneeY, 3, c, cd);
  f.limb(kneeX, kneeY, hockX, hockY, 2, cd, cd);
  f.limb(hockX, hockY, hoofX, hoofY, 2, cd, cd);
  f.rect(Math.round(hoofX) - 1, Math.round(hoofY), 3, 2, C.hoof);
}

/** A thin tail through some points, with an arrow tip at the last one pointing along the last segment. */
function tail(f: PixelFrame, points: [number, number][]): void {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    f.limb(x0, y0, x1, y1, 1, C.skinDark, C.skinDark);
  }
  const [tx, ty] = points[points.length - 1];
  const [px, py] = points[points.length - 2];
  const d = Math.hypot(tx - px, ty - py) || 1;
  const ux = (tx - px) / d;
  const uy = (ty - py) / d;
  // The arrowhead: a triangle with its point 3 px further along, its base across the tail.
  f.triangle(tx + ux * 3, ty + uy * 3, tx - uy * 2, ty + ux * 2, tx + uy * 2, ty - ux * 2, C.skinDark);
}

/** A hand: a small knob of skin with two claws. */
function hand(f: PixelFrame, x: number, y: number): void {
  f.rect(Math.round(x) - 1, Math.round(y) - 1, 3, 3, C.skin);
  f.set(x - 1, y + 2, C.claw);
  f.set(x + 1, y + 2, C.claw);
}

/** The torso with its vest: the sides are vest, the middle is the bare red belly. */
function torso(f: PixelFrame, cx: number, cy: number, rx: number, ry: number, back: boolean): void {
  fill(f, cx, cy, rx, ry, (x, _y, lit) => {
    const side = Math.abs(x + 0.5 - cx);
    if (!back && side < 2.2) return lit < -0.35 ? C.skin : C.belly;
    return lit > 0.45 ? C.vestLight : lit < -0.35 ? C.vestDark : C.vest;
  });
}

// --- Front view -------------------------------------------------------------------------

interface FrontPose {
  bob: number;
  liftL: number;
  liftR: number;
  /** The free hand (the other one holds the sack's neck). */
  hand: [number, number];
  /** Where the sack is: over the shoulder, or up over the head (taunting). */
  sack: [number, number];
  /** Laughing / yelping, with squinting eyes. */
  mouthOpen: boolean;
  headShift: number;
  /** A coin flying out of the sack (taunting): its position, or null. */
  coin?: [number, number];
}

function front(pose: FrontPose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = pose.bob;
  tail(f, [[14, 32 + b], [9, 35 + b], [6, 33 + b], [5, 29 + b]]);
  const [sx, sy] = pose.sack;
  sack(f, sx, sy, 6.5, [sx + 1, sy - 2]); // behind the body: you see it over the shoulder
  legFront(f, 13, 30 + b, pose.liftL, false);
  legFront(f, 19, 30 + b, pose.liftR, true);
  torso(f, 16, 25 + b, 6, 6.5, false);
  // The right arm up to the sack's neck: BEFORE the head, or it would cross its face.
  f.limb(21, 20 + b, sx - 2, sy - 5, 2, C.skin, C.skinDark);
  hand(f, sx - 2, sy - 6);
  head(f, 16 + pose.headShift, 10 + b, pose.mouthOpen);
  // The free arm, in front.
  f.limb(11, 20 + b, pose.hand[0], pose.hand[1] + b, 2, C.skin, C.skinDark);
  hand(f, pose.hand[0], pose.hand[1] + b);
  if (pose.coin) {
    f.set(pose.coin[0], pose.coin[1], C.coin, true);
    f.set(pose.coin[0] + 1, pose.coin[1], C.coinDark, true);
  }
  f.outline(C.outline);
  return f;
}

/** The head seen from the front: tall ears, stubby horns, glowing eyes, the snout and the gold-tooth grin. */
function head(f: PixelFrame, cx: number, cy: number, mouthOpen: boolean): void {
  // Ears first (behind the head): tall triangles, dark inside.
  f.triangle(cx - 6, cy - 1, cx - 2, cy - 3, cx - 6, cy - 10, C.skin);
  f.triangle(cx - 5, cy - 2, cx - 3, cy - 3, cx - 5, cy - 8, C.ear);
  f.triangle(cx + 6, cy - 1, cx + 2, cy - 3, cx + 6, cy - 10, C.skin);
  f.triangle(cx + 5, cy - 2, cx + 3, cy - 3, cx + 5, cy - 8, C.ear);
  fill(f, cx, cy, 5.5, 4.5, shaded(SKIN));
  // Horns between the ears.
  f.rect(cx - 3, cy - 6, 1, 2, C.horn);
  f.rect(cx + 2, cy - 6, 1, 2, C.hornDark);
  // Eyes: slanted, glowing. Laughing they squint to a line.
  if (mouthOpen) {
    f.rect(cx - 4, cy - 1, 2, 1, C.eye);
    f.rect(cx + 2, cy - 1, 2, 1, C.eye);
    f.glow[(cy - 1) * FRAME_W + cx - 4] = 1;
    f.glow[(cy - 1) * FRAME_W + cx + 3] = 1;
  } else {
    f.set(cx - 4, cy - 2, C.eye, true);
    f.set(cx - 3, cy - 1, C.eye, true);
    f.set(cx + 3, cy - 2, C.eye, true);
    f.set(cx + 2, cy - 1, C.eye, true);
  }
  // The snout, pointing at you: a lighter muzzle with a dark nose.
  f.rect(cx - 2, cy, 4, 3, C.skinLight);
  f.rect(cx - 1, cy, 2, 1, C.mouth);
  // The mouth: a wide grin with a gold tooth, or open wide (laughing, yelping).
  if (mouthOpen) {
    f.rect(cx - 3, cy + 3, 6, 2, C.mouth);
    f.set(cx - 3, cy + 3, C.teeth);
    f.set(cx + 2, cy + 3, C.gold, true);
  } else {
    f.rect(cx - 4, cy + 3, 8, 1, C.mouth);
    f.set(cx - 3, cy + 3, C.teeth);
    f.set(cx - 1, cy + 3, C.teeth);
    f.set(cx + 1, cy + 3, C.gold, true);
    f.set(cx + 3, cy + 3, C.teeth);
  }
}

// --- Side view (facing right) -----------------------------------------------------------

interface SidePose {
  bob: number;
  /** How far forward each hoof is (negative = behind) and how high. */
  nearReach: number;
  nearLift: number;
  farReach: number;
  farLift: number;
  /** The free arm's hand, swinging. */
  hand: [number, number];
}

function side(pose: SidePose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = pose.bob;
  legSide(f, 15, 30 + b, pose.farReach, pose.farLift, true); // the far leg, darker, behind everything
  tail(f, [[10, 30 + b], [6, 29 + b], [3, 26 + b], [2, 22 + b]]);
  torso(f, 15, 24 + b, 5.5, 6, true);
  f.rect(17, 21 + b, 3, 7, C.belly); // its front: the bare belly between the vest's flaps
  sack(f, 8, 20 + b, 6, [6, 17 + b]); // on its back
  // The rope over the shoulder, to the hand holding it at the chest.
  f.limb(10, 13 + b, 17, 18 + b, 1, C.rope, C.rope);
  legSide(f, 15, 30 + b, pose.nearReach, pose.nearLift, false);
  headSide(f, 19, 12 + b);
  hand(f, 17, 18 + b);
  f.limb(17, 19 + b, pose.hand[0], pose.hand[1] + b, 2, C.skin, C.skinDark);
  hand(f, pose.hand[0], pose.hand[1] + b);
  f.outline(C.outline);
  return f;
}

/** The head in profile, facing right: the long snout, one ear swept back, the grin along the jaw. */
function headSide(f: PixelFrame, cx: number, cy: number): void {
  f.triangle(cx - 3, cy - 2, cx, cy - 4, cx - 6, cy - 11, C.skin); // the ear, swept back
  f.triangle(cx - 3, cy - 3, cx - 1, cy - 4, cx - 5, cy - 9, C.ear);
  fill(f, cx, cy, 4.5, 4, shaded(SKIN));
  f.rect(cx + 3, cy, 5, 3, C.skin); // the snout
  f.rect(cx + 3, cy, 5, 1, C.skinLight);
  f.set(cx + 8, cy + 1, C.skin);
  f.set(cx + 8, cy, C.mouth); // the nose
  f.rect(cx + 1, cy - 5, 1, 2, C.horn);
  f.set(cx + 2, cy - 2, C.eye, true);
  f.set(cx + 3, cy - 2, C.eye, true);
  f.rect(cx + 1, cy + 3, 7, 1, C.mouth); // the grin along the jaw
  f.set(cx + 3, cy + 3, C.teeth);
  f.set(cx + 5, cy + 3, C.gold, true);
  f.set(cx + 7, cy + 3, C.teeth);
}

// --- Back view --------------------------------------------------------------------------

interface BackPose {
  bob: number;
  liftL: number;
  liftR: number;
  /** Climbing: hands up on the wall instead of holding the sack. */
  climb?: [[number, number], [number, number]];
}

function back(pose: BackPose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = pose.bob;
  legFront(f, 13, 30 + b, pose.liftL, false);
  legFront(f, 19, 30 + b, pose.liftR, false);
  torso(f, 16, 25 + b, 6, 6.5, true);
  if (pose.climb) {
    for (const [i, [hx, hy]] of pose.climb.entries()) {
      f.limb(i === 0 ? 11 : 21, 19 + b, hx, hy, 2, C.skin, C.skinDark);
      hand(f, hx, hy);
    }
  }
  sack(f, 16, 21 + b, 7.5, [15, 18 + b]); // the whole back: what you see while chasing it
  headBack(f, 16, 10 + b);
  if (!pose.climb) {
    hand(f, 11, 14 + b); // both hands on the sack's neck, over the shoulders
    hand(f, 21, 14 + b);
  }
  // The tail in front of everything, swishing.
  tail(f, [[16, 31 + b], [19, 35 + b], [22, 34 + b], [24, 30 + b - pose.liftL]]);
  f.outline(C.outline);
  return f;
}

/** The back of the head: ears (outer side), horns, no face. */
function headBack(f: PixelFrame, cx: number, cy: number): void {
  f.triangle(cx - 6, cy - 1, cx - 2, cy - 3, cx - 6, cy - 10, C.skinDark);
  f.triangle(cx + 6, cy - 1, cx + 2, cy - 3, cx + 6, cy - 10, C.skin);
  fill(f, cx, cy, 5.5, 4.5, shaded(SKIN));
  f.rect(cx - 3, cy - 6, 1, 2, C.hornDark);
  f.rect(cx + 2, cy - 6, 1, 2, C.horn);
}

// --- Dead -------------------------------------------------------------------------------

/** Sprawled on its back, hooves up, the sack torn open and coins all around. */
function dead(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  sack(f, 25, 39, 4.5, null);
  f.rect(22, 34, 6, 2, C.sackDark); // the torn flap
  tail(f, [[20, 41], [24, 43], [28, 42], [30, 39]]);
  f.limb(17, 37, 21, 31, 2, C.skin, C.skinDark); // legs in the air
  f.limb(15, 37, 16, 30, 2, C.skinDark, C.skinDark);
  f.rect(20, 29, 3, 2, C.hoof);
  f.rect(15, 28, 3, 2, C.hoof);
  torso(f, 13, 39, 6, 3.5, false);
  f.triangle(2, 37, 5, 35, 1, 30, C.skin); // an ear flopped down
  fill(f, 6, 38, 4, 3.5, shaded(SKIN));
  // X eyes.
  f.set(5, 37, C.mouth);
  f.set(7, 39, C.mouth);
  f.set(7, 37, C.mouth);
  f.set(5, 39, C.mouth);
  f.set(3, 40, C.gold, true); // the gold tooth, still shining
  for (const [x, y] of [[29, 43], [19, 43], [31, 41], [27, 34], [11, 43]]) f.set(x, y, C.coin, true);
  f.outline(C.outline);
  return f;
}

// --- The frames -------------------------------------------------------------------------

/** All the frames, in order. Doesn't touch the DOM: it can be painted outside the browser for a preview. */
export function paintJackalFrames(): PixelFrame[] {
  return [
    // Front run: legs alternating, the sack bouncing on the shoulder, the free arm pumping.
    front({ bob: 0, liftL: 3, liftR: 0, hand: [8, 24], sack: [24, 13], mouthOpen: false, headShift: 0 }),
    front({ bob: 1, liftL: 0, liftR: 0, hand: [9, 27], sack: [24, 15], mouthOpen: false, headShift: 0 }),
    front({ bob: 0, liftL: 0, liftR: 3, hand: [8, 29], sack: [24, 13], mouthOpen: false, headShift: 0 }),
    front({ bob: 1, liftL: 0, liftR: 0, hand: [9, 27], sack: [24, 15], mouthOpen: false, headShift: 0 }),
    // Taunt: the sack shaken up over its head, laughing, a coin jumping out.
    front({ bob: 0, liftL: 0, liftR: 0, hand: [9, 27], sack: [23, 6], mouthOpen: true, headShift: 0, coin: [29, 1] }),
    front({ bob: 1, liftL: 0, liftR: 2, hand: [9, 26], sack: [24, 9], mouthOpen: true, headShift: 1, coin: [27, 3] }),
    // Hurt: knocked aside, the sack jolted, yelping.
    front({ bob: 0, liftL: 2, liftR: 0, hand: [5, 19], sack: [25, 16], mouthOpen: true, headShift: -1 }),
    // Side run: a four-beat stride.
    side({ bob: 0, nearReach: 5, nearLift: 0, farReach: -4, farLift: 1, hand: [13, 23] }),
    side({ bob: 1, nearReach: 1, nearLift: 2, farReach: 0, farLift: 0, hand: [16, 25] }),
    side({ bob: 0, nearReach: -4, nearLift: 1, farReach: 5, farLift: 0, hand: [21, 22] }),
    side({ bob: 1, nearReach: 0, nearLift: 0, farReach: 1, farLift: 2, hand: [16, 25] }),
    // Jump: hooves tucked under, the free arm up.
    side({ bob: -1, nearReach: 2, nearLift: 6, farReach: -2, farLift: 5, hand: [22, 15] }),
    // Back run.
    back({ bob: 0, liftL: 3, liftR: 0 }),
    back({ bob: 1, liftL: 0, liftR: 0 }),
    back({ bob: 0, liftL: 0, liftR: 3 }),
    back({ bob: 1, liftL: 0, liftR: 0 }),
    // Climb: hand over hand up the wall, a hoof kicking.
    back({ bob: 0, liftL: 4, liftR: 0, climb: [[9, 4], [23, 9]] }),
    back({ bob: 0, liftL: 0, liftR: 4, climb: [[9, 9], [23, 4]] }),
    dead(),
  ];
}

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function jackalSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(paintJackalFrames());
  return sheet;
}
