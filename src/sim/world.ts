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
  /**
   * A SLOPE (a wedge, half a pitched roof): the top face isn't flat, it climbs
   * toward this direction, from minY on the opposite edge up to maxY on this
   * one (east = +X, west = -X, south = +Z, north = -Z). The solid is the part
   * of the box UNDER that slanted plane: seen from the side, a right triangle.
   * Missing = an ordinary box. Two wedges back to back make a gable roof
   * (`gable` in src/levels/town.ts). The math is in `surfaceAt` below; the
   * collisions in collision.ts, the bullets in raycast.ts.
   */
  rise?: Facing;
  /**
   * A wedge's vertical faces (the gable's triangles) drawn with this look
   * instead of `look`: the wall's material, so the gable reads as the top of
   * the wall and the slopes as the roofing. Only drawn: the simulation ignores it.
   */
  sideLook?: Box['look'];
}

/**
 * How steep a wedge is: meters of height per meter along its slope (the
 * "gradient", the tangent of its angle). 0 for an ordinary box.
 */
export function gradientOf(b: Box): number {
  if (!b.rise) return 0;
  const run = b.rise === 'east' || b.rise === 'west' ? b.maxX - b.minX : b.maxZ - b.minZ;
  return (b.maxY - b.minY) / run;
}

/**
 * The height of a box's top at (x, z): maxY for an ordinary box, the slanted
 * plane for a wedge (a linear function of one coordinate, clamped to the box).
 *
 * With `radius` > 0 it's the top under a square FOOTPRINT (x ± radius, z ± radius),
 * that is the highest point of the plane under it: the footprint's uphill edge.
 * Our bodies are boxes too, so a body on a slope rests on its uphill edge and
 * the downhill one hangs a little above the roof (like the box-shaped players
 * of Quake): `radius × gradient`, a few centimeters.
 */
export function surfaceAt(b: Box, x: number, z: number, radius = 0): number {
  if (!b.rise) return b.maxY;
  let t: number; // 0 at the low edge, 1 at the high edge
  switch (b.rise) {
    case 'east': t = (x + radius - b.minX) / (b.maxX - b.minX); break;
    case 'west': t = (b.maxX - (x - radius)) / (b.maxX - b.minX); break;
    case 'south': t = (z + radius - b.minZ) / (b.maxZ - b.minZ); break;
    case 'north': t = (b.maxZ - (z - radius)) / (b.maxZ - b.minZ); break;
  }
  return b.minY + (b.maxY - b.minY) * Math.min(1, Math.max(0, t));
}

/**
 * The slope under a footprint, as "meters up per meter" along X and Z (the
 * gradient vector, dh/dx and dh/dz). Zero where the footprint's uphill edge
 * is past the high end (it rests on the ridge: flat there). Moving with
 * velocity (vx, vz) on it, you go up at vx·gx + vz·gz m/s.
 */
export function slopeAt(b: Box, x: number, z: number, radius = 0): { gx: number; gz: number } {
  const g = gradientOf(b);
  switch (b.rise) {
    case 'east': return { gx: x + radius < b.maxX ? g : 0, gz: 0 };
    case 'west': return { gx: x - radius > b.minX ? -g : 0, gz: 0 };
    case 'south': return { gx: 0, gz: z + radius < b.maxZ ? g : 0 };
    case 'north': return { gx: 0, gz: z - radius > b.minZ ? -g : 0 };
    default: return { gx: 0, gz: 0 };
  }
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
  /** Blacksmith's hearth: brick forge with glowing coals, an iron hood and a chimney. */
  | { type: 'forge'; x: number; y: number; z: number }
  /** Anvil on a wooden stump, horn toward +X, with a red-hot bar and a hammer on it. */
  | { type: 'anvil'; x: number; y: number; z: number }
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
  /**
   * 'weapons' = the armory (a vendor sells guns and cards); 'forge' = the Forge (Damned Iron → a reinforced gun, forge.ts);
   * 'saloon' = the barman (fiches → drinks, the pacts).
   */
  kind: 'weapons' | 'forge' | 'saloon';
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
  /**
   * Where the bells of the "Campane del Giudizio" map event can hang (bells.ts):
   * points on the roofs, at the surface (the bell hangs from a little frame
   * standing there). Optional: without them that event never shows up.
   */
  bellSpots?: { x: number; y: number; z: number }[];
  /**
   * Where the devil's gambling table appears during the "Scommessa del
   * Diavolo" map event (wager.ts), feet level. Optional: without it that
   * event never shows up.
   */
  wagerTable?: { x: number; y: number; z: number };
  /**
   * The middle of the mouth of the well of the "Pozzo delle Anime" map event
   * (soulWell.ts): where you carry the souls. Optional: without it that event
   * never shows up.
   */
  soulWell?: { x: number; y: number; z: number };
  /**
   * Where the preacher of the "Spettacolo Cruento" map event (sermon.ts)
   * stands, feet level (his soapbox is behind him, drawn only). Optional:
   * without it that event never shows up.
   */
  preacher?: { x: number; y: number; z: number };
  /**
   * The undertaker's coffin (relics.ts): pay, open, a relic comes out. Feet
   * level, in the middle of the coffin (drawn only: nothing to bump into).
   * `rotation` = which way its head points, radians around Y (0 = −Z, north).
   * Optional: without it there's no coffin.
   */
  coffin?: { x: number; y: number; z: number; rotation: number };
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
