// Lanterns: a small glowing box + a point light, flickering like a flame.
import * as THREE from 'three';
import type { Lantern } from '../sim/world';
import type { Atmosphere } from './atmospheres';

/** How far each lantern's light reaches, meters. Beyond this it's zero. */
const RANGE = 9;
/** Flicker strength: 0 = steady light, 0.2 = very nervous flame. */
const FLICKER = 0.12;

interface LanternInstance {
  light: THREE.PointLight;
  glow: THREE.MeshBasicMaterial;
  /** Random offset so lanterns don't flicker in sync. */
  phase: number;
}

const instances: LanternInstance[] = [];
let baseIntensity = 0;

export function createLanterns(scene: THREE.Scene, lanterns: Lantern[]): void {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 0.2);
  for (const l of lanterns) {
    // The visible "flame": MeshBasicMaterial ignores lighting, so it always
    // looks bright, even in the dark. That's what sells it as a light source.
    const glow = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, glow);
    mesh.position.set(l.x, l.y, l.z);
    scene.add(mesh);

    // The light it casts. No shadows: a point light shadow means rendering the
    // scene 6 more times (one per cube face), too expensive for many lanterns.
    const light = new THREE.PointLight(0xffffff, 1, RANGE);
    light.position.set(l.x, l.y, l.z);
    scene.add(light);

    instances.push({ light, glow, phase: Math.random() * 100 });
  }
}

export function applyLanterns(a: Atmosphere): void {
  baseIntensity = a.lanternIntensity;
  for (const l of instances) {
    l.light.color.set(a.lanternColor);
    l.glow.color.set(a.lanternColor);
  }
}

/** Call every frame: makes the flames flicker. `time` in seconds. */
export function updateLanterns(time: number): void {
  for (const l of instances) {
    // Two sine waves at unrelated frequencies: looks irregular, never repeats
    // in an obvious way. Cheap fake "noise".
    const t = time + l.phase;
    const wobble = 0.6 * Math.sin(t * 9.1) + 0.4 * Math.sin(t * 23.7);
    l.light.intensity = baseIntensity * (1 + FLICKER * wobble);
  }
}
