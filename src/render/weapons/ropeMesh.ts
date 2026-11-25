// A ROPE that bends: a tube along a curve, rebuilt every frame.
//
// The lasso's rope never keeps its shape (it whips out, goes taut, sags,
// snaps back), so it can't be a model: it's a mesh whose vertices we move
// ourselves. The geometry is created ONCE with room for a fixed number of
// points along the rope; every frame setPoints() writes the new positions
// into the same arrays and tells Three.js they changed (`needsUpdate`):
// no allocations, nothing for the garbage collector, one draw call.
// (Like reusing a DOM node and changing its text instead of building a new one.)
//
// For each point of the curve: a RING of SIDES vertices around it, in the
// plane perpendicular to the rope. That ring needs two axes perpendicular to
// the direction; picking them fresh at every point would flip them where the
// curve turns, and the tube would twist like a candy wrapper. PARALLEL
// TRANSPORT instead: carry the previous ring's axis along, remove the part
// that now points along the rope (a projection: a − t·(a·t)), renormalize.
// The same trick as tools/blender/lasso.py, which builds the rope's fixed pieces.
import * as THREE from 'three';

/** Sides of the tube: low-poly, like the models. */
const SIDES = 5;
/** Texture repeats per meter along the rope (the twisted strands of rope.png in lasso.glb). */
const V_PER_METER = 8;

export interface RopeMesh {
  mesh: THREE.Mesh;
  /** How many points the rope has (setPoints wants exactly this many). */
  count: number;
  /** Lays the rope along these points (first = the hand's end). */
  setPoints(points: THREE.Vector3[]): void;
}

export function createRope(count: number, radius: number, material: THREE.Material): RopeMesh {
  const verts = count * SIDES;
  const positions = new Float32Array(verts * 3);
  const normals = new Float32Array(verts * 3);
  const uvs = new Float32Array(verts * 2);
  const index: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * SIDES + j;
      const b = i * SIDES + ((j + 1) % SIDES);
      const c = a + SIDES;
      const d = b + SIDES;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  // The bounding sphere would have to be recomputed every frame: simpler to never cull a rope.
  mesh.frustumCulled = false;

  const t = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  const other = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return {
    mesh,
    count,
    setPoints(points) {
      let v = 0;
      for (let i = 0; i < count; i++) {
        const p = points[i];
        // Direction of the rope here: from the point before to the point after.
        t.subVectors(points[Math.min(count - 1, i + 1)], points[Math.max(0, i - 1)]);
        if (t.lengthSq() < 1e-10) t.set(0, 0, -1);
        t.normalize();
        if (i === 0) {
          // A first axis: anything not along the rope.
          axis.set(0, 1, 0);
          if (Math.abs(t.y) > 0.9) axis.set(1, 0, 0);
        } else if (i > 0) {
          v += p.distanceTo(points[i - 1]) * V_PER_METER;
        }
        // Parallel transport: remove the part along t, renormalize.
        axis.addScaledVector(t, -axis.dot(t)).normalize();
        other.crossVectors(t, axis);
        for (let j = 0; j < SIDES; j++) {
          const a = (j / SIDES) * Math.PI * 2;
          dir.copy(axis).multiplyScalar(Math.cos(a)).addScaledVector(other, Math.sin(a));
          const k = i * SIDES + j;
          positions[k * 3] = p.x + dir.x * radius;
          positions[k * 3 + 1] = p.y + dir.y * radius;
          positions[k * 3 + 2] = p.z + dir.z * radius;
          normals[k * 3] = dir.x;
          normals[k * 3 + 1] = dir.y;
          normals[k * 3 + 2] = dir.z;
          uvs[k * 2] = j / SIDES;
          uvs[k * 2 + 1] = v;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.attributes.uv.needsUpdate = true;
    },
  };
}

/**
 * Fills `out` (count points) with a rope from `a` to `b`, with a SAG (it hangs
 * down in the middle, a parabola: 4·s·(1−s) is 0 at both ends and 1 in the
 * middle) and a WAVE travelling along it (the whip: a sine of the position
 * along the rope and of time, fading toward the far end).
 */
export function layRope(
  out: THREE.Vector3[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  wave: number,
  phase: number,
  /** Which way the wave swings (a unit vector across the rope). */
  across: THREE.Vector3,
): void {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const p = out[i].lerpVectors(a, b, s);
    const belly = 4 * s * (1 - s);
    p.y -= sag * belly;
    p.addScaledVector(across, wave * Math.sin(s * 9 - phase) * belly * (1 - 0.5 * s));
  }
}
