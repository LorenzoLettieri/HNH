// The map (hold Tab): the level seen from above, north up, like a paper map
// pinned over the game. Enemies are red dots, you're an arrow, the places
// that matter (shops, steam vents) have their own marks. Most useful at the
// end of a wave, to find the last ghoul hiding behind the saloon: when only
// a few enemies are left, each one sends out a "radar ping" ring.
//
// It's a plain 2D <canvas> (the same Canvas API you'd use on a web page),
// not Three.js: a map is flat, no camera or 3D needed. Two layers:
//   1. the LEVEL, drawn once into an offscreen canvas (it never changes):
//      every box seen from above, the higher the lighter, in steps like the
//      contour bands of a topographic map;
//   2. every frame while the map is open: copy layer 1 (one drawImage,
//      cheap), then draw marks, enemies and player on top.
// Compute the expensive part once, redo only what moves: the same idea as
// caching a rendered partial in Laravel.
//
// Markup and CSS in index.html (#map, #map-legend).
import type { GameState } from '../sim/game';
import { isEnemy } from '../sim/entities';
import { jackalOf } from '../sim/jackal';
import { tuning, TICK_RATE } from '../sim/config';
import type { ShopSpawn, World } from '../sim/world';
import { coinIcon } from './pickupSprites';
import './fonts'; // the labels are written in Rye

type RGB = [number, number, number];

// --- Tuning ---
/** Map size: share of the window's shorter side. */
const SIZE = 0.78;
/** Height (m) of the lightest roofs: everything above it gets the same color. */
const TOP_HEIGHT = 15;
/** How many color steps between the lowest box and TOP_HEIGHT (the contour bands). */
const BANDS = 6;
/** Colors: the ground, the lowest boxes, the highest ones, the canyon rock. */
const GROUND: RGB = [46, 30, 20];
const LOW: RGB = [84, 58, 38];
const HIGH: RGB = [212, 190, 150];
const ROCK = '#140c08';
/** Sizes of the marks, in CSS pixels (so they're the same on any screen). */
const ENEMY_RADIUS = 4;
/** Bells of the map event: dot radius (the next one; the others are smaller). */
const BELL_RADIUS = 6;
const PLAYER_SIZE = 10;
const SHOP_ICON = 22;
const VENT_RADIUS = 4;
/** With this many enemies left (or fewer), each one pings like a radar. */
const PING_BELOW = 3;
/** Seconds per ping, and how far its ring grows (CSS px). */
const PING_TIME = 1.2;
const PING_RADIUS = 26;
/** The Soul Well and its souls: their ghost green, and how many ticks before a soul goes out it starts blinking (2 s). */
const SOUL_GREEN = '#7affc8';
/** The preacher of Spettacolo Cruento: blood red. */
const SERMON_RED = '#ff3030';
const SOUL_HURRY_TICKS = 2 * TICK_RATE;
/** Shop names on the map, by kind. */
const SHOP_NAMES: Record<ShopSpawn['kind'], string> = { weapons: 'ARMERIA', forge: 'FORGIA', saloon: 'SALOON' };

const root = document.getElementById('map')!;
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const coin = coinIcon(); // the same coin pile as the vildenaro counter: shops = where the money goes

const rgb = (c: number[]): string => `rgb(${c.map(Math.round).join(',')})`;

/** Color of a box's top: by height, in BANDS steps from LOW to HIGH. */
function heightColor(top: number): string {
  // Round UP to a band: even a 0.9 m fence must not look like bare ground.
  const band = Math.min(BANDS, Math.max(1, Math.ceil((top / TOP_HEIGHT) * BANDS)));
  const t = (band - 1) / (BANDS - 1);
  return rgb(LOW.map((v, i) => v + (HIGH[i] - v) * t));
}

export interface MapOverlay {
  /**
   * Call every frame. `open` = Tab held (and the game not paused); when
   * false the map is just hidden. (x, z, yaw) = where you are and look
   * (the camera's: already interpolated). `time` in seconds, for the pings.
   */
  update(game: GameState, alpha: number, x: number, z: number, yaw: number, open: boolean, time: number): void;
}

export function createMapOverlay(world: World): MapOverlay {
  // The map shows the drawn boxes only (no look = an invisible collider).
  const visible = world.boxes.filter((b) => b.look);
  const minX = Math.min(...visible.map((b) => b.minX));
  const minZ = Math.min(...visible.map((b) => b.minZ));
  const sizeX = Math.max(...visible.map((b) => b.maxX)) - minX;
  const sizeZ = Math.max(...visible.map((b) => b.maxZ)) - minZ;

  const level = document.createElement('canvas'); // layer 1, never shown by itself
  let scale = 1; // canvas pixels per meter
  let unit = 1; // canvas pixels per CSS pixel (the screen's devicePixelRatio)

  // World → map. A top-down view simply forgets Y. X (east) goes right, and
  // Z (south) goes DOWN, just like the canvas' y: north ends up on top for free.
  const mapX = (x: number): number => (x - minX) * scale;
  const mapY = (z: number): number => (z - minZ) * scale;

  /**
   * Sizes the canvas to the window. Two sizes, like an <img> on a retina
   * screen: the CSS size (how big it looks) and the pixel size (how many
   * pixels it has: CSS size × devicePixelRatio, or it would look blurry).
   * Redraws layer 1 only when the size actually changed.
   */
  function fit(): void {
    unit = window.devicePixelRatio;
    const cssPerMeter = (Math.min(window.innerWidth, window.innerHeight) * SIZE) / Math.max(sizeX, sizeZ);
    const width = Math.round(sizeX * cssPerMeter * unit);
    const height = Math.round(sizeZ * cssPerMeter * unit);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = level.width = width;
    canvas.height = level.height = height;
    canvas.style.width = `${width / unit}px`;
    canvas.style.height = `${height / unit}px`;
    scale = width / sizeX;
    drawLevel();
  }

  /** Layer 1: the level from above. */
  function drawLevel(): void {
    const c = level.getContext('2d')!;
    c.fillStyle = rgb(GROUND);
    c.fillRect(0, 0, level.width, level.height);
    // Painter's algorithm: the lowest tops first, so the higher ones paint
    // over them. Looking down from a plane, at each point you see the
    // highest thing there: a roof covers its walls, the bridge the street.
    // (The GPU solves the same problem with a depth buffer, pixel by pixel.)
    const boxes = visible.filter((b) => b.maxY > 0).sort((a, b) => a.maxY - b.maxY);
    c.lineWidth = unit;
    c.strokeStyle = 'rgba(0, 0, 0, 0.6)'; // a dark edge: two roofs of the same height stay two roofs
    for (const b of boxes) {
      const x = mapX(b.minX);
      const y = mapY(b.minZ);
      const w = (b.maxX - b.minX) * scale;
      const h = (b.maxZ - b.minZ) * scale;
      c.fillStyle = b.look === 'rock' ? ROCK : heightColor(b.maxY);
      c.fillRect(x, y, w, h);
      c.strokeRect(x, y, w, h);
    }
  }

  /** Text with a black outline (stroke first, then the fill on top). */
  function label(text: string, x: number, y: number, color: string): void {
    ctx.font = `${13 * unit}px Rye, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * unit;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  return {
    update(game, alpha, x, z, yaw, open, time) {
      root.hidden = !open;
      if (!open) return;
      fit();
      ctx.drawImage(level, 0, 0);

      // Steam vents: a pale ring, where to step to get launched.
      ctx.lineWidth = 2 * unit;
      ctx.strokeStyle = '#c8d4d4';
      for (const p of world.props) {
        if (p.type !== 'vent') continue;
        ctx.beginPath();
        ctx.arc(mapX(p.x), mapY(p.z), VENT_RADIUS * unit, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Shops: the coin pile and the name. Smoothing off: it's pixel art,
      // enlarging it must make bigger squares, not a blur.
      ctx.imageSmoothingEnabled = false;
      for (const s of world.shops ?? []) {
        const size = SHOP_ICON * unit;
        ctx.drawImage(coin, mapX(s.x) - size / 2, mapY(s.z) - size / 2, size, size);
        label(SHOP_NAMES[s.kind], mapX(s.x), mapY(s.z) + size / 2, '#d8a838');
      }

      // The bells of the map event (src/sim/bells.ts): the next one a gold
      // dot with a pulsing ring (where to go), the others small, the rung ones grey.
      const ev = game.mapEvent.active;
      if (ev?.kind === 'bells') {
        ev.bells.forEach((spot, i) => {
          const s = world.bellSpots![spot];
          const bx = mapX(s.x);
          const by = mapY(s.z);
          const next = i === ev.rung;
          if (next) {
            const phase = (time % PING_TIME) / PING_TIME;
            ctx.globalAlpha = 1 - phase;
            ctx.lineWidth = 2 * unit;
            ctx.strokeStyle = '#ffb030';
            ctx.beginPath();
            ctx.arc(bx, by, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(bx, by, (next ? BELL_RADIUS : BELL_RADIUS * 0.7) * unit, 0, Math.PI * 2);
          ctx.fillStyle = i < ev.rung ? '#6a6458' : next ? '#ffc040' : '#a07a34';
          ctx.fill();
          ctx.lineWidth = unit;
          ctx.strokeStyle = '#000';
          ctx.stroke();
          if (next) label(`CAMPANA ${i + 1}`, bx, by + BELL_RADIUS * unit, '#ffc040');
        });
      }

      // The Pony Express (src/sim/ponyExpress.ts): the next ring an orange dot
      // with a pulsing ring, a line to the one after it (where you'll turn),
      // and that one small. The rest of the trail stays hidden, like on screen.
      if (ev?.kind === 'ponyExpress' && ev.passed < ev.rings.length) {
        const r = ev.rings[ev.passed];
        const after = ev.rings[ev.passed + 1];
        const rx = mapX(r.x);
        const ry = mapY(r.z);
        if (after) {
          ctx.setLineDash([3 * unit, 3 * unit]);
          ctx.lineWidth = 1.5 * unit;
          ctx.strokeStyle = '#a05020';
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(mapX(after.x), mapY(after.z));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(mapX(after.x), mapY(after.z), BELL_RADIUS * 0.6 * unit, 0, Math.PI * 2);
          ctx.fillStyle = '#a05020';
          ctx.fill();
        }
        const phase = (time % PING_TIME) / PING_TIME;
        ctx.globalAlpha = 1 - phase;
        ctx.lineWidth = 2 * unit;
        ctx.strokeStyle = '#ff7a30';
        ctx.beginPath();
        ctx.arc(rx, ry, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(rx, ry, BELL_RADIUS * unit, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8a30';
        ctx.fill();
        ctx.lineWidth = unit;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        label(`ANELLO ${ev.passed + 1}`, rx, ry + BELL_RADIUS * unit, '#ff8a30');
      }

      // The devil's table (src/sim/wager.ts), only while the bet is on offer:
      // a blood-red square with a pulsing ring, like the next bell.
      if (ev?.kind === 'wager' && ev.phase === 'offered') {
        const tx = mapX(ev.x);
        const ty = mapY(ev.z);
        const phase = (time % PING_TIME) / PING_TIME;
        ctx.globalAlpha = 1 - phase;
        ctx.lineWidth = 2 * unit;
        ctx.strokeStyle = '#ff3020';
        ctx.beginPath();
        ctx.arc(tx, ty, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        const half = BELL_RADIUS * unit;
        ctx.fillStyle = '#c02018';
        ctx.fillRect(tx - half, ty - half, half * 2, half * 2);
        ctx.lineWidth = unit;
        ctx.strokeStyle = '#000';
        ctx.strokeRect(tx - half, ty - half, half * 2, half * 2);
        label('TAVOLO', tx, ty + half, '#ff5040');
      }

      // The Ember Heart (src/sim/emberHeart.ts): an orange diamond (the
      // crystal); asleep with a pulsing ring like the bells, awake with its
      // whole CIRCLE to scale (tuning.emberHeartRadius × meters-to-pixels):
      // on the map you see which enemies are inside it.
      if (ev?.kind === 'emberHeart') {
        const hx = mapX(ev.px + (ev.x - ev.px) * alpha);
        const hy = mapY(ev.pz + (ev.z - ev.pz) * alpha);
        if (ev.awake) {
          ctx.beginPath();
          ctx.arc(hx, hy, tuning.emberHeartRadius * scale, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 110, 30, 0.14)';
          ctx.fill();
          ctx.setLineDash([4 * unit, 3 * unit]);
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = '#ff7a28';
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const phase = (time % PING_TIME) / PING_TIME;
          ctx.globalAlpha = 1 - phase;
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = '#ff7a28';
          ctx.beginPath();
          ctx.arc(hx, hy, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const r = BELL_RADIUS * 1.2 * unit;
        ctx.beginPath();
        ctx.moveTo(hx, hy - r);
        ctx.lineTo(hx + r * 0.7, hy);
        ctx.lineTo(hx, hy + r);
        ctx.lineTo(hx - r * 0.7, hy);
        ctx.closePath();
        ctx.fillStyle = '#ff9a30';
        ctx.fill();
        ctx.lineWidth = unit;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        label(ev.awake ? `CUORE ${ev.souls}/${ev.goal}` : 'CUORE', hx, hy + r, '#ffa040');
      }

      // The jackal (src/sim/jackal.ts): a gold coin with a pulsing ring, where
      // it is right now (it moves: the map is how you find it again).
      const jackal = ev?.kind === 'jackal' ? jackalOf(ev, game) : null;
      if (jackal) {
        const jx = mapX(jackal.px + (jackal.x - jackal.px) * alpha);
        const jy = mapY(jackal.pz + (jackal.z - jackal.pz) * alpha);
        const phase = (time % (PING_TIME * 0.6)) / (PING_TIME * 0.6); // faster than the others: it's on the run
        ctx.globalAlpha = 1 - phase;
        ctx.lineWidth = 2 * unit;
        ctx.strokeStyle = '#ffd040';
        ctx.beginPath();
        ctx.arc(jx, jy, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(jx, jy, BELL_RADIUS * unit, 0, Math.PI * 2);
        ctx.fillStyle = '#ffc830';
        ctx.fill();
        ctx.lineWidth = unit;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.fillStyle = '#6a4010';
        ctx.fillRect(jx - 0.5 * unit, jy - BELL_RADIUS * 0.6 * unit, unit, BELL_RADIUS * 1.2 * unit); // the "$" stroke, roughly
        label('SCIACALLO', jx, jy + BELL_RADIUS * unit, '#ffd040');
      }

      // Spettacolo Cruento (src/sim/sermon.ts): the preacher a red cross;
      // asleep with a pulsing ring, awake with his whole CIRCLE to scale
      // (tuning.sermonRadius), like the Ember Heart's: the stage of the show.
      if (ev?.kind === 'sermon') {
        const sx = mapX(ev.x);
        const sy = mapY(ev.z);
        if (ev.awake) {
          ctx.beginPath();
          ctx.arc(sx, sy, tuning.sermonRadius * scale, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 40, 40, 0.12)';
          ctx.fill();
          ctx.setLineDash([4 * unit, 3 * unit]);
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = SERMON_RED;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          const phase = (time % PING_TIME) / PING_TIME;
          ctx.globalAlpha = 1 - phase;
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = SERMON_RED;
          ctx.beginPath();
          ctx.arc(sx, sy, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // The cross: two black bars, two red ones on top (a black edge, like the other marks).
        const arm = BELL_RADIUS * 1.2 * unit;
        const bar = 1.6 * unit;
        ctx.fillStyle = '#000';
        ctx.fillRect(sx - bar - unit, sy - arm - unit, (bar + unit) * 2, (arm + unit) * 2);
        ctx.fillRect(sx - arm * 0.7 - unit, sy - arm * 0.45 - bar - unit, (arm * 0.7 + unit) * 2, (bar + unit) * 2);
        ctx.fillStyle = SERMON_RED;
        ctx.fillRect(sx - bar, sy - arm, bar * 2, arm * 2);
        ctx.fillRect(sx - arm * 0.7, sy - arm * 0.45 - bar, arm * 1.4, bar * 2);
        label('PREDICATORE', sx, sy + arm, SERMON_RED);
      }

      // The Soul Well (src/sim/soulWell.ts): the well a ghost-green ring (a
      // pulsing one while it sleeps, or while you carry souls: that's when
      // you're looking for it), with how full it is; the souls on the ground
      // small pale dots, blinking in their last seconds (run there NOW).
      if (ev?.kind === 'soulWell') {
        const wx = mapX(ev.x);
        const wy = mapY(ev.z);
        if (!ev.awake || ev.carried > 0) {
          const phase = (time % PING_TIME) / PING_TIME;
          ctx.globalAlpha = 1 - phase;
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = SOUL_GREEN;
          ctx.beginPath();
          ctx.arc(wx, wy, (BELL_RADIUS + phase * PING_RADIUS * 1.5) * unit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(wx, wy, BELL_RADIUS * 1.2 * unit, 0, Math.PI * 2);
        ctx.fillStyle = '#123a30';
        ctx.fill();
        ctx.lineWidth = 2.5 * unit;
        ctx.strokeStyle = SOUL_GREEN;
        ctx.stroke();
        label(ev.awake ? `POZZO ${ev.filled}/${ev.goal}` : 'POZZO', wx, wy + BELL_RADIUS * 1.2 * unit, SOUL_GREEN);
        for (const s of ev.souls) {
          const last = s.ticksLeft < SOUL_HURRY_TICKS;
          if (last && Math.floor(time * 6) % 2 === 0) continue;
          ctx.beginPath();
          ctx.arc(mapX(s.px + (s.x - s.px) * alpha), mapY(s.pz + (s.z - s.pz) * alpha), (2 + s.value) * unit, 0, Math.PI * 2);
          ctx.fillStyle = '#c8ffe8';
          ctx.fill();
          ctx.lineWidth = unit;
          ctx.strokeStyle = '#000';
          ctx.stroke();
        }
      }

      // Enemies: red dots, at the same in-between position the renderer
      // draws them (between the last two ticks, see `alpha` in main.ts).
      // (Not with the wager's darkness curse, src/sim/wager.ts: in the dark you don't know where they are.)
      const blind = game.player.curse === 'darkness';
      const enemies = blind ? [] : game.entities.filter((e) => isEnemy(e) && e.state !== 'dead' && e.type !== 'jackal'); // the jackal: its own coin, above
      const ping = enemies.length <= PING_BELOW;
      for (const e of enemies) {
        const ex = mapX(e.px + (e.x - e.px) * alpha);
        const ey = mapY(e.pz + (e.z - e.pz) * alpha);
        if (ping) {
          // A ring that grows and fades, over and over. Each enemy starts at
          // a different moment (from its id): they don't all ping together.
          const phase = ((time + e.id * 0.37) % PING_TIME) / PING_TIME;
          ctx.globalAlpha = 1 - phase;
          ctx.lineWidth = 2 * unit;
          ctx.strokeStyle = '#ff4020';
          ctx.beginPath();
          ctx.arc(ex, ey, (ENEMY_RADIUS + phase * PING_RADIUS) * unit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(ex, ey, ENEMY_RADIUS * unit, 0, Math.PI * 2);
        ctx.fillStyle = '#e0301c';
        ctx.fill();
        ctx.lineWidth = unit;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      }

      // You: an arrow pointing where you look. Drawn pointing UP (north)
      // around (0, 0), then the canvas is moved and turned under it
      // (translate + rotate: the 2D version of the matrices of a 3D scene).
      // yaw 0 = north, positive = turning left; canvas rotations go
      // clockwise on screen, so the angle is flipped.
      const s = PLAYER_SIZE * unit;
      ctx.save();
      ctx.translate(mapX(x), mapY(z));
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.65, s * 0.7);
      ctx.lineTo(0, s * 0.3);
      ctx.lineTo(-s * 0.65, s * 0.7);
      ctx.closePath();
      ctx.fillStyle = '#f0e0b0';
      ctx.fill();
      ctx.lineWidth = 2 * unit;
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.restore();
    },
  };
}
