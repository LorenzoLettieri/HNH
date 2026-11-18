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
import { box, type World } from '../sim/world';

const WALL_HEIGHT = 6;

export const testArena: World = {
  spawn: { x: 0, y: 0, z: 16 },
  boxes: [
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

    // --- South: pillars (future wall jump practice) ---
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

  // Lanterns hang just outside a surface (a few cm), never inside a box.
  lanterns: [
    { x: -8, y: 2.6, z: 10.7 }, // on the south face of the west pillars
    { x: 8, y: 2.6, z: 10.7 }, // ... and of the east pillars
    { x: 0, y: 2.7, z: -2.8 }, // above the step, in front of the platform
    { x: -14, y: 2.4, z: -2 }, // middle of the corridor
    { x: 14, y: 4.4, z: -3 }, // on the high walkway
    { x: 6.5, y: 2.6, z: -13.3 }, // by the crate pile
  ],
};
