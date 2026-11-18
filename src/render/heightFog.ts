// Height fog: fog that is thick near the ground and thins out going up,
// like mist lying in a valley. Three.js only has distance fog, so we patch
// its fog shader code into ours.
import * as THREE from 'three';
import type { Atmosphere } from './atmospheres';

// Shared uniform objects: every patched material points to THESE objects,
// so changing a value here updates all materials at once.
const uniforms = {
  hfDensity: { value: 0 }, // how thick the ground mist is
  hfFalloff: { value: 1 }, // how fast it thins out with height
};

/**
 * Patches a built-in material so its fog also accounts for height.
 * onBeforeCompile runs once, right before Three.js compiles the material's
 * shader: we get the GLSL source as a string and can edit it.
 */
export function addHeightFog(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => patchHeightFog(shader);
}

/**
 * The actual edit, usable on its own by materials that also need other
 * shader patches (e.g. the grass, which sways in the wind).
 */
export function patchHeightFog(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, uniforms);

  // Vertex shader: also pass the vertex position in WORLD space (we need its height).
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vHfWorldPos;')
    .replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
         #ifdef USE_INSTANCING
           // Instanced meshes: each copy has its own transform (instanceMatrix).
           vHfWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
         #else
           vHfWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         #endif`,
    );

  // Fragment shader: replace Three's fog with distance fog + height fog.
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <fog_pars_fragment>',
      `#include <fog_pars_fragment>
         varying vec3 vHfWorldPos;
         uniform float hfDensity;
         uniform float hfFalloff;`,
    )
    .replace(
      '#include <fog_fragment>',
      /* glsl */ `
        #ifdef USE_FOG
          // 1. The usual distance fog: 0 before fogNear, 1 after fogFar.
          float distanceFog = smoothstep(fogNear, fogFar, vFogDepth);

          // 2. Height fog. Mist density decays exponentially with height
          //    (above y = 0). The longer the line of sight crosses it, the
          //    more it hides: 1 - exp(-distance × density) is the classic
          //    "light absorbed by a medium" formula (Beer-Lambert law).
          float dist = length(vHfWorldPos - cameraPosition);
          float densityHere = hfDensity * exp(-max(vHfWorldPos.y, 0.0) * hfFalloff);
          float heightFog = 1.0 - exp(-dist * densityHere);

          // 3. Combine: "not hidden by either" = (1 - a) × (1 - b).
          float fogFactor = 1.0 - (1.0 - distanceFog) * (1.0 - heightFog);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #endif`,
    );
}

export function applyHeightFog(a: Atmosphere): void {
  uniforms.hfDensity.value = a.groundFogDensity;
  uniforms.hfFalloff.value = a.groundFogFalloff;
}
