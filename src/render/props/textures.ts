// Procedural pixel-art textures for the props. Every texture is painted
// pixel by pixel with a seeded random generator, so it's identical at every load.
// Sizes follow the texel density of the level: ~32 pixels per meter.
import type * as THREE from 'three';
import { PixelCanvas, mixColor, seededRandom, shade } from './pixelCanvas';
import { GLYPH_HEIGHT, drawText, textWidth } from './pixelFont';

// --- Palette: a few warm, dusty tones shared by all props -------------------
export const PALETTE = {
  wood: 0x7a5232,
  woodDark: 0x4a2c18,
  woodLight: 0x9c6c40,
  iron: 0x3c3a40,
  ironDark: 0x1e1c22,
  ironLight: 0x5c5a62,
  rust: 0x7a3c1c,
  brass: 0xa07a34,
  brassDark: 0x5c4018,
  paint: 0xe6d6b0,
  stone: 0x6a5c50,
};

/** Cache: each texture is generated once and shared by every prop using it. */
const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let tex = cache.get(key);
  if (!tex) {
    tex = make();
    cache.set(key, tex);
  }
  return tex;
}

/**
 * Barrel staves: vertical planks with dark gaps, grain streaks, and
 * darker, dirtier ends (top and bottom get handled more and rot first).
 */
export function barrelTexture(): THREE.Texture {
  return cached('barrel', () => {
    const W = 64;
    const H = 32;
    const c = new PixelCanvas(W, H);
    const rand = seededRandom(1);
    const STAVE = 6;
    for (let x = 0; x < W; x++) {
      const stave = Math.floor(x / STAVE);
      const staveTone = 0.85 + seededRandom(stave * 13)() * 0.3; // each stave a bit different
      for (let y = 0; y < H; y++) {
        let color = shade(PALETTE.wood, staveTone);
        // Vertical grain: a few darker streaks per stave.
        if ((x * 7 + stave * 3) % 5 === 0 && rand() < 0.7) color = shade(color, 0.85);
        // Dirt toward the ends.
        const end = Math.min(y, H - 1 - y) / (H / 2); // 0 at the ends, 1 in the middle
        color = shade(color, 0.7 + 0.3 * Math.min(1, end * 3));
        c.set(x, y, color);
      }
      // Gap between staves.
      if (x % STAVE === 0) for (let y = 0; y < H; y++) c.set(x, y, PALETTE.woodDark);
    }
    // A few knots.
    for (let k = 0; k < 5; k++) {
      const kx = Math.floor(rand() * W);
      const ky = 6 + Math.floor(rand() * (H - 12));
      c.set(kx, ky, PALETTE.woodDark);
      c.set(kx + 1, ky, shade(PALETTE.woodDark, 1.2));
      c.set(kx, ky + 1, shade(PALETTE.woodDark, 1.2));
    }
    c.noise(rand, 0.12);
    return c.toTexture();
  });
}

/** Planks seen from above (barrel lid), with a dark rim. */
export function lidTexture(): THREE.Texture {
  return cached('lid', () => {
    const S = 24;
    const c = new PixelCanvas(S, S);
    const rand = seededRandom(2);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const plank = Math.floor(x / 6);
        let color = shade(PALETTE.woodLight, 0.75 + seededRandom(plank + 7)() * 0.2);
        if (x % 6 === 0) color = PALETTE.woodDark;
        const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5);
        if (r > S / 2 - 2) color = shade(PALETTE.woodDark, 0.9);
        c.set(x, y, color);
      }
    }
    c.noise(rand, 0.15);
    return c.toTexture();
  });
}

/** Weathered wood with vertical grain: posts, arms, poles. */
export function postWoodTexture(): THREE.Texture {
  return cached('postWood', () => {
    const c = new PixelCanvas(8, 64);
    const rand = seededRandom(3);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 8; x++) {
        let color = shade(PALETTE.wood, 0.75);
        if (x === 2 || x === 5) color = shade(color, 0.8); // grain lines
        if (rand() < 0.06) color = shade(PALETTE.woodDark, 0.9); // cracks
        if (rand() < 0.04) color = shade(PALETTE.woodLight, 0.9); // sun-bleached flecks
        c.set(x, y, color);
      }
    }
    c.noise(rand, 0.15);
    return c.toTexture();
  });
}

/** Blackened iron with rust patches: hoops, brackets, cages. */
export function ironTexture(): THREE.Texture {
  return cached('iron', () => {
    const c = new PixelCanvas(16, 16);
    const rand = seededRandom(4);
    c.fill(PALETTE.iron);
    c.noise(rand, 0.25);
    // Rust spreads in blotches: a few random walks.
    for (let b = 0; b < 4; b++) {
      let x = rand() * 16;
      let y = rand() * 16;
      for (let s = 0; s < 10; s++) {
        c.set(x, y, mixColor(PALETTE.rust, PALETTE.iron, rand() * 0.5));
        x += Math.round(rand() * 2 - 1);
        y += Math.round(rand() * 2 - 1);
      }
    }
    // Rivets / highlights.
    for (let r = 0; r < 4; r++) c.set(rand() * 16, rand() * 16, PALETTE.ironLight);
    return c.toTexture();
  });
}

/** Tarnished brass for the lantern body. */
export function brassTexture(): THREE.Texture {
  return cached('brass', () => {
    const c = new PixelCanvas(16, 16);
    const rand = seededRandom(5);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // Horizontal bands, like a spun metal sheet, with green-brown tarnish.
        let color = shade(PALETTE.brass, 0.8 + 0.25 * Math.sin(y * 1.3));
        if (rand() < 0.12) color = mixColor(color, 0x4a5a30, 0.5);
        c.set(x, y, color);
      }
    }
    c.noise(rand, 0.15);
    return c.toTexture();
  });
}

/** Rough stone for the rocks at the base of the torches. */
export function rockTexture(): THREE.Texture {
  return cached('rock', () => {
    const c = new PixelCanvas(16, 16);
    const rand = seededRandom(6);
    c.fill(PALETTE.stone);
    c.noise(rand, 0.45);
    for (let i = 0; i < 6; i++) c.set(rand() * 16, rand() * 16, shade(PALETTE.stone, 0.55));
    return c.toTexture();
  });
}

/** Charred cloth wrapped around the torch head. */
export function clothTexture(): THREE.Texture {
  return cached('cloth', () => {
    const c = new PixelCanvas(16, 8);
    const rand = seededRandom(7);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 16; x++) {
        // Diagonal wraps of a dirty bandage, darker (burnt) toward the top.
        const band = (x + y * 2) % 6 < 1 ? 0.6 : 1;
        c.set(x, y, shade(0x6a5a44, band * (0.5 + y / 14)));
      }
    }
    c.noise(rand, 0.3);
    return c.toTexture();
  });
}

/**
 * Hanging sign board: horizontal planks, nails in the corners, and the text
 * in faded paint with chipped pixels. Returns the texture and its size in
 * pixels (the board's size in meters is derived from it).
 */
export function signTexture(text: string): {
  texture: THREE.Texture;
  width: number;
  height: number;
} {
  // Letters at 2× (each font pixel = 2×2 texture pixels): 30 cm tall, readable
  // from across the arena, like real hand-painted shop signs.
  const SCALE = 2;
  const margin = 5;
  const width = textWidth(text, SCALE) + margin * 2;
  const height = GLYPH_HEIGHT * SCALE + 8;
  const key = `sign:${text}`;
  const texture = cached(key, () => {
    const c = new PixelCanvas(width, height);
    const rand = seededRandom(text.length * 31 + 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const plank = Math.floor(y / 4);
        let color = shade(PALETTE.wood, 0.55 + seededRandom(plank + 50)() * 0.15);
        if (y % 4 === 0) color = PALETTE.woodDark; // seam between planks
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
          color = shade(PALETTE.woodDark, 0.8);
        c.set(x, y, color);
      }
    }
    c.noise(rand, 0.15);
    // Nails.
    for (const [nx, ny] of [
      [1, 1],
      [width - 2, 1],
      [1, height - 2],
      [width - 2, height - 2],
    ]) {
      c.set(nx, ny, PALETTE.ironLight);
    }
    // Text: a dark drop shadow one pixel down, then the paint. ~15% of the
    // paint has flaked off, showing the wood underneath.
    const ty = Math.floor((height - GLYPH_HEIGHT) / 2);
    drawText(c, text, margin, ty + 1, () => shade(PALETTE.woodDark, 0.7));
    drawText(c, text, margin, ty, () =>
      rand() < 0.15 ? null : shade(PALETTE.paint, 0.85 + rand() * 0.2),
    );
    return c.toTexture();
  });
  return { texture, width, height };
}

/**
 * Flame animation: 4 frames side by side (a "sprite sheet").
 * Each pixel's "heat" decides its color: white-yellow core, orange body,
 * dark red tips, transparent outside. The shape wobbles between frames.
 */
export function flameSheet(): THREE.Texture {
  return cached('flame', () => {
    const FW = 12;
    const FH = 18;
    const FRAMES = 4;
    const c = new PixelCanvas(FW * FRAMES, FH);
    const rand = seededRandom(9);
    const colors = [0x5a0e04, 0xa82a08, 0xe8640c, 0xffa21e, 0xffe27a, 0xfffbe0];
    for (let f = 0; f < FRAMES; f++) {
      const sway = Math.sin((f / FRAMES) * Math.PI * 2) * 1.2;
      for (let y = 0; y < FH; y++) {
        const up = 1 - y / (FH - 1); // 1 at the top row, 0 at the bottom
        // Teardrop: wide at the bottom, narrow at the top, leaning with `sway`.
        const halfWidth = (FW / 2 - 1) * Math.pow(1 - up, 0.6) * (0.8 + 0.2 * Math.sin(y + f * 2));
        const center = FW / 2 + sway * up * 1.5;
        for (let x = 0; x < FW; x++) {
          const d = Math.abs(x + 0.5 - center) / Math.max(halfWidth, 0.01);
          let heat = (1 - d) * (0.55 + 0.6 * (1 - up)) + (rand() - 0.5) * 0.25;
          if (y > FH - 3) heat += 0.3; // hot base
          if (heat <= 0.05) continue; // transparent
          const idx = Math.min(colors.length - 1, Math.floor(heat * colors.length));
          c.set(f * FW + x, y, colors[idx]);
        }
      }
    }
    const tex = c.toTexture();
    tex.repeat.set(1 / FRAMES, 1); // show one frame at a time
    return tex;
  });
}

/**
 * Dry grass tuft: a handful of blades growing from the bottom edge, each a
 * slightly curved line, dark olive at the root and pale straw at the tip.
 * Everything else is transparent (cut out with alphaTest).
 */
export function grassTexture(): THREE.Texture {
  return cached('grass', () => {
    const S = 16;
    const c = new PixelCanvas(S, S);
    const rand = seededRandom(10);
    for (let b = 0; b < 9; b++) {
      let x = 2 + rand() * (S - 4);
      const height = 7 + rand() * (S - 8);
      const lean = (rand() - 0.5) * 0.7;
      for (let i = 0; i < height; i++) {
        const t = i / height;
        const color = mixColor(0x4a4a20, 0xd8c070, t);
        c.set(x, S - 1 - i, shade(color, 0.9 + rand() * 0.2));
        x += lean * (0.3 + t); // blades bend more toward the tip
      }
    }
    return c.toTexture();
  });
}
