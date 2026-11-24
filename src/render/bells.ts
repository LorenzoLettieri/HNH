// The bells of "Le Campane del Giudizio" (the simulation: src/sim/bells.ts).
// Each bell hangs from a little timber frame on its roof. The NEXT bell to
// ring glows and has a COLUMN OF LIGHT going up into the sky: a waypoint you
// can see from anywhere in town (the trick of many open-world games, and of
// Diablo's events). The others are plain brass, the rung ones darkened.
// A rung bell swings (a spring, like the practice targets) and tolls.
//
// It only READS the simulation: which bells, how many rung (game.mapEvent),
// and the bellRung events for the swing and the sound.
import * as THREE from 'three';
import { BELL_HANG, bellCenter, type BellsEvent } from '../sim/bells';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import type { World } from '../sim/world';
import { playEventBell } from '../audio/sfx';
import { addHeightFog } from './heightFog';
import { brassTexture, postWoodTexture } from './props/textures';
import { solid, texturedBox } from './props/common';
import { soundAt } from './soundPosition';

// --- Shape (meters) ---
/** The bell's profile, from the mouth up to the crown: [radius, height]. LatheGeometry spins it around Y. */
const PROFILE: [number, number][] = [
  [0.44, 0],
  [0.42, 0.06],
  [0.32, 0.24],
  [0.26, 0.5],
  [0.24, 0.68],
  [0.16, 0.82],
  [0, 0.86],
];
/** Sides around: few, it's low-poly like the rest. */
const SIDES = 10;
/** Frame: posts this far from the middle, this thick; the beam this far above the bell's middle. */
const POST_X = 0.75;
const POST = 0.14;
const BEAM_ABOVE = 0.62;

// --- Look ---
/** The next bell's glow: gold, pulsing. Above 1 it blooms. */
const GLOW_COLOR = new THREE.Color(1.0, 0.62, 0.18);
const GLOW_MIN = 0.15;
const GLOW_MAX = 0.7;
const GLOW_HZ = 1.2;
/** Rung bells: the brass darkened (they've done their job). */
const RUNG_TINT = 0.45;
/** The column of light: radius, height, color (×, above 1 = bloom), how strong it pulses. */
const BEAM_RADIUS = 0.45;
const BEAM_HEIGHT = 60;
const BEAM_COLOR = new THREE.Color(2.2, 1.3, 0.4);
const BEAM_OPACITY = 0.35;
/** Seconds the bells stay after the event is over (the last one still swinging). */
const LINGER = 3;

// --- Swing (a damped spring, like the targets) ---
const SWING_STIFFNESS = 18;
const SWING_DAMPING = 1.4;
/** Angular speed given by a ring, rad/s. */
const SWING_KICK = 3.2;
const SWING_STEP = 1 / 240;

interface BellView {
  group: THREE.Group;
  /** Rotates around X at the beam: the swing. */
  pivot: THREE.Group;
  material: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  angle: number;
  velocity: number;
}

export interface BellRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, dt: number, time: number): void;
}

export function createBellRenderer(scene: THREE.Scene, world: World): BellRenderer {
  const bellGeometry = new THREE.LatheGeometry(
    PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    SIDES,
  );
  bellGeometry.computeVertexNormals();
  const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true);
  beamGeometry.translate(0, BEAM_HEIGHT / 2, 0); // its foot at the origin
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: BEAM_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending, // light ADDS to what's behind: it glows, it never darkens
    depthWrite: false, // see-through: it mustn't hide what's behind it in the depth buffer
    side: THREE.DoubleSide,
    fog: false, // seen from across the town: the fog would erase it
  });

  let views: BellView[] = [];
  let key = ''; // which event the views were built for
  let linger = 0;

  function build(ev: BellsEvent): void {
    views = ev.bells.map((spot) => {
      const c = bellCenter(world, spot);
      const group = new THREE.Group();
      group.position.set(c.x, c.y - BELL_HANG, c.z); // feet of the frame, on the roof
      // Frame: two posts and a beam.
      const postHeight = BELL_HANG + BEAM_ABOVE + POST / 2;
      for (const side of [-1, 1]) {
        const post = texturedBox(POST, postHeight, POST, postWoodTexture());
        post.position.set(side * POST_X, postHeight / 2, 0);
        group.add(post);
      }
      const beam = texturedBox(POST_X * 2 + POST, POST, POST, postWoodTexture());
      beam.position.y = BELL_HANG + BEAM_ABOVE;
      group.add(beam);
      // The bell hangs from the beam: the pivot is ON the beam, the bell below it.
      const pivot = new THREE.Group();
      pivot.position.y = BELL_HANG + BEAM_ABOVE;
      group.add(pivot);
      // emissiveMap = the same brass: the glow keeps the texture's detail instead of a flat blob.
      const material = new THREE.MeshStandardMaterial({ map: brassTexture(), emissiveMap: brassTexture(), roughness: 0.5, emissive: GLOW_COLOR, emissiveIntensity: 0 });
      addHeightFog(material);
      const bell = solid(bellGeometry, material);
      bell.position.y = -BEAM_ABOVE - 0.43; // the profile starts at the mouth: its middle is 0.43 up
      pivot.add(bell);
      const yoke = texturedBox(0.12, BEAM_ABOVE - 0.4, 0.12, postWoodTexture());
      yoke.position.y = -(BEAM_ABOVE - 0.4) / 2;
      pivot.add(yoke);
      const light = new THREE.Mesh(beamGeometry, beamMaterial);
      light.position.y = BELL_HANG + BEAM_ABOVE + POST; // from the beam up: it mustn't hide the bell
      group.add(light);
      scene.add(group);
      return { group, pivot, material, beam: light, angle: 0, velocity: 0 };
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
      // Only the bells event concerns us (the other kinds have their own renderers).
      const active = game.mapEvent.active;
      const ev = active?.kind === 'bells' ? active : null;
      // A new event: build its bells. Over: keep them a moment, then remove them.
      const now = ev ? `${ev.wave}:${ev.bells.join(',')}` : '';
      if (ev && now !== key) {
        clear();
        build(ev);
        key = now;
        linger = LINGER;
      }
      if (!ev && views.length > 0) {
        linger -= dt;
        if (linger <= 0) clear();
      }

      for (const e of events) {
        if (e.type !== 'bellRung') continue;
        const v = views[e.index];
        if (v) v.velocity += SWING_KICK;
        playEventBell(soundAt(camera, e.x, e.y, e.z), e.index, e.last);
      }

      const rung = ev ? ev.rung : views.length; // over: all done (or not: they fade out anyway)
      const pulse = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * GLOW_HZ);
      views.forEach((v, i) => {
        const next = i === rung;
        v.material.emissiveIntensity = next ? GLOW_MIN + (GLOW_MAX - GLOW_MIN) * pulse : 0;
        v.material.color.setScalar(i < rung ? RUNG_TINT : 1);
        v.beam.visible = next && !!ev;
        // The spring, in small fixed steps (a stiff spring with a big frame step explodes).
        for (let t = 0; t < dt; t += SWING_STEP) {
          const step = Math.min(SWING_STEP, dt - t);
          v.velocity += (-SWING_STIFFNESS * v.angle - SWING_DAMPING * v.velocity) * step;
          v.angle += v.velocity * step;
        }
        v.pivot.rotation.x = v.angle;
      });
      beamMaterial.opacity = BEAM_OPACITY * (0.75 + 0.25 * pulse);
    },
  };
}

/**
 * The column's texture: a vertical gradient, bright at the foot and fading to
 * nothing up high, with a few brighter streaks. 4 × 64 px; on the cylinder V
 * goes up (0 at the foot), U around.
 */
function beamTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < 64; y++) {
    const up = 1 - y / 63; // canvas y goes down, V goes up: row 63 is the foot
    for (let x = 0; x < 4; x++) {
      const streak = x === 1 ? 1 : 0.75;
      const a = (1 - up) ** 1.6 * streak; // bright at the foot, gone at the top
      g.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  return texture;
}
