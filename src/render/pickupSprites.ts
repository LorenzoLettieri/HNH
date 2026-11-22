// The pickups' pixel-art sprites, painted pixel by pixel with the same tools
// as the enemies (PixelFrame + buildSheet). One frame per kind, 16 × 16 px.
// Each one must be readable at a glance, from far away, in the dark: the
// SHAPE says what it is (thin brass cartridges / fat red shells / a bottle),
// the COLOR confirms it, and the glow mask makes the important part shine.
//   0: bullets — a cardboard box with three revolver cartridges sticking out
//   1: shells  — two red shotgun shells with brass bases
//   2: medkit  — a bottle of glowing green "tonic" with a red-cross label
//   3: coin    — a pile of gold coins (vildenaro): two messy stacks
// Coordinates: x right, y DOWN (like a canvas), row 15 = the floor.
import * as THREE from 'three';
import type { PickupKind } from '../sim/pickups';
import { buildSheet, PixelFrame, type SpriteSheet } from './enemies/spriteSheet';

export const PICKUP_FRAME = 16;
/** Which frame each kind uses. */
export const PICKUP_FRAMES: Record<PickupKind, number> = { bullets: 0, shells: 1, medkit: 2, coin: 3, iron: 4 };

const C = {
  outline: 0x120a08,
  // cardboard box
  box: 0x8a5a30,
  boxDark: 0x5a3a1c,
  boxLabel: 0xd8c090,
  // brass (cartridge cases, shell bases)
  brass: 0xc89a40,
  brassLight: 0xf0d878,
  brassDark: 0x8a6420,
  // lead bullet tips
  lead: 0x8c8c96,
  leadLight: 0xc8c8d0,
  // shotgun shell paper hull
  hull: 0xb02018,
  hullLight: 0xe8503a,
  hullDark: 0x6a0c0a,
  // bottle
  glass: 0x2c4038,
  glassLight: 0x7a9a88,
  cork: 0x8a6038,
  tonic: 0x40d050,
  tonicLight: 0xb0ffa0,
  tonicDark: 0x188028,
  label: 0xe8dcb0,
  cross: 0xc01810,
  // coin: hell's gold, a bit reddish
  gold: 0xe0a830,
  goldLight: 0xffe890,
  goldDark: 0x9a6418,
  goldStamp: 0x6a3c0c,
};

/**
 * A vertical cylinder seen from the side, in pixel art: a light column on
 * the left, the base color in the middle, a dark column on the right. Three
 * shades are enough to read "round" (the light comes from the upper left,
 * like everywhere in the game's sprites).
 */
function column(f: PixelFrame, x: number, y: number, w: number, h: number, light: number, base: number, dark: number, glow = false): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = i === 0 ? light : i === w - 1 ? dark : base;
      f.set(x + i, y + j, c, glow && i === 0);
    }
  }
}

/** One revolver cartridge sticking up: lead tip (rounded) on a brass case. */
function cartridge(f: PixelFrame, x: number, top: number): void {
  f.set(x + 1, top, C.leadLight, true); // the rounded tip: just the middle pixel on top
  column(f, x, top + 1, 3, 2, C.leadLight, C.lead, C.lead);
  column(f, x, top + 3, 3, 5, C.brassLight, C.brass, C.brassDark, true);
}

function paintBullets(): PixelFrame {
  const f = new PixelFrame(PICKUP_FRAME, PICKUP_FRAME);
  cartridge(f, 3, 3);
  cartridge(f, 7, 1); // the middle one stands taller: a less boring silhouette
  cartridge(f, 11, 4);
  // The box in front hides the bottom of the cartridges.
  f.rect(2, 10, 12, 6, C.box);
  f.rect(2, 10, 12, 1, C.boxLabel); // the lid's edge, lit from above
  f.rect(13, 11, 1, 5, C.boxDark); // the shaded side
  f.rect(5, 12, 6, 2, C.boxLabel); // a label
  f.rect(6, 12, 4, 1, C.boxDark); // "writing" on it
  f.outline(C.outline);
  return f;
}

/** One shotgun shell: paper hull with a crimped top, brass base with a rim. */
function shell(f: PixelFrame, x: number, top: number): void {
  const h = 15 - top + 1; // down to the floor
  f.rect(x + 1, top, 2, 1, C.hullDark); // the crimp (folded paper on top)
  column(f, x, top + 1, 4, h - 5, C.hullLight, C.hull, C.hullDark);
  column(f, x, top + h - 4, 4, 3, C.brassLight, C.brass, C.brassDark, true);
  f.rect(x - 1, 15, 6, 1, C.brassDark); // the rim, a bit wider
}

function paintShells(): PixelFrame {
  const f = new PixelFrame(PICKUP_FRAME, PICKUP_FRAME);
  shell(f, 2, 3);
  shell(f, 9, 5);
  f.outline(C.outline);
  return f;
}

function paintMedkit(): PixelFrame {
  const f = new PixelFrame(PICKUP_FRAME, PICKUP_FRAME);
  f.rect(7, 0, 2, 2, C.cork);
  f.rect(7, 2, 2, 3, C.glass); // the neck
  f.rect(5, 5, 6, 1, C.glass); // shoulders
  f.rect(4, 6, 8, 10, C.glass); // the body of the bottle
  // The tonic inside: it glows (the whole liquid is in the glow mask).
  for (let y = 8; y <= 14; y++) {
    for (let x = 5; x <= 10; x++) {
      const c = x === 5 ? C.tonicLight : x === 10 ? C.tonicDark : C.tonic;
      f.set(x, y, c, true);
    }
  }
  f.rect(5, 7, 1, 1, C.glassLight); // a reflection on the glass
  // The label with a red cross: universal "health", even in 1880.
  f.rect(5, 10, 6, 4, C.label);
  f.rect(6, 11, 4, 2, C.cross);
  f.rect(7, 10, 2, 4, C.cross);
  f.outline(C.outline);
  return f;
}

/**
 * One stack of `n` coins, `w` px wide, standing on the floor. Seen from the
 * side and a bit from above: every coin is 2 px thick (a row of gold edge,
 * shaded like a cylinder, and a dark line that separates it from the next),
 * and on top the face of the last coin (2 rows, the upper one narrower: a
 * flattened ellipse, the cheapest way to say "round" from this angle).
 * `shifts` moves single coins 1 px left/right: a messy pile, not a machined column.
 */
function coinStack(f: PixelFrame, x: number, w: number, n: number, shifts: number[]): void {
  const top = 16 - 2 * n; // first row of the edges
  for (let i = 0; i < n; i++) {
    const cx = x + (shifts[i] ?? 0);
    const y = top + 2 * i;
    column(f, cx, y, w, 1, C.goldLight, C.gold, C.goldDark, true);
    f.rect(cx, y + 1, w, 1, C.goldDark);
  }
  const fx = x + (shifts[0] ?? 0);
  for (let i = 1; i < w - 1; i++) f.set(fx + i, top - 2, C.goldLight, true);
  for (let i = 0; i < w; i++) f.set(fx + i, top - 1, C.gold, true);
  f.set(fx + 2, top - 1, C.goldLight, true); // a glint on the face
  f.set(fx + w - 2, top - 1, C.goldDark); // the stamp, just a hint
}

/** A pile of vildenaro: a tall stack behind, a short one in front. */
function paintCoin(): PixelFrame {
  const f = new PixelFrame(PICKUP_FRAME, PICKUP_FRAME);
  coinStack(f, 1, 8, 5, [0, 1, 0, 0, -1]);
  coinStack(f, 8, 7, 3, [0, -1, 0]); // drawn after: it covers the tall one
  f.outline(C.outline);
  return f;
}

/**
 * The Damned Iron: a black iron ingot (a trapezoid seen from the front and a
 * bit from above) with cracks that glow red-hot: the same shape as the HUD
 * counter's icon (ironHud.ts), so you recognize it. The cracks go in the
 * glow mask: it must be visible from far away, it's the reason to kill the Smith.
 */
function paintIron(): PixelFrame {
  const f = new PixelFrame(PICKUP_FRAME, PICKUP_FRAME);
  const top = 0x5c5a64;
  const front = 0x34323c;
  const edge = 0x7c7a86;
  const ember = 0xe8481c;
  const hot = 0xffb040;
  f.rect(4, 6, 8, 1, top); // top face, widening toward you
  f.rect(3, 7, 10, 2, top);
  f.rect(2, 9, 12, 5, front); // front face
  f.rect(2, 9, 12, 1, edge);
  for (const [x, y] of [[5, 10], [6, 11], [7, 11], [8, 12], [10, 10], [10, 11], [11, 12], [7, 7], [8, 7]]) {
    f.set(x, y, ember, true);
  }
  f.set(7, 11, hot, true);
  f.outline(C.outline);
  return f;
}

/**
 * The coin pile as a small 2D canvas, for the HUD's vildenaro counter: the
 * same pixels as the pickup on the ground, so the HUD and the world speak the
 * same language ("that thing there = this number here"). CSS scales it up
 * with `image-rendering: pixelated` (the HTML version of NearestFilter).
 */
export function coinIcon(): HTMLCanvasElement {
  const f = paintCoin();
  const n = PICKUP_FRAME;
  const data = new ImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const c = f.color[i];
    if (c !== -1) data.data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], i * 4);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas;
}

/** How much of its own color every pixel emits (the glowing ones emit all of it). */
const SELF_LIGHT = 0.4;

/**
 * The sheet, plus an EMISSIVE texture made for the pickups. The enemies use
 * a black/white glow mask (only the eyes shine, the rest is lit by the scene);
 * a pickup must instead be readable even in a dark corner, so here every
 * pixel emits a fraction of its own color (SELF_LIGHT), and the pixels in the
 * glow mask emit all of it. In the material, emissive × emissiveMap is ADDED
 * to the lit color: the dark parts never go fully black.
 */
export function pickupSheet(): SpriteSheet & { emissive: THREE.CanvasTexture } {
  const frames = [paintBullets(), paintShells(), paintMedkit(), paintCoin(), paintIron()];
  const sheet = buildSheet(frames);
  const n = PICKUP_FRAME;
  const w = n * frames.length;
  const data = new ImageData(w, n);
  frames.forEach((f, i) => {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const c = f.color[y * n + x];
        if (c === -1) continue;
        const k = f.glow[y * n + x] ? 1 : SELF_LIGHT;
        const o = (y * w + i * n + x) * 4;
        data.data.set([((c >> 16) & 255) * k, ((c >> 8) & 255) * k, (c & 255) * k, 255], o);
      }
    }
  });
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = n;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  const emissive = new THREE.CanvasTexture(canvas);
  emissive.magFilter = emissive.minFilter = THREE.NearestFilter;
  emissive.colorSpace = THREE.SRGBColorSpace; // it holds colors, like the color sheet
  emissive.repeat.set(1 / frames.length, 1);
  return { ...sheet, emissive };
}
