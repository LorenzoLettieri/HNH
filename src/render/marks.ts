// Card "Marchio" on screen: a red sigil floating above every marked enemy
// (Entity.marked in the simulation), so you know which one to hit next.
// A sprite = a quad that always faces the camera; its texture is drawn here
// pixel by pixel on a tiny canvas, like the other pixel-art sprites.
import * as THREE from 'three';
import { hitBox, isAlive, type Entity } from '../sim/entities';
import { addSpecimen } from './warmUp';

/** Size of the sigil in the world (meters), how high above the hitbox, how fast it pulses. */
const SIZE = 0.45;
const LIFT = 0.35;
const PULSE_HZ = 3;

/** The sigil: a red diamond with a dark core and a cross, 9×9 pixels. */
function drawSigil(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 9;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const d = Math.abs(x - 4) + Math.abs(y - 4); // "Manhattan" distance: a diamond
      if (d > 4) continue;
      g.fillStyle = d === 4 ? '#ff3a20' : d >= 3 ? '#b01810' : x === 4 || y === 4 ? '#ffb040' : '#400804';
      g.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; // pixel art: no blur
  texture.minFilter = THREE.NearestFilter;
  return texture;
}

export function createMarks(scene: THREE.Scene) {
  const material = new THREE.SpriteMaterial({ map: drawSigil(), transparent: true, fog: false, depthTest: false });
  /** One sprite per marked enemy, by entity id. */
  const sprites = new Map<number, THREE.Sprite>();
  let time = 0;
  // One hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => scene.add(new THREE.Sprite(material)));
  return {
    update(entities: Entity[], alpha: number, dt: number): void {
      time += dt;
      const seen = new Set<number>();
      for (const e of entities) {
        if (!e.marked || !isAlive(e)) continue;
        seen.add(e.id);
        let s = sprites.get(e.id);
        if (!s) {
          s = new THREE.Sprite(material);
          s.renderOrder = 10; // on top (depthTest off): visible behind other enemies too
          scene.add(s);
          sprites.set(e.id, s);
        }
        // The hitbox moves with the entity: interpolate between the last two ticks like the sprites do.
        const b = hitBox(e);
        const ix = e.px + (e.x - e.px) * alpha;
        const iy = e.py + (e.y - e.py) * alpha;
        const iz = e.pz + (e.z - e.pz) * alpha;
        s.position.set(ix + (b.minX + b.maxX) / 2 - e.x, iy + b.maxY - e.y + LIFT, iz + (b.minZ + b.maxZ) / 2 - e.z);
        s.scale.setScalar(SIZE * (1 + 0.12 * Math.sin(time * PULSE_HZ * Math.PI * 2)));
      }
      for (const [id, s] of sprites) {
        if (seen.has(id)) continue;
        scene.remove(s);
        sprites.delete(id);
      }
    },
  };
}
