// Crosshair: a dot and four short ticks, painted on a tiny canvas.
//
// Why a canvas and not a CSS box: some browsers (Brave and Chrome with the
// "Auto Dark Mode for Web Contents" flag, dark-mode extensions) repaint the
// page's colors to make it "dark". They darken light backgrounds, borders and
// shadows, so a light CSS crosshair turned dark gray, and no CSS opt-out
// (color-scheme) stops the flag. What a canvas contains is left alone, like
// images and the WebGL game canvas. Position and size are in index.html
// (#crosshair).
const canvas = document.getElementById('crosshair') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** Crosshair color (warm white). */
const COLOR = '#ffe0a0';
/** Side of the dot and of each tick, pixels. */
const DOT = 2;
/** Distance from the center to the center of each tick, pixels. */
const GAP = 8;

// The canvas is (2 × GAP + DOT) pixels wide: the ticks touch its edges.
const size = 2 * GAP + DOT;
canvas.width = size;
canvas.height = size;
ctx.fillStyle = COLOR;
const mid = GAP; // top-left corner of the center dot
for (const [dx, dy] of [[0, 0], [-GAP, 0], [GAP, 0], [0, -GAP], [0, GAP]]) {
  ctx.fillRect(mid + dx, mid + dy, DOT, DOT);
}
