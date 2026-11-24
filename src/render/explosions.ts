// The dynamite's big blast, on screen and in your ears. (The card "Ultimo
// colpo" has its own small pop, in weaponFx.ts.)
//
// What makes an explosion read as BIG, in layers, each very short:
// 1. a FIREBALL: two additive spheres one inside the other, a small white-hot
//    core and a bigger, dimmer orange shell: they swell fast (ease-out) and
//    fade. Two layers instead of one give a soft edge (a single sphere has a
//    hard outline); for a few frames it's the brightest thing on screen;
// 2. a LIGHT: a point light at the blast that lights up walls and floor
//    around it, much stronger than a muzzle flash, then dies out;
// 3. PARTICLES: balls of fire flung everywhere, sparks, clods of dirt and a
//    cloud of dark smoke that rises and stays after the fire is gone;
// 4. the camera RATTLES if you're close;
// 5. the SOUND (sfx.ts playDynamiteBlast).
//
// About the lights: the number of lights is baked into every material's
// shader. Adding a light while playing makes Three.js recompile all the
// shaders: a freeze of a fraction of a second, on the frame of the blast,
// the worst moment. So the lights are created once, at the start, and
// "turned off" (intensity 0) when not in use: a small POOL.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { playDynamiteBlast } from '../audio/sfx';
import { blastShake } from './cameraFeel';
import { spawnBlastFire, spawnDirt, spawnSmoke, spawnSparks } from './particles';
import { soundAt } from './soundPosition';

/** How long the fireball lasts, seconds, and how big it gets (× the blast radius): the shell and the core. */
const FIREBALL_TIME = 0.28;
const FIREBALL_SIZE = 0.45;
const CORE_SIZE = 0.25;
/** Colors (HDR: × the glow, above 1 it blooms) and opacity of the two layers. */
const FIREBALL_COLOR = 0xff8a30;
const FIREBALL_GLOW = 2.5;
const FIREBALL_OPACITY = 0.45;
const CORE_COLOR = 0xffe0a0;
const CORE_GLOW = 6;
/** The light: peak intensity, how far it reaches (× the radius), how long it lasts, seconds. */
const LIGHT_INTENSITY = 400;
const LIGHT_REACH = 4;
const LIGHT_TIME = 0.4;
const LIGHT_COLOR = 0xff9a40;
/** How many blasts can light up the world at the same time (the pool). */
const LIGHTS = 2;
/** Particles per blast. */
const FIRE_BALLS = 40;
const SPARKS = 50;
const DIRT = 30;
const SMOKE = 40;
/** The camera rattles within this many × the radius (fully right at the blast). */
const SHAKE_REACH = 3;

export interface ExplosionRenderer {
  update(events: SimEvent[], camera: THREE.Camera, dt: number): void;
}

interface Fireball {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  size: number;
  opacity: number;
}

export function createExplosionRenderer(scene: THREE.Scene): ExplosionRenderer {
  // Low-poly on purpose: it's a blob of light for a quarter of a second.
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const fireballs: Fireball[] = [];

  const lights: { light: THREE.PointLight; age: number }[] = [];
  for (let i = 0; i < LIGHTS; i++) {
    const light = new THREE.PointLight(LIGHT_COLOR, 0, 10, 2);
    scene.add(light);
    lights.push({ light, age: LIGHT_TIME });
  }
  let nextLight = 0;

  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function addFireball(color: number, glow: number, opacity: number, size: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(glow),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(sphere, material);
    mesh.position.copy(point);
    mesh.scale.setScalar(0.01);
    scene.add(mesh);
    fireballs.push({ mesh, material, age: 0, size, opacity });
  }

  function blast(x: number, y: number, z: number, radius: number, camera: THREE.Camera): void {
    point.set(x, y, z);

    addFireball(FIREBALL_COLOR, FIREBALL_GLOW, FIREBALL_OPACITY, radius * FIREBALL_SIZE);
    addFireball(CORE_COLOR, CORE_GLOW, 1, radius * CORE_SIZE);

    // The oldest light of the pool moves here (two blasts at once: both lit).
    const slot = lights[nextLight];
    nextLight = (nextLight + 1) % LIGHTS;
    slot.light.position.copy(point).addScaledVector(up, 0.5); // a bit up: it lights the floor too
    slot.light.distance = radius * LIGHT_REACH;
    slot.age = 0;

    spawnBlastFire(point, up, FIRE_BALLS);
    spawnSparks(point, up, SPARKS);
    spawnDirt(point, up, DIRT);
    spawnSmoke(point, up, SMOKE);

    const distance = camera.position.distanceTo(point);
    const reach = radius * SHAKE_REACH;
    if (distance < reach) blastShake(1 - distance / reach);
    playDynamiteBlast(soundAt(camera, x, y, z));
  }

  return {
    update(events, camera, dt) {
      for (const e of events) {
        if (e.type === 'explosion' && (e.kind === 'dynamite' || e.kind === 'holyDynamite')) blast(e.x, e.y, e.z, e.radius, camera);
      }
      for (let i = fireballs.length - 1; i >= 0; i--) {
        const f = fireballs[i];
        f.age += dt;
        const t = f.age / FIREBALL_TIME;
        if (t >= 1) {
          scene.remove(f.mesh);
          f.material.dispose();
          fireballs.splice(i, 1);
          continue;
        }
        // Ease-out (1 - (1-t)³): almost all of the swelling in the first frames, like a real blast.
        const grow = 1 - (1 - t) ** 3;
        f.mesh.scale.setScalar(f.size * (0.25 + 0.75 * grow));
        f.material.opacity = f.opacity * (1 - t * t); // stays bright, then drops at the end
      }
      for (const l of lights) {
        if (l.age >= LIGHT_TIME) {
          l.light.intensity = 0;
          continue;
        }
        l.age += dt;
        const left = Math.max(0, 1 - l.age / LIGHT_TIME);
        l.light.intensity = LIGHT_INTENSITY * left * left; // squared: a flash, then a glow that dies
      }
    },
  };
}
