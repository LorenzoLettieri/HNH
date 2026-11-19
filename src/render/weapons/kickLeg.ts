// The kicking leg: a real model with a skeleton and an animation, made in
// Blender by tools/blender/leg.py and exported as public/models/leg.glb.
//
// glTF ("the JPEG of 3D") is the standard format for 3D on the web: one file
// with the meshes, textures, the skeleton and the animation clips. Three.js
// reads it with GLTFLoader (the official loader: it parses the file and gives
// us ordinary Three.js objects, nothing hidden).
//
// The model is built in CAMERA space (its origin is your eye), so it goes
// straight into the viewmodel scene, next to the revolver.
//
// Skeletal animation in Three.js, in three pieces:
// - SkinnedMesh: a mesh whose vertices follow bones (the "skinning" weights
//   painted in Blender). Moving a bone deforms the mesh, on the GPU.
// - AnimationClip: the recorded movement (a rotation per bone per frame).
// - AnimationMixer: the "player" that advances clips in time and writes the
//   bone rotations. An AnimationAction is one clip playing in a mixer, with
//   its own speed, looping, etc. (think of an <audio> element: play, reset, rate).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tuning } from '../../sim/config';

// Frames of the clip, at 60 fps (same numbers as in tools/blender/leg.py).
const IMPACT_TIME = 5 / 60; // the boot lands
const HOLD_END_TIME = 10 / 60; // still out
const GONE_TIME = 17 / 60; // back out of view (the rest of the clip is off screen)

export interface KickLeg {
  /** Goes in the viewmodel scene. */
  root: THREE.Group;
  /** Start the kick animation from the beginning. */
  play(): void;
  /** Advance the animation. Returns how "out" the leg is, 0..1 (to move the gun aside). */
  update(dt: number): number;
}

export function createKickLeg(): KickLeg {
  const root = new THREE.Group();
  root.visible = false;
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  let duration = 0;
  let time = Infinity; // seconds of CLIP time since the kick started

  // Loading is asynchronous (like fetch()): until it's done, kicks just
  // don't show a leg. The game doesn't wait for it.
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/leg.glb`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // A skinned mesh's bounding box is computed in the rest pose (standing,
      // way below the screen): Three.js would think it's off screen and skip it.
      o.frustumCulled = false;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.map) {
        // Crisp pixels at any distance: no blurring, no mipmaps.
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
      }
    });
    root.add(gltf.scene);
    const clip = gltf.animations[0];
    duration = clip.duration;
    mixer = new THREE.AnimationMixer(gltf.scene);
    action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; // stay on the last frame (leg down) instead of snapping back
  });

  /** 0 → 1 while the leg goes out, 1 while it holds, back to 0 as it leaves. */
  function envelope(t: number): number {
    if (t < IMPACT_TIME) return t / IMPACT_TIME;
    if (t < HOLD_END_TIME) return 1;
    return Math.max(0, 1 - (t - HOLD_END_TIME) / (GONE_TIME - HOLD_END_TIME));
  }

  return {
    root,
    play() {
      time = 0;
      action?.reset().play();
    },
    update(dt) {
      if (!mixer || !action) return 0;
      // Play the clip faster or slower so the boot lands EXACTLY when the
      // simulation deals the damage (tuning.kickWindup), whatever its value.
      const speed = IMPACT_TIME / Math.max(tuning.kickWindup, 0.02);
      action.timeScale = speed;
      mixer.update(dt);
      time += dt * speed;
      root.visible = time < duration;
      return root.visible ? envelope(time) : 0;
    },
  };
}
