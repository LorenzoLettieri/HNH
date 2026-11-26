// Performance meter (the "measure first" of docs/DESIGN.md §9): where does a
// frame's time go? Toggled from "Debug tools" in the debug panel.
//
// What it measures, averaged over WINDOW seconds (one number every half
// second is readable, one per frame jitters too fast):
// - frame: the time between two frames (1000 / fps), and the WORST frame of
//   the window: a stutter is one long frame, and an average hides it.
// - sim:   the fixed-step ticks of the frame (stepGame), CPU.
// - scena: the renderers' update() calls (sprites, particles, HUD...), CPU.
// - draw:  post.render, the CPU side only: three.js walking the scene and
//   sending the draw calls to WebGL. The GPU executes them later, in parallel.
// - GPU:   how long the GPU really took to draw the frame, with a timer query
//   (EXT_disjoint_timer_query_webgl2: Chrome/Edge desktop; elsewhere "n/d").
//   The answer arrives a few frames later: the GPU works behind the CPU.
// - draw call, triangles: counted by three.js (renderer.info), summed over
//   every pass of the frame (shadow map, scene, gun, post-process).
//
// How to read it: if frame ≈ sim + scena + draw the CPU is the bottleneck
// (look at the biggest of the three); if frame is much bigger and GPU is close
// to it, the GPU is (too many pixels, lights, draw calls or a heavy shader).
import type * as THREE from 'three';

/** Seconds over which the numbers are averaged. */
const WINDOW = 0.5;

type Section = 'sim' | 'scene' | 'draw';

export interface PerfMeter {
  /** Start of a frame: closes the previous one. */
  frameStart(now: number): void;
  begin(section: Section): void;
  end(section: Section): void;
  /** Wrap the GPU work of the frame (post.render). */
  gpuBegin(): void;
  gpuEnd(): void;
  /** End of a frame: reads the counters, updates the text every WINDOW s. */
  frameEnd(entities: number): void;
  toggle(): void;
}

export function createPerfMeter(renderer: THREE.WebGLRenderer, element: HTMLElement): PerfMeter {
  let visible = false;
  let lastFrame = 0;
  const started: Record<Section, number> = { sim: 0, scene: 0, draw: 0 };
  // Sums over the window, divided by the frames at the end.
  const sum = { frame: 0, sim: 0, scene: 0, draw: 0, calls: 0, triangles: 0, gpu: 0 };
  let frames = 0;
  let gpuSamples = 0;
  let worst = 0;
  let windowTime = 0;

  // --- GPU timer query (WebGL2 extension) ---
  // A query is a little "stopwatch" object on the GPU: begin/end around the
  // commands, and some frames later its result is ready. We keep a few in
  // flight because the next frame starts before the last one's answer arrives.
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;

  function readQueries(): void {
    while (pending.length > 0) {
      const q = pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break; // the oldest isn't ready: the others neither
      pending.shift();
      // "Disjoint": something interrupted the GPU clock (power saving, another
      // app): the measurement is garbage, throw it away.
      const disjoint = gl.getParameter(timer!.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      if (disjoint) continue;
      sum.gpu += ns / 1e6;
      gpuSamples++;
    }
  }

  function show(entities: number): void {
    const n = Math.max(frames, 1);
    const ms = (v: number) => (v / n).toFixed(1);
    const gpu = !timer ? 'n/d' : gpuSamples > 0 ? (sum.gpu / gpuSamples).toFixed(1) : '…';
    element.textContent =
      `frame ${ms(sum.frame)} ms (peggiore ${worst.toFixed(1)})\n` +
      `sim ${ms(sum.sim)} · scena ${ms(sum.scene)} · draw ${ms(sum.draw)} · GPU ${gpu}\n` +
      `${Math.round(sum.calls / n)} draw call · ${Math.round(sum.triangles / n / 1000)}k triangoli · ${entities} entità`;
  }

  return {
    frameStart(now) {
      const frameMs = lastFrame > 0 ? now - lastFrame : 0;
      lastFrame = now;
      if (!visible) return;
      renderer.info.reset();
      sum.frame += frameMs;
      worst = Math.max(worst, frameMs);
      windowTime += frameMs / 1000;
    },
    begin(section) {
      if (visible) started[section] = performance.now();
    },
    end(section) {
      if (visible) sum[section] += performance.now() - started[section];
    },
    gpuBegin() {
      if (!visible || !timer || active) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(timer.TIME_ELAPSED_EXT, active);
    },
    gpuEnd() {
      if (!active || !timer) return;
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    frameEnd(entities) {
      if (!visible) return;
      sum.calls += renderer.info.render.calls;
      sum.triangles += renderer.info.render.triangles;
      frames++;
      if (timer) readQueries();
      if (windowTime < WINDOW) return;
      show(entities);
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] = 0;
      frames = gpuSamples = 0;
      worst = windowTime = 0;
    },
    toggle() {
      visible = !visible;
      element.hidden = !visible;
      element.textContent = visible ? '…' : '';
      // renderer.info resets itself at every render() call by default: with
      // several passes per frame it would only count the last one (the
      // post-process quad: 1 draw call). While measuring we reset it once per frame.
      renderer.info.autoReset = !visible;
    },
  };
}
