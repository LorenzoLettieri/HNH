// Burning enemies on screen: a burning enemy throws flames upward while its
// fire lasts (burnTicks in the simulation, see status.ts). Two fires:
// - the card "Fiato di drago": orange puffs;
// - the HOLY fire (the Forge's dynamite, burnHoly): pale blue tongues, and a
//   bright hiss the moment it catches (like water on a hot stove).
// Pure decoration: it reads the state, never changes it.
import * as THREE from 'three';
import { hitBox, type Entity } from '../sim/entities';
import { playHolyIgnite } from '../audio/sfx';
import { spawnHolyFlame, spawnSnort } from './particles';
import { soundAt } from './soundPosition';

/** Puffs per second on each burning enemy, and how many particles per puff. */
const PUFFS_PER_SECOND = 14;
const PARTICLES_PER_PUFF = 2;
/** The holy fire: more, smaller tongues (it should look like it's eating the body). */
const HOLY_PUFFS_PER_SECOND = 22;

const point = new THREE.Vector3();
const up = new THREE.Vector3();
/** Fractional puffs carried over between frames, per entity id (so the rate doesn't depend on the FPS). */
const owed = new Map<number, number>();
/** Which enemies were burning holy last frame (to hear the moment they catch). */
const holyLastFrame = new Set<number>();

export function updateBurning(entities: Entity[], dt: number, camera: THREE.Camera): void {
  for (const e of entities) {
    const holy = !!e.burnTicks && !!e.burnHoly;
    if (holy && !holyLastFrame.has(e.id)) playHolyIgnite(soundAt(camera, e.x, e.y + 1, e.z));
    if (holy) holyLastFrame.add(e.id);
    else holyLastFrame.delete(e.id);
    if (!e.burnTicks) {
      owed.delete(e.id);
      continue;
    }
    let n = (owed.get(e.id) ?? 0) + (holy ? HOLY_PUFFS_PER_SECOND : PUFFS_PER_SECOND) * dt;
    const b = hitBox(e);
    while (n >= 1) {
      n--;
      // Somewhere on the body, flames rising (a little sideways at random).
      point.set(
        b.minX + Math.random() * (b.maxX - b.minX),
        b.minY + Math.random() * (b.maxY - b.minY) * 0.8,
        b.minZ + Math.random() * (b.maxZ - b.minZ),
      );
      up.set((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6).normalize();
      if (holy) spawnHolyFlame(point, up, PARTICLES_PER_PUFF);
      else spawnSnort(point, up, PARTICLES_PER_PUFF);
    }
    owed.set(e.id, n);
  }
}
