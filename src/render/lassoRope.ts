// The lasso's rope OUT IN THE WORLD: from your fist to the loop, flying 9 m
// to catch an enemy, or 30 m to a beam as a grappling hook (the simulation is
// in src/sim/lasso.ts and kick.ts; the hands in render/weapons/lassoView.ts).
//
// It's drawn in the WORLD scene, not in the gun's: it goes far, and walls
// and enemies must be able to stand in front of it. Its first point is the
// fist, which lives in the gun's scene (its own camera, its own field of
// view): main.ts converts that point (viewToWorld below). The trick: a point
// shows up on screen at (x / −z, y / −z) divided by tan(fov / 2). Keep its
// depth, scale x and y by the ratio of the two tangents, and the world
// camera puts it on the very same pixel. The rope leaves your fist exactly.
//
// The rope is a tube rebuilt every frame (ropeMesh.ts) along a curve:
// straight from the fist to the loop, plus a SAG (hanging in the middle) and
// a WAVE running along it (the whip). Flying out it waves and hangs a bit;
// taut (an enemy caught, the hook holding) it's a straight line that
// vibrates; coming back it whips and sags a lot. At the end the noose (a
// clone of the model in your hand): flying OPEN, its face toward where it
// goes; around a caught enemy flat, the size of its body, then CINCHED;
// around the hook's anchor small and tight.
import * as THREE from 'three';
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import { hitBox, type Entity } from '../sim/entities';
import { loadGunModel } from './weapons/gunModel';
import { createRope, layRope } from './weapons/ropeMesh';
import { RELEASE, RETRACT_TIME, YANK_TIME } from './weapons/lassoView';

/** Points along the rope (more = rounder curves; it's rebuilt every frame). */
const POINTS = 28;
/** Rope radius, meters (a bit thicker than the one in your hand: it's seen from far). */
const RADIUS = 0.012;
/** The noose model's radius (NOOSE_R in tools/blender/lasso.py): to scale it to a size in meters. */
const MODEL_RADIUS = 0.24;
/** The open loop in flight, the loop on a hook's anchor, meters. */
const FLYING_RADIUS = 0.45;
const ANCHOR_RADIUS = 0.16;
/** How much a caught loop tightens by the end of the yank (fraction of its size). */
const CINCH = 0.6;
/** Sag flying out, per meter of rope; coming back. */
const FLY_SAG = 0.03;
const BACK_SAG = 0.1;
/** The whip's wave: how wide, how fast it runs along the rope (radians per second). */
const WAVE = 0.12;
const WAVE_SPEED = 30;
/** A taut rope trembles this much, meters. */
const TAUT_SHAKE = 0.012;

type Mode = 'none' | 'throw' | 'yank' | 'hook' | 'back';

export interface LassoRope {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number, hand: THREE.Vector3 | null): void;
}

/**
 * Converts a point of the gun's scene (camera space, its own field of view)
 * into the world point on the same pixel, at the same depth. See the top.
 */
export function viewToWorld(p: THREE.Vector3, viewFov: number, camera: THREE.PerspectiveCamera, out: THREE.Vector3): THREE.Vector3 {
  const k = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(viewFov) / 2);
  out.set(p.x * k, p.y * k, p.z);
  camera.updateMatrixWorld();
  return camera.localToWorld(out);
}

export function createLassoRope(scene: THREE.Scene): LassoRope {
  const material = new THREE.MeshLambertMaterial({ color: 0xc49e62 });
  const rope = createRope(POINTS, RADIUS, material);
  rope.mesh.visible = false;
  scene.add(rope.mesh);
  const pts = Array.from({ length: POINTS }, () => new THREE.Vector3());
  const loop = new THREE.Group();
  loop.visible = false;
  scene.add(loop);
  loadGunModel('lasso.glb', (model) => {
    const n = model.getObjectByName('noose');
    if (!n) return;
    n.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // The world's lights: a Lambert material, like the level (the model's is for the gun's scene).
      const m = o.material as THREE.MeshStandardMaterial;
      material.map = m.map;
      material.color.set(0xffffff);
      material.needsUpdate = true;
      o.material = material;
      o.frustumCulled = false;
    });
    loop.add(n);
  });

  let mode: Mode = 'none';
  let time = 0;
  let targetId = -1;
  const to = new THREE.Vector3(); // where the throw flies (when there's no target)
  const tip = new THREE.Vector3(); // the loop's center now
  const from = new THREE.Vector3(); // where the coming-back starts
  let backRadius = ANCHOR_RADIUS;
  let caughtRadius = FLYING_RADIUS;
  let wavePhase = 0;
  let lastHand = new THREE.Vector3();

  const dir = new THREE.Vector3();
  const across = new THREE.Vector3();
  const end = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3();

  /** An entity's hitbox center, interpolated between ticks (where it's drawn). */
  function entityCenter(e: Entity, alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const b = hitBox(e);
    const cy = (b.minY + b.maxY) / 2 - e.y;
    return out.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha + cy, e.pz + (e.z - e.pz) * alpha);
  }
  function bodyRadius(e: Entity): number {
    const b = hitBox(e);
    return Math.max(0.35, (Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2) * 1.25);
  }

  return {
    update(game, events, camera, alpha, dt, hand) {
      // --- Events: what the rope does now ---
      for (const e of events) {
        if (e.type === 'kickStart' && e.tool === 'lasso') {
          mode = 'throw';
          time = 0;
          targetId = e.targetId ?? -1;
          if (e.to) to.set(e.to.x, e.to.y, e.to.z);
        } else if (e.type === 'kickLand' && e.tool === 'lasso') {
          if (e.hits > 0 && targetId >= 0) {
            mode = 'yank';
            time = 0;
            const t = game.entities.find((x) => x.id === targetId);
            caughtRadius = t ? bodyRadius(t) : FLYING_RADIUS;
          } else {
            mode = 'back';
            time = 0;
            from.copy(tip);
            backRadius = FLYING_RADIUS;
          }
        } else if (e.type === 'hookThrow') {
          mode = 'hook';
          time = 0;
        } else if (e.type === 'hookRelease') {
          mode = 'back';
          time = 0;
          from.copy(tip);
          backRadius = ANCHOR_RADIUS;
        }
      }
      time += dt;
      wavePhase += dt * WAVE_SPEED;
      if (hand) lastHand.copy(hand);
      const h = lastHand;

      // --- Where the loop is, how big, which way it faces ---
      let radius = FLYING_RADIUS;
      let sag = 0;
      let wave = 0;
      let taut = false;
      let flat = false; // lying flat around a body (normal up) instead of facing along the rope
      if (mode === 'throw') {
        const start = RELEASE * tuning.lassoWindup;
        const k = THREE.MathUtils.clamp((time - start) / (tuning.lassoWindup - start), 0, 1);
        const t = game.entities.find((x) => x.id === targetId);
        if (t) entityCenter(t, alpha, center);
        else center.copy(to);
        // Ease-out: it leaves the hand fast and slows as the rope pays out.
        const e = 1 - (1 - k) * (1 - k);
        tip.lerpVectors(h, center, e);
        tip.y += Math.sin(k * Math.PI) * 0.4; // a little arc up
        radius = 0.15 + (FLYING_RADIUS - 0.15) * Math.min(1, k * 2); // it opens as it flies
        sag = FLY_SAG * (1 - k);
        wave = WAVE * (1 - k);
        if (time > tuning.lassoWindup + 0.3) mode = 'none'; // (the catch event never came)
      } else if (mode === 'yank') {
        const t = game.entities.find((x) => x.id === targetId);
        if (t) entityCenter(t, alpha, tip);
        const k = Math.min(1, time / YANK_TIME);
        radius = caughtRadius * (1 - (1 - CINCH) * Math.min(1, k * 3));
        flat = true;
        taut = true;
        if (time >= YANK_TIME) {
          mode = 'back';
          time = 0;
          from.copy(tip);
          backRadius = radius;
        }
      } else if (mode === 'hook') {
        const hk = game.player.hook;
        if (hk.phase === 'idle') mode = 'none';
        else {
          tip.set(hk.px + (hk.x - hk.px) * alpha, hk.py + (hk.y - hk.py) * alpha, hk.pz + (hk.z - hk.pz) * alpha);
          // The simulation's tip starts at your eye: from the fist instead, for the first stretch.
          if (hk.phase === 'flying') {
            const flown = Math.min(1, time * 6);
            tip.lerpVectors(h, tip, flown);
            radius = 0.2 + 0.2 * flown;
            sag = FLY_SAG * 0.5;
            wave = WAVE * 0.6;
          } else {
            radius = hk.entityId >= 0 ? bodyRadius(game.entities.find((x) => x.id === hk.entityId) ?? game.entities[0]) * CINCH : ANCHOR_RADIUS;
            flat = hk.entityId >= 0;
            taut = true;
          }
        }
      } else if (mode === 'back') {
        // Coming back: accelerating toward the fist (ease-in), whipping, sagging.
        const k = Math.min(1, time / RETRACT_TIME);
        tip.lerpVectors(from, h, k * k);
        radius = backRadius + (0.12 - backRadius) * k;
        sag = BACK_SAG * (1 - k);
        wave = WAVE * 1.5 * (1 - k);
        if (time >= RETRACT_TIME) mode = 'none';
      }

      const show = mode !== 'none' && hand !== null;
      rope.mesh.visible = show;
      loop.visible = show;
      if (!show) return;

      // The loop: facing along the rope, or flat around a body.
      dir.subVectors(tip, h);
      const length = dir.length();
      if (length > 0.001) dir.divideScalar(length);
      else dir.set(0, 0, -1);
      loop.position.copy(tip);
      if (flat) loop.quaternion.identity();
      else loop.quaternion.setFromUnitVectors(up, dir); // the ring's normal (model +Y) along the rope
      loop.scale.setScalar(radius / MODEL_RADIUS);
      // The rope ends on the loop's edge nearest to you.
      end.copy(tip).addScaledVector(dir, -radius * (flat ? 1 : 0.3));
      // The wave swings sideways, across the rope and the view.
      across.crossVectors(dir, up);
      if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
      across.normalize();
      const shake = taut ? (Math.random() * 2 - 1) * TAUT_SHAKE : 0;
      layRope(pts, h, end, sag * length, wave + shake, wavePhase, across);
      rope.setPoints(pts);
      void camera;
    },
  };
}
