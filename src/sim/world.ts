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
  /**
   * How the renderer should draw it. The simulation ignores this.
   * No look = invisible collider (e.g. the collision box of a prop).
   */
  look?: 'dirt' | 'wood' | 'stone';
}

/**
 * A decoration placed in the level. The renderer decides how it looks
 * (src/render/props/); the simulation only cares about its collision box
 * (src/sim/props.ts).
 */
export type Prop =
  | { type: 'barrel'; x: number; y: number; z: number; rotation?: number }
  | { type: 'sign'; x: number; y: number; z: number; rotation?: number; text: string }
  | { type: 'torch'; x: number; y: number; z: number }
  /** mount 'wall': (x, y, z) is the point on the wall where the bracket is fixed. */
  | { type: 'lantern'; x: number; y: number; z: number; rotation?: number; mount: 'wall' | 'ground' }
  /** A patch of grass tufts scattered in a circle (purely visual). */
  | { type: 'grass'; x: number; z: number; radius: number; count: number };

export interface World {
  boxes: Box[];
  props: Prop[];
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
  look?: Box['look'],
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
