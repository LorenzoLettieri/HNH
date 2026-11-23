// The anvil where you work the Damned Iron (the FORGE, docs/DESIGN.md §6d).
// A classic London-pattern anvil on an oak stump: feet, waist, the body, a
// polished steel face, the horn toward +X and the heel toward -X. On the face:
// a red-hot bar that glows with its own small light (the "use me" sign, since
// the forge has no vendor) and a hammer left there by whoever worked it last.
import * as THREE from 'three';
import { ANVIL_HEIGHT } from '../../sim/props';
import { addHeightFog } from '../heightFog';
import { propMaterial, scaleUV, solid, type PropModel } from './common';
import { ironTexture, polishedSteelTexture, postWoodTexture } from './textures';

const STUMP_HEIGHT = 0.42;
const STUMP_RADIUS = 0.3;
/** The anvil's face is 10 cm thick and ends at ANVIL_HEIGHT. */
const FACE_THICKNESS = 0.1;
const FACE_LENGTH = 0.56;
const FACE_WIDTH = 0.22;
const HORN_LENGTH = 0.34;

/** The hot bar's glow: it slowly "cools and heats", between these two. */
const BAR_GLOW_MIN = 2.2;
const BAR_GLOW_MAX = 3.6;
const BAR_GLOW_PERIOD = 2.4; // seconds

export function createAnvil(): PropModel {
  const group = new THREE.Group();
  const iron = propMaterial(ironTexture());

  // Oak stump: a slightly tapered 8-sided cylinder.
  const stump = solid(
    scaleUV(new THREE.CylinderGeometry(STUMP_RADIUS * 0.9, STUMP_RADIUS, STUMP_HEIGHT, 8), 2, 1),
    propMaterial(postWoodTexture()),
  );
  stump.position.y = STUMP_HEIGHT / 2;
  group.add(stump);

  // The anvil, bottom to top. Each piece: size and the height of its bottom.
  const faceBottom = ANVIL_HEIGHT - FACE_THICKNESS;
  const parts: [number, number, number, number][] = [
    // sizeX, sizeY, sizeZ, bottomY
    [0.44, 0.08, 0.36, STUMP_HEIGHT], // feet
    [0.36, 0.04, 0.28, STUMP_HEIGHT + 0.08], // top of the feet, stepping in
    [0.24, faceBottom - 0.06 - (STUMP_HEIGHT + 0.12), 0.18, STUMP_HEIGHT + 0.12], // waist
    [0.46, 0.06, 0.22, faceBottom - 0.06], // flaring out under the face
    [FACE_LENGTH, FACE_THICKNESS, FACE_WIDTH, faceBottom], // the body under the face
  ];
  for (const [sx, sy, sz, y] of parts) {
    const piece = solid(new THREE.BoxGeometry(sx, sy, sz), iron);
    piece.position.y = y + sy / 2;
    group.add(piece);
  }

  // Polished face: a thin steel plate on top (2 mm above, so it doesn't
  // fight with the body's top face).
  const face = solid(
    new THREE.BoxGeometry(FACE_LENGTH - 0.02, 0.012, FACE_WIDTH - 0.02),
    propMaterial(polishedSteelTexture()),
  );
  face.position.y = ANVIL_HEIGHT + 0.004;
  group.add(face);

  // Horn: a 6-sided cone lying along +X. Cones are built pointing up (+Y):
  // rotating -90° around Z tips the point toward +X. Its top is flush with
  // the face, and it's a bit flattened (scale.z), like a real horn.
  const horn = solid(new THREE.ConeGeometry(FACE_THICKNESS * 0.9, HORN_LENGTH, 6), iron);
  horn.rotation.z = -Math.PI / 2;
  horn.position.set(FACE_LENGTH / 2 + HORN_LENGTH / 2, ANVIL_HEIGHT - FACE_THICKNESS * 0.9, 0);
  horn.scale.z = 0.8;
  group.add(horn);

  // Heel: a short square step on the -X end.
  const heel = solid(new THREE.BoxGeometry(0.1, FACE_THICKNESS * 0.7, FACE_WIDTH * 0.7), iron);
  heel.position.set(-FACE_LENGTH / 2 - 0.05, ANVIL_HEIGHT - FACE_THICKNESS * 0.35, 0);
  group.add(heel);

  // The red-hot bar, across the face and sticking out a bit toward +Z.
  // Its color is almost all emissive, above 1 = it triggers the bloom.
  const hot = new THREE.MeshStandardMaterial({
    color: 0x401008,
    emissive: 0xff5a1a,
    emissiveIntensity: BAR_GLOW_MIN,
  });
  addHeightFog(hot);
  const bar = solid(new THREE.BoxGeometry(0.34, 0.03, 0.035), hot);
  bar.position.set(0.08, ANVIL_HEIGHT + 0.025, 0.05);
  bar.rotation.y = -0.5;
  group.add(bar);

  // Hammer: head on the face near the heel, handle hanging out toward +Z.
  const hammer = new THREE.Group();
  const head = solid(new THREE.BoxGeometry(0.06, 0.06, 0.14), iron);
  head.position.y = 0.03;
  hammer.add(head);
  const handle = solid(new THREE.BoxGeometry(0.03, 0.03, 0.36), propMaterial(postWoodTexture()));
  handle.position.set(0, 0.02, 0.2);
  hammer.add(handle);
  hammer.position.set(-0.17, ANVIL_HEIGHT + 0.01, -0.04);
  hammer.rotation.y = 0.35;
  group.add(hammer);

  return {
    object: group,
    fires: [
      {
        // A small light just above the bar: it lights the anvil from the
        // top and puts a halo on it, visible from afar.
        position: new THREE.Vector3(0.08, ANVIL_HEIGHT + 0.15, 0.05),
        intensity: 0.25,
        range: 3.5,
        flicker: 0.03, // hot metal doesn't flicker like a flame
        haloSize: 1.2,
        emberRate: 0.8,
      },
    ],
    update(time) {
      const wave = 0.5 + 0.5 * Math.sin((time / BAR_GLOW_PERIOD) * Math.PI * 2);
      hot.emissiveIntensity = BAR_GLOW_MIN + (BAR_GLOW_MAX - BAR_GLOW_MIN) * wave;
    },
  };
}
