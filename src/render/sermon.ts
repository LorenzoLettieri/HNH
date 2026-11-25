// "Spettacolo Cruento" on screen (the simulation: src/sim/sermon.ts).
// A hellfire preacher on a soapbox in front of the church, between two tall
// candles:
//
// - Asleep: he reads his book, head down. A red column of light up into the
//   sky (the bells' waypoint) so you find him from anywhere, a small ring at
//   his feet.
// - Awake: he slams the book shut and starts preaching (one arm up, then
//   both, faster and faster as your rank climbs). His CIRCLE opens on the
//   ground (a dashed blood-red ring, a shader like the Ember Heart's) with a
//   low wall of red light along its edge (the ring alone hides behind every
//   crate). Outside it the wall pulses brighter: come back, he can't see you.
// - Every rank you climb INSIDE the circle: "A-MEN!", arms up, a spray of
//   blood from his raised hands, a flash of his light. The show is cruento.
// - A HIGH NOON he didn't see (outside): he turns back to his book, a sour
//   organ chord.
// - GLORY (HIGH NOON in the circle): "HALLELUJAH", he rises off his box
//   showering blood, then goes up in hellfire, in ecstasy. The circle is
//   blown outward.
// - Failed (the wave ended first): he closes the book in disgust and sinks
//   into the ground in smoke, the candles gutter out.
//
// It only READS the simulation (game.mapEvent, game.style and the events).
// Built ONCE at startup and hidden; the light is in the scene with intensity
// 0 (adding a light while playing makes Three.js recompile every shader).
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import { tuning } from '../sim/config';
import { inSermonCircle, type SermonEvent } from '../sim/sermon';
import { isHighNoon, styleRank } from '../sim/style';
import { playSermonAmen, playSermonFail, playSermonGlory, playSermonMissed, playSermonWake } from '../audio/sfx';
import { beamTexture } from './bells';
import { addHeightFog } from './heightFog';
import { spawnBlastFire, spawnBlood, spawnSmoke, spawnSparks } from './particles';
import { barrelTexture, ironTexture } from './props/textures';
import { createFlame, texturedBox } from './props/common';
import { PREACHER_FRAME, PREACHER_FRAMES, PREACHER_H, PREACHER_W, preacherSheet } from './preacherSprite';
import { soundAt } from './soundPosition';

// --- The preacher and his stage ---
const PIXELS_PER_METER = 32;
/** The soapbox he stands on (meters): it's behind his feet point, so he stands ON it. */
const BOX_X = 0.9;
const BOX_Y = 0.45;
const BOX_Z = 0.7;
/** The two candlesticks: how far to his sides, how tall, how big the flames. */
const CANDLE_SIDE = 0.95;
const CANDLE_HEIGHT = 1.15;
const FLAME_W = 0.22;
const FLAME_H = 0.4;
/** Glow of his eyes and the gold cross (× bloom), asleep / awake / at the AMEN. */
const GLOW_ASLEEP = 1.5;
const GLOW_AWAKE = 3;
const GLOW_AMEN = 6;
/** The preaching gestures: one cycle every this many seconds at rank D, shorter by GESTURE_PER_RANK each rank. */
const GESTURE_TIME = 1.3;
const GESTURE_PER_RANK = 0.16;
/** Share of the cycle he spends with both arms up (from rank GESTURE_ECSTASY_FROM on). */
const GESTURE_ECSTASY_SHARE = 0.3;
const GESTURE_ECSTASY_FROM = 2;
/** After an AMEN he holds his arms up this long; after a missed HIGH NOON he reads, sulking, this long. */
const AMEN_HOLD = 0.8;
const SULK_TIME = 1.8;
/** He sways a little as he preaches (meters). */
const SWAY = 0.03;

// --- His light ---
const LIGHT_COLOR = 0xff3a1a;
const LIGHT_RANGE = 10;
const LIGHT_ASLEEP = 2.5;
const LIGHT_AWAKE = 5;
const LIGHT_AMEN = 30;
const LIGHT_GLORY = 70;
/** A flash fades this fast (per second). */
const FLASH_DECAY = 3;
/**
 * The light hangs at his chest, LIGHT_FRONT meters in front of him (toward
 * the camera): right over his head it only grazed the sprite, a flat plane
 * facing you, and he was a black silhouette.
 */
const LIGHT_HEIGHT = 1.6;
const LIGHT_FRONT = 1.3;

// --- The column of light ---
const BEAM_RADIUS = 0.6;
const BEAM_HEIGHT = 60;
const BEAM_COLOR = new THREE.Color(2.4, 0.3, 0.2);
const BEAM_OPACITY_ASLEEP = 0.38;
const BEAM_OPACITY_AWAKE = 0.08;
/** It starts over his hat. */
const BEAM_FROM = 2.6;
/** Up close you don't need the waypoint: it fades in between these distances (meters). */
const BEAM_NEAR = 6;
const BEAM_FAR = 20;

// --- The circle ---
/** Ring color (× bloom), width of the dashed ring, how many dashes, how fast they run (turns per second, faster with the rank). */
const RING_COLOR = new THREE.Color(2.4, 0.25, 0.15);
const RING_WIDTH = 0.45;
const RING_DASHES = 60;
const RING_SPIN = 0.05;
const RING_SPIN_PER_RANK = 0.04;
/** A second, thin solid ring this far inside the dashed one. */
const RING_INNER = 0.8;
/** The glow inside the edge: how deep (meters), how bright. */
const RING_FILL = 2.5;
const RING_FILL_OPACITY = 0.2;
/** Asleep: the small ring at his feet (meters). */
const ASLEEP_RING = 1.6;
/** The ring opens with a bounce in this many seconds. */
const UNFOLD_TIME = 0.9;
/** The wall of light along the edge: height (meters), color, opacity; brighter and pulsing when you're outside. */
const WALL_HEIGHT = 3.2;
const WALL_COLOR = new THREE.Color(2.0, 0.2, 0.12);
const WALL_OPACITY = 0.22;
const WALL_OUTSIDE = 2.6;
const WALL_OUTSIDE_HZ = 2;
/** Floats this high over the floor (2 cm: above the ground patches, like everything lying on the floor). */
const LIFT = 0.02;

// --- The ends ---
/** Glory: he rises this high in this many seconds, showering blood, then goes up in flames at IGNITE_AT; the ring is blown out to × GLORY_RING. */
const GLORY_RISE = 1.4;
const GLORY_TIME = 3.2;
const IGNITE_AT = 1.9;
const GLORY_RING = 1.6;
/** Failed: how long he takes to sink (meters down, seconds). */
const DIE_SINK = 2.4;
const DIE_TIME = 2.2;

type Mode = 'none' | 'asleep' | 'awake' | 'glory' | 'dying';

export interface SermonRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, dt: number, time: number): void;
}

export function createSermonRenderer(scene: THREE.Scene): SermonRenderer {
  const root = new THREE.Group(); // at his feet point
  root.visible = false;
  scene.add(root);

  // --- The soapbox and the candles ---
  const box = texturedBox(BOX_X, BOX_Y, BOX_Z, barrelTexture());
  box.position.y = BOX_Y / 2;
  root.add(box);
  const flames = [-1, 1].map((side) => {
    const stick = texturedBox(0.07, CANDLE_HEIGHT, 0.07, ironTexture());
    stick.position.set(side * CANDLE_SIDE, CANDLE_HEIGHT / 2, 0);
    root.add(stick);
    const flame = createFlame(FLAME_W, FLAME_H);
    flame.sprite.position.set(side * CANDLE_SIDE, CANDLE_HEIGHT, 0);
    root.add(flame.sprite);
    return flame;
  });

  // --- The preacher: a cylindrical billboard on the box (like the vendors, vendors.ts) ---
  const sheet = preacherSheet();
  const width = PREACHER_W / PIXELS_PER_METER;
  const height = PREACHER_H / PIXELS_PER_METER;
  const material = new THREE.MeshStandardMaterial({
    map: sheet.color,
    alphaTest: 0.5,
    emissive: 0xff4020,
    emissiveMap: sheet.glow,
    emissiveIntensity: GLOW_ASLEEP,
    roughness: 1,
  });
  addHeightFog(material);
  const preacher = new THREE.Mesh(new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0), material);
  preacher.castShadow = true;
  preacher.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: sheet.color,
    alphaTest: 0.5,
  });
  root.add(preacher);

  // In the scene itself, not in `root`: a light under an invisible group isn't
  // counted, and its "appearing" would recompile every shader.
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

  // --- The circle: the ring on the ground and the wall of light ---
  const ringMaterial = createRingMaterial();
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringMaterial);
  ring.position.y = LIFT;
  root.add(ring);
  // The wall: the column's texture (bright at the foot, gone at the top) on a
  // short open cylinder, repeated around it.
  const wallTexture = beamTexture();
  wallTexture.wrapS = THREE.RepeatWrapping;
  wallTexture.repeat.x = 40;
  const wallMaterial = new THREE.MeshBasicMaterial({
    map: wallTexture,
    color: WALL_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide, // seen from inside and from outside
  });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0), wallMaterial);
  root.add(wall);

  let mode: Mode = 'none';
  let current: SermonEvent | null = null;
  /** Time in the current mode; how far the circle has unfolded (awake). */
  let modeTime = 0;
  let unfoldTime = 0;
  let flash = 0;
  /** The rank he saw last (inside the circle), to cheer every new one. */
  let lastRank = 0;
  let amenTime = 0;
  let sulkTime = 0;
  let gesture = 0;
  let ignited = false;
  const feet = new THREE.Vector3(); // his feet point, in the world
  const hands = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function show(on: boolean): void {
    root.visible = on;
    light.intensity = 0;
    if (!on) {
      mode = 'none';
      current = null;
    }
  }

  /** Blood out of his raised hands, up and to the sides: the show is cruento. */
  function bloodSpray(count: number): void {
    hands.set(feet.x, feet.y + BOX_Y + height * 0.95, feet.z);
    up.set((Math.random() - 0.5) * 0.6, 1, (Math.random() - 0.5) * 0.6).normalize();
    spawnBlood(hands, up, count);
    up.set(0, 1, 0);
  }

  return {
    update(game, events, camera, dt, time) {
      const active = game.mapEvent.active;
      const ev = active?.kind === 'sermon' ? active : null;

      // A new show: put him there (reading, or preaching if he woke in this same frame).
      if (ev && ev !== current) {
        current = ev;
        mode = ev.awake ? 'awake' : 'asleep';
        modeTime = 0;
        unfoldTime = 0;
        flash = 0;
        amenTime = 0;
        sulkTime = 0;
        ignited = false;
        lastRank = styleRank(game.style.points);
        root.position.set(ev.x, ev.y, ev.z);
        preacher.position.set(0, BOX_Y, 0);
        preacher.visible = true;
        box.position.y = BOX_Y / 2; // a previous show may have ended halfway through sinking
        for (const f of flames) f.sprite.scale.set(FLAME_W, FLAME_H, 1);
        show(true);
      }
      if (mode === 'none') return;
      feet.copy(root.position);
      const where = () => soundAt(camera, feet.x, feet.y + 2, feet.z);

      for (const e of events) {
        if (e.type === 'sermonWake') {
          mode = 'awake';
          unfoldTime = 0;
          flash = 1;
          amenTime = AMEN_HOLD;
          lastRank = styleRank(game.style.points);
          spawnSparks(hands.set(feet.x, feet.y + BOX_Y + 1, feet.z), up, 20);
          playSermonWake(where());
        } else if (e.type === 'sermonMissed') {
          sulkTime = SULK_TIME;
          playSermonMissed(where());
        } else if (e.type === 'mapEventEnd' && e.kind === 'sermon') {
          current = null;
          mode = e.success ? 'glory' : 'dying';
          modeTime = 0;
          ignited = false;
          if (e.success) {
            flash = 1;
            playSermonGlory(where());
          } else {
            playSermonFail(where());
          }
        }
      }
      // Gone without an end (you died: a new game starts): just hide him.
      if (!ev && (mode === 'asleep' || mode === 'awake')) {
        show(false);
        return;
      }
      modeTime += dt;
      flash = Math.max(0, flash - flash * FLASH_DECAY * dt);
      amenTime = Math.max(0, amenTime - dt);
      sulkTime = Math.max(0, sulkTime - dt);

      // --- The crowd-pleaser: every rank climbed in his circle gets an AMEN ---
      const inside = ev !== null && inSermonCircle(ev, game.player);
      const rank = styleRank(game.style.points);
      if (mode === 'awake') {
        if (inside && rank > lastRank && !isHighNoon(game.style)) {
          amenTime = AMEN_HOLD;
          flash = Math.max(flash, 0.6);
          bloodSpray(10 + rank * 4);
          playSermonAmen(where(), rank);
        }
        lastRank = rank; // outside he doesn't see it: a rank reached out there gets no cheer when you come back
      }

      // --- His pose: the frame from the state of the show ---
      let frame: number = PREACHER_FRAME.reading;
      let glow = GLOW_ASLEEP;
      if (mode === 'awake') {
        glow = GLOW_AWAKE;
        gesture += dt / Math.max(0.35, GESTURE_TIME - rank * GESTURE_PER_RANK);
        const ecstatic = rank >= GESTURE_ECSTASY_FROM && gesture % 1 > 1 - GESTURE_ECSTASY_SHARE;
        frame = sulkTime > 0 ? PREACHER_FRAME.reading : amenTime > 0 || ecstatic ? PREACHER_FRAME.ecstasy : PREACHER_FRAME.preaching;
        if (amenTime > 0) glow = GLOW_AMEN;
        preacher.position.x = Math.sin(gesture * Math.PI * 2) * SWAY;
      } else if (mode === 'glory') {
        frame = PREACHER_FRAME.ecstasy;
        glow = GLOW_AMEN;
      }
      sheet.color.offset.x = sheet.glow.offset.x = frame / PREACHER_FRAMES;
      material.emissiveIntensity = glow;
      // Turned toward the camera around the vertical axis only (cylindrical billboard).
      preacher.rotation.y = Math.atan2(camera.position.x - feet.x, camera.position.z - feet.z);
      for (const f of flames) f.update(time);

      // --- The column of light ---
      beam.visible = mode === 'asleep' || mode === 'awake';
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(feet), BEAM_NEAR, BEAM_FAR);
      const pulse = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * 0.8);
      beamMaterial.opacity = (mode === 'asleep' ? BEAM_OPACITY_ASLEEP : BEAM_OPACITY_AWAKE) * (0.75 + 0.25 * pulse) * near;

      // --- The circle ---
      const radius = tuning.sermonRadius;
      let circle = 0;
      let fade = 1;
      let lightLevel = mode === 'asleep' ? LIGHT_ASLEEP : LIGHT_AWAKE;
      if (mode === 'asleep') {
        circle = ASLEEP_RING * (1 + 0.15 * pulse);
        fade = 0.5 + 0.5 * pulse;
      } else if (mode === 'awake') {
        unfoldTime = Math.min(UNFOLD_TIME, unfoldTime + dt);
        circle = radius * easeOutBack(unfoldTime / UNFOLD_TIME);
      } else if (mode === 'glory') {
        // He rises showering blood; at IGNITE_AT he goes up in flames and is gone.
        const t = Math.min(1, modeTime / GLORY_TIME);
        const rise = Math.min(1, modeTime / IGNITE_AT);
        preacher.position.y = BOX_Y + GLORY_RISE * (1 - (1 - rise) ** 2);
        if (!ignited) {
          if (Math.random() < dt * 25) bloodSpray(6);
          if (modeTime >= IGNITE_AT) {
            ignited = true;
            preacher.visible = false;
            hands.set(feet.x, feet.y + preacher.position.y + height * 0.5, feet.z);
            spawnBlastFire(hands, up, 40);
            spawnSparks(hands, up, 40);
            spawnSmoke(hands, up, 14);
            bloodSpray(40);
            flash = 1;
          }
        }
        lightLevel = LIGHT_AWAKE * (1 - t);
        circle = radius * (1 + (GLORY_RING - 1) * Math.sqrt(t));
        fade = (1 - t) ** 2;
        for (const f of flames) f.sprite.scale.set(FLAME_W * (1 + t), FLAME_H * (1 + 2 * t * (1 - t) * 4), 1);
        if (t >= 1) {
          for (const f of flames) f.sprite.scale.set(FLAME_W, FLAME_H, 1);
          show(false);
          return;
        }
      } else if (mode === 'dying') {
        const t = Math.min(1, modeTime / DIE_TIME);
        preacher.position.y = BOX_Y - DIE_SINK * t * t;
        box.position.y = BOX_Y / 2 - DIE_SINK * t * t;
        lightLevel = LIGHT_AWAKE * (1 - t) ** 2;
        circle = radius * (1 - 0.2 * t);
        fade = (1 - t) ** 2;
        for (const f of flames) f.sprite.scale.set(FLAME_W * (1 - t), FLAME_H * (1 - t), 1);
        if (Math.random() < dt * 18) spawnSmoke(hands.set(feet.x, feet.y + 0.3, feet.z), up, 1);
        if (t >= 1) {
          box.position.y = BOX_Y / 2;
          for (const f of flames) f.sprite.scale.set(FLAME_W, FLAME_H, 1);
          show(false);
          return;
        }
      }
      const u = ringMaterial.uniforms;
      u.uTime.value = time * (RING_SPIN + RING_SPIN_PER_RANK * rank);
      u.uRadius.value = circle;
      u.uFade.value = fade;
      const size = circle + RING_WIDTH + 0.5; // half the side of the quad: just enough for the ring
      ring.scale.set(size, 1, size);
      u.uSize.value = size;
      ring.visible = circle > 0.05;
      // The wall stands only on the open circle. Outside it, it flares and pulses: he can't see you.
      wall.visible = mode !== 'asleep' && circle > 0.5;
      const opening = mode === 'awake' ? unfoldTime / UNFOLD_TIME : 1;
      wall.scale.set(circle, WALL_HEIGHT * opening, circle);
      const outside = ev !== null && mode === 'awake' && !inside;
      const callBack = outside ? WALL_OUTSIDE * (0.75 + 0.25 * Math.sin(time * Math.PI * 2 * WALL_OUTSIDE_HZ)) : 1;
      wallMaterial.opacity = WALL_OPACITY * fade * callBack;
      wallTexture.offset.x = time * 0.02;

      // --- His light: steady, and a flash at the AMENs and at the glory ---
      const facing = preacher.rotation.y; // he turns to the camera: "in front of him" = toward it
      light.position.set(
        feet.x + Math.sin(facing) * LIGHT_FRONT,
        feet.y + LIGHT_HEIGHT + preacher.position.y,
        feet.z + Math.cos(facing) * LIGHT_FRONT,
      );
      light.intensity = lightLevel + flash * (mode === 'glory' ? LIGHT_GLORY : LIGHT_AMEN);
    },
  };
}

/** Overshoots past 1 and settles back: the circle opens with a bounce (the same curve as the Ember Heart's). */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/**
 * The ring on the ground, drawn by a SHADER on a flat square (like the Ember
 * Heart's, emberHeart.ts): every pixel computes its distance and its angle
 * from the center, and keeps itself only if it's part of the drawing:
 * - near the radius: the dashed ring (the angle × how many dashes, the
 *   fractional part; + time, so they run around);
 * - RING_INNER inside it: a thin solid ring;
 * - just inside that: a soft glow fading toward the middle, in 4 hard steps
 *   (pixel art: no smooth gradients);
 * - everywhere else: nothing (discard).
 */
function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRadius: { value: 0 },
      uWidth: { value: RING_WIDTH },
      uInner: { value: RING_INNER },
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
      uniform float uRadius, uWidth, uInner, uSize, uFade, uTime, uDashes, uFill, uFillOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * uSize;           // meters from the center
        float r = length(p);
        float turn = atan(p.y, p.x) / 6.2831853 + 0.5; // 0..1 around the circle
        float inner = uRadius - uInner;
        vec3 c;
        if (abs(r - uRadius) < uWidth * 0.5) {
          float dash = step(0.45, fract(turn * uDashes - uTime));
          c = uColor * (0.25 + 0.75 * dash);
        } else if (abs(r - inner) < 0.08 && inner > 0.0) {
          c = uColor * 0.6;
        } else if (r < inner && r > inner - uFill) {
          float k = floor((1.0 - (inner - r) / uFill) * 4.0) / 4.0; // 4 hard steps
          c = uColor * uFillOpacity * k * k;
        } else {
          discard;
        }
        gl_FragColor = vec4(c * uFade, 1.0);
      }`,
    blending: THREE.AdditiveBlending, // light adds up
    depthWrite: false,
    transparent: true,
  });
}
