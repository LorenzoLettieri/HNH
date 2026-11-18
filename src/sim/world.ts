// The level as pure data: a list of solid boxes. Both the simulation
// (for collisions) and the renderer (to draw them) read the same list,
// so what you see is exactly what you collide with.

/**
 * Axis-Aligned Bounding Box: a box whose faces are parallel to the X/Y/Z axes
 * (it can't be rotated). Described by its min and max corners.
 */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** How the renderer should draw it. The simulation ignores this. */
  look: 'dirt' | 'wood';
}

export interface World {
  boxes: Box[];
  /** Where the player (re)appears, feet position. */
  spawn: { x: number; y: number; z: number };
}

/** Helper: builds a box from where it sits (center X/Z, bottom Y) and its size. */
export function box(
  x: number,
  bottomY: number,
  z: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  look: Box['look'],
): Box {
  return {
    minX: x - sizeX / 2,
    maxX: x + sizeX / 2,
    minY: bottomY,
    maxY: bottomY + sizeY,
    minZ: z - sizeZ / 2,
    maxZ: z + sizeZ / 2,
    look,
  };
}

/** Temporary test level (step 9 will move levels to their own files). */
export function createTestWorld(): World {
  return {
    spawn: { x: 0, y: 0, z: 5 },
    boxes: [
      // Floor: a thick slab whose top surface is at y = 0. It has edges now:
      // walk off and you fall (and respawn).
      box(0, -1, 0, 60, 1, 60, 'dirt'),
      // Crates (1 m): you can jump on them (jump height ≈ 1.2 m).
      box(0, 0, 0, 1, 1, 1, 'wood'),
      box(-6, 0, -4, 1, 1, 1, 'wood'),
      box(5, 0, -8, 1, 1, 1, 'wood'),
      box(8, 0, 3, 1, 1, 1, 'wood'),
      box(-4, 0, 7, 1, 1, 1, 'wood'),
      // A crate stacked on another: a 2 m step, too high for a single jump.
      box(-6, 1, -4, 1, 1, 1, 'wood'),
      // A long low wall to slide along.
      box(3, 0, -3, 6, 1.5, 0.5, 'wood'),
    ],
  };
}
