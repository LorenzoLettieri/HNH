// "Town": a western ghost town sunk into hell. Greybox stage: the shapes and
// routes are what matters here; looks will come later.
//
// Coordinates: X = east(+)/west(-), Z = south(+)/north(-), Y = up. Meters.
// The player spawns at the south end of Main Street, looking north.
//
//                               N (z = -46)
//   ┌───────────────── canyon cliffs all around ─────────────────┐
//   │                     ▓ bell tower (22 m)                     │
//   │   ◘ water   ┌SALOON┐  ▫ ▫ ▫  ┌CHURCH┐          ▭ wagon     │
//   │     tower   └──────┘ floating └──────┘                      │
//   │  gallows ═══════════ Cross Street ═══════════   ▭ wagon     │
//   │             ┌SHERIFF┐  ▫ ▫ ▫  ┌BANK┐                         │
//   │   † cemetery └──────┘ floating └────┘                        │
//   │              ■ tower ═══ bridge (14 m) ═══ ■ tower          │
//   │                         spawn ↑                             │
//   └─────────────────────────────────────────────────────────────┘
//                               S (z = +46)
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

  // Signs on the sidewalks (board hangs toward +X, or -X with rotation 180).
  { type: 'sign', x: -5.6, y: 0, z: -21, rotation: 0, text: 'SALOON' },
  { type: 'sign', x: -5.6, y: 0, z: 11, rotation: 0, text: 'SHERIFF' },
  { type: 'sign', x: 5.6, y: 0, z: 11, rotation: 180, text: 'BANK' },
  { type: 'sign', x: 5.6, y: 0, z: -8, rotation: 180, text: 'CHURCH' },

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
  // Steel practice targets. `rotation` = where the plate faces (same as ?look=):
  // 0 = north, 90 = west, 180 = south, -90 = east. Some are on the rooftops,
  // to give a reason to climb.
  // Where the ghouls crawl in from: the corners and sides of the canyon.
  enemySpawns: [
    { x: -36, y: 0, z: -36 },
    { x: 36, y: 0, z: -36 },
    { x: -36, y: 0, z: 36 },
    { x: 36, y: 0, z: 36 },
    { x: 0, y: 0, z: -38 },
    { x: -38, y: 0, z: 8 },
    { x: 38, y: 0, z: 18 },
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
  ],
};
