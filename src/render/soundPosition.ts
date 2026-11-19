// Where a sound at a world position is heard from the camera: quieter when
// far, panned left/right. Shared by everything that makes positional sounds.
import * as THREE from 'three';
import type { Where } from '../audio/sfx';

const right = new THREE.Vector3();

export function soundAt(camera: THREE.Camera, x: number, y: number, z: number): Where {
  const dx = x - camera.position.x;
  const dy = y - camera.position.y;
  const dz = z - camera.position.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  right.setFromMatrixColumn(camera.matrixWorld, 0); // the camera's "right" direction
  return {
    volume: Math.min(1, 2.5 / (1 + dist * 0.25)),
    pan: (dx * right.x + dy * right.y + dz * right.z) / dist, // dot product: how much "to the right"
  };
}
