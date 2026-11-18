// Particles: thousands of tiny points, each with its own position and life,
// updated on the CPU and drawn in ONE draw call as a THREE.Points object.
//
// Two systems for now:
// - dust:   ambient specks floating around the camera (sand in the wind by day,
//           blinking fireflies by night). They glow when near a flame.
// - embers: sparks rising from the flames (torches more, lanterns less).
import * as THREE from 'three';
import type { FireSource } from './fireLights';
import type { Atmosphere } from './atmospheres';

// --- Tuning -----------------------------------------------------------------
/** Max number of dust specks (the preset decides how many are active). */
const DUST_MAX = 600;
/** Dust lives in a box around the camera: half-size horizontally, and height. */
const DUST_RADIUS = 14;
const DUST_HEIGHT = 7;
/** Size of a dust speck, meters. */
const DUST_SIZE = 0.05;
/** Specks closer than this to a flame light up, meters. */
const DUST_LIT_RADIUS = 3;

const EMBER_LIFE = 1.6; // seconds
const EMBER_SIZE = 0.035;
/** Ember color multiplier: above 1 = HDR, so they bloom. */
const EMBER_BRIGHTNESS = 5;
const EMBER_MAX = 300;

// --- Shared GPU side ------------------------------------------------------------
// Each point is drawn as a square of gl_PointSize screen pixels. Squares are
// exactly what we want for pixel art: no texture needed.
const vertexShader = /* glsl */ `
  attribute float aSize;   // meters
  attribute float aAlpha;  // 0..1 (can go above 1 for extra glow)
  uniform float pixelsPerMeterAt1m; // screen pixels covered by 1 m seen from 1 m away
  uniform float fadeDistance;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float distance = -mvPosition.z;
    // Perspective: twice as far = half as big. At least 1 pixel, so far
    // specks become single pixels instead of disappearing.
    gl_PointSize = max(1.0, aSize * pixelsPerMeterAt1m / distance);
    // Fade out far away, so particles don't pop at the edge of the fog.
    vAlpha = aAlpha * (1.0 - smoothstep(fadeDistance * 0.5, fadeDistance, distance));
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    // Additive blending: we output "how much light to add".
    gl_FragColor = vec4(color * vAlpha, 1.0);
  }
`;

interface PointsLayer {
  points: THREE.Points;
  positions: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  material: THREE.ShaderMaterial;
  /** Tells the GPU the arrays changed this frame. */
  commit(count: number): void;
}

function createPointsLayer(capacity: number): PointsLayer {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  // A BufferAttribute wraps a typed array: the GPU reads it directly.
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      color: { value: new THREE.Color() },
      pixelsPerMeterAt1m: { value: 500 },
      fadeDistance: { value: 30 },
    },
    blending: THREE.AdditiveBlending,
    // Particles write depth: the god rays treat "no depth" as open sky, and a
    // bright firefly in front of the moon would otherwise cast its own ray.
    depthWrite: true,
    transparent: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // positions change every frame: skip the bounds check

  return {
    points,
    positions,
    sizes,
    alphas,
    material,
    commit(count) {
      geometry.setDrawRange(0, count); // only draw the active particles
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aAlpha.needsUpdate = true;
    },
  };
}

// --- Dust -----------------------------------------------------------------------
const dust = createPointsLayer(DUST_MAX);
// CPU-only data per speck: drift velocity and a random phase for blinking/wobble.
const dustVel = new Float32Array(DUST_MAX * 3);
const dustPhase = new Float32Array(DUST_MAX);
let dustCount = 0;
let dustWindX = 0;
let dustWindZ = 0;
let dustBlink = 0;
let dustBaseAlpha = 0;

// --- Embers -----------------------------------------------------------------------
const embers = createPointsLayer(EMBER_MAX);
const emberVel = new Float32Array(EMBER_MAX * 3);
const emberAge = new Float32Array(EMBER_MAX);
let emberCount = 0;
let emberSpawnDebt = 0; // fractional particles carried over between frames

let fires: FireSource[] = [];
/** Sum of all the fires' ember rates: embers per second in the whole level. */
let totalEmberRate = 0;

export function createParticles(scene: THREE.Scene, levelFires: FireSource[]): void {
  fires = levelFires;
  totalEmberRate = fires.reduce((sum, f) => sum + f.emberRate, 0);
  scene.add(dust.points, embers.points);

  for (let i = 0; i < DUST_MAX; i++) {
    // Start scattered in the box around the origin; they'll follow the camera.
    dust.positions[i * 3] = (Math.random() * 2 - 1) * DUST_RADIUS;
    dust.positions[i * 3 + 1] = Math.random() * DUST_HEIGHT;
    dust.positions[i * 3 + 2] = (Math.random() * 2 - 1) * DUST_RADIUS;
    // Each speck drifts a little on its own, on top of the wind.
    dustVel[i * 3] = (Math.random() - 0.5) * 0.3;
    dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
    dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    dustPhase[i] = Math.random() * 100;
    dust.sizes[i] = DUST_SIZE * (0.6 + Math.random() * 0.8);
  }
  for (let i = 0; i < EMBER_MAX; i++) embers.sizes[i] = EMBER_SIZE;
}

export function applyParticles(a: Atmosphere): void {
  dust.material.uniforms.color.value.set(a.dustColor);
  dustCount = Math.round(DUST_MAX * a.dustAmount);
  dustWindX = a.dustWindX;
  dustWindZ = a.dustWindZ;
  dustBlink = a.dustBlink;
  dustBaseAlpha = a.dustAlpha;
  embers.material.uniforms.color.value.set(a.lanternColor).multiplyScalar(EMBER_BRIGHTNESS);
}

/**
 * Call every frame. `dt` in seconds, `time` in seconds,
 * `renderHeight` = height in pixels of the image the scene is drawn into.
 */
export function updateParticles(
  dt: number,
  time: number,
  camera: THREE.PerspectiveCamera,
  renderHeight: number,
): void {
  // How many pixels 1 m covers at 1 m distance, for this camera and resolution.
  const ppm = renderHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  dust.material.uniforms.pixelsPerMeterAt1m.value = ppm;
  embers.material.uniforms.pixelsPerMeterAt1m.value = ppm;

  updateDust(dt, time, camera.position);
  updateEmbers(dt, time);
}

function updateDust(dt: number, time: number, cam: THREE.Vector3): void {
  // Wind comes in gusts: it swells and calms down slowly.
  const gust = 0.6 + 0.4 * Math.sin(time * 0.7) + 0.2 * Math.sin(time * 1.9);
  const p = dust.positions;

  for (let i = 0; i < dustCount; i++) {
    const ix = i * 3;
    p[ix] += (dustVel[ix] + dustWindX * gust) * dt;
    p[ix + 1] += (dustVel[ix + 1] + 0.1 * Math.sin(time + dustPhase[i])) * dt;
    p[ix + 2] += (dustVel[ix + 2] + dustWindZ * gust) * dt;

    // Wrap around the camera: a speck leaving the box on one side re-enters on
    // the other. We never create or destroy dust, we just recycle it, so there
    // always seems to be dust everywhere you go.
    p[ix] = wrap(p[ix], cam.x - DUST_RADIUS, cam.x + DUST_RADIUS);
    p[ix + 1] = wrap(p[ix + 1], 0, DUST_HEIGHT);
    p[ix + 2] = wrap(p[ix + 2], cam.z - DUST_RADIUS, cam.z + DUST_RADIUS);

    // Base visibility, optional blinking (fireflies), extra glow near flames.
    let alpha = dustBaseAlpha;
    if (dustBlink > 0) {
      const blink = Math.max(0, Math.sin(time * 1.5 + dustPhase[i]));
      alpha *= 1 - dustBlink + dustBlink * blink * blink * 3;
    }
    alpha += nearFireGlow(p[ix], p[ix + 1], p[ix + 2]);
    dust.alphas[i] = alpha;
  }
  dust.commit(dustCount);
}

/** 0 when far from every flame, up to ~1.5 right next to one. */
function nearFireGlow(x: number, y: number, z: number): number {
  let glow = 0;
  const r2 = DUST_LIT_RADIUS * DUST_LIT_RADIUS;
  for (const f of fires) {
    const dx = x - f.position.x;
    const dy = y - f.position.y;
    const dz = z - f.position.z;
    const d2 = dx * dx + dy * dy + dz * dz; // squared distance: no sqrt needed
    if (d2 < r2) glow += 1.5 * (1 - d2 / r2);
  }
  return glow;
}

function updateEmbers(dt: number, time: number): void {
  const p = embers.positions;

  // 1. Age and move the living embers; remove dead ones by swapping the last
  //    one into their slot (keeps the array packed, no gaps, no allocations).
  for (let i = 0; i < emberCount; i++) {
    emberAge[i] += dt;
    if (emberAge[i] >= EMBER_LIFE) {
      emberCount--;
      copyEmber(emberCount, i);
      i--; // re-check this slot: it now holds a different ember
      continue;
    }
    const ix = i * 3;
    // Rising heat: slight upward acceleration, plus a sideways wobble.
    emberVel[ix + 1] += 0.3 * dt;
    p[ix] += (emberVel[ix] + 0.25 * Math.sin(time * 5 + i)) * dt;
    p[ix + 1] += emberVel[ix + 1] * dt;
    p[ix + 2] += (emberVel[ix + 2] + 0.25 * Math.cos(time * 4 + i)) * dt;
    // Fade out toward the end of its life.
    embers.alphas[i] = 1 - emberAge[i] / EMBER_LIFE;
  }

  // 2. Spawn new ones. At 60 fps, 5 per second = 0.083 per frame: we
  //    accumulate the fractions and spawn when they add up to a whole ember.
  emberSpawnDebt += totalEmberRate * dt;
  while (emberSpawnDebt >= 1 && emberCount < EMBER_MAX) {
    emberSpawnDebt -= 1;
    const f = pickFireByEmberRate();
    const i = emberCount++;
    const ix = i * 3;
    p[ix] = f.position.x + (Math.random() - 0.5) * 0.1;
    p[ix + 1] = f.position.y + 0.1;
    p[ix + 2] = f.position.z + (Math.random() - 0.5) * 0.1;
    emberVel[ix] = (Math.random() - 0.5) * 0.3;
    emberVel[ix + 1] = 0.4 + Math.random() * 0.5;
    emberVel[ix + 2] = (Math.random() - 0.5) * 0.3;
    emberAge[i] = Math.random() * 0.3;
  }
  emberSpawnDebt = Math.min(emberSpawnDebt, 1);
  embers.commit(emberCount);
}

/**
 * Weighted random choice: a torch with rate 8 is picked 8× more often than a
 * lantern with rate 1. Roll a number in [0, total) and walk the list
 * subtracting each weight until it drops below zero.
 */
function pickFireByEmberRate(): FireSource {
  let roll = Math.random() * totalEmberRate;
  for (const f of fires) {
    roll -= f.emberRate;
    if (roll < 0) return f;
  }
  return fires[fires.length - 1];
}

function copyEmber(from: number, to: number): void {
  for (let k = 0; k < 3; k++) {
    embers.positions[to * 3 + k] = embers.positions[from * 3 + k];
    emberVel[to * 3 + k] = emberVel[from * 3 + k];
  }
  emberAge[to] = emberAge[from];
  embers.alphas[to] = embers.alphas[from];
}

/** Wraps `v` into [min, max): like a Pac-Man screen edge. */
function wrap(v: number, min: number, max: number): number {
  const size = max - min;
  return v - Math.floor((v - min) / size) * size;
}
