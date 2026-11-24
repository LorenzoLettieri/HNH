// Draws the pools of holy fire (sim/holyFire.ts): the Forge's dynamite.
// The same pools, orange and without the choir, are the drink "Scia di brace"
// (holy: false): the patches of fire a slide leaves behind.
// In layers, like the explosions:
// 1. a GLOW on the floor: a soft disc, brighter at its ragged rim (where the
//    holy water burns hottest), painted once on a tiny canvas in pixel art,
//    that flickers (scale and brightness wobble);
// 2. TONGUES OF BLUE FLAME licking up from random points of the pool
//    (particles.ts spawnHolyFlame), as many per second as its area asks;
// 3. a blue LIGHT on the walls and the enemies around: from a POOL of two
//    lights made at the start (adding a light while playing recompiles every
//    shader, see explosions.ts), given to the two pools nearest to you;
// 4. its SOUND, for the two nearest pools too (a looping roar and shimmer).
// Every layer swells in at the start and dies out in the last second.
import * as THREE from 'three';
import type { HolyFire } from '../sim/holyFire';
import { playHolyFireLoop, type LoopingSound } from '../audio/sfx';
import { spawnHolyFlame, spawnSnort } from './particles';
import { soundAt } from './soundPosition';

/** Lifted over the floor: two surfaces on the same plane flicker (z-fighting; see materials.ts). */
const LIFT = 0.03;
const COLOR = 0x3a7dff;
/** The plain fire of the drink "Scia di brace" (holy: false): orange, smaller tongues, no choir. */
const EMBER_COLOR = 0xff6a1a;
const EMBER_LIGHT_COLOR = 0xff7a30;
/** HDR glow of the floor (above 1 it blooms) and how much it flickers. */
const GLOW = 2.4;
const FLICKER = 0.25;
/** Tongues of flame per second for every square meter of pool, and particles per tongue. */
const FLAMES_PER_M2 = 9;
const PARTICLES_PER_FLAME = 1;
/** The light: how bright, how far it reaches (× the pool's radius), how much it flickers. */
const LIGHT_INTENSITY = 18;
const LIGHT_REACH = 3;
const LIGHT_COLOR = 0x5a96ff;
/** How many pools get a light and a sound (the nearest ones). */
const NEAREST = 2;
/** Seconds to swell in, and seconds of dying out at the end. */
const SWELL = 0.25;
const DIE = 1;
/** The floor texture's size, pixels (pixel art: crisp, like everything else). */
const TEX = 48;

export interface HolyFireRenderer {
  update(fires: HolyFire[], camera: THREE.Camera, dt: number, time: number): void;
}

interface PoolView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  owed: number; // fractional flames carried over between frames
  sound: LoopingSound | null;
}

/**
 * The glow, painted once: transparent outside the circle, a dim blue inside
 * that grows brighter toward the rim, and a RAGGED rim (its radius wobbles
 * with the angle: a few sines added together, a cheap "noise").
 */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(TEX, TEX);
  const c = (TEX - 1) / 2;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const rim = 0.86 + 0.06 * Math.sin(a * 5) + 0.04 * Math.sin(a * 11 + 1.3) + 0.03 * Math.sin(a * 23 + 0.4);
      if (r > rim) continue;
      // Brightness: low in the middle, rising toward the rim, a hot band at the rim.
      const k = 0.25 + 0.45 * (r / rim) ** 2 + (r > rim - 0.12 ? 0.3 : 0);
      const i = (y * TEX + x) * 4;
      img.data[i] = 255 * k;
      img.data[i + 1] = 255 * k;
      img.data[i + 2] = 255 * k;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  return tex;
}

export function createHolyFireRenderer(scene: THREE.Scene): HolyFireRenderer {
  const disc = new THREE.PlaneGeometry(2, 2); // the texture's circle has radius 1
  disc.rotateX(-Math.PI / 2); // lying on the floor
  const map = glowTexture();
  const views = new Map<number, PoolView>();
  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < NEAREST; i++) {
    const light = new THREE.PointLight(LIGHT_COLOR, 0, 10, 2);
    scene.add(light);
    lights.push(light);
  }
  const point = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /** 0..1: swelling in, burning, dying out. */
  function strength(f: HolyFire, v: PoolView): number {
    const end = Math.min(1, f.ticksLeft / (DIE * 60));
    return Math.min(1, v.age / SWELL) * end;
  }

  return {
    update(fires, camera, dt, time) {
      const alive = new Set<number>();
      for (const f of fires) {
        alive.add(f.id);
        let v = views.get(f.id);
        if (!v) {
          const material = new THREE.MeshBasicMaterial({
            map,
            color: new THREE.Color(f.holy ? COLOR : EMBER_COLOR).multiplyScalar(GLOW),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(disc, material);
          mesh.position.set(f.x, f.y + LIFT, f.z);
          mesh.rotation.y = Math.random() * Math.PI * 2; // every pool's rim a different shape
          scene.add(mesh);
          v = { mesh, material, age: 0, owed: 0, sound: null };
          views.set(f.id, v);
        }
        v.age += dt;
        const k = strength(f, v);
        // The floor: flickering size and brightness (two sines at unrelated rates: never in step).
        const flicker = 1 + FLICKER * (Math.sin(time * 13 + f.id) * 0.6 + Math.sin(time * 31 + f.id * 2) * 0.4);
        v.mesh.scale.setScalar(f.radius * (0.92 + 0.08 * flicker) * (0.6 + 0.4 * k));
        v.material.opacity = 0.55 * k * flicker;
        // The flames: random points in the circle (√ of a random number for
        // the distance: otherwise they'd crowd in the middle, where the
        // circles are small).
        v.owed += FLAMES_PER_M2 * Math.PI * f.radius * f.radius * k * dt;
        while (v.owed >= 1) {
          v.owed--;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * f.radius * 0.95;
          point.set(f.x + Math.cos(a) * r, f.y + 0.05, f.z + Math.sin(a) * r);
          if (f.holy) spawnHolyFlame(point, up, PARTICLES_PER_FLAME);
          else spawnSnort(point, up, PARTICLES_PER_FLAME); // the bull's fiery breath: orange tongues that rise
        }
      }

      // The nearest pools get the lights and the sounds.
      const nearest = fires
        .map((f) => ({ f, d: Math.hypot(f.x - camera.position.x, f.y - camera.position.y, f.z - camera.position.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST)
        .map((n) => n.f);
      lights.forEach((light, i) => {
        const f = nearest[i];
        const v = f && views.get(f.id);
        if (!f || !v) {
          light.intensity = 0;
          return;
        }
        light.position.set(f.x, f.y + 0.6, f.z);
        light.color.set(f.holy ? LIGHT_COLOR : EMBER_LIGHT_COLOR);
        light.distance = f.radius * LIGHT_REACH;
        light.intensity = LIGHT_INTENSITY * strength(f, v) * (0.85 + 0.15 * Math.sin(time * 17 + i));
      });
      for (const [id, v] of views) {
        const f = nearest.find((n) => n.id === id);
        if (f && !f.holy) continue; // the ember trail crackles quietly: no choir for it
        if (f && !v.sound) v.sound = playHolyFireLoop(soundAt(camera, f.x, f.y + 0.5, f.z));
        else if (f && v.sound) v.sound.move(soundAt(camera, f.x, f.y + 0.5, f.z));
        else if (!f && v.sound) {
          v.sound.stop();
          v.sound = null;
        }
      }

      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.mesh);
        v.material.dispose();
        v.sound?.stop();
        views.delete(id);
      }
    },
  };
}
