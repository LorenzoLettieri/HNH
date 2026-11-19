// The sharpshooter's sprite sheet, painted pixel by pixel: a skeleton
// gunslinger with a cowboy hat, a red bandana, a bandolier of brass
// cartridges, a holster, boots with spurs, and a Winchester with a brass
// receiver (the "Yellow Boy").
//
// For now only the FRONT view: it doesn't walk yet, and it always turns to
// face you (it aims at you). Side and back views come with climbing.
//
// One frame is 40 × 70 px: at our 32 px/m it's 1.25 × 2.19 m, the same
// texel density as the level. Some pixels must match the simulation
// (src/sim/config.ts); in rows from the top, row = 70 − height × 32:
//   hat top    ≈ 2.15 m (sharpshooterHitHeight)     → row 2
//   chin       ≈ 1.55 m (sharpshooterHeadHeight)    → row 19: above it = critical
//   muzzle       1.45 m (sharpshooterMuzzleHeight)  → rows 23-24, in the center
//                column: when it aims at you the laser comes out of the barrel you see
//
// Frames, left to right:
//   0-1: idle (rifle across the chest, laser off: "not now"; the two frames sway)
//   2: aim (rifle at the shoulder, pointed at YOU: you look down the barrel)
//   3: lever (the lock: lever thrown, a spent shell flying)   4: recoil
//   5-7: death (knees give way → falls apart → a pile of bones)
//   8-10: the same, headless (after a headshot)
import { seededRandom } from '../props/pixelCanvas';
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const FRAME_W = 40;
export const FRAME_H = 70;
export const FRAMES = {
  idle: [0, 1],
  aim: 2,
  lever: 3,
  recoil: 4,
  death: [5, 6, 7],
  deathHeadless: [8, 9, 10],
};

const C = {
  outline: 0x120a08,
  bone: 0xd8ccb0,
  boneLight: 0xf2e8d0,
  boneDark: 0x9c8e72,
  /** Ribs: a tone darker than the arms, so the arms in front of them stand out. */
  rib: 0xbcae92,
  ribDark: 0x857860,
  /** The dark inside of the ribcage, and the shadow the arms cast on the body. */
  cavity: 0x2e1e18,
  socket: 0x140806,
  /** The eyes: embers in the sockets (glow mask). */
  eye: 0xff3018,
  eyeDim: 0x7a1a0c,
  hat: 0x3a2a1e,
  hatDark: 0x241810,
  hatLight: 0x544030,
  band: 0x5a2016,
  bandana: 0x9a2018,
  bandanaDark: 0x641210,
  bandanaDot: 0xe0c8a8,
  leather: 0x5a3a22,
  leatherDark: 0x3a2414,
  brass: 0xc8963c,
  brassLight: 0xf0c868,
  brassDark: 0x8a5e20,
  iron: 0x3a3a44,
  ironLight: 0x60606c,
  ironDark: 0x1c1c22,
  wood: 0x7a4824,
  woodDark: 0x4e2c14,
  bore: 0x080404,
  /** The laser's aperture inside the bore (glow mask): the red dot you see when it aims at you. */
  laser: 0xff2010,
};

type Pt = [number, number];
/** calm: an ember in each socket; aim: the aiming eye blazes; dying: dull, no glow; out: empty sockets. */
type Eyes = 'calm' | 'aim' | 'dying' | 'out';

// --- Body parts. Every bone is 2 px wide: a bone "at x" covers columns x−1 and x. ---

/** A bone: lit from the left (the light column), like the rest of the sprite. */
function bone(f: PixelFrame, x0: number, y0: number, x1: number, y1: number): void {
  f.limb(x0, y0, x1, y1, 2, C.bone, C.boneLight);
}

/** A joint (knee, elbow): a knob a bit wider than the bone. */
function joint(f: PixelFrame, x: number, y: number): void {
  f.rect(x - 2, y - 1, 4, 2, C.bone);
  f.set(x - 2, y - 1, C.boneLight);
  f.set(x + 1, y, C.boneDark);
}

/** A bony hand, 3 × 3 around (x, y), with its shadow. Drawn after the rifle: it wraps around it. */
function hand(f: PixelFrame, x: number, y: number): void {
  f.rect(x, y, 3, 3, C.cavity);
  f.rect(x - 1, y - 1, 3, 3, C.bone);
  f.set(x - 1, y - 1, C.boneLight);
  f.set(x + 1, y + 1, C.boneDark);
}

/**
 * Upper arm, forearm and the elbow between them (the hand comes later, see
 * hand()). Bone in front of bone would melt into one shape, so the arm first
 * paints a dark copy of itself one pixel down-right: a drop shadow that
 * detaches it from the ribs behind it.
 */
function arm(f: PixelFrame, shoulder: Pt, elbow: Pt, wrist: Pt): void {
  f.limb(shoulder[0] + 1, shoulder[1] + 1, elbow[0] + 1, elbow[1] + 1, 2, C.cavity, C.cavity);
  f.limb(elbow[0] + 1, elbow[1] + 1, wrist[0] + 1, wrist[1] + 1, 2, C.cavity, C.cavity);
  bone(f, shoulder[0], shoulder[1], elbow[0], elbow[1]);
  bone(f, elbow[0], elbow[1], wrist[0], wrist[1]);
  joint(f, elbow[0], elbow[1]);
}

/** The skull, 10 px wide and 13 tall (15 with the jaw dropped). (sx, sy) = top-left corner. */
function skull(f: PixelFrame, sx: number, sy: number, eyes: Eyes, jaw: 'closed' | 'open' | 'none' = 'closed'): void {
  // Cranium: a rounded top, then the full width down to the cheekbones.
  f.rect(sx + 2, sy, 6, 1, C.bone);
  f.rect(sx + 1, sy + 1, 8, 1, C.bone);
  f.rect(sx, sy + 2, 10, 6, C.bone);
  f.rect(sx + 1, sy + 8, 8, 2, C.bone); // cheekbones and upper teeth
  // Light from the left, shadow on the right.
  f.rect(sx, sy + 2, 1, 6, C.boneLight);
  f.rect(sx + 9, sy + 3, 1, 5, C.boneDark);
  f.rect(sx + 8, sy + 8, 1, 2, C.boneDark);
  // Eye sockets and the nose hole.
  f.rect(sx + 1, sy + 4, 3, 3, C.socket);
  f.rect(sx + 6, sy + 4, 3, 3, C.socket);
  f.rect(sx + 4, sy + 7, 2, 2, C.socket);
  // Upper teeth: a dark gap every other pixel.
  for (let i = 0; i < 6; i += 2) f.set(sx + 3 + i, sy + 9, C.socket);
  // Eyes. Aiming, the eye behind the sights (its right, our left) burns in a cross.
  if (eyes === 'calm' || eyes === 'aim') {
    f.set(sx + 2, sy + 5, C.eye, true);
    f.set(sx + 7, sy + 5, C.eye, true);
    if (eyes === 'aim') {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) f.set(sx + 2 + dx, sy + 5 + dy, C.eye, true);
    }
  } else if (eyes === 'dying') {
    f.set(sx + 2, sy + 5, C.eyeDim);
    f.set(sx + 7, sy + 5, C.eyeDim);
  }
  // Jaw: closed under the teeth, dropped open (a dark mouth), or gone.
  if (jaw === 'none') return;
  const j = sy + (jaw === 'open' ? 12 : 10);
  if (jaw === 'open') f.rect(sx + 2, sy + 10, 6, 2, C.socket);
  jawBone(f, sx + 2, j);
}

/** The lower jaw on its own (also a loose one, falling). */
function jawBone(f: PixelFrame, x: number, y: number): void {
  f.rect(x, y, 6, 2, C.bone);
  f.rect(x + 1, y + 2, 4, 1, C.bone); // chin
  for (let i = 0; i < 6; i += 2) f.set(x + i, y, C.socket); // lower teeth
  f.rect(x + 5, y, 1, 2, C.boneDark);
}

/**
 * Cowboy hat. (hx, hy) = left end of the brim. Brim 20 px wide with the ends
 * curled up, crown 10 px on top with a leather band and brass studs.
 * `tilt` shears the crown sideways (px per row): a hat flying off, or askew.
 */
function hat(f: PixelFrame, hx: number, hy: number, tilt = 0): void {
  for (let r = 1; r <= 5; r++) {
    const s = Math.round(tilt * r);
    const w = r === 5 ? 8 : 10; // rounded top
    const x = hx + 5 + s + (10 - w) / 2;
    f.rect(x, hy - r, w, 1, r === 1 ? C.band : C.hat);
    if (r > 1) f.set(x, hy - r, C.hatLight); // light from the left
  }
  f.rect(hx + 8 + Math.round(tilt * 5), hy - 5, 4, 1, C.hatDark); // the pinch on top
  const s1 = Math.round(tilt);
  f.set(hx + 7 + s1, hy - 1, C.brassLight); // studs on the band
  f.set(hx + 12 + s1, hy - 1, C.brassLight);
  // Brim, with the two ends curled up.
  f.rect(hx, hy, 20, 1, C.hat);
  f.rect(hx + 1, hy + 1, 18, 1, C.hatDark);
  f.set(hx, hy - 1, C.hat);
  f.set(hx + 19, hy - 1, C.hat);
}

/** Red bandana knotted at the neck, a triangle pointing down. x = center (between columns x−1 and x). */
function bandana(f: PixelFrame, x: number, y: number): void {
  for (let r = 0; r < 5; r++) {
    const half = 5 - r;
    f.rect(x - half, y + r, half * 2, 1, C.bandana);
    f.rect(x, y + r, half, 1, C.bandanaDark); // the right half in shadow
  }
  f.set(x - 3, y + 1, C.bandanaDot);
  f.set(x + 1, y + 2, C.bandanaDot);
  f.set(x - 1, y + 3, C.bandanaDot);
}

/**
 * Collarbones, ribs and sternum. (x, y) = center (between columns x−1 and x)
 * and the collarbones' row. `gap`: rows from one rib to the next (2 standing,
 * 1 crushed while it falls apart).
 */
function ribcage(f: PixelFrame, x: number, y: number, gap = 2): void {
  const half = [6, 7, 7, 6, 5];
  const top = y + 1;
  const bottom = top + 4 * gap + 1;
  // The dark inside first, with the spine at the back; the bones on top.
  for (let r = top; r <= bottom; r++) {
    const h = half[Math.min(4, Math.floor((r - top) / gap))];
    f.rect(x - h + 1, r, h * 2 - 2, 1, C.cavity);
  }
  f.rect(x - 1, top, 2, bottom - top + 1, C.boneDark);
  half.forEach((h, k) => {
    const r = top + k * gap;
    f.rect(x - h, r, h * 2, 1, C.rib);
    f.set(x - h, r, C.bone);
    f.rect(x + h - 3, r, 3, 1, C.ribDark); // the far end in shadow
    f.set(x - h, r + 1, C.rib); // the ends curve down
    f.set(x + h - 1, r + 1, C.ribDark);
  });
  f.rect(x - 1, top, 2, 3 * gap + 1, C.bone); // sternum
  f.rect(x - 1, top, 1, 3 * gap + 1, C.boneLight);
  // Collarbones and the round tops of the arm bones (the shoulders).
  f.rect(x - 8, y, 7, 1, C.bone);
  f.rect(x + 1, y, 7, 1, C.bone);
  f.rect(x - 9, y, 2, 2, C.bone);
  f.rect(x + 7, y, 2, 2, C.bone);
  f.set(x - 9, y, C.boneLight);
}

/** The bare spine between ribs and pelvis: vertebrae, every other one wider. */
function spine(f: PixelFrame, x: number, y0: number, y1: number): void {
  for (let r = y0; r <= y1; r++) {
    const wide = (r - y0) % 2 === 0;
    f.rect(x - (wide ? 2 : 1), r, wide ? 4 : 2, 1, wide ? C.bone : C.boneDark);
  }
}

/** A leather strap with brass cartridges, across the chest. */
function bandolier(f: PixelFrame, x0: number, y0: number, x1: number, y1: number): void {
  f.limb(x0, y0, x1, y1, 2, C.leather, C.leatherDark);
  const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 2.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    f.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 1, C.brassLight);
  }
}

/** Gun belt (with the holster on its right hip, our left) and the pelvis under it. y = the belt's top row. */
function hips(f: PixelFrame, x: number, y: number): void {
  f.rect(x - 7, y, 14, 2, C.leather);
  f.rect(x - 7, y + 1, 14, 1, C.leatherDark);
  f.rect(x - 2, y, 4, 2, C.brass); // buckle
  f.set(x - 2, y, C.brassLight);
  f.rect(x - 10, y + 1, 3, 6, C.leather); // holster...
  f.rect(x - 10, y + 1, 1, 6, C.leatherDark);
  f.rect(x - 10, y - 1, 2, 2, C.wood); // ...and the revolver's grip
  // Pelvis: the two wings, the arch under them, the sacrum in the middle.
  f.rect(x - 7, y + 2, 5, 1, C.bone);
  f.rect(x + 2, y + 2, 5, 1, C.bone);
  f.rect(x - 7, y + 3, 6, 1, C.bone);
  f.rect(x + 1, y + 3, 6, 1, C.bone);
  f.rect(x - 6, y + 4, 5, 1, C.bone);
  f.rect(x + 1, y + 4, 5, 1, C.bone);
  f.rect(x - 4, y + 5, 8, 1, C.bone);
  f.rect(x - 1, y + 2, 2, 3, C.boneDark);
  f.set(x - 7, y + 2, C.boneLight);
  f.set(x + 6, y + 3, C.boneDark);
  f.set(x - 4, y + 4, C.socket);
  f.set(x + 3, y + 4, C.socket);
}

/** A cowboy boot seen from the front, toe toward us. x0 = the shaft's left column, y = its top. */
function boot(f: PixelFrame, x0: number, y: number, spurSide: -1 | 1): void {
  f.rect(x0, y, 4, 6, C.leather);
  f.rect(x0, y, 4, 1, C.leatherDark); // the opening
  f.rect(x0, y + 1, 1, 5, C.hatLight); // light from the left
  f.rect(x0 - 1, y + 6, 6, 3, C.leather); // foot
  f.rect(x0, y + 6, 4, 1, C.hatLight); // the toe's highlight
  f.rect(x0 - 1, y + 9, 6, 1, C.leatherDark); // sole
  f.set(spurSide < 0 ? x0 - 2 : x0 + 5, y + 7, C.brassLight); // spur, on the outside
}

/** A boot lying on its side (pile of bones). x = leftmost column, y = top row; 5 rows tall. */
function bootLying(f: PixelFrame, x: number, y: number, toeLeft: boolean): void {
  f.rect(x + (toeLeft ? 4 : 0), y, 5, 4, C.leather); // shaft
  f.rect(x + (toeLeft ? 0 : 5), y + 1, 4, 3, C.leather); // foot
  f.rect(x, y + 4, 9, 1, C.leatherDark); // sole
  f.rect(x + (toeLeft ? 8 : 0), y, 1, 4, C.leatherDark); // the opening
  f.set(x + (toeLeft ? 4 : 4), y + 5, C.brassLight); // spur
}

/**
 * The Winchester in profile, from the butt (bx, by) to the muzzle (mx, my):
 * wooden stock, brass receiver with the lever loop under it, iron barrel
 * (with the magazine tube) and wooden forend.
 */
function rifleSide(f: PixelFrame, bx: number, by: number, mx: number, my: number): void {
  const at = (t: number): Pt => [bx + (mx - bx) * t, by + (my - by) * t];
  const len = Math.hypot(mx - bx, my - by);
  // "Under the rifle": the perpendicular direction pointing down the image (+y).
  let ux = -(my - by) / len;
  let uy = (mx - bx) / len;
  if (uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  f.limb(...at(0.4), ...at(1), 2, C.iron, C.ironDark); // barrel and magazine tube
  f.limb(...at(0.4), ...at(0.6), 3, C.wood, C.woodDark); // forend
  // The lever loop: a little iron ring under the receiver.
  const [lx, ly] = at(0.33);
  const cx = lx + ux * 2.5;
  const cy = ly + uy * 2.5;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) f.set(cx + dx, cy + dy, C.iron);
  f.limb(...at(0.28), ...at(0.4), 4, C.brass, C.brassDark); // receiver
  f.limb(...at(0), ...at(0.28), 3, C.wood, C.woodDark); // stock
  f.limb(...at(0), ...at(0.03), 3, C.brass, C.brassDark); // brass butt plate
  const [sx, sy] = at(1);
  f.set(sx - ux * 1.5, sy - uy * 1.5, C.ironLight); // front sight, on top of the muzzle
}

/**
 * The Winchester pointed at you: the stock in its right shoulder (our left),
 * the brass receiver under its cheek, and in the middle the muzzle seen
 * end-on. It's drawn BIGGER than it would be (6 px ≈ 19 cm): it's the closest
 * thing to you, and it must read from 40 m. Under it, the smaller ring of the
 * magazine tube: two circles one above the other = a lever-action rifle.
 * The bore is at rows 23-24, i.e. 1.45 m. `lift` = the muzzle kicked up by
 * the recoil, px; `laser` = the red dot in the bore.
 */
function rifleFront(f: PixelFrame, lift: number, laser: boolean, lever: boolean): void {
  f.rect(11, 23, 3, 3, C.wood); // stock against the shoulder
  f.rect(11, 25, 3, 1, C.woodDark);
  f.rect(14, 22, 3, 4, C.brass); // receiver
  f.set(14, 22, C.brassLight);
  f.rect(14, 25, 3, 1, C.brassDark);
  f.set(15, 21, C.iron); // hammer
  if (lever) {
    // Lever thrown: the loop hangs open under the receiver.
    f.rect(14, 26, 1, 4, C.iron);
    f.rect(16, 26, 1, 4, C.iron);
    f.rect(14, 29, 3, 1, C.iron);
  }
  const top = 21 - lift;
  if (lift > 0) f.limb(16, 24, 19, top + 4, 3, C.iron, C.ironDark); // the barrel shows when it tips up
  // Barrel end: an octagon 6 px across (no corners), lit from the top-left,
  // a dark rim inside, the bore in the middle.
  f.rect(18, top, 4, 1, C.ironLight);
  f.rect(17, top + 1, 6, 4, C.iron);
  f.rect(17, top + 1, 1, 4, C.ironLight);
  f.rect(22, top + 1, 1, 4, C.ironDark);
  f.rect(18, top + 5, 4, 1, C.ironDark);
  f.rect(18, top + 1, 4, 4, C.ironDark);
  f.rect(19, top + 2, 2, 2, C.bore);
  if (laser) for (const [x, y] of [[19, top + 2], [20, top + 2], [19, top + 3], [20, top + 3]]) f.set(x, y, C.laser, true);
  // Magazine tube end, under the barrel.
  f.rect(19, top + 6, 2, 1, C.ironLight);
  f.rect(18, top + 7, 4, 1, C.iron);
  f.rect(19, top + 7, 2, 1, C.ironDark);
  f.rect(19, top + 8, 2, 1, C.ironDark);
}

type Grip = 'port' | 'aim' | 'lever' | 'recoil';

/** Standing: idle (port arms) or with the rifle shouldered. `bob` lowers the upper body (idle sway). */
function paintStanding(grip: Grip, bob: number): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  const b = bob;
  const aiming = grip !== 'port';
  // Aiming, the head leans onto the stock (one pixel to its right, one down);
  // the recoil jerks it back up.
  const hx = aiming ? -1 : 0;
  const hy = grip === 'aim' || grip === 'lever' ? 1 : 0;

  // Legs: boots, shins, knees, thighs.
  boot(f, 14, 60, -1);
  boot(f, 22, 60, 1);
  bone(f, 16, 55, 16, 60);
  bone(f, 24, 55, 24, 60);
  joint(f, 16, 54);
  joint(f, 24, 54);
  bone(f, 16, 43 + b, 16, 53);
  bone(f, 24, 43 + b, 24, 53);
  // Body, from the bottom up.
  hips(f, 20, 37 + b);
  spine(f, 20, 32 + b, 36 + b);
  ribcage(f, 20, 21 + b);
  bandolier(f, 26, 22 + b, 14, 36 + b);
  bandana(f, 20, 20 + b);
  skull(f, 15 + hx, 7 + b + hy, aiming ? 'aim' : 'calm');
  hat(f, 10 + hx, 7 + b + hy);

  if (grip === 'port') {
    // Rifle across the chest, muzzle up past its left shoulder.
    arm(f, [12, 22 + b], [10, 29 + b], [18, 35 + b]);
    arm(f, [27, 22 + b], [29, 28 + b], [23, 25 + b]);
    rifleSide(f, 16, 44 + b, 32, 12 + b);
    hand(f, 18, 35 + b);
    hand(f, 23, 25 + b);
  } else {
    const lever = grip === 'lever';
    const lift = grip === 'recoil' ? 3 : 0;
    // Right arm: elbow out ("chicken wing"), hand on the wrist of the stock
    // (or down on the open lever). Left arm: hand under the forend.
    const rightHand: Pt = lever ? [15, 30] : [13, 27];
    const leftHand: Pt = [21, 31 - lift];
    arm(f, [12, 22], lever ? [9, 27] : [8, 25], rightHand);
    arm(f, [27, 22], [28, 30], leftHand);
    rifleFront(f, lift, grip === 'aim' || lever, lever);
    hand(f, ...rightHand);
    hand(f, ...leftHand);
    if (lever) {
      // The spent shell, tossed up out of the receiver.
      f.set(11, 17, C.brassLight);
      f.set(12, 16, C.brass);
    }
  }
  f.outline(C.outline);
  return f;
}

/** A few white chips of skull in the air (headless frames). */
function boneDust(f: PixelFrame, seed: number, x: number, y: number, w: number, h: number): void {
  const rand = seededRandom(seed);
  for (let i = 0; i < 8; i++) f.set(x + rand() * w, y + rand() * h, i % 2 ? C.boneLight : C.bone);
}

/**
 * Dying: 0 = the knees give way (the skull drops and the hat stays up for an
 * instant), 1 = falling apart, 2 = a pile of bones on the ground.
 */
function paintDeath(stage: 0 | 1 | 2, headless: boolean): PixelFrame {
  const f = new PixelFrame(FRAME_W, FRAME_H);
  if (stage === 0) {
    boot(f, 14, 60, -1);
    boot(f, 22, 60, 1);
    bone(f, 16, 60, 12, 53); // shins and thighs bent outward
    bone(f, 24, 60, 28, 53);
    bone(f, 12, 52, 16, 47);
    bone(f, 28, 52, 24, 47);
    joint(f, 12, 53);
    joint(f, 28, 53);
    hips(f, 20, 42);
    spine(f, 21, 37, 41);
    ribcage(f, 21, 26);
    bandana(f, 21, 25);
    arm(f, [13, 27], [11, 34], [12, 41]);
    arm(f, [29, 27], [31, 34], [29, 41]);
    hand(f, 12, 41);
    hand(f, 29, 41);
    if (headless) {
      boneDust(f, 3, 12, 8, 18, 14);
      hat(f, 14, 7, 0.4); // blown off with the skull
    } else {
      skull(f, 18, 13, 'dying', 'open'); // slumped, jaw dropped
      hat(f, 11, 7); // left hanging in the air for a moment
    }
    rifleSide(f, 4, 64, 12, 33); // slipping out of its hands
  } else if (stage === 1) {
    boot(f, 14, 60, -1); // the boots still stand...
    boot(f, 22, 60, 1);
    hips(f, 20, 53); // ...the rest crumbles on top of them
    spine(f, 21, 51, 52);
    ribcage(f, 21, 44, 1);
    // Loose bones in the air.
    bone(f, 6, 47, 10, 53);
    bone(f, 30, 44, 34, 50);
    bone(f, 8, 57, 12, 60);
    bone(f, 28, 56, 33, 59);
    bone(f, 12, 36, 15, 42);
    bone(f, 32, 30, 35, 36);
    if (headless) {
      boneDust(f, 5, 14, 20, 16, 16);
      hat(f, 15, 13, 0.5);
    } else {
      skull(f, 20, 28, 'out', 'none');
      jawBone(f, 13, 43);
      hat(f, 5, 23, -0.4); // floats down slower than the bones
    }
    rifleSide(f, 3, 66, 37, 64); // already on the ground
  } else {
    bootLying(f, 2, 64, true);
    bootLying(f, 29, 64, false);
    // Long bones in a heap, the pelvis and a few ribs on top.
    bone(f, 8, 67, 21, 61);
    bone(f, 14, 61, 31, 67);
    bone(f, 10, 64, 28, 65);
    hips(f, 20, 56);
    for (const [x, y, w] of [[10, 62, 6], [24, 61, 6], [12, 59, 5], [25, 58, 4]]) {
      f.rect(x, y, w, 1, C.bone);
      f.set(x, y + 1, C.boneDark);
      f.set(x + w - 1, y + 1, C.boneDark);
    }
    if (headless) {
      hat(f, 10, 57, -0.3); // the hat landed on the pile
    } else {
      skull(f, 15, 46, 'out', 'open'); // on top, still wearing its hat
      hat(f, 10, 47, 0.3);
    }
    rifleSide(f, 6, 67, 36, 59); // leaning on the heap
  }
  f.outline(C.outline);
  return f;
}

/** All the frames, in sheet order. Pure data: no DOM, so a preview script can paint them too. */
export function paintSharpshooterFrames(): PixelFrame[] {
  return [
    paintStanding('port', 0),
    paintStanding('port', 1),
    paintStanding('aim', 0),
    paintStanding('lever', 0),
    paintStanding('recoil', 0),
    paintDeath(0, false),
    paintDeath(1, false),
    paintDeath(2, false),
    paintDeath(0, true),
    paintDeath(1, true),
    paintDeath(2, true),
  ];
}

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function sharpshooterSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(paintSharpshooterFrames());
  return sheet;
}
