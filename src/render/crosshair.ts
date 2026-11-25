// Crosshair: a dot and four short ticks, painted on a tiny canvas.
//
// Why a canvas and not a CSS box: some browsers (Brave and Chrome with the
// "Auto Dark Mode for Web Contents" flag, dark-mode extensions) repaint the
// page's colors to make it "dark". They darken light backgrounds, borders and
// shadows, so a light CSS crosshair turned dark gray, and no CSS opt-out
// (color-scheme) stops the flag. What a canvas contains is left alone, like
// images and the WebGL game canvas. The position is in index.html
// (#crosshair), the size is set here.
//
// Color, size and outline are the player's (menu → Video → Mirino,
// videoSettings.ts): it's repainted when they change.
import { CROSSHAIR_COLORS, onVideoChange, videoSettings } from './videoSettings';

const canvas = document.getElementById('crosshair') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** Side of the dot and of each tick, pixels (at size 1). */
const DOT = 2;
/** Distance from the center to the center of each tick, pixels (at size 1). */
const GAP = 8;
/** The outline: this many pixels of OUTLINE_COLOR around every square (at size 1). */
const OUTLINE = 1;
const OUTLINE_COLOR = '#000000';

function paint(): void {
  const scale = videoSettings.crosshairSize;
  const dot = DOT * scale;
  const gap = GAP * scale;
  const border = videoSettings.crosshairOutline ? OUTLINE * scale : 0;
  // The canvas is (2 × gap + dot) pixels wide, plus the outline on both sides:
  // the ticks (and their outline) touch its edges.
  const size = 2 * gap + dot + 2 * border;
  canvas.width = size; // resizing a canvas also clears it
  canvas.height = size;
  // Shown 1:1 on the page (CSS pixels), centered on the screen.
  canvas.style.width = canvas.style.height = `${size}px`;
  canvas.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
  const mid = gap + border; // top-left corner of the center dot
  const squares = [[0, 0], [-gap, 0], [gap, 0], [0, -gap], [0, gap]];
  // Outline first (bigger black squares), then the colored ones on top.
  if (border > 0) {
    ctx.fillStyle = OUTLINE_COLOR;
    for (const [dx, dy] of squares) ctx.fillRect(mid + dx - border, mid + dy - border, dot + 2 * border, dot + 2 * border);
  }
  ctx.fillStyle = CROSSHAIR_COLORS[videoSettings.crosshairColor];
  for (const [dx, dy] of squares) ctx.fillRect(mid + dx, mid + dy, dot, dot);
}

paint();
onVideoChange(paint);
