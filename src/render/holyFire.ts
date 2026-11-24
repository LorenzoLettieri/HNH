// Draws the pools of holy fire (sim/holyFire.ts). PLACEHOLDER for now: a
// flat blue disc on the floor that pulses and fades out at the end. The real
// blue flames, the light and the sound come in the next step.
import * as THREE from 'three';
import type { HolyFire } from '../sim/holyFire';

/** Lifted over the floor: two surfaces on the same plane flicker (z-fighting; see materials.ts). */
const LIFT = 0.03;
const COLOR = 0x3a7dff;
/** HDR glow (above 1 it blooms). */
const GLOW = 2.2;

export interface HolyFireRenderer {
  update(fires: HolyFire[], time: number): void;
}

export function createHolyFireRenderer(scene: THREE.Scene): HolyFireRenderer {
  const disc = new THREE.CircleGeometry(1, 24);
  disc.rotateX(-Math.PI / 2); // lying on the floor
  const views = new Map<number, { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }>();
  return {
    update(fires, time) {
      const alive = new Set<number>();
      for (const f of fires) {
        alive.add(f.id);
        let v = views.get(f.id);
        if (!v) {
          const material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(COLOR).multiplyScalar(GLOW),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(disc, material);
          mesh.position.set(f.x, f.y + LIFT, f.z);
          mesh.scale.setScalar(f.radius);
          scene.add(mesh);
          v = { mesh, material };
          views.set(f.id, v);
        }
        // Pulses, and fades out in its last second.
        const fade = Math.min(1, f.ticksLeft / 60);
        v.material.opacity = (0.35 + 0.15 * Math.sin(time * 9 + f.id)) * fade;
      }
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.mesh);
        v.material.dispose();
        views.delete(id);
      }
    },
  };
}
