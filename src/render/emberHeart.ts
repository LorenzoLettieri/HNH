// "Il Cuore di Brace" on screen (the simulation: src/sim/emberHeart.ts).
// A crystal of hellfire floating 1.5 m over the street: dark crimson stone
// with glowing veins, a few shards orbiting it, a halo, its own light. It
// BEATS, like a heart: a lub-dub of size and glow, slow while it sleeps,
// faster and faster as it fills up.
//
// - Asleep: dim, a small ring at its feet and a column of light up into the
//   sky (the bells' waypoint), so you find it.
// - Awake: its CIRCLE unfolds (with an overshoot, ease-out-back): a dashed
//   ring of fire on the ground that turns, and a low curtain of fire along
//   the edge, a wall you see from inside and outside (the ground ring alone
//   hides behind every crate and porch). The circle is exactly
//   tuning.emberHeartRadius: what you see is what counts.
// - A kill in the circle: the enemy's SOUL flies from the corpse into the
//   crystal along an arc (a bright point with a trail of fire, faster at the
//   end: it's being sucked in), the crystal GULPS (swells), a chime that
//   climbs as it fills.
// - Full: it bursts (fire, sparks, the shards flung away, a flash, the ring
//   blown outward as a shockwave). It waits for the last souls to arrive.
// - The wave ended first: it goes dark, sinks into the ground in smoke.
//
// It only READS the simulation (game.mapEvent and the emberHeart events).
// Everything is built ONCE at startup and hidden, the light included (adding
// a light while playing makes Three.js recompile every shader: a hitch).
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import { HEART_HOVER, type EmberHeartEvent } from '../sim/emberHeart';
import { tuning } from '../sim/config';
import { playEmberHeartBeat, playEmberHeartBurst, playEmberHeartDie, playEmberHeartFeed, playEmberHeartWake } from '../audio/sfx';
import { beamTexture } from './bells';
import { blastShake } from './cameraFeel';
import { addHeightFog } from './heightFog';
import { spawnBlastFire, spawnSmoke, spawnSnort, spawnSparks } from './particles';
import { soundAt } from './soundPosition';

// --- Shape (meters) ---
/** The crystal: a stretched octahedron (two pyramids base to base), this wide and tall. */
const CRYSTAL_WIDTH = 0.8;
const CRYSTAL_HEIGHT = 1.7;
/** Shards orbiting it: how many, how big, how far, how fast (rad/s), how much they bob. */
const SHARDS = 4;
const SHARD_SIZE = 0.18;
const SHARD_ORBIT = 1.0;
const SHARD_SPIN = 1.8;
const SHARD_BOB = 0.15;
/** The whole crystal bobs up and down (meters, Hz) and turns (rad/s). */
const BOB = 0.08;
const BOB_HZ = 0.45;
const TURN_ASLEEP = 0.4;
const TURN_AWAKE = 1.3;

// --- The heartbeat ---
/** Seconds between two beats: asleep, just awake, and full (it speeds up as it fills). */
const BEAT_ASLEEP = 1.8;
const BEAT_AWAKE = 1.1;
const BEAT_FULL = 0.42;
/** How much a beat swells it (share of its size). */
const BEAT_SWELL = 0.14;
/** A soul swallowed: how much it swells, and how fast that goes away (per second). */
const GULP_SWELL = 0.3;
const GULP_DECAY = 6;

// --- Look ---
/** The veins' glow (×, above 1 blooms): asleep, awake, and the extra on a beat. */
const VEIN_COLOR = 0xff6a20;
const GLOW_ASLEEP = 0.6;
const GLOW_AWAKE = 1.4;
const GLOW_BEAT = 1.6;
/** Its light: color, range, strength asleep / awake / extra on a beat, and the flash when it bursts. */
const LIGHT_COLOR = 0xff5a1e;
const LIGHT_RANGE = 14;
const LIGHT_ASLEEP = 5;
const LIGHT_AWAKE = 12;
const LIGHT_BEAT = 10;
const LIGHT_BURST = 160;
/** The halo around it (a sprite that always faces you): size, opacity. */
const HALO_SIZE = 2.2;
const HALO_OPACITY = 0.22;
const HALO_COLOR = new THREE.Color(2.2, 0.8, 0.25);
/** The column of light: radius, height, color, opacity asleep (find it!) and awake (faint: you know where it is). */
const BEAM_RADIUS = 0.5;
const BEAM_HEIGHT = 60;
const BEAM_COLOR = new THREE.Color(2.6, 0.8, 0.25);
const BEAM_OPACITY_ASLEEP = 0.35;
const BEAM_OPACITY_AWAKE = 0.1;
/** Up close you don't need the waypoint (and a pillar of light in your face hides everything): it fades in between these distances (meters). */
const BEAM_NEAR = 6;
const BEAM_FAR = 20;

// --- The circle ---
/** The ring on the ground: color (× bloom), width (meters), dashes around, turns per second (faster as it fills). */
const RING_COLOR = new THREE.Color(2.2, 0.7, 0.18);
const RING_WIDTH = 0.4;
const RING_DASHES = 44;
const RING_SPIN = 0.08;
const RING_SPIN_FULL = 0.35;
/** A soft glow just inside the ring: how wide (meters) and how strong. */
const RING_FILL = 3;
const RING_FILL_OPACITY = 0.22;
/** Asleep: a small ring at its feet, this radius, pulsing with the beat. */
const ASLEEP_RING = 1.6;
/** The curtain of fire along the edge: height, color, opacity, how fast it turns. */
const CURTAIN_HEIGHT = 5;
const CURTAIN_COLOR = new THREE.Color(2.0, 0.55, 0.14);
const CURTAIN_OPACITY = 0.32;
const CURTAIN_SPIN = 0.03;
/** Seconds the circle takes to unfold when it wakes up. */
const UNFOLD_TIME = 0.8;
/** The ring floats this much over the floor (the patches of road are at 1 cm, the pools at 2). */
const LIFT = 0.025;

// --- Souls ---
const MAX_SOULS = 32;
/** Seconds a soul flies: a base, plus this much per meter of the trip. */
const SOUL_TIME = 0.45;
const SOUL_TIME_PER_METER = 0.012;
/** How high the arc goes over the middle of the trip: a base plus a share of the distance. */
const SOUL_ARC = 2;
const SOUL_ARC_PER_METER = 0.12;
/** The bright point of a soul: size (meters) and color (× bloom). */
const SOUL_SIZE = 0.4;
const SOUL_COLOR = new THREE.Color(3.2, 1.4, 0.45);

// --- The ends ---
/** Full: how long the burst lasts, how far the shockwave ring goes (× the radius), how much it throws around. */
const BURST_TIME = 1.1;
const BURST_RING = 1.6;
const BURST_FIRE = 70;
const BURST_SPARKS = 50;
const BURST_SMOKE = 14;
/** Shards flung away by the burst: speed (m/s) and gravity. */
const SHARD_FLING = 9;
const SHARD_GRAVITY = 14;
/** Full but souls still in the air: wait for them, at most this long (seconds). */
const BURST_WAIT = 1.5;
/** The wave ended first: it goes dark and sinks this deep in this many seconds. */
const DIE_TIME = 1.6;
const DIE_SINK = 1.4;

interface Soul {
  from: THREE.Vector3;
  age: number;
  duration: number;
  souls: number;
  /** How full the heart is once this soul arrives (0..1): the pitch of the chime. */
  fill: number;
}

type Mode = 'none' | 'asleep' | 'awake' | 'burst' | 'dying';

export interface EmberHeartRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number, time: number): void;
}

export function createEmberHeartRenderer(scene: THREE.Scene): EmberHeartRenderer {
  const root = new THREE.Group(); // at the floor under the crystal
  root.visible = false;
  scene.add(root);

  // --- The crystal, its shards, its halo, its light ---
  const body = new THREE.Group(); // at the crystal's middle: bobs, turns, beats
  body.position.y = HEART_HOVER;
  root.add(body);
  const textures = crystalTextures();
  const material = new THREE.MeshStandardMaterial({
    map: textures.color,
    emissive: VEIN_COLOR,
    emissiveMap: textures.glow,
    emissiveIntensity: GLOW_ASLEEP,
    flatShading: true, // every face one flat shade: a cut stone, not a blob
    roughness: 0.35,
    metalness: 0.1,
  });
  addHeightFog(material);
  const crystalGeometry = new THREE.OctahedronGeometry(1, 0);
  crystalGeometry.scale(CRYSTAL_WIDTH / 2, CRYSTAL_HEIGHT / 2, CRYSTAL_WIDTH / 2);
  const crystal = new THREE.Mesh(crystalGeometry, material);
  body.add(crystal);
  const shardGeometry = new THREE.TetrahedronGeometry(SHARD_SIZE, 0);
  const shards = Array.from({ length: SHARDS }, () => {
    const mesh = new THREE.Mesh(shardGeometry, material);
    root.add(mesh); // in the root, not the body: when it bursts they fly on their own
    return { mesh, velocity: new THREE.Vector3() };
  });
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture(),
      color: HALO_COLOR,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  body.add(halo);
  // In the scene itself, NOT in `root`: Three.js skips everything under an
  // invisible group, lights included, so a light in the hidden root would
  // "appear" when the heart does (and every shader would be recompiled).
  // Out here it's always counted; we only move it and change its intensity.
  const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE);
  scene.add(light);

  // --- The column of light ---
  const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 10, 1, true);
  beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: BEAM_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.position.y = HEART_HOVER + CRYSTAL_HEIGHT / 2 + 0.4; // from just over its tip: it mustn't hide the crystal
  root.add(beam);

  // --- The circle: the ring on the ground and the curtain of fire ---
  const ringMaterial = createRingMaterial();
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringMaterial);
  ring.position.y = LIFT;
  root.add(ring);
  const curtainTexture = curtainFireTexture();
  const curtainMaterial = new THREE.MeshBasicMaterial({
    map: curtainTexture,
    color: CURTAIN_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide, // seen from inside and from outside
  });
  const curtainGeometry = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0);
  const curtain = new THREE.Mesh(curtainGeometry, curtainMaterial);
  root.add(curtain);

  // --- Souls: one point each, in a fixed buffer (only the first `souls.length` are drawn) ---
  const soulGeometry = new THREE.BufferGeometry();
  const soulPositions = new Float32Array(MAX_SOULS * 3);
  soulGeometry.setAttribute('position', new THREE.BufferAttribute(soulPositions, 3));
  const soulPoints = new THREE.Points(
    soulGeometry,
    new THREE.PointsMaterial({
      color: SOUL_COLOR,
      size: SOUL_SIZE,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  soulPoints.frustumCulled = false; // its bounding sphere isn't updated as the points move
  scene.add(soulPoints);

  let mode: Mode = 'none';
  let current: EmberHeartEvent | null = null;
  const souls: Soul[] = [];
  /** Time in the current mode, or since the circle started unfolding (awake). */
  let modeTime = 0;
  let unfoldTime = 0;
  let beatPhase = 0;
  let gulp = 0;
  let fill = 0;
  /** Full: burst as soon as the last soul arrives (or after BURST_WAIT). */
  let burstPending = false;
  let burstWait = 0;
  const center = new THREE.Vector3(); // the crystal's middle, in the world
  const up = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3();
  const control = new THREE.Vector3();

  function show(on: boolean): void {
    root.visible = on;
    soulPoints.visible = on;
    light.intensity = 0;
  }

  /** Puts the shards back in orbit (after a burst they're scattered). */
  function resetShards(): void {
    for (const s of shards) {
      s.mesh.visible = true;
      s.mesh.scale.setScalar(1);
    }
  }

  function startBurst(camera: THREE.Camera): void {
    mode = 'burst';
    modeTime = 0;
    burstPending = false;
    crystal.visible = false;
    spawnBlastFire(center, up, BURST_FIRE);
    spawnSparks(center, up, BURST_SPARKS);
    spawnSmoke(center, up, BURST_SMOKE);
    // The shards fly away from the middle, outward and up.
    for (const s of shards) {
      s.velocity.copy(s.mesh.position).sub(body.position);
      s.velocity.y = 0;
      s.velocity.normalize().multiplyScalar(SHARD_FLING);
      s.velocity.y = SHARD_FLING * 0.6;
    }
    playEmberHeartBurst(soundAt(camera, center.x, center.y, center.z));
    const distance = camera.position.distanceTo(center);
    if (distance < tuning.emberHeartRadius) blastShake(0.6 * (1 - distance / tuning.emberHeartRadius));
  }

  return {
    update(game, events, camera, alpha, dt, time) {
      const active = game.mapEvent.active;
      const ev = active?.kind === 'emberHeart' ? active : null;

      // A new heart: show it (asleep, or awake already if it woke in this same frame).
      if (ev && ev !== current) {
        current = ev;
        mode = ev.awake ? 'awake' : 'asleep';
        modeTime = 0;
        unfoldTime = ev.awake ? UNFOLD_TIME : 0;
        souls.length = 0;
        burstPending = false;
        fill = 0;
        crystal.visible = true;
        resetShards();
        show(true);
      }
      if (mode === 'none') return;

      // Where it is: between the last two ticks (it moves every tick). Once
      // the event is over it stays where it was last seen.
      if (ev) {
        root.position.set(ev.px + (ev.x - ev.px) * alpha, ev.py + (ev.y - ev.py) * alpha, ev.pz + (ev.z - ev.pz) * alpha);
        fill = ev.souls / ev.goal;
      }
      center.copy(root.position).add(body.position);

      for (const e of events) {
        if (e.type === 'emberHeartWake') {
          mode = 'awake';
          unfoldTime = 0;
          gulp = GULP_SWELL * 2;
          spawnBlastFire(center, up, 24);
          spawnSnort(center, up, 20);
          playEmberHeartWake(soundAt(camera, e.x, e.y, e.z));
        } else if (e.type === 'emberHeartFed' && souls.length < MAX_SOULS) {
          const from = new THREE.Vector3(e.fromX, e.fromY + 1, e.fromZ);
          const duration = SOUL_TIME + from.distanceTo(center) * SOUL_TIME_PER_METER;
          souls.push({ from, age: 0, duration, souls: e.souls, fill: e.total / e.goal });
        } else if (e.type === 'mapEventEnd' && e.kind === 'emberHeart') {
          current = null;
          if (e.success) {
            burstPending = true;
            burstWait = 0;
          } else {
            mode = 'dying';
            modeTime = 0;
            playEmberHeartDie(soundAt(camera, center.x, center.y, center.z));
          }
        }
      }
      // Gone without an end (you died: a new game starts): just hide it.
      if (!ev && (mode === 'asleep' || mode === 'awake') && !burstPending) {
        mode = 'none';
        current = null;
        souls.length = 0;
        show(false);
        return;
      }
      modeTime += dt;

      // --- The heartbeat: a lub-dub of size and glow ---
      const awake = mode === 'awake';
      const period = awake ? BEAT_AWAKE + (BEAT_FULL - BEAT_AWAKE) * fill : BEAT_ASLEEP;
      beatPhase += dt / period;
      if (beatPhase >= 1) {
        beatPhase -= Math.floor(beatPhase);
        if (awake) playEmberHeartBeat(soundAt(camera, center.x, center.y, center.z), fill);
      }
      // Two bumps (gaussians): the "lub" at the start of the beat, a softer "dub" right after.
      const pulse = Math.exp(-(((beatPhase - 0.04) / 0.05) ** 2)) + 0.6 * Math.exp(-(((beatPhase - 0.2) / 0.05) ** 2));
      gulp = Math.max(0, gulp - gulp * GULP_DECAY * dt);

      // --- Souls in flight ---
      for (let i = souls.length - 1; i >= 0; i--) {
        const s = souls[i];
        s.age += dt;
        if (s.age >= s.duration) {
          // Swallowed.
          gulp += GULP_SWELL * Math.min(2, 0.6 + s.souls * 0.25);
          spawnBlastFire(center, up, 4 + s.souls * 2);
          playEmberHeartFeed(soundAt(camera, center.x, center.y, center.z), s.fill);
          souls.splice(i, 1);
          continue;
        }
        soulPoint(s, center, point, control);
        spawnSnort(point, up, s.souls >= 3 ? 2 : 1); // its trail of fire
      }
      souls.forEach((s, i) => {
        soulPoint(s, center, point, control);
        soulPositions.set([point.x, point.y, point.z], i * 3);
      });
      soulGeometry.setDrawRange(0, souls.length);
      soulGeometry.attributes.position.needsUpdate = true;

      if (burstPending) {
        burstWait += dt;
        if (souls.length === 0 || burstWait > BURST_WAIT) startBurst(camera);
      }

      // --- The crystal ---
      const radius = tuning.emberHeartRadius;
      body.rotation.y += (awake ? TURN_AWAKE * (1 + fill) : TURN_ASLEEP) * dt;
      body.position.y = HEART_HOVER + BOB * Math.sin(time * Math.PI * 2 * BOB_HZ);
      body.scale.setScalar(1 + BEAT_SWELL * pulse + gulp);
      const glow = mode === 'asleep' ? GLOW_ASLEEP : GLOW_AWAKE * (1 + fill * 0.6);
      material.emissiveIntensity = glow + GLOW_BEAT * pulse * (awake ? 1 : 0.4) + gulp * 3;
      halo.material.opacity = HALO_OPACITY * (0.6 + 0.4 * pulse + gulp);
      halo.scale.setScalar(HALO_SIZE * (1 + 0.3 * pulse));
      light.intensity = (mode === 'asleep' ? LIGHT_ASLEEP : LIGHT_AWAKE) + LIGHT_BEAT * pulse + gulp * 20;
      if (mode === 'asleep' || mode === 'awake') {
        shards.forEach((s, i) => {
          const a = time * SHARD_SPIN * (awake ? 1.6 : 1) + (i / SHARDS) * Math.PI * 2;
          const orbit = SHARD_ORBIT * (1 + 0.3 * pulse);
          s.mesh.position.set(Math.cos(a) * orbit, body.position.y + Math.sin(time * 1.3 + i * 2) * SHARD_BOB, Math.sin(a) * orbit);
          s.mesh.rotation.set(time * 2 + i, time * 3 + i, 0);
        });
      }

      // --- The column of light ---
      beam.visible = mode === 'asleep' || mode === 'awake';
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(center), BEAM_NEAR, BEAM_FAR);
      beamMaterial.opacity = (mode === 'asleep' ? BEAM_OPACITY_ASLEEP : BEAM_OPACITY_AWAKE) * (0.75 + 0.25 * pulse) * near;

      // --- The circle ---
      const u = ringMaterial.uniforms;
      u.uTime.value = time * (RING_SPIN + (RING_SPIN_FULL - RING_SPIN) * fill);
      let circle = 0; // radius of the ring, meters
      let fade = 1;
      if (mode === 'asleep') {
        circle = ASLEEP_RING * (1 + 0.15 * pulse);
        fade = 0.5 + 0.5 * pulse;
      } else if (mode === 'awake') {
        unfoldTime = Math.min(UNFOLD_TIME, unfoldTime + dt);
        circle = radius * easeOutBack(unfoldTime / UNFOLD_TIME);
        fade = 0.8 + 0.2 * pulse;
      }

      // --- The ends ---
      if (mode === 'burst') {
        const t = Math.min(1, modeTime / BURST_TIME);
        // A flash, then dark; the ring blown outward as a shockwave, fading.
        light.intensity = LIGHT_BURST * (1 - t) ** 2;
        halo.material.opacity = HALO_OPACITY * 3 * (1 - t) ** 2;
        halo.scale.setScalar(HALO_SIZE * (1 + 4 * t));
        circle = radius * (1 + (BURST_RING - 1) * Math.sqrt(t));
        fade = (1 - t) ** 2;
        for (const s of shards) {
          s.velocity.y -= SHARD_GRAVITY * dt;
          s.mesh.position.addScaledVector(s.velocity, dt);
          s.mesh.rotation.x += 12 * dt;
          s.mesh.scale.setScalar(1 - t);
        }
        if (t >= 1) {
          mode = 'none';
          show(false);
        }
      } else if (mode === 'dying') {
        const t = Math.min(1, modeTime / DIE_TIME);
        // Dark, cracking, sinking, smoking.
        material.emissiveIntensity = GLOW_AWAKE * (1 - t) ** 2;
        light.intensity = LIGHT_AWAKE * (1 - t) ** 2;
        halo.material.opacity = HALO_OPACITY * (1 - t);
        body.position.y = HEART_HOVER - DIE_SINK * t * t;
        body.scale.set(1 - 0.3 * t, 1 - 0.5 * t, 1 - 0.3 * t);
        circle = radius * (1 - 0.15 * t);
        fade = (1 - t) ** 2;
        if (Math.random() < dt * 20) spawnSmoke(center, up, 1);
        for (const s of shards) s.mesh.position.y -= 3 * dt * t; // they fall too
        if (t >= 1) {
          mode = 'none';
          show(false);
        }
      }
      u.uRadius.value = circle;
      u.uFade.value = fade;
      const size = circle + RING_WIDTH + 0.5; // half the side of the quad: just enough for the ring
      ring.scale.set(size, 1, size);
      u.uSize.value = size;
      ring.visible = circle > 0.05;
      // The curtain stands only on the awake circle (and goes with it at the end).
      curtain.visible = (mode === 'awake' || mode === 'burst' || mode === 'dying') && circle > 0.5;
      curtain.scale.set(circle, CURTAIN_HEIGHT * (mode === 'awake' ? Math.min(1, unfoldTime / UNFOLD_TIME) : fade), circle);
      curtainMaterial.opacity = CURTAIN_OPACITY * fade;
      curtainTexture.offset.x = time * CURTAIN_SPIN;
      light.position.copy(root.position).add(body.position);
    },
  };
}

/**
 * Where a soul is now: on a QUADRATIC BÉZIER curve from the corpse to the
 * crystal, through a control point above the middle of the trip (an arc).
 * The crystal moves: the curve ends where it is NOW, so the soul homes in.
 * Time eases in (s²): slow out of the body, then sucked in faster.
 */
function soulPoint(s: Soul, center: THREE.Vector3, out: THREE.Vector3, control: THREE.Vector3): void {
  const distance = s.from.distanceTo(center);
  control.copy(s.from).add(center).multiplyScalar(0.5);
  control.y += SOUL_ARC + distance * SOUL_ARC_PER_METER;
  const u = Math.min(1, s.age / s.duration) ** 2;
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  out.set(
    a * s.from.x + b * control.x + c * center.x,
    a * s.from.y + b * control.y + c * center.y,
    a * s.from.z + b * control.z + c * center.z,
  );
}

/** Ease-out-back: gets to 1 fast, goes a little past it and settles back (an overshoot, the "boing"). */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/**
 * The ring on the ground, as a small SHADER on a square (the same trick as
 * the Damned Smith's shockwave, render/enemies/smiths.ts): every pixel works
 * out its distance from the middle and its ANGLE around it.
 * - near the radius: the ring, in dashes (the angle × how many dashes, the
 *   fractional part; + time, so they run around);
 * - just inside it: a soft glow that fades toward the middle, in 4 hard
 *   steps (pixel art: no smooth gradients);
 * - everywhere else: nothing (discard).
 */
function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRadius: { value: 0 },
      uWidth: { value: RING_WIDTH },
      uSize: { value: 1 }, // half the side of the square, meters
      uColor: { value: RING_COLOR },
      uFade: { value: 1 },
      uTime: { value: 0 },
      uDashes: { value: RING_DASHES },
      uFill: { value: RING_FILL },
      uFillOpacity: { value: RING_FILL_OPACITY },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uRadius, uWidth, uSize, uFade, uTime, uDashes, uFill, uFillOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * uSize;           // meters from the center
        float r = length(p);
        float turn = atan(p.y, p.x) / 6.2831853 + 0.5; // 0..1 around the circle
        vec3 c;
        if (abs(r - uRadius) < uWidth * 0.5) {
          float dash = step(0.35, fract(turn * uDashes + uTime));
          c = uColor * (0.35 + 0.65 * dash);
        } else if (r < uRadius && r > uRadius - uFill) {
          float k = floor((1.0 - (uRadius - r) / uFill) * 4.0) / 4.0; // 4 hard steps
          c = uColor * uFillOpacity * k * k;
        } else {
          discard;
        }
        gl_FragColor = vec4(c * uFade, 1.0);
      }`,
    blending: THREE.AdditiveBlending, // light adds up: fire on the ground
    depthWrite: false,
    transparent: true,
  });
}

/** A tiny seeded generator (an LCG): the same crystal every time. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The crystal's skin, 16 × 32 px: dark crimson stone (a few shades, picked
 * at random) with bright VEINS of fire running down it (random walks: a
 * step down, a step left or right, or none). Two canvases: the colors, and
 * the GLOW MASK (white where it shines: the veins), used as emissiveMap, so
 * only the veins light up when the heart beats.
 */
function crystalTextures(): { color: THREE.Texture; glow: THREE.Texture } {
  const W = 16;
  const H = 32;
  const rand = lcg(7);
  const color = document.createElement('canvas');
  const glow = document.createElement('canvas');
  color.width = glow.width = W;
  color.height = glow.height = H;
  const c = color.getContext('2d')!;
  const g = glow.getContext('2d')!;
  const stone = [0x1c0406, 0x2a0608, 0x3c0a0c, 0x521010];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Diagonal bands of lighter stone: facets catching the light.
      const band = ((x + y) >> 2) % 3 === 0 ? 1 : 0;
      c.fillStyle = hex(stone[Math.min(3, Math.floor(rand() * 3) + band)]);
      c.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  for (let v = 0; v < 6; v++) {
    let x = Math.floor(rand() * W);
    const y0 = Math.floor(rand() * H);
    const length = 8 + Math.floor(rand() * 14);
    for (let i = 0; i < length; i++) {
      const y = (y0 + i) % H;
      x = (x + W + Math.floor(rand() * 3) - 1) % W; // wraps around: the texture goes all around the crystal
      c.fillStyle = '#c04018';
      c.fillRect((x + 1) % W, y, 1, 1); // a dimmer edge beside the core
      g.fillStyle = '#606060';
      g.fillRect((x + 1) % W, y, 1, 1);
      c.fillStyle = '#ffa040';
      c.fillRect(x, y, 1, 1);
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, 1, 1);
    }
  }
  return { color: pixelTexture(color, true), glow: pixelTexture(glow, false) };
}

/**
 * The halo: a round glow, 32 × 32, in 5 hard rings (pixel art), alpha
 * falling off from the middle.
 */
function haloTexture(): THREE.Texture {
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      if (r >= 1) continue;
      const a = Math.ceil((1 - r) ** 2 * 5) / 5;
      g.fillStyle = `rgba(255, 255, 255, ${a.toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return pixelTexture(canvas, false);
}

/**
 * The curtain of fire, 32 × 16 px, repeated 12 times around the circle:
 * bright at the foot and gone at the top, in tongues of different heights
 * (each column its own), like the flames along a fire line.
 */
function curtainFireTexture(): THREE.Texture {
  const W = 32;
  const H = 16;
  const rand = lcg(11);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  for (let x = 0; x < W; x++) {
    const tongue = 0.35 + 0.65 * rand(); // how high this column's flame reaches (share of the height)
    for (let y = 0; y < H; y++) {
      const up = 1 - y / (H - 1); // canvas y goes down; row H-1 is the foot
      if (up > tongue) continue;
      const a = (1 - up / tongue) ** 1.5;
      g.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = pixelTexture(canvas, false);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.x = 12; // 12 × 32 columns around: on a 16 m circle (100 m around) a tongue is about 25 cm wide
  return t;
}

/** A canvas as a pixel-art texture: no filtering (sharp pixels), colors in sRGB if it's a color map. */
function pixelTexture(canvas: HTMLCanvasElement, isColor: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  if (isColor) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
