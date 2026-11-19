// The gunslinger's arms: leather gloves with gauntlet cuffs and the sleeves of
// a duster coat. A real model with a skeleton, made in Blender by
// tools/blender/arms.py and exported as public/models/arms.glb.
// The right hand is wrapped around the revolver's grip; the left hand "fans"
// the hammer at every shot — the classic western gunslinger move. For now the
// left arm is moved as a whole by the keyframes below (the skeleton is in the
// file, ready for real animations: fingers, reload...).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface Hands {
  /** Goes inside the gun's group: holds the grip, recoils with the gun. */
  right: THREE.Group;
  /** Goes inside the viewmodel holder: moved by the fanning animation (origin = palm center). */
  left: THREE.Group;
}

/**
 * Returns the two groups right away; the models are added inside them when
 * the file has loaded (asynchronous, like fetch()).
 * The model's coordinates are already the holder's (see arms.py), so the
 * right arm just goes in at the origin of the gun's group.
 */
export function createHands(): Hands {
  const right = new THREE.Group();
  const left = new THREE.Group();
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/arms.glb`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Skinned meshes: don't let Three.js skip them because of a stale bounding box.
      o.frustumCulled = false;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.map) {
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
      }
    });
    const armR = gltf.scene.getObjectByName('Arm_R');
    const armL = gltf.scene.getObjectByName('Arm_L');
    if (armR) right.add(armR);
    if (armL) left.add(armL);
  });
  return { right, left };
}

// --- Fanning animation --------------------------------------------------------
// Keyframes of the left hand, in the gun holder's coordinates. The palm
// starts raised above-left, sweeps over the hammer (which sits around
// y = 0.06…0.085, z = 0.02), follows through to the right, then returns.
interface Pose {
  t: number; // 0..1 along the animation
  x: number;
  y: number;
  z: number;
  roll: number; // tilt of the palm, radians
  /**
   * How to move INTO this pose from the previous one:
   * - 'smooth' (default): slow start and slow end (ease-in-out). Note: it
   *   stops for an instant at the keyframe.
   * - 'linear': constant speed, no stop: good for a continuous slow drift.
   * - 'in': starts slow and accelerates (ease-in): good for "falling away".
   */
  ease?: 'smooth' | 'linear' | 'in';
}

// The strike goes UPWARD: the palm rises from under the gun and slaps the
// hammer. The contact comes early (8%), because the shot fires the instant
// you click. Then the hand sinks SLOWLY below the hammer, without stopping
// (emphasis: the pose reads clearly), and finally falls out of the screen.
const IDLE: Pose = { t: 1, x: -0.05, y: -0.26, z: 0.03, roll: 0.1, ease: 'in' }; // below the screen
const FAN: Pose[] = [
  { t: 0, x: -0.035, y: -0.03, z: 0.03, roll: 0.15 }, // low, under the gun, winding up
  { t: 0.08, x: -0.006, y: 0.084, z: 0.025, roll: 0 }, // CONTACT: palm slaps the hammer upward
  { t: 0.15, x: -0.002, y: 0.098, z: 0.028, roll: -0.05 }, // small overshoot past it
  { t: 0.25, x: -0.008, y: 0.05, z: 0.03, roll: 0, ease: 'linear' }, // drops under the hammer...
  { t: 0.65, x: -0.016, y: 0.0, z: 0.03, roll: 0.05, ease: 'linear' }, // ...keeps sinking, slowly
  IDLE, // then falls out of view, accelerating
];

/** Smooth start and end (no sudden jumps): the classic "smoothstep" curve. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Places the left hand for animation progress `t` (0..1; ≥ 1 = idle).
 * Finds the two keyframes around `t` and blends between them.
 */
export function poseLeftHand(hand: THREE.Group, t: number): void {
  let pose = IDLE;
  if (t < 1) {
    for (let i = 0; i < FAN.length - 1; i++) {
      const a = FAN[i];
      const b = FAN[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = (t - a.t) / (b.t - a.t);
        const k = b.ease === 'linear' ? u : b.ease === 'in' ? u * u : smoothstep(u);
        pose = {
          t,
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
          roll: a.roll + (b.roll - a.roll) * k,
        };
        break;
      }
    }
  }
  hand.position.set(pose.x, pose.y, pose.z);
  hand.rotation.set(0, 0, pose.roll);
}
