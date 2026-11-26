// Navigation graph: where enemies can stand, and how they can move between
// those places (walk, jump, drop down, climb). Built automatically from the
// level's boxes when the game starts.
//
//   nodes = points where a body fits standing up (one graph per body SIZE,
//           see NavBody: ghouls and bulls don't fit in the same places), sampled every few
//           meters on top of every box (the ground is a box too);
//   links = one-way connections "from node A you can reach node B by ...".
//
// Then a FLOW FIELD: one search from the player outward (Dijkstra) tells
// every node which neighbor is the next step toward the player. All the
// ghouls share it: each one just follows the arrows from where it stands.
import { moveAndCollide, overlapsAny } from './collision';
import { TICK_DT, tuning } from './config';
import { gradientOf, surfaceAt, type Box, type Prop } from './world';

export type LinkKind = 'walk' | 'jump' | 'drop' | 'climb' | 'vent';

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
  /** Vent links: the vent's center, where to step to get launched. */
  via?: { x: number; z: number };
}

export interface NavGraph {
  nodes: NavNode[];
  links: NavLink[][];
  /** Spatial index: grid cell → nodes in it (any height). Cells are `spacing` wide. */
  cells: Map<string, number[]>;
  /** Distance between sampled nodes, meters (the body's NavBody.spacing). */
  spacing: number;
}

/**
 * The SIZE of whoever walks the graph. Where a body fits depends on how big
 * it is: an alley 1 m wide is a road for a ghoul and a wall for a bull. So
 * there is one graph per body size, built from the same boxes (like the
 * "agent radius" of navigation meshes in game engines).
 */
export interface NavBody {
  /** Half the width of the collider, meters. */
  radius: number;
  height: number;
  /** Highest step it jumps up onto, meters. */
  jumpHeight: number;
  /** Can it climb walls? */
  climbs: boolean;
  /** Can it ride the steam vents? (Hounds and bulls don't climb, but they do take the vents.) */
  ridesVents: boolean;
  /**
   * Distance between sampled nodes, meters. A wide body needs a finer grid:
   * in a 2.5 m alley a bull fits only in the middle 1.2 m, and with 1.5 m
   * between the columns of nodes there might be no column there at all.
   */
  spacing: number;
}

/** Distance between sampled nodes for ghoul-sized bodies, meters. */
export const NODE_SPACING = 1.5;

/**
 * Ghouls (and hounds, which are smaller and don't climb: they get their own
 * flow field without the climbing links, see NO_CLIMB).
 */
export const SMALL_BODY: NavBody = {
  get radius() { return tuning.ghoulRadius; },
  get height() { return tuning.ghoulHeight; },
  get jumpHeight() { return tuning.ghoulJumpHeight; },
  climbs: true,
  ridesVents: true,
  spacing: NODE_SPACING,
};
/** Bulls (and the Damned Smith): wide and tall, no climbing, but bulls ride the vents. */
export const BIG_BODY: NavBody = {
  get radius() { return tuning.bullRadius; },
  get height() { return tuning.bullHeight; },
  get jumpHeight() { return tuning.bullJumpHeight; },
  climbs: false,
  ridesVents: true,
  spacing: 1,
};
/** Max height a ghoul climbs up a wall, meters. */
export const MAX_CLIMB = 15;
/** Max height it drops down from, meters. */
const MAX_DROP = 9;
/** Max gap it jumps across (horizontal), meters. */
const MAX_GAP = 3.5;
/** Extra cost per meter climbed: climbing is slower than walking. */
const CLIMB_COST = 2.5;

const cellKey = (ix: number, iz: number) => `${ix},${iz}`;

export function buildNavGraph(boxes: Box[], props: Prop[] = [], body: NavBody = SMALL_BODY): NavGraph {
  const r = body.radius;
  const h = body.height;
  const S = body.spacing;
  const cellOf = (v: number) => Math.floor(v / S);
  const fits = (x: number, y: number, z: number, height = h) => !overlapsAny(x, y + 0.02, z, r, height, boxes);

  // --- 1. Nodes: sample the top face of every box ---
  const nodes: NavNode[] = [];
  const cells = new Map<string, number[]>();
  for (const b of boxes) {
    // A pole (a sign post, a torch: narrower than the body's radius both
    // ways) is no place to stand: a ghoul would climb up, step toward the
    // top, miss it, fall, and try again forever. (A window sill is thin
    // too, but long: that one is a fine step.)
    if (b.maxX - b.minX < r && b.maxZ - b.minZ < r) continue;
    // A grid aligned to the world (not to each box), so neighboring boxes
    // at the same height produce nodes that line up.
    const x0 = Math.ceil((b.minX + 0.1) / S);
    const x1 = Math.floor((b.maxX - 0.1) / S);
    const z0 = Math.ceil((b.minZ + 0.1) / S);
    const z1 = Math.floor((b.maxZ - 0.1) / S);
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = x0; i <= x1; i++) xs.push(i * S);
    for (let i = z0; i <= z1; i++) zs.push(i * S);
    // Boxes smaller than the spacing (crates, barrels) get one node in the middle.
    if (xs.length === 0) xs.push((b.minX + b.maxX) / 2);
    if (zs.length === 0) zs.push((b.minZ + b.maxZ) / 2);
    for (const x of xs) {
      for (const z of zs) {
        // On a slope (a pitched roof) the node sits on the plane, under the body's uphill edge.
        const top = surfaceAt(b, x, z, r);
        if (!fits(x, top, z)) continue; // something above (another box, a roof...)
        const id = nodes.length;
        nodes.push({ x, y: top, z });
        const key = cellKey(cellOf(x), cellOf(z));
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(id);
      }
    }
  }

  // Is there ground under (x, z) at height ~y? (So a walk link doesn't cross a gap.)
  // On a slope the ground is the plane there, and its height wanders more.
  const supported = (x: number, y: number, z: number) =>
    boxes.some((b) => {
      if (!(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) return false;
      const top = surfaceAt(b, x, z, r);
      const slack = gradientOf(b) * S;
      return top <= y + 0.05 + slack && top >= y - 0.4 - slack;
    });
  // How steep is the ground under (x, z) at height ~y? 0 = flat (or nothing).
  const steepness = (x: number, y: number, z: number) => {
    let g = 0;
    for (const b of boxes) {
      if (!b.rise || !(x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) continue;
      if (Math.abs(surfaceAt(b, x, z, r) - y) < 0.4 + gradientOf(b) * S) g = Math.max(g, gradientOf(b));
    }
    return g;
  };

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
  const reach = Math.ceil(MAX_GAP / S) + 1;
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
          // Up and down a pitched roof the height changes along the way:
          // as much as the slope says over that distance is still a walk.
          const midX = (a.x + b.x) / 2;
          const midZ = (a.z + b.z) / 2;
          const slopeRise = dist <= S * 1.5 ? steepness(midX, (a.y + b.y) / 2, midZ) * dist : 0;
          if (Math.abs(dy) < 0.35 + slopeRise && dist <= S * 1.5) {
            const midY = slopeRise > 0 ? (a.y + b.y) / 2 : Math.max(a.y, b.y);
            if (supported(midX, midY, midZ) && clearPath(a, b, Math.max(a.y, b.y))) {
              links[ia].push({ to: ib, kind: 'walk', cost: dist });
            }
            continue;
          }

          // JUMP up a step (crate, barrel, low wall), or across a gap at the
          // same height or a bit lower.
          const stepUp = dy >= 0.35 && dy <= body.jumpHeight && dist <= 2.5;
          // (A "gap" only if there's really nothing to walk on in between.)
          const gap =
            Math.abs(dy) < 0.35 &&
            dist > S * 1.5 &&
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
          if (body.climbs && dy > body.jumpHeight && dy <= MAX_CLIMB && dist <= 2.2) {
            // Room to climb: the column above A, all the way up past B's height.
            if (fits(a.x, a.y, a.z, dy + h) && clearPath(a, b, b.y)) {
              links[ia].push({ to: ib, kind: 'climb', cost: dist + dy * CLIMB_COST });
            }
          }
        }
      }
    }
  });

  // VENT: ride a steam vent. Where does it throw you? Instead of guessing,
  // we SIMULATE it: a virtual body of THIS size launched from the vent, same
  // physics as the game, tick by tick until it lands. The node there is the
  // destination. (A bull is wider than a ghoul: where a ghoul flies past a
  // roof's eave, a bull may hit it and fall back: then there's no link.)
  const graph = { nodes, links, cells, spacing: S };
  for (const p of props) {
    if (p.type !== 'vent' || !body.ridesVents) continue;
    const from = nearestNode(graph, p.x, p.y, p.z);
    const landing = simulateVentLaunch(p, boxes, body);
    // A vent is a way UP: if this body bumps into an eave and falls back
    // about where it started, it's no way at all (it would ride it forever).
    const up = landing !== null && landing.y > p.y + body.jumpHeight;
    const to = landing && up ? nearestNode(graph, landing.x, landing.y, landing.z) : -1;
    if (from >= 0 && to >= 0 && to !== from) {
      // Cheap: it's the fastest way up. (Cost ≈ the horizontal distance.)
      links[from].push({
        to,
        kind: 'vent',
        cost: Math.hypot(nodes[to].x - p.x, nodes[to].z - p.z) + 1,
        via: { x: p.x, z: p.z },
      });
    }
  }

  return graph;
}

/** The node closest to (x, y, z), within a couple of meters; -1 if none. */
export function nearestNode(g: NavGraph, x: number, y: number, z: number): number {
  let best = -1;
  let bestD = Infinity;
  const cx = Math.floor(x / g.spacing);
  const cz = Math.floor(z / g.spacing);
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
 * Which links a kind of enemy may use. The same graph serves bodies that move
 * differently: a hound is ghoul-sized but doesn't climb. Giving it the ghouls'
 * flow field isn't enough: their shortest way to a roof is often a climb, so
 * the hound would see "climb" as the next step and stop below, even with a
 * vent a few meters away. It needs its OWN flow field, computed as if the
 * climbing links didn't exist: then the shortest way is the vent.
 */
export type LinkFilter = (link: NavLink, from: number, graph: NavGraph) => boolean;
/** Everything but climbing (hounds). */
export const NO_CLIMB: LinkFilter = (link) => link.kind !== 'climb';
/** Everything but vents (the Damned Smith: too heavy to fly, it waits below and throws the hook). */
export const NO_VENT: LinkFilter = (link) => link.kind !== 'vent';

/**
 * Dijkstra's algorithm, run BACKWARD from the goal: "how far is the goal
 * from every node, following links in their direction?". We need the
 * reversed links for that (who links TO me?), computed once.
 * A binary heap keeps the "closest node not yet settled" quick to find.
 * `allowed`: skip the links it says no to (as if they weren't in the graph).
 */
export function computeFlowField(g: NavGraph, goal: number, allowed?: LinkFilter): FlowField {
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
      if (allowed && !allowed(link, from, g)) continue;
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

/**
 * The ESCAPE MAP (a "safety map", the trick of the roguelike Brogue): where
 * to run to get AWAY from the goal (the player), for the jackal (jackal.ts).
 *
 * The naive way: take the flow field toward you and walk it backward, always
 * to the neighbor FARTHER from you. It runs into corners: the farthest spot
 * nearby is often a dead end, and there it stops, trapped.
 *
 * Brogue's way: start from the flow field's distances (how far every node is
 * from you) multiplied by −scale (here −1.2): far from you = very NEGATIVE =
 * "good". Then run Dijkstra again, with those values as starting points
 * instead of a single goal at 0 (a MULTI-SOURCE Dijkstra: every node is a
 * source, each with its own starting cost). Result: for every node, "the
 * best place to run to, minus what it costs to get there". A dead end 5 m
 * farther but 20 m of path away isn't worth it; a big open area beyond you
 * is, even if the way passes close to you (that's what the 1.2 buys: more
 * than 1 means "running past him toward something much better is OK").
 * The links to follow come out of it exactly as in the flow field: from each
 * node, the step downhill. A node with no step (next = null) is a local best:
 * it's cornered, it stays (until you move and the map changes).
 *
 * Dijkstra works with any starting values, negative ones too: what it needs
 * is non-negative link COSTS, and those don't change.
 *
 * `heightBonus`: every meter a node is above the lowest ground of the level
 * makes it that much better: up on the roofs is safer than in the street,
 * so the runner climbs and rides the vents instead of only running down the
 * streets. Above the GROUND, not above you: "above you" flips when you get up
 * there too (then the street would be "far" again), and it ran up and down
 * the same vent forever; with the ground it stays on the roofs and the chase
 * goes on up there. 0 = a flat escape.
 */
export function computeFleeField(g: NavGraph, toGoal: FlowField, scale: number, allowed?: LinkFilter, heightBonus = 0): FlowField {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const next: (NavLink | null)[] = new Array(n).fill(null);
  const heap = new MinHeap();
  let ground = Infinity;
  for (const node of g.nodes) ground = Math.min(ground, node.y);
  for (let i = 0; i < n; i++) {
    if (toGoal.dist[i] === Infinity) continue; // you can't get there from him: no use running there
    dist[i] = -scale * toGoal.dist[i] - heightBonus * (g.nodes[i].y - ground);
    heap.push(i, dist[i]);
  }
  const incoming = reversedLinks(g);
  while (heap.size > 0) {
    const [node, d] = heap.pop();
    if (d > dist[node]) continue;
    for (const { from, link } of incoming[node]) {
      if (allowed && !allowed(link, from, g)) continue;
      const nd = d + link.cost;
      if (nd < dist[from]) {
        dist[from] = nd;
        next[from] = link;
        heap.push(from, nd);
      }
    }
  }
  return { next, dist };
}

/**
 * The same Dijkstra, run FORWARD from `start`: what does it cost to reach
 * every node from HERE? Two questions, one algorithm:
 *   flow field (backward from a goal): "from anywhere, how do I get THERE?"
 *   reach (forward from a start):      "from HERE, where can I get, and at what price?"
 * It stops at `maxCost`: farther nodes stay at Infinity, and we don't pay for
 * exploring the whole map.
 */
export function computeReach(g: NavGraph, start: number, maxCost = Infinity): Float64Array {
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  if (start < 0) return dist;
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push(start, 0);
  while (heap.size > 0) {
    const [node, d] = heap.pop();
    if (d > dist[node]) continue;
    for (const link of g.links[node]) {
      const nd = d + link.cost;
      if (nd < dist[link.to] && nd <= maxCost) {
        dist[link.to] = nd;
        heap.push(link.to, nd);
      }
    }
  }
  return dist;
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
// One cache per body size (the key of the outer map is the NavBody object).
const graphs = new Map<NavBody, WeakMap<object, NavGraph>>();

export function getNavGraph(world: { boxes: Box[]; props?: Prop[] }, body: NavBody = SMALL_BODY): NavGraph {
  let perWorld = graphs.get(body);
  if (!perWorld) {
    perWorld = new WeakMap();
    graphs.set(body, perWorld);
  }
  let g = perWorld.get(world);
  if (!g) {
    g = buildNavGraph(world.boxes, world.props, body);
    perWorld.set(world, g);
  }
  return g;
}

// One cached flow field per graph AND per filter (the ghouls' one, the hounds' one...).
const lastFlow = new WeakMap<NavGraph, Map<LinkFilter | undefined, { goal: number; field: FlowField }>>();

/** The flow field toward `goal` (using only the links `allowed` lets through), recomputed only if the goal changed. */
export function getFlowField(g: NavGraph, goal: number, allowed?: LinkFilter): FlowField {
  let perFilter = lastFlow.get(g);
  if (!perFilter) {
    perFilter = new Map();
    lastFlow.set(g, perFilter);
  }
  const cached = perFilter.get(allowed);
  if (cached && cached.goal === goal) return cached.field;
  const field = computeFlowField(g, goal, allowed);
  perFilter.set(allowed, { goal, field });
  return field;
}

// The escape map, cached the same way: it changes only when the goal (or the scale, from the debug panel) does.
const lastFlee = new WeakMap<NavGraph, Map<LinkFilter | undefined, { goal: number; scale: number; heightBonus: number; field: FlowField }>>();

/**
 * The escape map away from `goal` (see computeFleeField), recomputed only if
 * the goal or the scale changed. `allowed` filters only the RUNNER's own
 * steps: how far each node is from the goal is measured on the whole graph
 * (as the ghouls go). With the filter on that too, a player standing where
 * the filtered links don't reach (a roof only a tall climb leads to) would be
 * "infinitely far" from everywhere, and the map would come out empty.
 */
export function getFleeField(g: NavGraph, goal: number, scale: number, allowed?: LinkFilter, heightBonus = 0): FlowField {
  let perFilter = lastFlee.get(g);
  if (!perFilter) {
    perFilter = new Map();
    lastFlee.set(g, perFilter);
  }
  const cached = perFilter.get(allowed);
  if (cached && cached.goal === goal && cached.scale === scale && cached.heightBonus === heightBonus) return cached.field;
  const field = computeFleeField(g, getFlowField(g, goal), scale, allowed, heightBonus);
  perFilter.set(allowed, { goal, scale, heightBonus, field });
  return field;
}

/**
 * Launches a body of the given size from a vent (standing still on it, like
 * the enemies do) and returns where it lands, or null if it never does.
 * The SAME function the enemies use to launch, so prediction = reality.
 */
function simulateVentLaunch(
  vent: Extract<Prop, { type: 'vent' }>,
  boxes: Box[],
  size: NavBody,
): { x: number; y: number; z: number } | null {
  const body = { x: vent.x, y: vent.y, z: vent.z, vx: 0, vy: 0, vz: 0 };
  launchFromVent(body, vent);
  for (let t = 0; t < 600; t++) {
    body.vy -= tuning.gravity * TICK_DT;
    const { landed } = moveAndCollide(body, size.radius, size.height, boxes, TICK_DT);
    if (landed) return { x: body.x, y: body.y, z: body.z };
  }
  return null;
}

/** Sets the velocity of a body launched by a vent, starting from standing still. */
export function launchFromVent(
  body: { vx: number; vy: number; vz: number },
  vent: Extract<Prop, { type: 'vent' }>,
): void {
  body.vx = vent.pushX ?? 0;
  body.vz = vent.pushZ ?? 0;
  body.vy = vent.up;
}
