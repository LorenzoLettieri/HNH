// Post-processing: instead of drawing the scene straight to the screen, we
// draw it into an off-screen image (a "render target"), then draw that image
// to the screen through a shader that can transform every pixel.
//
//   scene ──render──▶ low-res image ──final shader──▶ screen
//                     (e.g. 480×270)   (upscale with sharp pixels,
//                                       limit colors, dither)
import * as THREE from 'three';
import { warmUp } from './warmUp';

/** Post-processing settings. A mutable object so the debug panel can change them live. */
export const postSettings = {
  /**
   * true = the low-res pixel-art image (pixelHeight rows); false = the
   * screen's full resolution. The menu's "Risoluzione" (settings.ts) sets both.
   */
  pixelArt: true,
  /** Vertical resolution of the low-res image. Lower = bigger pixels. */
  pixelHeight: 270,
  /** Color reduction + dithering on or off (the menu's "Colori retrò"). */
  colorReduction: true,
  /** Shades per color channel (red, green, blue). Lower = more "retro" banding. */
  colorLevels: 20,
  /**
   * Brightness as a gamma curve: color^(1/gamma), on the final sRGB values.
   * 1 = unchanged; above 1 the darks come up a lot and the brights barely move
   * (0.1 → 0.32 at gamma 2, while 1 stays 1): it shows what's in the shadows
   * without burning the sky white, which a plain multiplication would do.
   */
  gamma: 1,
  /** Dithering strength: 0 = hard color bands, 1 = bands broken by a pixel pattern. */
  dither: 1,

  // --- Bloom: bright things bleed light around them ---
  /** Only light brighter than this blooms (1 = "white"; HDR lights go above). */
  bloomThreshold: 0.9,
  /** How much glow is added back on top of the image. */
  bloomStrength: 0.8,
  /** Blur passes: more = wider, softer glow (and more GPU work). */
  bloomPasses: 3,
};

// A full-screen pass: a rectangle covering the whole screen, seen by a camera
// that does nothing. Its fragment shader runs once per screen pixel.
const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0); // already in screen space (-1..1)
  }
`;

// Keeps only what's brighter than the threshold (the "bright pass").
const brightFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb;
    float brightness = max(c.r, max(c.g, c.b));
    // Smoothly fade in above the threshold, instead of an on/off cut.
    float amount = smoothstep(threshold, threshold + 0.5, brightness);
    gl_FragColor = vec4(c * amount, 1.0);
  }
`;

// Gaussian blur along ONE direction. Doing horizontal then vertical gives the
// same result as a 2D blur, with 9 + 9 samples per pixel instead of 9 × 9.
const blurFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 direction;   // (1/width, 0) or (0, 1/height), times a spread
  varying vec2 vUv;
  void main() {
    // Weights of a bell curve: the center counts most, neighbors less and less.
    vec3 sum = texture2D(tInput, vUv).rgb * 0.227027;
    sum += texture2D(tInput, vUv + direction * 1.0).rgb * 0.1945946;
    sum += texture2D(tInput, vUv - direction * 1.0).rgb * 0.1945946;
    sum += texture2D(tInput, vUv + direction * 2.0).rgb * 0.1216216;
    sum += texture2D(tInput, vUv - direction * 2.0).rgb * 0.1216216;
    sum += texture2D(tInput, vUv + direction * 3.0).rgb * 0.054054;
    sum += texture2D(tInput, vUv - direction * 3.0).rgb * 0.054054;
    sum += texture2D(tInput, vUv + direction * 4.0).rgb * 0.016216;
    sum += texture2D(tInput, vUv - direction * 4.0).rgb * 0.016216;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// God rays ("crepuscular rays"): for each pixel, walk in a straight line
// toward the sun on screen and add up how much bright SKY we cross. Where a
// wall stands between the pixel and the sun, the walk crosses fewer sky
// pixels: those are the shadows between the rays.
const raysFragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform vec2 sunPosition; // sun position on screen, 0..1
  uniform float strength;
  uniform float aspect;     // width / height, to measure distances in a round way
  varying vec2 vUv;

  const int SAMPLES = 48;

  // Brightness that can "shine through": only sky pixels count. The sky
  // never writes depth, so its depth is still the cleared value (1.0).
  // And only the sky around the sun: the rest of the sky doesn't emit rays.
  vec3 skyLight(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
    if (texture2D(tDepth, uv).r < 0.99999) return vec3(0.0);
    float nearSun = 1.0 - smoothstep(0.0, 0.25, length((uv - sunPosition) * vec2(aspect, 1.0)));
    return max(texture2D(tScene, uv).rgb - 0.5, 0.0) * nearSun;
  }

  // Cheap per-pixel random number in 0..1.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 step = (vUv - sunPosition) / float(SAMPLES);
    // Start each pixel's walk at a slightly random offset. With a fixed start,
    // neighboring pixels sample the same spots and we'd see stair-step bands;
    // with jitter the bands turn into fine noise, which the eye averages out.
    vec2 uv = vUv - step * hash(vUv * 1000.0);
    vec3 sum = vec3(0.0);
    float weight = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
      sum += skyLight(uv) * weight;
      weight *= 0.97; // samples closer to the sun count a bit less: rays fade
      uv -= step;
    }
    gl_FragColor = vec4(sum / float(SAMPLES) * strength, 1.0);
  }
`;

const finalFragment = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform sampler2D tRays;
  uniform float bloomStrength;
  uniform vec2 resolution;   // size of the low-res image, in pixels
  uniform float levels;      // 0 = no color reduction
  uniform float dither;
  uniform float gamma;
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
    // Bloom is added in linear light, before anything else: it's "more light".
    color += texture2D(tBloom, vUv).rgb * bloomStrength;
    color += texture2D(tRays, vUv).rgb;

    // Values above 1 can't be shown. Scale the whole color down instead of
    // clipping each channel: a too-bright orange stays orange, not yellow-white.
    color /= max(1.0, max(color.r, max(color.g, color.b)));
    color = linearToSRGB(color);
    color = pow(color, vec3(1.0 / gamma)); // brightness (postSettings.gamma)

    if (levels > 0.0) {
      vec2 pixel = floor(vUv * resolution); // which low-res pixel we're in
      float threshold = (bayer4(pixel) - 0.5) * dither;
      color = floor(color * (levels - 1.0) + 0.5 + threshold) / (levels - 1.0);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

function fullscreenMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertex,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

export interface PostProcess {
  /**
   * Renders the scene, then (optionally) an overlay scene on top of it with
   * the depth buffer cleared: used for the gun in your hand.
   */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    overlay?: { scene: THREE.Scene; camera: THREE.Camera },
  ): void;
  /** Where the sun is (unit direction) and how strong its rays are. */
  setSun(direction: THREE.Vector3, godRays: number): void;
  setSize(width: number, height: number): void;
  /** Switches between the pixel-art look and full resolution (for comparison). */
  togglePixelArt(): void;
  /** Re-applies size-related settings (e.g. after changing pixelHeight). */
  refresh(): void;
  /** Size in pixels of the image the scene is rendered into. */
  readonly sceneSize: THREE.Vector2;
  /**
   * Compiles every shader and uploads every texture of the scene (and the
   * overlay) ahead of time, drawing them once off screen (see warmUp.ts).
   * Returns how long it took (ms).
   */
  warmUp(scene: THREE.Scene, camera: THREE.PerspectiveCamera, overlay?: { scene: THREE.Scene; camera: THREE.Camera }): number;
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
  // Also keep the depth buffer as a readable texture: the god rays need to
  // know which pixels are sky (nothing drawn there) and which are geometry.
  sceneTarget.depthTexture = new THREE.DepthTexture(1, 1);

  // Bloom works at half the scene resolution: it's a blurry glow anyway, so
  // fewer pixels = cheaper, and each blur step reaches twice as far.
  // Two targets, used in turn ("ping-pong"): read from one, write to the other.
  const bloomOptions = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter, // smooth: the glow should be soft
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  };
  const bloomA = new THREE.WebGLRenderTarget(1, 1, bloomOptions);
  const bloomB = new THREE.WebGLRenderTarget(1, 1, bloomOptions);
  const raysTarget = new THREE.WebGLRenderTarget(1, 1, bloomOptions);

  const brightMaterial = fullscreenMaterial(brightFragment, {
    tInput: { value: sceneTarget.texture },
    threshold: { value: 0 },
  });
  const blurMaterial = fullscreenMaterial(blurFragment, {
    tInput: { value: null },
    direction: { value: new THREE.Vector2() },
  });
  const raysMaterial = fullscreenMaterial(raysFragment, {
    tScene: { value: sceneTarget.texture },
    tDepth: { value: sceneTarget.depthTexture },
    sunPosition: { value: new THREE.Vector2() },
    strength: { value: 0 },
    aspect: { value: 1 },
  });
  const finalMaterial = fullscreenMaterial(finalFragment, {
    tScene: { value: sceneTarget.texture },
    tBloom: { value: bloomA.texture },
    tRays: { value: raysTarget.texture },
    bloomStrength: { value: 0 },
    resolution: { value: new THREE.Vector2() },
    levels: { value: 0 },
    dither: { value: 0 },
    gamma: { value: 1 },
  });

  // One full-screen rectangle; we swap its material for each pass.
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), finalMaterial);
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** Runs one full-screen pass with `material`, writing into `target` (null = screen). */
  function pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCamera);
  }

  let screenW = 1;
  let screenH = 1;
  const sceneSize = new THREE.Vector2();
  // What the targets were last sized for: render() resizes them when the
  // settings change (menu or debug panel), without anyone having to tell it.
  let sizedPixelArt = true;
  let sizedHeight = 0;

  function resizeTargets(): void {
    sizedPixelArt = postSettings.pixelArt;
    sizedHeight = postSettings.pixelHeight;
    if (postSettings.pixelArt) {
      // Keep the screen's aspect ratio, with a fixed number of rows.
      const h = Math.round(postSettings.pixelHeight);
      sceneSize.set(Math.round((h * screenW) / screenH), h);
    } else {
      sceneSize.set(screenW, screenH).multiplyScalar(renderer.getPixelRatio()).round();
    }
    sceneTarget.setSize(sceneSize.x, sceneSize.y);
    const bw = Math.max(1, Math.round(sceneSize.x / 2));
    const bh = Math.max(1, Math.round(sceneSize.y / 2));
    bloomA.setSize(bw, bh);
    bloomB.setSize(bw, bh);
    raysTarget.setSize(bw, bh);
    finalMaterial.uniforms.resolution.value.copy(sceneSize);
  }

  const sunDirection = new THREE.Vector3(0, 1, 0);
  let godRays = 0;
  const sunOnScreen = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();

  return {
    sceneSize,
    setSun(direction, strength) {
      sunDirection.copy(direction);
      godRays = strength;
    },
    warmUp(scene, camera, overlay) {
      const start = performance.now();
      warmUp(renderer, sceneTarget, overlay ? [{ scene, camera }, overlay] : [{ scene, camera }]);
      // One real frame too: it compiles the post-process' own shaders (bloom, god rays, final).
      this.render(scene, camera, overlay);
      return performance.now() - start;
    },
    render(scene, camera, overlay) {
      // Settings may have changed (debug panel): copy them into the uniforms.
      brightMaterial.uniforms.threshold.value = postSettings.bloomThreshold;
      finalMaterial.uniforms.bloomStrength.value = postSettings.bloomStrength;
      finalMaterial.uniforms.levels.value = postSettings.colorReduction ? postSettings.colorLevels : 0;
      finalMaterial.uniforms.dither.value = postSettings.dither;
      finalMaterial.uniforms.gamma.value = postSettings.gamma;
      if (sizedPixelArt !== postSettings.pixelArt || sizedHeight !== postSettings.pixelHeight) resizeTargets();

      // 1. Scene → low-res image.
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);
      if (overlay) {
        // Draw the overlay ON TOP of what's there: don't clear the colors,
        // only the depth, so the world can't hide the gun.
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(overlay.scene, overlay.camera);
        renderer.autoClear = true;
      }

      // 2. Bloom: bright pass into A, then blur A→B (horizontal), B→A (vertical),
      //    a few times, spreading further each time.
      pass(brightMaterial, bloomA);
      const texel = new THREE.Vector2(1 / bloomA.width, 1 / bloomA.height);
      for (let i = 0; i < postSettings.bloomPasses; i++) {
        const spread = i + 1;
        blurMaterial.uniforms.tInput.value = bloomA.texture;
        blurMaterial.uniforms.direction.value.set(texel.x * spread, 0);
        pass(blurMaterial, bloomB);
        blurMaterial.uniforms.tInput.value = bloomB.texture;
        blurMaterial.uniforms.direction.value.set(0, texel.y * spread);
        pass(blurMaterial, bloomA);
      }

      // 3. God rays, only if the sun is in front of us.
      camera.getWorldDirection(cameraForward);
      const facing = cameraForward.dot(sunDirection); // 1 = looking straight at it
      // Project a point far away toward the sun onto the screen (-1..1 → 0..1).
      sunOnScreen.copy(sunDirection).multiplyScalar(100).add(camera.position).project(camera);
      const visibility = THREE.MathUtils.smoothstep(facing, 0.1, 0.6);
      raysMaterial.uniforms.strength.value = godRays * visibility;
      raysMaterial.uniforms.aspect.value = sceneSize.x / sceneSize.y;
      raysMaterial.uniforms.sunPosition.value.set((sunOnScreen.x + 1) / 2, (sunOnScreen.y + 1) / 2);
      if (visibility > 0) {
        pass(raysMaterial, raysTarget);
      } else {
        renderer.setRenderTarget(raysTarget);
        renderer.clear(); // no sun in view: no rays
      }

      // 4. Scene + bloom + rays → screen, through the final shader.
      pass(finalMaterial, null);
    },
    setSize(width, height) {
      screenW = width;
      screenH = height;
      resizeTargets();
    },
    togglePixelArt() {
      postSettings.pixelArt = !postSettings.pixelArt;
      resizeTargets();
    },
    refresh() {
      resizeTargets();
    },
  };
}
