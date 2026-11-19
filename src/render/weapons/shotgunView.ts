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

/** Where the arms hold this gun (see createShotgunView). */
export const shotgunArmSettings = {
  /** Turn of the right arm around X, radians (negative = fist leans forward, like this grip). */
  rightTilt: -0.3,
  /** The shotgun's grip is thicker than the revolver's: a slightly bigger hand. */
  rightScale: 1.1,
  /** Left palm, in the barrels' coordinates (origin = hinge pin, -z = toward the muzzle). */
  leftX: -0.035,
  leftY: 0.03,
  leftZ: -0.15,
  leftPitch: 0,
  /** After the roll, a turn around the vertical axis sends the forearm back and down instead of to the right. */
  leftYaw: -1.0,
  leftRoll: Math.PI / 2,
};

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

  // Arms: the same model as the revolver's (render/weapons/hands.ts), moved
  // to fit this gun. The right arm is modeled frozen around the REVOLVER's
  // grip, so we move the whole arm: turn it by `armTilt` (the shotgun's grip
  // leans differently), then shift it so the revolver's grip center lands
  // on the shotgun's. The math: we want R·p_revolver + t = p_shotgun, so
  // t = p_shotgun − R·p_revolver (rotate first, then translate: the same
  // order Three.js uses for position/rotation).
  // We don't turn it all the way (the grips differ by ~0.9 rad): the forearm
  // would swing up into your face. A fist is forgiving: nobody notices.
  const hands = createHands();
  hands.right.rotation.set(shotgunArmSettings.rightTilt, 0, 0);
  hands.right.scale.setScalar(shotgunArmSettings.rightScale);
  const revolverGrip = new THREE.Vector3(0, -0.028, 0.03).multiplyScalar(shotgunArmSettings.rightScale);
  const shotgunGrip = new THREE.Vector3(0.004, -0.012, 0.014);
  hands.right.position.copy(shotgunGrip).sub(revolverGrip.applyEuler(hands.right.rotation));
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
      // The left arm is modeled palm DOWN (for the fanning). Rolled 90°
      // around the forward axis, the palm faces right: the hand grabs the
      // left side of the fore-end; then a yaw swings the forearm back and
      // down, out of the bottom of the screen. (Three.js applies the Euler
      // angles Z first, then Y, then X: roll, then yaw.) Coordinates are the
      // barrels' (origin on the hinge pin).
      const a = shotgunArmSettings;
      hands.left.position.set(a.leftX, a.leftY, a.leftZ);
      hands.left.rotation.set(a.leftPitch, a.leftYaw, a.leftRoll);
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
