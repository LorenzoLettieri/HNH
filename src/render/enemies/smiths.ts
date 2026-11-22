// Draws the Damned Smith (sprite in smithSprite.ts: three views, the side one
// mirrored, picked from the angle like the bull's), its SHOCKWAVE (a ring of
// fire spreading on the ground from the hammer) and its red-hot CHAIN.
//
// The warning must be readable: during the wind-up the sprite trembles more
// and more and its glow (eye slit, cracks, hammer) heats up; at the slam,
// dirt flies and the ring starts. The ring is exactly the one the simulation
// checks (same center, same radius, same thickness): if you see it under your
// feet, it hits you.
import * as THREE from 'three';
import { TICK_RATE, tuning } from '../../sim/config';
import type { Entity, SmithEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { addHeightFog } from '../heightFog';
import { soundAt } from '../soundPosition';
import { spawnDirt } from '../particles';
import { FRAMES, FRAME_H, FRAME_W, smithSheet } from './smithSprite';
import {
  playSmithDeath,
  playSmithHookEnd,
  playSmithHookHit,
  playSmithHookSwing,
  playSmithHookThrow,
  playSmithSlam,
  playSmithWindup,
} from '../../audio/sfx';
import { HAND_HEIGHT } from '../../sim/smith';

const PIXELS_PER_METER = 32;
/** Walk animation: frames per meter walked. */
const FRAMES_PER_METER = 1.2;
/** Glow of the eye slit and the cracks (HDR, blooms): calm, and at the end of the wind-up. */
const GLOW_CALM = 2;
const GLOW_WINDUP = 8;
/** Trembling during the wind-up: sideways shake at the end, meters, and its speed (rad/s). */
const SHAKE_MAX = 0.06;
const SHAKE_SPEED = 60;
/** The red tint when hit, seconds. */
const HURT_TIME = 0.1;
/** How fast its facing follows its direction while walking (1/s): a brute turns slowly. */
const TURN_RATE = 5;
/** Within this angle of "straight at / away from the camera", show the front / back view. */
const FRONT_ANGLE = (35 * Math.PI) / 180;
/** Swinging the chain: seconds per frame (the hook passes from one side to the other). */
const SWING_FRAME_TIME = 0.12;
/** The ring: color (HDR: above 1 blooms) and how much it fades toward its maximum radius. */
const RING_COLOR = new THREE.Color(3, 0.9, 0.25);
/** Height above the ground (2 cm, like the other things lying on the floor: no z-fighting). */
const RING_LIFT = 0.02;
/** Dirt thrown up by the slam. */
const SLAM_DIRT = 30;
/** The red-hot chain: one glowing square ("link") every LINK_GAP meters, LINK_SIZE wide; the hook bigger. */
const LINK_GAP = 0.22;
const LINK_SIZE = 0.09;
const HOOK_SIZE = 0.3;
const MAX_LINKS = 128;
const CHAIN_COLOR = new THREE.Color(2.2, 0.7, 0.18);
const HOOK_COLOR = new THREE.Color(3, 1.4, 0.4);

interface SmithView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  ring: THREE.Mesh;
  ringMaterial: THREE.ShaderMaterial;
  /** The chain (a row of glowing points) and the hook at its end. */
  chain: THREE.Points;
  hook: THREE.Points;
  walkPhase: number;
  /** Where it faces (radians, the player's yaw convention), smoothed while walking. */
  yaw: number;
  hurtTime: number;
  fallAngle: number;
}

export interface SmithRenderer {
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

/**
 * The ring is drawn by a tiny SHADER on a flat square: for every pixel the
 * fragment shader computes its distance from the center and keeps it only if
 * it's within half the thickness of the radius. One square, any radius: no
 * new geometry every frame (a RingGeometry would have to be rebuilt as it grows).
 */
function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRadius: { value: 0 },
      uHalf: { value: tuning.smithWaveThickness / 2 },
      uSize: { value: 1 }, // half the side of the square, meters
      uColor: { value: RING_COLOR },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRadius, uHalf, uSize, uFade;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * uSize;  // meters from the center
        float d = abs(length(p) - uRadius);   // meters from the ring's middle line
        if (d > uHalf) discard;               // hard edges: pixel art, no blur
        float core = d < uHalf * 0.4 ? 1.0 : 0.55; // a brighter line in the middle
        gl_FragColor = vec4(uColor * core * uFade, 1.0);
      }`,
    blending: THREE.AdditiveBlending, // light adds up: fire on the ground
    depthWrite: false,
    transparent: true,
  });
}

export function createSmithRenderer(scene: THREE.Scene): SmithRenderer {
  const sheet = smithSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  const geometry = new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
  const ringGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // flat on the ground
  const views = new Map<number, SmithView>();

  function create(): SmithView {
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      emissive: 0xff5a20,
      emissiveMap: glowMap,
      emissiveIntensity: GLOW_CALM,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.order = 'YXZ';
    mesh.castShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);
    const ringMaterial = createRingMaterial();
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.visible = false;
    scene.add(ring);
    // The chain: a fixed buffer of MAX_LINKS points; each frame we write the
    // ones we need along the line and draw only those (setDrawRange).
    // THREE.Points draws each point as a square that always faces the
    // camera: exactly a pixel-art chain link.
    const chainGeometry = new THREE.BufferGeometry();
    chainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_LINKS * 3), 3));
    const chain = new THREE.Points(chainGeometry, new THREE.PointsMaterial({ color: CHAIN_COLOR, size: LINK_SIZE }));
    chain.frustumCulled = false; // its bounding sphere isn't updated as the points move
    const hookGeometry = new THREE.BufferGeometry();
    hookGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const hook = new THREE.Points(hookGeometry, new THREE.PointsMaterial({ color: HOOK_COLOR, size: HOOK_SIZE }));
    hook.frustumCulled = false;
    chain.visible = hook.visible = false;
    scene.add(chain, hook);
    return { mesh, material, map, glowMap, ring, ringMaterial, chain, hook, walkPhase: 0, yaw: 0, hurtTime: 0, fallAngle: 0 };
  }

  /** Shows one frame of the sheet; a NEGATIVE repeat mirrors it for free (see hounds.ts). */
  function showFrame(v: SmithView, frame: number, mirror: boolean): void {
    const n = sheet.frameCount;
    for (const t of [v.map, v.glowMap]) {
      t.repeat.x = (mirror ? -1 : 1) / n;
      t.offset.x = (mirror ? frame + 1 : frame) / n;
    }
  }

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        const s = 'entityId' in e && e.entityId !== null ? byId.get(e.entityId) : undefined;
        if (!s || s.type !== 'smith') continue;
        if (e.type === 'smithWindup') playSmithWindup(soundAt(camera, s.x, s.y + 2, s.z));
        if (e.type === 'smithHookAim') playSmithHookSwing(soundAt(camera, s.x, s.y + 2, s.z));
        if (e.type === 'smithHookThrow') playSmithHookThrow(soundAt(camera, s.x, s.y + 2, s.z));
        if (e.type === 'smithHookHit') playSmithHookHit();
        if (e.type === 'smithHookEnd') playSmithHookEnd(soundAt(camera, s.x, s.y + 2, s.z));
        if (e.type === 'smithSlam') {
          playSmithSlam(soundAt(camera, e.x, e.y, e.z));
          spawnDirt(new THREE.Vector3(e.x, e.y + 0.1, e.z), new THREE.Vector3(0, 1, 0), SLAM_DIRT);
        }
        if (e.type === 'hit') {
          const v = views.get(s.id);
          if (v) v.hurtTime = HURT_TIME;
          if (e.killed) playSmithDeath(soundAt(camera, s.x, s.y + 2, s.z));
        }
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'smith') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        animate(v, e, camera, alpha, dt);
        drawRing(v, e);
        drawChain(v, e, alpha);
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.mesh, v.ring, v.chain, v.hook);
        v.material.dispose();
        v.ringMaterial.dispose();
        v.chain.geometry.dispose();
        v.hook.geometry.dispose();
        (v.chain.material as THREE.Material).dispose();
        (v.hook.material as THREE.Material).dispose();
        v.map.dispose();
        v.glowMap.dispose();
        views.delete(id);
      }
    },
  };

  function animate(v: SmithView, e: SmithEntity, camera: THREE.Camera, alpha: number, dt: number): void {
    v.mesh.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    const toCamera = Math.atan2(camera.position.x - v.mesh.position.x, camera.position.z - v.mesh.position.z);
    v.mesh.rotation.y = toCamera; // cylindrical billboard
    v.hurtTime -= dt;
    v.material.color.setRGB(1, v.hurtTime > 0 ? 0.4 : 1, v.hurtTime > 0 ? 0.4 : 1);
    v.material.emissiveIntensity = GLOW_CALM;

    // Which VIEW, like the bull (see bulls.ts): the angle between where it
    // faces and where the camera is. Its facing is smoothed while walking
    // (a brute doesn't spin on the spot), exact while attacking (it faces you).
    const target = Math.atan2(e.dirX, e.dirZ);
    if (e.state !== 'approach') v.yaw = target;
    else {
      const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
      v.yaw += diff * Math.min(1, TURN_RATE * dt);
    }
    const rel = v.yaw - toCamera;
    const cos = Math.cos(rel);
    const facing = cos > Math.cos(FRONT_ANGLE) ? 'front' : cos < -Math.cos(FRONT_ANGLE) ? 'back' : 'side';
    const mirror = facing === 'side' && Math.sin(rel) < 0;
    // The back view only walks: an attack always faces you, so seen from
    // behind (it can't really happen) it shows the front pose.
    const pose = facing === 'side' ? FRAMES.side : FRAMES.front;

    if (e.state === 'dead') {
      showFrame(v, FRAMES.dead, mirror);
      return;
    }
    if (e.state === 'windup') {
      // 0 → 1 over the wind-up: shake and glow grow, so you feel when it lands.
      const t = Math.min(1, e.stateTicks / (tuning.smithSlamWindup * TICK_RATE));
      showFrame(v, pose.windup, mirror);
      v.material.emissiveIntensity = GLOW_CALM + (GLOW_WINDUP - GLOW_CALM) * t;
      const shake = Math.sin(performance.now() / 1000 * SHAKE_SPEED) * SHAKE_MAX * t;
      // Sideways relative to the camera: along the sprite's own "right".
      v.mesh.position.x += Math.cos(toCamera) * shake;
      v.mesh.position.z -= Math.sin(toCamera) * shake;
    } else if (e.state === 'recover') {
      showFrame(v, pose.slam, mirror);
    } else if (e.state === 'hookAim') {
      // The chain circling over its head: two frames, the hook on one side then the other.
      const turn = Math.floor(e.stateTicks / (SWING_FRAME_TIME * TICK_RATE)) % 2;
      showFrame(v, pose.swing[turn], mirror);
    } else if (e.state === 'hookThrow') {
      showFrame(v, pose.throw, mirror);
    } else if (e.state === 'hookPull') {
      showFrame(v, pose.pull, mirror);
    } else {
      v.walkPhase += Math.hypot(e.vx, e.vz) * dt * FRAMES_PER_METER;
      const walk = facing === 'side' ? FRAMES.side.walk : facing === 'back' ? FRAMES.back.walk : FRAMES.front.walk;
      showFrame(v, walk[Math.floor(v.walkPhase) % walk.length], mirror);
    }
  }

  /**
   * The chain, from its hand to the hook, while the hook flies or holds you.
   * Flying, the hook moves 0.5 m per tick: drawn where it was a fraction of a
   * tick ago (position − velocity × the time not yet elapsed), so it glides
   * smoothly at any frame rate, like the interpolated enemies.
   */
  function drawChain(v: SmithView, e: SmithEntity, alpha: number): void {
    const on = e.state === 'hookThrow' || e.state === 'hookPull';
    v.chain.visible = v.hook.visible = on;
    if (!on) return;
    const back = e.state === 'hookThrow' ? (1 - alpha) / TICK_RATE : 0;
    const hx = e.hookX - e.hookVX * back;
    const hy = e.hookY - e.hookVY * back;
    const hz = e.hookZ - e.hookVZ * back;
    const p = v.mesh.position; // already interpolated (and shaking) by animate()
    const ax = p.x + e.dirX * 0.5;
    const ay = e.y + HAND_HEIGHT;
    const az = p.z + e.dirZ * 0.5;
    const length = Math.hypot(hx - ax, hy - ay, hz - az);
    const links = Math.min(MAX_LINKS, Math.max(2, Math.ceil(length / LINK_GAP)));
    const pos = v.chain.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      // A slight sag in the middle (a parabola: 0 at both ends, max at t = 0.5):
      // a chain is never a perfect rod. Less sag when it's pulling (taut).
      const sag = 4 * t * (1 - t) * length * (e.state === 'hookPull' ? 0.01 : 0.03);
      pos.setXYZ(i, ax + (hx - ax) * t, ay + (hy - ay) * t - sag, az + (hz - az) * t);
    }
    pos.needsUpdate = true;
    v.chain.geometry.setDrawRange(0, links);
    const hookPos = v.hook.geometry.attributes.position as THREE.BufferAttribute;
    hookPos.setXYZ(0, hx, hy, hz);
    hookPos.needsUpdate = true;
  }

  /** The ring, from the simulation's numbers: center, radius = time × speed, fading as it grows. */
  function drawRing(v: SmithView, e: SmithEntity): void {
    v.ring.visible = e.waveTicks >= 0;
    if (!v.ring.visible) return;
    const radius = (e.waveTicks / TICK_RATE) * tuning.smithWaveSpeed;
    const half = tuning.smithWaveThickness / 2;
    const size = radius + half + 0.1;
    v.ring.position.set(e.waveX, e.waveY + RING_LIFT, e.waveZ);
    v.ring.scale.set(size * 2, 1, size * 2);
    v.ringMaterial.uniforms.uRadius.value = radius;
    v.ringMaterial.uniforms.uHalf.value = half;
    v.ringMaterial.uniforms.uSize.value = size;
    v.ringMaterial.uniforms.uFade.value = 1 - 0.6 * Math.min(1, radius / tuning.smithWaveRange);
  }
}
