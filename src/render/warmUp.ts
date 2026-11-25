// Shader warm-up: pay at loading time what the GPU would otherwise ask for
// in the middle of a fight.
//
// The first time Three.js draws a material it has never drawn, it writes the
// GLSL for it and asks the driver to compile and link it: 10-200 ms, inside
// that frame. The result goes in a cache (renderer.info.programs), so the
// second time is free. That's the hitch the first time a Smith, an explosion
// or an event shows up. Same story, smaller, for textures and geometries:
// they're copied into GPU memory only when something visible first uses them.
//
// The fix is the one of every game engine: a "loading screen" that draws
// everything once, off screen.
//   1. renderer.compile(scene, camera): builds the program of EVERY material
//      in the scene, hidden objects included, without drawing anything.
//   2. One frame drawn with everything switched on (hidden objects visible,
//      no frustum culling) into the post-process' off-screen image, which
//      the next real frame overwrites: this uploads textures and geometries,
//      and compiles what compile() skips (the shadow map's depth shaders).
//
// Lights are NEVER switched on: how many lights there are is written into
// every lit shader (see the light pools in explosions.ts, holyFire.ts):
// with an extra light the warm-up would compile programs the game never
// uses, and the real ones would still be missing.
//
// Web parallel: preloading the chunks of a lazy-loaded route before the user
// clicks, instead of on the click.
import * as THREE from 'three';

export interface WarmUpScene {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

/**
 * Compiles and uploads everything in the given scenes, drawing them once
 * into `target` (the same render target the game draws them into: the
 * program's cache key depends on it). Safe to call again: what is already
 * compiled is a cache hit. Returns how long it took (ms).
 */
export function warmUp(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, scenes: WarmUpScene[]): number {
  const start = performance.now();
  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);

  for (const { scene, camera } of scenes) renderer.compile(scene, camera);

  // Switch on everything that's hidden or would be culled, remembering it.
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  for (const { scene } of scenes) {
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) return;
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
  }

  const autoClear = renderer.autoClear;
  for (const { scene, camera } of scenes) {
    renderer.render(scene, camera);
    renderer.autoClear = false; // the next scene on top, like the gun over the world
    renderer.clearDepth();
  }
  renderer.autoClear = autoClear;

  for (const o of hidden) o.visible = false;
  for (const o of culled) o.frustumCulled = true;
  renderer.setRenderTarget(previousTarget);
  return performance.now() - start;
}

/**
 * Debug help: warns in the console every time the GPU has to compile a
 * shader during the game (a warm-up miss: something created on the fly, or
 * a material that changed). `check` once per frame; `accept` after a
 * warm-up, so what it compiled isn't reported.
 */
export function createShaderWatch(renderer: THREE.WebGLRenderer): { check(): void; accept(): void } {
  let known = new Set(renderer.info.programs ?? []);
  return {
    check() {
      const programs = renderer.info.programs ?? [];
      if (programs.length === known.size) return;
      for (const p of programs) {
        if (!known.has(p)) console.warn(`shader compiled during the game: ${p.name || '(a ShaderMaterial without a name)'}`);
      }
      known = new Set(programs);
    },
    accept() {
      known = new Set(renderer.info.programs ?? []);
    },
  };
}
