// Test arena: a 40 × 40 m walled yard to try out movement.
// Coordinates: X = east(+)/west(-), Z = south(+)/north(-), Y = up. Meters.
// Player spawns at the south side, looking north.
//
//                         N (z = -20)
//   ┌──────────────────────────────────────────────┐
//   │                 crates                        │
//   │  ║ ║           ┌──────┐                ┌──┐   │
//   │  ║ ║ corridor  │ 2 m  │                │3m│   │  high walkway
//   │  ║ ║           │plat. │                │  │   │
//   │  ║ ║           └──────┘                ├──┤   │
//   │                  step                  stairs │
//   │       ▪   ▪            ▪   ▪                  │  pillars
//   │                   spawn                       │
//   └──────────────────────────────────────────────┘
//                         S (z = +20)
import { box, type Prop, type World } from '../sim/world';
import { propColliders } from '../sim/props';

const WALL_HEIGHT = 6;

// --- Decorations -------------------------------------------------------------
// Rotation in degrees around the vertical axis. For wall lanterns, rotation 0
// means the bracket sticks out toward +Z (south); 90 = toward +X (east).
const props: Prop[] = [
  // Wall lanterns on the south face of the outer pillars, facing the spawn.
  { type: 'lantern', mount: 'wall', x: -8, y: 2.6, z: 10.5, rotation: 0 },
  { type: 'lantern', mount: 'wall', x: 8, y: 2.6, z: 10.5, rotation: 0 },
  // Inside the corridor, on its east wall, sticking out toward the west.
  { type: 'lantern', mount: 'wall', x: -12.5, y: 2.3, z: -2, rotation: -90 },
  // On the front of the SALOON sign's post, to light up the board at night.
  { type: 'lantern', mount: 'wall', x: -6, y: 1.9, z: 14.57, rotation: 0 },
  // On top of the crate pile.
  { type: 'lantern', mount: 'ground', x: 6.5, y: 2, z: -14, rotation: 30 },

  // Torches flanking the step to the central platform, and one on the walkway.
  { type: 'torch', x: -1.7, y: 0, z: -2.3 },
  { type: 'torch', x: 1.7, y: 0, z: -2.3 },
  { type: 'torch', x: 14, y: 3, z: -7 },
  { type: 'torch', x: 9, y: 0, z: -12 },

  // Barrels: a cluster by the crates, a few by the corridor, one near spawn.
  { type: 'barrel', x: 4.3, y: 0, z: -15.2, rotation: 10 },
  { type: 'barrel', x: 3.4, y: 0, z: -16.1, rotation: 70 },
  { type: 'barrel', x: 4.5, y: 0, z: -16.5, rotation: 140 },
  { type: 'barrel', x: -10.5, y: 0, z: 6.5, rotation: 0 },
  { type: 'barrel', x: -10.6, y: 0, z: 7.5, rotation: 200 },
  { type: 'barrel', x: 3, y: 0, z: 17.5, rotation: 45 },

  // Signs facing the spawn (the board hangs toward +X from the post).
  { type: 'sign', x: -6, y: 0, z: 14.5, rotation: 0, text: 'SALOON' },
  { type: 'sign', x: 15, y: 0, z: 12, rotation: -30, text: 'HIGH NOON HELL' },

  // Dry grass, mostly along the walls where wind piles it up.
  { type: 'grass', x: -16, z: 16, radius: 4, count: 40 },
  { type: 'grass', x: 16, z: 17, radius: 3, count: 25 },
  { type: 'grass', x: -17, z: -16, radius: 3.5, count: 30 },
  { type: 'grass', x: 0, z: -18, radius: 3, count: 20 },
  { type: 'grass', x: -6, z: 4, radius: 2.5, count: 18 },
  { type: 'grass', x: 9, z: 6, radius: 2, count: 12 },
  { type: 'grass', x: 0, z: 12, radius: 6, count: 25 },
];

export const testArena: World = {
  spawn: { x: 0, y: 0, z: 16 },
  props,
  boxes: [
    // Invisible collision boxes of the props (barrels, posts, ...).
    ...props.flatMap(propColliders),

    // --- Floor: 40 × 40, top surface at y = 0 ---
    box(0, -1, 0, 40, 1, 40, 'dirt'),

    // --- Perimeter walls: 1 m thick so you can't tunnel through them ---
    box(0, 0, -20.5, 42, WALL_HEIGHT, 1, 'stone'), // north
    box(0, 0, 20.5, 42, WALL_HEIGHT, 1, 'stone'), // south
    box(20.5, 0, 0, 1, WALL_HEIGHT, 40, 'stone'), // east
    box(-20.5, 0, 0, 1, WALL_HEIGHT, 40, 'stone'), // west

    // --- Central platform (2 m high) with a 1 m step in front ---
    // Two jumps: step, then platform.
    box(0, 0, -6, 6, 2, 6, 'stone'),
    box(0, 0, -2.5, 2, 1, 1, 'wood'),

    // --- East: stairs (1, 2, 3 m) leading to a long 3 m high walkway ---
    // Walk off its edges to try coyote time.
    box(14, 0, 8, 4, 1, 2, 'wood'),
    box(14, 0, 6, 4, 2, 2, 'wood'),
    box(14, 0, 4, 4, 3, 2, 'wood'),
    box(14, 0, -3, 4, 3, 12, 'stone'),

    // --- West: a 3 m wide corridor between two walls ---
    box(-12, 0, -2, 1, 3, 16, 'stone'),
    box(-16, 0, -2, 1, 3, 16, 'stone'),

    // --- East-center: a low gate (beam at 1.1 m). Standing (1.8 m) you
    //     can't pass: crouch or slide under it. ---
    box(8.25, 0, 0, 0.5, 1.7, 0.5, 'wood'),
    box(11.75, 0, 0, 0.5, 1.7, 0.5, 'wood'),
    box(10, 1.1, 0, 4, 0.6, 0.5, 'wood'),

    // --- South: pillars (wall jump practice: jump between them) ---
    box(-8, 0, 10, 1, 5, 1, 'stone'),
    box(-4, 0, 10, 1, 5, 1, 'stone'),
    box(4, 0, 10, 1, 5, 1, 'stone'),
    box(8, 0, 10, 1, 5, 1, 'stone'),

    // --- North: a small pile of crates ---
    box(6, 0, -14, 1, 1, 1, 'wood'),
    box(7, 0, -14, 1, 1, 1, 'wood'),
    box(6.5, 1, -14, 1, 1, 1, 'wood'),
    box(-6, 0, -15, 1.5, 1.5, 1.5, 'wood'),
  ],
};
