// The double-barrel shotgun in your hands: public/models/doubleBarrel.glb,
// our own model, started from "Shotgun Double Barrel" by CreativeTrio (the
// original is in assets-src/double-barrel/). Already in the viewmodel's
// conventions (barrel along -Z, meters, origin = the right hand on the grip)
// and split into moving parts, each with its ORIGIN on its pivot:
//
//   stock         doesn't move
//   ├── barrels   barrels + fore-end, origin on the HINGE: rotate to break it open
//   │   ├── shell_R   the two cartridges (added by us), origin at the rim:
//   │   └── shell_L   slide them back to eject, forward to load
//   └── lever     the top lever, origin at its front end: swings aside to open
//
// The animations are written IN CODE as a timeline (phases as fractions of
// the reload time), because the reload lasts tuning.shotgunReloadTime, which
// the debug panel can change: the timeline stretches with it for free.
// Everything is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { loadGunModel } from './gunModel';
import { createHands } from './hands';

/** How far the barrels drop when the gun is broken open, radians. */
const OPEN_ANGLE = 0.75;
/** How far the top lever swings aside to open the gun, radians. */
const LEVER_ANGLE = 0.45;

// Reload timeline, as fractions of the reload time (0 = start, 1 = done).
// The sounds in audio/sfx.ts (playShotgunReload) follow the same numbers.
const LEVER_END = 0.08; // lever pushed aside...
const OPEN_END = 0.14; // ...barrels down
const EJECT_START = 0.14;
const EJECT_END = 0.42; // the spent shells have flown away
const INSERT = [
  [0.44, 0.58], // right shell slides in
  [0.58, 0.72], // left shell
] as const;
const CLOSE_START = 0.78;
const CLOSE_END = 0.86; // snapped shut (the lever springs back with it)

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
  onReload(): void;
  /** Stop any reload animation (weapon switched away). */
  cancel(): void;
  /** Advance the animations. Returns how much the gun is tilted for the reload, 0..1. */
  update(dt: number, player: PlayerState): number;
}

export function createShotgunView(): ShotgunView {
  const root = new THREE.Group();

  // Parts of the model, filled in when the file has loaded.
  let barrels: THREE.Object3D | null = null;
  let lever: THREE.Object3D | null = null;
  const shells: THREE.Object3D[] = []; // index 0 = right barrel (fired first)
  const shellRest: THREE.Vector3[] = [];
  root.add(
    loadGunModel('doubleBarrel.glb', (model) => {
      barrels = model.getObjectByName('barrels') ?? null;
      lever = model.getObjectByName('lever') ?? null;
      for (const name of ['shell_R', 'shell_L']) {
        const shell = model.getObjectByName(name);
        if (shell) {
          shells.push(shell);
          shellRest.push(shell.position.clone());
        }
      }
    }),
  );

  // One hand only: the right arm posed on this gun's grip (see hands.ts).
  // The left hand stays out of view.
  root.add(createHands().rightShotgun);

  let reloadTime = -1; // seconds since the reload started (-1 = not reloading)

  return {
    root,
    muzzles: [new THREE.Vector3(0.011, 0.077, -0.77), new THREE.Vector3(-0.003, 0.077, -0.77)],
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

      // --- Top lever: pushed aside first, springs back when the gun snaps shut ---
      const shut = phase(t, CLOSE_START, CLOSE_END) ** 2;
      if (lever) lever.rotation.y = t < 0 ? 0 : -LEVER_ANGLE * smoothstep(t / LEVER_END) * (1 - shut);

      // --- Barrels: down, wait, snap back up (around the hinge: their origin) ---
      const open = t < 0 ? 0 : smoothstep(phase(t, LEVER_END * 0.5, OPEN_END)) * (1 - shut);
      if (barrels) barrels.rotation.x = -OPEN_ANGLE * open;

      // --- Shells: the old ones fly out backward, the new ones slide in ---
      // (They are children of the barrels: their positions are in the
      // barrels' space, so "backward" is along the chambers even when open.)
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
          const [a0, b0] = INSERT[i];
          const k = phase(t, a0, b0);
          shell.visible = t >= a0;
          shell.position.z += 0.07 * (1 - smoothstep(k));
          shell.position.y -= 0.025 * (1 - smoothstep(k * 1.6));
        }
      });

      return t < 0 ? 0 : Math.sin(Math.PI * t); // 0 → 1 → 0: the gun tilts in, then back
    },
  };
}
