// Debug view of the HITBOXES (H key): the boxes the bullets and the kick
// actually test against, drawn as wireframes over the sprites. Handy to tune
// ghoulHitWidth / eyebatHitRadius in the debug panel and SEE the result.
// Colors: green = body, yellow = critical zone (ghoul head, eye-bat pupil).
//
// One LineSegments object for all of them (12 edges × 2 points per box):
// one draw call, rebuilt every frame (a few dozen boxes: cheap).
import * as THREE from 'three';
import { tuning } from '../sim/config';
import { hitBox, isAlive, type Entity } from '../sim/entities';
import type { Box } from '../sim/world';

const MAX_BOXES = 200;
const BODY = new THREE.Color(0x40ff60);
const CRIT = new THREE.Color(0xffd040);

export interface HitboxDebug {
  toggle(): void;
  update(entities: Entity[]): void;
}

export function createHitboxDebug(scene: THREE.Scene): HitboxDebug {
  // Pre-allocated buffers, filled every frame (no garbage each frame).
  const positions = new Float32Array(MAX_BOXES * 24 * 3);
  const colors = new Float32Array(MAX_BOXES * 24 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(
    geometry,
    // depthTest off: visible through walls, it's a debug view.
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
  );
  lines.renderOrder = 999;
  lines.frustumCulled = false; // its bounds change every frame
  lines.visible = false;
  scene.add(lines);

  let count = 0; // boxes written this frame
  function addBox(b: Box, color: THREE.Color): void {
    if (count >= MAX_BOXES) return;
    // The 8 corners, then the 12 edges as pairs of corner indices.
    const c = [
      [b.minX, b.minY, b.minZ], [b.maxX, b.minY, b.minZ], [b.maxX, b.minY, b.maxZ], [b.minX, b.minY, b.maxZ],
      [b.minX, b.maxY, b.minZ], [b.maxX, b.maxY, b.minZ], [b.maxX, b.maxY, b.maxZ], [b.minX, b.maxY, b.maxZ],
    ];
    const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    let i = count * 24 * 3;
    for (const corner of edges) {
      positions.set(c[corner], i);
      colors.set([color.r, color.g, color.b], i);
      i += 3;
    }
    count++;
  }

  return {
    toggle() {
      lines.visible = !lines.visible;
    },
    update(entities) {
      if (!lines.visible) return;
      count = 0;
      for (const e of entities) {
        if (e.type === 'target' || !isAlive(e)) continue;
        const b = hitBox(e);
        addBox(b, BODY);
        if (e.type === 'ghoul') {
          // Head zone: everything above ghoulHeadHeight is a headshot.
          addBox({ ...b, minY: e.y + tuning.ghoulHeadHeight }, CRIT);
        } else if (e.type === 'hound') {
          addBox({ ...b, minY: e.y + tuning.houndHeadHeight }, CRIT);
        } else if (e.type === 'bull' && e.state === 'stunned') {
          addBox(b, CRIT); // stunned: the whole bull is a critical spot
        } else if (e.type === 'eyebat') {
          // Pupil: a small square around the eye's center (the real test is
          // "the bullet passes within eyebatPupilRadius of the center").
          const r = tuning.eyebatPupilRadius;
          const cy = e.y + tuning.eyebatRadius;
          addBox({ minX: e.x - r, maxX: e.x + r, minY: cy - r, maxY: cy + r, minZ: e.z - r, maxZ: e.z + r }, CRIT);
        }
      }
      geometry.setDrawRange(0, count * 24);
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}
