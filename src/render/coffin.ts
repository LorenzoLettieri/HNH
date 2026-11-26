// The undertaker's coffin (the simulation: src/sim/relics.ts). A pine box on
// two trestles in the cemetery, a brass cross on the lid, two candles at
// the head. Pay and the lid is KICKED OPEN from inside: it flies up on its
// hinge, slams against its stop and bounces; out of the red velvet rises the
// relic, turning like a coin, then it shoots into your hands. A moment later
// the lid falls shut again. No money: the coffin rattles and someone knocks
// twice from inside.
//
// It only READS the simulation (world.coffin for where, the 'coffinOpened'
// and 'coffinFailed' events for when). Everything is built once at startup;
// the light is always in the scene (adding one while playing would make
// Three.js recompile every shader), it only changes intensity.
//
// THE LID IS A LITTLE PHYSICS SIMULATION, like the revolver's cylinder: an
// angle with a speed. A spring pulls it toward where it should be (open or
// shut), a damper slows it, and at the two ends (the stop when open, the
// coffin when shut) the speed is thrown back reversed and smaller: a bounce.
// The kick from inside is just a big push on the speed: the overshoot, the
// slam and the bounce come out by themselves.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';
import { RELICS, type RelicId } from '../sim/relics';
import { playCoffinKnock, playCoffinOpen, playCoffinShut, playRelicGet } from '../audio/sfx';
import { addHeightFog } from './heightFog';
import { spawnSmoke, spawnSoulWisp, spawnSparks } from './particles';
import { createFlame, propMaterial, scaleUV, solid, texturedBox } from './props/common';
import { brassTexture, postWoodTexture } from './props/textures';
import { relicTexture } from './relicIcons';
import { soundAt } from './soundPosition';

// --- Shape (meters), length along local Z, head at −Z ---
/** The coffin's outline seen from above: [half width, z], from the head round to the foot (the classic six sides). */
const OUTLINE: [number, number][] = [[0.22, -1.0], [0.34, -0.6], [0.17, 1.0]];
/** Height of the box, of the lid, and of the trestles it lies on. */
const BODY_HEIGHT = 0.42;
const LID_THICK = 0.07;
const TRESTLE_HEIGHT = 0.55;
/** Where the trestles stand along the coffin. */
const TRESTLES = [-0.55, 0.6];

// --- The lid's physics ---
/** Open: the angle of its stop (radians, ~115°). */
const LID_OPEN = 2.0;
/** The kick from inside: angular speed given at once (rad/s). */
const KICK_SPEED = 16;
/** Spring toward the target angle and damping (per second). Low damping = it wobbles. */
const LID_STIFFNESS = 30;
const LID_DAMPING = 4;
/** Bounce on the stops: the speed thrown back × this. */
const LID_BOUNCE = 0.35;
/** Seconds the lid stays open before falling back. */
const OPEN_HOLD = 1.0;

// --- The relic's flight (in step with relicHud.ts ARRIVE_DELAY = KICK_AT + RISE_TIME + FLY_TIME) ---
/** Seconds of rattling before the kick: the anticipation. */
const KICK_AT = 0.3;
/** It rises this high above the open box, in this many seconds, turning like a coin. */
const RISE_HEIGHT = 1.1;
const RISE_TIME = 0.4;
const SPIN_HZ = 2.2;
/** Then it flies to you (a curve, see `flyPoint`) in this many seconds. */
const FLY_TIME = 0.35;
/** Size of the relic's sprite (meters) and how much it glows (above 1 = bloom). */
const RELIC_SIZE = 0.45;
const RELIC_GLOW = 2.2;

// --- Look ---
/** The rattle: how far it shakes (meters) and how fast (Hz). */
const RATTLE = 0.025;
const RATTLE_HZ = 30;
/** The light of the candles, and the flash of the opening (gold-green: the grave's own light). */
const LIGHT_COLOR = 0xffa850;
const LIGHT_IDLE = 1.2;
const LIGHT_RANGE = 6;
const FLASH_COLOR = new THREE.Color(0x9affb0);
const FLASH_INTENSITY = 9;
const FLASH_FADE = 1.5;
/** The velvet lining: dark red, glowing while the lid is up. */
const VELVET = 0x5a0812;
const VELVET_GLOW = 0.9;

export interface CoffinRenderer {
  update(events: SimEvent[], camera: THREE.Camera, dt: number, time: number): void;
}

export function createCoffinRenderer(scene: THREE.Scene, world: World): CoffinRenderer {
  const spot = world.coffin;
  if (!spot) return { update() {} };

  const root = new THREE.Group();
  root.position.set(spot.x, spot.y, spot.z);
  root.rotation.y = spot.rotation;
  scene.add(root);
  const body = new THREE.Group(); // what rattles: coffin and lid, not the trestles
  body.position.y = TRESTLE_HEIGHT;
  root.add(body);

  const wood = postWoodTexture();
  const woodMat = propMaterial(wood);

  // --- The box: the outline pushed up (ExtrudeGeometry pushes a 2D shape along Z; we turn it to point up) ---
  body.add(solid(prism(0, BODY_HEIGHT), woodMat));
  // The velvet inside, seen when the lid is up: the outline a bit smaller, just above the top.
  const velvetMat = new THREE.MeshStandardMaterial({ color: VELVET, emissive: 0xff2030, emissiveIntensity: 0, roughness: 1 });
  addHeightFog(velvetMat);
  const velvet = new THREE.Mesh(flat(0.04), velvetMat);
  velvet.position.y = BODY_HEIGHT + 0.003;
  body.add(velvet);

  // --- The lid: hinged along the +X side, at the widest point ---
  const hingeX = OUTLINE[1][0] + 0.015;
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, BODY_HEIGHT, 0);
  body.add(hinge);
  const lid = solid(prism(0.015, LID_THICK), woodMat); // a little bigger than the box: it overhangs
  lid.position.x = -hingeX;
  hinge.add(lid);
  // A brass cross on the lid.
  const brass = brassTexture();
  const crossLong = texturedBox(0.05, 0.02, 0.6, brass);
  crossLong.position.set(-hingeX, LID_THICK + 0.01, -0.2);
  const crossShort = texturedBox(0.3, 0.02, 0.05, brass);
  crossShort.position.set(-hingeX, LID_THICK + 0.01, -0.36);
  hinge.add(crossLong, crossShort);

  // --- Two trestles (a beam on four splayed legs) ---
  for (const z of TRESTLES) {
    const beam = texturedBox(0.9, 0.08, 0.12, wood);
    beam.position.set(0, TRESTLE_HEIGHT - 0.04, z);
    root.add(beam);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = texturedBox(0.06, TRESTLE_HEIGHT, 0.06, wood);
        leg.position.set(sx * 0.36, TRESTLE_HEIGHT / 2 - 0.02, z + sz * 0.08);
        leg.rotation.z = sx * 0.12; // splayed out, like a sawhorse
        leg.rotation.x = -sz * 0.12;
        root.add(leg);
      }
    }
  }

  // --- Two candles at the head, on the ground: the grave's waypoint at night ---
  const waxMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.7 });
  addHeightFog(waxMat);
  const flames: ReturnType<typeof createFlame>[] = [];
  for (const sx of [-1, 1]) {
    const candle = solid(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 8), waxMat);
    candle.position.set(sx * 0.35, 0.16, -1.25);
    root.add(candle);
    const flame = createFlame(0.1, 0.16);
    flame.sprite.position.set(sx * 0.35, 0.33, -1.25);
    root.add(flame.sprite);
    flames.push(flame);
  }

  // --- The light: in the SCENE (not in a hidden group), always there ---
  const light = new THREE.PointLight(LIGHT_COLOR, LIGHT_IDLE, LIGHT_RANGE, 2);
  scene.add(light);
  const candleColor = new THREE.Color(LIGHT_COLOR);

  // --- The relic's sprite: one, reused; one material per relic, made now (no shaders compiled while playing) ---
  const relicMats = new Map<RelicId, THREE.SpriteMaterial>();
  for (const id of RELICS) {
    relicMats.set(id, new THREE.SpriteMaterial({ map: relicTexture(id), color: new THREE.Color(1, 1, 1).multiplyScalar(RELIC_GLOW), alphaTest: 0.5, fog: false }));
  }
  const relic = new THREE.Sprite(relicMats.get(RELICS[0]));
  relic.visible = false;
  scene.add(relic);

  // --- State ---
  let angle = 0; // the lid: 0 shut, LID_OPEN at its stop
  let speed = 0;
  let open = false; // where the spring pulls
  let openTime = -1; // seconds since the coffin was paid (−1 = idle)
  let rattle = 0; // seconds of rattling left
  let flash = 0;
  let current: RelicId = RELICS[0];
  let flewFrom = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const forward = new THREE.Vector3();

  /** A point of the box in the world (local coordinates of `body`). */
  const worldPoint = (x: number, y: number, z: number) => body.localToWorld(tmp.set(x, y, z)).clone();

  return {
    update(events, camera, dt, time) {
      const where = () => soundAt(camera, spot.x, spot.y + 0.8, spot.z);
      for (const e of events) {
        if (e.type === 'coffinOpened') {
          openTime = 0;
          rattle = KICK_AT;
          current = e.relic;
          relic.material = relicMats.get(current)!;
          playCoffinOpen(where());
        } else if (e.type === 'coffinFailed' && e.reason === 'money') {
          rattle = 0.35;
          playCoffinKnock(where());
        }
      }

      // --- The timeline of an opening ---
      if (openTime >= 0) {
        const before = openTime;
        openTime += dt;
        // The kick from inside: a push on the lid, a burst out of the box.
        if (before < KICK_AT && openTime >= KICK_AT) {
          open = true;
          speed += KICK_SPEED;
          flash = 1;
          const mouth = worldPoint(0, BODY_HEIGHT + 0.1, -0.2);
          spawnSoulWisp(mouth, new THREE.Vector3(0, 1, 0), 30);
          spawnSmoke(mouth, new THREE.Vector3(0, 1, 0), 8);
          spawnSparks(mouth, new THREE.Vector3(0, 1, 0), 16);
          flewFrom = worldPoint(0, BODY_HEIGHT + RISE_HEIGHT, -0.2);
        }
        const t = openTime - KICK_AT;
        if (t >= 0 && t < RISE_TIME + FLY_TIME) {
          relic.visible = true;
          const start = worldPoint(0, BODY_HEIGHT, -0.2);
          if (t < RISE_TIME) {
            // Rising, slowing down at the top (ease-out), turning like a coin: the width is |cos| of the turn.
            const k = 1 - (1 - t / RISE_TIME) ** 3;
            relic.position.copy(start).y += RISE_HEIGHT * k;
            relic.scale.set(RELIC_SIZE * Math.max(0.15, Math.abs(Math.cos(t * SPIN_HZ * Math.PI * 2))), RELIC_SIZE, 1);
            flewFrom = relic.position.clone();
          } else {
            // Flying to you: a quadratic Bézier from where it floats to just under your eyes, bulging up.
            const u = (t - RISE_TIME) / FLY_TIME;
            camera.getWorldDirection(forward);
            const to = camera.position.clone().addScaledVector(forward, 0.6);
            to.y -= 0.25;
            const control = flewFrom.clone().lerp(to, 0.5);
            control.y += 1;
            relic.position.copy(bezier(flewFrom, control, to, u * u)); // u²: it speeds up toward you
            relic.scale.set(RELIC_SIZE * (1 - 0.6 * u), RELIC_SIZE * (1 - 0.6 * u), 1);
          }
        } else if (relic.visible) {
          relic.visible = false;
          playRelicGet();
        }
        // Falls shut after a while.
        if (open && openTime > KICK_AT + OPEN_HOLD) open = false;
        if (openTime > KICK_AT + OPEN_HOLD + 2) openTime = -1;
      }

      // --- The lid's physics, in small fixed steps (a stiff spring is unstable with big ones) ---
      let left = Math.min(dt, 0.1);
      while (left > 0) {
        const h = Math.min(left, 1 / 240);
        left -= h;
        const target = open ? LID_OPEN : 0;
        speed += (LID_STIFFNESS * (target - angle) - LID_DAMPING * speed) * h;
        // Shut, the spring is weak: gravity does the work (the lid falls).
        if (!open) speed -= 25 * h;
        angle += speed * h;
        if (angle > LID_OPEN) {
          angle = LID_OPEN;
          if (speed > 0) speed = -speed * LID_BOUNCE;
        }
        if (angle < 0) {
          angle = 0;
          if (speed < -4) {
            // Slammed shut: a puff of dust from the seam, and the thud (not for the little bounces after).
            playCoffinShut(soundAt(camera, spot.x, spot.y + 0.8, spot.z));
            spawnSmoke(worldPoint(0, BODY_HEIGHT, 0), new THREE.Vector3(0, 1, 0), 5);
          }
          speed = speed < -1.5 ? -speed * LID_BOUNCE * 0.5 : 0;
        }
      }
      hinge.rotation.z = -angle;
      velvetMat.emissiveIntensity = VELVET_GLOW * Math.min(1, angle / 0.6);

      // --- Rattle, candles, light ---
      rattle = Math.max(0, rattle - dt);
      const shake = rattle > 0 ? RATTLE * Math.sin(time * RATTLE_HZ * Math.PI * 2) : 0;
      body.position.x = shake;
      body.rotation.z = shake * 2;
      for (const f of flames) f.update(time);
      flash = Math.max(0, flash - dt * FLASH_FADE);
      root.localToWorld(light.position.set(0, TRESTLE_HEIGHT + 0.6, -0.6));
      const flicker = 1 + 0.15 * Math.sin(time * 17) * Math.sin(time * 5.3);
      light.color.copy(candleColor).lerp(FLASH_COLOR, flash);
      light.intensity = LIGHT_IDLE * flicker + FLASH_INTENSITY * flash;
    },
  };

  /**
   * The coffin's six-sided outline as a 2D shape, `grow` meters bigger,
   * pushed up `height` meters. ExtrudeGeometry pushes along +Z; turned
   * −90° around X the shape lies flat and the push points up. (The shape's
   * y is the coffin's −z: the turn flips it.)
   */
  function prism(grow: number, height: number): THREE.BufferGeometry {
    const g = new THREE.ExtrudeGeometry(outlineShape(grow), { depth: height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return scaleUV(g, 1.5, 1.5);
  }
  /** The same outline, flat (`inset` meters smaller): the velvet. */
  function flat(inset: number): THREE.BufferGeometry {
    const g = new THREE.ShapeGeometry(outlineShape(-inset));
    g.rotateX(-Math.PI / 2);
    return g;
  }
}

/** The six-sided outline: down the +X side from head to foot, back up the −X side. */
function outlineShape(grow: number): THREE.Shape {
  const pts = [...OUTLINE.map(([w, z]) => [w + grow, z] as const), ...[...OUTLINE].reverse().map(([w, z]) => [-(w + grow), z] as const)];
  // The ends grow too: the head a bit further back, the foot a bit further forward.
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => {
    const zz = z < 0 && Math.abs(z) === 1 ? z - grow : z > 0 ? z + grow : z;
    if (i === 0) shape.moveTo(x, -zz);
    else shape.lineTo(x, -zz);
  });
  shape.closePath();
  return shape;
}

/** A point of a quadratic Bézier curve: (1−u)²·a + 2(1−u)u·b + u²·c. */
function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number): THREE.Vector3 {
  const v = 1 - u;
  return new THREE.Vector3()
    .addScaledVector(a, v * v)
    .addScaledVector(b, 2 * v * u)
    .addScaledVector(c, u * u);
}
