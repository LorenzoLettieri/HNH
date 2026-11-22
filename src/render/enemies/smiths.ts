// Draws the Damned Smith (PLACEHOLDER sprite, front view only: smithSprite.ts)
// and its SHOCKWAVE: a ring of fire spreading on the ground from the hammer.
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
import { FRAMES, FRAME_H, FRAME_W, SMITH_FRAME_COUNT, smithSheet } from './smithSprite';
import { playSmithDeath, playSmithSlam, playSmithWindup } from '../../audio/sfx';

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
/** The ring: color (HDR: above 1 blooms) and how much it fades toward its maximum radius. */
const RING_COLOR = new THREE.Color(3, 0.9, 0.25);
/** Height above the ground (2 cm, like the other things lying on the floor: no z-fighting). */
const RING_LIFT = 0.02;
/** Dirt thrown up by the slam. */
const SLAM_DIRT = 30;

interface SmithView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  ring: THREE.Mesh;
  ringMaterial: THREE.ShaderMaterial;
  walkPhase: number;
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
    return { mesh, material, map, glowMap, ring, ringMaterial, walkPhase: 0, hurtTime: 0, fallAngle: 0 };
  }

  function showFrame(v: SmithView, frame: number): void {
    v.map.offset.x = v.glowMap.offset.x = frame / SMITH_FRAME_COUNT;
  }

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        const s = 'entityId' in e && e.entityId !== null ? byId.get(e.entityId) : undefined;
        if (!s || s.type !== 'smith') continue;
        if (e.type === 'smithWindup') playSmithWindup(soundAt(camera, s.x, s.y + 2, s.z));
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
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.mesh, v.ring);
        v.material.dispose();
        v.ringMaterial.dispose();
        v.map.dispose();
        v.glowMap.dispose();
        views.delete(id);
      }
    },
  };

  function animate(v: SmithView, e: SmithEntity, camera: THREE.Camera, alpha: number, dt: number): void {
    v.mesh.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    v.mesh.rotation.y = Math.atan2(camera.position.x - v.mesh.position.x, camera.position.z - v.mesh.position.z);
    v.hurtTime -= dt;
    v.material.color.setRGB(1, v.hurtTime > 0 ? 0.4 : 1, v.hurtTime > 0 ? 0.4 : 1);
    v.material.emissiveIntensity = GLOW_CALM;
    if (e.state === 'dead') {
      showFrame(v, FRAMES.dead);
      return;
    }
    if (e.state === 'windup') {
      // 0 → 1 over the wind-up: shake and glow grow, so you feel when it lands.
      const t = Math.min(1, e.stateTicks / (tuning.smithSlamWindup * TICK_RATE));
      showFrame(v, FRAMES.windup);
      v.material.emissiveIntensity = GLOW_CALM + (GLOW_WINDUP - GLOW_CALM) * t;
      const shake = Math.sin(performance.now() / 1000 * SHAKE_SPEED) * SHAKE_MAX * t;
      // Sideways relative to the camera: along the sprite's own "right".
      v.mesh.position.x += Math.cos(v.mesh.rotation.y) * shake;
      v.mesh.position.z -= Math.sin(v.mesh.rotation.y) * shake;
    } else if (e.state === 'recover') {
      showFrame(v, FRAMES.slam);
    } else {
      v.walkPhase += Math.hypot(e.vx, e.vz) * dt * FRAMES_PER_METER;
      showFrame(v, FRAMES.walk[Math.floor(v.walkPhase) % FRAMES.walk.length]);
    }
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
