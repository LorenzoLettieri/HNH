// Level data types and helpers. A level is pure data: a list of solid boxes.
// Both the simulation (for collisions) and the renderer (to draw them) read
// the same list, so what you see is exactly what you collide with.
// The actual levels live in src/levels/.

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
  look: 'dirt' | 'wood' | 'stone';
}

/** A light source placed in the level. Visual only: the simulation ignores it. */
export interface Lantern {
  x: number;
  y: number;
  z: number;
}

export interface World {
  boxes: Box[];
  lanterns: Lantern[];
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
