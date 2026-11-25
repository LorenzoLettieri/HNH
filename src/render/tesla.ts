// The Tesla's lightning on screen (simulation in src/sim/tesla.ts): the bolt
// from the gun to the first enemy, the chain of sparks from enemy to enemy
// ('teslaArc' event), and the jolted enemies twitching while stunned.
//
// A BOLT is a jagged line from A to B: BOLT_POINTS points along the segment,
// each pushed sideways by a random amount (zero at the two ends, biggest in
// the middle: sin(π·t), so it always starts and ends ON the targets). Every
// REJAG seconds the offsets are drawn again: the bolt "dances", which is
// what makes it read as electricity and not as a laser.
//
// It's drawn as RIBBONS, not lines: WebGL draws lines 1 pixel wide whatever
// you ask for. A ribbon = for each piece of the bolt a quad, two triangles,
// as wide as we want and turned to face the camera: its sideways direction is
// the cross product of the piece's direction and the direction to the camera
// (perpendicular to both: across the screen). Two ribbons for every bolt:
// a wide, dim GLOW and a thin, white-hot CORE (the same trick as the
// explosions' two spheres: a soft edge). All bolts share ONE geometry and
// one material, created at startup (no shader compiled mid-game): unused
// quads are just squashed to zero area.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { Entity } from '../sim/entities';
import { isAlive } from '../sim/entities';
import { hitCenter } from '../sim/gunDamage';
import { tuning } from '../sim/config';
import { playTeslaArc, playTeslaTwitch } from '../audio/sfx';
import { spawnZap } from './particles';
import { soundAt } from './soundPosition';

/** How many bolts can be on screen together (a shot + a 4-jump chain = 5). */
const MAX_BOLTS = 16;
/** Points along a bolt (BOLT_POINTS − 1 pieces). */
const BOLT_POINTS = 10;
/** How long a bolt lasts, seconds, and how often it changes shape. */
const BOLT_LIFE = 0.28;
const REJAG = 1 / 30;
/** How far the points stray sideways, × the bolt's length (and at most JAG_MAX meters). */
const JAG = 0.12;
const JAG_MAX = 0.8;
/** Width of the two ribbons, meters. */
const GLOW_WIDTH = 0.4;
const CORE_WIDTH = 0.08;
/** Colors (HDR: above 1 they bloom). */
const GLOW_COLOR = new THREE.Color(0x3a8cff).multiplyScalar(3);
const CORE_COLOR = new THREE.Color(0xe8f6ff).multiplyScalar(8);
/** The bolt from the gun: where it starts, from the camera (forward, right, down), meters. */
const MUZZLE = { forward: 0.9, right: 0.16, down: 0.14 };
/** The blue light where the chain lands: peak intensity, reach, time. */
const LIGHT_INTENSITY = 60;
const LIGHT_REACH = 9;
const LIGHT_TIME = 0.25;
const LIGHTS = 2;
/** Sparks: at every link of the chain, and per second on a twitching enemy. */
const LINK_ZAPS = 14;
const TWITCH_ZAPS_PER_SECOND = 40;
/** A crackle from a twitching enemy every this many seconds (on average). */
const TWITCH_SOUND_EVERY = 0.35;

interface Bolt {
  a: THREE.Vector3;
  b: THREE.Vector3;
  age: number;
  jagClock: number;
  /** The sideways offsets of the points, drawn again every REJAG (two perpendicular directions). */
  offsets: Float32Array;
  /** Brightness of this shape (it flickers). */
  flicker: number;
}

export interface TeslaRenderer {
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, dt: number): void;
}

export function createTeslaRenderer(scene: THREE.Scene): TeslaRenderer {
  // 2 ribbons × (BOLT_POINTS − 1) quads × 4 vertices, for every bolt.
  const quadsPerBolt = 2 * (BOLT_POINTS - 1);
  const vertexCount = MAX_BOLTS * quadsPerBolt * 4;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const index: number[] = [];
  for (let q = 0; q < MAX_BOLTS * quadsPerBolt; q++) {
    const v = q * 4;
    index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(index);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false, // light: the fog doesn't swallow it
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // the geometry changes every frame: its bounding sphere would be stale
  scene.add(mesh);

  const lights: { light: THREE.PointLight; age: number }[] = [];
  for (let i = 0; i < LIGHTS; i++) {
    const light = new THREE.PointLight(0x6aaeff, 0, LIGHT_REACH, 2);
    scene.add(light);
    lights.push({ light, age: LIGHT_TIME });
  }
  let nextLight = 0;

  const bolts: Bolt[] = [];
  /** Jolted enemies: id → seconds of twitching left (as long as their stun). */
  const twitching = new Map<number, number>();
  let zapOwed = 0;
  /** A carbine-Tesla 'fire' was seen: the next 'shot' is its bullet. */
  let teslaShotPending = false;

  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  function addBolt(a: THREE.Vector3, b: THREE.Vector3): void {
    if (bolts.length >= MAX_BOLTS) bolts.shift(); // the oldest goes
    const bolt: Bolt = { a: a.clone(), b: b.clone(), age: 0, jagClock: 0, offsets: new Float32Array(BOLT_POINTS * 2), flicker: 1 };
    jag(bolt);
    bolts.push(bolt);
  }

  function jag(bolt: Bolt): void {
    const amount = Math.min(JAG_MAX, bolt.a.distanceTo(bolt.b) * JAG);
    for (let i = 0; i < BOLT_POINTS; i++) {
      const t = i / (BOLT_POINTS - 1);
      const envelope = Math.sin(Math.PI * t); // 0 at the ends: the bolt starts and ends on its targets
      bolt.offsets[i * 2] = (Math.random() * 2 - 1) * amount * envelope;
      bolt.offsets[i * 2 + 1] = (Math.random() * 2 - 1) * amount * envelope;
    }
    bolt.flicker = 0.6 + Math.random() * 0.4;
  }

  function flashLight(at: THREE.Vector3): void {
    const l = lights[nextLight];
    nextLight = (nextLight + 1) % LIGHTS;
    l.light.position.copy(at);
    l.age = 0;
  }

  /** The point `i` of a bolt: along A→B, plus its offsets on two directions perpendicular to the bolt. */
  function boltPoint(bolt: Bolt, i: number, out: THREE.Vector3): THREE.Vector3 {
    const t = i / (BOLT_POINTS - 1);
    dir.subVectors(bolt.b, bolt.a);
    // Two directions perpendicular to the bolt: (dir × up) and (dir × that). A
    // vertical bolt would make dir × up zero: then use another "up".
    side.crossVectors(dir, Math.abs(dir.y) > 0.95 * dir.length() ? right.set(1, 0, 0) : up).normalize();
    tmp.crossVectors(dir, side).normalize();
    return out
      .copy(bolt.a)
      .addScaledVector(dir, t)
      .addScaledVector(side, bolt.offsets[i * 2])
      .addScaledVector(tmp, bolt.offsets[i * 2 + 1]);
  }

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const across = new THREE.Vector3();

  function writeRibbons(camera: THREE.Camera): void {
    positions.fill(0);
    let v = 0; // vertex index
    for (const bolt of bolts) {
      const fade = 1 - bolt.age / BOLT_LIFE;
      const strength = Math.sqrt(fade) * bolt.flicker; // bright almost to the end, then gone
      for (const [width, color] of [[GLOW_WIDTH, GLOW_COLOR], [CORE_WIDTH, CORE_COLOR]] as const) {
        boltPoint(bolt, 0, p0);
        for (let i = 1; i < BOLT_POINTS; i++) {
          boltPoint(bolt, i, p1);
          // Across the screen: perpendicular to the piece and to the line of sight.
          toCam.subVectors(camera.position, p0);
          dir.subVectors(p1, p0);
          across.crossVectors(dir, toCam).normalize().multiplyScalar(width / 2);
          const corners = [
            [p0, 1], [p0, -1], [p1, 1], [p1, -1],
          ] as const;
          for (const [p, s] of corners) {
            positions[v * 3] = p.x + across.x * s;
            positions[v * 3 + 1] = p.y + across.y * s;
            positions[v * 3 + 2] = p.z + across.z * s;
            colors[v * 3] = color.r * strength;
            colors[v * 3 + 1] = color.g * strength;
            colors[v * 3 + 2] = color.b * strength;
            v++;
          }
          p0.copy(p1);
        }
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  return {
    update(entities, events, camera, dt) {
      for (const e of events) {
        if (e.type === 'fire') {
          teslaShotPending = e.weapon === 'rifle' && e.forged; // (its sound: weaponFx.ts)
        } else if (e.type === 'shot' && teslaShotPending) {
          // The bullet: a bolt from (about) the end of the coil to where it landed.
          teslaShotPending = false;
          camera.getWorldDirection(forward);
          right.crossVectors(forward, up).normalize();
          tmp.copy(camera.position).addScaledVector(forward, MUZZLE.forward).addScaledVector(right, MUZZLE.right).addScaledVector(up, -MUZZLE.down);
          p1.set(e.to.x, e.to.y, e.to.z);
          addBolt(tmp, p1);
          spawnZap(p1, e.normal ? tmp.set(e.normal.x, e.normal.y, e.normal.z) : up, LINK_ZAPS);
        } else if (e.type === 'teslaArc') {
          for (let i = 1; i < e.points.length; i++) {
            p0.set(e.points[i - 1].x, e.points[i - 1].y, e.points[i - 1].z);
            p1.set(e.points[i].x, e.points[i].y, e.points[i].z);
            addBolt(p0, p1);
            spawnZap(p1, up, LINK_ZAPS);
          }
          const mid = e.points[Math.floor(e.points.length / 2)];
          flashLight(tmp.set(mid.x, mid.y, mid.z));
          playTeslaArc(soundAt(camera, mid.x, mid.y, mid.z), e.points.length - 1);
          for (const id of e.entityIds) twitching.set(id, tuning.teslaStunTime);
        }
      }

      // Bolts: age, change shape, go.
      for (let i = bolts.length - 1; i >= 0; i--) {
        const bolt = bolts[i];
        bolt.age += dt;
        bolt.jagClock += dt;
        if (bolt.jagClock >= REJAG) {
          bolt.jagClock = 0;
          jag(bolt);
        }
        if (bolt.age >= BOLT_LIFE) bolts.splice(i, 1);
      }
      writeRibbons(camera);
      mesh.visible = bolts.length > 0;

      for (const l of lights) {
        l.age += dt;
        const k = Math.max(0, 1 - l.age / LIGHT_TIME);
        l.light.intensity = LIGHT_INTENSITY * k * (0.6 + Math.random() * 0.4);
      }

      // Twitching enemies: sparks on the body and a crackle now and then.
      zapOwed += TWITCH_ZAPS_PER_SECOND * dt;
      const zaps = Math.floor(zapOwed);
      zapOwed -= zaps;
      for (const [id, left] of twitching) {
        const en = entities.find((x) => x.id === id);
        if (!en || !isAlive(en) || left <= 0) {
          twitching.delete(id);
          continue;
        }
        twitching.set(id, left - dt);
        const c = hitCenter(en);
        tmp.set(c.x + (Math.random() - 0.5) * 0.6, c.y + (Math.random() - 0.5) * 0.9, c.z + (Math.random() - 0.5) * 0.6);
        if (zaps > 0) spawnZap(tmp, up, zaps);
        if (Math.random() < dt / TWITCH_SOUND_EVERY) playTeslaTwitch(soundAt(camera, c.x, c.y, c.z));
      }
    },
  };
}
