// Fire lights: the light, halo and flicker of every flame in the level
// (torches, lanterns, ...). The props decide WHERE the flames are and how
// they look; this module makes them glow.
import * as THREE from 'three';
import type { Atmosphere } from './atmospheres';

/** A flame placed by a prop. Positions are in world space. */
export interface FireSource {
  position: THREE.Vector3;
  /** Light strength relative to the preset's lanternIntensity (1 = normal). */
  intensity: number;
  /** How far the light reaches, meters. */
  range: number;
  /** Flicker strength: 0 = steady, 0.25 = a nervous open flame. */
  flicker: number;
  /** Diameter of the soft halo, meters. */
  haloSize: number;
  /** Embers per second rising from it (see particles.ts). */
  emberRate: number;
  /** Materials that glow with the flame (e.g. lantern glass): their emissive flickers too. */
  glowMaterials?: THREE.MeshStandardMaterial[];
}

/** Halo opacity relative to the light intensity. */
const HALO_STRENGTH = 0.035;
/** Emissive strength of glowing materials (lantern glass), relative to flicker. */
const GLOW_EMISSIVE = 1.2;

interface FireInstance {
  source: FireSource;
  light: THREE.PointLight;
  halo: THREE.Sprite;
  /** Random offset so flames don't flicker in sync. */
  phase: number;
}

const instances: FireInstance[] = [];
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

export function createFireLights(scene: THREE.Scene, sources: FireSource[]): void {
  const haloTexture = createHaloTexture();
  for (const source of sources) {
    // The light it casts. No shadows: a point light shadow means rendering the
    // scene 6 more times (one per cube face), too expensive for many flames.
    const light = new THREE.PointLight(0xffffff, 1, source.range);
    light.position.copy(source.position);
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
    halo.position.copy(source.position);
    halo.scale.setScalar(source.haloSize);
    scene.add(halo);

    instances.push({ source, light, halo, phase: Math.random() * 100 });
  }
}

export function applyFireLights(a: Atmosphere): void {
  baseIntensity = a.lanternIntensity;
  for (const f of instances) {
    f.light.color.set(a.lanternColor);
    f.halo.material.color.set(a.lanternColor);
    for (const m of f.source.glowMaterials ?? []) m.emissive.set(a.lanternColor);
  }
}

/** Call every frame: makes the flames flicker. `time` in seconds. */
export function updateFireLights(time: number): void {
  for (const f of instances) {
    // Two sine waves at unrelated frequencies: looks irregular, never repeats
    // in an obvious way. Cheap fake "noise".
    const t = time + f.phase;
    const wobble = 0.6 * Math.sin(t * 9.1) + 0.4 * Math.sin(t * 23.7);
    const flicker = 1 + f.source.flicker * wobble;
    const intensity = baseIntensity * f.source.intensity * flicker;
    f.light.intensity = intensity;
    // The halo and any glowing material breathe with the flame.
    f.halo.material.opacity = Math.min(1, intensity * HALO_STRENGTH);
    for (const m of f.source.glowMaterials ?? []) m.emissiveIntensity = GLOW_EMISSIVE * flicker;
  }
}
