// The blacksmith's hearth (the FORGE, docs/DESIGN.md §6d): a brick table
// blackened by soot, a heap of burning coal that "breathes" as if someone
// were working the bellows, an open fire, and an iron hood with a chimney
// that pokes out of the shed's roof. It's the landmark that says "forge":
// the fire is visible from across the town.
import * as THREE from 'three';
import { FORGE_HEIGHT, FORGE_HOOD_BOTTOM, FORGE_HOOD_HEIGHT, FORGE_SIZE } from '../../sim/props';
import { addHeightFog } from '../heightFog';
import { createFlame, propMaterial, scaleUV, solid, texturedBox, type PropModel } from './common';
import { seededRandom } from './pixelCanvas';
import { coalTextures, ironTexture, sootyBrickTexture } from './textures';

/** Thickness of the iron rim around the coal bed. */
const RIM = 0.15;
const RIM_HEIGHT = 0.1;
/** Top of the brick body = where the coal bed lies. */
const BED_Y = FORGE_HEIGHT - RIM_HEIGHT;
const COAL_LUMPS = 12;
/** Half side of the hood at the top, where the chimney starts. */
const HOOD_TOP_HALF = 0.2;
const CHIMNEY_RADIUS = 0.17;
/** Top of the chimney: above the shed's roof (3.5–3.8 m). */
const CHIMNEY_TOP = 4.6;

/** Glow of the coals: rests at COAL_GLOW_MIN, peaks at +COAL_GLOW_PUFF on every bellows puff. */
const COAL_GLOW_MIN = 1.4;
const COAL_GLOW_PUFF = 1.8;
/** Seconds between two puffs of the bellows. */
const BELLOWS_PERIOD = 3.2;

export function createForge(): PropModel {
  const group = new THREE.Group();

  // Brick body: a box with the sooty texture (1 m tall = the texture's height,
  // so the soot is exactly at the top).
  const body = texturedBox(FORGE_SIZE, BED_Y, FORGE_SIZE, sootyBrickTexture());
  body.position.y = BED_Y / 2;
  group.add(body);

  // Iron rim around the bed: four flat bars, two long and two short so the
  // corners don't overlap (overlapping faces flicker: z-fighting).
  const iron = propMaterial(ironTexture());
  const inner = FORGE_SIZE - 2 * RIM;
  const rims: [number, number, number, number][] = [
    // sizeX, sizeZ, x, z
    [FORGE_SIZE, RIM, 0, (FORGE_SIZE - RIM) / 2],
    [FORGE_SIZE, RIM, 0, -(FORGE_SIZE - RIM) / 2],
    [RIM, inner, (FORGE_SIZE - RIM) / 2, 0],
    [RIM, inner, -(FORGE_SIZE - RIM) / 2, 0],
  ];
  for (const [sx, sz, x, z] of rims) {
    const bar = solid(new THREE.BoxGeometry(sx, RIM_HEIGHT, sz), iron);
    bar.position.set(x, BED_Y + RIM_HEIGHT / 2, z);
    group.add(bar);
  }

  // Coal: a flat bed plus a heap of lumps in the middle. One material for
  // both, with an emissive map (like the vent grate): the cracks glow.
  const { color, glow } = coalTextures();
  const coal = new THREE.MeshStandardMaterial({
    map: color,
    emissive: 0xff4a10,
    emissiveMap: glow,
    emissiveIntensity: COAL_GLOW_MIN,
    roughness: 1,
    flatShading: true, // every face of a lump is a sharp facet
  });
  addHeightFog(coal);
  const bed = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(inner, inner), 1.7, 1.7), coal);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = BED_Y + 0.005; // a hair above the bricks' top face
  bed.receiveShadow = true;
  group.add(bed);
  const rand = seededRandom(31);
  for (let i = 0; i < COAL_LUMPS; i++) {
    const size = 0.1 + rand() * 0.08;
    const lump = solid(new THREE.DodecahedronGeometry(size, 0), coal);
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * 0.45; // sqrt: spread evenly over the disc, not bunched in the middle
    lump.position.set(Math.cos(angle) * dist, BED_Y + size * 0.3, Math.sin(angle) * dist);
    lump.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    lump.scale.y = 0.5; // flattened: a heap, not a pile of balls
    group.add(lump);
  }

  // The fire on the heap.
  const flame = createFlame(0.9, 1.0);
  flame.sprite.position.y = BED_Y + 0.05;
  group.add(flame.sprite);

  // Hood: a 4-sided cylinder (= a pyramid) with the top cut off, open at both
  // ends. A CylinderGeometry with 4 segments has its corners on the axes:
  // turned by 45° its sides line up with the hearth's. The "radius" of a
  // square is half its diagonal: half side × √2.
  const hoodBottomHalf = (FORGE_SIZE - 0.2) / 2;
  const hood = solid(
    scaleUV(
      new THREE.CylinderGeometry(
        HOOD_TOP_HALF * Math.SQRT2,
        hoodBottomHalf * Math.SQRT2,
        FORGE_HOOD_HEIGHT,
        4,
        1,
        true,
      ),
      6,
      1.5,
    ),
    propMaterial(ironTexture(), true), // double-sided: from below you see its inside
  );
  hood.rotation.y = Math.PI / 4;
  hood.position.y = FORGE_HOOD_BOTTOM + FORGE_HOOD_HEIGHT / 2;
  group.add(hood);

  // Chimney: from the top of the hood up through the roof, with a conical cap.
  const hoodTop = FORGE_HOOD_BOTTOM + FORGE_HOOD_HEIGHT;
  const pipeLength = CHIMNEY_TOP - hoodTop;
  const pipe = solid(
    scaleUV(new THREE.CylinderGeometry(CHIMNEY_RADIUS, CHIMNEY_RADIUS, pipeLength, 8, 1, true), 2, 4),
    propMaterial(ironTexture(), true),
  );
  pipe.position.y = hoodTop + pipeLength / 2;
  group.add(pipe);
  const cap = solid(new THREE.ConeGeometry(CHIMNEY_RADIUS * 1.8, 0.2, 8), iron);
  cap.position.y = CHIMNEY_TOP + 0.12;
  group.add(cap);

  return {
    object: group,
    fires: [
      {
        position: new THREE.Vector3(0, BED_Y + 0.4, 0),
        intensity: 1.3, // stronger than a torch: it's the brightest fire in the area
        range: 12,
        flicker: 0.15,
        haloSize: 3,
        emberRate: 18, // a forge spits sparks
      },
    ],
    update(time) {
      flame.update(time);
      // Bellows: a sine raised to a power is mostly low with a short peak,
      // like a puff of air that makes the coals flare and then settle.
      const wave = 0.5 + 0.5 * Math.sin((time / BELLOWS_PERIOD) * Math.PI * 2);
      coal.emissiveIntensity = COAL_GLOW_MIN + COAL_GLOW_PUFF * Math.pow(wave, 4);
    },
  };
}
