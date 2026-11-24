// The fiches counter, top-right under the Damned Iron: a little stack of
// poker chips made of bone, with blood-red stripes on the edge, and "×2".
// Hidden while you have none, like the iron. Fiches come from map events
// (src/sim/mapEvents.ts) and will be spent at the saloon on the barman's
// drinks. Markup and CSS in index.html (#fiches-box).
import './fonts'; // the number is written in Rye

// --- Look ---
const OUTLINE = '#140806';
const BONE_TOP = '#e8dcc4'; // the top face of a chip catches the light
const BONE_SIDE = '#a8987c'; // the edge, in shadow
const STRIPE = '#b0201a'; // the stripes on the edge (and the pips on top)
const STRIPE_DARK = '#6c120e';
/** Seconds and size of the bump when the count changes. */
const BUMP_TIME = 0.25;
const BUMP_SCALE = 0.3;

const box = document.getElementById('fiches-box')!;
const number = document.getElementById('fiches')!;
box.prepend(Object.assign(chipsIcon(), { id: 'fiches-icon' }));

let last = 0;
let bump = 0;

export function updateFichesHud(fiches: number, dt: number): void {
  if (fiches !== last) {
    bump = BUMP_TIME;
    last = fiches;
    number.textContent = `×${fiches}`;
  }
  box.hidden = fiches === 0;
  bump = Math.max(0, bump - dt);
  box.style.transform = `scale(${1 + BUMP_SCALE * (bump / BUMP_TIME)})`;
}

/**
 * A 16 × 16 stack of three chips, drawn rectangle by rectangle (x right,
 * y down). A chip seen from a bit above is a flattened ellipse (the top
 * face) over a thin band (the edge). Drawn from the bottom chip up: each one
 * covers the top face of the one below, leaving only its edge in view
 * (the painter's algorithm, the same as the map's boxes).
 */
function chipsIcon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  /** One chip whose top face starts at row y (it takes rows y..y+4). `shift` moves it sideways: a messy stack. */
  const chip = (y: number, shift: number) => {
    const x = 3 + shift;
    // Outline: the silhouette one pixel bigger all around.
    rect(x + 1, y - 1, 8, 1, OUTLINE);
    rect(x - 1, y + 1, 12, 3, OUTLINE);
    rect(x, y, 10, 1, OUTLINE);
    rect(x, y + 4, 10, 1, OUTLINE);
    rect(x + 1, y + 5, 8, 1, OUTLINE);
    // The edge (under the top face): a band, with stripes every 3 pixels.
    rect(x, y + 2, 10, 2, BONE_SIDE);
    rect(x + 1, y + 4, 8, 1, BONE_SIDE);
    for (const sx of [1, 4, 7]) rect(x + sx + 1, y + 3, 1, 2, sx === 4 ? STRIPE : STRIPE_DARK);
    // The top face: a flattened ellipse (rows 8, 10, 10 pixels wide; the 4th row is the edge).
    rect(x + 1, y, 8, 1, BONE_TOP);
    rect(x, y + 1, 10, 2, BONE_TOP);
    // Pips on the top face, at the left, right and back of the ring.
    rect(x + 1, y + 1, 1, 1, STRIPE);
    rect(x + 8, y + 1, 1, 1, STRIPE);
    rect(x + 4, y, 2, 1, STRIPE);
  };
  chip(10, 0);
  chip(7, 0);
  chip(4, 1);
  return canvas;
}
