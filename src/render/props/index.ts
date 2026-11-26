// Builds all the props of a level: picks the right model for each one,
// places it, and collects its flames and animations.
import * as THREE from 'three';
import type { Prop, World } from '../../sim/world';
import type { FireSource } from '../fireLights';
import { createAnvil } from './anvil';
import { createBarrel } from './barrel';
import type { PropModel } from './common';
import { createForge } from './forge';
import { createGrass } from './grass';
import { createLantern } from './lantern';
import { createSign } from './sign';
import { createTorch } from './torch';
import { createVent } from './vent';

export interface LevelProps {
  /** Every flame in the level, in world coordinates. */
  fires: FireSource[];
  /** Positions of the steam vents (for the steam particles). */
  vents: THREE.Vector3[];
  /** Call every frame. */
  update(time: number): void;
}

export function createProps(scene: THREE.Scene, world: World): LevelProps {
  const fires: FireSource[] = [];
  const vents: THREE.Vector3[] = [];
  const updates: ((time: number) => void)[] = [];

  for (const p of world.props) {
    if (p.type === 'grass') continue; // all grass patches are built together below

    let model: PropModel;
    switch (p.type) {
      case 'barrel':
        model = createBarrel();
        break;
      case 'sign':
        model = createSign(p.text);
        break;
      case 'torch':
        model = createTorch();
        break;
      case 'lantern':
        model = createLantern(p.mount);
        break;
      case 'forge':
        model = createForge();
        break;
      case 'anvil':
        model = createAnvil();
        break;
      case 'vent':
        model = createVent();
        vents.push(new THREE.Vector3(p.x, p.y, p.z));
        break;
    }

    const object = model.object;
    object.name = p.type; // readable in a scene dump
    object.position.set(p.x, p.y, p.z);
    object.rotation.y = THREE.MathUtils.degToRad('rotation' in p ? (p.rotation ?? 0) : 0);
    scene.add(object);

    // Flames are defined in the prop's own coordinates: convert them to
    // world coordinates with the prop's transform (position + rotation).
    object.updateMatrixWorld(true);
    for (const f of model.fires ?? []) {
      fires.push({ ...f, position: object.localToWorld(f.position.clone()) });
    }
    if (model.update) updates.push(model.update);
  }

  const grassPatches = world.props.filter(
    (p): p is Extract<Prop, { type: 'grass' }> => p.type === 'grass',
  );
  if (grassPatches.length > 0) {
    const grass = createGrass(grassPatches, world.boxes);
    scene.add(grass.object);
    updates.push(grass.update);
  }

  return {
    fires,
    vents,
    update(time) {
      for (const u of updates) u(time);
    },
  };
}
