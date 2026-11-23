// Draws the dynamite sticks (sim/dynamite.ts). PLACEHOLDER for now: a red
// cylinder with a little fuse that spits sparks. The real model, the hiss of
// the fuse and the "tonk" of the bounces come in a later step.
//
// The simulation only knows a small box that flies and bounces: the spin is
// invented here, from how far the stick moved (like a wheel: angle = distance
// / radius), so it tumbles in flight and rolls on the floor.
import * as THREE from 'three';
import type { Dynamite } from '../sim/dynamite';
import { DYNAMITE_RADIUS } from '../sim/dynamite';
import { spawnSparks } from './particles';

/** Size of the stick, meters (a bit bigger than a real one: it must be readable in flight). */
const STICK_LENGTH = 0.26;
const STICK_RADIUS = 0.04;
/** Tumbling speed: radians per meter traveled (in flight it spins faster than it would roll). */
const SPIN_PER_METER = 9;
/** Sparks from the fuse: on average one every this many seconds. */
const SPARK_EVERY = 0.05;

export interface DynamiteRenderer {
  update(sticks: Dynamite[], alpha: number, dt: number): void;
}

interface StickView {
  mesh: THREE.Group;
  /** Where the tip of the fuse is, in the stick's own coordinates. */
  fuse: THREE.Object3D;
}

export function createDynamiteRenderer(scene: THREE.Scene): DynamiteRenderer {
  // Shared by every stick: one geometry and one material each, not one per stick.
  const body = new THREE.CylinderGeometry(STICK_RADIUS, STICK_RADIUS, STICK_LENGTH, 8);
  body.rotateZ(Math.PI / 2); // lying along X
  const red = new THREE.MeshLambertMaterial({ color: 0xb3261e, emissive: 0x3a0804 });
  const fuseGeometry = new THREE.CylinderGeometry(0.006, 0.006, 0.07, 4);
  const fuseMaterial = new THREE.MeshBasicMaterial({ color: 0xd8c08a });
  const ember = new THREE.MeshBasicMaterial({ color: 0xffd060 });
  const emberGeometry = new THREE.SphereGeometry(0.018, 6, 4);

  const views = new Map<number, StickView>();
  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  function createView(): StickView {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(body, red));
    // The fuse sticks out of one end, along the stick.
    const fuseMesh = new THREE.Mesh(fuseGeometry, fuseMaterial);
    fuseMesh.rotation.z = Math.PI / 2;
    fuseMesh.position.x = STICK_LENGTH / 2 + 0.035;
    mesh.add(fuseMesh);
    const fuse = new THREE.Mesh(emberGeometry, ember);
    fuse.position.x = STICK_LENGTH / 2 + 0.07;
    mesh.add(fuse);
    // Start at a random angle, so two sticks don't look identical.
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    scene.add(mesh);
    return { mesh, fuse };
  }

  return {
    update(sticks, alpha, dt) {
      const alive = new Set<number>();
      for (const d of sticks) {
        alive.add(d.id);
        let v = views.get(d.id);
        if (!v) {
          v = createView();
          views.set(d.id, v);
        }
        // Between the previous tick and this one (alpha), like everything else.
        // +DYNAMITE_RADIUS: the simulation gives the bottom of the box, we draw its center.
        const x = d.px + (d.x - d.px) * alpha;
        const y = d.py + (d.y - d.py) * alpha + DYNAMITE_RADIUS;
        const z = d.pz + (d.z - d.pz) * alpha;
        const moved = Math.hypot(x - v.mesh.position.x, y - v.mesh.position.y, z - v.mesh.position.z);
        // Spin around the axis perpendicular to the motion and to "up" (the
        // cross product of the two): that's how a rolling thing turns.
        axis.set(d.vz, 0, -d.vx);
        if (axis.lengthSq() > 1e-6 && moved < 2) {
          axis.normalize();
          spin.setFromAxisAngle(axis, moved * SPIN_PER_METER);
          v.mesh.quaternion.premultiply(spin);
        }
        v.mesh.position.set(x, y, z);
        // The fuse's ember flickers and spits sparks.
        v.fuse.scale.setScalar(0.7 + Math.random() * 0.6);
        if (Math.random() < dt / SPARK_EVERY) {
          v.fuse.getWorldPosition(point);
          spawnSparks(point, up, 1);
        }
      }
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.mesh);
        views.delete(id);
      }
    },
  };
}
