// The "Malocchio" sprite sheet, painted pixel by pixel: a big bloodshot
// eyeball set in a leathery body, with bat wings and little bat ears.
// The pupil sits in the middle of the frame: it's the critical spot, so it
// must be easy to read (dark pupil inside a glowing iris = a bullseye).
//
// One frame is 64 × 40 px: at 32 px/m it's 2 × 1.25 m. The eye is 20 px
// across (0.63 m), the pupil 8 px (0.25 m, matching tuning.eyebatPupilRadius
// with a pixel of margin). Frames, left to right:
//   0-2: wing flap (up, middle, down: the cycle plays 0 1 2 1)   3: hurt
//   4: dead (eyelid shut)   5: popped (killed by a shot in the pupil)
import { seededRandom } from '../props/pixelCanvas';
import { buildSheet, PixelFrame, type SpriteSheet } from './spriteSheet';

export const EYEBAT_FRAME_W = 64;
export const EYEBAT_FRAME_H = 40;
export const EYEBAT_FRAMES = { flap: [0, 1, 2, 1], hurt: 3, dead: 4, popped: 5 };

/** Center of the eye in the frame (pixels). */
const CX = 32;
const CY = 20;
/** Radii, pixels: leathery body, white of the eye, iris, pupil. */
const BODY_R = 12.5;
const EYE_R = 10;
const IRIS_R = 6.5;
const PUPIL_R = 3.5;

const C = {
  outline: 0x120a08,
  wing: 0x4a2232,
  wingDark: 0x34161f,
  bone: 0x23101a,
  body: 0x5c2a30,
  bodyDark: 0x3c1a20,
  bodyLight: 0x7a3c3e,
  sclera: 0xe6dac0,
  scleraLight: 0xfff4dc,
  scleraShade: 0xb09c80,
  vein: 0xa01818,
  iris: 0xff6a18,
  irisDark: 0xc0300c,
  pupil: 0x080404,
  highlight: 0xffffff,
  blood: 0x6a0c08,
  bloodDark: 0x3a0604,
  claw: 0xd8d0b0,
};

interface Pose {
  /** Wing tips moved up (negative) or down (positive), pixels. */
  wing: number;
  /** What the eye looks like. */
  eye: 'open' | 'hurt' | 'shut' | 'popped';
}

function paintWing(f: PixelFrame, side: number, dy: number): void {
  const px = (x: number) => CX + side * x; // mirror for the left wing
  const shoulder = [px(9), 16] as const;
  const root = [px(8), 25] as const;
  const wrist = [px(21), 11 + dy * 0.5] as const;
  // Three "fingers" spread out from the wrist, like a real bat wing.
  const tips = [
    [px(31), 9 + dy],
    [px(29), 19 + dy * 0.8],
    [px(20), 26 + dy * 0.4],
  ] as const;
  // Membrane: triangles between the bones. Between two fingertips we put a
  // point pulled toward the wrist: that's the scalloped edge of bat wings.
  f.triangle(...shoulder, ...wrist, ...root, C.wing);
  f.triangle(...wrist, ...tips[2], ...root, C.wingDark);
  for (let i = 0; i < tips.length - 1; i++) {
    const [ax, ay] = tips[i];
    const [bx, by] = tips[i + 1];
    const mx = (ax + bx) / 2 + (wrist[0] - (ax + bx) / 2) * 0.35;
    const my = (ay + by) / 2 + (wrist[1] - (ay + by) / 2) * 0.35;
    f.triangle(...wrist, ax, ay, mx, my, i === 0 ? C.wing : C.wingDark);
    f.triangle(...wrist, mx, my, bx, by, i === 0 ? C.wing : C.wingDark);
  }
  // Bones on top: the arm, then the fingers.
  f.limb(...shoulder, ...wrist, 2, C.bone, C.bone);
  for (const [tx, ty] of tips) f.limb(...wrist, tx, ty, 1, C.bone, C.bone);
  f.set(wrist[0] + side, wrist[1] - 1, C.claw); // the thumb claw
}

function paint(pose: Pose): PixelFrame {
  const f = new PixelFrame(EYEBAT_FRAME_W, EYEBAT_FRAME_H);
  const rand = seededRandom(13);

  // Wings first: they're behind the body.
  paintWing(f, 1, pose.wing);
  paintWing(f, -1, pose.wing);

  // Bat ears and little clawed feet.
  f.triangle(CX - 9, 11, CX - 7, 3, CX - 3, 9, C.body);
  f.triangle(CX + 9, 11, CX + 7, 3, CX + 3, 9, C.body);
  f.set(CX - 7, 6, C.bodyDark);
  f.set(CX + 7, 6, C.bodyDark);
  for (const x of [CX - 4, CX + 3]) {
    f.rect(x, 31, 2, 3, C.bodyDark);
    f.set(x - 1, 34, C.claw);
    f.set(x + 1, 34, C.claw);
  }

  // Leathery body: a disc, darker on the bottom right (light from top left).
  for (let y = -13; y <= 13; y++) {
    for (let x = -13; x <= 13; x++) {
      if (Math.hypot(x, y) > BODY_R) continue;
      const lit = -(x + y) / BODY_R;
      f.set(CX + x, CY + y, lit > 0.6 ? C.bodyLight : lit < -0.5 ? C.bodyDark : C.body);
    }
  }

  if (pose.eye === 'shut') {
    // Dead: the eyelid closed, a slit with blood seeping out.
    f.rect(CX - 8, CY, 17, 1, C.bodyDark);
    for (let i = 0; i < 5; i++) f.set(CX - 4 + rand() * 9, CY + 1 + rand() * 4, C.blood);
  } else if (pose.eye === 'popped') {
    // Popped: a dark bloody hole where the eye was, splashes all around.
    for (let y = -9; y <= 9; y++) {
      for (let x = -9; x <= 9; x++) {
        const d = Math.hypot(x, y);
        if (d <= 8 + rand() * 1.5) f.set(CX + x, CY + y, d < 5 ? C.bloodDark : C.blood);
      }
    }
    for (let i = 0; i < 14; i++) f.set(CX - 12 + rand() * 25, CY - 12 + rand() * 26, C.blood);
  } else {
    paintEye(f, rand, pose.eye === 'hurt');
  }

  f.outline(C.outline);
  return f;
}

function paintEye(f: PixelFrame, rand: () => number, hurt: boolean): void {
  // White of the eye, shaded like a sphere: light top left, shadow at the rim.
  for (let y = -10; y <= 10; y++) {
    for (let x = -10; x <= 10; x++) {
      const d = Math.hypot(x, y) / EYE_R;
      if (d > 1) continue;
      const lit = -(x + y) / EYE_R;
      f.set(CX + x, CY + y, d > 0.85 || lit < -0.8 ? C.scleraShade : lit > 0.7 ? C.scleraLight : C.sclera);
    }
  }
  // Bloodshot veins: short wiggly lines from the rim toward the iris.
  // More of them when hurt.
  for (let v = 0; v < (hurt ? 14 : 8); v++) {
    const a = rand() * Math.PI * 2;
    let r = EYE_R - 0.5;
    let ax = a;
    while (r > IRIS_R + 0.5) {
      f.set(CX + Math.cos(ax) * r, CY + Math.sin(ax) * r, C.vein);
      r -= 0.7;
      ax += (rand() - 0.5) * 0.25;
    }
  }
  // Iris (glowing: it shines in the dark and blooms) and pupil.
  // Hurt: the pupil shrinks to a dot, like an eye hit by a bright light.
  const pupil = hurt ? 1.5 : PUPIL_R;
  for (let y = -7; y <= 7; y++) {
    for (let x = -7; x <= 7; x++) {
      const d = Math.hypot(x, y);
      if (d > IRIS_R) continue;
      if (d <= pupil) f.set(CX + x, CY + y, C.pupil);
      else f.set(CX + x, CY + y, d > IRIS_R - 1.2 ? C.irisDark : C.iris, true);
    }
  }
  // A highlight: the tiny reflection that makes an eye look wet and alive.
  f.set(CX - 2, CY - 2, C.highlight);
  f.set(CX - 1, CY - 2, C.highlight);
}

const POSES: Pose[] = [
  { wing: -9, eye: 'open' }, // wings up
  { wing: 0, eye: 'open' }, // middle
  { wing: 8, eye: 'open' }, // wings down
  { wing: -4, eye: 'hurt' },
  { wing: 10, eye: 'shut' }, // dead: wings hanging
  { wing: 10, eye: 'popped' },
];

let sheet: SpriteSheet | null = null;

/** Paints all the frames (once) into a sprite sheet. */
export function eyebatSheet(): SpriteSheet {
  if (!sheet) sheet = buildSheet(POSES.map(paint));
  return sheet;
}
