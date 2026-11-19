// "Town": a western ghost town sunk into hell. Greybox stage: the shapes and
// routes are what matters here; looks will come later.
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
//   (7.8) → drop onto the warehouse (6.3).
// - ARMORY (the weapon shop, upstairs in the gunsmith, floor at 4.3 m): no
//   stairs, you have to get there. Easiest: crate steps → warehouse roof →
//   jump west across the gap onto the gunsmith's balcony → door. Or drop
//   from the gunsmith's roof onto the balcony (from the bank or the east
//   tower), or wall-jump up to the west window.
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
import { box, type Box, type Prop, type World } from '../sim/world';
import { propColliders } from '../sim/props';

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

// --- A building: solid block + a roof slab slightly wider (eaves) -----------------
function building(
  x: number,
  z: number,
  sizeX: number,
  height: number,
  sizeZ: number,
  look: Box['look'],
): Box[] {
  return [
    box(x, 0, z, sizeX, height, sizeZ, look),
    box(x, height, z, sizeX + 0.6, 0.3, sizeZ + 0.6, 'roof'),
  ];
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
  for (let z = z1; z <= z2 + 0.01; z += (z2 - z1) / 3) out.push(box(x, 0, z, 0.25, height, 0.25, 'wood'));
  out.push(box(awningX, height, (z1 + z2) / 2, Math.abs(awningX - x) * 2 + 0.5, 0.2, z2 - z1 + 1, 'planks'));
  return out;
}

/** An open shed: four posts and a roof. Shade from the eye-bats, but the ghouls walk right in. */
function shed(x: number, z: number, sizeX: number, sizeZ: number, height: number): Box[] {
  const hx = sizeX / 2 - 0.2;
  const hz = sizeZ / 2 - 0.2;
  return [
    box(x - hx, 0, z - hz, 0.4, height, 0.4, 'wood'),
    box(x + hx, 0, z - hz, 0.4, height, 0.4, 'wood'),
    box(x - hx, 0, z + hz, 0.4, height, 0.4, 'wood'),
    box(x + hx, 0, z + hz, 0.4, height, 0.4, 'wood'),
    box(x, height, z, sizeX + 0.4, 0.3, sizeZ + 0.4, 'roof'),
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
    box(minX + halfX / 2, 0, minZ, halfX, h, t, 'wood'),
    box(maxX - halfX / 2, 0, minZ, halfX, h, t, 'wood'),
    box(minX + halfX / 2, 0, maxZ, halfX, h, t, 'wood'),
    box(maxX - halfX / 2, 0, maxZ, halfX, h, t, 'wood'),
    box(minX, 0, minZ + halfZ / 2, t, h, halfZ, 'wood'),
    box(minX, 0, maxZ - halfZ / 2, t, h, halfZ, 'wood'),
    box(maxX, 0, minZ + halfZ / 2, t, h, halfZ, 'wood'),
    box(maxX, 0, maxZ - halfZ / 2, t, h, halfZ, 'wood'),
  ];
}

/**
 * A wall along Z (at x, from z1 to z2), `height` tall, with OPENINGS cut in
 * it: doors and windows. A box can't have a hole, so the wall is built from
 * pieces: for each opening, a piece below it (the sill: none for a door) and
 * one above it (the lintel), plus the full-height pieces between openings.
 * openings: [from z, to z, bottom y, top y].
 */
function wallZ(x: number, z1: number, z2: number, height: number, openings: [number, number, number, number][]): Box[] {
  const t = 0.3; // thickness
  const out: Box[] = [];
  let z = z1;
  for (const [a, b, bottom, top] of openings) {
    if (a > z) out.push(box(x, 0, (z + a) / 2, t, height, a - z, 'planks')); // solid piece before
    if (bottom > 0) out.push(box(x, 0, (a + b) / 2, t, bottom, b - a, 'planks')); // sill
    out.push(box(x, top, (a + b) / 2, t, height - top, b - a, 'planks')); // lintel
    z = b;
  }
  if (z2 > z) out.push(box(x, 0, (z + z2) / 2, t, height, z2 - z, 'planks'));
  return out;
}
/** The same, for a wall along X (at z, from x1 to x2). Openings: [from x, to x, bottom y, top y]. */
function wallX(z: number, x1: number, x2: number, height: number, openings: [number, number, number, number][]): Box[] {
  // Build it as a wall along Z, then swap X and Z in every box (a mirror
  // across the diagonal: same shape, rotated 90°).
  return wallZ(z, x1, x2, height, openings).map((b) => ({ ...b, minX: b.minZ, maxX: b.maxZ, minZ: b.minX, maxZ: b.maxX }));
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
  for (let i = 0; i < count; i++) out.push(box(x + dx * i * 1.2, 0, z + dz * i * 1.2, 1.2, step * (i + 1), 1.2, 'wood'));
  return out;
}

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
        out.push(box(x, 0, z, 0.15, 1.4, 0.15, 'wood')); // cross: post...
        out.push(box(x, 0.95, z, 0.7, 0.15, 0.15, 'wood')); // ...and arm
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
  { type: 'lantern', mount: 'ground', x: 18.4, y: 5.3, z: 25, rotation: 0 }, // on the armory's counter, next to the vendor

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
  // The vendors (see ShopSpawn in src/sim/world.ts).
  shops: [
    { x: 17, y: 4.3, z: 24.25, kind: 'weapons' }, // armory: behind the counter, facing the door
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
    ...building(-15, -14, 14, 7, 10, 'planks'),
    box(-7.25, 2.75, -14, 1.5, 0.25, 10, 'planks'), // balcony floor
    box(-6.75, 0, -18.7, 0.3, 2.75, 0.3, 'wood'), // balcony posts
    box(-6.75, 0, -9.3, 0.3, 2.75, 0.3, 'wood'),
    box(-4.8, 0, -8.5, 1, 1, 1, 'wood'), // crate steps up to the balcony
    box(-6, 0, -8.5, 1, 2, 1, 'wood'),
    // A "staircase" of junk piled on the balcony, up to the roof. Steps of
    // 1 m: the max jump height is ~1.17 m, so 1.2 m steps would be too tall!
    // Climb it heading north (you arrive on the balcony from its south end).
    box(-7.25, 3, -15.5, 1.2, 1, 1, 'wood'), // top 4
    box(-7.25, 3, -16.5, 1.2, 2, 1, 'wood'), // top 5
    box(-7.25, 3, -17.5, 1.2, 3, 1, 'wood'), // top 6
    box(-7.25, 3, -18.5, 1.2, 4, 1, 'wood'), // top 7 → jump west onto the roof (7.3)

    // --- WATER TOWER (west of the saloon): tank top at 8 m, 1.5 m from the
    //     saloon roof: a running jump from the roof lands you on it ---
    box(-28.3, 0, -16, 0.5, 4, 0.5, 'wood'),
    box(-24.3, 0, -16, 0.5, 4, 0.5, 'wood'),
    box(-28.3, 0, -12, 0.5, 4, 0.5, 'wood'),
    box(-24.3, 0, -12, 0.5, 4, 0.5, 'wood'),
    box(-26.3, 4, -14, 5, 4, 5, 'planks'),

    // --- CHURCH (NE): roof 9.3 m ---
    ...building(17, -16, 10, 9, 14, 'stone'),
    // Bell tower against the church's north side, 22 m (reached with the
    // steam vent on the church roof).
    box(17, 0, -25.5, 5, 22, 5, 'stone'),
    // Belfry on top: four tall corner posts, a roof high enough not to bump
    // your head when the vent launches you, and the bell (you can walk under it).
    box(14.8, 22, -27.7, 0.4, 4, 0.4, 'wood'),
    box(19.2, 22, -27.7, 0.4, 4, 0.4, 'wood'),
    box(14.8, 22, -23.3, 0.4, 4, 0.4, 'wood'),
    box(19.2, 22, -23.3, 0.4, 4, 0.4, 'wood'),
    box(17, 26, -25.5, 5.4, 0.4, 5.4, 'roof'),
    box(17, 24.4, -25.5, 1, 1.2, 1, 'metal'), // the bell

    // --- Floating platforms over Main Street: saloon roof → church roof ---
    box(-3, 7.6, -14, 3, 0.4, 3, 'metal'), // top 8.0
    box(3, 8.2, -14, 3, 0.4, 3, 'metal'), // top 8.6
    box(8.5, 8.6, -14, 3, 0.4, 3, 'metal'), // top 9.0

    // --- SHERIFF (SW): roof 5.3 m ---
    ...building(-14, 14, 12, 5, 9, 'stone'),

    // --- BANK (SE): roof 8.3 m ---
    ...building(15, 14, 10, 8, 10, 'brick'),

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
    box(-26.9, 0, 0, 1.2, 1, 1.2, 'wood'), // step
    box(-31.5, 2, 0, 0.3, 3.5, 0.3, 'wood'),
    box(-28.5, 2, 0, 0.3, 3.5, 0.3, 'wood'),
    box(-30, 5.5, 0, 3.3, 0.3, 0.3, 'wood'),

    // --- CEMETERY (SW corner) ---
    ...cemetery(-30, 30),

    // --- RAILWAY (east side): two abandoned wagons, roofs at 3.2 m ---
    box(30, 0, -8, 3, 3.2, 9, 'planks'),
    box(30, 0, 8, 3, 3.2, 9, 'planks'),
    box(27.6, 0, -3, 1.2, 1.2, 1.2, 'wood'), // crate to climb on the wagons
    // A longer train: the rail line becomes a wall with three narrow
    // crossings (5-7 m) between the wagons. Chokepoints for the horde.
    box(30, 0, -22, 3, 3.2, 9, 'planks'),
    box(30, 0, 22, 3, 3.2, 9, 'planks'),
    box(27.6, 0, 20, 1.2, 1.2, 1.2, 'wood'), // crate to climb on the south wagon

    // ===== CLOSE-QUARTERS PASS: filling the empty quarters with alleys =====
    // --- North: HOTEL (roof 5.3, crate steps on its east side) and UNDERTAKER ---
    ...building(-14, -33, 10, 5, 8, 'brick'), // x -19..-9, z -37..-29
    ...crateSteps(-8, -29.8, 0, -1, 5, 1), // tops 1-5 m, going north → jump west onto the roof (5.3)
    ...building(-33, -29, 8, 4, 7, 'planks'), // x -37..-29, z -32.5..-25.5
    // --- North: STABLE across Main Street from the hotel (Main Street north is 13 m wide) ---
    ...building(8, -35, 8, 6, 8, 'wood'), // x 4..12, z -39..-31
    box(-1, 0, -33, 4, 0.8, 1, 'wood'), // water trough in the middle of the street
    // --- North-east: railway DEPOT against the cliff ---
    ...building(38.5, -30, 7, 5, 10, 'planks'), // x 35..42, z -35..-25

    // --- West: BLACKSMITH's open shed (forge + anvil) and a HOUSE ---
    ...shed(-36.5, -15, 7, 6, 3.5),
    box(-37.5, 0, -15, 2, 1.1, 2, 'stone'), // forge
    box(-34.5, 0, -14, 1, 0.8, 0.6, 'metal'), // anvil
    ...building(-36, 16, 7, 4, 8, 'wood'), // x -39.5..-32.5, z 12..20
    // --- Cross Street west: an abandoned covered wagon in the middle, up on
    //     its wheels: you can SLIDE under it (1.1 m), the ghouls go around ---
    box(-16, 1.1, 3, 4.5, 1.3, 2, 'planks'),
    box(-17.9, 0, 2.1, 0.3, 1.1, 0.3, 'wood'), // wheels
    box(-14.1, 0, 2.1, 0.3, 1.1, 0.3, 'wood'),
    box(-17.9, 0, 3.9, 0.3, 1.1, 0.3, 'wood'),
    box(-14.1, 0, 3.9, 0.3, 1.1, 0.3, 'wood'),

    // ===== TRAVERSAL PASS: rewarding precise movement =====
    // --- High road 1: HOTEL roof (5.3) → two pillars (1×1 m tops!) → UNDERTAKER roof (4.3).
    //     Gaps 2.2-2.7 m: easy with a running jump, but the landings are tiny:
    //     hop from pillar to pillar without stopping. ---
    box(-22, 0, -30.75, 1, 5, 1, 'wood'),
    box(-25.5, 0, -30.75, 1, 4.7, 1, 'wood'),
    // --- High road 2: HOTEL roof (5.3) → two floating platforms (6.0, 6.7) → SALOON roof (7.3),
    //     which joins the old network (floating platforms → church → bell tower) ---
    box(-12, 5.6, -26.5, 2, 0.4, 2, 'metal'),
    box(-12, 6.3, -23, 2, 0.4, 2, 'metal'),
    // --- High road 3: BANK roof (8.3) → GUNSMITH roof (7.8, a 3.9 m running jump)
    //     → WAREHOUSE roof (6.3, a drop: the two roofs touch at their corners) ---

    // --- Slide passage: the middle crossing of the rail line is blocked by a
    //     low coupling deck at 1.1 m. You slide under it; the ghouls (1.8 m)
    //     must use the other crossings. An escape route for good movement. ---
    box(30, 1.1, 0, 3, 0.4, 7, 'metal'),

    // --- GENERAL STORE: a building you can go INSIDE (8 × 7.5 m, roof 4.3).
    //     Doors east and west, windows north and south (sill 0.8 m: jump through;
    //     the opening is 2.2 m tall, so a standing body fits while hopping in).
    //     Indoors the eye-bats can't see you, but the ghouls follow you in:
    //     real close quarters. The roof: wall jumps only. ---
    ...wallZ(-23, 11, 19, 4, [[14, 16.2, 0, 2.6]]), // east wall, door
    ...wallZ(-30.5, 11, 19, 4, [[13.5, 15.7, 0, 2.6]]), // west wall, door
    ...wallX(11, -30.5, -23, 4, [[-28.2, -26.2, 0.8, 3]]), // north wall, window
    ...wallX(19, -30.5, -23, 4, [[-27.7, -25.7, 0.8, 3]]), // south wall, window
    box(-26.75, 4, 15, 8.1, 0.3, 8.6, 'roof'),
    box(-26.5, 0, 17.3, 3, 1, 0.6, 'wood'), // counter
    box(-29.6, 0, 12, 1, 1.8, 1.4, 'wood'), // shelves in the corner
    box(-24, 0, 12, 1, 1, 1, 'wood'), // crates
    box(-24, 1, 12, 0.8, 0.8, 0.8, 'wood'),

    // --- South: a HOUSE west of the towers, a WAREHOUSE east of them ---
    ...building(-16, 34, 7, 4, 6, 'planks'), // x -19.5..-12.5, z 31..37
    ...building(25, 34, 10, 6, 8, 'brick'), // x 20..30, z 30..38
    ...crateSteps(19, 30.4, 0, 1, 6, 1), // tops 1-6 m, going south → jump east onto the roof (6.3)
    // --- South-east: GUNSMITH between the east tower and the warehouse (3 m alley to the tower).
    //     Two storeys: a solid ground floor, and UPSTAIRS the ARMORY, the weapon shop.
    //     No stairs: reaching it takes some parkour (routes at the top of the file). ---
    box(17, 0, 26, 6, 4, 5, 'stone'), // ground floor, x 14..20, z 23.5..28.5
    box(17, 4, 26, 6.6, 0.3, 5.6, 'planks'), // upstairs floor, top 4.3
    // Balcony on the south side, toward the warehouse. It stops 1.2 m short of
    // the warehouse's eave: from that roof you JUMP onto it (and drop 2 m).
    box(16.1, 4, 29.4, 4.8, 0.3, 1.2, 'planks'), // x 13.7..18.5, z 28.8..30
    // Its west end is closed by a wall: if your jump from the warehouse is too
    // long (at full speed it would carry you 10 m!), you slam into it and drop
    // onto the balcony instead of flying into the alley. Forgiving, on purpose.
    box(13.85, 4.3, 29.4, 0.3, 3.2, 1.2, 'planks'),
    // The armory's walls, 3.2 m tall, standing on the upstairs floor.
    ...raise(wallX(28.35, 14, 20, 3.2, [[15.2, 16.8, 0, 2.6]]), 4.3), // south wall, door onto the balcony
    ...raise(wallZ(14.15, 23.5, 28.5, 3.2, [[24.8, 26.8, 0.9, 2.6]]), 4.3), // west wall, window (wall jumpers' way in)
    box(17, 4.3, 23.65, 6, 3.2, 0.3, 'planks'), // north wall: behind the vendor
    box(19.85, 4.3, 26, 0.3, 3.2, 5, 'planks'), // east wall
    box(17, 7.5, 26, 6.6, 0.3, 5.6, 'roof'), // roof, top 7.8
    // Inside: the counter, the vendor behind it (shops, above), a gun rack on the east wall.
    box(17, 4.3, 25, 3.4, 1, 0.6, 'wood'), // counter, z 24.7..25.3
    box(19.4, 4.3, 26.6, 0.6, 1.9, 1.6, 'wood'), // gun rack
    // --- South-east corner: MINE ENTRANCE dug into the canyon wall (a rock outcrop + timber frame) ---
    box(37, 0, 39.5, 9, 5, 5, 'rock'),
    box(34.5, 0, 36.8, 0.4, 3.2, 0.4, 'wood'),
    box(38.5, 0, 36.8, 0.4, 3.2, 0.4, 'wood'),
    box(36.5, 3.2, 36.8, 4.4, 0.4, 0.4, 'wood'),
    // --- East: TELEGRAPH OFFICE and the SAWMILL's open shed, east of the rail line ---
    ...building(38.5, 5, 7, 4, 6, 'planks'), // x 35..42, z 2..8
    ...shed(38.5, -17, 7, 6, 3.5),
    box(38.5, 0, -17, 4, 0.9, 1.2, 'wood'), // log on the saw bench
    // --- West: BATHHOUSE next to the gallows (2.5 m alley between them) ---
    ...building(-38.5, 1, 7, 5, 8, 'stone'), // x -42..-35, z -3..5
    // --- Cemetery fence (gaps in the middle of each side) ---
    ...fence(-36, 24, -24, 36, 3),

    // --- Main Street: porches in front of the sheriff and the bank ---
    ...porch(-6.4, 10, 18, -7.2, 2.6),
    ...porch(8.4, 10, 18, 9.2, 2.6),
    // A broken stagecoach in the north half (under the floating platforms)
    box(1.5, 0, -19, 2.2, 2.2, 4.5, 'wood'),
    // The town WELL in the square: a stone ring, two posts and a little roof
    box(2, 0, 0, 2, 1, 2, 'stone'),
    box(1.2, 1, 0, 0.2, 1.6, 0.2, 'wood'),
    box(2.8, 1, 0, 0.2, 1.6, 0.2, 'wood'),
    box(2, 2.6, 0, 2.4, 0.2, 2.4, 'roof'),
    // Troughs and crates: low cover along Main Street
    box(-5, 0, -3, 3, 0.8, 1, 'wood'),
    box(8.5, 0, 4, 1, 0.8, 3, 'wood'),
    box(-6.5, 0, 28, 1.2, 1.2, 1.2, 'wood'),
    box(-6.8, 0, 29.3, 1, 1, 1, 'wood'),
    box(6, 0, 31, 1.2, 1.2, 1.2, 'wood'),
    // East side, between the church and the rail line: crate piles
    box(25, 0, -16, 1.2, 1.2, 1.2, 'wood'),
    box(25, 0, -17.2, 1.2, 2.2, 1.2, 'wood'),
    box(36, 0, 12, 2, 1, 2, 'wood'),
    box(37, 0, -10, 1.2, 1.2, 1.2, 'wood'),
  ],
};
