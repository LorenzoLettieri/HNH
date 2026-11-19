// Shared tools for the enemies' pixel-art sprites: a tiny raster to paint
// frames in, and a function that lays the frames side by side into a sprite
// sheet (one texture for the colors, one "glow mask" for the parts that shine).
import * as THREE from 'three';

/**
 * A tiny raster: an array of colors (-1 = transparent) plus a parallel
 * "glow" mask (eyes, irises...). Painting into plain arrays first lets us run
 * a post-pass (the outline) before copying to the real canvas.
 */
export class PixelFrame {
  readonly color: Int32Array;
  readonly glow: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.color = new Int32Array(width * height).fill(-1);
    this.glow = new Uint8Array(width * height);
  }
  set(x: number, y: number, c: number, glow = false): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.color[y * this.width + x] = c;
    if (glow) this.glow[y * this.width + x] = 1;
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return this.color[y * this.width + x];
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** A thick line (a limb): stamp a square every half pixel along it. */
  limb(x0: number, y0: number, x1: number, y1: number, width: number, c: number, cDark: number): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.max(steps, 1);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let i = 0; i < width; i++) {
        for (let j = 0; j < width; j++) this.set(x - width / 2 + i, y - width / 2 + j, i === 0 ? cDark : c);
      }
    }
  }
  /**
   * Fills a triangle: every pixel whose center is on the inner side of all
   * three edges. "Which side of an edge" is the sign of a 2D cross product,
   * the same test GPUs use to rasterize triangles.
   */
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number): void {
    const edge = (x0: number, y0: number, x1: number, y1: number, x: number, y: number) =>
      (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
    const area = edge(ax, ay, bx, by, cx, cy);
    if (area === 0) return;
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        // Same sign as the whole triangle's area on all 3 edges = inside
        // (works whether the corners are given clockwise or not).
        const w0 = edge(bx, by, cx, cy, px, py) * area;
        const w1 = edge(cx, cy, ax, ay, px, py) * area;
        const w2 = edge(ax, ay, bx, by, px, py) * area;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.set(x, y, c);
      }
    }
  }
  /** Dark 1-pixel outline around the silhouette: it makes sprites readable on any background. */
  outline(c: number): void {
    const copy = this.color.slice();
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (copy[y * w + x] !== -1) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < w && ny < h && copy[ny * w + nx] !== -1;
        });
        if (near) this.color[y * w + x] = c;
      }
    }
  }
}

export interface SpriteSheet {
  color: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
  frameCount: number;
}

/** Lays the frames side by side into a color sheet and a glow mask. All frames must have the same size. */
export function buildSheet(frames: PixelFrame[]): SpriteSheet {
  const fw = frames[0].width;
  const fh = frames[0].height;
  const w = fw * frames.length;
  const colorData = new ImageData(w, fh);
  const glowData = new ImageData(w, fh);
  frames.forEach((f, i) => {
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const c = f.color[y * fw + x];
        const o = (y * w + i * fw + x) * 4;
        if (c !== -1) {
          colorData.data.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], o);
        }
        const g = f.glow[y * fw + x] ? 255 : 0;
        glowData.data.set([g, g, g, 255], o);
      }
    }
  });
  const toTexture = (data: ImageData, srgb: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = fh;
    canvas.getContext('2d')!.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.repeat.set(1 / frames.length, 1); // show one frame at a time
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { color: toTexture(colorData, true), glow: toTexture(glowData, false), frameCount: frames.length };
}
