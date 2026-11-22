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
  look?:
    // Ground: bare dirt; and for the ground patches (World.ground) packed road,
    // flagstones, a railway track.
    | 'dirt'
    | 'road'
    | 'paving'
    | 'railway'
    // Walls: painted clapboard (bone white, barn red, mustard), raw vertical boards,
    // adobe, grey stone, brick, corrugated tin.
    | 'clapboard'
    | 'clapboardRed'
    | 'clapboardOchre'
    | 'boards'
    | 'adobe'
    | 'stone'
    | 'brick'
    | 'tin'
    // Wood: floors and decks, posts and beams, crates.
    | 'planks'
    | 'timber'
    | 'crate'
    // Roof slabs (the top differs, the edges and the underside are boards):
    // wood shingles, corrugated tin, clay tiles.
    | 'roof'
    | 'tinRoof'
    | 'tiles'
    // Riveted iron (towers, floating platforms) and the canyon's rock.
    | 'metal'
    | 'rock';
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
  /**
   * Steam vent (jump pad): stepping on it launches you up at `up` m/s, plus an
   * optional horizontal push (pushX, pushZ m/s) to aim you at a ledge.
   * Flush with the ground: no collision box, only a launch zone.
   */
  | { type: 'vent'; x: number; y: number; z: number; up: number; pushX?: number; pushZ?: number }
  /** A patch of grass tufts scattered in a circle (purely visual). */
  | { type: 'grass'; x: number; z: number; radius: number; count: number };

/** A practice target placed in the level (it becomes an entity at game start). */
/** A point where enemies of the waves can appear (feet position). */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
}

export interface TargetSpawn {
  x: number;
  y: number;
  z: number;
  /**
   * Direction the plate's front faces, degrees, same convention as the
   * player's look (?look=): 0 = north (-Z), 90 = west, 180 = south, -90 = east.
   */
  rotation: number;
}

/**
 * A shop: where the vendor stands (feet position). Enemies ignore him: he's
 * not an entity, just a place in the level. `kind` = what he sells.
 */
export interface ShopSpawn {
  x: number;
  y: number;
  z: number;
  /** 'weapons' = the armory (a vendor sells guns and cards); 'forge' = the Forge (Damned Iron → a reinforced gun, forge.ts). */
  kind: 'weapons' | 'forge';
}

/** Which way a wall faces: north = -Z, south = +Z, east = +X, west = -X. */
export type Facing = 'north' | 'south' | 'east' | 'west';

/**
 * The pictures that can go on a wall (how each is drawn: src/render/decals.ts).
 * Doors and windows in three states (dark, lit from inside, boarded or broken),
 * barred windows, closed shutters, and two FRAMES with an empty middle, to put
 * around a real opening in a wall.
 */
export type DecalLook =
  | 'door'
  | 'doorPlain'
  | 'doorLit'
  | 'doorGate'
  | 'doorway'
  | 'doorFrame'
  | 'windowFrame'
  | 'window'
  | 'windowLit'
  | 'windowBoarded'
  | 'windowTall'
  | 'windowTallLit'
  | 'windowTallBroken'
  | 'windowArched'
  | 'windowArchedLit'
  | 'windowArchedBroken'
  | 'windowRound'
  | 'windowRoundLit'
  | 'windowRoundBoarded'
  | 'windowBars'
  | 'windowBarsLit'
  | 'shutters';

/**
 * A picture on a wall: a door, a window, a frame. PURELY VISUAL: the simulation
 * ignores it (a painted door doesn't open, a painted window isn't a hole). That's
 * the cheap trick of old shooters: the buildings are solid blocks, the windows
 * make them read as houses. The real openings are cut in the boxes (wallZ/wallX
 * in the levels); a frame decal around them makes them read as doors and windows.
 */
export interface Decal {
  /** Center of the picture, ON the wall's surface. */
  x: number;
  y: number;
  z: number;
  /** Which way the wall faces (the picture looks out of it). */
  facing: Facing;
  width: number;
  height: number;
  look: DecalLook;
}

/**
 * A patch of ground with its own look (a street, a square, a boardwalk, rails),
 * painted flat ON the ground (y = 0). Purely visual, like the decals: the ground
 * under it is still the one big ground box. Patches must not overlap each other.
 */
export interface GroundPatch {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  look: NonNullable<Box['look']>;
}

export interface World {
  boxes: Box[];
  props: Prop[];
  /** Streets, squares, boardwalks, rails painted on the ground (only drawn). */
  ground?: GroundPatch[];
  /** Doors and windows on the walls (only drawn). Optional: the test arena has none. */
  decals?: Decal[];
  /** Practice targets. Optional: not every level has them. */
  targets?: TargetSpawn[];
  /** Where enemies come into the level from. */
  enemySpawns?: SpawnPoint[];
  /** The shops' vendors. Optional: the test arena has none. */
  shops?: ShopSpawn[];
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
