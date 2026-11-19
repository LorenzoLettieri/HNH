// Choosing a sniper's nest: where should the sharpshooter go to shoot you
// from? A small "utility AI": every reachable place gets a SCORE and it picks
// the best one. The same shape as a search page: filter, score, sort.
//
//   1. FILTER: places it can walk or climb to (a forward Dijkstra from where
//      it stands: computeReach in nav.ts, which also says what each one costs),
//      not too close to you and not too far (sharpshooterPerchMinRange..MaxRange),
//      not next to another sharpshooter's perch (they spread out).
//   2. SCORE:  height above you (sharpshooterPerchHeightBonus points per meter:
//      up high it sees more, and you have to climb to get it) minus the cost of
//      getting there (a perch across the map isn't worth the walk).
//   3. CHECK:  from the best one down, the first from which it would SEE you
//      (a raycast from the rifle to your chest). Raycasts are the expensive
//      part, so only the best few candidates get one.
//
// The choice is made for where you are NOW. You'll move: when it loses you
// for a while, it chooses again (sharpshooter.ts).
import { tuning } from './config';
import { computeReach, type NavGraph } from './nav';
import { raycastBoxes } from './raycast';
import type { World } from './world';

/** At most this many line-of-sight tests per choice (the best candidates first). */
const MAX_SIGHT_TESTS = 40;
/** Height above you that still counts, meters: higher than this is no better. */
const MAX_HEIGHT = 15;
/** Two sharpshooters don't pick perches closer than this, meters. */
const PERCH_SPACING = 6;

/**
 * The best perch for a sharpshooter now on node `from`, to shoot someone
 * whose feet are at `feet` and chest at height `chestY`. -1 if there's none.
 * `taken`: spots other sharpshooters are already using or going to.
 */
export function choosePerch(
  graph: NavGraph,
  from: number,
  feet: { x: number; y: number; z: number },
  chestY: number,
  taken: { x: number; z: number }[],
  world: World,
): number {
  // 1. Filter (and the cost of each place, from the Dijkstra).
  const cost = computeReach(graph, from, tuning.sharpshooterMaxTravel);
  const candidates: { node: number; score: number }[] = [];
  graph.nodes.forEach((n, i) => {
    if (cost[i] === Infinity) return; // can't get there (or too far to bother)
    const d = Math.hypot(n.x - feet.x, n.z - feet.z);
    if (d < tuning.sharpshooterPerchMinRange || d > tuning.sharpshooterPerchMaxRange) return;
    if (taken.some((t) => Math.hypot(t.x - n.x, t.z - n.z) < PERCH_SPACING)) return;
    // 2. Score.
    const height = Math.min(MAX_HEIGHT, Math.max(0, n.y - feet.y));
    candidates.push({ node: i, score: height * tuning.sharpshooterPerchHeightBonus - cost[i] });
  });
  candidates.sort((a, b) => b.score - a.score);

  // 3. Check the line of sight, best first.
  for (const { node } of candidates.slice(0, MAX_SIGHT_TESTS)) {
    const n = graph.nodes[node];
    if (clearShot(n.x, n.y + tuning.sharpshooterMuzzleHeight, n.z, feet.x, chestY, feet.z, world)) return node;
  }
  return -1;
}

/** Nothing between the point (x, y, z) and the target (tx, ty, tz)? (Only the level's boxes block.) */
export function clearShot(x: number, y: number, z: number, tx: number, ty: number, tz: number, world: World): boolean {
  const dx = tx - x;
  const dy = ty - y;
  const dz = tz - z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return true;
  return raycastBoxes(x, y, z, dx / dist, dy / dist, dz / dist, dist, world.boxes) === null;
}
