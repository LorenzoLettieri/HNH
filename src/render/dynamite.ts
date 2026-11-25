// Draws the dynamite sticks (sim/dynamite.ts): a red paper stick in pixel
// art with a fuse that GETS SHORTER as it burns, so you can read how much
// time is left (the simulation tells us fuseTicks / fuseTotal). The tip of
// the fuse glows and spits sparks; you HEAR it hiss (a looping sound that
// follows the stick) and "tonk" on every bounce.
//
// The simulation only knows a small box that flies and bounces: the spin is
// invented here, from how far the stick moved (like a wheel: angle = distance
// / radius), so it tumbles in flight and rolls on the floor.
import * as THREE from 'three';
import type { Dynamite } from '../sim/dynamite';
import { DYNAMITE_RADIUS } from '../sim/dynamite';
import type { SimEvent } from '../sim/events';
import { tuning } from '../sim/config';
import { playDynamiteBounce, playFuseHiss, type LoopingSound } from '../audio/sfx';
import { spawnHolyFlame, spawnSmoke, spawnSnort, spawnSparks } from './particles';
import { soundAt } from './soundPosition';
import { addSpecimen } from './warmUp';

/** Size of the stick, meters (a bit bigger than a real one: it must be readable in flight). */
const STICK_LENGTH = 0.28;
const STICK_RADIUS = 0.045;
/** The fuse when it's just lit, meters. */
const FUSE_LENGTH = 0.12;
/** Tumbling speed: radians per meter traveled (in flight it spins faster than it would roll). */
const SPIN_PER_METER = 9;
/** Sparks from the fuse: on average one every this many seconds. */
const SPARK_EVERY = 0.03;
/** Glow of the burning tip (HDR: above 1 it blooms). */
const EMBER_GLOW = 6;
/** How much the paper lights itself (0 = only the scene's lights): it must stand out on the ground. */
const PAPER_SELF_LIGHT = 0.35;
/** Card "A grappolo": how big the mini sticks are, × a normal one. */
const MINI_SCALE = 0.6;
/** Card "Razzo": a puff of its fire-and-smoke trail every this many seconds. */
const ROCKET_PUFF_EVERY = 0.012;
const X_AXIS = new THREE.Vector3(1, 0, 0);
const heading = new THREE.Vector3();
/** Card "Rimbalzo infernale": how much bigger the ember gets with every bounce. */
const HELL_BOUNCE_SWELL = 0.45;
/** Bounce sound: this speed into the surface (m/s) is a full-strength "tonk". */
const BOUNCE_LOUD = 10;

/** Texture: pixels around the stick (U) and along it (V). */
const TEX_AROUND = 8;
const TEX_ALONG = 24;
/** Palette: red paper (light, base, shadow), the darker paper folds, the label, the caps. */
const C = {
  light: '#e0483a',
  red: '#b3261e',
  shadow: '#741612',
  fold: '#5a100c',
  label: '#d8c48e',
  ink: '#2a1a10',
  cap: '#3a2a20',
};
/**
 * The HOLY stick (the launcher reinforced at the Forge): ivory paper soaked
 * in holy water, bound with blue ribbons at both ends, a blue cross on it,
 * a few wet spots that catch the light; its fuse burns blue.
 */
const H = {
  light: '#fff6e0',
  paper: '#e4d6b4',
  shadow: '#a8946c',
  ribbon: '#2a4f9e',
  ribbonDark: '#1a3470',
  cross: '#2f63d8',
  wet: '#bcd8ff',
};
/** The holy fuse's ember: pale blue. */
const HOLY_EMBER = 0x80b4ff;

export interface DynamiteRenderer {
  update(sticks: Dynamite[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

interface StickView {
  mesh: THREE.Group;
  /** The fuse (a thin cylinder) and its burning tip: they shrink toward the stick. */
  fuse: THREE.Mesh;
  ember: THREE.Mesh;
  hiss: LoopingSound;
}

/**
 * The stick's wrapper, painted pixel by pixel on a tiny canvas: a cylinder's
 * texture goes AROUND it horizontally (U) and ALONG it vertically (V). So a
 * horizontal stripe in the image is a ring around the stick, a vertical one
 * a line along it: the highlight and the shadow are columns (always on the
 * same side of the paper: it's painted, it doesn't follow the real light,
 * like every pixel-art sprite).
 */
function paperTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_AROUND;
  canvas.height = TEX_ALONG;
  const g = canvas.getContext('2d')!;
  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, 1, 1);
  };
  for (let y = 0; y < TEX_ALONG; y++) {
    for (let x = 0; x < TEX_AROUND; x++) {
      let color = C.red;
      if (x === 1 || x === 2) color = C.light; // the highlight down the paper
      if (x === 6 || x === 7) color = C.shadow;
      // The paper folded over at both ends: darker rings.
      if (y < 2 || y >= TEX_ALONG - 2) color = x < 4 ? C.fold : C.shadow;
      px(x, y, color);
    }
  }
  // A paper label in the middle, with a few marks of ink (the "DYNAMITE" print, too small to read).
  for (let y = 9; y < 15; y++) for (let x = 0; x < 5; x++) px(x, y, C.label);
  for (const [x, y] of [[1, 10], [2, 10], [3, 10], [1, 12], [3, 12], [2, 13]]) px(x, y, C.ink);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The holy stick's wrapper, same layout as paperTexture (U around, V along).
 * Exported: the launcher in your hand wears it too (weapons/dynamiteView.ts).
 * Symmetric along V on purpose: a texture from a .glb is not flipped like a
 * canvas one (flipY), so a design that reads the same both ways can't come
 * out upside down.
 */
export function holyPaperTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_AROUND;
  canvas.height = TEX_ALONG;
  const g = canvas.getContext('2d')!;
  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, 1, 1);
  };
  for (let y = 0; y < TEX_ALONG; y++) {
    for (let x = 0; x < TEX_AROUND; x++) {
      let color = H.paper;
      if (x === 1 || x === 2) color = H.light;
      if (x === 6 || x === 7) color = H.shadow;
      // Blue ribbons tied round both ends.
      if (y < 3 || y >= TEX_ALONG - 3) color = x < 4 ? H.ribbon : H.ribbonDark;
      px(x, y, color);
    }
  }
  // The cross, in the middle: a long bar along the stick and a short one across it.
  for (let y = 8; y < 16; y++) px(2, y, H.cross);
  for (let x = 1; x < 4; x++) px(x, 10, H.cross);
  for (let x = 1; x < 4; x++) px(x, TEX_ALONG - 1 - 10, H.cross); // (the mirror, so it reads both ways)
  // A few wet spots.
  for (const [x, y] of [[5, 5], [0, 7], [4, 18], [6, 13], [1, 19]]) px(x, y, H.wet);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createDynamiteRenderer(scene: THREE.Scene): DynamiteRenderer {
  // Shared by every stick: one geometry and one material each, not one per stick.
  const body = new THREE.CylinderGeometry(STICK_RADIUS, STICK_RADIUS, STICK_LENGTH, 8);
  body.rotateZ(Math.PI / 2); // lying along X
  // A cylinder has 3 material groups: the side, the top cap, the bottom cap.
  // A bit of self-light (the texture as emissive map): in the shade of a
  // wall a plain red stick would turn brown and vanish against the dirt.
  const wrapper = paperTexture();
  const paper = new THREE.MeshLambertMaterial({ map: wrapper, emissive: 0xffffff, emissiveMap: wrapper, emissiveIntensity: PAPER_SELF_LIGHT });
  const cap = new THREE.MeshLambertMaterial({ color: C.cap });
  const materials = [paper, cap, cap];
  const holyWrapper = holyPaperTexture();
  const holyPaper = new THREE.MeshLambertMaterial({ map: holyWrapper, emissive: 0xffffff, emissiveMap: holyWrapper, emissiveIntensity: PAPER_SELF_LIGHT * 1.4 });
  const holyMaterials = [holyPaper, cap, cap];
  // The fuse: a cylinder 1 m long with its base at the origin, scaled to the
  // length left (scale.x): shrinking it, the burnt end comes toward the stick.
  const fuseGeometry = new THREE.CylinderGeometry(0.007, 0.007, 1, 4);
  fuseGeometry.translate(0, 0.5, 0);
  fuseGeometry.rotateZ(-Math.PI / 2); // along +X
  const fuseMaterial = new THREE.MeshLambertMaterial({ color: 0xcdb27a });
  const emberMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc050).multiplyScalar(EMBER_GLOW), fog: false });
  const holyEmberMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(HOLY_EMBER).multiplyScalar(EMBER_GLOW), fog: false });
  const emberGeometry = new THREE.IcosahedronGeometry(0.022, 0);

  const views = new Map<number, StickView>();
  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  /** The stick itself: paper, fuse and ember, added to the scene. */
  function buildStick(holy: boolean): Pick<StickView, 'mesh' | 'fuse' | 'ember'> {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(body, holy ? holyMaterials : materials));
    const fuse = new THREE.Mesh(fuseGeometry, fuseMaterial);
    fuse.position.x = STICK_LENGTH / 2;
    mesh.add(fuse);
    const ember = new THREE.Mesh(emberGeometry, holy ? holyEmberMaterial : emberMaterial);
    mesh.add(ember);
    scene.add(mesh);
    return { mesh, fuse, ember };
  }

  // Two (plain and holy) hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => {
    buildStick(false);
    buildStick(true);
  });

  function createView(d: Dynamite, camera: THREE.Camera): StickView {
    const { mesh, fuse, ember } = buildStick(d.holy);
    // Start at a random angle, so two sticks don't look identical.
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    mesh.position.set(d.x, d.y + DYNAMITE_RADIUS, d.z);
    if (d.mini) mesh.scale.setScalar(MINI_SCALE); // card "A grappolo": the little ones
    return { mesh, fuse, ember, hiss: playFuseHiss(soundAt(camera, d.x, d.y, d.z)) };
  }

  return {
    update(sticks, events, camera, alpha, dt) {
      for (const e of events) {
        if (e.type === 'dynamiteBounce') playDynamiteBounce(soundAt(camera, e.x, e.y, e.z), e.speed / BOUNCE_LOUD);
      }

      const alive = new Set<number>();
      for (const d of sticks) {
        alive.add(d.id);
        let v = views.get(d.id);
        if (!v) {
          v = createView(d, camera);
          views.set(d.id, v);
        }
        // Between the previous tick and this one (alpha), like everything else.
        // +DYNAMITE_RADIUS: the simulation gives the bottom of the box, we draw its center.
        const x = d.px + (d.x - d.px) * alpha;
        const y = d.py + (d.y - d.py) * alpha + DYNAMITE_RADIUS;
        const z = d.pz + (d.z - d.pz) * alpha;
        const moved = Math.hypot(x - v.mesh.position.x, y - v.mesh.position.y, z - v.mesh.position.z);
        // Spin around the axis perpendicular to the motion and to "up" (the
        // cross product of the two): that's how a rolling thing turns.
        const rocketing = d.rocket && d.rocketTicks > 0;
        if (rocketing) {
          // Card "Razzo": it doesn't tumble, it FLIES, nose first. The stick
          // lies along X with its fuse at +X: turning +X to point BACKWARD
          // (heading = −velocity) puts the nose forward and the burning fuse
          // behind. setFromUnitVectors = the rotation that takes one direction
          // onto another (the shortest one).
          heading.set(d.vx, d.vy, d.vz).normalize().negate();
          v.mesh.quaternion.setFromUnitVectors(X_AXIS, heading);
          // A trail of fire and smoke behind it.
          point.set(x, y, z).addScaledVector(heading, STICK_LENGTH * 0.6);
          if (Math.random() < dt / ROCKET_PUFF_EVERY) {
            spawnSnort(point, heading, 2);
            spawnSmoke(point, heading, 1);
          }
        } else {
          axis.set(d.vz, 0, -d.vx);
          if (axis.lengthSq() > 1e-6) {
            axis.normalize();
            spin.setFromAxisAngle(axis, moved * SPIN_PER_METER);
            v.mesh.quaternion.premultiply(spin);
          }
        }
        v.mesh.position.set(x, y, z);

        // The fuse: as long as the time left. The ember sits on its end and flickers.
        const left = Math.max(0, d.fuseTicks / d.fuseTotal);
        const length = Math.max(0.005, FUSE_LENGTH * left);
        v.fuse.scale.x = length;
        v.ember.position.x = STICK_LENGTH / 2 + length;
        // Card "Rimbalzo infernale": the ember swells with every bounce (the stick is getting angrier).
        const angry = d.hellBounce ? 1 + HELL_BOUNCE_SWELL * Math.min(d.bounces, tuning.hellBounceMax) : 1;
        v.ember.scale.setScalar((0.7 + Math.random() * 0.7) * angry);
        if (Math.random() < dt / SPARK_EVERY) {
          v.ember.getWorldPosition(point);
          if (d.holy) spawnHolyFlame(point, up, 1); // the holy fuse spits blue
          else spawnSparks(point, up, 1);
        }
        v.hiss.move(soundAt(camera, x, y, z));
      }
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.mesh);
        v.hiss.stop();
        views.delete(id);
      }
    },
  };
}
