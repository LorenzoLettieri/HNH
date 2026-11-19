// The kicking leg, seen from your own eyes: a front kick ("push kick") with
// the LEFT leg. The leg comes up from the bottom-left corner of the screen,
// diagonally toward the center, the boot pushes forward (toe ahead, sole
// toward the enemy), holds for an instant, and drops back out of view.
// Same building blocks as the hands: boxes with tiny pixel-art textures,
// living in the viewmodel scene (drawn on top of the world, never in a wall).
//
// Readability tricks (a few boxes must say "cowboy boot" at a glance):
// - contrast: blue-grey jeans vs warm tan leather vs near-black sole;
// - the classic SILHOUETTE: tall shaft with a dark top band and pull tabs,
//   a foot that narrows into a pointed toe, a separate heel block;
// - details that only a western boot has: decorative stitching on the
//   shaft, a spur strap with a brass concho, a spur rowel at the heel.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import { PixelCanvas, seededRandom, shade } from '../props/pixelCanvas';

const TAN = 0x9a6236;
/** Ankle angle, radians: negative = toe tipped forward, away from the shin (see createBoot). */
const FOOT_ANGLE = -1.0;

/** Tan leather with the classic wavy decorative stitching of a cowboy boot. */
function shaftTexture(): THREE.Texture {
  const c = new PixelCanvas(16, 16);
  const rand = seededRandom(41);
  c.fill(TAN);
  c.noise(rand, 0.18);
  // Two wavy lines of light stitching: a sine wave, one pixel every other column.
  for (let x = 0; x < 16; x += 2) {
    const y = Math.round(7 + Math.sin(x * 0.8) * 2.5);
    c.set(x, y, 0xe0b880);
    c.set(x, y + 4, 0xe0b880);
  }
  return c.toTexture();
}

/** Plain tan leather for the foot, worn darker toward the edges. */
function footTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 8);
  const rand = seededRandom(42);
  c.fill(TAN);
  c.noise(rand, 0.2);
  for (let i = 0; i < 8; i++) {
    c.set(i, 0, shade(TAN, 0.75));
    c.set(0, i, shade(TAN, 0.75));
  }
  c.set(5, 3, 0xb87a48); // a shiny scuff
  return c.toTexture();
}

/** Faded blue-grey jeans: a cold color, so the warm boot stands out. */
function jeansTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(43);
  c.fill(0x46526a);
  c.noise(rand, 0.2);
  for (let y = 3; y < 16; y += 5) for (let x = 0; x < 8; x++) if (rand() < 0.4) c.set(x, y, 0x343e52); // folds
  for (let y = 0; y < 16; y++) c.set(6, y, 0x5a6680); // the side seam
  return c.toTexture();
}

/** Hobnailed sole: nearly black, with a few nail heads catching the light. */
function soleTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(44);
  c.fill(0x241a14);
  c.noise(rand, 0.2);
  for (let y = 2; y < 14; y += 3) {
    c.set(2, y, 0x7a7068);
    c.set(5, y + 1, 0x7a7068);
  }
  return c.toTexture();
}

/**
 * Builds the leg. Local coordinates, origin at the ANKLE:
 * - the shin runs along +Z (back toward the hip);
 * - the foot is built pointing up, +Y, sole facing -Z, then tipped forward
 *   at the ankle by FOOT_ANGLE.
 * The animation then turns this whole group into place (see poseBoot).
 */
export function createBoot(): THREE.Group {
  const shaft = new THREE.MeshStandardMaterial({ map: shaftTexture(), roughness: 0.7 });
  const footMat = new THREE.MeshStandardMaterial({ map: footTexture(), roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.8 }); // dark leather
  const jeans = new THREE.MeshStandardMaterial({ map: jeansTexture(), roughness: 1 });
  const sole = new THREE.MeshStandardMaterial({ map: soleTexture(), roughness: 0.9 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd0a048, roughness: 0.35, metalness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9aa0, roughness: 0.4, metalness: 0.8 });
  const leg = new THREE.Group();
  const box = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    leg.add(mesh);
    return mesh;
  };

  // --- The leg: jeans tucked into a tall boot shaft ---
  box(0.11, 0.11, 0.7, jeans, 0, 0, 0.6); // shin + knee, out of the screen
  box(0.13, 0.13, 0.3, shaft, 0, 0, 0.1); // the boot's shaft
  box(0.14, 0.14, 0.035, dark, 0, 0, 0.255); // dark band at the top of the shaft
  box(0.02, 0.05, 0.03, dark, 0.07, 0.02, 0.27); // pull tabs, sticking out of the top
  box(0.02, 0.05, 0.03, dark, -0.07, 0.02, 0.27);

  // --- The foot: its own group, hinged at the ankle ---
  // A real ankle isn't a 90° corner: in a kick the toes point forward. The
  // foot is built toe-up (+Y) like the leg's frame, then the whole group is
  // turned around the ankle by FOOT_ANGLE: toe forward, sole down-forward.
  // (A group inside a group: its rotation is relative to the parent, like
  // a CSS transform on a child element.)
  const foot = new THREE.Group();
  foot.rotation.x = FOOT_ANGLE;
  leg.add(foot);
  const fbox = (sx: number, sy: number, sz: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = box(sx, sy, sz, m, x, y, z);
    foot.add(mesh); // add() moves it from the leg into the foot
    return mesh;
  };
  fbox(0.115, 0.17, 0.11, footMat, 0, 0.1, -0.01); // instep
  fbox(0.075, 0.1, 0.07, footMat, 0, 0.23, -0.035); // the toe: narrower and flatter,
  fbox(0.04, 0.04, 0.045, footMat, 0, 0.29, -0.05); // ending in a point (on the sole's side)
  fbox(0.12, 0.3, 0.025, sole, 0, 0.12, -0.075); // the sole
  fbox(0.1, 0.07, 0.06, sole, 0, -0.04, -0.1); // the heel block, under the sole

  // --- Western details ---
  fbox(0.125, 0.025, 0.12, dark, 0, 0.04, -0.01); // spur strap over the instep
  fbox(0.012, 0.035, 0.035, brass, -0.066, 0.04, -0.01); // brass concho on the outer side
  fbox(0.015, 0.015, 0.07, steel, 0, -0.05, 0.05); // spur shank, behind the heel
  const rowel = fbox(0.008, 0.05, 0.05, steel, 0, -0.05, 0.09); // the rowel: a little steel star
  rowel.rotation.x = Math.PI / 4;
  return leg;
}

// --- Animation ------------------------------------------------------------
// Poses of the whole leg in the viewmodel camera's space (meters; -Z =
// forward). `tilt` drops the knee end toward you (rotation around X),
// `yaw` swings the knee end to the LEFT (rotation around Y): the leg comes
// in diagonally from the bottom-left corner toward the center of the screen.
// `roll` leans the toe a little inward.
interface LegPose {
  x: number;
  y: number;
  z: number;
  tilt: number;
  yaw: number;
  roll: number;
}
const HIDDEN: LegPose = { x: -0.35, y: -0.55, z: -0.3, tilt: 0.9, yaw: -0.9, roll: 0.3 }; // bottom-left, off screen
const OUT: LegPose = { x: -0.07, y: -0.25, z: -0.62, tilt: 0.4, yaw: -0.55, roll: 0.1 }; // the foot lands here
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
  const mix = (key: keyof LegPose) => HIDDEN[key] + (OUT[key] - HIDDEN[key]) * out;
  // The push goes along the leg's direction (forward and a bit to the right).
  const p = push * PUSH * out;
  leg.position.set(mix('x') + p * 0.4, mix('y'), mix('z') - p);
  leg.rotation.set(mix('tilt'), mix('yaw'), mix('roll'));
  return out;
}
