// The dynamite launcher in your hand (public/models/dynamiteLauncher.glb,
// made by tools/blender/dynamite_launcher.py), and its SHOT animation.
//
// A heavy gun held with TWO hands. The model is in the viewmodel's
// conventions (barrel along -Z, origin = the right hand on the wrist of the
// stock) and it was built around the carbine's hands (rifleArms.glb): the
// right one on the wrist, the left one under the walnut fore-end. So the
// carbine's arms hold it, children of the gun like on the carbine, and it's
// held in the carbine's hip pose (the arms are posed for it).
//
// The moving parts, found by name (see the top of the Blender script):
//   drum       origin on the drum's axis: rotation.z turns it (three.js -Z = the barrel)
//   stick_0..4 the sticks in the chambers, children of the drum, origin at
//              their back end (stick_0 is the one in front of the barrel)
//   muzzle     an empty at the mouth: where the flash goes
//
// THE SHOT (timeline in fractions of dynamiteFireInterval, like the carbine's
// lever and the pump; the badass rule of CLAUDE.md):
//   0      the stick is gone from its chamber (it's flying), the recoil
//          (recoil.ts) bucks the gun up; on top of it the gun ROCKS BACK, heavy
//   ~0.3   a flick the other way (anticipation), then the gun is CANTED onto
//          its left side: the cage full of sticks turns toward you...
//   ~0.4   ...and the DRUM is thrown round one chamber (1/5 of a turn) by the
//          ratchet: it accelerates all the way and SLAMS into the stop, CLACK,
//          bounces; the slam jolts the gun and punches your view
//   ~0.7   snapped back past its rest pose, bounces home, ready (0.88)
//
// THE RELOAD (timeline in fractions of the reload's length, the 'reloadStart'
// event says how long; same recipe as the revolver's, revolverReload.ts):
//   a wind-up, then a FLICK of the wrist: the drum swings out to the left on
//   its crane BY INERTIA (a Hinge of elastic.ts, pushed by the gun's angular
//   acceleration: nobody opens it, the flick throws it out) and bangs against
//   its stop; the gun turns the open drum toward you; the new sticks are
//   pushed into the empty chambers ONE AT A TIME (each one shoved in from
//   behind, with a little dip of the gun); a flick the other way slams the
//   drum shut, and it's spun like a wheel of fortune that slows down and
//   stops on a chamber. Every sound is played HERE, at the moment its piece
//   moves (the hinge hits its stop, a stick lands, the drum latches, a
//   chamber clicks past): the physics decides when, the sound follows.
//
// THE DRAW (weapon switch; its signature, like the other guns'): it swings in
// canted with the drum SPINNING hard, the pawl clicking slower and slower,
// and the drum LOCKS with a CLACK right before the gun is ready to fire.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { PlayerState } from '../../sim/player';
import { magazineSize } from '../../sim/weapon';
import { ELASTIC_STEP, Hinge, phase, PoseSpring, poseAt, smoothstep, Stroke, travelTime, ZERO_POSE, type GunPose } from './elastic';
import { playDrumOpen, playDrumShut, playDrumTick, playStickIn } from '../../audio/sfx';
import { loadGunModel } from './gunModel';
import { createRifleHands } from './hands';
import { viewmodelSettings } from './viewmodel';
import { holyPaperTexture } from '../dynamite';

/**
 * Where the muzzle is, in the model's coordinates: the same numbers as the
 * Blender script (BARREL_END + 1 cm, BARREL_Z), converted to three.js axes
 * (Blender y → three.js −z). Used until the file has loaded; then the
 * `muzzle` empty of the file wins.
 */
const MUZZLE = new THREE.Vector3(0, 0.081, -0.65);

/**
 * The carbine's right hand grips the LOWER BAR of the carbine's lever, not
 * its wrist: the hole of the fist is 7.2 cm below the origin (measured on
 * the vertices of rifleArms.glb). The arm is lifted by that much, so the fist
 * closes around this gun's wrist (at the origin, as thick as the hole; the
 * Blender script has the same number: RIGHT_FIST).
 */
const FIST = new THREE.Vector3(0.003, 0.072, 0);

/** The holy sticks glow a little blue in the drum (the Forge's launcher): color and strength. */
const HOLY_GLOW = 0x2a5ad0;
const HOLY_GLOW_STRENGTH = 0.35;

// --- The drum ------------------------------------------------------------------------
/** Chambers in the drum (the Blender script's STICKS). */
const CHAMBERS = 5;
/** One chamber, radians: what the ratchet turns at each shot. */
const STEP = (2 * Math.PI) / CHAMBERS;
/** When the ratchet throws the drum round, fraction of dynamiteFireInterval. */
const DRUM_TURN_AT = 0.38;
/** How hard it's thrown, rad/s²: a constant push, so it's fastest right at the CLACK (~0.1 s of travel). */
const DRUM_THROW = 260;
/** Speed kept when it slams into the stop: a heavy brass cage, a short bounce. */
const DRUM_BOUNCE = 0.25;
const DRUM_REST_SPEED = 0.8;
/** The slam's jolt to the gun (spring speed per rad/s of impact) and the punch to your view. */
const JOLT_ROLL = -0.04;
const JOLT_PITCH = -0.025;
const JOLT_Y = -0.006;
const PUNCH = 0.0005;

// --- The gun's pose: a damped spring chasing keyframes ---------------------------------
const POSE_STIFFNESS = 700; // a bit softer than the carbine's: it's a heavier gun
/** Below 1 it overshoots its keyframes and swings back: lower = more swagger. */
const POSE_DAMPING_RATIO = 0.34;
const Z = ZERO_POSE;
/**
 * [t, pose] of the shot (t = fraction of dynamiteFireInterval). Rolled onto
 * its LEFT side (roll +, like the carbine's lever throw): the cage turns its
 * flank toward you, and the left arm, rigid with the gun, drops out of view
 * instead of swinging over the screen.
 */
const CYCLE_KEYS: [number, GunPose][] = [
  [0, Z],
  [0.12, { x: 0.005, y: 0.012, z: 0.03, pitch: 0.1, yaw: 0.02, roll: -0.04 }], // rocked back, heavy
  [DRUM_TURN_AT - 0.06, { x: 0.006, y: 0.012, z: 0.04, pitch: 0.08, yaw: 0, roll: -0.12 }], // anticipation: canted the other way
  [DRUM_TURN_AT + 0.08, { x: -0.025, y: 0.02, z: 0.03, pitch: 0.12, yaw: 0.07, roll: 0.5 }], // CANTED: the cage in view, the drum turning
  [0.6, { x: -0.028, y: 0.022, z: 0.03, pitch: 0.12, yaw: 0.08, roll: 0.55 }], // hang
  [0.72, { x: 0.006, y: -0.004, z: -0.03, pitch: -0.02, yaw: -0.02, roll: -0.08 }], // snapped back past the rest
  [0.88, Z],
  [1, Z],
];

// --- The reload (fractions of the reload's length) -----------------------------------
/** The crane: how far it swings out (radians), how much the gun's swing throws it, the spring, the bounce. */
const CRANE_OPEN = 1.5;
const CRANE_INERTIA = 1.6;
const CRANE_ASSIST = 260;
const CRANE_DAMPING = 9;
const CRANE_BOUNCE = 0.3;
/** It may swing out from here, and must swing back from here. */
const OPEN_START = 0.11;
const CLOSE_START = 0.78;
/** The new sticks go in between these two moments, one after the other; each takes INSERT_TIME. */
const INSERT_FROM = 0.3;
const INSERT_TO = 0.7;
const INSERT_TIME = 0.06;
/** Where a stick comes from: this far behind its chamber (three.js +Z = toward you), meters. */
const INSERT_DEPTH = 0.16;
/** The gun's dip when a stick is shoved home (spring speed). */
const SHOVE_Y = -0.12;
const SHOVE_PITCH = -0.35;
/** The wheel of fortune: whole turns, from SPIN_FROM to the end of the reload (ease-out: fast, then slower). */
const SPIN_TURNS = 2;
const SPIN_FROM = 0.8;
const RELOAD_KEYS: [number, GunPose][] = [
  [0, Z],
  [0.05, { x: -0.004, y: 0, z: 0, pitch: -0.03, yaw: 0, roll: 0.16 }], // wind-up...
  [0.11, { x: 0.012, y: 0.006, z: 0, pitch: 0.06, yaw: -0.02, roll: -0.45 }], // ...FLICK clockwise: the drum flies out
  [0.22, { x: -0.03, y: 0.035, z: 0.06, pitch: 0.18, yaw: 0.28, roll: 0.3 }], // the open drum turned toward you
  [0.72, { x: -0.03, y: 0.035, z: 0.06, pitch: 0.18, yaw: 0.28, roll: 0.3 }],
  [0.76, { x: -0.03, y: 0.03, z: 0.05, pitch: 0.12, yaw: 0.22, roll: 0.05 }], // wind-up...
  [0.8, { x: -0.02, y: 0.02, z: 0.03, pitch: 0.05, yaw: 0.12, roll: 0.75 }], // ...FLICK the other way: SLAM shut
  [0.92, Z],
  [1, Z],
];

// --- The draw (fractions of weaponSwitchTime) ---------------------------------------
/** Whole turns the drum spins (whole: it stops where it started, the right chamber up). */
const DRAW_SPIN_TURNS = 2;
/** When it locks: CLACK. */
const DRAW_LOCK_AT = 0.72;
/** The gun's pose meanwhile: canted (the spinning cage in view), snapped back by the lock. */
const DRAW_KEYS: [number, GunPose][] = [
  [0, { x: -0.01, y: 0.01, z: 0.01, pitch: 0.06, yaw: 0.05, roll: 0.35 }],
  [DRAW_LOCK_AT, { x: -0.012, y: 0.012, z: 0.01, pitch: 0.07, yaw: 0.05, roll: 0.3 }],
  [DRAW_LOCK_AT + 0.12, { x: 0.004, y: -0.004, z: -0.01, pitch: -0.03, yaw: -0.01, roll: -0.06 }],
  [1, Z],
];

/** When the drum moves, seconds after the shot (the sounds follow the animation). */
export interface DrumTimes {
  turnAt: number;
  clackAt: number;
}
export function drumTimes(interval: number): DrumTimes {
  const turnAt = DRUM_TURN_AT * interval;
  return { turnAt, clackAt: turnAt + travelTime(STEP, DRUM_THROW) };
}

export interface DynamiteView {
  root: THREE.Group;
  /** Where the flash goes (model coordinates). */
  muzzle: THREE.Vector3;
  onShot(): void;
  /** The gun is drawn (weapon switch): the drum spins and locks. */
  draw(): void;
  /** A reload starts and lasts `seconds`. */
  onReload(seconds: number): void;
  /** Stop every animation (weapon switched away). */
  cancel(): void;
  /** The camera punch of the drum's slams since the last call (radians), for the viewmodel. */
  takePunch(): number;
  /** Advance the animations. Returns the pose offsets of the whole gun. */
  update(dt: number, player: PlayerState): GunPose;
}

export function createDynamiteView(): DynamiteView {
  const muzzle = MUZZLE.clone();
  // Parts, filled in when the file has loaded (until then empty stand-ins).
  let drum = new THREE.Object3D();
  let crane = new THREE.Object3D();
  let sticks: THREE.Object3D[] = [];
  let stickRest: number[] = []; // each stick's z at rest, in the drum's coordinates
  // The sticks' paper: plain, or holy when the launcher is reinforced at the Forge.
  let plainPaper: THREE.Material | null = null;
  let holyPaper: THREE.MeshStandardMaterial | null = null;
  const papers: THREE.Mesh[] = [];
  let shownHoly = false;
  const root = loadGunModel('dynamiteLauncher.glb', (model) => {
    const m = model.getObjectByName('muzzle');
    if (m) muzzle.copy(m.position);
    drum = model.getObjectByName('drum') ?? drum;
    crane = model.getObjectByName('crane') ?? crane;
    sticks = [];
    for (let k = 0; k < CHAMBERS; k++) {
      const s = model.getObjectByName(`stick_${k}`);
      if (s) sticks.push(s);
    }
    stickRest = sticks.map((s) => s.position.z);
    // The sticks' paper (the Blender material 'paper'): remember it, and make
    // its HOLY twin (the Forge's launcher): the ivory wrapper with the blue
    // cross, glowing a little blue. Swapped in update() when the gun changes.
    for (const s of sticks) {
      s.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = o.material as THREE.MeshStandardMaterial;
        if (m.name !== 'paper') return;
        if (!holyPaper) {
          plainPaper = m;
          holyPaper = m.clone();
          const map = holyPaperTexture();
          map.flipY = false; // a .glb's textures aren't flipped (a canvas one is, by default)
          holyPaper.map = map;
          holyPaper.emissive = new THREE.Color(HOLY_GLOW);
          holyPaper.emissiveIntensity = HOLY_GLOW_STRENGTH;
        }
        papers.push(o);
      });
    }
    shownHoly = false;
  });
  // The carbine's arms: the launcher was built around their hands.
  // The RIGHT arm, though, is posed to grab the carbine's lever from below:
  // lifted (FIST) so the fist wraps this wrist, then hung from a PIVOT on the
  // wrist (the origin), which can be turned (debug panel): the hand stays
  // wrapped around the wrist, only the forearm swings (the shoulder is off
  // screen anyway).
  const hands = createRifleHands();
  const fist = new THREE.Group();
  hands.right.position.copy(FIST);
  fist.add(hands.right);
  root.add(fist, hands.left);

  const spring = new PoseSpring(POSE_STIFFNESS, POSE_DAMPING_RATIO);
  // The drum's ratchet: a Stroke (elastic.ts) from 0 to one chamber. The
  // drum's angle = `turned` whole chambers + the stroke. At every shot the
  // finished stroke becomes one more whole chamber and restarts from 0 (the
  // sum doesn't jump); then, at DRUM_TURN_AT, it's thrown to its stop.
  const ratchet = new Stroke(STEP, DRUM_THROW, DRUM_THROW, DRUM_BOUNCE, DRUM_BOUNCE, DRUM_REST_SPEED);
  let turned = 0; // whole chambers already turned
  let cycling = false; // a shot's cycle is running (the ratchet has a turn to make)
  /** The chamber in front of the barrel once the drum has turned: the next stick to fire. */
  let top = 0;
  let leftover = 0;
  let sinceShot = Infinity;
  let punch = 0;
  // The reload.
  const hinge = new Hinge(CRANE_OPEN, CRANE_ASSIST, CRANE_DAMPING, CRANE_BOUNCE);
  let reloadTime = 1; // how long this reload lasts, seconds
  let sinceReload = Infinity;
  let wasOpenStop = false; // the crane was against its open stop (to hear the bang once)
  let refill = 0; // how many sticks go in during this reload
  let firstEmpty = 0; // how many chambers from `top` still had a stick when it started
  let shoved = 0; // sticks already shoved home
  let ticked = 0; // chambers clicked past during the spin
  // The draw.
  let sinceDraw = Infinity;
  let drawTicked = 0;
  let drawLocked = true;

  /** When the i-th stick of this reload starts sliding in (fraction of the reload). */
  function insertAt(i: number): number {
    const gap = refill > 1 ? (INSERT_TO - INSERT_FROM - INSERT_TIME) / (refill - 1) : 0;
    return INSERT_FROM + i * gap;
  }

  /** The turn in progress counts as done: one more whole chamber. */
  function settle(): void {
    if (cycling) turned++;
    cycling = false;
    ratchet.reset();
  }

  return {
    root,
    muzzle,
    onShot() {
      settle();
      cycling = true;
      sinceShot = 0;
      top = (top + 1) % CHAMBERS;
    },
    draw() {
      sinceDraw = 0;
      drawTicked = 0;
      drawLocked = false;
    },
    onReload(seconds) {
      settle(); // (the last shot's turn, if it hadn't finished)
      sinceShot = Infinity;
      reloadTime = Math.max(0.1, seconds);
      sinceReload = 0;
      shoved = 0;
      ticked = 0;
    },
    cancel() {
      settle(); // put away mid-cycle: the drum finishes its turn off screen
      sinceReload = Infinity;
      sinceDraw = Infinity;
      hinge.reset();
      sinceShot = Infinity;
      punch = 0;
    },
    takePunch() {
      const p = punch;
      punch = 0;
      return p;
    },
    update(dt, player) {
      const s = viewmodelSettings;
      fist.rotation.set(s.dynamiteHandPitch, s.dynamiteHandYaw, s.dynamiteHandRoll);
      const interval = tuning.dynamiteFireInterval;
      const magazine = magazineSize(player, 'dynamite');
      const loaded = Math.min(player.loaded.dynamite, magazine);
      if (sinceReload === 0) {
        // The reload just started: the sim refills at the END, so this is what's in the drum now.
        firstEmpty = loaded;
        refill = Math.min(magazine - loaded, tuning.infiniteAmmo ? magazine : player.reserve.sticks);
      }
      const reloading = sinceReload < reloadTime;

      // In small fixed steps: springs and strokes need them (elastic.ts).
      leftover += Math.min(dt, 0.1);
      while (leftover >= ELASTIC_STEP) {
        leftover -= ELASTIC_STEP;
        sinceShot += ELASTIC_STEP;
        sinceReload += ELASTIC_STEP;
        sinceDraw += ELASTIC_STEP;
        const t = sinceShot / interval;
        const u = sinceReload / reloadTime; // the reload's progress, 0..1 (≥ 1: none)
        ratchet.step(cycling && t >= DRUM_TURN_AT, ELASTIC_STEP);
        if (ratchet.impact > 0) {
          // CLACK: the heavy cage hits the stop, the whole gun feels it.
          const k = ratchet.impact;
          spring.vel.roll += JOLT_ROLL * k;
          spring.vel.pitch += JOLT_PITCH * k;
          spring.vel.y += JOLT_Y * k;
          punch -= PUNCH * k;
        }
        ratchet.impact = 0;
        // The crane: thrown out and back by the gun's swing (inertia), like the revolver's.
        const wasLatched = hinge.latched;
        hinge.step(-CRANE_INERTIA * spring.acc.roll, u >= OPEN_START && u < CLOSE_START, ELASTIC_STEP);
        const atStop = hinge.angle >= CRANE_OPEN - 1e-6;
        if (atStop && !wasOpenStop) playDrumOpen(); // BANG against the open stop
        wasOpenStop = atStop;
        if (hinge.latched && !wasLatched) playDrumShut(); // SLAM shut, latched
        // A stick shoved home: the gun dips, the sound.
        while (u < 1 && shoved < refill && u >= insertAt(shoved) + INSERT_TIME) {
          shoved++;
          spring.vel.y += SHOVE_Y;
          spring.vel.pitch += SHOVE_PITCH;
          playStickIn();
        }
        const d = sinceDraw / Math.max(0.01, tuning.weaponSwitchTime); // the draw's progress
        if (!drawLocked && d >= DRAW_LOCK_AT) {
          // The drum LOCKS: CLACK, and the gun feels it.
          drawLocked = true;
          spring.vel.roll += JOLT_ROLL * 8;
          spring.vel.pitch += JOLT_PITCH * 8;
          punch -= PUNCH * 8;
          playDrumShut();
        }
        const target = u < 1 ? poseAt(RELOAD_KEYS, u) : d < 1 ? poseAt(DRAW_KEYS, d) : t < 1 ? poseAt(CYCLE_KEYS, t) : Z;
        spring.step(target, ELASTIC_STEP);
      }
      crane.rotation.z = hinge.angle;
      // The wheel of fortune: whole turns after the slam, ease-out (u³ backward:
      // fast at first, slowing to a stop exactly on a chamber).
      const u = sinceReload / reloadTime;
      const k = reloading ? 1 - (1 - phase(u, SPIN_FROM, 1)) ** 3 : 0;
      const spin = k * SPIN_TURNS * 2 * Math.PI;
      // A click every chamber that goes past, quieter as it slows.
      const clicks = Math.floor(spin / STEP);
      while (ticked < clicks) {
        ticked++;
        playDrumTick(1 - ticked / (SPIN_TURNS * CHAMBERS + 1));
      }
      // The draw's spin: whole turns, ease-out, locked at DRAW_LOCK_AT.
      const d = sinceDraw / Math.max(0.01, tuning.weaponSwitchTime);
      const drawSpin = d < DRAW_LOCK_AT ? (1 - (1 - d / DRAW_LOCK_AT) ** 3) * DRAW_SPIN_TURNS * 2 * Math.PI : 0;
      while (d < DRAW_LOCK_AT && drawTicked < Math.floor(drawSpin / STEP)) {
        drawTicked++;
        playDrumTick(1 - drawTicked / (DRAW_SPIN_TURNS * CHAMBERS + 1));
      }
      // +Z in three.js turns the chambers the right way: chamber k+1 comes up
      // to where chamber k was (see `chamber` in the Blender script).
      drum.rotation.z = (turned + ratchet.pos / STEP) * STEP + spin + drawSpin;

      // The sticks: the chambers from `top` onward hold the rounds the gun
      // still has (the simulation counts them); the others are empty. During
      // a reload the new ones appear one at a time, slid in from behind.
      // The Forge's holy-water sticks: swap the paper when it changes.
      const holy = player.forged.dynamite > 0;
      if (holy !== shownHoly && plainPaper && holyPaper) {
        shownHoly = holy;
        for (const m of papers) m.material = holy ? holyPaper : plainPaper;
      }
      sticks.forEach((stick, c) => {
        const slot = (c - top + CHAMBERS) % CHAMBERS; // 0 = in front of the barrel
        let shown = slot < loaded;
        let out = 0; // how far out of its chamber, toward you
        if (reloading && slot >= firstEmpty && slot < firstEmpty + refill) {
          const i = slot - firstEmpty; // the i-th stick of this reload
          const a = (u - insertAt(i)) / INSERT_TIME; // 0..1 while it slides in
          shown = a >= -0.6; // it appears a moment before, behind its chamber
          out = INSERT_DEPTH * (1 - smoothstep(Math.min(1, Math.max(0, a))));
        }
        stick.visible = shown;
        if (stickRest.length) stick.position.z = stickRest[c] + out;
      });

      return { ...spring.pose };
    },
  };
}
