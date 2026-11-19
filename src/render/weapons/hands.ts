// Blocky hands (Minecraft style): leather gloves and the sleeves of a duster
// coat, all made of boxes. The right hand holds the revolver's grip; the left
// hand "fans" the hammer at every shot — the classic western gunslinger move.
import * as THREE from 'three';
import { PixelCanvas, seededRandom, shade } from '../props/pixelCanvas';

/** Worn leather glove. */
function gloveTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 8);
  const rand = seededRandom(31);
  c.fill(0x6a4428);
  c.noise(rand, 0.25);
  for (let x = 0; x < 8; x++) c.set(x, 0, shade(0x6a4428, 0.6)); // seam at the cuff
  c.set(2, 4, 0x8a6040);
  c.set(5, 2, 0x8a6040); // scuffs
  return c.toTexture();
}

/** Dusty coat sleeve, with a darker cuff band. */
function sleeveTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 16);
  const rand = seededRandom(32);
  c.fill(0x4a4038);
  c.noise(rand, 0.2);
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 8; x++) if (rand() < 0.3) c.set(x, y, 0x3a3028); // fabric folds
  for (let x = 0; x < 8; x++) {
    c.set(x, 0, 0x2a2420);
    c.set(x, 1, 0x2a2420); // cuff
  }
  return c.toTexture();
}

export interface Hands {
  /** Goes inside the gun's group: holds the grip, recoils with the gun. */
  right: THREE.Group;
  /** Goes inside the viewmodel holder: moved by the fanning animation. */
  left: THREE.Group;
}

export function createHands(): Hands {
  const glove = new THREE.MeshStandardMaterial({ map: gloveTexture(), roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ map: sleeveTexture(), roughness: 1 });
  const box = (sx: number, sy: number, sz: number, m: THREE.Material) =>
    new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);

  // --- Right hand, wrapped around the grip (grip is tilted back by 0.35 rad) ---
  const right = new THREE.Group();
  right.position.set(0, -0.03, 0.032);
  right.rotation.x = 0.35; // same angle as the grip
  const palm = box(0.034, 0.06, 0.05, glove); // fist around the grip
  palm.position.set(0.004, 0, 0.004);
  right.add(palm);
  const thumb = box(0.012, 0.012, 0.03, glove); // thumb resting on the frame
  thumb.position.set(-0.016, 0.03, -0.012);
  right.add(thumb);
  // Forearm: goes back and down, out of the screen.
  const rightArm = box(0.048, 0.048, 0.3, sleeve);
  rightArm.position.set(0.012, -0.03, 0.17);
  rightArm.rotation.x = -0.45;
  right.add(rightArm);

  // --- Left hand: flat palm (facing down) + forearm going back-left ---
  const left = new THREE.Group();
  const leftPalm = box(0.05, 0.018, 0.07, glove);
  left.add(leftPalm);
  const leftThumb = box(0.012, 0.012, 0.03, glove);
  leftThumb.position.set(0.028, -0.004, 0.005);
  left.add(leftThumb);
  // The forearm must leave the screen toward the bottom-left, like an arm
  // coming from off-camera. A box is built along Z; rotating it around X
  // tilts its back end DOWN, around Y swings it to the LEFT.
  // Nearly horizontal: rotating around Y by ~-1.25 rad turns the box (built
  // along Z) so its far end points LEFT; a small X tilt lowers it a bit.
  const leftArm = box(0.04, 0.04, 0.24, sleeve);
  leftArm.position.set(-0.115, -0.025, 0.04);
  leftArm.rotation.set(0.2, -1.25, 0);
  left.add(leftArm);

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
}

// The strike goes UPWARD: the palm rises from under the gun and slaps the
// hammer. The contact comes early (10%), because the shot fires the instant
// you click. Then the hand HOLDS still just under the hammer for a moment
// (emphasis: the pose reads clearly), and finally drops out of the screen.
const IDLE: Pose = { t: 1, x: -0.05, y: -0.24, z: 0.03, roll: 0.1 }; // below the screen: invisible
const FAN: Pose[] = [
  { t: 0, x: -0.035, y: -0.03, z: 0.03, roll: 0.15 }, // low, under the gun, winding up
  { t: 0.1, x: -0.006, y: 0.084, z: 0.025, roll: 0 }, // CONTACT: palm slaps the hammer upward
  { t: 0.18, x: -0.002, y: 0.1, z: 0.028, roll: -0.05 }, // small overshoot past it
  { t: 0.26, x: -0.008, y: 0.072, z: 0.03, roll: 0 }, // settles just under the hammer...
  { t: 0.6, x: -0.01, y: 0.068, z: 0.03, roll: 0 }, // ...and HOLDS there
  IDLE, // then drops out of view
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
        const k = smoothstep((t - a.t) / (b.t - a.t));
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
