// Steam vent (jump pad): an iron grate set in the ground, glowing orange
// through its slots. The steam itself is a particle effect (particles.ts).
import * as THREE from 'three';
import { addHeightFog } from '../heightFog';
import { VENT_RADIUS } from '../../sim/props';
import { propMaterial, solid, type PropModel } from './common';
import { brassTexture, ventTextures } from './textures';

let grateMaterial: THREE.MeshStandardMaterial | null = null;

export function createVent(): PropModel {
  const group = new THREE.Group();

  if (!grateMaterial) {
    const { color, glow } = ventTextures();
    // emissiveMap: only where this texture is white does the material emit
    // light. Here: the slots glow, the iron doesn't.
    grateMaterial = new THREE.MeshStandardMaterial({
      map: color,
      emissive: 0xff6020,
      emissiveIntensity: 2.5,
      emissiveMap: glow,
      roughness: 0.9,
    });
    addHeightFog(grateMaterial);
  }

  // The grate: a thin disc, 2 cm above the ground so it doesn't flicker
  // against the floor ("z-fighting": two surfaces at the same depth).
  const grate = new THREE.Mesh(new THREE.CircleGeometry(VENT_RADIUS, 16), grateMaterial);
  grate.rotation.x = -Math.PI / 2;
  grate.position.y = 0.02;
  grate.receiveShadow = true;
  group.add(grate);

  // Brass rim around it.
  const rim = solid(new THREE.TorusGeometry(VENT_RADIUS, 0.06, 4, 16), propMaterial(brassTexture()));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.03;
  group.add(rim);

  return { object: group };
}
