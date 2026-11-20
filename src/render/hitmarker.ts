// Hitmarker: the little X around the crosshair that confirms a hit.
//
// Painted on a canvas for the same reason as the crosshair (crosshair.ts):
// forced dark modes (Brave, Chrome's "Auto Dark Mode" flag) repaint light CSS
// colors dark, but leave what is drawn on a canvas alone.
//
// Each hit repaints the canvas (color and size depend on the kind of hit),
// then the fade-out is a CSS animation on opacity (index.html, #hitmarker):
// opacity is not a color, so dark modes don't touch it.
const canvas = document.getElementById('hitmarker') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

interface Look {
  color: string;
  /** Side of the whole X, CSS pixels. */
  size: number;
}
/** A normal hit: white. */
const HIT: Look = { color: '#ffffff', size: 22 };
/** A kill (or knockdown): red and bigger. */
const KILL: Look = { color: '#ff4020', size: 30 };
/** A critical hit (head, pupil, stunned bull): gold and biggest. */
const HEAD: Look = { color: '#ffd030', size: 34 };
/** Length of each stroke along each axis, CSS pixels (from the corner inward). */
const STROKE = 7;
/** Thickness of the strokes, CSS pixels. */
const WIDTH = 1.2;

function paint(look: Look): void {
  // The canvas has more pixels than CSS pixels on high-density screens
  // (devicePixelRatio 2 = 4 real pixels per CSS pixel): the strokes are thin
  // diagonals, so we draw them at full resolution to keep them sharp.
  const dpr = window.devicePixelRatio || 1;
  const s = look.size;
  canvas.style.width = canvas.style.height = `${s}px`;
  canvas.width = canvas.height = Math.round(s * dpr); // resizing also clears it
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // from now on, draw in CSS pixels
  ctx.strokeStyle = look.color;
  ctx.lineWidth = WIDTH;
  ctx.beginPath();
  // Four strokes in the corners, each on the diagonal through the center.
  for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s]]) {
    const dx = cx === 0 ? STROKE : -STROKE;
    const dy = cy === 0 ? STROKE : -STROKE;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
  }
  ctx.stroke();
}

/**
 * Flashes the hitmarker. Restarting a CSS animation needs a "reflow" in
 * between removing and adding the class (reading offsetWidth forces it).
 */
export function showHitmarker(kill: boolean, headshot: boolean): void {
  paint(headshot ? HEAD : kill ? KILL : HIT);
  canvas.classList.remove('hit', 'kill', 'head');
  void canvas.offsetWidth;
  canvas.classList.add(kill ? 'kill' : 'hit');
  if (headshot) canvas.classList.add('head');
}
