// The view THROUGH the carbine's scope (the Forge's "optic", docs/DESIGN.md
// §6d): fully aimed with a reinforced carbine, the gun disappears and the
// screen becomes the scope: black all around, a round window with a dark rim,
// a reticle. The classic sniper look (CoD, Battlefield), in pixel art.
//
// Drawn on a CANVAS, like the crosshair (crosshair.ts: the browsers' forced
// dark mode recolors CSS, not canvas pixels), and at LOW resolution
// (PIXEL_SCALE screen pixels per canvas pixel), scaled up by CSS with
// `image-rendering: pixelated`: the same chunky pixels as the 3D scene.
// Redrawn only when the window changes size; shown or hidden every frame.
import type { PlayerState } from '../sim/player';
import { adsAmount } from '../sim/weapon';

/** Screen pixels per scope pixel (the game renders at about this scale too). */
const PIXEL_SCALE = 3;
/** Radius of the window, as a fraction of the screen's shorter side. */
const WINDOW_RADIUS = 0.47;
/** Width of the dark rim inside the window (the inside of the tube), fraction of the radius. */
const RIM = 0.12;
/** The reticle: thick "posts" from the rim to this fraction of the radius, then thin lines to the center. */
const POST_END = 0.35;
const POST_WIDTH = 3;
const RETICLE = '#0a0604';
/** The dot in the middle: a hot ember (the same red as the forge). */
const DOT = '#ff4818';

/**
 * Are you looking through the scope right now? A reinforced carbine in your
 * hands, aimed all the way (the simulation's adsAmount reaches 1). Also used
 * by the viewmodel to hide the gun: you're looking THROUGH it.
 */
export function lookingThroughScope(p: PlayerState): boolean {
  return p.weapon === 'rifle' && p.forged.rifle > 0 && adsAmount(p) >= 1;
}

const canvas = document.getElementById('scope') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function draw(): void {
  const w = Math.ceil(window.innerWidth / PIXEL_SCALE);
  const h = Math.ceil(window.innerHeight / PIXEL_SCALE);
  canvas.width = w;
  canvas.height = h;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r = Math.min(w, h) * WINDOW_RADIUS;
  // Black everywhere...
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  // ...then cut the round window out of it ('destination-out' ERASES where we
  // paint: the canvas goes back to transparent and the game shows through).
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // The dark rim: a gradient from transparent to black toward the edge, the
  // inside of the tube seen around the lens.
  const rim = ctx.createRadialGradient(cx, cy, r * (1 - RIM), cx, cy, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // The reticle: thick posts from the edge, thin lines to the middle.
  ctx.fillStyle = RETICLE;
  const post = Math.round(r * (1 - POST_END));
  const half = Math.floor(POST_WIDTH / 2);
  ctx.fillRect(Math.round(cx - r), cy - half, post, POST_WIDTH); // left post
  ctx.fillRect(Math.round(cx + r) - post, cy - half, post, POST_WIDTH); // right post
  ctx.fillRect(cx - half, Math.round(cy + r) - post, POST_WIDTH, post); // bottom post
  ctx.fillRect(Math.round(cx - r), cy, Math.round(r * 2), 1); // thin horizontal line
  ctx.fillRect(cx, Math.round(cy - r), 1, Math.round(r * 2)); // thin vertical line
  ctx.fillStyle = DOT;
  ctx.fillRect(cx - 1, cy - 1, 3, 3);
}
draw();
window.addEventListener('resize', draw);

/** Every frame: show it or not. */
export function updateScopeOverlay(player: PlayerState): void {
  canvas.hidden = !lookingThroughScope(player);
}
