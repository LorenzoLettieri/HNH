// Air navigation for flying enemies (the Malocchio).
//
// Walkers use a GRAPH of places where you can stand (nav.ts). A flier can
// be anywhere in the air, so it gets a 3D grid instead: the space of the
// level cut into 1 m cubes ("voxels", the 3D version of pixels).
//   - a cell is BLOCKED if a flier's body, centered in it, would touch a box;
//   - a FLOW FIELD on the free cells (a breadth-first search from the
//     player outward) says how many steps every cell is from the player.
// To get to the player a flier just goes downhill: to the neighboring cell
// with the smallest number. Doors, windows and roofs need no special code:
// a closed room simply has no free cells leading out except its openings.
//
// The grid is built once from the boxes (like the nav graph), so any new
// building with doors and windows is navigable for free.
import { overlapsAny } from './collision';
import type { Box } from './world';

/** Size of a cell, meters. Smaller than a door (fliers fit through), bigger than a flier (0.8 m). */
export const AIR_CELL = 1;
/**
 * Extra room around the flier when marking blocked cells, meters. With it a
 * blocked band (obstacle + 2 × (radius + clearance)) is always at least one
 * cell wide, so even a 16 cm pole can't hide between two cell centers.
 * Openings need 2 × (radius + clearance) + 1 m = 2 m to be certainly passable.
 */
const CLEARANCE = 0.1;
/** Cells kept free above the tallest box: room to fly over everything. */
const SKY_MARGIN = 8;
/** How many cells down the path a flier looks to cut corners (see airSteer). */
const LOOKAHEAD = 4;

export interface AirGrid {
  /** Corner of the grid (minimum x, y, z), meters. */
  x0: number;
  y0: number;
  z0: number;
  /** Number of cells along each axis. */
  nx: number;
  ny: number;
  nz: number;
  /** 1 = a flier centered in this cell would touch a box (or come within CLEARANCE of one). */
  blocked: Uint8Array;
  /** The level's boxes and the flier's radius, for exact checks right next to a wall (see bodyClear). */
  boxes: Box[];
  radius: number;
}

/**
 * Builds the grid for a flier of this radius (its body is a cube 2·radius
 * wide). Instead of testing every cell against every box (300 000 cells ×
 * 230 boxes), each box marks the cells it blocks: "rasterizing" the boxes,
 * like drawing filled rectangles into an image.
 */
export function buildAirGrid(boxes: Box[], radius: number): AirGrid {
  const S = AIR_CELL;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let lowestTop = Infinity, highestTop = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
    lowestTop = Math.min(lowestTop, b.maxY);
    highestTop = Math.max(highestTop, b.maxY);
  }
  // One extra cell on every side: the BORDER, always blocked (see below).
  const x0 = Math.floor(minX) - 1;
  const z0 = Math.floor(minZ) - 1;
  const y0 = Math.floor(lowestTop) - 1; // below the lowest floor there's only ground
  const nx = Math.ceil(maxX - x0) + 1;
  const nz = Math.ceil(maxZ - z0) + 1;
  const ny = Math.ceil(highestTop + SKY_MARGIN - y0) + 1;
  const blocked = new Uint8Array(nx * ny * nz);

  // A body centered at c touches box b when, on every axis, the box and the
  // body's extent [c − r, c + r] overlap: c ∈ (b.min − r, b.max + r).
  // Here r = radius + CLEARANCE.
  const EPS = 1e-6;
  const pad = radius + CLEARANCE;
  const range = (lo: number, hi: number, origin: number, n: number): [number, number] => {
    // Cell i has its center at origin + (i + 0.5)·S. Indices whose center is inside (lo, hi):
    const a = Math.max(0, Math.floor((lo - origin) / S - 0.5) + 1);
    const b = Math.min(n - 1, Math.ceil((hi - origin) / S - 0.5) - 1);
    return [a, b];
  };
  for (const b of boxes) {
    const [ax, bx] = range(b.minX - pad + EPS, b.maxX + pad - EPS, x0, nx);
    const [ay, by] = range(b.minY - pad + EPS, b.maxY + pad - EPS, y0, ny);
    const [az, bz] = range(b.minZ - pad + EPS, b.maxZ + pad - EPS, z0, nz);
    for (let iy = ay; iy <= by; iy++) {
      for (let iz = az; iz <= bz; iz++) {
        for (let ix = ax; ix <= bx; ix++) blocked[ix + nx * (iz + nz * iy)] = 1;
      }
    }
  }
  // The border: a blocked shell around the whole grid, like the frame of a
  // picture. The search (computeAirFlow) can then step to any neighbor
  // without first checking "am I at the edge?": the edge is a wall.
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        if (ix === 0 || iz === 0 || iy === 0 || ix === nx - 1 || iz === nz - 1 || iy === ny - 1) {
          blocked[ix + nx * (iz + nz * iy)] = 1;
        }
      }
    }
  }
  return { x0, y0, z0, nx, ny, nz, blocked, boxes, radius };
}

/** Index of the cell containing (x, y, z), or -1 if it's outside the grid. */
export function cellAt(g: AirGrid, x: number, y: number, z: number): number {
  const ix = Math.floor((x - g.x0) / AIR_CELL);
  const iy = Math.floor((y - g.y0) / AIR_CELL);
  const iz = Math.floor((z - g.z0) / AIR_CELL);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx || iy >= g.ny || iz >= g.nz) return -1;
  return ix + g.nx * (iz + g.nz * iy);
}

/** Center of a cell, meters. */
export function cellCenter(g: AirGrid, cell: number): { x: number; y: number; z: number } {
  const ix = cell % g.nx;
  const iz = Math.floor(cell / g.nx) % g.nz;
  const iy = Math.floor(cell / (g.nx * g.nz));
  return {
    x: g.x0 + (ix + 0.5) * AIR_CELL,
    y: g.y0 + (iy + 0.5) * AIR_CELL,
    z: g.z0 + (iz + 0.5) * AIR_CELL,
  };
}

// The 26 neighbors of a cell (every combination of -1/0/+1 except 0,0,0).
// A diagonal step is allowed only if the straight steps it's made of are
// free too: otherwise a flier would "cut the corner" through the edge of a wall.
// `via` = those straight/edge steps (every non-empty subset of the axes).
interface Neighbor { dx: number; dy: number; dz: number; via: [number, number, number][] }
const NEIGHBORS: Neighbor[] = [];
for (let dy = -1; dy <= 1; dy++) {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      const via: [number, number, number][] = [];
      for (let mask = 1; mask < 7; mask++) {
        const v: [number, number, number] = [mask & 1 ? dx : 0, mask & 2 ? dy : 0, mask & 4 ? dz : 0];
        const nonZero = v.filter((c) => c !== 0).length;
        const total = [dx, dy, dz].filter((c) => c !== 0).length;
        if (nonZero > 0 && nonZero < total) via.push(v);
      }
      NEIGHBORS.push({ dx, dy, dz, via });
    }
  }
}

/** The cell one step (dx, dy, dz) from `cell`, or -1 outside the grid. */
function offset(g: AirGrid, cell: number, dx: number, dy: number, dz: number): number {
  const ix = (cell % g.nx) + dx;
  const iz = (Math.floor(cell / g.nx) % g.nz) + dz;
  const iy = Math.floor(cell / (g.nx * g.nz)) + dy;
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.nx || iy >= g.ny || iz >= g.nz) return -1;
  return ix + g.nx * (iz + g.nz * iy);
}

/**
 * Flow field: for every cell, how many steps to the goal (-1 = blocked or
 * unreachable). Breadth-first search (BFS): start from the goal, then all
 * its free neighbors are at 1, their neighbors at 2... A plain FIFO queue
 * is enough (all steps cost the same, no "who's closest?" heap like the
 * Dijkstra of nav.ts). ~270 000 free cells take about 5 ms: that's why it
 * runs only when a flier asks for it (it can't fly straight to its goal)
 * and only when your cell changes, checked 4 times a second (game.ts).
 * Only the 6 face neighbors here: the distances come out in "Manhattan"
 * steps, and airSteer straightens the path afterward.
 * If the goal cell is blocked (you're crouched under a beam), the free
 * cells around it are used as goals.
 */
export function computeAirFlow(g: AirGrid, goal: number): Int32Array {
  const dist = new Int32Array(g.blocked.length).fill(-1);
  if (goal < 0) return dist;
  const queue = new Int32Array(g.blocked.length);
  let head = 0;
  let tail = 0;
  const seed = (c: number) => {
    if (c >= 0 && !g.blocked[c] && dist[c] < 0) {
      dist[c] = 0;
      queue[tail++] = c;
    }
  };
  seed(goal);
  if (tail === 0) for (const n of NEIGHBORS) seed(offset(g, goal, n.dx, n.dy, n.dz));
  // The grid is a flat array: x varies fastest, then z, then y. So the 6
  // face neighbors of cell c are c ± 1 (x), c ± nx (z), c ± nx·nz (y), and
  // thanks to the blocked border they always exist. The hot loop (it visits
  // ~270 000 cells) is just additions and array reads.
  const { nx, blocked } = g;
  const layer = nx * g.nz;
  const steps = [1, -1, nx, -nx, layer, -layer];
  while (head < tail) {
    const c = queue[head++];
    const d = dist[c] + 1;
    for (let k = 0; k < 6; k++) {
      const n = c + steps[k];
      if (blocked[n] === 0 && dist[n] < 0) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
  }
  return dist;
}

/**
 * Is the straight line from a to b free for a flier? Samples every half
 * cell along it and checks the grid. Outside the grid = open sky = free.
 *
 * The grid only knows about cell CENTERS, and a flier is rarely exactly in
 * the middle of its cell: pressed against a wall, or grazing the edge of a
 * window, the grid says "free" where its body actually gets caught (or its
 * own cell is blocked and can't be checked at all). So when something is
 * close (NEAR_MARGIN), the first stretch is checked exactly, sliding the
 * body along it against the boxes (see bodyClear). In the open sky the grid
 * alone is enough, and cheap.
 */
export function airLineFree(g: AirGrid, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  if (nearBoxes(g, ax, ay, az) && !bodyClear(g, ax, ay, az, bx, by, bz, AIR_CELL * 1.5)) return false;
  const steps = Math.ceil(len / (AIR_CELL * 0.5));
  const start = cellAt(g, ax, ay, az);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const c = cellAt(g, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
    if (c >= 0 && c !== start && g.blocked[c]) return false;
  }
  return true;
}

/** How close (meters, beyond the body) a box must be to need the exact checks. */
const NEAR_MARGIN = 0.6;

/** Is any box within NEAR_MARGIN of the flier's body? (One cheap pass: a bigger body.) */
function nearBoxes(g: AirGrid, x: number, y: number, z: number): boolean {
  const r = g.radius + NEAR_MARGIN;
  return overlapsAny(x, y - r, z, r, r * 2, g.boxes);
}

/**
 * Does the flier's body fit everywhere along the first `maxDist` meters of
 * the line from a (its center) toward b? Exact: its box against the level's
 * boxes, every 20 cm. A thin ray isn't enough here: it slips through the
 * edge of a window where the body (0.8 m wide) gets caught.
 * Costly (every box, several times), so it's used only next to walls.
 */
function bodyClear(g: AirGrid, ax: number, ay: number, az: number, bx: number, by: number, bz: number, maxDist: number): boolean {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const reach = Math.min(len, maxDist);
  const steps = Math.ceil(reach / 0.2);
  for (let i = 1; i <= steps; i++) {
    const t = (reach * i) / steps / len;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    // overlapsAny wants the bottom of the body; (x, y, z) is its center.
    if (overlapsAny(x, y - g.radius, z, g.radius, g.radius * 2, g.boxes)) return false;
  }
  return true;
}

/**
 * Where should a flier at (x, y, z) (its CENTER) fly to, following the flow
 * field? null = no path known (outside the grid, or the player can't be
 * reached), or it's already in the goal's cell.
 *
 * 1. Go "downhill" a few cells: each step to the neighbor closest to the goal.
 * 2. "String pulling": of those cells, aim at the FARTHEST one it can reach
 *    in a straight line. Like pulling tight a string laid along the
 *    staircase path: the corners disappear and the flight is smooth.
 */
export function airSteer(g: AirGrid, dist: Int32Array, x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  let cur = cellAt(g, x, y, z);
  if (cur < 0) return null;
  // Pressed against a wall its own cell may be blocked: start from the best
  // free neighbor ON ITS SIDE of the wall (the one on the other side may be
  // closer to the goal, but it can't get there through the wall).
  if (dist[cur] < 0) {
    let best = -1;
    for (const n of NEIGHBORS) {
      const c = offset(g, cur, n.dx, n.dy, n.dz);
      if (c < 0 || dist[c] < 0 || (best >= 0 && dist[c] >= dist[best])) continue;
      const p = cellCenter(g, c);
      if (bodyClear(g, x, y, z, p.x, p.y, p.z, Infinity)) best = c;
    }
    if (best < 0) return null;
    cur = best;
  }
  const path: number[] = [cur];
  for (let k = 0; k < LOOKAHEAD; k++) {
    const next = downhill(g, dist, cur);
    if (next < 0) break;
    path.push(next);
    cur = next;
  }
  if (path.length === 1 && dist[path[0]] === 0) return null; // already there
  // Down to i = 0: the first cell of the path, the one picked next to it,
  // may be the only one it can see (e.g. just past the edge of a window).
  for (let i = path.length - 1; i >= 0; i--) {
    const p = cellCenter(g, path[i]);
    if (airLineFree(g, x, y, z, p.x, p.y, p.z)) return p;
  }
  // It can't reach any of them in a straight line: caught on an edge. First
  // get back to the middle of its own cell (if that's free), then go on.
  const own = cellAt(g, x, y, z);
  return cellCenter(g, own >= 0 && !g.blocked[own] ? own : path[0]);
}

/**
 * The neighbor that gets closest to the goal. Among equally good ones it
 * prefers the shortest step (a diagonal "saves" 2 or 3 steps in Manhattan
 * distance but is √2 or √3 long: we compare steps saved per meter).
 */
function downhill(g: AirGrid, dist: Int32Array, cell: number): number {
  let best = -1;
  let bestScore = 0;
  for (const n of NEIGHBORS) {
    const c = offset(g, cell, n.dx, n.dy, n.dz);
    if (c < 0 || dist[c] < 0 || dist[c] >= dist[cell]) continue;
    if (n.via.some(([dx, dy, dz]) => g.blocked[offset(g, cell, dx, dy, dz)])) continue; // no corner cutting
    const score = (dist[cell] - dist[c]) / Math.hypot(n.dx, n.dy, n.dz);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// --- Caches -------------------------------------------------------------------------
// Like the nav graph: derived data (from the level and the goal), not game state.
const grids = new WeakMap<object, AirGrid>();
const lastFlow = new WeakMap<AirGrid, { goal: number; dist: Int32Array }>();

export function getAirGrid(world: { boxes: Box[] }, radius: number): AirGrid {
  let g = grids.get(world);
  if (!g) {
    g = buildAirGrid(world.boxes, radius);
    grids.set(world, g);
  }
  return g;
}

/** The flow field toward `goal`, recomputed only when the goal cell changes. */
export function getAirFlow(g: AirGrid, goal: number): Int32Array {
  const cached = lastFlow.get(g);
  if (cached && cached.goal === goal) return cached.dist;
  const dist = computeAirFlow(g, goal);
  lastFlow.set(g, { goal, dist });
  return dist;
}
