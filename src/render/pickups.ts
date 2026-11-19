// Draws the pickups on the ground. GREYBOX for now (like the first hound):
// a colored box per kind, floating and spinning so it reads as "collectable",
// blinking in the last seconds before it vanishes. The real pixel-art
// sprites and the pickup sound come in a later step.
import * as THREE from 'three';
import type { Pickup, PickupKind } from '../sim/pickups';
import { TICK_DT } from '../sim/config';

/** Box size, meters. */
const SIZE = 0.35;
/** Height of the float above the floor, and how much it bobs up and down. */
const HOVER = 0.35;
const BOB = 0.08;
/** Spin speed, radians per second. */
const SPIN = 2;
/** Seconds before vanishing in which it blinks (the warning: hurry up). */
const BLINK_TIME = 3;
/** Colors: ammo = brass, medkit = bright red. Emissive so they stand out in the dark. */
const COLORS: Record<PickupKind, number> = { ammo: 0xd8a040, medkit: 0xe02020 };

export interface PickupRenderer {
  update(pickups: Pickup[], time: number): void;
}

export function createPickupRenderer(scene: THREE.Scene): PickupRenderer {
  const geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const materials = {} as Record<PickupKind, THREE.MeshBasicMaterial>;
  for (const kind of Object.keys(COLORS) as PickupKind[]) {
    // MeshBasicMaterial ignores lights: always fully lit, visible even at night.
    materials[kind] = new THREE.MeshBasicMaterial({ color: COLORS[kind] });
  }
  // One mesh per pickup id (same pattern as the enemies): create the new ones,
  // remove the ones no longer in the list.
  const meshes = new Map<number, THREE.Mesh>();

  return {
    update(pickups, time) {
      const alive = new Set<number>();
      for (const d of pickups) {
        alive.add(d.id);
        let mesh = meshes.get(d.id);
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, materials[d.kind]);
          scene.add(mesh);
          meshes.set(d.id, mesh);
        }
        // The phase is offset by the id, so two drops side by side don't move in sync.
        mesh.position.set(d.x, d.y + HOVER + Math.sin(time * 3 + d.id) * BOB, d.z);
        mesh.rotation.y = time * SPIN + d.id;
        // Blinking: on/off 8 times a second in the last BLINK_TIME seconds.
        const secondsLeft = d.ticksLeft * TICK_DT;
        mesh.visible = secondsLeft > BLINK_TIME || Math.floor(time * 8) % 2 === 0;
      }
      for (const [id, mesh] of meshes) {
        if (alive.has(id)) continue;
        scene.remove(mesh);
        meshes.delete(id);
      }
    },
  };
}
