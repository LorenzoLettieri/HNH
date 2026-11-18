// Standing torch: a pole wedged in a pile of rocks, a cloth-wrapped head
// held by an iron cage, and an open flame on top.
import * as THREE from 'three';
import { addHeightFog } from '../heightFog';
import { createFlame, propMaterial, scaleUV, solid, texturedBox, type PropModel } from './common';
import { seededRandom } from './pixelCanvas';
import { clothTexture, ironTexture, postWoodTexture, rockTexture } from './textures';

const POLE_HEIGHT = 1.45;
const HEAD_Y = 1.5; // center of the cloth-wrapped head
const FLAME_WIDTH = 0.42;
const FLAME_HEIGHT = 0.7;

let torchCount = 0;
let rockMaterial: THREE.MeshStandardMaterial | null = null;

export function createTorch(): PropModel {
  const group = new THREE.Group();
  const rand = seededRandom(100 + torchCount++); // each torch gets its own rock pile

  // Rock pile: low-poly "dodecahedrons" (12 faces) with flat shading, so each
  // face is a clear facet. Randomly sized, rotated and squashed.
  if (!rockMaterial) {
    rockMaterial = new THREE.MeshStandardMaterial({
      map: rockTexture(),
      roughness: 1,
      flatShading: true,
    });
    addHeightFog(rockMaterial);
  }
  for (let i = 0; i < 6; i++) {
    const size = 0.08 + rand() * 0.07;
    const rock = solid(new THREE.DodecahedronGeometry(size, 0), rockMaterial);
    const angle = (i / 6) * Math.PI * 2 + rand();
    const dist = 0.1 + rand() * 0.08;
    rock.position.set(Math.cos(angle) * dist, size * 0.5, Math.sin(angle) * dist);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.scale.y = 0.6 + rand() * 0.3;
    group.add(rock);
  }

  // Pole.
  const pole = texturedBox(0.07, POLE_HEIGHT, 0.07, postWoodTexture());
  pole.position.y = POLE_HEIGHT / 2;
  group.add(pole);

  // Cloth-wrapped head: a tapered 6-sided cylinder.
  const head = solid(
    scaleUV(new THREE.CylinderGeometry(0.075, 0.05, 0.2, 6), 2, 1),
    propMaterial(clothTexture()),
  );
  head.position.y = HEAD_Y;
  group.add(head);

  // Iron cage: 4 bars leaning outward, and a ring on top.
  const iron = propMaterial(ironTexture());
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bar = solid(new THREE.BoxGeometry(0.015, 0.3, 0.015), iron);
    bar.position.set(Math.cos(angle) * 0.09, HEAD_Y + 0.04, Math.sin(angle) * 0.09);
    // Lean outward: rotate around the axis perpendicular to its direction.
    bar.rotation.set(Math.sin(angle) * 0.25, 0, -Math.cos(angle) * 0.25);
    group.add(bar);
  }
  const ring = solid(new THREE.TorusGeometry(0.12, 0.012, 4, 8), iron);
  ring.rotation.x = Math.PI / 2; // torus is created standing up: lay it flat
  ring.position.y = HEAD_Y + 0.18;
  group.add(ring);

  // The flame grows from the top of the cloth.
  const flame = createFlame(FLAME_WIDTH, FLAME_HEIGHT);
  flame.sprite.position.y = HEAD_Y + 0.06;
  group.add(flame.sprite);

  return {
    object: group,
    fires: [
      {
        position: new THREE.Vector3(0, HEAD_Y + 0.3, 0),
        intensity: 0.8,
        range: 10,
        flicker: 0.22, // open flame: nervous
        haloSize: 2.6,
        emberRate: 8,
      },
    ],
    update: flame.update,
  };
}
