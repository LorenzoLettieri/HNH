// Tools to paint pixel-art textures from code, one pixel at a time.
import * as THREE from 'three';

/**
 * Seeded pseudo-random generator (mulberry32). Same seed → same sequence,
 * so a "random" texture looks identical at every page load.
 * Math.random() can't be seeded, that's why we need our own.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Multiplies a 0xRRGGBB color's brightness by `factor` (0.8 = 20% darker). */
export function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((color & 255) * factor));
  return (r << 16) | (g << 8) | b;
}

/** Blends two 0xRRGGBB colors: t = 0 → a, t = 1 → b. */
export function mixColor(a: number, b: number, t: number): number {
  const ch = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * A small image we paint pixel by pixel. Pixels live in a plain byte array
 * (ImageData: 4 bytes per pixel, R G B A), which is much faster than drawing
 * 1×1 rectangles with the canvas API, and never anti-aliases.
 */
export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly image: ImageData;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.image = new ImageData(width, height); // starts fully transparent
  }

  /** Sets one pixel. Coordinates wrap around, so tiling patterns are easy. */
  set(x: number, y: number, color: number, alpha = 255): void {
    const px = ((Math.floor(x) % this.width) + this.width) % this.width;
    const py = ((Math.floor(y) % this.height) + this.height) % this.height;
    const i = (py * this.width + px) * 4;
    this.image.data[i] = (color >> 16) & 255;
    this.image.data[i + 1] = (color >> 8) & 255;
    this.image.data[i + 2] = color & 255;
    this.image.data[i + 3] = alpha;
  }

  /** Reads one pixel's color (alpha ignored). */
  get(x: number, y: number): number {
    const px = ((Math.floor(x) % this.width) + this.width) % this.width;
    const py = ((Math.floor(y) % this.height) + this.height) % this.height;
    const i = (py * this.width + px) * 4;
    const d = this.image.data;
    return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
  }

  fill(color: number): void {
    this.rect(0, 0, this.width, this.height, color);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 255): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color, alpha);
  }

  /** Darkens/lightens every pixel by a random amount: breaks flat areas. */
  noise(rand: () => number, amount: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        if (this.image.data[i + 3] === 0) continue;
        this.set(x, y, shade(this.get(x, y), 1 + (rand() - 0.5) * amount), this.image.data[i + 3]);
      }
    }
  }

  /** Turns the painted pixels into a Three.js texture with sharp pixels. */
  toTexture(): THREE.CanvasTexture {
    this.canvas.getContext('2d')!.putImageData(this.image, 0, 0);
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapNearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
