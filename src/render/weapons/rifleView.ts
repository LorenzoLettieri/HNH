// The lever-action carbine in your hands: public/models/rifle.glb, our own
// model, made by tools/blender/rifle.py from "Rifle" by CreativeTrio (the
// original is in assets-src/rifle/). Already in the viewmodel's conventions
// (barrel along -Z, meters, origin = the right hand on the wrist of the
// stock) and split into moving parts, each with its ORIGIN on its pivot:
//
//   frame          doesn't move
//   â”œâ”€â”€ lever      origin on its pin: rotation.x > 0 swings the loop down (open)
//   â”œâ”€â”€ hammer     origin on its screw: modeled cocked (0); < 0 = fallen (fired)
//   â”œâ”€â”€ trigger    origin at its top: < 0 = pulled
//   â”œâ”€â”€ bolt       the end of the bolt: slides back (+z) when the lever opens
//   â”œâ”€â”€ case       a spent case in the chamber (only a template: hidden)
//   â””â”€â”€ round      a live round at the loading gate (reload)
//
// THE LEVER, the part that has to feel good. After every shot:
//   1. the shot: hammer falls, trigger back, the gun kicks (viewmodel.ts);
//   2. a beat, then the hand THROWS the lever open: it isn't keyframed, it's
//      a tiny physics simulation (Lever below): a constant push, so it
//      accelerates all the way and SLAMS into its stop, bouncing back a
//      little, like a ball hitting the floor. As it opens it drags the bolt
//      back, the bolt cocks the hammer, and the spent case flies out of the
//      top, spinning;
//   3. the hand SLAMS it shut, harder: it bounces on the frame and latches,
//      and the hit jolts the whole gun (an impulse to its pose spring);
//   4. the gun settles. Everything follows the gun's own timeline:
//      keyframes of the whole gun through a damped spring (elastic.ts), so
//      the throw and the snap carry momentum.
// The timeline is in fractions of tuning.rifleFireInterval (debug panel), and
// the sounds in audio/sfx.ts (playCarbineLever) use the same numbers.
//
// THE RELOAD, one round at a time like the simulation: the gun turns its
// right side toward you (where the loading gate is), and every round slides
// up to the gate and is pushed in, with a little dip of the gun at each push.
// Everything here is cosmetic: ammo and timing are decided by the simulation.
import * as THREE from 'three';
import { secondsToTicks, tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { adsAmount, fireInterval } from '../../sim/weapon';
import type { LeverTimes } from '../../audio/sfx';
import { ELASTIC_STEP, PoseSpring, Stroke, ZERO_POSE, phase, poseAt, smoothstep, travelTime, type GunPose } from './elastic';
import { loadGunModel } from './gunModel';
import { createRifleHands } from './hands';
import { createSpentCases, type CaseThrow } from './spentCases';

// --- The scope (the Forge's optic) ------------------------------------------------
// Measured on rifle.glb (each mesh's POSITION accessor has min/max, a free
// bounding box): the front sight's tip is 0.073 above the grip, the receiver
// spans about z âˆ’0.05 â†’ âˆ’0.2, the muzzle is at âˆ’0.73. The scope sits on the
// receiver, its tube a couple of centimeters above the iron sights (which
// stay visible under it, like on a real rifle with "see-through" mounts).
/** Height of the tube's axis above the grip, meters: the eye goes here when aiming (viewmodelSettings.rifleScopeAdsY). */
export const SCOPE_AXIS_Y = 0.097;
const SCOPE_RADIUS = 0.013;
/** Where the tube starts (eyepiece, near you) and ends (objective, toward the muzzle), z in meters. */
const SCOPE_BACK = -0.07;
const SCOPE_FRONT = -0.32;
const SCOPE_BLUED = 0x24242c; // blued steel
const SCOPE_BRASS = 0xb08a3c; // steampunk brass rings
const LENS_GLINT = 0x6a90b0;

/**
 * A scope out of a few cylinders. CylinderGeometry stands along +Y; turned
 * by âˆ’90Â° around X its top (+Y) points to âˆ’Z, along the barrel (the rotation
 * matrix sends y to âˆ’z). radiusTop is then the end toward the muzzle.
 */
function createScope(): THREE.Group {
  const g = new THREE.Group();
  const material = (color: number, emissive = 0) =>
    new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.55, metalness: 0, flatShading: true });
  const blued = material(SCOPE_BLUED);
  const brass = material(SCOPE_BRASS);
  /** A piece of tube from z0 (back) to z1 (front), radius rBack â†’ rFront. */
  const tube = (z0: number, z1: number, rBack: number, rFront: number, m: THREE.Material) => {
    const geo = new THREE.CylinderGeometry(rFront, rBack, z0 - z1, 10).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(0, SCOPE_AXIS_Y, (z0 + z1) / 2);
    g.add(mesh);
  };
  const bell = 0.05;
  tube(SCOPE_BACK, SCOPE_BACK - 0.035, 0.017, SCOPE_RADIUS, blued); // eyepiece
  tube(SCOPE_BACK - 0.035, SCOPE_FRONT + bell, SCOPE_RADIUS, SCOPE_RADIUS, blued); // body
  tube(SCOPE_FRONT + bell, SCOPE_FRONT, SCOPE_RADIUS, 0.021, blued); // objective bell
  for (const z of [SCOPE_BACK - 0.005, SCOPE_FRONT + 0.004]) tube(z, z - 0.006, 0.0185, 0.0185, brass); // brass trim on both ends
  // Two mounts: a brass ring round the tube and a block down to the receiver.
  for (const z of [-0.11, -0.2]) {
    tube(z + 0.006, z - 0.006, SCOPE_RADIUS + 0.002, SCOPE_RADIUS + 0.002, brass);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.012), brass);
    block.position.set(0, SCOPE_AXIS_Y - SCOPE_RADIUS - 0.012, z);
    g.add(block);
  }
  // The lenses: a disc at each end with a faint blue glint (they catch the light).
  const lens = material(0x101820, LENS_GLINT);
  for (const [z, faceBack] of [[SCOPE_FRONT - 0.001, false], [SCOPE_BACK + 0.001, true]] as const) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(faceBack ? 0.015 : 0.019, 10), lens);
    disc.position.set(0, SCOPE_AXIS_Y, z);
    if (!faceBack) disc.rotation.y = Math.PI; // CircleGeometry faces +Z: turn the front one toward the muzzle
    g.add(disc);
  }
  lens.emissiveIntensity = 0.25;
  return g;
}

// --- The Tesla coil (the Forge's carbine) ------------------------------------------
// Measured on rifle.glb like the scope: the barrel's axis is 0.054 above the
// grip (radius ~1 cm), the magazine tube runs under it (y 0.030 → 0.044);
// the left hand holds the fore-end up to about z −0.38. The coil wraps
// barrel AND tube ahead of the hand, up to the front sight; at the muzzle a
// copper ring (the "top load" of a real Tesla coil, where the sparks leap
// from). Built in code, hidden until the Forge.
/** The coil: from COIL_BACK to COIL_FRONT (z), around COIL_AXIS_Y, COIL_TURNS turns of copper wire. */
const COIL_BACK = -0.42;
const COIL_FRONT = -0.68;
const COIL_AXIS_Y = 0.047;
const COIL_RADIUS = 0.027;
const COIL_TURNS = 8;
const COIL_WIRE = 0.0055;
const COPPER = 0xd8781c;
/** The dark iron core inside the coil: it shows between the turns, so at low resolution the coil reads as stripes. */
const CORE = 0x18181e;
const CERAMIC = 0xd8cfb8; // the insulators at the ends
/** The ring at the muzzle: center, size. */
const RING_Z = -0.738;
const RING_Y = 0.054;
const RING_RADIUS = 0.024;
const RING_TUBE = 0.008;
/** The glow of the copper: GLOW_IDLE at rest (0: the crawling sparks are enough), a blue flash at every shot that fades in GLOW_FADE s. */
const GLOW_COLOR = 0x4aa0ff;
const GLOW_IDLE = 0;
const GLOW_SHOT = 3;
const GLOW_FADE = 0.35;
/** Little sparks crawling between the coil and the ring: how many, how likely each is lit in a frame (idle / just fired). */
const ARCS = 3;
const ARC_CHANCE_IDLE = 0.12;
const ARC_CHANCE_SHOT = 0.9;
const ARC_POINTS = 6;
const ARC_COLOR = new THREE.Color(0xb8e0ff).multiplyScalar(4);

/** A helix along −Z: THREE.Curve gives a point for every t in 0..1, TubeGeometry wraps a tube around it. */
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super(); // THREE.Curve's own constructor is protected: a public one here
  }

  getPoint(t: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = t * COIL_TURNS * Math.PI * 2;
    return out.set(Math.cos(a) * COIL_RADIUS, COIL_AXIS_Y + Math.sin(a) * COIL_RADIUS, COIL_BACK + (COIL_FRONT - COIL_BACK) * t);
  }
}

interface TeslaCoil {
  group: THREE.Group;
  fired(): void;
  update(dt: number): void;
}

function createCoil(): TeslaCoil {
  const g = new THREE.Group();
  const copper = new THREE.MeshStandardMaterial({ color: COPPER, emissive: GLOW_COLOR, emissiveIntensity: GLOW_IDLE, roughness: 0.4, metalness: 0, flatShading: true });
  const ceramic = new THREE.MeshStandardMaterial({ color: CERAMIC, roughness: 0.7, metalness: 0, flatShading: true });
  // Low-poly on purpose (4 sides to the wire): at pixel-art resolution a round wire and a square one look the same.
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new Helix(), COIL_TURNS * 10, COIL_WIRE, 4, false), copper));
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(COIL_RADIUS - COIL_WIRE, COIL_RADIUS - COIL_WIRE, COIL_BACK - COIL_FRONT, 10).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: CORE, roughness: 0.8, metalness: 0, flatShading: true }),
  );
  core.position.set(0, COIL_AXIS_Y, (COIL_BACK + COIL_FRONT) / 2);
  g.add(core);
  // Two ceramic insulators holding the coil, one at each end (cylinders turned along −Z, as in the scope).
  for (const z of [COIL_BACK + 0.006, COIL_FRONT - 0.006]) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(COIL_RADIUS + 0.004, COIL_RADIUS + 0.004, 0.012, 10).rotateX(-Math.PI / 2), ceramic);
    disc.position.set(0, COIL_AXIS_Y, z);
    g.add(disc);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 6, 12), copper);
  ring.position.set(0, RING_Y, RING_Z);
  g.add(ring);

  // The crawling sparks: short jagged lines (1 pixel is fine here, the gun is
  // right in your face), redrawn at random every frame.
  const arcMaterial = new THREE.LineBasicMaterial({ color: ARC_COLOR, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const arcs: THREE.Line[] = [];
  for (let i = 0; i < ARCS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geo, arcMaterial);
    line.frustumCulled = false;
    arcs.push(line);
    g.add(line);
  }
  let glow = 0; // 1 right after a shot, fading to 0

  function jagArc(line: THREE.Line): void {
    // From a random point on the coil's front turns to a random point of the ring.
    const a0 = Math.random() * Math.PI * 2;
    const a1 = Math.random() * Math.PI * 2;
    const z0 = COIL_FRONT + Math.random() * 0.06;
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = i / (ARC_POINTS - 1);
      const r = COIL_RADIUS + (RING_RADIUS + RING_TUBE - COIL_RADIUS) * t;
      const angle = a0 + (a1 - a0) * t;
      const wiggle = i === 0 || i === ARC_POINTS - 1 ? 0 : (Math.random() - 0.5) * 0.012;
      pos.setXYZ(
        i,
        Math.cos(angle) * r + wiggle,
        COIL_AXIS_Y + (RING_Y - COIL_AXIS_Y) * t + Math.sin(angle) * r + wiggle,
        z0 + (RING_Z - z0) * t,
      );
    }
    pos.needsUpdate = true;
  }

  return {
    group: g,
    fired() {
      glow = 1;
    },
    update(dt) {
      glow = Math.max(0, glow - dt / GLOW_FADE);
      // A hum that never quite stays still (the coil is "alive"), plus the shot's flash.
      copper.emissiveIntensity = GLOW_IDLE + GLOW_SHOT * glow * glow * (0.7 + Math.random() * 0.3);
      const chance = ARC_CHANCE_IDLE + (ARC_CHANCE_SHOT - ARC_CHANCE_IDLE) * glow;
      for (const line of arcs) {
        line.visible = Math.random() < chance;
        if (line.visible) jagArc(line);
      }
    },
  };
}

// --- The lever ---------------------------------------------------------------
/** How far the lever swings open, radians: the stop it slams into. */
const LEVER_OPEN = 0.85;
/** How hard the hand throws it open / slams it shut, rad/sÂ² (a constant push: it accelerates all the way). */
const LEVER_THROW = 300;
const LEVER_SLAM = 520;
/** Speed kept when it hits a stop (0 = dead stop, 1 = bounces forever). */
const LEVER_BOUNCE_OPEN = 0.3;
const LEVER_BOUNCE_SHUT = 0.2;
/** Below this speed a bounce is over: it rests against the stop, rad/s. */
const LEVER_REST_SPEED = 0.6;
/**
 * How much a slam into a stop jolts the gun, as a kick to the pose spring's
 * speed per rad/s of the lever's speed. Thrown OPEN, the lever yanks the gun
 * down and forward; slammed SHUT it snaps it up and back into the hand.
 */
const SLAM_JOLT_PITCH = 0.08;
const SLAM_JOLT_Y = 0.02;
const SLAM_JOLT_Z = 0.02;
const OPEN_JOLT_SHARE = 0.6;
/**
 * The slams reach your head too: a camera punch, radians per rad/s of the
 * lever's speed. Slammed shut: a nod down (the "CLACK"); thrown open: a small one up.
 */
const PUNCH_SHUT = 0.0006;
const PUNCH_OPEN = 0.0002;
/** Aimed down the sights the cycle is this fraction of the hip one (the sights must stay readable). */
const ADS_CYCLE = 0.35;

// --- Hammer, trigger, bolt -----------------------------------------------------
/** The hammer after the shot, radians (fallen forward onto the firing pin). */
const HAMMER_FIRED = -0.55;
/** A bit past full cock while the bolt holds it back (lever open). */
const HAMMER_OVERCOCK = 0.12;
/** How far the trigger goes back when pulled, radians. */
const TRIGGER_PULL = -0.3;
/** How far the bolt slides back with the lever fully open, meters. */
const BOLT_TRAVEL = 0.03;

// --- The lever cycle: timeline in fractions of rifleFireInterval ---------------
/** When the hand throws the lever open (after the recoil)... */
export const LEVER_THROW_AT = 0.2;
/** ...and when it slams it shut. */
export const LEVER_SHUT_AT = 0.47;
/** The spent case flies out when the lever is this open (fraction of LEVER_OPEN). */
const EJECT_AT = 0.65;

/**
 * When the moments of the cycle happen, seconds after the shot, for the
 * sounds (audio/sfx.ts). The lever accelerates at a constant rate from a
 * stop (see travelTime in elastic.ts).
 */
export function leverTimes(interval: number): LeverTimes {
  const throwAt = LEVER_THROW_AT * interval;
  const shutStart = LEVER_SHUT_AT * interval;
  return {
    throwAt,
    openAt: throwAt + travelTime(LEVER_OPEN, LEVER_THROW),
    ejectAt: throwAt + travelTime(LEVER_OPEN * EJECT_AT, LEVER_THROW),
    shutStart,
    shutAt: shutStart + travelTime(LEVER_OPEN, LEVER_SLAM),
  };
}

/** The spent cases in flight (spentCases.ts): out of the top, to the right, spinning fast. */
const CASE_THROW: CaseThrow = { speed: { x: 0.6, y: 1.5, z: 0.25 }, scatter: 0.3, spin: 25, gravity: 7, life: 0.7 };

// --- The gun's pose: a damped spring chasing keyframes ---------------------------
const POSE_STIFFNESS = 900;
/** Below 1 the gun overshoots its keyframes and swings back: lower = more swagger. */
const POSE_DAMPING_RATIO = 0.36;
const Z = ZERO_POSE;
/**
 * [t, pose] of the lever cycle (t = fraction of rifleFireInterval since the
 * shot). EXAGGERATED on purpose (the badass rule, CLAUDE.md; same recipe as
 * the pump's CYCLE_KEYS): a flick the other way (anticipation), then the
 * lever thrown and the gun CRANKED with it, pulled toward you, muzzle up and
 * rolled onto its LEFT side, toward the middle of the screen (the top of the
 * open action in view while the case flies out), it hangs there, then the
 * slam snaps it back PAST its rest pose and the spring bounces it home. Back
 * on target well before the next shot (0.85).
 * Two things the screenshots taught: the left arm is rigid with the gun, and
 * rolled onto its RIGHT side it swung up over half the screen (onto the left
 * side it drops out of view instead); and an overshoot with the muzzle DOWN
 * swings the stock up into your face, so the slam overshoots in height and
 * depth, barely in pitch.
 */
const CYCLE_KEYS: [number, GunPose][] = [
  [0, Z],
  [LEVER_THROW_AT - 0.06, { x: 0.004, y: -0.004, z: 0, pitch: 0.04, yaw: -0.02, roll: -0.08 }], // anticipation: a flick the other way
  [LEVER_THROW_AT + 0.06, { x: -0.015, y: 0.015, z: 0.04, pitch: 0.16, yaw: 0.1, roll: 0.5 }], // THROW: cranked in, muzzle up, on its side
  [LEVER_SHUT_AT - 0.02, { x: -0.02, y: 0.02, z: 0.045, pitch: 0.18, yaw: 0.12, roll: 0.55 }], // hang (the case in the air)
  [LEVER_SHUT_AT + 0.06, { x: 0.006, y: 0.012, z: -0.035, pitch: -0.03, yaw: -0.03, roll: 0.06 }], // SLAM: snapped back past the rest (the spring swings the roll past it by itself)
  [LEVER_SHUT_AT + 0.17, { x: 0, y: -0.003, z: 0.004, pitch: 0.02, yaw: 0, roll: 0 }], // settling
  [0.85, Z],
  [1, Z],
];
/** A pose scaled by k (the cycle aimed down the sights: less of it). */
function scaled(p: GunPose, k: number): GunPose {
  return { x: p.x * k, y: p.y * k, z: p.z * k, pitch: p.pitch * k, yaw: p.yaw * k, roll: p.roll * k };
}
/**
 * The reload pose: rolled onto its left side, so the RIGHT side (where the
 * loading gate is) faces up toward you; closer, muzzle up a little.
 */
const RELOAD_POSE: GunPose = { x: -0.07, y: 0.02, z: 0.05, pitch: 0.25, yaw: 0.15, roll: 1.15 };
/** The dip of the gun when a round is pushed in, as a speed kick to the spring. */
const PUSH_DIP_Y = -0.15;
const PUSH_DIP_PITCH = -0.5;

// --- Reload: one round through the gate --------------------------------------------
/** Where a round comes from, relative to its place in the gate (right, down, back), meters. */
const ROUND_FROM = new THREE.Vector3(0.05, -0.04, 0.06);
/** Lined up behind the gate, tip at the opening. */
const ROUND_READY = new THREE.Vector3(0.004, 0, 0.035);
/** Pushed in: forward and inward. */
const ROUND_IN = new THREE.Vector3(-0.008, 0, -0.03);
/** Phases of each round, fractions of rifleReloadPerRound: ready by... pushed in by... */
const ROUND_READY_AT = 0.5;
const ROUND_IN_AT = 0.92; // just before the simulation counts it in ('reloadRound': the click)

// --- The draw (weapon switch, viewmodel.ts DRAW_KEYS) ---------------------------------
/**
 * The carbine's signature: it swings in canted, the lever thrown OPEN (the
 * action in view), and the hand slams it shut at this fraction of
 * weaponSwitchTime: the "-CLACK" lands just before it's ready to fire.
 */
const DRAW_SHUT_AT = 0.55;
/** Its pose meanwhile (fractions of weaponSwitchTime): canted like the lever cycle's throw, snapped back by the slam. */
const DRAW_LEVER_KEYS: [number, GunPose][] = [
  [0, { x: -0.004, y: 0.01, z: 0.008, pitch: 0.07, yaw: 0.03, roll: -0.28 }],
  [DRAW_SHUT_AT, { x: -0.004, y: 0.01, z: 0.008, pitch: 0.06, yaw: 0.03, roll: -0.25 }],
  [DRAW_SHUT_AT + 0.14, { x: 0, y: -0.004, z: 0, pitch: -0.03, yaw: 0, roll: 0.04 }],
  [1, Z],
];
/** When the draw's slam happens, seconds after 'weaponSwitch', for the sound. */
export function rifleDrawTimes(): { shutStart: number; shutAt: number } {
  const shutStart = DRAW_SHUT_AT * tuning.weaponSwitchTime;
  return { shutStart, shutAt: shutStart + travelTime(LEVER_OPEN, LEVER_SLAM) };
}

export interface RifleView {
  /** Goes inside the viewmodel holder. Its origin is the right hand on the wrist of the stock. */
  root: THREE.Group;
  /** Muzzle, in root coordinates. */
  muzzle: THREE.Vector3;
  onShot(): void;
  /** The gun is drawn (weapon switch): it comes in with the lever open and slams it shut. */
  draw(): void;
  /** Stop every animation (weapon switched away). */
  cancel(): void;
  /** The camera punch of the lever's slams since the last call (radians, + = up), for the viewmodel. */
  takePunch(): number;
  /** Advance the animations. Returns the pose offsets of the whole gun. */
  update(dt: number, player: PlayerState): GunPose;
}

/** `flightSpace`: where the spent cases fly (the viewmodel scene: they leave the gun behind). */
export function createRifleView(flightSpace: THREE.Object3D): RifleView {
  const root = new THREE.Group();

  // Parts, filled in when the file has loaded. Until then the animations
  // move these empty stand-ins (the code works either way).
  const parts = {
    lever: new THREE.Object3D(),
    hammer: new THREE.Object3D(),
    trigger: new THREE.Object3D(),
    bolt: new THREE.Object3D(),
    case: null as THREE.Object3D | null,
    round: null as THREE.Object3D | null,
  };
  let boltRest = 0;
  const roundRest = new THREE.Vector3();
  root.add(
    loadGunModel('rifle.glb', (model) => {
      parts.lever = model.getObjectByName('lever') ?? parts.lever;
      parts.hammer = model.getObjectByName('hammer') ?? parts.hammer;
      parts.trigger = model.getObjectByName('trigger') ?? parts.trigger;
      parts.bolt = model.getObjectByName('bolt') ?? parts.bolt;
      parts.case = model.getObjectByName('case') ?? null;
      parts.round = model.getObjectByName('round') ?? null;
      boltRest = parts.bolt.position.z;
      if (parts.case) parts.case.visible = false; // only a template for the flying ones
      if (parts.round) {
        roundRest.copy(parts.round.position);
        parts.round.visible = false;
      }
    }),
  );

  // The scope the Forge mounts on it: built in code, hidden until then.
  const scope = createScope();
  scope.visible = false;
  root.add(scope);
  // ...and the Tesla coil round the barrel (the same Forge level: the gun is now the Tesla).
  const coil = createCoil();
  coil.group.visible = false;
  root.add(coil.group);

  // Two hands (see hands.ts): the right one on the wrist with its fingers in
  // the lever's loop, the left one under the fore-end. The right hand has a
  // MORPH TARGET (a second shape of the same mesh, the "lever open" pose):
  // its weight follows the lever, so the hand rides down with it.
  const hands = createRifleHands();
  root.add(hands.right, hands.left);

  // The lever: thrown between its two stops by the hand (Stroke, elastic.ts).
  const lever = new Stroke(LEVER_OPEN, LEVER_THROW, LEVER_SLAM, LEVER_BOUNCE_OPEN, LEVER_BOUNCE_SHUT, LEVER_REST_SPEED);
  const spring = new PoseSpring(POSE_STIFFNESS, POSE_DAMPING_RATIO);
  const cases = createSpentCases(flightSpace, CASE_THROW);
  let leftover = 0;
  let sinceShot = Infinity; // seconds since the last shot
  let hammer = 0; // current hammer angle (0 = cocked)
  let cocked = true; // the bolt has pushed the hammer back since the last shot
  let ejected = true; // the case of the last shot is already out
  let lastRoundK = 0; // progress of the round being pushed in (to catch the push moment)
  const v = new THREE.Vector3();
  let drawTime = Infinity; // seconds since the gun was drawn
  let punch = 0; // camera punch collected since the viewmodel last took it

  return {
    root,
    muzzle: new THREE.Vector3(0, 0.056, -0.727),
    onShot() {
      sinceShot = 0;
      cocked = false;
      ejected = false;
      hammer = HAMMER_FIRED; // the hammer falls at once: it's what fired the shot
      coil.fired(); // the Tesla's copper flashes (only seen when it's the Tesla)
    },
    draw() {
      drawTime = 0;
      lever.reset();
      lever.pos = LEVER_OPEN; // thrown open: the hand slams it shut during the draw
    },
    cancel() {
      sinceShot = Infinity;
      drawTime = Infinity;
      lever.reset();
      cocked = true;
      ejected = true;
      hammer = 0;
      punch = 0;
      cases.clear();
    },
    takePunch() {
      const p = punch;
      punch = 0;
      return p;
    },
    update(dt, player) {
      scope.visible = player.forged.rifle > 0; // the Forge's optic (docs/DESIGN.md Â§6d)
      coil.group.visible = player.forged.rifle > 0; // the Tesla
      if (coil.group.visible) coil.update(dt);
      const interval = fireInterval(player, 'rifle'); // "Leva da pistolero" makes it shorter
      const perRoundTicks = secondsToTicks(tuning.rifleReloadPerRound);
      const reloading = player.reloadTicks > 0;
      // Progress of the round being pushed in (0..1), -1 while the gun is
      // still on its way to the gate (the first round's start time).
      const roundK = reloading && player.reloadTicks <= perRoundTicks ? 1 - player.reloadTicks / perRoundTicks : -1;
      // The moment a round goes in: a dip of the gun (a kick to the spring's speed).
      if (lastRoundK < ROUND_IN_AT && roundK >= ROUND_IN_AT) {
        spring.vel.y += PUSH_DIP_Y;
        spring.vel.pitch += PUSH_DIP_PITCH;
      }
      lastRoundK = roundK;
      // Aimed: a smaller cycle (and smaller slams), so the sights stay usable.
      const cycleScale = 1 - (1 - ADS_CYCLE) * adsAmount(player);

      // --- Lever and gun pose, in small fixed steps (springs need them) ---
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        sinceShot += ELASTIC_STEP;
        drawTime += ELASTIC_STEP;
        const t = sinceShot / interval;
        const drawSpan = Math.max(0.01, tuning.weaponSwitchTime);
        const drawing = drawTime < drawSpan;
        const open = drawing ? drawTime < DRAW_SHUT_AT * drawSpan : t >= LEVER_THROW_AT && t < LEVER_SHUT_AT;
        lever.step(open, ELASTIC_STEP);
        if (lever.impact !== 0) {
          // The lever hit a stop: the whole gun feels it. Slammed shut
          // (negative speed): snapped up and back, the "CLACK" of the cycle.
          // Thrown open: yanked down and forward, a bit less.
          const shut = lever.impact < 0;
          const k = Math.abs(lever.impact) * cycleScale * (shut ? 1 : -OPEN_JOLT_SHARE);
          spring.vel.pitch += SLAM_JOLT_PITCH * k;
          spring.vel.y += SLAM_JOLT_Y * k;
          spring.vel.z += SLAM_JOLT_Z * k;
          punch += lever.impact * cycleScale * (shut ? PUNCH_SHUT : PUNCH_OPEN); // down / up
          lever.impact = 0;
        }
        const target = reloading
          ? RELOAD_POSE
          : drawing
            ? poseAt(DRAW_LEVER_KEYS, drawTime / drawSpan)
            : t < 1
              ? scaled(poseAt(CYCLE_KEYS, t), cycleScale)
              : Z;
        spring.step(target, ELASTIC_STEP);
      }
      const open = lever.pos / LEVER_OPEN; // 0 = shut, 1 = fully open

      // --- The parts the lever drives ---
      parts.lever.rotation.x = lever.pos;
      // The bolt rides back with the lever (+z = toward you).
      parts.bolt.position.z = boltRest + BOLT_TRAVEL * open;
      // The hammer: fallen after the shot; the bolt pushes it back as the
      // lever opens (a bit past full cock), and it settles at full cock
      // when the lever closes.
      if (!cocked && open > 0.8) cocked = true;
      const hammerTarget = cocked ? HAMMER_OVERCOCK * open : HAMMER_FIRED + (HAMMER_OVERCOCK - HAMMER_FIRED) * Math.min(1, open / 0.8);
      hammer = cocked || open > 0 ? hammerTarget : hammer;
      parts.hammer.rotation.x = hammer;
      // The trigger: pulled at the shot, released soon after.
      parts.trigger.rotation.x = TRIGGER_PULL * (1 - smoothstep(phase(sinceShot, 0.04, 0.14)));
      // The right hand rides along with the lever (its morph target, see above).
      hands.setLever(open);

      // --- The spent case: out when the lever is open enough ---
      if (!ejected && open >= EJECT_AT) {
        ejected = true;
        if (parts.case) cases.eject(parts.case);
      }
      cases.update(dt);

      // --- Reload: the round slides up to the gate and is pushed in ---
      if (parts.round) {
        parts.round.visible = roundK >= 0 && roundK < ROUND_IN_AT + 0.04;
        if (parts.round.visible) {
          const a = smoothstep(phase(roundK, 0, ROUND_READY_AT));
          const b = smoothstep(phase(roundK, ROUND_READY_AT + 0.1, ROUND_IN_AT));
          v.copy(ROUND_FROM).lerp(ROUND_READY, a).lerp(ROUND_IN, b);
          parts.round.position.copy(roundRest).add(v);
        }
      }

      return { ...spring.pose };
    },
  };
}
