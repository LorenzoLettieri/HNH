// The reinforced carbine's scope, the MODERN way (picture-in-picture, like
// the recent CoD games): you keep seeing the gun, and only INSIDE the lens
// the world is magnified.
//
// How: a second camera, at the same place as yours and looking the same way
// but with a much narrower field of view (= magnified), renders the world
// into a small texture (a WebGLRenderTarget: like rendering to an off-screen
// <canvas>). That texture is then used as the "picture" of the scope's rear
// lens (rifleView.ts), through a tiny shader that also draws the reticle and
// the dark ring of the tube's inside around the edge.
//
// The cost is a second render of the world, so: only while you're raising or
// holding the scope to your eye, at a low resolution (it's pixel art anyway),
// and without recomputing the shadows (the main render already did).
//
// Why the reticle's center is exactly where the bullet goes: both cameras
// look along YOUR aim, and the bullet flies along your aim. The lens only
// has to be centered on the screen, and the aiming pose does that.
import * as THREE from 'three';
import type { PlayerState } from '../sim/player';
import { adsAmount } from '../sim/weapon';
import { cameraFeelSettings } from './cameraFeel';

/** Resolution of the magnified picture, pixels (square). Low on purpose: chunky pixels like the rest. */
const SIZE = 128;
/** The scope's picture starts rendering when the gun is this far up to the eye (0..1). */
const SHOW_FROM = 0.35;

// Same format as the main scene's target (postprocess.ts): 16-bit floats, so
// bright lights stay above 1 and still bloom once the lens is in the frame.
const target = new THREE.WebGLRenderTarget(SIZE, SIZE, {
  type: THREE.HalfFloatType,
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: true,
});
const scopeCamera = new THREE.PerspectiveCamera(cameraFeelSettings.scopeFov, 1, 0.1, 1000);

/**
 * The rear lens's material. The fragment shader, for every pixel of the lens
 * (uv 0..1 across it; p = the same from −1 to 1, from the center):
 * - the magnified world from the texture (or dark glass when it's off);
 * - darker toward the edge, in two hard steps (pixel art, no blur): the
 *   inside of the tube seen around the picture;
 * - the reticle: a thin cross, thick "posts" from the edge, an ember dot.
 * Colors go out as they are: the scene target is linear HDR (no tone mapping
 * here, the final post-process pass does it for the whole frame).
 */
export const scopeLensMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tView: { value: target.texture },
    uOn: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tView;
    uniform float uOn;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      vec3 c = uOn > 0.5 ? texture2D(tView, vUv).rgb : vec3(0.02, 0.03, 0.045);
      c *= r > 0.93 ? 0.12 : r > 0.84 ? 0.45 : 1.0; // the tube's shadow, in two steps
      if (uOn > 0.5) {
        float thin = 0.012;
        float post = 0.05;
        bool cross = abs(p.x) < thin || abs(p.y) < thin;
        bool posts = r > 0.42 && (abs(p.y) < post && abs(p.x) > 0.42 || abs(p.x) < post && p.y < -0.42);
        if (cross || posts) c = vec3(0.01);
        if (r < 0.035) c = vec3(3.0, 0.6, 0.15); // the ember dot (HDR: it blooms a little)
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
});

/** Is the scope's picture worth rendering this frame? A reinforced carbine in hand, being raised to the eye. */
function scopeActive(p: PlayerState): boolean {
  return p.weapon === 'rifle' && p.forged.rifle > 0 && adsAmount(p) >= SHOW_FROM;
}

/**
 * Every frame, BEFORE the main render: if the scope is up, render the world
 * through the scope's camera into the lens's texture. `camera` = yours (its
 * position and rotation are copied: same eye, same aim).
 */
export function renderScopeView(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, player: PlayerState): void {
  const on = scopeActive(player);
  scopeLensMaterial.uniforms.uOn.value = on ? 1 : 0;
  if (!on) return;
  scopeCamera.position.copy(camera.position);
  scopeCamera.quaternion.copy(camera.quaternion);
  if (scopeCamera.fov !== cameraFeelSettings.scopeFov) {
    scopeCamera.fov = cameraFeelSettings.scopeFov;
    scopeCamera.updateProjectionMatrix();
  }
  const previous = renderer.getRenderTarget();
  // Don't redraw the shadow maps for the second camera: the main render
  // draws them right after; the scope uses last frame's (1/60 s old: invisible).
  const shadows = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(target);
  renderer.render(scene, scopeCamera);
  renderer.setRenderTarget(previous);
  renderer.shadowMap.autoUpdate = shadows;
}
