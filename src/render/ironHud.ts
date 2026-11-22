// The Damned Iron counter, top-right under the vildenaro: a little ingot of
// black iron with red-hot cracks, and "×2" next to it. Hidden while you have
// none: it's a rare thing (one per special enemy, waves 9, 19, 29...), it
// only shows up when it matters. Markup and CSS in index.html (#iron-box).
import './fonts'; // the number is written in Rye

// --- Look ---
const OUTLINE = '#120a08';
const IRON_TOP = '#5c5a64'; // the top face catches the light
const IRON_FRONT = '#34323c';
const IRON_EDGE = '#7c7a86'; // a highlight on the front edge
const EMBER = '#e8481c'; // the cracks: iron that never cooled down
const EMBER_HOT = '#ffb040';
/** Seconds and size of the bump when the count changes. */
const BUMP_TIME = 0.25;
const BUMP_SCALE = 0.3;

const box = document.getElementById('iron-box')!;
const number = document.getElementById('iron')!;
box.prepend(Object.assign(ingotIcon(), { id: 'iron-icon' }));

let last = 0;
let bump = 0;

export function updateIronHud(iron: number, dt: number): void {
  if (iron !== last) {
    bump = BUMP_TIME;
    last = iron;
    number.textContent = `×${iron}`;
  }
  box.hidden = iron === 0;
  bump = Math.max(0, bump - dt);
  box.style.transform = `scale(${1 + BUMP_SCALE * (bump / BUMP_TIME)})`;
}

/**
 * A 16 × 16 ingot, drawn rectangle by rectangle (x right, y down): an
 * outline one pixel bigger than the shape, then the top face (a trapezoid:
 * each row one pixel wider), the front face, the highlight and the cracks.
 * CSS scales it up with `image-rendering: pixelated`.
 */
function ingotIcon(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  // Outline (the silhouette, one pixel bigger all around).
  rect(4, 3, 8, 1, OUTLINE);
  rect(3, 4, 10, 1, OUTLINE);
  rect(2, 5, 12, 2, OUTLINE);
  rect(1, 7, 14, 6, OUTLINE);
  // Top face: a trapezoid that widens toward you.
  rect(4, 4, 8, 1, IRON_TOP);
  rect(3, 5, 10, 2, IRON_TOP);
  // Front face, with a light edge where it meets the top.
  rect(2, 7, 12, 5, IRON_FRONT);
  rect(2, 7, 12, 1, IRON_EDGE);
  // Cracks glowing from inside.
  rect(5, 8, 1, 1, EMBER);
  rect(6, 9, 2, 1, EMBER);
  rect(8, 10, 1, 1, EMBER);
  rect(7, 9, 1, 1, EMBER_HOT);
  rect(10, 8, 1, 2, EMBER);
  rect(11, 10, 1, 1, EMBER);
  rect(7, 5, 2, 1, EMBER);
  return canvas;
}
