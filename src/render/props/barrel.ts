// Wooden barrel: bulging staves, four iron hoops, a recessed lid.
import * as THREE from 'three';
import { propMaterial, repeatsFor, scaleUV, solid, type PropModel } from './common';
import { barrelTexture, ironTexture, lidTexture } from './textures';

const HEIGHT = 1;
const RADIUS_END = 0.3; // radius at top and bottom
const BULGE = 0.07; // extra radius at the middle
/** Sides of the barrel. Low on purpose: visible facets are part of the look. */
const SEGMENTS = 12;
const HOOPS = [0.1, 0.32, 0.68, 0.9]; // heights, as a fraction of HEIGHT

/** Barrel radius at height y (0..HEIGHT): widest in the middle (a sine arch). */
function radiusAt(y: number): number {
  return RADIUS_END + BULGE * Math.sin((y / HEIGHT) * Math.PI);
}

export function createBarrel(): PropModel {
  const group = new THREE.Group();

  // Body: a LatheGeometry spins a 2D profile (radius, height) around the Y
  // axis, like a potter's wheel. Our profile is the bulging side of the barrel.
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const y = (i / 6) * HEIGHT;
    profile.push(new THREE.Vector2(radiusAt(y), y));
  }
  // Double-sided: the inside of the rim is visible above the lid.
  const bodyMaterial = propMaterial(barrelTexture(), true);
  group.add(solid(new THREE.LatheGeometry(profile, SEGMENTS), bodyMaterial));

  // Hoops: short open cylinders, a hair wider than the body at their height.
  const iron = propMaterial(ironTexture());
  for (const h of HOOPS) {
    const y = h * HEIGHT;
    const r = radiusAt(y) + 0.012;
    const hoop = new THREE.CylinderGeometry(r, r, 0.05, SEGMENTS, 1, true);
    scaleUV(hoop, repeatsFor(2 * Math.PI * r, 16), 1);
    const mesh = solid(hoop, iron);
    mesh.position.y = y;
    group.add(mesh);
  }

  // Lid: a disc sitting 4 cm below the rim.
  const lid = solid(
    new THREE.CircleGeometry(radiusAt(HEIGHT - 0.04), SEGMENTS),
    propMaterial(lidTexture()),
  );
  lid.rotation.x = -Math.PI / 2; // circles are created facing +Z: lay it flat, facing up
  lid.position.y = HEIGHT - 0.04;
  group.add(lid);

  return { object: group };
}
