// Navigation graph: where enemies can stand, and how they can move between
// those places (walk, jump, drop down, climb). Built automatically from the
// level's boxes when the game starts.
//
//   nodes = points where a ghoul fits standing up, sampled every NODE_SPACING
//           meters on top of every box (the ground is a box too);
//   links = one-way connections "from node A you can reach node B by ...".
//
// Then a FLOW FIELD: one search from the player outward (Dijkstra) tells
// every node which neighbor is the next step toward the player. All the
// ghouls share it: each one just follows the arrows from where it stands.
import { overlapsAny } from './collision';
import { tuning } from './config';
import type { Box } from './world';

export type LinkKind = 'walk' | 'jump' | 'drop' | 'climb';

export interface NavNode {
  x: number;
  y: number; // height of the surface (feet)
  z: number;
}

export interface NavLink {
  to: number;
  kind: LinkKind;
  /** "Price" of using this link, in meters-equivalent: climbing is slow, so it costs more. */
  cost: number;
}

export interface NavGraph {
  nodes: NavNode[];
  links: NavLink[][];
  /** Spatial index: grid cell → nodes in it (any height). */
  cells: Map<string, number[]>;
}

/** Distance between sampled nodes, meters. */
export const NODE_SPACING = 1.5;
/** Max height a ghoul climbs up a wall, meters. */
export const MAX_CLIMB = 15;
/** Max height it drops down from, meters. */
const MAX_DROP = 9;
/** Max gap it jumps across (horizontal), meters. */
const MAX_GAP = 3.5;
/** Extra cost per meter climbed: climbing is slower than walking. */
const CLIMB_COST = 2.5;

const cellKey = (ix: number, iz: number) => `${ix},${iz}`;
const cellOf = (v: number) => Math.floor(v / NODE_SPACING);

export function buildNavGraph(boxes: Box[]): NavGraph {
  const r = tuning.ghoulRadius;
  const h = tuning.ghoulHeight;
  const fits = (x: number, y: number, z: number, height = h) => !overlapsAny(x, y + 0.02, z, r, height, boxes);

  // --- 1. Nodes: sample the top face of every box ---
  const nodes: NavNode[] = [];
  const cells = new Map<string, number[]>();
  for (const b of boxes) {
    // A grid aligned to the world (not to each box), so neighboring boxes
    // at the same height produce nodes that line up.
    const x0 = Math.ceil((b.minX + 0.1) / NODE_SPACING);
    const x1 = Math.floor((b.maxX - 0.1) / NODE_SPACING);
    const z0 = Math.ceil((b.minZ + 0.1) / NODE_SPACING);
    const z1 = Math.floor((b.maxZ - 0.1) / NODE_SPACING);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = x0; i <= x1; i++) xs.push(i * NODE_SPACING);
    for (let i = z0; i <= z1; i++) zs.push(i * NODE_SPACING);
    // Boxes smaller than the spacing (crates, barrels) get one node in the middle.
    if (xs.length === 0) xs.push((b.minX + b.maxX) / 2);
    if (zs.length === 0) zs.push((b.minZ + b.maxZ) / 2);
    for (const x of xs) {
      for (const z of zs) {
        if (!fits(x, b.maxY, z)) continue; // something above (another box, a roof...)
        const id = nodes.length;
        nodes.push({ x, y: b.maxY, z });
        const key = cellKey(cellOf(x), cellOf(z));
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(id);
      }
    }
  }

  // Is there ground under (x, z) at height ~y? (So a walk link doesn't cross a gap.)
  const supported = (x: number, y: number, z: number) =>
    boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y + 0.05 && b.maxY >= y - 0.4);

  // Is the straight line from A to B free for a body standing at height y?
  const clearPath = (a: NavNode, b: NavNode, y: number, steps = 4) => {
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!fits(a.x + (b.x - a.x) * t, y, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  };

  // --- 2. Links ---
  const links: NavLink[][] = nodes.map(() => []);
  const reach = Math.ceil(MAX_GAP / NODE_SPACING) + 1;
  nodes.forEach((a, ia) => {
    const cx = cellOf(a.x);
    const cz = cellOf(a.z);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const ib of cells.get(cellKey(cx + dx, cz + dz)) ?? []) {
          if (ib === ia) continue;
          const b = nodes[ib];
          const dist = Math.hypot(b.x - a.x, b.z - a.z);
          const dy = b.y - a.y;

          // WALK: neighbors on the same surface (8 directions), ground all along.
          if (Math.abs(dy) < 0.35 && dist <= NODE_SPACING * 1.5) {
            const midX = (a.x + b.x) / 2;
            const midZ = (a.z + b.z) / 2;
            if (supported(midX, Math.max(a.y, b.y), midZ) && clearPath(a, b, Math.max(a.y, b.y))) {
              links[ia].push({ to: ib, kind: 'walk', cost: dist });
            }
            continue;
          }

          // JUMP up a step (crate, barrel, low wall), or across a gap at the
          // same height or a bit lower.
          const stepUp = dy >= 0.35 && dy <= tuning.ghoulJumpHeight && dist <= 2.5;
          // (A "gap" only if there's really nothing to walk on in between.)
          const gap =
            Math.abs(dy) < 0.35 &&
            dist > NODE_SPACING * 1.5 &&
            dist <= MAX_GAP &&
            !supported((a.x + b.x) / 2, Math.max(a.y, b.y), (a.z + b.z) / 2);
          if ((stepUp || gap) && clearPath(a, b, Math.max(a.y, b.y) + 0.3)) {
            links[ia].push({ to: ib, kind: 'jump', cost: dist + 1 });
            continue;
          }

          // DROP down: walk off the edge and fall onto a lower surface.
          if (dy <= -0.35 && dy >= -MAX_DROP && dist <= 2.5) {
            // Room to fall: a body as tall as the whole fall must fit above B.
            if (fits(b.x, b.y, b.z, -dy + h) && clearPath(a, b, a.y)) {
              links[ia].push({ to: ib, kind: 'drop', cost: dist - dy * 0.2 });
            }
            continue;
          }

          // CLIMB up a wall: A at the foot of the wall, B on top near the edge.
          if (dy > tuning.ghoulJumpHeight && dy <= MAX_CLIMB && dist <= 2.2) {
            // Room to climb: the column above A, all the way up past B's height.
            if (fits(a.x, a.y, a.z, dy + h) && clearPath(a, b, b.y)) {
              links[ia].push({ to: ib, kind: 'climb', cost: dist + dy * CLIMB_COST });
            }
          }
        }
      }
    }
  });

  return { nodes, links, cells };
}

/** The node closest to (x, y, z), within a couple of meters; -1 if none. */
export function nearestNode(g: NavGraph, x: number, y: number, z: number): number {
  let best = -1;
  let bestD = Infinity;
  const cx = cellOf(x);
  const cz = cellOf(z);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (const id of g.cells.get(cellKey(cx + dx, cz + dz)) ?? []) {
        const n = g.nodes[id];
        const dyAbs = Math.abs(n.y - y);
        if (dyAbs > 1.2) continue; // a different floor
        const d = Math.hypot(n.x - x, n.z - z) + dyAbs * 2;
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
    }
  }
  return best;
}

// --- Flow field -----------------------------------------------------------------

export interface FlowField {
  /** For each node: the link to follow toward the goal (null = goal, or unreachable). */
  next: (NavLink | null)[];
  /** For each node: cost of the path to the goal (Infinity = unreachable). */
  dist: Float64Array;
}

/**
 * Dijkstra's algorithm, run BACKWARD from the goal: "how far is the goal
 * from every node, following links in their direction?". We need the
 * reversed links for that (who links TO me?), computed once.
 * A binary heap keeps the "closest node not yet settled" quick to find.
 */
export function computeFlowField(g: NavGraph, goal: number): FlowField {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const next: (NavLink | null)[] = new Array(n).fill(null);
  if (goal < 0) return { next, dist };

  const incoming = reversedLinks(g);
  dist[goal] = 0;
  const heap = new MinHeap();
  heap.push(goal, 0);
  while (heap.size > 0) {
    const [node, d] = heap.pop();
    if (d > dist[node]) continue; // an outdated entry: we already found a better way
    for (const { from, link } of incoming[node]) {
      const nd = d + link.cost;
      if (nd < dist[from]) {
        dist[from] = nd;
        next[from] = link; // from "from", take this link (it leads to `node`)
        heap.push(from, nd);
      }
    }
  }
  return { next, dist };
}

const reversedCache = new WeakMap<NavGraph, { from: number; link: NavLink }[][]>();
function reversedLinks(g: NavGraph): { from: number; link: NavLink }[][] {
  let rev = reversedCache.get(g);
  if (!rev) {
    rev = g.nodes.map(() => []);
    g.links.forEach((list, from) => list.forEach((link) => rev![link.to].push({ from, link })));
    reversedCache.set(g, rev);
  }
  return rev;
}

/** A minimal binary heap (priority queue) of (node, priority) pairs. */
class MinHeap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: number, priority: number): void {
    const a = this.items;
    a.push([node, priority]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][1] <= a[i][1]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][1] < a[m][1]) m = l;
        if (r < a.length && a[r][1] < a[m][1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// --- Caches -----------------------------------------------------------------------
// The graph depends only on the level, and a flow field only on the graph +
// the goal node: they're DERIVED data, not game state. We keep them in caches
// (computed once, reused) instead of inside GameState.
const graphs = new WeakMap<object, NavGraph>();

export function getNavGraph(world: { boxes: Box[] }): NavGraph {
  let g = graphs.get(world);
  if (!g) {
    g = buildNavGraph(world.boxes);
    graphs.set(world, g);
  }
  return g;
}

const lastFlow = new WeakMap<NavGraph, { goal: number; field: FlowField }>();

/** The flow field toward `goal`, recomputed only if the goal changed. */
export function getFlowField(g: NavGraph, goal: number): FlowField {
  const cached = lastFlow.get(g);
  if (cached && cached.goal === goal) return cached.field;
  const field = computeFlowField(g, goal);
  lastFlow.set(g, { goal, field });
  return field;
}
