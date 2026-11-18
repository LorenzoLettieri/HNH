// Lanterns: a small glowing box + a point light, flickering like a flame.
import * as THREE from 'three';
import type { Lantern } from '../sim/world';
import type { Atmosphere } from './atmospheres';
import { addHeightFog } from './heightFog';

/** How far each lantern's light reaches, meters. Beyond this it's zero. */
const RANGE = 9;
/** Flicker strength: 0 = steady light, 0.2 = very nervous flame. */
const FLICKER = 0.12;
/** Flame brightness: above 1 it's "brighter than white" and triggers the bloom. */
const FLAME_BRIGHTNESS = 4;
/** Diameter of the soft halo around the flame, meters. */
const HALO_SIZE = 2.2;
/** Halo opacity relative to the lantern intensity. */
const HALO_STRENGTH = 0.035;

interface LanternInstance {
  light: THREE.PointLight;
  glow: THREE.MeshBasicMaterial;
  halo: THREE.Sprite;
  /** Random offset so lanterns don't flicker in sync. */
  phase: number;
}

const instances: LanternInstance[] = [];
let baseIntensity = 0;

/**
 * A round, soft spot of light: white in the middle, fading to transparent.
 * Drawn once on a small canvas (like a CSS radial-gradient) and used as a texture.
 */
function createHaloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createLanterns(scene: THREE.Scene, lanterns: Lantern[]): void {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 0.2);
  const haloTexture = createHaloTexture();
  for (const l of lanterns) {
    // The visible "flame": MeshBasicMaterial ignores lighting, so it always
    // looks bright, even in the dark. That's what sells it as a light source.
    const glow = new THREE.MeshBasicMaterial();
    addHeightFog(glow);
    const mesh = new THREE.Mesh(geometry, glow);
    mesh.position.set(l.x, l.y, l.z);
    scene.add(mesh);

    // The light it casts. No shadows: a point light shadow means rendering the
    // scene 6 more times (one per cube face), too expensive for many lanterns.
    const light = new THREE.PointLight(0xffffff, 1, RANGE);
    light.position.set(l.x, l.y, l.z);
    scene.add(light);

    // The halo: a Sprite is a flat square that always faces the camera.
    // Additive blending ADDS its color to what's behind it (light adds up,
    // it never darkens): perfect for glows. It doesn't write depth, so it
    // never hides other transparent things behind it.
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    halo.position.copy(mesh.position);
    halo.scale.setScalar(HALO_SIZE);
    scene.add(halo);

    instances.push({ light, glow, halo, phase: Math.random() * 100 });
  }
}

export function applyLanterns(a: Atmosphere): void {
  baseIntensity = a.lanternIntensity;
  for (const l of instances) {
    l.light.color.set(a.lanternColor);
    l.glow.color.set(a.lanternColor).multiplyScalar(FLAME_BRIGHTNESS);
    l.halo.material.color.set(a.lanternColor);
  }
}

/** Call every frame: makes the flames flicker. `time` in seconds. */
export function updateLanterns(time: number): void {
  for (const l of instances) {
    // Two sine waves at unrelated frequencies: looks irregular, never repeats
    // in an obvious way. Cheap fake "noise".
    const t = time + l.phase;
    const wobble = 0.6 * Math.sin(t * 9.1) + 0.4 * Math.sin(t * 23.7);
    const flicker = 1 + FLICKER * wobble;
    l.light.intensity = baseIntensity * flicker;
    // The halo breathes with the flame.
    l.halo.material.opacity = Math.min(1, baseIntensity * HALO_STRENGTH * flicker);
  }
}
