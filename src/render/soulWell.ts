// "Il Pozzo delle Anime" on screen (the simulation: src/sim/soulWell.ts).
// The town well (its stone ring, posts and little roof are boxes of the
// level, always there) becomes a well of ghost light:
//
// - Asleep: a dim swirl of pale green light in its mouth, a few wisps
//   breathing out of it, and a column of light up into the sky (the bells'
//   waypoint) so you find it from anywhere.
// - Awake: the swirl turns faster and brighter as it fills, wisps pour out,
//   its light grows. The column stays (faint), and comes back strong while
//   you carry souls: that's when you need to find your way back.
// - The SOULS on the ground: little ghosts of pale light (pixel art, two
//   frames that flicker), bobbing over the floor where their enemy died,
//   bigger for heavier enemies, leaving a trail of motes. In their last 2 s
//   they blink: run. Caught, they burst into motes with a chime; gone out,
//   a sigh and a puff.
// - In your HANDS: a few motes orbit you low, at the bottom of the screen
//   (one per soul, up to a dozen): you always know you're carrying.
// - Dropped in: the motes fly from you into the mouth on an arc, the well
//   GULPS (a flash of light, a spurt of wisps), a chime that climbs with
//   how full it is.
// - Full: a GEYSER of souls roars up out of it, a flash, the ghost choir.
//   Failed: it goes dark with a long moan, the souls left on the ground go out.
//
// It only READS the simulation (game.mapEvent and the soul events).
// Built ONCE at startup and hidden, the light included (adding a light while
// playing makes Three.js recompile every shader: a hitch).
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import type { SoulWellEvent } from '../sim/soulWell';
import { TICK_RATE } from '../sim/config';
import {
  playSoulCollect,
  playSoulFaded,
  playSoulsDeposited,
  playSoulWellDie,
  playSoulWellFull,
  playSoulWellWake,
} from '../audio/sfx';
import { beamTexture } from './bells';
import { spawnSoulWisp } from './particles';
import { soundAt } from './soundPosition';

// --- The well's mouth ---
/** Radius of the swirl of light in the mouth (the stone ring is 2 × 2 m), and how high over the stone it floats. */
const POOL_RADIUS = 0.85;
const POOL_LIFT = 0.02;
/** The swirl's color (× bloom), how bright asleep / awake / full, how fast it turns (rad/s) asleep / full. */
const POOL_COLOR = new THREE.Color(0.7, 2.2, 1.5);
const POOL_ASLEEP = 0.35;
const POOL_AWAKE = 0.7;
const POOL_FULL = 1.6;
const POOL_SPIN_ASLEEP = 0.4;
const POOL_SPIN_FULL = 3;
/** Wisps breathing out of the mouth, per second: asleep, awake, and the extra when full. */
const WISPS_ASLEEP = 6;
const WISPS_AWAKE = 14;
const WISPS_FULL = 40;
/** Its light: color, range, strength asleep / awake / extra when full, and the flash of a gulp. */
const LIGHT_COLOR = 0x60ffc0;
const LIGHT_RANGE = 11;
const LIGHT_ASLEEP = 3;
const LIGHT_AWAKE = 6;
const LIGHT_FULL = 14;
const LIGHT_GULP = 40;
/** A gulp fades this fast (per second). */
const GULP_DECAY = 3;
/** The light hangs this high over the mouth (under the little roof). */
const LIGHT_HEIGHT = 0.9;

// --- The column of light ---
/** Radius, height, color; opacity asleep (find it!), awake, and while you carry souls (find your way back!). */
const BEAM_RADIUS = 0.6;
const BEAM_HEIGHT = 60;
const BEAM_COLOR = new THREE.Color(0.6, 2.4, 1.6);
const BEAM_OPACITY_ASLEEP = 0.35;
const BEAM_OPACITY_AWAKE = 0.1;
const BEAM_OPACITY_CARRYING = 0.32;
/** The column starts over the well's little roof (meters over the mouth). */
const BEAM_FROM = 1.9;
/** Up close you don't need the waypoint: it fades in between these distances (meters). */
const BEAM_NEAR = 5;
const BEAM_FAR = 18;

// --- The souls on the ground ---
const MAX_SOULS = 48;
/** A soul's sprite: width and height (meters) for a ghoul's soul; heavier enemies' are bigger, up to SOUL_SCALE_MAX. */
const SOUL_WIDTH = 0.45;
const SOUL_HEIGHT = 0.6;
const SOUL_SCALE_PER_VALUE = 0.15;
const SOUL_SCALE_MAX = 1.7;
/** Its color (× bloom: it glows). */
const SOUL_COLOR = new THREE.Color(1.2, 2.8, 2.0);
/** It bobs (meters, Hz) and flickers between its two frames (Hz). */
const SOUL_BOB = 0.1;
const SOUL_BOB_HZ = 0.8;
const SOUL_FRAME_HZ = 5;
/** Its last seconds: it blinks, this many times a second. */
const SOUL_HURRY = 2;
const SOUL_BLINK_HZ = 8;
/** Motes of its trail per second, and the puff when it's caught / goes out. */
const SOUL_TRAIL = 6;
const CATCH_PUFF = 14;
const FADE_PUFF = 8;

// --- The souls in your hands ---
/** How many motes at most, how far from you, how low under your eyes, how fast they go around (rad/s), how big. */
const CARRY_MAX = 12;
const CARRY_RADIUS = 1.0;
const CARRY_LOW = 0.42;
const CARRY_SPIN = 1.6;
const CARRY_SIZE = 0.025;

// --- Dropped in the well ---
/** At most this many motes fly in (a big drop is still readable), each this long (seconds), staggered. */
const DROP_MAX = 8;
const DROP_TIME = 0.5;
const DROP_STAGGER = 0.07;
/** How high the arc goes over the middle of the trip. */
const DROP_ARC = 1.2;

// --- The ends ---
/** Full: how long the geyser lasts, how many wisps a second it throws, how strong its flash. */
const GEYSER_TIME = 1.8;
const GEYSER_WISPS = 260;
const GEYSER_LIGHT = 70;
/** Failed: how long it takes to go dark. */
const DIE_TIME = 1.6;

type Mode = 'none' | 'asleep' | 'awake' | 'geyser' | 'dying';

interface Drop {
  from: THREE.Vector3;
  age: number;
}

export interface SoulWellRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number, time: number): void;
}

export function createSoulWellRenderer(scene: THREE.Scene): SoulWellRenderer {
  const root = new THREE.Group(); // at the middle of the well's mouth
  root.visible = false;
  scene.add(root);

  // --- The swirl in the mouth ---
  const poolTexture = swirlTexture();
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: poolTexture,
    color: POOL_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(POOL_RADIUS * 2, POOL_RADIUS * 2).rotateX(-Math.PI / 2), poolMaterial);
  pool.position.y = POOL_LIFT;
  root.add(pool);

  // In the scene, not in `root`: Three.js skips the lights under an
  // invisible group, so one in the hidden root would "appear" with the well
  // (and every shader would be recompiled). Out here it's always counted.
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
  beam.position.y = BEAM_FROM;
  root.add(beam);

  // --- The souls on the ground: one sprite each, from a pool ---
  const frames = ghostTextures();
  const sprites = Array.from({ length: MAX_SOULS }, () => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: frames[0],
        color: SOUL_COLOR,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.visible = false;
    scene.add(sprite);
    return sprite;
  });

  // --- Motes: the souls in your hands, and the ones flying into the well (one Points, fixed buffer) ---
  const MOTES = CARRY_MAX + DROP_MAX;
  const moteGeometry = new THREE.BufferGeometry();
  const motePositions = new Float32Array(MOTES * 3);
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const motes = new THREE.Points(
    moteGeometry,
    new THREE.PointsMaterial({
      color: SOUL_COLOR,
      size: CARRY_SIZE,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  motes.frustumCulled = false; // its bounding sphere isn't updated as the points move
  motes.visible = false; // until the well shows up: all its points start at (0, 0, 0)
  scene.add(motes);

  let mode: Mode = 'none';
  let current: SoulWellEvent | null = null;
  let modeTime = 0;
  let fill = 0;
  let gulp = 0;
  let spin = 0;
  let wispDebt = 0;
  let trailDebt = 0;
  const drops: Drop[] = [];
  const mouth = new THREE.Vector3(); // the middle of the mouth, in the world
  const up = new THREE.Vector3(0, 1, 0);
  const point = new THREE.Vector3();
  const control = new THREE.Vector3();

  function hide(): void {
    mode = 'none';
    current = null;
    root.visible = false;
    motes.visible = false;
    light.intensity = 0;
    drops.length = 0;
    for (const s of sprites) s.visible = false;
  }

  /** `count` wisps out of random points of the mouth (a circle: √ of a random number for the distance, else they crowd the middle). */
  function breathe(count: number, speed = 1): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * POOL_RADIUS * 0.9;
      point.set(mouth.x + Math.cos(a) * r, mouth.y + 0.05, mouth.z + Math.sin(a) * r);
      up.set(0, speed, 0);
      spawnSoulWisp(point, up, 1);
    }
    up.set(0, 1, 0);
  }

  return {
    update(game, events, camera, alpha, dt, time) {
      const active = game.mapEvent.active;
      const ev = active?.kind === 'soulWell' ? active : null;

      // A new well: show it (asleep, or awake if it woke in this same frame).
      if (ev && ev !== current) {
        current = ev;
        mode = ev.awake ? 'awake' : 'asleep';
        modeTime = 0;
        fill = 0;
        gulp = 0;
        drops.length = 0;
        root.visible = true;
        motes.visible = true;
        root.position.set(ev.x, ev.y, ev.z);
      }
      if (mode === 'none') return;
      mouth.copy(root.position);

      for (const e of events) {
        if (e.type === 'soulWellWake') {
          mode = 'awake';
          gulp = 1;
          breathe(30, 3);
          playSoulWellWake(soundAt(camera, e.x, e.y, e.z));
        } else if (e.type === 'soulCollected') {
          point.set(e.x, e.y, e.z);
          spawnSoulWisp(point, up, CATCH_PUFF);
          playSoulCollect(e.carried);
        } else if (e.type === 'soulFaded') {
          point.set(e.x, e.y, e.z);
          spawnSoulWisp(point, up, FADE_PUFF);
          playSoulFaded(soundAt(camera, e.x, e.y, e.z));
        } else if (e.type === 'soulsDeposited') {
          const n = Math.min(DROP_MAX, e.souls);
          for (let i = 0; i < n; i++) drops.push({ from: camera.position.clone().add(new THREE.Vector3(0, -CARRY_LOW, 0)), age: -i * DROP_STAGGER });
          playSoulsDeposited(soundAt(camera, mouth.x, mouth.y, mouth.z), e.souls, e.total / e.goal);
        } else if (e.type === 'mapEventEnd' && e.kind === 'soulWell') {
          // The souls still on the ground go out with it.
          for (const s of current?.souls ?? []) {
            point.set(s.x, s.y, s.z);
            spawnSoulWisp(point, up, FADE_PUFF);
          }
          current = null;
          mode = e.success ? 'geyser' : 'dying';
          modeTime = 0;
          if (e.success) playSoulWellFull(soundAt(camera, mouth.x, mouth.y, mouth.z));
          else playSoulWellDie(soundAt(camera, mouth.x, mouth.y, mouth.z));
        }
      }
      // Gone without an end (you died: a new game starts): just hide it.
      if (!ev && (mode === 'asleep' || mode === 'awake')) {
        hide();
        return;
      }
      modeTime += dt;
      if (ev) fill = ev.filled / ev.goal;
      gulp = Math.max(0, gulp - gulp * GULP_DECAY * dt);

      // --- The souls on the ground (gone with the event: the ones left went out with it) ---
      const souls = ev ? ev.souls : [];
      sprites.forEach((sprite, i) => {
        const s = souls[i];
        sprite.visible = s !== undefined;
        if (!s) return;
        const scale = Math.min(SOUL_SCALE_MAX, 1 + (s.value - 1) * SOUL_SCALE_PER_VALUE);
        sprite.scale.set(SOUL_WIDTH * scale, SOUL_HEIGHT * scale, 1);
        const phase = s.id * 1.7; // each one bobs and flickers on its own beat
        sprite.position.set(
          s.px + (s.x - s.px) * alpha,
          s.py + (s.y - s.py) * alpha + SOUL_BOB * Math.sin((time * SOUL_BOB_HZ + phase) * Math.PI * 2),
          s.pz + (s.z - s.pz) * alpha,
        );
        sprite.material.map = frames[Math.floor(time * SOUL_FRAME_HZ + phase) % 2];
        const secondsLeft = s.ticksLeft / TICK_RATE;
        const blink = secondsLeft < SOUL_HURRY ? 0.35 + 0.65 * (Math.sin(time * SOUL_BLINK_HZ * Math.PI * 2) > 0 ? 1 : 0) : 1;
        sprite.material.opacity = Math.min(1, secondsLeft * 2) * blink; // the last half second: it fades out
      });
      // Their trails: a few motes a second, from a soul picked at random.
      trailDebt += SOUL_TRAIL * souls.length * dt;
      while (trailDebt >= 1 && souls.length > 0) {
        trailDebt--;
        const s = souls[Math.floor(Math.random() * Math.min(souls.length, MAX_SOULS))];
        point.set(s.x, s.y - 0.1, s.z);
        spawnSoulWisp(point, up, 1);
      }
      if (souls.length === 0) trailDebt = 0;

      // --- Motes: in your hands (orbiting low around you), then the ones flying into the well ---
      let count = 0;
      const carried = ev ? Math.min(CARRY_MAX, ev.carried) : 0;
      for (let i = 0; i < carried; i++) {
        const a = time * CARRY_SPIN + (i / carried) * Math.PI * 2;
        const wobble = 0.08 * Math.sin(time * 3 + i * 1.3);
        motePositions.set(
          [
            camera.position.x + Math.cos(a) * CARRY_RADIUS,
            camera.position.y - CARRY_LOW + wobble,
            camera.position.z + Math.sin(a) * CARRY_RADIUS,
          ],
          count++ * 3,
        );
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.age += dt;
        if (d.age >= DROP_TIME) {
          // In: the well gulps.
          gulp = Math.min(2, gulp + 0.5);
          breathe(6, 2.5);
          drops.splice(i, 1);
        }
      }
      for (const d of drops) {
        if (d.age < 0) continue; // not left yet
        dropPoint(d, mouth, point, control);
        motePositions.set([point.x, point.y, point.z], count++ * 3);
        if (Math.random() < dt * 30) spawnSoulWisp(point, up, 1);
      }
      moteGeometry.setDrawRange(0, count);
      moteGeometry.attributes.position.needsUpdate = true;

      // --- The well ---
      const awake = mode === 'awake';
      spin += (awake ? POOL_SPIN_ASLEEP + (POOL_SPIN_FULL - POOL_SPIN_ASLEEP) * fill : POOL_SPIN_ASLEEP) * dt;
      pool.rotation.y = spin;
      const breath = 0.85 + 0.15 * Math.sin(time * 2.2); // it breathes
      let glow = mode === 'asleep' ? POOL_ASLEEP : POOL_AWAKE + (POOL_FULL - POOL_AWAKE) * fill;
      let lightLevel = mode === 'asleep' ? LIGHT_ASLEEP : LIGHT_AWAKE + LIGHT_FULL * fill;
      let wispRate = mode === 'asleep' ? WISPS_ASLEEP : WISPS_AWAKE + WISPS_FULL * fill;

      if (mode === 'geyser') {
        // The souls roar up out of it: a fountain of wisps, fast, and a flash.
        const t = Math.min(1, modeTime / GEYSER_TIME);
        const strength = (1 - t) ** 1.5;
        breathe(Math.round(GEYSER_WISPS * strength * dt) + 1, 6 + 6 * strength);
        glow = POOL_FULL * 2 * strength;
        lightLevel = GEYSER_LIGHT * strength;
        wispRate = 0;
        if (t >= 1) {
          hide();
          return;
        }
      } else if (mode === 'dying') {
        // Dark, in a long moan.
        const t = Math.min(1, modeTime / DIE_TIME);
        const k = (1 - t) ** 2;
        glow *= k;
        lightLevel *= k;
        wispRate *= k;
        if (t >= 1) {
          hide();
          return;
        }
      }
      poolMaterial.opacity = Math.min(1, glow * breath + gulp * 0.6);
      light.intensity = lightLevel * breath + LIGHT_GULP * gulp;
      light.position.set(mouth.x, mouth.y + LIGHT_HEIGHT, mouth.z);
      wispDebt += wispRate * dt;
      const whole = Math.floor(wispDebt);
      wispDebt -= whole;
      if (whole > 0) breathe(whole);

      // --- The column of light ---
      beam.visible = mode === 'asleep' || mode === 'awake';
      const carrying = ev !== null && ev.carried > 0;
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(mouth), BEAM_NEAR, BEAM_FAR);
      const beamOpacity = mode === 'asleep' ? BEAM_OPACITY_ASLEEP : carrying ? BEAM_OPACITY_CARRYING : BEAM_OPACITY_AWAKE;
      beamMaterial.opacity = beamOpacity * breath * near;
    },
  };
}

/**
 * Where a mote flying into the well is now: a QUADRATIC BÉZIER from where
 * you were to the mouth, through a point over the middle of the trip (an
 * arc), time eased in (u²): slow out of your hands, then it dives in.
 */
function dropPoint(d: Drop, mouth: THREE.Vector3, out: THREE.Vector3, control: THREE.Vector3): void {
  control.copy(d.from).add(mouth).multiplyScalar(0.5);
  control.y = Math.max(d.from.y, mouth.y) + DROP_ARC;
  const u = Math.min(1, d.age / DROP_TIME) ** 2;
  const a = (1 - u) * (1 - u);
  const b = 2 * u * (1 - u);
  const c = u * u;
  out.set(
    a * d.from.x + b * control.x + c * mouth.x,
    a * d.from.y + b * control.y + c * mouth.y,
    a * d.from.z + b * control.z + c * mouth.z,
  );
}

/**
 * The swirl in the well's mouth, 32 × 32 px: a disc of ghost light with
 * three SPIRAL ARMS (brightness from sin(3 × angle + 9 × distance): the
 * angle makes three arms, adding the distance bends them into a spiral),
 * brighter toward the rim, in 4 hard steps (pixel art: no smooth gradients).
 * White: the material's color tints it.
 */
function swirlTexture(): THREE.Texture {
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - N / 2;
      const dy = y + 0.5 - N / 2;
      const r = Math.hypot(dx, dy) / (N / 2);
      if (r >= 1) continue;
      const arm = 0.5 + 0.5 * Math.sin(3 * Math.atan2(dy, dx) + 9 * r);
      const rim = r > 0.86 ? 1 : 0.35 + 0.65 * r;
      const a = Math.ceil(arm * rim * 4) / 4;
      g.fillStyle = `rgba(255, 255, 255, ${(a * 0.9).toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return pixelTexture(canvas);
}

/**
 * A soul: a little GHOST, 12 × 16 px, two frames. A round head on top, two
 * dark eye holes and a mouth (left transparent: with additive blending a
 * hole is darker than the glow around it), a body that narrows into a
 * wavy tail of flame; the tail sways between the two frames. White on
 * transparent, brighter at the core (the sprite's color tints it).
 */
function ghostTextures(): THREE.Texture[] {
  const W = 12;
  const H = 16;
  return [0, 1].map((frame) => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    for (let y = 0; y < H; y++) {
      // Half width of the body at this row: a circle for the head (rows 0-7),
      // then narrowing to a point at the bottom.
      const half = y < 7 ? Math.sqrt(Math.max(0, 1 - ((y - 5) / 5.2) ** 2)) * 5.2 : 5.2 * (1 - (y - 6) / (H - 5));
      // The tail sways: the lower the row, the more it shifts (frame 0 one way, frame 1 the other).
      const sway = y > 8 ? ((y - 8) / 7) ** 1.5 * (frame === 0 ? 1.6 : -1.6) : 0;
      const middle = W / 2 + sway;
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x + 0.5 - middle);
        if (d > half) continue;
        // Eyes and mouth: holes.
        if ((y === 4 || y === 5) && (x === 3 || x === 8)) continue;
        if (y === 8 && x >= 5 && x <= 6) continue;
        const core = 1 - d / Math.max(0.5, half); // 1 in the middle, 0 at the edge
        const a = Math.ceil((0.35 + 0.65 * core) * (y > 11 ? 0.7 : 1) * 3) / 3;
        g.fillStyle = `rgba(255, 255, 255, ${a.toFixed(2)})`;
        g.fillRect(x, y, 1, 1);
      }
    }
    return pixelTexture(canvas);
  });
}

/** A canvas as a pixel-art texture: no filtering (sharp pixels). */
function pixelTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}
