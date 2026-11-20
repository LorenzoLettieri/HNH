// Textures for the level painted in code: the western materials the texture
// pack doesn't have (painted clapboard, adobe, corrugated tin, wood shingles,
// timber, riveted iron, canyon rock). Same tools as the props (PixelCanvas),
// same density as the PNGs (32 px per meter: a 64 px texture covers 2 m).
//
// Every texture TILES: what leaves one edge comes back on the opposite one.
// PixelCanvas.set wraps coordinates around, and the noise below wraps too,
// so no seam shows where one copy of the texture meets the next.
// To use one in the level: write its name (the keys of LEVEL_TEXTURES, at the
// bottom) in LOOKS, in materials.ts, like the name of a PNG file.
import type * as THREE from 'three';
import { PixelCanvas, mixColor, seededRandom, shade } from './props/pixelCanvas';

type Rand = () => number;
type Noise = (x: number, y: number) => number;

// --- Palette -----------------------------------------------------------------------
// Dusty, desaturated colors: the hell sky and the fog tint everything red-orange,
// so strong colors would turn garish.
const PAINT = {
  bone: 0xc4b69a, // old whitewash
  oxblood: 0x7c2c24, // barn red
  ochre: 0xa6803e, // faded mustard
};
const BARE_WOOD = 0x6c5a48; // grey-brown wood, bleached by the sun where the paint is gone
const TIMBER = 0x5c4331;
const SHINGLE = 0x5e4836;
const PLASTER = 0xa87e5e; // adobe mud plaster
const ADOBE_BRICK = 0x7c4f34;
const MORTAR = 0x5a3b29;
const TIN = 0x6c7078; // galvanized iron
const IRON = 0x4c4c55;
const RUST = 0x6a321c;
const RUST_LIGHT = 0x8a4a26;
const CANYON = [0x6e3424, 0x86422b, 0x5c2a1f, 0x95553a, 0x743a28, 0x45201a, 0xa8694a, 0x8a5a44];

// --- Noise that tiles ---------------------------------------------------------------

/**
 * "Value noise": random numbers on a coarse grid (about one every `cell` pixels),
 * smoothly blended in between. Gives soft blobs instead of per-pixel static
 * (dirt, rust, peeled paint...). The grid wraps around the image, so the blobs
 * tile with it. Returns a function (x, y) → 0..1. A different `cellY` stretches the
 * blobs (wider than tall: paint peeling along the boards).
 */
function tileNoise(w: number, h: number, cell: number, rand: Rand, cellY = cell): Noise {
  const gw = Math.max(1, Math.round(w / cell));
  const gh = Math.max(1, Math.round(h / cellY));
  const grid = Array.from({ length: gw * gh }, rand);
  const at = (i: number, j: number) => grid[(((j % gh) + gh) % gh) * gw + (((i % gw) + gw) % gw)];
  const smooth = (t: number) => t * t * (3 - 2 * t); // eases in and out: no visible grid lines
  return (x, y) => {
    const fx = (x / w) * gw;
    const fy = (y / h) * gh;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

/**
 * Layers of noise, from big blobs to small ones, each half as strong as the one
 * before ("fractal" noise): big shapes with ragged edges, like real stains.
 * `stretch` > 1 makes the blobs wider than tall.
 */
function fbm(w: number, h: number, cells: number[], rand: Rand, stretch = 1): Noise {
  const layers = cells.map((cell) => tileNoise(w, h, cell, rand, cell / stretch));
  return (x, y) => {
    let sum = 0;
    let total = 0;
    let weight = 1;
    for (const layer of layers) {
      sum += layer(x, y) * weight;
      total += weight;
      weight *= 0.5;
    }
    return sum / total;
  };
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The noise value above which lies a `coverage` share of the image (0.15 = 15% of
 * the pixels). Noise values bunch up around 0.5 and every seed spreads them a bit
 * differently: a fixed threshold like 0.6 would give 30% rust with one seed and
 * none with another. Sorting the values and picking the right one doesn't.
 */
function threshold(noise: Noise, w: number, h: number, coverage: number): number {
  const values: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values.push(noise(x, y));
  values.sort((a, b) => a - b);
  return values[Math.floor((1 - coverage) * (values.length - 1))];
}

/** Darkens/lightens the pixel already there. */
function tint(c: PixelCanvas, x: number, y: number, factor: number): void {
  c.set(x, y, shade(c.get(x, y), factor));
}

/**
 * A crack: a dark line going down and drifting to one side, now and then
 * changing direction. Its right edge is a lighter line: the crack's lip.
 */
function crack(c: PixelCanvas, rand: Rand, x: number, y: number, length: number, dark = 0.6): void {
  let dir = rand() < 0.5 ? -1 : 1;
  for (let i = 0; i < length; i++) {
    tint(c, x, y, dark);
    tint(c, x + 1, y, 1.08);
    y += 1;
    if (rand() < 0.3) x += dir;
    if (rand() < 0.08) dir = -dir;
  }
}

/** A streak running down from (x, y): rust or water, fading as it goes. */
function streak(c: PixelCanvas, x: number, y: number, length: number, color: number, strength: number): void {
  for (let i = 0; i < length; i++) {
    c.set(x, y + i, mixColor(c.get(x, y + i), color, strength * (1 - i / length)));
  }
}

// --- Painters -----------------------------------------------------------------------

/**
 * Painted clapboard (lap siding): horizontal boards, each one overlapping the one
 * below. So the top of every board sits in the shadow of the board above, and its
 * lower edge sticks out and catches the light: that gradient is what makes flat
 * pixels read as overlapping boards. The paint has peeled in patches, showing
 * the grey wood underneath.
 */
function clapboard(paint: number, seed: number): PixelCanvas {
  const W = 128;
  const H = 64;
  const BOARD = 8; // 25 cm per board
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  // Paint peels along the grain: blobs much wider than tall, ragged at the edges.
  const peel = fbm(W, H, [32, 16, 8, 4], rand, 3);
  const peelAt = threshold(peel, W, H, 0.2); // 20% of the wall is bare wood
  const grime = tileNoise(W, H, 32, rand);

  // Peeled or not, decided first: the edges of the paint need to know their neighbors.
  const bare = (x: number, y: number) => peel(((x % W) + W) % W, ((y % H) + H) % H) > peelAt;

  for (let row = 0; row < H / BOARD; row++) {
    const y0 = row * BOARD;
    // Butt joints where one board ends and the next begins, different on every row.
    const joints = [Math.floor(rand() * W)];
    if (rand() < 0.6) joints.push((joints[0] + 40 + Math.floor(rand() * 48)) % W);
    joints.sort((a, b) => a - b);
    const tones = joints.map(() => 0.9 + rand() * 0.16);
    for (let x = 0; x < W; x++) {
      const segment = joints.filter((j) => j <= x).length % joints.length;
      for (let y = 0; y < BOARD; y++) {
        const light = y === 0 ? 0.5 : y === BOARD - 1 ? 1.12 : 0.78 + (y / (BOARD - 1)) * 0.25;
        let color = bare(x, y0 + y) ? BARE_WOOD : paint;
        // The edge of the paint: a thin dark rim where it flakes off.
        if (!bare(x, y0 + y) && (bare(x + 1, y0 + y) || bare(x, y0 + y + 1))) color = shade(color, 0.78);
        color = shade(color, light * tones[segment] * (0.86 + grime(x, y0 + y) * 0.22));
        c.set(x, y0 + y, color);
      }
    }
    // Grain: a few long darker streaks along each board (stronger on bare wood).
    for (let s = 0; s < 6; s++) {
      const sy = y0 + 2 + Math.floor(rand() * (BOARD - 3));
      const sx = Math.floor(rand() * W);
      const len = 8 + Math.floor(rand() * 30);
      for (let i = 0; i < len; i++) tint(c, sx + i, sy, bare(sx + i, sy) ? 0.86 : 0.95);
    }
    // The joints, with a nail on each side.
    for (const j of joints) {
      for (let y = 1; y < BOARD - 1; y++) tint(c, j, y0 + y, 0.55);
      tint(c, j - 2, y0 + BOARD - 3, 0.5);
      tint(c, j + 2, y0 + BOARD - 3, 0.5);
    }
  }
  c.noise(rand, 0.06);
  return c;
}

/**
 * Adobe: walls of sun-dried mud bricks covered with mud plaster. The plaster is
 * blotchy and cracked, and where chunks have fallen off you see the bricks. The
 * hole's upper rim casts a shadow on the bricks; its lower rim catches the light.
 */
function adobe(seed: number): PixelCanvas {
  const W = 128;
  const H = 128;
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const tone = fbm(W, H, [64, 32, 16], rand);
  const trowel = fbm(W, H, [8, 4], rand, 3); // smears left by the trowel
  const fallen = fbm(W, H, [32, 16, 8, 4], rand);
  const fallenAt = threshold(fallen, W, H, 0.1); // 10% of the plaster has fallen off
  const hole = (x: number, y: number) => fallen(((x % W) + W) % W, ((y % H) + H) % H) > fallenAt;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let color: number;
      if (hole(x, y)) {
        // Bricks 14 × 6 px (44 × 19 cm), every other row shifted by half a brick.
        const row = Math.floor(y / 6);
        const bx = x + (row % 2) * 7;
        if (y % 6 === 5 || bx % 14 === 13) color = MORTAR;
        else color = shade(ADOBE_BRICK, 0.85 + seededRandom(row * 31 + Math.floor(bx / 14))() * 0.3);
        if (!hole(x, y - 1) || !hole(x, y - 2)) color = shade(color, 0.65); // shadow under the plaster's edge
      } else {
        color = shade(PLASTER, (0.84 + tone(x, y) * 0.26) * (0.95 + trowel(x, y) * 0.1));
        if (hole(x, y - 1)) color = shade(color, 1.12); // broken edge, lit from above
        else if (hole(x + 1, y) || hole(x, y + 1)) color = shade(color, 0.85);
      }
      c.set(x, y, color);
    }
  }
  for (let i = 0; i < 6; i++) crack(c, rand, rand() * W, rand() * H, 14 + rand() * 24, 0.7);
  // Water stains running down from the top of the wall.
  for (let i = 0; i < 6; i++) streak(c, Math.floor(rand() * W), Math.floor(rand() * H), 20 + rand() * 40, 0x5e4030, 0.25);
  c.noise(rand, 0.05);
  return c;
}

/**
 * Corrugated iron: sheets with ribs (a wave pressed into the metal). Each column
 * of a rib gets a fixed brightness, from the lit crest to the dark trough: the
 * shading draws the wave. Rust spreads in blotches, gathers toward the bottom of
 * each sheet (where the water stays) and bleeds down from the rivets.
 */
function corrugatedTin(seed: number): PixelCanvas {
  const W = 120;
  const H = 96;
  const RIB = [1.18, 1.04, 0.86, 0.68, 0.92]; // one rib = 5 px
  const SHEET = 30; // a sheet is 6 ribs wide (~94 cm) and as tall as the texture (3 m)
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const blotches = fbm(W, H, [24, 12, 6, 3], rand);
  const sheets = Array.from({ length: W / SHEET }, () => ({ tone: 0.85 + rand() * 0.25, rust: rand() * 0.12 }));
  sheets[Math.floor(rand() * sheets.length)].rust = 0.3; // one sheet is a goner
  // Rust = blotches + how rusty the sheet is + more toward the bottom (where the water stays).
  const rust: Noise = (x, y) => blotches(x, y) + sheets[Math.floor(x / SHEET) % sheets.length].rust + (y / H) * 0.15;
  const rustAt = threshold(rust, W, H, 0.25);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sheet = sheets[Math.floor(x / SHEET)];
      const rustColor = mixColor(RUST, RUST_LIGHT, blotches(x + 37, y + 11));
      // Soft edge: from bare metal to full rust over a small range of noise values.
      let color = mixColor(shade(TIN, sheet.tone), rustColor, clamp01((rust(x, y) - rustAt) / 0.05 + 0.5));
      color = shade(color, RIB[x % RIB.length]);
      if (x % SHEET === SHEET - 1) color = shade(color, 0.55); // the overlapping sheet's edge
      if (y === 0) color = shade(color, 0.5); // the joint with the sheet above
      c.set(x, y, color);
    }
  }
  // Rivets along the top joint, on the rib crests, and the rust they let out.
  for (let x = 0; x < W; x += RIB.length) {
    c.set(x, 2, shade(TIN, 1.4));
    c.set(x + 1, 3, shade(TIN, 0.45));
    if (rand() < 0.45) streak(c, x, 4, 6 + rand() * 26, RUST, 0.7);
  }
  c.noise(rand, 0.05);
  return c;
}

/**
 * Wood shingles: rows of narrow tiles of split wood, each row covering the top of
 * the one below. Every shingle has its own tone (they weather differently), a
 * dark gap on its side and a lit lower edge. Now and then one is missing.
 */
function shingles(seed: number): PixelCanvas {
  const W = 64;
  const H = 64;
  const ROW = 8;
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const grime = fbm(W, H, [32, 16], rand);
  for (let row = 0; row < H / ROW; row++) {
    const y0 = row * ROW;
    let x = Math.floor(rand() * 8); // where the first shingle of the row starts
    const end = x + W; // the row wraps around: the last shingle meets the first one
    while (x < end) {
      const width = Math.min(5 + Math.floor(rand() * 6), end - x);
      const tone = 0.78 + rand() * 0.34;
      const missing = rand() < 0.03;
      for (let i = 0; i < width; i++) {
        const grain = (i * 5 + row) % 7 === 0 ? 0.9 : 1;
        for (let y = 0; y < ROW; y++) {
          const light = y === 0 ? 0.6 : y === ROW - 1 ? 1.15 : 0.84 + y * 0.03;
          let color = shade(SHINGLE, light * tone * grain * (0.82 + grime(x + i, y0 + y) * 0.3));
          if (i === 0) color = shade(color, 0.45); // gap between two shingles
          if (missing) color = shade(SHINGLE, 0.3 + y * 0.02); // a hole: the dark underlay
          c.set(x + i, y0 + y, color);
        }
      }
      x += width;
    }
  }
  c.noise(rand, 0.06);
  return c;
}

/**
 * Timber: rough-hewn posts and beams. Long vertical grain (every column of pixels
 * has its own tone), weathered blotches, checks (the long cracks that open as a
 * beam dries) and a couple of knots.
 */
function timber(seed: number): PixelCanvas {
  const W = 64;
  const H = 64;
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const grain = tileNoise(W, H, 3, rand); // sampled along x only: vertical stripes
  const weather = fbm(W, H, [32, 16, 8], rand);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // The grain wobbles slightly along y, so the stripes aren't ruler-straight.
      const stripe = grain(x + Math.sin(y * 0.2 + x) * 0.6, 0);
      c.set(x, y, shade(TIMBER, (0.76 + stripe * 0.36) * (0.85 + weather(x, y) * 0.25)));
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const length = 10 + Math.floor(rand() * 30);
    for (let j = 0; j < length; j++) {
      tint(c, x, y + j, 0.5);
      tint(c, x + 1, y + j, 1.1); // the crack's lit edge
    }
  }
  for (let k = 0; k < 2; k++) {
    const kx = Math.floor(rand() * W);
    const ky = Math.floor(rand() * H);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = (dx * dx) / 4 + (dy * dy) / 9; // an ellipse, taller than wide
        if (d <= 1) tint(c, kx + dx, ky + dy, d < 0.3 ? 0.55 : 0.8);
      }
    }
  }
  c.noise(rand, 0.05);
  return c;
}

/**
 * Riveted iron plates (the steampunk towers and platforms): 1 × 1 m plates with a
 * bevelled seam, a row of rivets along every edge, rust bleeding down from some
 * rivets and soot blotches.
 */
function ironPlates(seed: number): PixelCanvas {
  const W = 64;
  const H = 64;
  const PLATE = 32;
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const soot = fbm(W, H, [32, 16, 8], rand);
  const tones = Array.from({ length: (W / PLATE) * (H / PLATE) }, () => 0.85 + rand() * 0.25);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x % PLATE;
      const py = y % PLATE;
      const plate = Math.floor(y / PLATE) * (W / PLATE) + Math.floor(x / PLATE);
      let color = shade(IRON, tones[plate] * (0.75 + soot(x, y) * 0.4));
      if (px === 0 || py === 0) color = shade(IRON, 0.4); // the seam
      else if (px === 1 || py === 1) color = shade(color, 1.25); // bevel, lit
      else if (px === PLATE - 1 || py === PLATE - 1) color = shade(color, 0.75); // bevel, in shadow
      c.set(x, y, color);
    }
  }
  for (let py = 0; py < H; py += PLATE) {
    for (let px = 0; px < W; px += PLATE) {
      for (let i = 3; i < PLATE - 2; i += 4) {
        // Four rivets per step: along the top, the bottom, the left and the right edge.
        for (const [x, y] of [[px + i, py + 3], [px + i, py + PLATE - 3], [px + 3, py + i], [px + PLATE - 3, py + i]]) {
          c.set(x, y, shade(IRON, 1.5));
          c.set(x + 1, y + 1, shade(IRON, 0.45));
          if (rand() < 0.12) streak(c, x, y + 2, 4 + rand() * 12, RUST, 0.6);
        }
      }
    }
  }
  c.noise(rand, 0.07);
  return c;
}

/**
 * Canyon rock: horizontal layers of sediment (strata) in hellish reds. Every layer
 * has its own color and grain; its top edge sticks out and catches the light, its
 * bottom sits in shadow. The layers are bent a little ("domain warping": we read
 * the layer at a y shifted by some noise), and vertical cracks cross them.
 */
function canyonRock(seed: number): PixelCanvas {
  const W = 128;
  const H = 256; // 8 m: the layers repeat less often on the tall cliffs
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(seed);
  const bands: { start: number; size: number; color: number }[] = [];
  for (let y = 0; y < H; ) {
    const size = Math.min(6 + Math.floor(rand() * 24), H - y);
    bands.push({ start: y, size, color: CANYON[Math.floor(rand() * CANYON.length)] });
    y += size;
  }
  const bandAt = new Array<number>(H);
  bands.forEach((b, i) => {
    for (let y = b.start; y < b.start + b.size; y++) bandAt[y] = i;
  });
  const warp = tileNoise(W, H, 32, rand);
  const blotch = fbm(W, H, [32, 16, 8], rand);
  const sediment = tileNoise(W, H, 8, rand);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wy = (((y + Math.round((warp(x, y) - 0.5) * 8)) % H) + H) % H;
      const band = bands[bandAt[wy]];
      const inBand = wy - band.start;
      let color = shade(band.color, 0.82 + blotch(x, y) * 0.32);
      if (sediment(x, wy) > 0.62 && inBand % 3 === 1) color = shade(color, 0.9); // thin sediment lines
      if (inBand === 0) color = shade(color, 1.2); // ledge, lit from above
      else if (inBand >= band.size - 2) color = shade(color, inBand === band.size - 1 ? 0.62 : 0.78); // under the next ledge
      c.set(x, y, color);
    }
  }
  for (let i = 0; i < 10; i++) crack(c, rand, rand() * W, rand() * H, 20 + rand() * 50, 0.55);
  c.noise(rand, 0.06);
  return c;
}

/**
 * The painted textures, by name. They're painted once, at load time (a few
 * milliseconds), so the seeds make them identical at every load.
 */
export const LEVEL_TEXTURES: Record<string, () => THREE.Texture> = {
  clapboard_bone: () => clapboard(PAINT.bone, 11).toTexture(),
  clapboard_oxblood: () => clapboard(PAINT.oxblood, 12).toTexture(),
  clapboard_ochre: () => clapboard(PAINT.ochre, 13).toTexture(),
  adobe: () => adobe(21).toTexture(),
  tin: () => corrugatedTin(31).toTexture(),
  shingles: () => shingles(41).toTexture(),
  timber: () => timber(51).toTexture(),
  iron_plates: () => ironPlates(61).toTexture(),
  canyon_rock: () => canyonRock(71).toTexture(),
};
