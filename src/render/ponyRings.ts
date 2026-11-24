// The rings of the "Pony Express dell'Inferno" (the simulation: src/sim/ponyExpress.ts).
// Each ring is a TORUS of fire standing up, turned to face along the trail
// (toward the ring after it): you run through it the way the race goes.
// Only two are on screen at a time:
// - the NEXT one: bright, spinning, spitting flames, with the column of
//   light of the bells (a waypoint you see across town) and no fog on it;
// - the one AFTER it: faint, so you already know which way to turn when you
//   go through (the "racing line" of racing games: you look one gate ahead).
// A ring you pass blows up: it swells and fades, a burst of fire, a chime
// that climbs a note at each ring. Near the end of the clock the next ring
// flickers faster.
//
// It only READS the simulation (game.mapEvent, the ringPassed events).
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import type { PonyExpressEvent } from '../sim/ponyExpress';
import { tuning } from '../sim/config';
import { playRingPassed } from '../audio/sfx';
import { beamTexture } from './bells';
import { spawnBlastFire, spawnSnort } from './particles';
import { soundAt } from './soundPosition';

// --- Shape (meters) ---
// The ring's radius is the simulation's ponyRingRadius, read every frame (the
// debug panel can change it): what you see is exactly what counts.
/** Thickness of the burning tube, and how many sides (low-poly). */
const TUBE = 0.13;
const TUBE_SIDES = 5;
const AROUND = 28;

// --- Look ---
/** Color of the fire (×, above 1 = bloom) and the faint ring's opacity. */
const FIRE = new THREE.Color(3.2, 1.3, 0.35);
const NEXT_OPACITY = 1;
const AFTER_OPACITY = 0.22;
/** Spin around its own axis (rad/s), and a breathing of the size. */
const SPIN = 1.6;
const BREATH = 0.05;
const BREATH_HZ = 1.5;
/** Flickers this many times a second, faster in the last PONY_HURRY seconds of the clock. */
const FLICKER_HZ = 2;
const HURRY_FLICKER_HZ = 7;
export const PONY_HURRY = 3;
/** Flame puffs per second along the next ring. */
const FLAMES_PER_SECOND = 40;
/** A passed ring: how long it takes to blow up, how much it swells; fire balls of the burst. */
const POP_TIME = 0.35;
const POP_SWELL = 0.7;
const POP_FIRE = 14;
/** The column of light over the next ring. */
const BEAM_RADIUS = 0.35;
const BEAM_HEIGHT = 50;
const BEAM_COLOR = new THREE.Color(2.4, 0.9, 0.25);
const BEAM_OPACITY = 0.3;

interface RingView {
  group: THREE.Group;
  /** The torus itself: spins inside the group (the group gives the heading). */
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Seconds since it was passed; -1 = not passed. */
  popped: number;
}

export interface PonyRingRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, dt: number, time: number): void;
}

export function createPonyRingRenderer(scene: THREE.Scene): PonyRingRenderer {
  // Radius 1: the mesh is scaled to the simulation's radius (one geometry for every ring and every value).
  const geometry = new THREE.TorusGeometry(1, TUBE, TUBE_SIDES, AROUND);
  const texture = fireTexture();
  const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 10, 1, true);
  beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: BEAM_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.visible = false;
  scene.add(beam);

  let views: RingView[] = [];
  let key = '';
  let flameDebt = 0; // fractional puffs carried to the next frame
  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0.25, 0);

  function build(ev: PonyExpressEvent): void {
    views = ev.rings.map((r, i) => {
      // Heading: toward the next ring (the last one: away from the one before).
      const to = ev.rings[i + 1] ?? r;
      const from = ev.rings[i + 1] ? r : ev.rings[i - 1] ?? r;
      const group = new THREE.Group();
      group.position.set(r.x, r.y, r.z);
      // The torus lies in its XY plane, so it faces +Z: turning it around Y by
      // atan2(dx, dz) points that face along the trail.
      group.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: FIRE,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false, // the next ring must be seen across town; the faint one is faint anyway
      });
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      group.visible = false;
      scene.add(group);
      return { group, mesh, material, popped: -1 };
    });
  }

  function clear(): void {
    for (const v of views) {
      scene.remove(v.group);
      v.material.dispose();
    }
    views = [];
    key = '';
  }

  return {
    update(game, events, camera, dt, time) {
      const active = game.mapEvent.active;
      const ev = active?.kind === 'ponyExpress' ? active : null;
      // A new event: build its rings. The key tells two events apart (same wave after a debug jump: different rings).
      const now = ev ? `${ev.wave}:${ev.rings[0].x},${ev.rings[0].z}` : '';
      if (ev && now !== key) {
        clear();
        build(ev);
        key = now;
      }

      for (const e of events) {
        if (e.type !== 'ringPassed') continue;
        const v = views[e.index];
        if (v) v.popped = 0;
        point.set(e.x, e.y, e.z);
        spawnBlastFire(point, up, POP_FIRE);
        playRingPassed(soundAt(camera, e.x, e.y, e.z), e.index, e.last);
      }

      // Over (won or lost): no more next ring, the popping one finishes, then all goes.
      const next = ev ? ev.passed : -1;
      const hurry = ev !== null && ev.ticksLeft >= 0 && ev.ticksLeft <= PONY_HURRY * 60;
      const flicker = 0.75 + 0.25 * Math.sin(time * Math.PI * 2 * (hurry ? HURRY_FLICKER_HZ : FLICKER_HZ));
      const breath = 1 + BREATH * Math.sin(time * Math.PI * 2 * BREATH_HZ);
      const radius = tuning.ponyRingRadius;
      let anyVisible = false;
      views.forEach((v, i) => {
        v.mesh.rotation.z = time * SPIN * (i % 2 ? -1 : 1); // neighbours spin opposite ways: it reads as fire, not a wheel
        if (v.popped >= 0) {
          // Blowing up: swells and fades out.
          v.popped += dt;
          const t = Math.min(1, v.popped / POP_TIME);
          v.group.visible = t < 1;
          v.group.scale.setScalar(radius * (1 + POP_SWELL * t));
          v.material.opacity = NEXT_OPACITY * (1 - t) ** 2;
        } else if (i === next) {
          v.group.visible = true;
          v.group.scale.setScalar(radius * breath);
          v.material.opacity = NEXT_OPACITY * flicker;
        } else if (i === next + 1) {
          v.group.visible = true;
          v.group.scale.setScalar(radius);
          v.material.opacity = AFTER_OPACITY;
        } else {
          v.group.visible = false;
        }
        anyVisible ||= v.group.visible;
      });

      // The next ring: its column of light, and flames rising from its rim.
      const target = ev ? views[ev.passed] : undefined;
      beam.visible = !!target;
      if (target && ev) {
        const r = ev.rings[ev.passed];
        beam.position.set(r.x, r.y + radius, r.z);
        beamMaterial.opacity = BEAM_OPACITY * flicker;
        flameDebt += FLAMES_PER_SECOND * dt;
        for (; flameDebt >= 1; flameDebt--) {
          // A random point on the rim: the ring's own plane, turned like the group.
          const a = Math.random() * Math.PI * 2;
          const side = Math.cos(a) * radius;
          const heading = target.group.rotation.y;
          point.set(r.x + side * Math.cos(heading), r.y + Math.sin(a) * radius, r.z - side * Math.sin(heading));
          spawnSnort(point, up, 1);
        }
      }
      if (!ev && !anyVisible && views.length > 0) clear();
    },
  };
}

/**
 * The fire along the ring: 32 × 4 px. On a torus U goes around the ring and
 * V around the tube, so the columns are slices of the ring: alternating
 * bright tongues and darker gaps that the spin makes "run" around it.
 */
function fireTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 4;
  const g = canvas.getContext('2d')!;
  for (let x = 0; x < 32; x++) {
    const tongue = 0.55 + 0.45 * Math.sin((x / 32) * Math.PI * 2 * 6) ** 2; // six tongues around
    for (let y = 0; y < 4; y++) {
      const core = y === 1 || y === 2 ? 1 : 0.6; // the middle of the tube hotter
      const v = Math.round(255 * tongue * core);
      g.fillStyle = `rgb(${v}, ${Math.round(v * 0.85)}, ${Math.round(v * 0.6)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
