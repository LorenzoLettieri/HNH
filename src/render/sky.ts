// The sky: a huge sphere around the camera, painted by a custom shader.
import * as THREE from 'three';
import type { Atmosphere } from './atmospheres';

// A shader is a small program that runs on the GPU, written in GLSL (a C-like
// language). Three.js runs two of them for every mesh:
// - the VERTEX shader runs once per vertex and decides where it goes on screen;
// - the FRAGMENT shader runs once per pixel and decides its color.
// "uniforms" are values we send from JavaScript, the same for every pixel.
// "varyings" are values the vertex shader hands to the fragment shader,
// interpolated across the triangle.

const vertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    // The sphere is centered on the camera, so each vertex position is also
    // the direction we're looking at from the camera.
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 skyTop;
  uniform vec3 skyHorizon;
  uniform float skyCurve;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float sunCos;          // cosine of the sun's angular radius
  uniform float sunGlow;
  uniform float sunGlowTightness;
  uniform float stars;

  varying vec3 vDirection;

  // Cheap pseudo-random number in [0, 1) from a 3D point: same input, same output.
  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float height = dir.y; // -1 = straight down, 0 = horizon, 1 = straight up

    // 1. Gradient from horizon to top. Below the horizon: horizon color
    //    (it's hidden by the ground anyway, and it matches the fog).
    float t = pow(max(height, 0.0), skyCurve);
    vec3 color = mix(skyHorizon, skyTop, t);

    // 2. Sun/moon. The dot product of two unit vectors is the cosine of the
    //    angle between them: 1 = same direction, smaller = further apart.
    float d = dot(dir, sunDirection);
    float disk = step(sunCos, d);                      // hard edge, pixel-art friendly
    float glow = pow(max(d, 0.0), sunGlowTightness * 10.0) * sunGlow;
    color += sunColor * glow;
    color = mix(color, sunColor, disk);

    // 3. Stars: split the sky into tiny cells, light up a few random ones.
    vec3 cell = floor(dir * 250.0);
    float star = step(0.997, hash(cell)) * stars * smoothstep(0.02, 0.3, height);
    color += vec3(star) * (1.0 - disk);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      skyTop: { value: new THREE.Color() },
      skyHorizon: { value: new THREE.Color() },
      skyCurve: { value: 1 },
      sunColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3() },
      sunCos: { value: 1 },
      sunGlow: { value: 0 },
      sunGlowTightness: { value: 1 },
      stars: { value: 0 },
    },
    side: THREE.BackSide, // we're INSIDE the sphere: draw its inner faces
    depthWrite: false, // never hides anything: it's infinitely far away
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material);
  sky.renderOrder = -1; // draw it first, everything else goes on top
  return sky;
}

/** Copies an atmosphere's sky settings into the shader uniforms. */
export function applySky(sky: THREE.Mesh, a: Atmosphere): void {
  const u = (sky.material as THREE.ShaderMaterial).uniforms;
  u.skyTop.value.set(a.skyTop);
  u.skyHorizon.value.set(a.skyHorizon);
  u.skyCurve.value = a.skyCurve;
  u.sunColor.value.set(a.sunColor);
  u.sunDirection.value.copy(directionFromAngles(a.sunElevation, a.sunAzimuth));
  u.sunCos.value = Math.cos(THREE.MathUtils.degToRad(a.sunSize / 2));
  u.sunGlow.value = a.sunGlow;
  u.sunGlowTightness.value = a.sunGlowTightness;
  u.stars.value = a.stars;
}

/** Unit vector pointing at (elevation, azimuth). Azimuth 0 = north = -Z. */
export function directionFromAngles(elevationDeg: number, azimuthDeg: number): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
}
