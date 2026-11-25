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
  // A light inside a hidden group is off in the game and must stay off: it's
  // hidden itself for the warm-up frame, since its group is about to show.
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  const darkened: THREE.Object3D[] = [];
  for (const { scene } of scenes) {
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) {
        if (o.visible && !shown(o)) {
          darkened.push(o);
          o.visible = false;
        }
        return;
      }
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
  for (const o of darkened) o.visible = true;
  // Such a light is a hitch waiting to happen: the moment its group shows,
  // the number of lights changes and EVERY lit shader is compiled again.
  // Better in the scene with intensity 0 (see wagerTable.ts).
  for (const o of darkened) console.warn(`a light inside a hidden group (${o.parent?.name || o.parent?.type}): showing it recompiles every shader`);
  renderer.setRenderTarget(previousTarget);
  return performance.now() - start;
}

/** Is the object drawn: visible itself and all its parents? */
function shown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Things created during the game (an enemy, a fireball, a pickup) bring
 * materials the warm-up never saw. So each renderer builds ONE of them at
 * startup, a "specimen": hidden, never moved, never removed. The warm-up
 * compiles its programs, and a material created later with the same setup
 * finds its program in the cache (the cache key is the setup, not the
 * material). Never removed matters too: Three.js deletes a program when the
 * last material using it is disposed (a Smith dying would take its shock
 * wave's shader with it, and the next Smith would compile it again).
 *
 * `build` creates the objects and adds them to the scene, as the renderer
 * does in the game: whatever it added gets hidden.
 */
export function addSpecimen(scene: THREE.Scene, build: () => void): void {
  const before = new Set(scene.children);
  build();
  for (const o of scene.children) if (!before.has(o)) o.visible = false;
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
        // The name is the material's name, or its type; the cache key says how it was set up.
        if (!known.has(p)) console.warn(`shader compiled during the game: ${p.name || '(no name)'}`, p.cacheKey.slice(0, 200));
      }
      known = new Set(programs);
    },
    accept() {
      known = new Set(renderer.info.programs ?? []);
    },
  };
}
