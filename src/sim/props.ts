// Collision for props. A prop is drawn with a detailed model, but collides
// as one or more simple invisible boxes: cheap, predictable, and exactly the
// same on a future server (which will never load the 3D models).
import { box, type Box, type Prop } from './world';

export function propColliders(p: Prop): Box[] {
  switch (p.type) {
    case 'barrel':
      return [box(p.x, p.y, p.z, 0.7, 1, 0.7)];
    case 'sign':
      // Only the post: the hanging board is above head height.
      return [box(p.x, p.y, p.z, 0.16, 2.8, 0.16)];
    case 'torch':
      return [box(p.x, p.y, p.z, 0.2, 1.6, 0.2)];
    case 'forge':
      return [
        box(p.x, p.y, p.z, FORGE_SIZE, FORGE_HEIGHT, FORGE_SIZE), // the brick hearth
        // The hood hanging over it: you can't stand on the hearth with your
        // head in it, and it stops bullets like the iron it is.
        box(p.x, p.y + FORGE_HOOD_BOTTOM, p.z, FORGE_SIZE - 0.2, FORGE_HOOD_HEIGHT, FORGE_SIZE - 0.2),
      ];
    case 'anvil':
      return [box(p.x, p.y, p.z, 1, ANVIL_HEIGHT, 0.6)];
    case 'lantern':
    case 'vent':
    case 'grass':
      return []; // too small or too soft to block anyone
  }
}

// Measures shared with the models in src/render/props/ (like VENT_RADIUS):
// what you see and what you bump into must match.
/** Side of the forge's square hearth, meters. */
export const FORGE_SIZE = 2;
/** Height of the hearth, rim included: the coals sit just below it. */
export const FORGE_HEIGHT = 1.1;
/** Bottom of the iron hood above the hearth. */
export const FORGE_HOOD_BOTTOM = 1.9;
export const FORGE_HOOD_HEIGHT = 0.7;
/** Top of the anvil's face (stump included). */
export const ANVIL_HEIGHT = 0.8;

/** Radius of a steam vent's launch zone, meters. */
export const VENT_RADIUS = 0.8;

/** The vent the player is standing on, if any. */
export function ventUnder(
  props: Prop[],
  x: number,
  y: number,
  z: number,
): Extract<Prop, { type: 'vent' }> | null {
  for (const p of props) {
    if (p.type !== 'vent') continue;
    const onTop = Math.abs(y - p.y) < 0.1;
    if (onTop && Math.hypot(x - p.x, z - p.z) < VENT_RADIUS) return p;
  }
  return null;
}
