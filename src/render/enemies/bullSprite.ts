// The bull's sprite sheet, painted pixel by pixel: a huge charred bull with a
// mountain of a shoulder hump, lyre-shaped horns, a brass nose ring, and (the
// steampunk touch) a riveted brass plate on its back with two exhaust pipes
// that glow. Ember cracks shine through the hide.
//
// THREE VIEWS like the hound (side facing right, mirrored for the left;
// front; back), picked by the renderer from the angle between where the bull
// faces and the camera (see bulls.ts).
//
// New trick compared to the hound: the side-view HEAD IS ROTATED. It's
// described once, in its own coordinates, and every point goes through a
// rotation around the neck before being painted (see headTransform). The
// same head becomes "up" (walking), "lowered" (aiming), "down, horns
// forward" (charging) and "drooping" (dazed) just by changing an angle.
// That's what a 2D rotation matrix is for:
//   x' = cx + (x − cx)·cos a − (y − cy)·sin a
//   y' = cy + (x − cx)·sin a + (y − cy)·cos a
//
// One frame is 84 × 72 px: at 32 px/m it's 2.6 × 2.25 m. Hooves on the bottom row.
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 84;
export const FRAME_H = 72;
export const FRAMES = {
  side: { walk: [0, 1, 2, 3], charge: [4, 5], paw: [6, 7], locked: 8, skid: 9, dazed: 10 },
  front: { walk: [11, 12], charge: [13, 14], dazed: 15 },
  back: { walk: [16, 17] },
  dead: 18,
};

const C = {
  outline: 0x0c0505,
  hide: 0x3a1612,
  hideDark: 0x220c0a,
  hideLight: 0x5a2a1e,
  muzzle: 0x6a3426,
  bone: 0xd8c8a0,
  boneDark: 0x8e7c5c,
  boneLight: 0xf0e6c8,
  ember: 0xff7a20,
  brass: 0xb08a3a,
  brassLight: 0xe0c070,
  brassDark: 0x6e5420,
  eye: 0xffb040,
  tongue: 0xb04050,
  star: 0xffe070,
};

type P = [number, number];
type HeadMode = 'up' | 'mid' | 'down' | 'dazed';

/** Glowing pixels: painted ember AND marked in the glow mask (they shine in the dark). */
function embers(f: PixelFrame, pixels: P[]): void {
  for (const [x, y] of pixels) f.set(x, y, C.ember, true);
}

/** Linear interpolation through control points [x, value]: the body's outline as a few numbers. */
function profile(points: P[], x: number): number {
  for (let i = 1; i < points.length; i++) {
    const [x0, v0] = points[i - 1];
    const [x1, v1] = points[i];
    if (x <= x1) return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
  }
  return points[points.length - 1][1];
}

/** A filled quadrilateral = two triangles. */
function quad(f: PixelFrame, a: P, b: P, c: P, d: P, color: number): void {
  f.triangle(a[0], a[1], b[0], b[1], c[0], c[1], color);
  f.triangle(a[0], a[1], c[0], c[1], d[0], d[1], color);
}

// --- Side view (facing right) ------------------------------------------------

interface SidePose {
  /** Hoof positions (n = near legs, f = far legs). */
  frontNear: P;
  frontFar: P;
  backNear: P;
  backFar: P;
  /** Whole body shifted down by this many pixels (the bounce of the stride). */
  bob: number;
  head: HeadMode;
}

/** Head angle (radians, positive = nose goes down) and how far the neck drops, per mode. */
const HEAD: Record<HeadMode, { angle: number; drop: number }> = {
  up: { angle: 0, drop: 0 },
  mid: { angle: 0.3, drop: 3 },
  down: { angle: 0.75, drop: 7 },
  dazed: { angle: 0.6, drop: 9 },
};

/** Returns a function that maps a point of the head's own drawing into the frame (rotated around the neck). */
function headTransform(mode: HeadMode, bob: number): (p: P) => P {
  const { angle, drop } = HEAD[mode];
  const cx = 58; // pivot: where the neck joins the skull
  const cy = 30;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos + drop + bob];
}

function paintHeadSide(f: PixelFrame, mode: HeadMode, bob: number): void {
  const T = headTransform(mode, bob);
  const rect = (x: number, y: number, w: number, h: number, c: number) =>
    quad(f, T([x, y]), T([x + w, y]), T([x + w, y + h]), T([x, y + h]), c);
  const line = (a: P, b: P, w: number, c: number, cDark: number) => {
    const [x0, y0] = T(a);
    const [x1, y1] = T(b);
    f.limb(x0, y0, x1, y1, w, c, cDark);
  };
  const dot = (x: number, y: number, c: number, glow = false) => {
    const [px, py] = T([x, y]);
    f.set(px, py, c, glow);
  };
  const dazed = mode === 'dazed';

  rect(56, 22, 14, 15, C.hide); // skull
  rect(57, 22, 12, 2, C.hideLight); // light on the forehead
  rect(66, 30, 10, 12, C.muzzle); // muzzle
  rect(66, 40, 10, 2, C.hideDark); // jaw line
  rect(63, 36, 4, 6, C.hide); // cheek
  // Nostrils: two glowing slits (smoke and fire inside), except when dazed.
  dot(74, 34, dazed ? C.hideDark : C.ember, !dazed);
  dot(75, 34, dazed ? C.hideDark : C.ember, !dazed);
  // Brass nose ring hanging under the muzzle.
  for (const [x, y] of [[74, 41], [73, 42], [73, 43], [74, 44], [75, 44], [76, 43], [76, 42]] as P[]) dot(x, y, C.brass);
  dot(73, 42, C.brassLight);
  // Eye under a heavy brow.
  rect(62, 26, 5, 1, C.hideDark);
  if (dazed) {
    dot(63, 28, C.hideDark); // half-closed, no glow
    dot(64, 28, C.hideDark);
  } else {
    dot(63, 28, C.eye, true);
    dot(64, 28, C.eye, true);
  }
  // Ear, sticking out sideways below the horn.
  line([58, 27], [52, 29], 3, C.hideDark, C.outline);
  // Horn: out from the skull, back, up, then the tip curves FORWARD (a lyre).
  // With the head down, that forward tip is what points at you.
  line([60, 23], [55, 17], 4, C.bone, C.boneDark);
  line([55, 17], [57, 10], 3, C.bone, C.boneDark);
  line([57, 10], [64, 6], 2, C.bone, C.boneDark);
  dot(65, 5, C.boneLight);
  dot(66, 5, C.boneLight);
  if (dazed) {
    // Tongue hanging out of the side of the mouth.
    rect(70, 42, 2, 4, C.tongue);
  }
}

/** A FRONT leg: shoulder → knee → hoof. Thick and straight: a bull's legs are pillars. */
function frontLeg(f: PixelFrame, s: P, hoof: P, c: number, cDark: number): void {
  const kx = s[0] + (hoof[0] - s[0]) * 0.55;
  const ky = s[1] + (hoof[1] - s[1]) * 0.55;
  f.limb(s[0], s[1], kx, ky, 10, c, cDark);
  f.limb(kx, ky, hoof[0], hoof[1] - 3, 6, c, cDark);
  hoofSide(f, hoof);
}

/** A HIND leg: hip → knee (forward) → hock (back) → hoof: the zig-zag of a hoofed animal. */
function hindLeg(f: PixelFrame, hip: P, hoof: P, c: number, cDark: number): void {
  const kx = hip[0] + (hoof[0] - hip[0]) * 0.4 + 4;
  const ky = hip[1] + 9;
  const hx = hoof[0] - 3;
  const hy = hoof[1] - 9;
  f.limb(hip[0], hip[1], kx, ky, 13, c, cDark); // big thigh
  f.limb(kx, ky, hx, hy, 7, c, cDark);
  f.limb(hx, hy, hoof[0], hoof[1] - 3, 5, c, cDark);
  hoofSide(f, hoof);
}

/** Cloven hoof seen from the side: dark, with a notch. */
function hoofSide(f: PixelFrame, h: P): void {
  f.rect(h[0] - 4, h[1] - 2, 8, 3, C.hideDark);
  f.set(h[0] + 1, h[1], C.outline);
  f.set(h[0] - 3, h[1] - 2, C.outline);
}

function paintSide(p: SidePose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  const shoulder: P = [52, 50 + b];
  const hip: P = [20, 46 + b];

  // Far legs first, darker (in shadow, behind the body).
  frontLeg(f, shoulder, p.frontFar, C.hideDark, C.outline);
  hindLeg(f, hip, p.backFar, C.hideDark, C.outline);

  // Tail: hangs from the rump, a tuft at the end with a smoldering tip.
  f.limb(8, 30 + b, 4, 44 + b, 2, C.hide, C.hideDark);
  f.limb(4, 44 + b, 4, 51 + b, 3, C.hideDark, C.outline);
  embers(f, [[4, 52 + b]]);

  // Body column by column. The top line is the silhouette that says "bull":
  // low rump, rising back, a HUGE hump over the shoulders, down to the neck.
  // The bottom line is a deep, round barrel of a belly: a heavy animal.
  const top: P[] = [[7, 32], [10, 27], [20, 22], [34, 15], [46, 7], [54, 9], [62, 22]];
  const bottom: P[] = [[7, 44], [10, 50], [18, 56], [32, 59], [46, 59], [56, 55], [62, 46]];
  for (let x = 7; x <= 62; x++) {
    const t = Math.round(profile(top, x)) + b;
    const u = Math.round(profile(bottom, x)) + b;
    f.rect(x, t, 1, u - t + 1, C.hide);
    f.set(x, t, C.hideLight);
    f.set(x, t + 1, C.hideLight);
    f.set(x, u, C.hideDark);
    f.set(x, u - 1, C.hideDark);
  }
  // Shaggy darker mane on the hump (a few vertical strokes).
  for (let x = 42; x <= 58; x += 2) f.rect(x, Math.round(profile(top, x)) + 3 + b, 1, 7, C.hideDark);
  // Belly shadow: a darker band along the bottom makes it read round, not flat.
  for (let x = 12; x <= 58; x++) f.rect(x, Math.round(profile(bottom, x)) - 4 + b, 1, 3, C.hideDark);
  // Brass plate riveted on its back, two exhaust pipes with glowing mouths.
  for (let x = 24; x <= 38; x++) {
    const t = Math.round(profile(top, x)) + b;
    f.rect(x, t - 2, 1, 6, C.brass);
    f.set(x, t - 2, C.brassLight);
    f.set(x, t + 3, C.brassDark);
  }
  for (const x of [28, 32, 36]) f.set(x, Math.round(profile(top, x)) + b + 1, C.brassLight); // rivets
  for (const x of [29, 34]) {
    const t = Math.round(profile(top, x)) + b;
    f.rect(x, t - 7, 2, 7, C.brass);
    f.set(x, t - 7, C.brassLight);
    embers(f, [[x, t - 8], [x + 1, t - 8]]);
  }
  // Ember cracks: haunch and shoulder.
  embers(f, [[16, 34 + b], [17, 35 + b], [17, 36 + b], [18, 37 + b], [47, 30 + b], [48, 31 + b], [48, 32 + b], [49, 33 + b], [36, 44 + b], [37, 45 + b], [38, 46 + b]]);

  // Neck (a thick limb from the shoulders to the skull), then the head.
  const { drop } = HEAD[p.head];
  f.limb(54, 26 + b, 60, 32 + drop + b, 17, C.hide, C.hideDark);
  paintHeadSide(f, p.head, b);

  // Near legs last, in front of the body.
  frontLeg(f, shoulder, p.frontNear, C.hide, C.hideDark);
  hindLeg(f, hip, p.backNear, C.hide, C.hideDark);

  if (p.head === 'dazed') stars(f, 62, 12 + drop);
  f.outline(C.outline);
  return f;
}

/** Three little stars around its head: the cartoon "dazed" sign (it reads from far away). */
function stars(f: PixelFrame, x: number, y: number): void {
  for (const [sx, sy] of [[x, y], [x + 9, y - 3], [x + 15, y + 3]] as P[]) {
    f.set(sx, sy, C.star);
    f.set(sx - 1, sy, C.star);
    f.set(sx + 1, sy, C.star);
    f.set(sx, sy - 1, C.star);
    f.set(sx, sy + 1, C.star);
  }
}

/** Dead: rolled on its side, legs stiff in the air, tongue out. */
function paintDead(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  for (const [x0, x1] of [[48, 54], [42, 46], [24, 28], [18, 22]] as const) {
    f.limb(x0, 54, x1, 40, 5, C.hide, C.hideDark);
    f.rect(x1 - 2, 37, 6, 3, C.hideDark); // hooves up
  }
  for (let x = 10; x <= 60; x++) {
    const t = Math.round(profile([[10, 58], [18, 50], [40, 47], [60, 53]], x));
    f.rect(x, t, 1, 71 - t, C.hide);
    f.set(x, t, C.hideLight);
  }
  f.rect(28, 66, 14, 2, C.brass); // the plate, now on its side
  f.rect(60, 58, 16, 13, C.hide); // head on the ground
  f.rect(70, 62, 8, 9, C.muzzle);
  f.rect(74, 70, 2, 2, C.tongue);
  f.limb(62, 58, 58, 50, 3, C.bone, C.boneDark); // horn sticking up
  f.limb(58, 50, 62, 45, 2, C.bone, C.boneDark);
  f.set(65, 61, C.hideDark); // closed eye
  f.set(66, 61, C.hideDark);
  // No glow: the fire inside went out.
  f.outline(C.outline);
  return f;
}

// --- Front view (coming at you) ----------------------------------------------

/** Mirror a front-view x coordinate (the view is symmetric). */
const mx = (x: number) => FRAME_W - 1 - x;

function paintFront(liftL: number, liftR: number, bob: number, head: 'up' | 'down' | 'dazed'): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = bob;
  // Hind legs peeking out behind the front ones.
  for (const x of [20, mx(27)]) {
    f.rect(x, 52 + b, 8, 18 - b, C.hideDark);
    f.rect(x - 1, 68, 10, 3, C.outline);
  }
  // Body: rows, half-width from the narrow top of the hump to the wide,
  // round barrel of the chest and belly.
  const halfWidth: P[] = [[10, 7], [14, 15], [22, 21], [36, 25], [48, 24], [54, 20], [58, 14]];
  for (let y = 10; y <= 58; y++) {
    const hw = Math.round(profile(halfWidth, y));
    f.rect(42 - hw, y + b, hw * 2, 1, C.hide);
    f.set(42 - hw, y + b, C.hideLight);
    f.set(41 + hw, y + b, C.hideDark);
  }
  // Plate and pipes on top of the hump.
  f.rect(35, 9 + b, 14, 4, C.brass);
  f.rect(35, 9 + b, 14, 1, C.brassLight);
  for (const x of [37, 42, 46]) f.set(x, 11 + b, C.brassDark); // rivets
  for (const x of [34, mx(35)]) {
    f.rect(x, 4 + b, 2, 7, C.brass);
    embers(f, [[x, 3 + b], [x + 1, 3 + b]]);
  }
  embers(f, [[22, 34 + b], [23, 35 + b], [23, 36 + b], [mx(22), 34 + b], [mx(23), 35 + b], [mx(23), 36 + b]]);
  // Belly shadow on the sides: it reads round.
  for (let y = 40; y <= 56; y++) {
    const hw = Math.round(profile(halfWidth, y));
    f.rect(42 - hw + 1, y + b, 2, 1, C.hideDark);
    f.rect(40 + hw - 2, y + b, 2, 1, C.hideDark);
  }
  // Front legs: pillars, one lifted at a time.
  for (const [x, lift] of [[27, liftL], [mx(36), liftR]] as const) {
    f.rect(x, 50 + b, 10, 19 - b - lift, C.hide);
    f.rect(x, 50 + b, 1, 19 - b - lift, C.hideLight);
    f.rect(x - 1, 68 - lift, 12, 3, C.hideDark); // hoof
    f.set(x + 4, 70 - lift, C.outline); // the cleft
  }

  // Head. Lowered for the charge: everything drops 10 px, horns point at you.
  const d = head === 'up' ? 0 : 10;
  const y = (v: number) => v + d + b;
  // Horns: from the sides of the skull out, then up, tips curving in.
  for (const s of [1, -1]) {
    const X = (v: number) => (s === 1 ? v : mx(v));
    if (head === 'up') {
      f.limb(X(34), y(24), X(24), y(21), 4, C.bone, C.boneDark);
      f.limb(X(24), y(21), X(18), y(14), 3, C.bone, C.boneDark);
      f.limb(X(18), y(14), X(21), y(7), 2, C.bone, C.boneDark);
      f.set(X(22), y(6), C.boneLight);
    } else {
      // Seen nose-down: the horns come toward you, shorter on screen, tips bright.
      f.limb(X(34), y(24), X(23), y(22), 4, C.bone, C.boneDark);
      f.limb(X(23), y(22), X(20), y(17), 3, C.bone, C.boneDark);
      f.rect(X(20) - (s === 1 ? 1 : 0), y(15), 2, 2, C.boneLight);
    }
    // Ear under the horn.
    f.triangle(X(34), y(27), X(34), y(31), X(27), y(30), C.hideDark);
  }
  f.rect(33, y(21), 18, 14, C.hide); // skull
  f.rect(33, y(21), 18, 2, C.hideLight);
  f.rect(36, y(33), 12, 11, C.muzzle); // muzzle
  f.rect(36, y(43), 12, 1, C.hideDark);
  const dazed = head === 'dazed';
  for (const x of [38, mx(38)]) f.set(x, y(38), dazed ? C.hideDark : C.ember, !dazed); // nostrils
  // Nose ring.
  for (const [x, yy] of [[41, 43], [40, 44], [40, 45], [41, 46], [42, 46], [43, 45], [43, 44]] as P[]) f.set(x, y(yy), C.brass);
  f.set(40, y(44), C.brassLight);
  // Eyes under slanted brows (the angry look); a charging bull looks UP at you from under them.
  for (const s of [1, -1]) {
    const X = (v: number) => (s === 1 ? v : mx(v));
    f.set(X(35), y(25), C.hideDark);
    f.rect(Math.min(X(36), X(37)), y(26), 2, 1, C.hideDark);
    if (dazed) f.set(X(36), y(28), C.hideDark);
    else {
      f.set(X(36), y(28), C.eye, true);
      f.set(X(37), y(28), C.eye, true);
    }
  }
  if (dazed) {
    f.rect(44, y(44), 2, 4, C.tongue);
    stars(f, 30, 2 + b); // above the hump: the head is down, behind it
  }
  f.outline(C.outline);
  return f;
}

// --- Back view (going away) ----------------------------------------------------

function paintBack(stride: number): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  // Horn tips sticking out past the hump (the head is hidden in front).
  for (const s of [1, -1]) {
    const X = (v: number) => (s === 1 ? v : mx(v));
    f.limb(X(24), 20, X(16), 14, 3, C.bone, C.boneDark);
    f.limb(X(16), 14, X(18), 8, 2, C.bone, C.boneDark);
  }
  // Hump (behind) and rump (in front): two stacks of rows.
  for (let y = 8; y <= 26; y++) {
    const hw = Math.round(profile([[8, 7], [14, 16], [26, 22]], y));
    f.rect(42 - hw, y, hw * 2, 1, C.hideDark);
  }
  f.rect(36, 8, 12, 3, C.brass);
  f.rect(36, 8, 12, 1, C.brassLight);
  for (const x of [34, mx(35)]) {
    f.rect(x, 2, 2, 7, C.brass);
    embers(f, [[x, 1], [x + 1, 1]]);
  }
  // Hind legs, alternating.
  for (const [x, lift] of [[25, stride], [mx(35), 3 - stride]] as const) {
    f.rect(x, 48, 11, 21 - lift, C.hide);
    f.rect(x, 48, 1, 21 - lift, C.hideLight);
    f.rect(x - 1, 68 - lift, 13, 3, C.hideDark);
    f.set(x + 5, 70 - lift, C.outline);
  }
  for (let y = 20; y <= 54; y++) {
    const hw = Math.round(profile([[20, 14], [26, 21], [42, 24], [50, 22], [54, 16]], y));
    f.rect(42 - hw, y, hw * 2, 1, C.hide);
    f.set(42 - hw, y, C.hideLight);
    f.set(41 + hw, y, C.hideDark);
  }
  embers(f, [[24, 30], [25, 31], [25, 32], [mx(24), 30], [mx(25), 31], [mx(25), 32]]);
  // Tail down the middle, tuft at the end.
  f.limb(42, 22, 42, 44, 2, C.hideDark, C.outline);
  f.rect(41, 44, 3, 5, C.hideDark);
  embers(f, [[42, 49]]);
  f.outline(C.outline);
  return f;
}

/**
 * Walk: 4 frames, diagonal pairs (near-front with far-back) move together,
 * like a trot. Charge: 2 frames, a bounding gallop with legs stretched out
 * and gathered, head down.
 */
const SIDE_WALK: SidePose[] = [
  { frontNear: [60, 71], frontFar: [50, 71], backNear: [12, 71], backFar: [24, 70], bob: 0, head: 'up' },
  { frontNear: [56, 70], frontFar: [54, 71], backNear: [18, 71], backFar: [22, 71], bob: 1, head: 'up' },
  { frontNear: [50, 71], frontFar: [60, 70], backNear: [24, 70], backFar: [12, 71], bob: 0, head: 'up' },
  { frontNear: [54, 71], frontFar: [56, 70], backNear: [22, 71], backFar: [18, 71], bob: 1, head: 'up' },
];

/** Every frame, in the order of FRAMES. Exported so a preview script can paint them to an image. */
export function paintBullFrames(): PixelFrame[] {
  return [
    ...SIDE_WALK.map(paintSide),
    // Charge: stretched out, then gathered.
    paintSide({ frontNear: [70, 66], frontFar: [66, 68], backNear: [6, 68], backFar: [10, 69], bob: -2, head: 'down' }),
    paintSide({ frontNear: [52, 71], frontFar: [48, 70], backNear: [30, 71], backFar: [34, 70], bob: 1, head: 'down' }),
    // Pawing the ground (aiming): the near front hoof scrapes back, head lowering.
    paintSide({ frontNear: [62, 68], frontFar: [52, 71], backNear: [16, 71], backFar: [22, 71], bob: 0, head: 'mid' }),
    paintSide({ frontNear: [48, 71], frontFar: [52, 71], backNear: [16, 71], backFar: [22, 71], bob: 1, head: 'mid' }),
    // Locked: all four planted wide, head fully down.
    paintSide({ frontNear: [60, 71], frontFar: [56, 71], backNear: [12, 71], backFar: [18, 71], bob: 2, head: 'down' }),
    // Skid: front legs braced forward, hind legs under it.
    paintSide({ frontNear: [70, 71], frontFar: [66, 71], backNear: [30, 71], backFar: [26, 71], bob: 1, head: 'mid' }),
    // Dazed: legs splayed, head drooping, stars.
    paintSide({ frontNear: [58, 71], frontFar: [50, 71], backNear: [18, 71], backFar: [24, 71], bob: 3, head: 'dazed' }),
    paintFront(3, 0, 0, 'up'),
    paintFront(0, 3, 1, 'up'),
    paintFront(4, 0, 0, 'down'),
    paintFront(0, 4, 2, 'down'),
    paintFront(0, 0, 2, 'dazed'),
    paintBack(0),
    paintBack(3),
    paintDead(),
  ];
}

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function bullSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(paintBullFrames());
  return sheet;
}
