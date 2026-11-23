// Spent cases flying out of a gun (the carbine's brass, the pump-action's
// shells). Each one is a COPY of a template part of the gun, moved into a
// "flight space" (the viewmodel scene) at the same place on screen: once out
// of the gun it doesn't follow the gun's sway and recoil anymore. Then it's
// a bit of ballistics by hand: a speed, gravity, a tumble, and gone after a
// moment (it's off the screen by then). Purely cosmetic.
import * as THREE from 'three';

/** How a gun throws its cases. Speeds in the viewmodel camera's space: x right, y up, z toward you. */
export interface CaseThrow {
  /** Speed leaving the gun, m/s. */
  speed: { x: number; y: number; z: number };
  /** Random extra on each axis, m/s: no two cases fly the same. */
  scatter: number;
  /** How fast it tumbles, rad/s. */
  spin: number;
  /** Gravity, m/s² (a bit less than real: we want to see them go). */
  gravity: number;
  /** Seconds before it's removed. */
  life: number;
}

interface FlyingCase {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
}

export interface SpentCases {
  /** Throw a copy of `template` (a hidden part of the gun, where the case leaves it). */
  eject(template: THREE.Object3D): void;
  update(dt: number): void;
  /** Remove them all (weapon switched away). */
  clear(): void;
}

export function createSpentCases(flightSpace: THREE.Object3D, how: CaseThrow): SpentCases {
  const flying: FlyingCase[] = [];
  return {
    eject(template) {
      const mesh = template.clone();
      mesh.visible = true;
      // Same parent first (same place as the template), then attach():
      // it changes the parent KEEPING the world transform, by multiplying
      // in the inverse of the new parent's world matrix.
      template.parent!.add(mesh);
      flightSpace.attach(mesh);
      const r = () => (Math.random() * 2 - 1) * how.scatter;
      flying.push({
        mesh,
        vel: new THREE.Vector3(how.speed.x + r() * 0.5, how.speed.y + r(), how.speed.z + r() * 0.5),
        spin: new THREE.Vector3(how.spin * (0.6 + Math.random() * 0.4), how.spin * 0.2 * r(), how.spin * 0.5),
        age: 0,
      });
    },
    update(dt) {
      for (let i = flying.length - 1; i >= 0; i--) {
        const c = flying[i];
        c.age += dt;
        c.vel.y -= how.gravity * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        if (c.age > how.life) {
          c.mesh.removeFromParent();
          flying.splice(i, 1);
        }
      }
    },
    clear() {
      for (const c of flying) c.mesh.removeFromParent();
      flying.length = 0;
    },
  };
}
