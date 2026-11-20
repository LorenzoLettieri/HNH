// The gunslinger's arms: bare arms from "PSX First Person Arms" by
// Drillimpact (CC0, original in assets-src/psx-arms/), posed in Blender on
// our revolver and saved as a standalone model, public/models/arms.glb
// (static meshes: the pose is baked into the vertices). Each arm wears a
// rolled-up plaid shirt sleeve (a low-poly tube around the posed arm with a
// fat roll halfway down the forearm, red/black/cream tartan 32x32 texture,
// material "shirt_plaid"), added in Blender too. Three objects:
//   Arm_R  wrapped around the revolver's grip, in the gun's coordinates
//          (origin = the right hand on the grip): it goes in at the origin;
//   Arm_L  open hand, palm down, origin = PALM CENTER (the point the
//          keyframes below move): it "fans" the hammer at every shot, the
//          classic western gunslinger move.
//   Arm_R_Shotgun  the right arm holding the double barrel ONE-HANDED by the
//          wrist of the stock, index on the trigger, in the shotgun's
//          coordinates; posed with the gun where the viewmodel holds it
//          (viewmodelSettings.shotgun*), so the shoulder comes out right.
// No skeleton in the file: the left arm is moved as a whole. (The original
// rig, with IK and 18 animations, is in assets-src/ for when we need it.)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface Hands {
  /** Goes inside the gun's group: holds the grip, recoils with the gun. */
  right: THREE.Group;
  /** Goes inside the viewmodel holder: moved by the fanning animation (origin = palm center). */
  left: THREE.Group;
  /** Goes inside the shotgun's group: the one hand that holds it. */
  rightShotgun: THREE.Group;
}

/**
 * Returns the two groups right away; the models are added inside them when
 * the file has loaded (asynchronous, like fetch()).
 * The model's coordinates are already the gun's (origin = grip), so the
 * right arm just goes in at the origin of the gun's group.
 */
export function createHands(): Hands {
  const right = new THREE.Group();
  const left = new THREE.Group();
  const rightShotgun = new THREE.Group();
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/arms.glb`, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // Never skipped by frustum culling: the arms are always close to the eye.
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
    const armRS = gltf.scene.getObjectByName('Arm_R_Shotgun');
    if (armR) right.add(armR);
    if (armL) left.add(armL);
    if (armRS) rightShotgun.add(armRS);
  });
  return { right, left, rightShotgun };
}

// --- Fanning animation --------------------------------------------------------
// McCree-style fanning (his "Deadeye"): the left forearm lies HORIZONTAL
// across the screen, the hand flat like a blade just above the hammer. At
// every shot the hand sweeps over the hammer and comes back; between shots it
// stays there, READY, and only after `readyHold` seconds without shooting it
// drops out of the screen.
//
// Two layers, added together (the same idea as layered animations in a game
// engine, or a CSS transform made of two translates):
//   1. presence: 0 = out of the screen (LOWERED), 1 = READY pose. It eases
//      toward 1 right after a shot and back to 0 when the hold is over.
//   2. strike: a short sweep, as an OFFSET from wherever the hand is, played
//      at every shot (keyframes below).
// Positions are in the gun holder's coordinates (x right, y up, z back): the
// palm center, which is the origin of the Arm_L model.

/** Mutable so the debug panel can change them. */
export const fanSettings = {
  /** Duration of the sweep over the hammer, seconds (keep it below the revolver's fire interval). */
  strikeTime: 0.17,
  /** How long the hand waits in the ready pose after the last shot, seconds. */
  readyHold: 1.2,
  /** How fast the hand comes up into the ready pose (higher = snappier). */
  raiseRate: 30,
  /** How fast it goes down when the hold is over. */
  lowerRate: 7,
};

/**
 * The ready pose. Arm_L was posed in Blender with the palm just above-left of
 * the hammer (y = 0.085), but there the horizontal forearm fills the middle
 * of the screen: we wait much LOWER, near the bottom edge, and each strike
 * flicks the hand up to the hammer and back. Less realistic, much more
 * readable: the view stays clear.
 */
// It also waits closer to you (z), so the arm passes IN FRONT of the hand
// holding the gun instead of going through it.
const READY = { x: -0.07, y: -0.035, z: 0.12, roll: 0 };
/** Where the palm hits the hammer (where Arm_L was posed in Blender). */
const HAMMER = { x: -0.04, y: 0.085, z: 0.0 };
/** How far the strike moves the hand to get from READY to the hammer. */
const REACH_Y = HAMMER.y - READY.y;
const REACH_X = HAMMER.x - READY.x;
const REACH_Z = HAMMER.z - READY.z;
/** Out of the screen: straight down from the ready pose, so the horizontal arm just sinks. */
const LOWERED = { x: -0.07, y: -0.25, z: 0.12, roll: 0.15 };

interface Key {
  t: number; // 0..1 along the strike
  x: number; // offset from the current pose, meters
  y: number;
  z: number;
  roll: number; // radians
}
// A flick: up from the ready pose to the hammer in a few hundredths of a
// second (the shot fires the instant you click: the hand must get there
// almost at once), the edge of the hand sweeps over it toward you and to the
// right, then it drops back down to wait. The roll turns the arm around the
// palm (the origin of Arm_L): the hand goes up, the elbow stays down at the
// bottom-left, so even the strike doesn't cover the middle of the screen.
const STRIKE: Key[] = [
  { t: 0, x: 0, y: 0, z: 0, roll: 0 }, // ready, low
  { t: 0.15, x: REACH_X, y: REACH_Y, z: REACH_Z - 0.02, roll: 0.45 }, // CONTACT: on the hammer
  { t: 0.4, x: REACH_X + 0.03, y: REACH_Y - 0.02, z: REACH_Z + 0.03, roll: 0.35 }, // swept past it, toward you
  { t: 1, x: 0, y: 0, z: 0, roll: 0 }, // back down to ready
];

/** Smooth start and end (no sudden jumps): the classic "smoothstep" curve. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** The strike offset at progress t (0..1), blending between the two keyframes around it. */
function strikeOffset(t: number): Key {
  for (let i = 0; i < STRIKE.length - 1; i++) {
    const a = STRIKE[i];
    const b = STRIKE[i + 1];
    if (t <= b.t) {
      const k = smoothstep((t - a.t) / (b.t - a.t));
      return {
        t,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        roll: a.roll + (b.roll - a.roll) * k,
      };
    }
  }
  return STRIKE[STRIKE.length - 1];
}

export interface Fanning {
  /** A shot was fired: play the strike, (re)start the ready hold. */
  onShot(): void;
  /** Advance and place the hand. `hide` (0..1) pushes it out of view (e.g. during the reload). */
  update(dt: number, hand: THREE.Group, hide: number): void;
}

export function createFanning(): Fanning {
  let sinceShot = Infinity; // seconds since the last shot
  let presence = 0;
  return {
    onShot() {
      sinceShot = 0;
    },
    update(dt, hand, hide) {
      sinceShot += dt;
      const s = fanSettings;
      const wanted = sinceShot < s.readyHold && hide < 0.5 ? 1 : 0;
      const rate = wanted > presence ? s.raiseRate : s.lowerRate;
      presence = wanted + (presence - wanted) * Math.exp(-rate * dt);
      const p = presence;
      const t = sinceShot / s.strikeTime;
      const k = t < 1 ? strikeOffset(t) : { x: 0, y: 0, z: 0, roll: 0 };
      hand.position.set(
        LOWERED.x + (READY.x - LOWERED.x) * p + k.x,
        LOWERED.y + (READY.y - LOWERED.y) * p + k.y,
        LOWERED.z + (READY.z - LOWERED.z) * p + k.z,
      );
      hand.rotation.set(0, 0, LOWERED.roll + (READY.roll - LOWERED.roll) * p + k.roll);
    },
  };
}
