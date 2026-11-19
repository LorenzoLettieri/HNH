// Practice targets: a steel plate hinged on top of a wooden post. It swings
// when hit and falls backward when knocked down, then stands up again.
// It only DRAWS the target entities: health and respawn live in the simulation.
import * as THREE from 'three';
import { TARGET_PLATE_HEIGHT, TARGET_PLATE_RADIUS, isAlive, type Entity } from '../sim/entities';
import type { SimEvent } from '../sim/events';
import { addHeightFog } from './heightFog';
import { postWoodTexture, targetTexture } from './props/textures';
import { solid, texturedBox } from './props/common';

/** Spring of the hinge: stiffness (how hard it pulls back) and damping (how fast it calms down). */
const SPRING_STIFFNESS = 140;
const SPRING_DAMPING = 9;
/** Angular speed added by a bullet, rad/s. */
const HIT_KICK = 7;
/** Angle when knocked down: almost flat, falling backward. */
const DOWN_ANGLE = 1.45;
/**
 * The spring is integrated in small fixed steps. A stiff spring integrated
 * with big steps (e.g. a 100 ms frame on a slow PC) becomes UNSTABLE: each
 * step overshoots more than the last and the motion explodes. Same idea as
 * the fixed-timestep game loop: never let the frame rate decide the physics.
 */
const SPRING_STEP = 1 / 240;

interface TargetView {
  entity: Entity;
  hinge: THREE.Group;
  angle: number;
  velocity: number;
}

export interface Targets {
  handle(events: SimEvent[]): void;
  update(dt: number): void;
}

export function createTargets(scene: THREE.Scene, entities: Entity[]): Targets {
  const plateMaterial = new THREE.MeshStandardMaterial({ map: targetTexture(), roughness: 0.6 });
  addHeightFog(plateMaterial);
  const plateGeometry = new THREE.CylinderGeometry(TARGET_PLATE_RADIUS, TARGET_PLATE_RADIUS, 0.03, 14);
  plateGeometry.rotateX(Math.PI / 2); // disc facing ±Z

  const views = new Map<number, TargetView>();
  const hingeY = TARGET_PLATE_HEIGHT - TARGET_PLATE_RADIUS;

  for (const e of entities) {
    // The group's rotation.y = yaw turns local -Z toward the direction the
    // plate faces (the same convention as the player's view).
    const group = new THREE.Group();
    group.position.set(e.x, e.y, e.z);
    group.rotation.y = e.yaw;
    scene.add(group);

    const post = texturedBox(0.08, hingeY + 0.05, 0.08, postWoodTexture());
    post.position.set(0, (hingeY + 0.05) / 2, 0.06); // just behind the plate
    group.add(post);

    // The hinge is at the plate's bottom edge: rotating it around X swings
    // the plate like a flap (positive angle = top goes backward, away from you).
    const hinge = new THREE.Group();
    hinge.position.y = hingeY;
    group.add(hinge);
    const plate = solid(plateGeometry, plateMaterial);
    plate.position.y = TARGET_PLATE_RADIUS;
    hinge.add(plate);

    views.set(e.id, { entity: e, hinge, angle: 0, velocity: 0 });
  }

  return {
    handle(events) {
      for (const ev of events) {
        if (ev.type !== 'hit') continue;
        const v = views.get(ev.entityId);
        if (v) v.velocity += HIT_KICK;
      }
    },
    update(dt) {
      const steps = Math.ceil(Math.min(dt, 0.25) / SPRING_STEP);
      const h = Math.min(dt, 0.25) / steps;
      for (const v of views.values()) {
        // A damped spring pulls the plate toward its rest angle (standing or
        // fallen). Hooke's law: force = -stiffness × distance - damping × speed.
        const rest = isAlive(v.entity) ? 0 : DOWN_ANGLE;
        for (let i = 0; i < steps; i++) {
          const accel = -SPRING_STIFFNESS * (v.angle - rest) - SPRING_DAMPING * v.velocity;
          v.velocity += accel * h;
          v.angle += v.velocity * h;
          if (v.angle > DOWN_ANGLE + 0.1) {
            v.angle = DOWN_ANGLE + 0.1; // it hit the ground behind: stop
            v.velocity *= -0.2; // small bounce
          }
        }
        v.hinge.rotation.x = v.angle;
      }
    },
  };
}
