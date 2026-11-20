// "Town": a western ghost town sunk into hell. Every building has its own
// material (look): painted clapboard, raw boards, adobe with clay tiles (the
// Spanish part of town: church and bathhouse), stone, brick, corrugated tin.
// How each look is drawn: src/render/materials.ts.
//
// Coordinates: X = east(+)/west(-), Z = south(+)/north(-), Y = up. Meters.
// The player spawns at the south end of Main Street, looking north.
//
//                               N (z = -46)
//   ┌───────────────── canyon cliffs all around ─────────────────┐
//   │ UNDERTAKER   HOTEL  trough  STABLE                 DEPOT    │
//   │                     ▓ bell tower (22 m)          ▭ wagon    │
//   │ forge▤ ◘ water ┌SALOON┐ ▫ ▫ ▫ ┌CHURCH┐  crates     ▤sawmill │
//   │        tower   └──────┘coach └──────┘             ▭ wagon   │
//   │ BATH gallows ═══ wagon ═ Cross Street ⊙well ═══      TELEGR.│
//   │             ┌SHERIFF┐╎ ▫ ▫ ▫ ╎┌BANK┐                ▭ wagon  │
//   │ HOUSE        └──────┘╎porches╎└────┘                ▭ wagon  │
//   │ ┌┄┄┄┄┄┄┐      ■ tower ═══ bridge (14 m) ═══ ■ tower  GUNSMITH│
//   │                                              (shop upstairs) │
//   │ ┊† † † ┊ HOUSE          spawn ↑          ARMORY WAREHOUSE MINE│
//   └─────────────────────────────────────────────────────────────┘
//                               S (z = +46)
// (▤ = open shed: a roof on posts. ┄ = low fence, everyone hops it.)
//
// Routes up (with the current movement values: jump ≈ 1.2 m, each wall
// jump ≈ +1.05 m, running jump ≈ 5.6 m long):
// - Saloon: crate stack → balcony (3 m) → pile of junk → roof (7.3 m)
//   → floating platforms over Main Street → church roof (9.3 m).
// - Church: steam vent on Main Street → church roof → second vent on the
//   roof → top of the bell tower (22 m).
// - Twin towers (14 m): steam vents on Main Street launch you on top;
//   a bridge connects them over the street.
// - Water tower (8 m): running jump from the saloon roof.
// - Hotel (5.3 m): crate steps on its east side. Warehouse (6.3 m): crate
//   steps on its west side. Both checked with a scripted player in the sim.
// - HIGH ROAD (precise jumps between roofs, all checked with a scripted player):
//   hotel → two 1×1 m pillars → undertaker; hotel → two floating platforms
//   → saloon (→ church → bell tower); bank → jump onto the gunsmith's roof
//   (8.0) → drop onto the warehouse (6.3).
// - ARMORY (the weapon shop, upstairs in the gunsmith, floor at 4.3 m): no
//   stairs, but three wide ways in. (1) East: up a staircase of four crates,
//   the last one in front of the loading door. (2) South:
//   crate steps → warehouse roof → jump west across the 1.2 m gap onto the
//   balcony → wide door. (3) West: a big low window (sill 0.5 m above the
//   floor), for whoever drops from the east tower or wall-jumps up the alley.
//   From the gunsmith's roof (bank, east tower) you can also drop onto the balcony.
// - Low roofs (≤ 4.5 m: undertaker, houses, general store,
//   telegraph) can be climbed with three well-timed wall jumps on one wall.
// - SLIDE ONLY (1.1 m clearance, the ghouls are 1.8 m and go around): under
//   the deck between the rail wagons (middle crossing), under the covered
//   wagon on Cross Street.
// - GENERAL STORE: you can go inside (doors east/west, windows north/south).
//
// Close-quarters pass (docs/DESIGN.md, "La mappa"): the quarters that were
// empty ground are now filled with smaller buildings, so the town is a
// grid of streets and alleys (2.5-10 m wide) instead of a racetrack, and
// the streets have low obstacles (troughs, crates, a stagecoach, a well)
// that you either hop over (keeping your speed) or crash into.
// Note: wall jumps push you AWAY from the wall, so you can't climb a single
// wall with them; they work between two close walls, or as one extra boost.
import { box, type Box, type Decal, type DecalLook, type Facing, type GroundPatch, type Prop, type World } from '../sim/world';
import { propColliders } from '../sim/props';
import { seedFrom } from '../sim/random';

// --- Canyon cliffs: an irregular rock wall around the town -----------------------
function cliffs(): Box[] {
  const T = 4; // thickness
  const at = 44; // distance of their center from the town center
  // [from, to, height] along each side.
  const northSouth: [number, number, number][] = [
    [-46, -24, 12],
    [-24, -4, 15],
    [-4, 16, 10],
    [16, 46, 14],
  ];
  const eastWest: [number, number, number][] = [
    [-42, -16, 13],
    [-16, 8, 10],
    [8, 42, 15],
  ];
  const out: Box[] = [];
  northSouth.forEach(([a, b, h], i) => {
    out.push(box((a + b) / 2, 0, -at, b - a, h, T, 'rock'));
    // South side: same pieces, different heights (shifted), for variety.
    out.push(box((a + b) / 2, 0, at, b - a, h - 2 + (i % 2) * 3, T, 'rock'));
  });
  eastWest.forEach(([a, b, h], i) => {
    out.push(box(-at, 0, (a + b) / 2, T, h, b - a, 'rock'));
    out.push(box(at, 0, (a + b) / 2, T, h + 1 - (i % 2) * 3, b - a, 'rock'));
  });
  return out;
}

// --- The dressed buildings: one constant per building, used both for its boxes
//     (buildingOf) and to put doors and windows on its walls (see "Doors and windows").
/** A building's solid block: center, size, height. */
interface Block {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  height: number;
}
const SALOON: Block = { x: -15, z: -14, sizeX: 14, sizeZ: 10, height: 7 };
const CHURCH: Block = { x: 17, z: -16, sizeX: 10, sizeZ: 14, height: 9 };
const BELL_TOWER: Block = { x: 17, z: -25.5, sizeX: 5, sizeZ: 5, height: 22 };
const SHERIFF: Block = { x: -14, z: 14, sizeX: 12, sizeZ: 9, height: 5 };
const BANK: Block = { x: 15, z: 14, sizeX: 10, sizeZ: 10, height: 8 };
const HOTEL: Block = { x: -14, z: -33, sizeX: 10, sizeZ: 8, height: 5 };
const UNDERTAKER: Block = { x: -33, z: -29, sizeX: 8, sizeZ: 7, height: 4 };
const STABLE: Block = { x: 8, z: -35, sizeX: 8, sizeZ: 8, height: 6 };
const DEPOT: Block = { x: 38.5, z: -30, sizeX: 7, sizeZ: 10, height: 5 };
const HOUSE_WEST: Block = { x: -36, z: 16, sizeX: 7, sizeZ: 8, height: 4 };
const HOUSE_SOUTH: Block = { x: -16, z: 34, sizeX: 7, sizeZ: 6, height: 4 };
const WAREHOUSE: Block = { x: 25, z: 34, sizeX: 10, sizeZ: 8, height: 6 };
const TELEGRAPH: Block = { x: 38.5, z: 5, sizeX: 7, sizeZ: 6, height: 4 };
const BATHHOUSE: Block = { x: -38.5, z: 1, sizeX: 7, sizeZ: 8, height: 5 };
/** The gunsmith's ground floor (the armory is upstairs). */
const GUNSMITH: Block = { x: 18, z: 25, sizeX: 8, sizeZ: 7, height: 4 };

// --- A building: solid block + a roof slab slightly wider (eaves) -----------------
// roof: 'roof' = wood shingles, 'tinRoof' = corrugated tin, 'tiles' = clay tiles.
function building(
  x: number,
  z: number,
  sizeX: number,
  height: number,
  sizeZ: number,
  look: Box['look'],
  roof: Box['look'] = 'roof',
): Box[] {
  return [
    box(x, 0, z, sizeX, height, sizeZ, look),
    box(x, height, z, sizeX + 0.6, 0.3, sizeZ + 0.6, roof),
  ];
}
/** The same, from a Block. */
function buildingOf(b: Block, look: Box['look'], roof: Box['look'] = 'roof'): Box[] {
  return building(b.x, b.z, b.sizeX, b.height, b.sizeZ, look, roof);
}

// --- Close-quarters dressing: small pieces that turn open ground into choices -----
// The rule (docs/DESIGN.md, "La mappa"): the streets should never be a wide
// empty racetrack. Low things (≤ 1 m) are hopped over by you AND the ghouls;
// posts and tall things block bullets, lines of sight and the eye-bats' aim.

/**
 * A porch in front of a building: a row of posts and a plank awning on top.
 * The posts are cover to circle around; the awning hides you from the
 * eye-bats (they need a clear line to shoot). Along Z, posts at x.
 */
function porch(x: number, z1: number, z2: number, awningX: number, height: number): Box[] {
  const out: Box[] = [];
  for (let z = z1; z <= z2 + 0.01; z += (z2 - z1) / 3) out.push(box(x, 0, z, 0.25, height, 0.25, 'timber'));
  out.push(box(awningX, height, (z1 + z2) / 2, Math.abs(awningX - x) * 2 + 0.5, 0.2, z2 - z1 + 1, 'tinRoof'));
  return out;
}

/** An open shed: four posts and a roof. Shade from the eye-bats, but the ghouls walk right in. */
function shed(x: number, z: number, sizeX: number, sizeZ: number, height: number): Box[] {
  const hx = sizeX / 2 - 0.2;
  const hz = sizeZ / 2 - 0.2;
  return [
    box(x - hx, 0, z - hz, 0.4, height, 0.4, 'timber'),
    box(x + hx, 0, z - hz, 0.4, height, 0.4, 'timber'),
    box(x - hx, 0, z + hz, 0.4, height, 0.4, 'timber'),
    box(x + hx, 0, z + hz, 0.4, height, 0.4, 'timber'),
    box(x, height, z, sizeX + 0.4, 0.3, sizeZ + 0.4, 'tinRoof'),
  ];
}

/**
 * A low fence (0.9 m: everyone hops it) around a rectangle, with a gap in
 * the middle of every side. It doesn't stop anyone, it slows them down:
 * a hop costs a ghoul a moment, and costs you a bit of aim.
 */
function fence(minX: number, minZ: number, maxX: number, maxZ: number, gap: number): Box[] {
  const h = 0.9;
  const t = 0.15;
  const halfX = (maxX - minX - gap) / 2; // length of each half of a north/south side
  const halfZ = (maxZ - minZ - gap) / 2;
  return [
    box(minX + halfX / 2, 0, minZ, halfX, h, t, 'timber'),
    box(maxX - halfX / 2, 0, minZ, halfX, h, t, 'timber'),
    box(minX + halfX / 2, 0, maxZ, halfX, h, t, 'timber'),
    box(maxX - halfX / 2, 0, maxZ, halfX, h, t, 'timber'),
    box(minX, 0, minZ + halfZ / 2, t, h, halfZ, 'timber'),
    box(minX, 0, maxZ - halfZ / 2, t, h, halfZ, 'timber'),
    box(maxX, 0, minZ + halfZ / 2, t, h, halfZ, 'timber'),
    box(maxX, 0, maxZ - halfZ / 2, t, h, halfZ, 'timber'),
  ];
}

/**
 * A wall along Z (at x, from z1 to z2), `height` tall, with OPENINGS cut in
 * it: doors and windows. A box can't have a hole, so the wall is built from
 * pieces: for each opening, a piece below it (the sill: none for a door) and
 * one above it (the lintel), plus the full-height pieces between openings.
 * openings: [from z, to z, bottom y, top y]. The pieces share one look and, since
 * textures are anchored to the world, it runs across them without seams.
 */
function wallZ(
  x: number,
  z1: number,
  z2: number,
  height: number,
  openings: [number, number, number, number][],
  look: Box['look'],
): Box[] {
  const t = 0.3; // thickness
  const out: Box[] = [];
  let z = z1;
  for (const [a, b, bottom, top] of openings) {
    if (a > z) out.push(box(x, 0, (z + a) / 2, t, height, a - z, look)); // solid piece before
    if (bottom > 0) out.push(box(x, 0, (a + b) / 2, t, bottom, b - a, look)); // sill
    out.push(box(x, top, (a + b) / 2, t, height - top, b - a, look)); // lintel
    z = b;
  }
  if (z2 > z) out.push(box(x, 0, (z + z2) / 2, t, height, z2 - z, look));
  return out;
}
/** The same, for a wall along X (at z, from x1 to x2). Openings: [from x, to x, bottom y, top y]. */
function wallX(
  z: number,
  x1: number,
  x2: number,
  height: number,
  openings: [number, number, number, number][],
  look: Box['look'],
): Box[] {
  // Build it as a wall along Z, then swap X and Z in every box (a mirror
  // across the diagonal: same shape, rotated 90°).
  return wallZ(z, x1, x2, height, openings, look).map((b) => ({ ...b, minX: b.minZ, maxX: b.maxZ, minZ: b.minX, maxZ: b.maxX }));
}

/** Moves boxes up by `dy`: walls built from the ground (wallZ/wallX) become the walls of an upper floor. */
function raise(boxes: Box[], dy: number): Box[] {
  return boxes.map((b) => ({ ...b, minY: b.minY + dy, maxY: b.maxY + dy }));
}

/**
 * Steps of crates against a wall, `count` crates `step` m apart in height,
 * going from (x, z) in the direction (dx, dz). The last one lets you jump
 * onto a roof. Steps ≤ 1 m: the max jump is ~1.17 m.
 */
function crateSteps(x: number, z: number, dx: number, dz: number, count: number, step: number): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < count; i++) out.push(box(x + dx * i * 1.2, 0, z + dz * i * 1.2, 1.2, step * (i + 1), 1.2, 'crate'));
  return out;
}

// --- Doors and windows -----------------------------------------------------------------
// Pictures on the walls (Decal in src/sim/world.ts): only drawn, the boxes don't change.

/** A kind of window: how it looks dark, lit from inside, and shut (boarded or broken). */
interface WindowKind {
  dark: DecalLook;
  lit: DecalLook;
  shut: DecalLook;
  width: number;
  height: number;
}
const SQUARE: WindowKind = { dark: 'window', lit: 'windowLit', shut: 'windowBoarded', width: 1.2, height: 1.2 };
const TALL: WindowKind = { dark: 'windowTall', lit: 'windowTallLit', shut: 'windowTallBroken', width: 1.1, height: 2.2 };
const ARCHED: WindowKind = { dark: 'windowArched', lit: 'windowArchedLit', shut: 'windowArchedBroken', width: 1.1, height: 2.2 };
const ROUND: WindowKind = { dark: 'windowRound', lit: 'windowRoundLit', shut: 'windowRoundBoarded', width: 1.2, height: 1.2 };
const BARRED: WindowKind = { dark: 'windowBars', lit: 'windowBarsLit', shut: 'windowBars', width: 1.2, height: 1.2 };
const DOOR_W = 1.2;
const DOOR_H = 2.4;
/** How many windows are lit, and how many boarded up: a ghost town, but someone's home. */
const LIT_SHARE = 0.25;
const SHUT_SHARE = 0.25;

/**
 * One picture on a wall of `b`: `along` m to the right of the wall's middle, as
 * seen from outside (the same "right" the textures use: quadBatch.ts), with its
 * bottom at height `bottom`.
 */
function onWall(b: Block, facing: Facing, along: number, bottom: number, look: DecalLook, width: number, height: number): Decal {
  // The middle of the wall and the direction of "right" on it.
  const [x, z, rightX, rightZ] =
    facing === 'north' ? [b.x, b.z - b.sizeZ / 2, -1, 0]
    : facing === 'south' ? [b.x, b.z + b.sizeZ / 2, 1, 0]
    : facing === 'east' ? [b.x + b.sizeX / 2, b.z, 0, -1]
    : [b.x - b.sizeX / 2, b.z, 0, 1];
  return { x: x + rightX * along, y: bottom + height / 2, z: z + rightZ * along, facing, width, height, look };
}

/**
 * A window: dark, lit or shut? Random, but a STABLE random: a hash of where the
 * window is (seedFrom), so it's the same at every load and doesn't change when
 * windows are added or moved elsewhere.
 */
function windowAt(b: Block, facing: Facing, along: number, sill: number, kind: WindowKind): Decal {
  const d = onWall(b, facing, along, sill, kind.dark, kind.width, kind.height);
  const r = (seedFrom(Math.round(d.x * 10), Math.round(d.y * 10), Math.round(d.z * 10)) >>> 0) / 2 ** 32;
  d.look = r < LIT_SHARE ? kind.lit : r < LIT_SHARE + SHUT_SHARE ? kind.shut : kind.dark;
  return d;
}

/**
 * Rows of windows along one wall, evenly spaced (about one every `spacing` m).
 * `rows` = the sill height of each row; by default one row per 2.5 m floor, while
 * the window still fits 0.4 m under the roof. A `door` goes in the middle of the
 * wall, and the windows of the ground row make room for it.
 */
function windows(
  b: Block,
  facing: Facing,
  kind: WindowKind,
  opts: { rows?: number[]; spacing?: number; door?: DecalLook } = {},
): Decal[] {
  const length = facing === 'north' || facing === 'south' ? b.sizeX : b.sizeZ;
  const count = Math.max(1, Math.floor(length / (opts.spacing ?? 3)));
  const rows = opts.rows ?? [];
  if (!opts.rows) for (let sill = 0.9; sill + kind.height <= b.height - 0.4; sill += 2.5) rows.push(sill);
  const out: Decal[] = [];
  if (opts.door) out.push(onWall(b, facing, 0, 0, opts.door, DOOR_W, DOOR_H));
  for (const sill of rows) {
    for (let i = 0; i < count; i++) {
      const along = ((i + 0.5) / count - 0.5) * length;
      if (opts.door && sill < DOOR_H && Math.abs(along) < (DOOR_W + kind.width) / 2 + 0.3) continue;
      out.push(windowAt(b, facing, along, sill, kind));
    }
  }
  return out;
}

/** Two doors side by side in the middle of a wall: a barn, a church, a warehouse. */
function doubleDoor(b: Block, facing: Facing, look: DecalLook): Decal[] {
  return [onWall(b, facing, -0.7, 0, look, 1.4, 2.8), onWall(b, facing, 0.7, 0, look, 1.4, 2.8)];
}

/**
 * A frame around a REAL opening in a wall (cut with wallZ/wallX). The frame
 * pictures have an empty middle and a border (measured on the PNGs: the hole is
 * 46 × 111 px of 64 × 128 for the door, 47 × 47 px of 64 × 64 for the window):
 * the picture is made bigger than the hole, so that its empty middle IS the hole.
 * (x, y, z) = the middle of the hole, on the wall's outer surface.
 */
function frame(x: number, y: number, z: number, facing: Facing, holeW: number, holeH: number, look: 'doorFrame' | 'windowFrame'): Decal {
  const [shareW, shareH] = look === 'doorFrame' ? [46 / 64, 111 / 128] : [47 / 64, 47 / 64];
  return { x, y, z, facing, width: holeW / shareW, height: holeH / shareH, look };
}

const decals: Decal[] = [
  // SALOON: the front on Main Street, an open door on the dark room and tall
  // windows on both floors (the upper row above the balcony).
  ...windows(SALOON, 'east', TALL, { rows: [0.4, 3.5], spacing: 3.3, door: 'doorway' }),
  ...windows(SALOON, 'north', SQUARE),
  ...windows(SALOON, 'south', SQUARE),
  ...windows(SALOON, 'west', SQUARE, { door: 'doorPlain' }),
  // HOTEL: the door with the lit pane faces the saloon.
  ...windows(HOTEL, 'south', SQUARE, { door: 'doorLit' }),
  ...windows(HOTEL, 'north', SQUARE),
  ...windows(HOTEL, 'east', SQUARE),
  ...windows(HOTEL, 'west', SQUARE),
  ...windows(UNDERTAKER, 'south', SQUARE, { door: 'door' }),
  ...windows(UNDERTAKER, 'east', SQUARE),
  ...windows(UNDERTAKER, 'west', SQUARE),
  // STABLE: the barn doors on Main Street, the hayloft's shutters above them.
  ...doubleDoor(STABLE, 'west', 'doorPlain'),
  onWall(STABLE, 'west', 0, 3.6, 'shutters', 1.2, 1.2),
  ...windows(STABLE, 'south', SQUARE, { spacing: 4 }),
  ...windows(STABLE, 'east', SQUARE, { spacing: 4 }),
  ...windows(DEPOT, 'west', SQUARE, { door: 'doorLit' }),
  ...windows(DEPOT, 'north', SQUARE),
  ...windows(DEPOT, 'south', SQUARE),
  // CHURCH: double door under a round window, arched windows all around.
  ...doubleDoor(CHURCH, 'west', 'doorPlain'),
  onWall(CHURCH, 'west', 0, 4.2, 'windowRoundLit', 1.8, 1.8),
  ...[-4.5, 4.5].flatMap((along) => [1.4, 4.8].map((sill) => windowAt(CHURCH, 'west', along, sill, ARCHED))),
  ...windows(CHURCH, 'south', ARCHED, { rows: [1.4, 4.8], spacing: 3.3 }),
  ...windows(CHURCH, 'east', ARCHED, { rows: [1.4, 4.8], spacing: 3.5 }),
  ...[-3.7, 3.7].flatMap((along) => [1.4, 4.8].map((sill) => windowAt(CHURCH, 'north', along, sill, ARCHED))), // beside the tower
  ...(['north', 'south', 'east', 'west'] as Facing[]).flatMap((f) => windows(BELL_TOWER, f, ARCHED, { rows: [12, 16.5], spacing: 5 })),
  // SHERIFF: the office door on Main Street, the cells' barred windows on the other sides.
  ...windows(SHERIFF, 'east', SQUARE, { door: 'door' }),
  ...windows(SHERIFF, 'north', BARRED),
  ...windows(SHERIFF, 'west', BARRED),
  ...windows(SHERIFF, 'south', BARRED),
  // BANK: bars on every window.
  ...windows(BANK, 'west', BARRED, { spacing: 3.3, door: 'door' }),
  ...windows(BANK, 'north', BARRED, { spacing: 3.3 }),
  ...windows(BANK, 'east', BARRED, { spacing: 3.3 }),
  ...windows(BANK, 'south', BARRED, { spacing: 3.3 }),
  ...windows(HOUSE_WEST, 'east', SQUARE, { door: 'doorPlain' }),
  ...windows(HOUSE_WEST, 'north', SQUARE),
  ...windows(HOUSE_WEST, 'south', SQUARE),
  ...windows(HOUSE_SOUTH, 'north', SQUARE, { door: 'door' }),
  ...windows(HOUSE_SOUTH, 'east', SQUARE),
  ...windows(HOUSE_SOUTH, 'west', SQUARE),
  ...windows(HOUSE_SOUTH, 'south', SQUARE),
  // WAREHOUSE: the loading doors, small windows up high.
  ...doubleDoor(WAREHOUSE, 'north', 'doorPlain'),
  ...windows(WAREHOUSE, 'north', SQUARE, { rows: [3.6], spacing: 3.3 }),
  ...windows(WAREHOUSE, 'east', SQUARE, { rows: [3.6], spacing: 4 }),
  ...windows(WAREHOUSE, 'west', SQUARE, { rows: [3.6], spacing: 4 }),
  ...windows(WAREHOUSE, 'south', SQUARE, { rows: [3.6], spacing: 4 }),
  ...windows(TELEGRAPH, 'west', SQUARE, { door: 'doorLit' }),
  ...windows(TELEGRAPH, 'north', SQUARE),
  ...windows(TELEGRAPH, 'south', SQUARE),
  // BATHHOUSE: round windows (portholes on the steam).
  ...windows(BATHHOUSE, 'east', ROUND, { door: 'door' }),
  ...windows(BATHHOUSE, 'north', ROUND),
  ...windows(BATHHOUSE, 'south', ROUND),
  // GUNSMITH: the ground floor is locked up (the shop is upstairs).
  ...windows(GUNSMITH, 'west', BARRED, { door: 'doorGate' }),
  ...windows(GUNSMITH, 'north', BARRED),
  ...windows(GUNSMITH, 'south', BARRED),
  // Frames around the real openings. GENERAL STORE (walls 0.3 m thick: the
  // outer surface is 0.15 m from the line given to wallZ/wallX).
  frame(-22.85, 1.3, 15.1, 'east', 2.2, 2.6, 'doorFrame'),
  frame(-30.65, 1.3, 14.6, 'west', 2.2, 2.6, 'doorFrame'),
  frame(-27.2, 1.9, 10.85, 'north', 2, 2.2, 'windowFrame'),
  frame(-26.7, 1.9, 19.15, 'south', 2, 2.2, 'windowFrame'),
  // ARMORY (floor at 4.3 m).
  frame(16.4, 5.75, 28.5, 'south', 2.4, 2.9, 'doorFrame'),
  frame(20.3, 6.15, 28.5, 'south', 1.8, 2.1, 'windowFrame'),
  frame(14, 6, 25.2, 'west', 2.8, 2.4, 'windowFrame'),
  frame(22, 5.75, 25.4, 'east', 2.4, 2.9, 'doorFrame'),
];

// --- The ground: streets, squares, boardwalks, rails ---------------------------------
// Painted on the ground (GroundPatch in src/sim/world.ts): only drawn, the ground
// box under them doesn't change. They must not overlap (they'd flicker).

/** A ground patch from its corners (min x, min z, max x, max z). */
function patch(minX: number, minZ: number, maxX: number, maxZ: number, look: GroundPatch['look']): GroundPatch {
  return { minX, minZ, maxX, maxZ, look };
}

const ground: GroundPatch[] = [
  // MAIN STREET, packed by the wagons: 10 m wide, north and south of the square.
  patch(-5, -42, 5, -8, 'road'),
  patch(-5, 8, 5, 42, 'road'),
  // CROSS STREET: 7 m, from the gallows to the rail line.
  patch(-28, -3.5, -8, 3.5, 'road'),
  patch(11, -3.5, 28, 3.5, 'road'),
  // The SQUARE at the crossing (the well), and the church's forecourt: flagstones.
  patch(-8, -8, 11, 8, 'paving'),
  patch(5, -23, 12, -8, 'paving'),
  // BOARDWALKS in front of the buildings (under the balcony and the porches).
  patch(-8, -19, -5.6, -9, 'planks'), // saloon
  patch(-8, 9.5, -5.6, 18.5, 'planks'), // sheriff
  patch(7.6, 9, 10, 19, 'planks'), // bank
  patch(-19, -29, -9, -27, 'planks'), // hotel
  patch(32, -35, 35, -25, 'planks'), // depot: the platform along the tracks
  patch(33, 2, 35, 8, 'planks'), // telegraph office
  // RAILS: the line under the wagons, and a minecart track into the mine.
  patch(29, -42, 31, 42, 'railway'),
  patch(35.5, 28, 37.5, 37, 'railway'),
  // Floors: inside the general store (up to the inner face of its walls), under the sheds.
  patch(-30.35, 11.15, -23.15, 18.85, 'planks'),
  patch(-40, -18, -33, -12, 'paving'), // the forge
  patch(35, -20, 42, -14, 'planks'), // the sawmill
];

// --- Cemetery: rows of tombstones and crosses ----------------------------------------
function cemetery(cx: number, cz: number): Box[] {
  const out: Box[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = cx + col * 2.2 - 3.3;
      const z = cz + row * 2.5 - 2.5;
      if ((row + col) % 2 === 0) {
        out.push(box(x, 0, z, 0.7, 1, 0.25, 'stone')); // tombstone
      } else {
        out.push(box(x, 0, z, 0.15, 1.4, 0.15, 'timber')); // cross: post...
        out.push(box(x, 0.95, z, 0.7, 0.15, 0.15, 'timber')); // ...and arm
      }
    }
  }
  return out;
}

// --- Decorations ---------------------------------------------------------------------
const props: Prop[] = [
  // Steam vents (jump pads). pushX/pushZ aim the flight at a rooftop.
  { type: 'vent', x: -4.5, y: 0, z: 18.5, up: 25, pushX: -2.6, pushZ: 3.1 }, // → west tower
  { type: 'vent', x: 4.5, y: 0, z: 18.5, up: 25, pushX: 2.6, pushZ: 3.1 }, // → east tower
  { type: 'vent', x: 8.5, y: 0, z: -16, up: 21, pushX: 4 }, // → church roof
  { type: 'vent', x: 17, y: 9.3, z: -20.5, up: 24, pushZ: -2.3 }, // church roof → bell tower top

  // Torches along Main Street.
  { type: 'torch', x: -5.3, y: 0, z: -26 },
  { type: 'torch', x: 5.3, y: 0, z: -26 },
  { type: 'torch', x: -5.3, y: 0, z: 6.5 },
  { type: 'torch', x: 5.3, y: 0, z: 6.5 },
  { type: 'torch', x: -5.3, y: 0, z: 30 },
  { type: 'torch', x: 5.3, y: 0, z: 30 },

  // Lanterns on the buildings (rotation: the bracket points that way).
  { type: 'lantern', mount: 'wall', x: -8, y: 5.6, z: -11, rotation: 90 }, // saloon, above the balcony
  { type: 'lantern', mount: 'wall', x: -8, y: 3.2, z: 14, rotation: 90 }, // sheriff
  { type: 'lantern', mount: 'wall', x: 10, y: 3.4, z: 14, rotation: -90 }, // bank
  { type: 'lantern', mount: 'wall', x: 12, y: 4, z: -12, rotation: -90 }, // church
  { type: 'lantern', mount: 'ground', x: 15.6, y: 22, z: -26.6, rotation: 20 }, // bell tower top
  { type: 'lantern', mount: 'ground', x: -27.6, y: 8, z: -15.3, rotation: 0 }, // water tower top
  { type: 'lantern', mount: 'ground', x: 0, y: 14, z: 24, rotation: 45 }, // middle of the bridge
  { type: 'lantern', mount: 'ground', x: -25.5, y: 1, z: 17.3, rotation: 0 }, // on the general store's counter
  { type: 'lantern', mount: 'ground', x: 19.6, y: 5.3, z: 23.3, rotation: 0 }, // on the armory's counter, next to the vendor

  // Signs on the sidewalks (board hangs toward +X, or -X with rotation 180).
  { type: 'sign', x: -5.6, y: 0, z: -21, rotation: 0, text: 'SALOON' },
  { type: 'sign', x: -5.6, y: 0, z: 11, rotation: 0, text: 'SHERIFF' },
  { type: 'sign', x: 5.6, y: 0, z: 11, rotation: 180, text: 'BANK' },
  { type: 'sign', x: 5.6, y: 0, z: -8, rotation: 180, text: 'CHURCH' },
  { type: 'sign', x: 13.2, y: 0, z: 30.2, rotation: 180, text: 'GUNSMITH' }, // under the balcony, board toward Main Street

  // Barrels.
  { type: 'barrel', x: -7.2, y: 0, z: -21.5, rotation: 15 },
  { type: 'barrel', x: -7.4, y: 0, z: -22.6, rotation: 80 },
  { type: 'barrel', x: 7.1, y: 0, z: 21, rotation: 30 },
  { type: 'barrel', x: 27.2, y: 0, z: 2, rotation: 0 },
  { type: 'barrel', x: 27.4, y: 0, z: 3.1, rotation: 120 },
  { type: 'barrel', x: -26, y: 0, z: -3.6, rotation: 60 },

  // Dry grass at the foot of the cliffs and in the cemetery.
  { type: 'grass', x: -30, z: 30, radius: 7, count: 60 },
  { type: 'grass', x: 34, z: 34, radius: 6, count: 40 },
  { type: 'grass', x: -36, z: -36, radius: 6, count: 40 },
  { type: 'grass', x: 34, z: -36, radius: 6, count: 40 },
  { type: 'grass', x: 0, z: -38, radius: 6, count: 30 },
  { type: 'grass', x: -36, z: 8, radius: 4, count: 25 },
  { type: 'grass', x: 36, z: 22, radius: 5, count: 30 },
  { type: 'grass', x: 0, z: 0, radius: 3, count: 12 },
];

export const town: World = {
  spawn: { x: 0, y: 0, z: 36 },
  props,
  decals,
  ground,
  // The vendors (see ShopSpawn in src/sim/world.ts).
  shops: [
    { x: 18, y: 4.3, z: 22.4, kind: 'weapons' }, // armory: behind the counter
  ],
  // Steel practice targets. `rotation` = where the plate faces (same as ?look=):
  // 0 = north, 90 = west, 180 = south, -90 = east. Some are on the rooftops,
  // to give a reason to climb.
  // Where the enemies crawl out from. Spread over the WHOLE town, not just
  // the edges: the waves pick one ahead of you and out of sight (see
  // pickSpawn in src/sim/waves.ts), so running laps leads you into a horde.
  enemySpawns: [
    // Corners and sides of the canyon.
    { x: -36, y: 0, z: -36 },
    { x: 36, y: 0, z: -36 },
    { x: -39, y: 0, z: 39 },
    { x: 36, y: 0, z: 36 },
    { x: 0, y: 0, z: -38 },
    { x: -38, y: 0, z: 8 },
    { x: 38, y: 0, z: 18 },
    { x: 16, y: 0, z: -36 },
    { x: 0, y: 0, z: 38 },
    { x: -38, y: 0, z: -20 },
    { x: -38, y: 0, z: 22 },
    { x: 40, y: 0, z: -2 },
    // Behind the buildings (north side).
    { x: -20, y: 0, z: -30 },
    { x: -14, y: 0, z: -24 },
    { x: 0, y: 0, z: -25 },
    { x: 25, y: 0, z: -28 },
    // Behind the buildings (south side), near the towers and the cemetery.
    { x: -18, y: 0, z: 26 },
    { x: 14, y: 0, z: 34 },
    { x: 25, y: 0, z: 28 },
    // Cross Street (both ends), between the wagons, Main Street.
    { x: -22, y: 0, z: 2 },
    { x: 24, y: 0, z: 4 },
    { x: 34, y: 0, z: 0 },
    { x: 2, y: 0, z: -14 },
    { x: 2, y: 0, z: 14 },
  ],
  targets: [
    { x: -3, y: 0, z: 27, rotation: 180 }, // near the spawn, facing it
    { x: 3, y: 0, z: 27, rotation: 180 },
    { x: 16, y: 0, z: -1.5, rotation: 90 }, // shooting range on Cross Street (east)
    { x: 19, y: 0, z: 1.5, rotation: 90 },
    { x: 22, y: 0, z: -0.5, rotation: 90 },
    { x: -18, y: 7.3, z: -11, rotation: -90 }, // saloon roof
    { x: 19, y: 9.3, z: -12, rotation: 90 }, // church roof
    { x: -9, y: 14, z: 24, rotation: 180 }, // top of the west tower
    { x: -26.3, y: 8, z: -12.8, rotation: -90 }, // water tower
    { x: -30, y: 0, z: 34, rotation: 0 }, // cemetery
  ],
  boxes: [
    ...props.flatMap(propColliders),

    // Ground: 92 × 92 m.
    box(0, -1, 0, 92, 1, 92, 'dirt'),
    ...cliffs(),

    // --- SALOON (NW): roof 7.3 m, balcony on the street side at 3 m ---
    ...buildingOf(SALOON, 'clapboardRed'),
    box(-7.25, 2.75, -14, 1.5, 0.25, 10, 'planks'), // balcony floor
    box(-6.75, 0, -18.7, 0.3, 2.75, 0.3, 'timber'), // balcony posts
    box(-6.75, 0, -9.3, 0.3, 2.75, 0.3, 'timber'),
    box(-4.8, 0, -8.5, 1, 1, 1, 'crate'), // crate steps up to the balcony
    box(-6, 0, -8.5, 1, 2, 1, 'crate'),
    // A "staircase" of junk piled on the balcony, up to the roof. Steps of
    // 1 m: the max jump height is ~1.17 m, so 1.2 m steps would be too tall!
    // Climb it heading north (you arrive on the balcony from its south end).
    box(-7.25, 3, -15.5, 1.2, 1, 1, 'crate'), // top 4
    box(-7.25, 3, -16.5, 1.2, 2, 1, 'crate'), // top 5
    box(-7.25, 3, -17.5, 1.2, 3, 1, 'crate'), // top 6
    box(-7.25, 3, -18.5, 1.2, 4, 1, 'crate'), // top 7 → jump west onto the roof (7.3)

    // --- WATER TOWER (west of the saloon): tank top at 8 m, 1.5 m from the
    //     saloon roof: a running jump from the roof lands you on it ---
    box(-28.3, 0, -16, 0.5, 4, 0.5, 'timber'),
    box(-24.3, 0, -16, 0.5, 4, 0.5, 'timber'),
    box(-28.3, 0, -12, 0.5, 4, 0.5, 'timber'),
    box(-24.3, 0, -12, 0.5, 4, 0.5, 'timber'),
    box(-26.3, 4, -14, 5, 4, 5, 'boards'), // the tank: staves, a band at its foot and one at the top

    // --- CHURCH (NE): roof 9.3 m ---
    ...buildingOf(CHURCH, 'adobe', 'tiles'), // a mission church: adobe and clay tiles
    // Bell tower against the church's north side, 22 m (reached with the
    // steam vent on the church roof).
    box(BELL_TOWER.x, 0, BELL_TOWER.z, BELL_TOWER.sizeX, BELL_TOWER.height, BELL_TOWER.sizeZ, 'adobe'),
    // Belfry on top: four tall corner posts, a roof high enough not to bump
    // your head when the vent launches you, and the bell (you can walk under it).
    box(14.8, 22, -27.7, 0.4, 4, 0.4, 'timber'),
    box(19.2, 22, -27.7, 0.4, 4, 0.4, 'timber'),
    box(14.8, 22, -23.3, 0.4, 4, 0.4, 'timber'),
    box(19.2, 22, -23.3, 0.4, 4, 0.4, 'timber'),
    box(17, 26, -25.5, 5.4, 0.4, 5.4, 'tiles'),
    box(17, 24.4, -25.5, 1, 1.2, 1, 'metal'), // the bell

    // --- Floating platforms over Main Street: saloon roof → church roof ---
    box(-3, 7.6, -14, 3, 0.4, 3, 'metal'), // top 8.0
    box(3, 8.2, -14, 3, 0.4, 3, 'metal'), // top 8.6
    box(8.5, 8.6, -14, 3, 0.4, 3, 'metal'), // top 9.0

    // --- SHERIFF (SW): roof 5.3 m ---
    ...buildingOf(SHERIFF, 'stone'), // the jail: stone walls

    // --- BANK (SE): roof 8.3 m ---
    ...buildingOf(BANK, 'brick', 'tinRoof'),

    // --- Floating platforms over Main Street: sheriff roof → bank roof ---
    box(-3, 5.6, 14, 3, 0.4, 3, 'metal'), // top 6.0
    box(3, 6.6, 13, 3, 0.4, 3, 'metal'), // top 7.0
    box(7.5, 7.4, 14, 2.5, 0.4, 3, 'metal'), // top 7.8

    // --- TWIN TOWERS (14 m) and the bridge between them, over Main Street ---
    box(-9, 0, 24, 4, 14, 4, 'metal'),
    box(9, 0, 24, 4, 14, 4, 'metal'),
    box(0, 13.6, 24, 14, 0.4, 2.5, 'planks'),

    // --- GALLOWS (west end of Cross Street): platform 2 m ---
    box(-30, 0, 0, 5, 2, 5, 'planks'),
    box(-26.9, 0, 0, 1.2, 1, 1.2, 'crate'), // step
    box(-31.5, 2, 0, 0.3, 3.5, 0.3, 'timber'),
    box(-28.5, 2, 0, 0.3, 3.5, 0.3, 'timber'),
    box(-30, 5.5, 0, 3.3, 0.3, 0.3, 'timber'),

    // --- CEMETERY (SW corner) ---
    ...cemetery(-30, 30),

    // --- RAILWAY (east side): two abandoned wagons, roofs at 3.2 m ---
    box(30, 0, -8, 3, 3.2, 9, 'clapboardOchre'),
    box(30, 0, 8, 3, 3.2, 9, 'tin'),
    box(27.6, 0, -3, 1.2, 1.2, 1.2, 'crate'), // crate to climb on the wagons
    // A longer train: the rail line becomes a wall with three narrow
    // crossings (5-7 m) between the wagons. Chokepoints for the horde.
    box(30, 0, -22, 3, 3.2, 9, 'tin'),
    box(30, 0, 22, 3, 3.2, 9, 'clapboardOchre'),
    box(27.6, 0, 20, 1.2, 1.2, 1.2, 'crate'), // crate to climb on the south wagon

    // ===== CLOSE-QUARTERS PASS: filling the empty quarters with alleys =====
    // --- North: HOTEL (roof 5.3, crate steps on its east side) and UNDERTAKER ---
    ...buildingOf(HOTEL, 'clapboard'), // x -19..-9, z -37..-29
    ...crateSteps(-8, -29.8, 0, -1, 5, 1), // tops 1-5 m, going north → jump west onto the roof (5.3)
    ...buildingOf(UNDERTAKER, 'boards'), // x -37..-29, z -32.5..-25.5
    // --- North: STABLE across Main Street from the hotel (Main Street north is 13 m wide) ---
    ...buildingOf(STABLE, 'clapboardRed', 'tinRoof'), // x 4..12, z -39..-31: a red barn
    box(-1, 0, -33, 4, 0.8, 1, 'planks'), // water trough in the middle of the street
    // --- North-east: railway DEPOT against the cliff ---
    ...buildingOf(DEPOT, 'clapboardOchre', 'tinRoof'), // x 35..42, z -35..-25

    // --- West: BLACKSMITH's open shed (forge + anvil) and a HOUSE ---
    ...shed(-36.5, -15, 7, 6, 3.5),
    box(-37.5, 0, -15, 2, 1.1, 2, 'brick'), // forge
    box(-34.5, 0, -14, 1, 0.8, 0.6, 'metal'), // anvil
    ...buildingOf(HOUSE_WEST, 'boards'), // x -39.5..-32.5, z 12..20
    // --- Cross Street west: an abandoned covered wagon in the middle, up on
    //     its wheels: you can SLIDE under it (1.1 m), the ghouls go around ---
    box(-16, 1.1, 3, 4.5, 1.3, 2, 'boards'),
    box(-17.9, 0, 2.1, 0.3, 1.1, 0.3, 'timber'), // wheels
    box(-14.1, 0, 2.1, 0.3, 1.1, 0.3, 'timber'),
    box(-17.9, 0, 3.9, 0.3, 1.1, 0.3, 'timber'),
    box(-14.1, 0, 3.9, 0.3, 1.1, 0.3, 'timber'),

    // ===== TRAVERSAL PASS: rewarding precise movement =====
    // --- High road 1: HOTEL roof (5.3) → two pillars (1×1 m tops!) → UNDERTAKER roof (4.3).
    //     Gaps 2.2-2.7 m: easy with a running jump, but the landings are tiny:
    //     hop from pillar to pillar without stopping. ---
    box(-22, 0, -30.75, 1, 5, 1, 'timber'),
    box(-25.5, 0, -30.75, 1, 4.7, 1, 'timber'),
    // --- High road 2: HOTEL roof (5.3) → two floating platforms (6.0, 6.7) → SALOON roof (7.3),
    //     which joins the old network (floating platforms → church → bell tower) ---
    box(-12, 5.6, -26.5, 2, 0.4, 2, 'metal'),
    box(-12, 6.3, -23, 2, 0.4, 2, 'metal'),
    // --- High road 3: BANK roof (8.3) → GUNSMITH roof (8.0, a 1.9 m jump)
    //     → WAREHOUSE roof (6.3, a drop: the two roofs almost touch at their corners) ---

    // --- Slide passage: the middle crossing of the rail line is blocked by a
    //     low coupling deck at 1.1 m. You slide under it; the ghouls (1.8 m)
    //     must use the other crossings. An escape route for good movement. ---
    box(30, 1.1, 0, 3, 0.4, 7, 'metal'),

    // --- GENERAL STORE: a building you can go INSIDE (8 × 7.5 m, roof 4.3).
    //     Doors east and west, windows north and south (sill 0.8 m: jump through;
    //     the opening is 2.2 m tall, so a standing body fits while hopping in).
    //     Indoors the eye-bats can't see you, but the ghouls follow you in:
    //     real close quarters. The roof: wall jumps only. ---
    ...wallZ(-23, 11, 19, 4, [[14, 16.2, 0, 2.6]], 'clapboardOchre'), // east wall, door
    ...wallZ(-30.5, 11, 19, 4, [[13.5, 15.7, 0, 2.6]], 'clapboardOchre'), // west wall, door
    ...wallX(11, -30.5, -23, 4, [[-28.2, -26.2, 0.8, 3]], 'clapboardOchre'), // north wall, window
    ...wallX(19, -30.5, -23, 4, [[-27.7, -25.7, 0.8, 3]], 'clapboardOchre'), // south wall, window
    box(-26.75, 4, 15, 8.1, 0.3, 8.6, 'roof'),
    box(-26.5, 0, 17.3, 3, 1, 0.6, 'planks'), // counter
    box(-29.6, 0, 12, 1, 1.8, 1.4, 'planks'), // shelves in the corner
    box(-24, 0, 12, 1, 1, 1, 'crate'), // crates
    box(-24, 1, 12, 0.8, 0.8, 0.8, 'crate'),

    // --- South: a HOUSE west of the towers, a WAREHOUSE east of them ---
    ...buildingOf(HOUSE_SOUTH, 'clapboard'), // x -19.5..-12.5, z 31..37
    ...buildingOf(WAREHOUSE, 'brick', 'tinRoof'), // x 20..30, z 30..38
    ...crateSteps(19, 30.4, 0, 1, 6, 1), // tops 1-6 m, going south → jump east onto the roof (6.3)
    // --- South-east: GUNSMITH between the east tower and the warehouse (3 m alley to the tower,
    //     2.5 m to the bank). Two storeys: a solid ground floor, and UPSTAIRS the ARMORY, the
    //     weapon shop, 7.4 × 6.4 m inside. No stairs: you get there with some parkour (routes
    //     at the top of the file). Three big ways in, so going in and out is never the hard part. ---
    box(GUNSMITH.x, 0, GUNSMITH.z, GUNSMITH.sizeX, GUNSMITH.height, GUNSMITH.sizeZ, 'stone'), // ground floor, x 14..22, z 21.5..28.5
    box(18, 4, 25, 8.6, 0.3, 7.6, 'planks'), // upstairs floor, top 4.3
    // Balcony on the south side, 1.8 m deep. It stops 1.2 m short of the
    // warehouse's eave: from that roof you jump across (and drop 2 m).
    box(16.1, 4, 29.7, 4.8, 0.3, 1.8, 'planks'), // x 13.7..18.5, z 28.8..30.6
    // The armory's walls, 3.4 m tall, standing on the upstairs floor.
    // Openings: [from, to, bottom, top], measured from the upstairs floor.
    ...raise(wallX(28.35, 14, 22, 3.4, [[15.2, 17.6, 0, 2.9], [19.4, 21.2, 0.8, 2.9]], 'boards'), 4.3), // south: wide door + window
    ...raise(wallZ(14.15, 21.5, 28.5, 3.4, [[23.8, 26.6, 0.5, 2.9]], 'boards'), 4.3), // west: big low window (from the tower side)
    ...raise(wallZ(21.85, 21.5, 28.5, 3.4, [[24.2, 26.6, 0, 2.9]], 'boards'), 4.3), // east: loading door (from the crates)
    box(18, 4.3, 21.65, 8, 3.4, 0.3, 'boards'), // north wall: behind the vendor
    box(18, 7.7, 25, 8.6, 0.3, 7.6, 'tinRoof'), // roof, top 8.0
    // Inside: the counter along the north wall, the vendor behind it (shops, above),
    // a gun rack on each side of him.
    box(18, 4.3, 23.3, 4, 1, 0.6, 'planks'), // counter, x 16..20, z 23.0..23.6
    box(15.2, 4.3, 22.1, 1.8, 1.9, 0.5, 'timber'), // gun racks
    box(20.8, 4.3, 22.1, 1.6, 1.9, 0.5, 'timber'),
    // East: a staircase of crates along the wall, going south (tops 0.95-3.8 m),
    // the last one right in front of the loading door (0.5 m below its threshold).
    // At x 22.4..23.6: clear of the upstairs floor's overhang (22.3), or you'd bump your head.
    box(23, 0, 21.8, 1.2, 0.95, 1.2, 'crate'),
    box(23, 0, 23, 1.2, 1.9, 1.2, 'crate'),
    box(23, 0, 24.2, 1.2, 2.85, 1.2, 'crate'),
    box(23, 0, 25.4, 1.2, 3.8, 1.2, 'crate'),
    // --- South-east corner: MINE ENTRANCE dug into the canyon wall (a rock outcrop + timber frame) ---
    box(37, 0, 39.5, 9, 5, 5, 'rock'),
    box(34.5, 0, 36.8, 0.4, 3.2, 0.4, 'timber'),
    box(38.5, 0, 36.8, 0.4, 3.2, 0.4, 'timber'),
    box(36.5, 3.2, 36.8, 4.4, 0.4, 0.4, 'timber'),
    // --- East: TELEGRAPH OFFICE and the SAWMILL's open shed, east of the rail line ---
    ...buildingOf(TELEGRAPH, 'clapboard'), // x 35..42, z 2..8
    ...shed(38.5, -17, 7, 6, 3.5),
    box(38.5, 0, -17, 4, 0.9, 1.2, 'timber'), // log on the saw bench
    // --- West: BATHHOUSE next to the gallows (2.5 m alley between them) ---
    ...buildingOf(BATHHOUSE, 'adobe', 'tiles'), // x -42..-35, z -3..5
    // --- Cemetery fence (gaps in the middle of each side) ---
    ...fence(-36, 24, -24, 36, 3),

    // --- Main Street: porches in front of the sheriff and the bank ---
    ...porch(-6.4, 10, 18, -7.2, 2.6),
    ...porch(8.4, 10, 18, 9.2, 2.6),
    // A broken stagecoach in the north half (under the floating platforms)
    box(1.5, 0, -19, 2.2, 2.2, 4.5, 'boards'),
    // The town WELL in the square: a stone ring, two posts and a little roof
    box(2, 0, 0, 2, 1, 2, 'stone'),
    box(1.2, 1, 0, 0.2, 1.6, 0.2, 'timber'),
    box(2.8, 1, 0, 0.2, 1.6, 0.2, 'timber'),
    box(2, 2.6, 0, 2.4, 0.2, 2.4, 'roof'),
    // Troughs and crates: low cover along Main Street
    box(-5, 0, -3, 3, 0.8, 1, 'planks'),
    box(8.5, 0, 4, 1, 0.8, 3, 'planks'),
    box(-6.5, 0, 28, 1.2, 1.2, 1.2, 'crate'),
    box(-6.8, 0, 29.3, 1, 1, 1, 'crate'),
    box(6, 0, 31, 1.2, 1.2, 1.2, 'crate'),
    // East side, between the church and the rail line: crate piles
    box(25, 0, -16, 1.2, 1.2, 1.2, 'crate'),
    box(25, 0, -17.2, 1.2, 2.2, 1.2, 'crate'),
    box(36, 0, 12, 2, 1, 2, 'crate'),
    box(37, 0, -10, 1.2, 1.2, 1.2, 'crate'),
  ],
};
