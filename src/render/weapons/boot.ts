// The kicking boot, seen from your own eyes: a front kick ("push kick").
// The leg comes up from below the screen, the boot pushes forward with the
// toe up (the sole toward the enemy, the leather instep toward you), holds
// for an instant, and drops back out of view.
// Same building blocks as the hands: boxes with tiny pixel-art textures,
// living in the viewmodel scene (drawn on top of the world, never in a wall).
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { PixelCanvas, seededRandom, shade } from '../props/pixelCanvas';

/** Scuffed brown leather with a stitched seam down the middle. */
function leatherTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(41);
  c.fill(0x8a5a32);
  c.noise(rand, 0.25);
  for (let y = 1; y < 16; y += 2) c.set(4, y, 0xc09060); // stitches
  for (let x = 0; x < 8; x++) c.set(x, 0, shade(0x8a5a32, 0.6)); // worn toe cap edge
  c.set(1, 5, 0xa87040);
  c.set(6, 10, 0xa87040); // scuffs
  return c.toTexture();
}

/** Dark, dusty trouser cloth. */
function clothTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(42);
  c.fill(0x4a4038);
  c.noise(rand, 0.2);
  for (let y = 2; y < 16; y += 5) for (let x = 0; x < 8; x++) if (rand() < 0.35) c.set(x, y, 0x2a2420); // folds
  return c.toTexture();
}

/** Hobnailed sole: nearly black, with a few nail heads catching the light. */
function soleTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(43);
  c.fill(0x241a14);
  c.noise(rand, 0.2);
  for (let y = 2; y < 14; y += 3) {
    c.set(2, y, 0x7a7068);
    c.set(5, y + 1, 0x7a7068);
  }
  return c.toTexture();
}

/**
 * Builds the leg. Local coordinates: the origin is the middle of the sole;
 * the sole faces -Z (away from you), the toe is up (+Y), the shin goes back
 * toward you (+Z) and down, out of the screen.
 */
export function createBoot(): THREE.Group {
  const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.75 });
  const cloth = new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 1 });
  const sole = new THREE.MeshStandardMaterial({ map: soleTexture(), roughness: 0.9 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc09040, roughness: 0.4, metalness: 0.8 });
  const box = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    return mesh;
  };

  const leg = new THREE.Group();
  leg.add(box(0.11, 0.28, 0.025, sole, 0, 0, 0)); // the sole
  leg.add(box(0.11, 0.06, 0.04, sole, 0, -0.11, -0.03)); // the heel, sticking out of the sole
  leg.add(box(0.1, 0.25, 0.08, leather, 0, 0.005, 0.05)); // the foot (instep toward you)
  leg.add(box(0.11, 0.14, 0.18, leather, 0, -0.07, 0.17)); // the boot's shaft, around the ankle
  // Shin: a long box built along Z, tilted so its far end goes down, off screen.
  const shin = box(0.12, 0.12, 0.6, cloth, 0, -0.2, 0.5);
  shin.rotation.x = 0.45;
  leg.add(shin);
  // A spur on the heel: it's a western, after all. Rotated 45°: a little diamond.
  const spur = box(0.012, 0.045, 0.045, brass, 0, -0.15, 0.11);
  spur.rotation.x = Math.PI / 4;
  leg.add(spur);
  return leg;
}

// --- Animation ------------------------------------------------------------
// Positions in the viewmodel camera's space (meters; -Z = forward).
const HIDDEN = { x: 0.03, y: -0.6, z: -0.25, tilt: 0.7 }; // below the screen, toe tilted back
// Extended: a bit right of center (it's the right leg), and tilted forward
// (negative tilt = toe away from you): you look down on the instep, so it
// reads as a foot in perspective and not as a flat slab.
const OUT = { x: 0.04, y: -0.24, z: -0.55, tilt: -0.5 };
const PUSH = 0.05; // extra push forward while holding
const HOLD = 0.08; // seconds it stays out after the contact
const RETRACT = 0.22; // seconds to drop back out of view

/**
 * Places the leg for a kick that started `time` seconds ago (Infinity = no kick).
 * Returns how "out" the leg is, 0..1 (the viewmodel uses it to move the gun aside).
 *
 * The leg reaches full extension EXACTLY when the simulation lands the hit
 * (tuning.kickWindup): picture and damage happen on the same frame.
 * - Going out: ease-OUT (fast start, slow end): a snap, not a lazy swing.
 * - Coming back: ease-IN (slow start, then gone): the pose reads clearly.
 */
export function poseBoot(leg: THREE.Group, time: number): number {
  const windup = Math.max(tuning.kickWindup, 0.03);
  let out: number; // 0 = hidden, 1 = extended
  let push = 0;
  if (time < windup) {
    const u = time / windup;
    out = 1 - (1 - u) * (1 - u); // ease-out
  } else if (time < windup + HOLD) {
    out = 1;
    push = (time - windup) / HOLD;
  } else {
    const u = Math.min(1, (time - windup - HOLD) / RETRACT);
    out = 1 - u * u; // ease-in
    push = 1;
  }
  leg.visible = out > 0.001;
  const lerp = (a: number, b: number) => a + (b - a) * out;
  leg.position.set(lerp(HIDDEN.x, OUT.x), lerp(HIDDEN.y, OUT.y), lerp(HIDDEN.z, OUT.z) - push * PUSH * out);
  leg.rotation.set(lerp(HIDDEN.tilt, OUT.tilt), 0, 0);
  return out;
}
