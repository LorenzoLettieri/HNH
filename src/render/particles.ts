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

/** Sparks from bullet impacts. */
const SPARK_MAX = 300;
const SPARK_LIFE = 0.35; // seconds
const SPARK_SIZE = 0.03;
const SPARK_SPEED = 5; // m/s
const SPARK_BRIGHTNESS = 6; // HDR: they bloom

/** Steam puffs per second, per vent. */
const STEAM_RATE = 14;
const STEAM_LIFE = 1.4; // seconds
const STEAM_SIZE = 0.22; // meters, at birth (puffs grow as they rise)
const STEAM_MAX = 400;
/** Steam is faint: additive white would otherwise glow too much. */
const STEAM_ALPHA = 0.1;

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
    #ifdef NORMAL_BLEND
      // Normal blending: an opaque-ish color on top (blood can't "add light").
      gl_FragColor = vec4(color, min(vAlpha, 1.0));
    #else
      // Additive blending: we output "how much light to add".
      gl_FragColor = vec4(color * vAlpha, 1.0);
    #endif
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

function createPointsLayer(capacity: number, additive = true): PointsLayer {
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
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    defines: additive ? {} : { NORMAL_BLEND: '' },
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

// --- Steam -------------------------------------------------------------------------
const steam = createPointsLayer(STEAM_MAX);
const steamVel = new Float32Array(STEAM_MAX * 3);
const steamAge = new Float32Array(STEAM_MAX);
let steamCount = 0;
let steamSpawnDebt = 0;
let vents: THREE.Vector3[] = [];

// --- Bursts (sparks, blood) --------------------------------------------------------
// A "burst" is a short-lived spray of particles from an impact point: they
// fly out around the surface normal, fall with gravity and fade out.
// Same code for sparks (bright, additive, they bloom) and blood (dark, opaque).
interface BurstOptions {
  max: number;
  life: number; // seconds
  size: number; // meters
  speed: number; // m/s
  gravity: number; // m/s²
  color: number;
  brightness: number; // > 1 = HDR, blooms
  additive: boolean;
}

class Burst {
  readonly layer: PointsLayer;
  private vel: Float32Array;
  private age: Float32Array;
  private count = 0;

  constructor(private o: BurstOptions) {
    this.layer = createPointsLayer(o.max, o.additive);
    this.vel = new Float32Array(o.max * 3);
    this.age = new Float32Array(o.max);
    this.layer.material.uniforms.color.value.set(o.color).multiplyScalar(o.brightness);
  }

  spawn(point: THREE.Vector3, normal: THREE.Vector3, count: number): void {
    const p = this.layer.positions;
    for (let n = 0; n < count && this.count < this.o.max; n++) {
      const i = this.count++;
      const ix = i * 3;
      p[ix] = point.x;
      p[ix + 1] = point.y;
      p[ix + 2] = point.z;
      // Normal + random vector = a random direction biased away from the surface.
      const speed = this.o.speed * (0.4 + Math.random());
      this.vel[ix] = (normal.x + (Math.random() - 0.5) * 1.6) * speed;
      this.vel[ix + 1] = (normal.y + (Math.random() - 0.5) * 1.6 + 0.4) * speed;
      this.vel[ix + 2] = (normal.z + (Math.random() - 0.5) * 1.6) * speed;
      this.age[i] = Math.random() * 0.1;
      this.layer.sizes[i] = this.o.size * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt: number): void {
    const p = this.layer.positions;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.o.life) {
        // Swap-remove: move the last particle into this slot.
        this.count--;
        const last = this.count;
        for (let k = 0; k < 3; k++) {
          p[i * 3 + k] = p[last * 3 + k];
          this.vel[i * 3 + k] = this.vel[last * 3 + k];
        }
        this.age[i] = this.age[last];
        this.layer.sizes[i] = this.layer.sizes[last];
        i--;
        continue;
      }
      const ix = i * 3;
      this.vel[ix + 1] -= this.o.gravity * dt;
      p[ix] += this.vel[ix] * dt;
      p[ix + 1] += this.vel[ix + 1] * dt;
      p[ix + 2] += this.vel[ix + 2] * dt;
      this.layer.alphas[i] = 1 - this.age[i] / this.o.life;
    }
    this.layer.commit(this.count);
  }
}

const sparks = new Burst({
  max: SPARK_MAX,
  life: SPARK_LIFE,
  size: SPARK_SIZE,
  speed: SPARK_SPEED,
  gravity: 15,
  color: 0xffb040,
  brightness: SPARK_BRIGHTNESS,
  additive: true,
});

const blood = new Burst({
  max: 400,
  life: 0.7,
  size: 0.07,
  speed: 3.5,
  gravity: 12,
  color: 0x5a0806,
  brightness: 1,
  additive: false,
});

/** Sparks at a bullet impact on metal or stone. */
export function spawnSparks(point: THREE.Vector3, normal: THREE.Vector3, count = 10): void {
  sparks.spawn(point, normal, count);
}

/** Blood spray when a bullet hits flesh. */
export function spawnBlood(point: THREE.Vector3, normal: THREE.Vector3, count = 14): void {
  blood.spawn(point, normal, count);
}

export function createParticles(
  scene: THREE.Scene,
  levelFires: FireSource[],
  levelVents: THREE.Vector3[] = [],
): void {
  vents = levelVents;
  scene.add(steam.points, sparks.layer.points, blood.layer.points);
  steam.material.uniforms.color.value.set(0xe8dccc);
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
  steam.material.uniforms.pixelsPerMeterAt1m.value = ppm;
  sparks.layer.material.uniforms.pixelsPerMeterAt1m.value = ppm;
  blood.layer.material.uniforms.pixelsPerMeterAt1m.value = ppm;

  updateDust(dt, time, camera.position);
  updateEmbers(dt, time);
  updateSteam(dt);
  sparks.update(dt);
  blood.update(dt);
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

/**
 * Steam: same pattern as the embers (age, move, swap-remove the dead, spawn
 * new ones), with puffs that rise fast, slow down, spread out and grow.
 */
function updateSteam(dt: number): void {
  const p = steam.positions;
  for (let i = 0; i < steamCount; i++) {
    steamAge[i] += dt;
    if (steamAge[i] >= STEAM_LIFE) {
      steamCount--;
      const last = steamCount;
      for (let k = 0; k < 3; k++) {
        p[i * 3 + k] = p[last * 3 + k];
        steamVel[i * 3 + k] = steamVel[last * 3 + k];
      }
      steamAge[i] = steamAge[last];
      i--;
      continue;
    }
    const ix = i * 3;
    const drag = Math.exp(-1.5 * dt); // air resistance: the jet loses speed
    steamVel[ix] *= drag;
    steamVel[ix + 1] *= drag;
    steamVel[ix + 2] *= drag;
    p[ix] += steamVel[ix] * dt;
    p[ix + 1] += steamVel[ix + 1] * dt;
    p[ix + 2] += steamVel[ix + 2] * dt;
    const t = steamAge[i] / STEAM_LIFE;
    steam.sizes[i] = STEAM_SIZE * (1 + t * 3); // puffs expand
    steam.alphas[i] = STEAM_ALPHA * (1 - t) * Math.min(1, t * 8); // fade in, then out
  }

  steamSpawnDebt += STEAM_RATE * vents.length * dt;
  while (steamSpawnDebt >= 1 && steamCount < STEAM_MAX) {
    steamSpawnDebt -= 1;
    const v = vents[Math.floor(Math.random() * vents.length)];
    const i = steamCount++;
    const ix = i * 3;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.5;
    p[ix] = v.x + Math.cos(a) * r;
    p[ix + 1] = v.y + 0.05;
    p[ix + 2] = v.z + Math.sin(a) * r;
    steamVel[ix] = (Math.random() - 0.5) * 0.6;
    steamVel[ix + 1] = 3 + Math.random() * 2.5;
    steamVel[ix + 2] = (Math.random() - 0.5) * 0.6;
    steamAge[i] = 0;
  }
  steamSpawnDebt = Math.min(steamSpawnDebt, 1);
  steam.commit(steamCount);
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
