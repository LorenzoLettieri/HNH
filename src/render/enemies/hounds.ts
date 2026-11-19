// Draws the hellhounds. FOR NOW A "GREYBOX": a few boxes (body, head, legs)
// with two glowing eyes, like the level started as plain boxes. It's enough
// to test how the hound moves and attacks; the pixel-art sprite comes later.
//
// Unlike the sprites, this is a real 3D object: it turns to face where it's
// running (its velocity), not toward the camera.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, HoundEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { playGhoulDeath, playHowl, playSwipe } from '../../audio/sfx';

/** How fast the model turns toward its running direction (1/s): smooths out jitter. */
const TURN_RATE = 12;

/** Eye glow (HDR, blooms): dim while stalking (it hides), bright when it charges. */
const EYE_GLOW_STALK = 1.5;
const EYE_GLOW_CHARGE = 8;

interface HoundView {
  group: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  eyeMat: THREE.MeshStandardMaterial;
  yaw: number;
  fallAngle: number;
}

export interface HoundRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createHoundRenderer(scene: THREE.Scene): HoundRenderer {
  // Shared by every hound: geometries and materials are created once.
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a1410, roughness: 1 });
  addHeightFog(skin);
  const bodyGeo = new THREE.BoxGeometry(0.45, 0.45, 1.0);
  const headGeo = new THREE.BoxGeometry(0.35, 0.35, 0.45);
  const legGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12);
  const eyeGeo = new THREE.BoxGeometry(0.07, 0.05, 0.02);

  const views = new Map<number, HoundView>();

  function create(): HoundView {
    // Each hound has its own eye material: its glow changes with its state.
    // Emissive with intensity > 1: HDR, the bloom makes them glow in the dark.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3010, emissiveIntensity: EYE_GLOW_STALK });
    const group = new THREE.Group();
    // Everything above the legs is in `body`: lowered while stalking (it slinks).
    const body = new THREE.Group();
    group.add(body);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    // Model "forward" is +Z (so yaw = atan2(vx, vz) points it where it runs).
    add(bodyGeo, skin, 0, 0.65, 0, body);
    for (const [x, z] of [[-0.15, 0.38], [0.15, 0.38], [-0.15, -0.38], [0.15, -0.38]]) add(legGeo, skin, x, 0.22, z);
    const head = new THREE.Group();
    head.position.set(0, 0.85, 0.6);
    body.add(head);
    add(headGeo, skin, 0, 0, 0, head);
    add(eyeGeo, eyeMat, -0.09, 0.06, 0.23, head);
    add(eyeGeo, eyeMat, 0.09, 0.06, 0.23, head);
    scene.add(group);
    return { group, body, head, eyeMat, yaw: 0, fallAngle: 0 };
  }

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        const h = e.type === 'houndBite' || e.type === 'houndHowl' || e.type === 'hit' ? byId.get(e.entityId) : undefined;
        if (!h || h.type !== 'hound') continue;
        if (e.type === 'houndHowl') playHowl(soundAt(camera, h.x, h.y + 0.8, h.z));
        // Placeholder sounds (ghoul ones) until the hound gets its own.
        if (e.type === 'houndBite') playSwipe(soundAt(camera, h.x, h.y + 0.8, h.z));
        if (e.type === 'hit' && e.killed) playGhoulDeath(soundAt(camera, h.x, h.y + 0.8, h.z));
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'hound') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        draw(v, e, alpha, dt);
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.group);
        v.eyeMat.dispose();
        views.delete(id);
      }
    },
  };

  function draw(v: HoundView, e: HoundEntity, alpha: number, dt: number): void {
    v.group.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    // Face the running direction. Turning by the SHORTEST way: the angle
    // difference is wrapped into [-π, π] (otherwise going from 179° to -179°
    // it would spin all the way around).
    if (e.state !== 'dead' && Math.hypot(e.vx, e.vz) > 0.5) {
      const target = Math.atan2(e.vx, e.vz);
      const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
      v.yaw += diff * Math.min(1, TURN_RATE * dt);
    }
    v.group.rotation.set(0, v.yaw, 0);
    // Bite: the head snaps forward during the wind-up.
    const biting = e.state === 'bite' ? Math.min(1, e.stateTicks / (tuning.houndBiteWindup * 60)) : 0;
    v.head.position.z = 0.6 + biting * 0.25;
    // Stalking: low to the ground, eyes dim. Charging: eyes blazing.
    const stalking = e.state === 'stalk' || e.state === 'retreat';
    v.body.position.y = stalking ? -0.12 : 0;
    v.eyeMat.emissiveIntensity = e.state === 'charge' || e.state === 'bite' ? EYE_GLOW_CHARGE : EYE_GLOW_STALK;
    if (e.state === 'dead') {
      // Rolls onto its side, then sinks into the ground before disappearing.
      v.fallAngle = Math.min(Math.PI / 2, v.fallAngle + dt * 8);
      const remaining = tuning.houndCorpseTime - e.stateTicks / 60;
      if (remaining < 1) v.group.position.y -= (1 - remaining) * 0.3;
    }
    v.group.rotation.z = v.fallAngle;
  }
}
