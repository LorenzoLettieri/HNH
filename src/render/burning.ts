// Card "Fiato di drago" on screen: a burning enemy throws puffs of fire
// upward while its fire lasts (burnTicks in the simulation, see status.ts).
// Pure decoration: it reads the state, never changes it.
import * as THREE from 'three';
import { hitBox, type Entity } from '../sim/entities';
import { spawnSnort } from './particles';

/** Puffs per second on each burning enemy, and how many particles per puff. */
const PUFFS_PER_SECOND = 14;
const PARTICLES_PER_PUFF = 2;

const point = new THREE.Vector3();
const up = new THREE.Vector3();
/** Fractional puffs carried over between frames, per entity id (so the rate doesn't depend on the FPS). */
const owed = new Map<number, number>();

export function updateBurning(entities: Entity[], dt: number): void {
  for (const e of entities) {
    if (!e.burnTicks) {
      owed.delete(e.id);
      continue;
    }
    let n = (owed.get(e.id) ?? 0) + PUFFS_PER_SECOND * dt;
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
      spawnSnort(point, up, PARTICLES_PER_PUFF);
    }
    owed.set(e.id, n);
  }
}
