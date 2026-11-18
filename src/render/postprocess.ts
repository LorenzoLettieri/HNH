// Post-processing: instead of drawing the scene straight to the screen, we
// draw it into an off-screen image (a "render target"), then draw that image
// to the screen through a shader that can transform every pixel.
//
//   scene ──render──▶ low-res image ──final shader──▶ screen
//                     (e.g. 480×270)   (upscale with sharp pixels,
//                                       limit colors, dither)
import * as THREE from 'three';

/** Vertical resolution of the low-res image. Lower = bigger pixels. */
const PIXEL_HEIGHT = 270;
/** Shades per color channel (red, green, blue). Lower = more "retro" banding. */
const COLOR_LEVELS = 20;
/** Dithering strength: 0 = hard color bands, 1 = bands broken by a pixel pattern. */
const DITHER = 1;

// A full-screen pass: a rectangle covering the whole screen, seen by a camera
// that does nothing. Its fragment shader runs once per screen pixel.
const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // already in screen space (-1..1)
  }
`;

const finalFragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 resolution;   // size of the low-res image, in pixels
  uniform float levels;      // 0 = no color reduction
  uniform float dither;
  varying vec2 vUv;

  // Ordered dithering: a 4×4 grid of thresholds (Bayer matrix). Neighboring
  // pixels get different thresholds, so a color between two shades turns into
  // a checkered mix of both, which the eye blends back together.
  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    const float m[16] = float[16](
       0.0,  8.0,  2.0, 10.0,
      12.0,  4.0, 14.0,  6.0,
       3.0, 11.0,  1.0,  9.0,
      15.0,  7.0, 13.0,  5.0);
    return (m[x + y * 4] + 0.5) / 16.0; // 0..1
  }

  // The image holds LINEAR light values; screens expect sRGB.
  vec3 linearToSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 color = texture2D(tScene, vUv).rgb;

    // Values above 1 can't be shown. Scale the whole color down instead of
    // clipping each channel: a too-bright orange stays orange, not yellow-white.
    color /= max(1.0, max(color.r, max(color.g, color.b)));
    color = linearToSRGB(color);

    if (levels > 0.0) {
      vec2 pixel = floor(vUv * resolution); // which low-res pixel we're in
      float threshold = (bayer4(pixel) - 0.5) * dither;
      color = floor(color * (levels - 1.0) + 0.5 + threshold) / (levels - 1.0);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface PostProcess {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  /** Switches between the pixel-art look and full resolution (for comparison). */
  togglePixelArt(): void;
  /** Size in pixels of the image the scene is rendered into. */
  readonly sceneSize: THREE.Vector2;
}

export function createPostProcess(renderer: THREE.WebGLRenderer): PostProcess {
  // HalfFloat = each color channel stored as a 16-bit float, so values above 1
  // (very bright lights) aren't lost. We'll need that for the bloom.
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    // Nearest when the image gets stretched to the screen: sharp, square pixels.
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });

  const finalMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader: finalFragment,
    uniforms: {
      tScene: { value: sceneTarget.texture },
      resolution: { value: new THREE.Vector2() },
      levels: { value: COLOR_LEVELS },
      dither: { value: DITHER },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finalMaterial);
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let pixelArt = true;
  let screenW = 1;
  let screenH = 1;
  const sceneSize = new THREE.Vector2();

  function resizeTargets(): void {
    if (pixelArt) {
      // Keep the screen's aspect ratio, with a fixed number of rows.
      sceneSize.set(Math.round((PIXEL_HEIGHT * screenW) / screenH), PIXEL_HEIGHT);
    } else {
      sceneSize.set(screenW, screenH).multiplyScalar(renderer.getPixelRatio()).round();
    }
    sceneTarget.setSize(sceneSize.x, sceneSize.y);
    finalMaterial.uniforms.resolution.value.copy(sceneSize);
    finalMaterial.uniforms.levels.value = pixelArt ? COLOR_LEVELS : 0;
  }

  return {
    sceneSize,
    render(scene, camera) {
      // 1. Scene → low-res image.
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      // 2. Image → screen, through the final shader.
      renderer.setRenderTarget(null);
      renderer.render(postScene, postCamera);
    },
    setSize(width, height) {
      screenW = width;
      screenH = height;
      resizeTargets();
    },
    togglePixelArt() {
      pixelArt = !pixelArt;
      resizeTargets();
    },
  };
}
