// The Damned Smith's sprite, painted pixel by pixel: not a tin robot, a huge
// grotesque BRUTE with iron driven into its flesh. Hunched, a small head sunk
// between enormous shoulders, gorilla arms with swollen forearms, a belly
// over the leather apron, short thick legs. Sickly grey-pink skin, scars and
// stitches; a riveted iron plate on one shoulder (the skin inflamed around
// the rivets), an iron muzzle bolted over the mouth, one eye nailed shut
// under an iron plate and the other burning, iron bands on the forearm, the
// chain wrapped around the other arm with its red-hot hook.
//
// 80 × 104 px at 32 px per meter = 2.5 × 3.25 m. Coordinates: x right, y
// DOWN, row 103 = the floor.
//
// THREE VIEWS like the bull and the hound: FRONT, SIDE (facing right: the
// head is at high x; mirrored for the left by the renderer), BACK (walking
// only: it always turns to face you before attacking).
//
// What must match the simulation:
// - the HEAD is above smithHeadHeight (2.25 m = 72 px above the floor = row
//   31): everything above row 31 is the head (the shoulders stop just below).
//   Where you see the head, a hit is critical. The rest is "armor": the
//   sheer mass of the brute.
// - the hitbox is 2.9 m tall (row 10): the top of the head is around row 13.
//
// Each frame is a POSE: a few numbers (body bob, foot lifts, where the hammer
// and the chain are) given to the same body-part functions. The pose tables
// are at the bottom of the file.
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 80;
export const FRAME_H = 104;

/** Where every pose is in the sheet (the order of the list in smithSheet()). */
export const FRAMES = {
  front: { walk: [0, 1, 2, 3], windup: 4, slam: 5, swing: [6, 7], throw: 8, pull: 9 },
  side: { walk: [10, 11, 12, 13], windup: 14, slam: 15, swing: [16, 17], throw: 18, pull: 19 },
  back: { walk: [20, 21, 22, 23] },
  dead: 24,
} as const;

/** Three shades of a material: lit (upper left), base, in shadow. */
type Shades = readonly [number, number, number];

const OUTLINE = 0x0c0806;
const SKIN: Shades = [0xc4a090, 0x9c7a6c, 0x6a4c44];
const SKIN_FAR: Shades = [0x9c7a6c, 0x7a5c52, 0x52383a]; // the far arm and leg in the side view: in shadow
const IRON: Shades = [0x86828e, 0x55525c, 0x302e36];
const LEATHER: Shades = [0x7a5030, 0x5a3820, 0x3a2212];
const TROUSERS: Shades = [0x5a4a44, 0x3e302c, 0x281e1a];
const SKIN_SHADOW = 0x3e2a28; // the shadow an arm casts on the body
const STITCH = 0x4a1010; // scars and stitches
const INFLAMED = 0xa04838; // the skin around the iron
const TEETH = 0xd8c890;
const EMBER = 0xff5a18; // glowing (in the glow mask): the eye, the hot hammer edge, the hook
const HOT = 0xffc060;

// --- Drawing tools --------------------------------------------------------------

/**
 * A shaded ellipse: the building block of a fleshy body. For every pixel
 * inside, (nx, ny) is where it is in the ellipse from -1 to 1; a dot product
 * with the light direction (from the upper left) picks the shade. Three
 * shades are enough to read a round mass: a belly, a shoulder, a skull.
 */
function blob(f: PixelFrame, cx: number, cy: number, rx: number, ry: number, s: Shades): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const light = nx * 0.55 + ny * 0.8; // < 0 = facing the light
      f.set(x, y, light < -0.5 ? s[0] : light > 0.45 || (d > 0.8 && light > 0.1) ? s[2] : s[1]);
    }
  }
}

/** A limb with volume: a thick line in the base color, its shadow edge, and a lit stripe. */
function arm(f: PixelFrame, x0: number, y0: number, x1: number, y1: number, width: number, s: Shades, contour = false): void {
  // An arm over a body of the same color would vanish into it. A full black
  // contour makes it look cut out of cardboard; a deep shadow on its BACK
  // side only (2 px behind it) reads as a round arm casting a shadow.
  if (contour) f.limb(x0 - 2, y0, x1 - 2, y1, width, SKIN_SHADOW, SKIN_SHADOW);
  f.limb(x0, y0, x1, y1, width, s[1], s[2]);
  f.limb(x0 + 1, y0, x1 + 1, y1, Math.max(1, Math.floor(width / 3)), s[0], s[0]);
}

/** A rivet: a light dot with a dark pixel under it, and angry skin around (only if `flesh`). */
function rivet(f: PixelFrame, x: number, y: number, flesh = false): void {
  if (flesh) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1]]) f.set(x + dx, y + dy, INFLAMED);
  f.set(x, y, IRON[0]);
  f.set(x, y + 1, IRON[2]);
}

/** A scar with stitches: a dark line from (x0, y0) to (x1, y1) with a cross tick every 2 px. */
function stitches(f: PixelFrame, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    f.set(x, y, STITCH);
    if (i % 2 === 0) {
      f.set(x, y - 1, STITCH);
      f.set(x, y + 1, STITCH);
    }
  }
}

/** An iron plate bolted on: a rectangle with a lit top edge and rivets in the corners. */
function plate(f: PixelFrame, x: number, y: number, w: number, h: number, flesh = true): void {
  f.rect(x, y, w, h, IRON[1]);
  f.rect(x, y, w, 1, IRON[0]);
  f.rect(x, y + h - 1, w, 1, IRON[2]);
  rivet(f, x + 1, y + 1, flesh);
  rivet(f, x + w - 2, y + 1, flesh);
  if (h > 4) {
    rivet(f, x + 1, y + h - 3, flesh);
    rivet(f, x + w - 2, y + h - 3, flesh);
  }
}

/** Chain links from (x0, y0) to (x1, y1): alternating flat and upright links, iron with a glint. */
function links(f: PixelFrame, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    f.set(x, y, i % 2 ? IRON[1] : IRON[0]);
    f.set(x + (i % 2 ? 0 : 1), y + (i % 2 ? 1 : 0), IRON[2]);
  }
}

/** Chain wrapped around a forearm: diagonal rows of links across it. */
function chainWrap(f: PixelFrame, x: number, y: number, w: number, rows: number): void {
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < w; i++) f.set(x + i, y + r * 3 + (i >> 2), i % 2 ? IRON[1] : IRON[0]);
  }
}

/** The red-hot hook: a glowing "J" hanging from (x, y). */
function hook(f: PixelFrame, x: number, y: number, flip = false): void {
  const s = flip ? -1 : 1;
  for (let j = 0; j < 5; j++) f.set(x, y + j, j < 2 ? EMBER : HOT, true);
  for (const [dx, dy] of [[1, 5], [2, 5], [3, 4], [3, 3], [3, 2]]) f.set(x + dx * s, y + dy, HOT, true);
}

/** The hammer: a handle from the hand (x0, y0) to (x1, y1) and an iron head at the end, its striking edge red-hot. */
function hammer(f: PixelFrame, x0: number, y0: number, x1: number, y1: number, headW: number, headH: number, hot: boolean): void {
  f.limb(x0, y0, x1, y1, 3, LEATHER[1], LEATHER[2]);
  const hx = Math.round(x1 - headW / 2);
  const hy = Math.round(y1 - headH / 2);
  f.rect(hx, hy, headW, headH, IRON[1]);
  f.rect(hx, hy, headW, 2, IRON[0]);
  f.rect(hx + headW - 2, hy, 2, headH, IRON[2]);
  rivet(f, hx + 2, hy + 3);
  rivet(f, hx + headW - 4, hy + 3);
  if (hot) for (let x = hx; x < hx + headW; x++) f.set(x, hy + headH - 1, HOT, true);
}

/** A trouser leg from the hip to above the foot, and a heavy boot with an iron toe cap. */
function leg(f: PixelFrame, hipX: number, hipY: number, footX: number, footY: number, s: Shades, toeRight: boolean): void {
  f.limb(hipX, hipY, footX, footY - 5, 12, s[1], s[2]);
  f.limb(hipX + 2, hipY, footX + 2, footY - 5, 2, s[0], s[0]);
  const bx = toeRight ? footX - 4 : footX - 6;
  f.rect(bx, footY - 5, toeRight ? 12 : 13, 6, LEATHER[2]);
  f.rect(toeRight ? bx + 8 : bx + 1, footY - 4, 4, 4, IRON[1]); // the iron toe cap
}

// --- FRONT view --------------------------------------------------------------

interface FrontPose {
  /** Upper body offset, px (+ = down): the walk's bounce, the slam's crouch. */
  bob: number;
  /** How much each foot is lifted, px (viewer's left / right). */
  liftL: number;
  liftR: number;
  /** Arm swing while walking, px (the hammer arm; the chain arm swings the other way). */
  swing: number;
  hammer: 'down' | 'up' | 'slam';
  chain: 'down' | 'swing0' | 'swing1' | 'throw' | 'pull';
}

/** The head: bald, small, sunk. Viewer's left eye burns, the right one is nailed under a plate; an iron muzzle. */
function headFront(f: PixelFrame, cx: number, cy: number): void {
  blob(f, cx - 9, cy, 2, 3, SKIN); // ears
  blob(f, cx + 9, cy, 2, 3, SKIN);
  blob(f, cx, cy, 8, 9, SKIN);
  stitches(f, cx - 6, cy - 7, cx + 5, cy - 4); // a scar across the scalp
  f.rect(cx - 5, cy - 2, 4, 3, SKIN[2]); // the socket
  f.set(cx - 4, cy - 1, EMBER, true);
  f.set(cx - 3, cy - 1, HOT, true);
  plate(f, cx, cy - 5, 7, 7); // the nailed eye
  // The muzzle: an iron grille over the jaw, rotten teeth between the bars.
  f.rect(cx - 6, cy + 4, 12, 5, IRON[1]);
  f.rect(cx - 6, cy + 4, 12, 1, IRON[0]);
  for (let x = cx - 5; x < cx + 6; x += 3) f.rect(x, cy + 5, 1, 4, IRON[2]);
  for (const x of [cx - 4, cx - 1, cx + 3]) f.set(x, cy + 6, TEETH);
}

function front(p: FrontPose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  const up = p.hammer === 'up';
  const slam = p.hammer === 'slam';

  // Behind everything: a raised hammer's head, a swinging chain's far half.
  if (up) hammer(f, 40, 13, 40, 6, 26, 9, true);

  leg(f, 31, 78 + b, 30, 103 - p.liftL, TROUSERS, false);
  leg(f, 49, 78 + b, 50, 103 - p.liftR, TROUSERS, false);
  // Belt and apron (burnt, stained).
  f.rect(26, 78 + b, 28, 18 - Math.max(0, b), LEATHER[1]);
  f.rect(26, 78 + b, 2, 18 - Math.max(0, b), LEATHER[2]);
  f.rect(33, 86 + b, 3, 2, LEATHER[2]); // a burn hole
  f.rect(22, 74 + b, 36, 4, LEATHER[2]);
  f.rect(37, 74 + b, 6, 4, IRON[0]); // buckle
  // The belly, hanging over the belt, with a long stitched scar and a plate bolted into it.
  blob(f, 40, 64 + b, 18, 12, SKIN);
  stitches(f, 27, 61 + b, 49, 68 + b);
  plate(f, 45, 56 + b, 9, 6);
  // The chest and the huge shoulders, the neck mass rising to the ears.
  blob(f, 40, 48 + b, 21, 13, SKIN);
  for (let x = 29; x <= 51; x++) if (x !== 40) f.set(x, 54 + b + (Math.abs(x - 40) >> 3), SKIN[2]); // the sagging pecs
  blob(f, 20, 40 + b, 10, 9, SKIN);
  blob(f, 60, 40 + b, 10, 9, SKIN);
  f.triangle(25, 36 + b, 40, 31 + b, 55, 36 + b, SKIN[1]);
  // The shoulder plate on the chain side: driven into the flesh.
  plate(f, 53, 33 + b, 15, 9);

  // The hammer arm (viewer's left).
  if (p.hammer === 'down') {
    arm(f, 19, 42 + b, 13, 58 + b, 9, SKIN);
    hammer(f, 15, 70 + b + p.swing, 13, 96, 18, 12, false);
    arm(f, 13, 58 + b, 15, 70 + b + p.swing, 12, SKIN);
    f.rect(8, 62 + b, 12, 2, IRON[1]); // iron bands round the forearm
    f.rect(8, 66 + b, 12, 2, IRON[1]);
    blob(f, 15, 73 + b + p.swing, 5, 4, SKIN);
  } else if (up) {
    arm(f, 20, 40 + b, 25, 22, 9, SKIN);
    arm(f, 25, 22, 35, 11, 10, SKIN);
    arm(f, 60, 40 + b, 55, 22, 9, SKIN);
    arm(f, 55, 22, 45, 11, 10, SKIN);
    chainWrap(f, 46, 14, 8, 2);
    blob(f, 37, 10, 4, 4, SKIN);
    blob(f, 43, 10, 4, 4, SKIN);
  } else {
    // Slam: both arms down in front, the hammer smashed into the ground.
    arm(f, 20, 44 + b, 31, 62 + b, 9, SKIN);
    arm(f, 60, 44 + b, 49, 62 + b, 9, SKIN);
    hammer(f, 40, 76 + b, 40, 97, 24, 12, true);
    arm(f, 31, 62 + b, 38, 74 + b, 11, SKIN);
    arm(f, 49, 62 + b, 42, 74 + b, 11, SKIN);
    blob(f, 37, 76 + b, 4, 4, SKIN);
    blob(f, 43, 76 + b, 4, 4, SKIN);
  }

  // The chain arm (viewer's right), when the hammer doesn't need it.
  if (!up && !slam) {
    if (p.chain === 'down') {
      arm(f, 61, 42 + b, 67, 58 + b, 9, SKIN);
      arm(f, 67, 58 + b, 65, 70 + b - p.swing, 12, SKIN);
      chainWrap(f, 60, 59 + b, 12, 3);
      blob(f, 65, 73 + b - p.swing, 5, 4, SKIN);
      links(f, 65, 77 + b - p.swing, 66, 87);
      hook(f, 66, 88);
    } else if (p.chain === 'swing0' || p.chain === 'swing1') {
      arm(f, 61, 40 + b, 67, 24, 9, SKIN);
      arm(f, 67, 24, 57, 12, 11, SKIN);
      chainWrap(f, 58, 15, 10, 2);
      blob(f, 56, 11, 4, 4, SKIN);
      // The chain circling over its head: links along an ellipse, the hook at one end.
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        f.set(46 + Math.cos(a) * 26, 6 + Math.sin(a) * 4, i % 2 ? IRON[1] : IRON[0]);
      }
      if (p.chain === 'swing0') hook(f, 72, 4);
      else hook(f, 20, 4, true);
    } else if (p.chain === 'throw') {
      // Arm thrust toward you: short (foreshortened), the fist big in front of the chest.
      arm(f, 61, 42 + b, 60, 48 + b, 10, SKIN);
      chainWrap(f, 52, 44 + b, 12, 2);
      blob(f, 57, 51 + b, 7, 6, SKIN);
    } else {
      // Pull: elbow out, fist yanked back to the shoulder.
      arm(f, 61, 42 + b, 71, 52 + b, 9, SKIN);
      arm(f, 71, 52 + b, 64, 40 + b, 11, SKIN);
      blob(f, 63, 38 + b, 5, 4, SKIN);
      links(f, 61, 38 + b, 56, 44 + b);
    }
  }

  headFront(f, 40, 22 + Math.min(b, 2));
  f.outline(OUTLINE);
  return f;
}

// --- SIDE view (facing right) --------------------------------------------------------

interface SidePose {
  bob: number;
  /** Foot offsets along the walk, px (+ = forward), and lifts. */
  near: number;
  far: number;
  liftNear: number;
  liftFar: number;
  swing: number;
  hammer: 'down' | 'up' | 'slam';
  chain: 'down' | 'swing0' | 'swing1' | 'throw' | 'pull';
}

/** The head in profile, pushed forward: muzzle in front, the burning eye, a stitched scalp. */
function headSide(f: PixelFrame, cx: number, cy: number): void {
  blob(f, cx, cy, 7, 8, SKIN);
  blob(f, cx - 4, cy + 1, 2, 3, SKIN); // ear
  stitches(f, cx - 6, cy - 5, cx + 2, cy - 7);
  f.rect(cx + 2, cy - 2, 3, 2, SKIN[2]);
  f.set(cx + 4, cy - 1, HOT, true);
  f.set(cx + 3, cy - 1, EMBER, true);
  f.rect(cx + 1, cy + 3, 8, 5, IRON[1]); // the muzzle sticks out
  f.rect(cx + 1, cy + 3, 8, 1, IRON[0]);
  for (let x = cx + 3; x < cx + 9; x += 3) f.rect(x, cy + 4, 1, 4, IRON[2]);
  f.set(cx + 5, cy + 5, TEETH);
  rivet(f, cx + 1, cy + 4, true);
}

function side(p: SidePose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  const bend = p.hammer === 'slam' ? 4 : 0; // bent forward over the hammer

  if (p.hammer === 'up') hammer(f, 32, 10, 16, 7, 12, 11, true); // raised behind its head

  // The far arm (the chain), in shadow, behind the body.
  if (p.hammer !== 'up' && p.hammer !== 'slam') {
    if (p.chain === 'down') {
      arm(f, 36, 40 + b, 34, 56 + b, 8, SKIN_FAR);
      arm(f, 34, 56 + b, 36, 70 + b - p.swing, 10, SKIN_FAR);
      blob(f, 36, 73 + b - p.swing, 4, 4, SKIN_FAR);
      links(f, 36, 76 + b - p.swing, 35, 87);
      hook(f, 35, 88);
    } else if (p.chain === 'swing0' || p.chain === 'swing1') {
      arm(f, 38, 38 + b, 42, 22, 8, SKIN_FAR);
      arm(f, 42, 22, 47, 10, 10, SKIN_FAR);
      blob(f, 47, 9, 4, 4, SKIN_FAR);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        f.set(46 + Math.cos(a) * 24, 6 + Math.sin(a) * 2, i % 2 ? IRON[1] : IRON[0]);
      }
      if (p.chain === 'swing0') hook(f, 70, 4);
      else hook(f, 22, 4, true);
    } else if (p.chain === 'throw') {
      arm(f, 40, 40 + b, 54, 40 + b, 8, SKIN_FAR);
      arm(f, 54, 40 + b, 66, 38 + b, 10, SKIN_FAR);
      blob(f, 69, 38 + b, 5, 4, SKIN_FAR);
    } else {
      arm(f, 36, 40 + b, 24, 47 + b, 8, SKIN_FAR);
      arm(f, 24, 47 + b, 34, 38 + b, 10, SKIN_FAR);
      blob(f, 35, 37 + b, 4, 4, SKIN_FAR);
    }
  }

  leg(f, 36, 78 + b, 36 + p.far, 103 - p.liftFar, [TROUSERS[1], TROUSERS[2], TROUSERS[2]], true);
  // The body: a hump of back, the chest, the belly sticking out over the apron.
  blob(f, 30, 42 + b + bend, 12, 11, SKIN);
  blob(f, 42 + bend, 50 + b + bend, 14, 13, SKIN);
  blob(f, 46 + bend, 66 + b, 13, 11, SKIN);
  stitches(f, 40, 62 + b, 56, 68 + b);
  plate(f, 18 + bend, 35 + b + bend, 12, 10); // iron bolted along the spine
  plate(f, 22, 48 + b, 8, 6);
  f.rect(28, 74 + b, 30, 4, LEATHER[2]); // belt
  f.rect(48, 78 + b, 11, 17, LEATHER[1]); // apron, in front
  f.rect(57, 78 + b, 2, 17, LEATHER[2]);
  // The neck mass, joining the hump to the head pushed forward.
  f.triangle(36, 34 + b + bend, 52 + bend, 30 + b + bend, 48 + bend, 42 + b + bend, SKIN[1]);
  leg(f, 40, 78 + b, 40 + p.near, 103 - p.liftNear, TROUSERS, true);

  // The near arm (the hammer).
  if (p.hammer === 'down') {
    arm(f, 40, 40 + b, 42, 56 + b, 9, SKIN, true);
    hammer(f, 47, 72 + b + p.swing, 50 + p.swing, 96, 12, 12, false);
    arm(f, 42, 56 + b, 46, 70 + b + p.swing, 12, SKIN, true);
    f.rect(39, 61 + b, 11, 2, IRON[1]);
    f.rect(40, 65 + b, 11, 2, IRON[1]);
    blob(f, 47, 73 + b + p.swing, 5, 4, SKIN);
  } else if (p.hammer === 'up') {
    arm(f, 40, 40 + b, 38, 24, 9, SKIN, true);
    arm(f, 38, 24, 32, 11, 10, SKIN);
    blob(f, 32, 10, 5, 4, SKIN);
  } else {
    arm(f, 42, 44 + b + bend, 54, 58 + b, 9, SKIN, true);
    hammer(f, 63, 72 + b, 67, 97, 14, 12, true);
    arm(f, 54, 58 + b, 62, 70 + b, 11, SKIN, true);
    blob(f, 63, 72 + b, 5, 4, SKIN);
  }

  headSide(f, 54 + bend, 24 + Math.min(b, 2) + bend);
  f.outline(OUTLINE);
  return f;
}

// --- BACK view ----------------------------------------------------------------

interface BackPose {
  bob: number;
  liftL: number;
  liftR: number;
  swing: number;
}

function back(p: BackPose): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = p.bob;
  leg(f, 31, 78 + b, 30, 103 - p.liftL, TROUSERS, false);
  leg(f, 49, 78 + b, 50, 103 - p.liftR, TROUSERS, false);
  // Seen from behind the chain arm is on the viewer's LEFT, the hammer on the right.
  arm(f, 19, 42 + b, 13, 58 + b, 9, SKIN);
  arm(f, 13, 58 + b, 15, 70 + b - p.swing, 12, SKIN);
  chainWrap(f, 8, 59 + b, 12, 3);
  blob(f, 15, 73 + b - p.swing, 5, 4, SKIN);
  links(f, 15, 77 + b - p.swing, 14, 87);
  hook(f, 14, 88, true);
  arm(f, 61, 42 + b, 67, 58 + b, 9, SKIN);
  hammer(f, 65, 70 + b + p.swing, 67, 96, 18, 12, false);
  arm(f, 67, 58 + b, 65, 70 + b + p.swing, 12, SKIN);
  blob(f, 65, 73 + b + p.swing, 5, 4, SKIN);
  // The broad back, the hump, the spine, iron driven along it.
  blob(f, 40, 52 + b, 22, 16, SKIN);
  blob(f, 40, 37 + b, 18, 7, SKIN);
  for (let y = 34; y < 70; y++) f.set(40, y + b, SKIN[2]);
  for (const y of [40, 50, 60]) plate(f, 36, y + b, 9, 6);
  stitches(f, 24, 46 + b, 32, 62 + b);
  f.rect(22, 74 + b, 36, 4, LEATHER[2]); // belt
  f.limb(30, 74 + b, 50, 80 + b, 2, LEATHER[1], LEATHER[2]); // apron strings, tied
  f.limb(50, 74 + b, 30, 80 + b, 2, LEATHER[1], LEATHER[2]);
  // The back of the head: a big stitched scar, the muzzle's strap.
  const hy = 22 + Math.min(b, 2);
  blob(f, 31, hy, 2, 3, SKIN);
  blob(f, 49, hy, 2, 3, SKIN);
  blob(f, 40, hy, 8, 9, SKIN);
  stitches(f, 36, hy - 8, 42, hy + 2);
  f.rect(32, hy + 5, 16, 2, IRON[1]);
  rivet(f, 40, hy + 5, true);
  f.outline(OUTLINE);
  return f;
}

/** A heap of flesh and iron on the ground, the hammer dropped, the hook still glowing. */
function dead(): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  blob(f, 38, 94, 30, 9, SKIN);
  blob(f, 30, 88, 14, 6, SKIN);
  stitches(f, 22, 92, 50, 96);
  plate(f, 44, 86, 12, 7);
  f.rect(18, 96, 40, 4, LEATHER[1]);
  blob(f, 71, 96, 6, 5, SKIN); // the head, rolled aside
  f.rect(68, 98, 9, 3, IRON[1]);
  hammer(f, 4, 100, 14, 92, 12, 10, false);
  links(f, 52, 101, 64, 102);
  hook(f, 65, 96);
  f.outline(OUTLINE);
  return f;
}

// --- The poses -------------------------------------------------------------------------------
// The walk: 4 frames, contact → passing → contact → passing. The body is
// lowest on the contacts (bob 1), a foot lifted while it passes, the arms
// swinging opposite to the legs.
const WALK_FRONT: FrontPose[] = [0, 1, 2, 3].map((i) => ({
  bob: i % 2 === 0 ? 1 : 0,
  liftL: i === 1 ? 3 : 0,
  liftR: i === 3 ? 3 : 0,
  swing: [0, -2, 0, 2][i],
  hammer: 'down',
  chain: 'down',
}));
const STILL_FRONT: FrontPose = { bob: 0, liftL: 0, liftR: 0, swing: 0, hammer: 'down', chain: 'down' };

const WALK_SIDE: SidePose[] = [0, 1, 2, 3].map((i) => ({
  bob: i % 2 === 0 ? 1 : 0,
  near: [6, 0, -6, 0][i],
  far: [-6, 0, 6, 0][i],
  liftNear: i === 3 ? 3 : 0,
  liftFar: i === 1 ? 3 : 0,
  swing: [0, -2, 0, 2][i],
  hammer: 'down',
  chain: 'down',
}));
const STILL_SIDE: SidePose = { bob: 0, near: 4, far: -4, liftNear: 0, liftFar: 0, swing: 0, hammer: 'down', chain: 'down' };

const WALK_BACK: BackPose[] = [0, 1, 2, 3].map((i) => ({
  bob: i % 2 === 0 ? 1 : 0,
  liftL: i === 1 ? 3 : 0,
  liftR: i === 3 ? 3 : 0,
  swing: [0, -2, 0, 2][i],
}));

/** All the frames in a sheet, in the order of FRAMES. Pure function: no DOM until buildSheet. */
export function paintSmithFrames(): PixelFrame[] {
  return [
    ...WALK_FRONT.map(front),
    front({ ...STILL_FRONT, hammer: 'up' }),
    front({ ...STILL_FRONT, bob: 5, liftL: 0, hammer: 'slam' }),
    front({ ...STILL_FRONT, chain: 'swing0' }),
    front({ ...STILL_FRONT, chain: 'swing1' }),
    front({ ...STILL_FRONT, chain: 'throw' }),
    front({ ...STILL_FRONT, bob: -1, chain: 'pull' }),
    ...WALK_SIDE.map(side),
    side({ ...STILL_SIDE, hammer: 'up' }),
    side({ ...STILL_SIDE, bob: 3, near: 8, far: -6, hammer: 'slam' }),
    side({ ...STILL_SIDE, chain: 'swing0' }),
    side({ ...STILL_SIDE, chain: 'swing1' }),
    side({ ...STILL_SIDE, near: 6, far: -4, chain: 'throw' }),
    side({ ...STILL_SIDE, bob: -1, near: -2, far: 6, chain: 'pull' }),
    ...WALK_BACK.map(back),
    dead(),
  ];
}

export function smithSheet(): SpriteSheet {
  return buildSheet(paintSmithFrames());
}
