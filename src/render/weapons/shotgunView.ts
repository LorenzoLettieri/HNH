// The double-barrel shotgun in your hands: the model made in Blender
// (tools/blender/shotgun.py → public/models/shotgun.glb) plus the hands, and
// its mechanical animations, all done IN CODE by rotating the model's parts:
//
//   barrels   turn around the hinge pin: break the gun open to reload
//   shell_*   slide out of the chambers (ejected) and back in (new ones)
//   hammer_*  drop forward when their barrel fires, are cocked back at the end of the reload
//
// Why not a baked animation clip, like the kick? Because the reload must last
// exactly tuning.shotgunReloadTime, which you can change from the debug
// panel: a timeline written in code (phases as fractions of the reload)
// stretches with it for free.
//
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { createHands } from './hands';

/** How far the barrels drop when the gun is broken open, radians. */
const OPEN_ANGLE = 0.75;
/** Hammer rotation when cocked (the model is built with the hammers DOWN, at 0). */
const HAMMER_COCKED = 0.75;

// Reload timeline, as fractions of the reload time (0 = start, 1 = done).
// The sounds in audio/sfx.ts (playShotgunReload) follow the same numbers.
const OPEN_END = 0.14; // barrels down
const EJECT_START = 0.14;
const EJECT_END = 0.42; // the spent shells have flown away
const INSERT = [
  [0.44, 0.58], // right shell slides in
  [0.58, 0.72], // left shell
] as const;
const CLOSE_START = 0.78;
const CLOSE_END = 0.86; // snapped shut
const COCK_START = [0.88, 0.94] as const; // the two hammers, one after the other
const COCK_TIME = 0.05;

function smoothstep(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}
/** Progress 0..1 of `t` between `a` and `b` (clamped). */
function phase(t: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (t - a) / (b - a)));
}

export interface ShotgunView {
  /** Goes inside the viewmodel holder. Its origin is the right hand on the grip. */
  root: THREE.Group;
  /** Muzzle of each barrel (0 = right, 1 = left), in root coordinates. */
  muzzles: [THREE.Vector3, THREE.Vector3];
  onFire(barrel: number): void;
  onReload(): void;
  /** Stop any reload animation (weapon switched away). */
  cancel(): void;
  /** Advance the animations. Returns how much the gun is tilted for the reload, 0..1. */
  update(dt: number, player: PlayerState): number;
}

export function createShotgunView(): ShotgunView {
  const root = new THREE.Group();

  // Hands: the same blocky gloves as the revolver, posed differently. The
  // right hand wraps the pistol grip (the grip leans forward ~0.55 rad), the
  // left one holds the wooden fore-end from below.
  const hands = createHands();
  hands.right.position.set(0, -0.004, 0.02);
  hands.right.rotation.set(-0.5, 0, 0);
  hands.right.scale.setScalar(1.15);
  // The forearm goes down and back from the wrist, out of the screen.
  hands.rightArm.position.set(0.01, -0.15, 0.08);
  hands.rightArm.rotation.set(1.25, 0, 0);
  root.add(hands.right);

  // Parts of the model, filled in when the file has loaded.
  let barrels: THREE.Object3D | null = null;
  const shells: THREE.Object3D[] = [];
  const hammers: THREE.Object3D[] = [];
  const shellRest: THREE.Vector3[] = [];

  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/shotgun.glb`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.map) {
        // Crisp pixels at any distance: no blurring, no mipmaps.
        m.map.magFilter = THREE.NearestFilter;
        m.map.minFilter = THREE.NearestFilter;
        m.map.generateMipmaps = false;
      }
    });
    root.add(gltf.scene);
    // Find the parts by the names given in Blender. Index 0 = right barrel.
    barrels = gltf.scene.getObjectByName('barrels') ?? null;
    for (const side of ['R', 'L']) {
      const shell = gltf.scene.getObjectByName(`shell_${side}`);
      const hammer = gltf.scene.getObjectByName(`hammer_${side}`);
      if (shell) {
        shells.push(shell);
        shellRest.push(shell.position.clone());
      }
      if (hammer) hammers.push(hammer);
    }
    // The left hand rides on the barrels: when you break the gun open, the
    // hand pushing the fore-end down goes with it.
    if (barrels) {
      hands.left.position.set(-0.004, -0.03, -0.1);
      hands.left.rotation.set(0, 0, 0.1);
      // The forearm comes from below-left, toward the camera (not sideways
      // like for the revolver, where the hand is busy fanning).
      hands.leftArm.position.set(-0.06, -0.055, 0.1);
      hands.leftArm.rotation.set(0.45, -0.5, 0);
      barrels.add(hands.left);
    }
  });

  let reloadTime = -1; // seconds since the reload started (-1 = not reloading)
  // Hammer angles: they snap down when their barrel fires.
  const hammerAngle = [HAMMER_COCKED, HAMMER_COCKED];

  return {
    root,
    muzzles: [new THREE.Vector3(0.0155, 0.056, -0.435), new THREE.Vector3(-0.0155, 0.056, -0.435)],
    onFire(barrel) {
      hammerAngle[barrel] = 0;
    },
    onReload() {
      reloadTime = 0;
    },
    cancel() {
      reloadTime = -1;
    },
    update(dt, player) {
      let t = -1; // reload progress 0..1, or -1
      if (reloadTime >= 0) {
        reloadTime += dt;
        t = reloadTime / tuning.shotgunReloadTime;
        // Done, or interrupted (e.g. you died): back to normal.
        if (t >= 1 || (player.reloadTicks === 0 && t < 0.9)) {
          reloadTime = -1;
          t = -1;
        }
      }

      // --- Barrels: down, wait, snap back up ---
      const open = t < 0 ? 0 : smoothstep(t / OPEN_END) * (1 - phase(t, CLOSE_START, CLOSE_END) ** 2);
      if (barrels) barrels.rotation.x = -OPEN_ANGLE * open;

      // --- Shells: the old ones fly out backward, the new ones slide in ---
      shells.forEach((shell, i) => {
        const rest = shellRest[i];
        shell.visible = true;
        shell.position.copy(rest);
        shell.rotation.set(0, 0, 0);
        if (t < 0) return;
        if (t < EJECT_END) {
          // Ejected: out the back (+z) and up, then gravity pulls it down:
          // a parabola, y = up·k − fall·k². Tumbling as it goes.
          const k = phase(t, EJECT_START, EJECT_END) * (1 + i * 0.15);
          shell.position.z += 0.14 * k;
          shell.position.y += 0.2 * k - 0.5 * k * k;
          shell.position.x += (i === 0 ? 0.1 : 0.06) * k;
          shell.rotation.x = 7 * k;
          shell.visible = k < 1;
        } else {
          // Hidden until "picked up", then pushed into the chamber.
          const [a, b] = INSERT[i];
          const k = phase(t, a, b);
          shell.visible = t >= a;
          shell.position.z += 0.07 * (1 - smoothstep(k));
          shell.position.y -= 0.025 * (1 - smoothstep(k * 1.6));
        }
      });

      // --- Hammers: down after their barrel fired; cocked again at the end of the reload ---
      hammers.forEach((hammer, i) => {
        if (t >= 0) {
          const k = phase(t, COCK_START[i], COCK_START[i] + COCK_TIME);
          if (k > 0) hammerAngle[i] = HAMMER_COCKED * smoothstep(k);
        } else if (player.reloadTicks === 0) {
          // Not reloading: the state decides (a barrel with no shell has its hammer down).
          // Shells are fired right barrel first: 1 shell left = right hammer down.
          const fired = i === 0 ? player.shells < tuning.shotgunAmmo : player.shells < tuning.shotgunAmmo - 1;
          if (!fired) hammerAngle[i] = HAMMER_COCKED;
        }
        hammer.rotation.x = hammerAngle[i];
      });

      return t < 0 ? 0 : Math.sin(Math.PI * t); // 0 → 1 → 0: the gun tilts in, then back
    },
  };
}
