// A 3×5 pixel font: each letter is 5 rows of 3 characters, '#' = painted.
// Tiny on purpose: at 32 pixels per meter, a letter is ~10 × 15 cm,
// the size of hand-painted lettering on a saloon sign.
import type { PixelCanvas } from './pixelCanvas';

const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '.': ['...', '...', '...', '...', '.#.'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...'],
};

export const GLYPH_WIDTH = 3;
export const GLYPH_HEIGHT = 5;
const SPACING = 1;

/** Width in pixels of `text` written with this font, at `scale` (2 = each font pixel is 2×2). */
export function textWidth(text: string, scale = 1): number {
  return (text.length * (GLYPH_WIDTH + SPACING) - SPACING) * scale;
}

/**
 * Paints `text` with its top-left corner at (x, y).
 * `paint` decides the color of each lit pixel (lets callers add wear).
 */
export function drawText(
  canvas: PixelCanvas,
  text: string,
  x: number,
  y: number,
  paint: (px: number, py: number) => number | null,
  scale = 1,
): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = GLYPHS[ch] ?? GLYPHS[' '];
    for (let row = 0; row < GLYPH_HEIGHT * scale; row++) {
      for (let col = 0; col < GLYPH_WIDTH * scale; col++) {
        // Integer division maps each canvas pixel back to its font pixel.
        if (glyph[Math.floor(row / scale)][Math.floor(col / scale)] !== '#') continue;
        const color = paint(cx + col, y + row);
        if (color !== null) canvas.set(cx + col, y + row, color);
      }
    }
    cx += (GLYPH_WIDTH + SPACING) * scale;
  }
}
