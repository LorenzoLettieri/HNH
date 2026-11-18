// The directional light coming from the sun (or the moon), with shadows.
import * as THREE from 'three';
import type { Atmosphere } from './atmospheres';
import { directionFromAngles } from './sky';

/** Half-size of the area covered by shadows, meters (the arena is 40 × 40). */
const SHADOW_AREA = 30;
/**
 * Shadow map resolution (pixels per side). Covering 60 m with 1024 px gives
 * ~6 cm shadow pixels: blocky edges that match the pixel-art style.
 */
const SHADOW_MAP_SIZE = 1024;

export function createSunLight(): THREE.DirectionalLight {
  // A DirectionalLight has parallel rays, like a light source infinitely far away.
  // Only its direction matters: from `position` toward `target.position`.
  const light = new THREE.DirectionalLight();
  light.castShadow = true;

  // Shadows: the light renders the scene from its own point of view into a
  // depth texture (the "shadow map"). Later, for each pixel on screen, the GPU
  // checks: "is something closer to the light than me?" → then I'm in shadow.
  // For a directional light, its "camera" is orthographic: a box. It must
  // enclose everything that casts or receives shadows.
  const cam = light.shadow.camera;
  cam.left = -SHADOW_AREA;
  cam.right = SHADOW_AREA;
  cam.top = SHADOW_AREA;
  cam.bottom = -SHADOW_AREA;
  cam.near = 1;
  cam.far = 150;
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

  // Bias: tiny offsets that prevent "shadow acne", a striped pattern caused by
  // a surface shadowing itself because of the shadow map's limited precision.
  light.shadow.bias = -0.0005;
  light.shadow.normalBias = 0.04;
  return light;
}

/** Points the light from the sun/moon of the preset, with its color and strength. */
export function applySunLight(light: THREE.DirectionalLight, a: Atmosphere): void {
  const dir = directionFromAngles(a.sunElevation, a.sunAzimuth);
  light.target.position.set(0, 0, 0); // arena center
  light.position.copy(dir).multiplyScalar(60); // 60 m away, toward the sun
  light.color.set(a.sunLightColor);
  light.intensity = a.sunLightIntensity;
}
