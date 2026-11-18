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
    case 'lantern':
    case 'grass':
      return []; // too small or too soft to block anyone
  }
}
