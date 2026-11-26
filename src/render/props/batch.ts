// Static batching of the props: the same trick createLevelMeshes uses for the
// level's boxes (src/render/materials.ts), applied to the prop models.
//
// Why: every Mesh is one draw call, and a draw call has a fixed cost on the
// CPU (three.js sets up the material, the matrices, the buffers, then asks
// WebGL to draw) whatever the number of triangles. A lantern is 9 tiny
// meshes, a torch 8: the town's ~330 prop meshes, drawn twice (shadow map +
// scene), were ~650 draw calls for a few thousand triangles. Like 650 SQL
// queries of one row each instead of one query that returns them all.
//
// How: every mesh that never moves is "baked" in world coordinates (its
// matrixWorld applied to a copy of its vertices), and all the baked meshes
// that share the same material (and the same shadow flags) are concatenated
// into ONE geometry, drawn by ONE mesh. The material is the same object, so
// what animates the material (the forge's coals, the anvil's hot bar) keeps
// working on the merged mesh.
//
// What stays out:
// - what moves (the sign's swinging board: listed in PropModel.moving);
// - sprites and points (the flames: not meshes);
// - transparent materials (the lantern's glass): transparent things must be
//   drawn back to front, one object at a time; one big object can't be sorted;
// - meshes with several materials on one geometry (the sign's board).
//
// The price: a merged mesh spans the whole town, so frustum culling ("is it
// in front of the camera?") can't skip parts of it: every prop triangle is
// always sent to the GPU. A few thousand triangles: nothing, compared to the
// draw calls saved.
import * as THREE from 'three';

/**
 * Merges the static meshes under `roots` into one mesh per material, added to
 * `scene`; the original meshes are removed. Anything inside a `moving`
 * subtree is left alone. Returns how many meshes became how many.
 */
export function batchStatic(
  scene: THREE.Scene,
  roots: THREE.Object3D[],
  moving: Set<THREE.Object3D>,
): { before: number; after: number } {
  // 1. Collect the candidates, grouped by "same material, same shadow flags".
  const groups = new Map<string, THREE.Mesh[]>();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    collect(root, moving, groups);
  }

  // 2. One merged mesh per group.
  let before = 0;
  for (const meshes of groups.values()) {
    before += meshes.length;
    const first = meshes[0];
    const merged = new THREE.Mesh(mergeBaked(meshes), first.material);
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.name = 'props (batched)';
    // Its vertices are already in world coordinates: the mesh itself stays at
    // the origin and never moves, so three.js can skip recomputing its matrix.
    merged.matrixAutoUpdate = false;
    scene.add(merged);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose(); // the copy in the merged geometry is the one drawn now
    }
  }
  return { before, after: groups.size };
}

function collect(object: THREE.Object3D, moving: Set<THREE.Object3D>, groups: Map<string, THREE.Mesh[]>): void {
  if (moving.has(object)) return; // this whole subtree moves: not static
  if (object instanceof THREE.Mesh && canBatch(object)) {
    const material = object.material as THREE.Material;
    const key = `${material.uuid} ${object.castShadow} ${object.receiveShadow}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(object);
  }
  for (const child of object.children) collect(child, moving, groups);
}

function canBatch(mesh: THREE.Mesh): boolean {
  if (Array.isArray(mesh.material)) return false;
  if (mesh.material.transparent) return false;
  const g = mesh.geometry;
  // Every prop geometry has these three; a geometry without one would leave a
  // hole in the merged arrays.
  return g.attributes.position !== undefined && g.attributes.normal !== undefined && g.attributes.uv !== undefined;
}

/**
 * Bakes every mesh into world coordinates and concatenates the vertices.
 * Some geometries are "indexed" (vertices shared between triangles, plus a
 * list of which 3 make each triangle) and some aren't (the dodecahedrons):
 * to concatenate them all the same way we un-index them first
 * (toNonIndexed: every triangle gets its own 3 vertices). A few more
 * vertices, much simpler code.
 */
function mergeBaked(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const baked = meshes.map((m) => {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    // applyMatrix4 moves the positions with the matrix and turns the normals
    // with its "normal matrix" (correct even with a non-uniform scale, like
    // the flattened coal lumps).
    g.applyMatrix4(m.matrixWorld);
    return g;
  });
  const count = baked.reduce((n, g) => n + g.attributes.position.count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let offset = 0;
  for (const g of baked) {
    position.set(g.attributes.position.array as Float32Array, offset * 3);
    normal.set(g.attributes.normal.array as Float32Array, offset * 3);
    uv.set(g.attributes.uv.array as Float32Array, offset * 2);
    offset += g.attributes.position.count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.computeBoundingSphere();
  return merged;
}
