// Draws the jackal ("Lo Sciacallo", src/sim/jackal.ts): a billboard with three
// views picked from the angle, exactly like the hounds (hounds.ts explains
// the trick): it spends its life running away, so most of the time you see
// its back and the big sack.
//
// What makes it FINDABLE and FOLLOWABLE, since finding it is half the event:
// - a faint gold COLUMN OF LIGHT over it, like the other events' waypoints,
//   that fades out when you're close (BEAM_NEAR/FAR);
// - SOUND: it cackles while it taunts you and now and then on the run, and
//   its sack jingles at every stride (positional: you hear where it went);
// - coins glinting out of the sack as it runs (gold sparks).
// Hit: a yelp, coins and gold sparks flying (the coins themselves are real
// pickups, from the simulation). Killed: the sack bursts. Escaped: it
// vanishes in a puff of fire.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, JackalEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { playJackalCackle, playJackalDeath, playJackalEscape, playJackalHit, playJackalJingle } from '../../audio/sfx';
import { beamTexture } from '../bells';
import { addHeightFog } from '../heightFog';
import { spawnBlastFire, spawnSmoke, spawnSparks } from '../particles';
import { soundAt } from '../soundPosition';
import { FRAMES, FRAME_H, FRAME_W, jackalSheet } from './jackalSprite';
import { addSpecimen } from '../warmUp';

const PIXELS_PER_METER = 32;
/** Run animation: frames per meter (one 4-frame stride ≈ 1.8 m: short legs, quick steps). */
const FRAMES_PER_METER = 2.2;
/** Taunting: how fast it shakes the sack (frames per second). */
const TAUNT_FPS = 6;
/** Climbing: seconds per frame (hand over hand). */
const CLIMB_FRAME_TIME = 0.15;
/** How long the hurt frame shows after a hit, seconds. */
const HURT_TIME = 0.18;
/** How fast its facing follows the simulation's (1/s): smooths out jitter. */
const TURN_RATE = 14;
/** Within this angle of "straight at / away from the camera", the front / back view. */
const FRONT_ANGLE = (35 * Math.PI) / 180;
/** Glow of the eyes, the gold tooth and the coins (HDR: above ~1 it blooms). */
const GLOW = 3.5;
/** Seconds between two cackles: taunting (it's laughing at you), and on the run (now and then). */
const CACKLE_TAUNT = [1.4, 2.4];
const CACKLE_FLEE = [3, 5.5];
/** Meters of running between two jingles of the sack (one per stride). */
const JINGLE_EVERY = 0.9;
/** Gold glints out of the sack while it runs: per second, and sparks per glint. */
const GLINTS_PER_SECOND = 6;
/** Hit / killed: gold sparks thrown out of the sack. */
const HIT_SPARKS = 14;
const DEATH_SPARKS = 50;
/** Escaped: fire and smoke of the puff it vanishes in. */
const ESCAPE_FIRE = 30;
const ESCAPE_SMOKE = 10;
/** The column of light: radius, height, color, opacity, and the distances it fades out between (meters). */
const BEAM_RADIUS = 0.35;
const BEAM_HEIGHT = 50;
const BEAM_COLOR = new THREE.Color(2.4, 1.7, 0.4);
const BEAM_OPACITY = 0.22;
const BEAM_NEAR = 12;
const BEAM_FAR = 35;

interface JackalView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  beam: THREE.Mesh;
  /** Direction it faces (radians, the player's yaw convention), smoothed. */
  yaw: number;
  runPhase: number;
  hurtTime: number;
  cackleIn: number;
  jingleMeters: number;
  glintOwed: number;
}

export interface JackalRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

export function createJackalRenderer(scene: THREE.Scene): JackalRenderer {
  const sheet = jackalSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0); // the hooves at the origin
  const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 8, 1, true);
  beamGeometry.translate(0, BEAM_HEIGHT / 2 + height + 0.3, 0); // from just over its ears
  const beamMap = beamTexture();

  const views = new Map<number, JackalView>();
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function create(): JackalView {
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      emissive: 0xffc040,
      emissiveMap: glowMap,
      emissiveIntensity: GLOW,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);
    const beam = new THREE.Mesh(
      beamGeometry,
      new THREE.MeshBasicMaterial({
        map: beamMap,
        color: BEAM_COLOR,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    scene.add(beam);
    return { mesh, material, map, glowMap, beam, yaw: 0, runPhase: 0, hurtTime: 0, cackleIn: 0.5, jingleMeters: 0, glintOwed: 0 };
  }

  function showFrame(v: JackalView, frame: number, mirror: boolean): void {
    const n = sheet.frameCount;
    for (const t of [v.map, v.glowMap]) {
      t.repeat.x = (mirror ? -1 : 1) / n;
      t.offset.x = (mirror ? frame + 1 : frame) / n;
    }
  }

  function remove(id: number, v: JackalView): void {
    scene.remove(v.mesh, v.beam);
    v.material.dispose();
    (v.mesh.customDepthMaterial as THREE.Material).dispose();
    (v.beam.material as THREE.Material).dispose();
    v.map.dispose();
    v.glowMap.dispose();
    views.delete(id);
  }

  // One hidden at startup, so the warm-up compiles its shaders (render/warmUp.ts).
  addSpecimen(scene, () => create());

  return {
    update(entities, events, camera, alpha, dt) {
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const e of events) {
        if (e.type === 'hit') {
          const j = byId.get(e.entityId);
          if (!j || j.type !== 'jackal') continue;
          const v = views.get(j.id);
          if (v) v.hurtTime = HURT_TIME;
          point.set(j.x, j.y + 0.9, j.z);
          dir.set(0, 1, 0);
          if (e.killed) {
            playJackalDeath(soundAt(camera, j.x, j.y + 0.8, j.z));
            spawnSparks(point, dir, DEATH_SPARKS);
            spawnSmoke(point, dir, 4);
          } else {
            playJackalHit(soundAt(camera, j.x, j.y + 0.8, j.z));
          }
        }
        // Coins knocked out of the sack: gold sparks where they fly from.
        if (e.type === 'jackalCoins') spawnSparks(point.set(e.x, e.y, e.z), dir.set(0, 1, 0), HIT_SPARKS);
        if (e.type === 'jackalEscaped') {
          point.set(e.x, e.y + 0.5, e.z);
          dir.set(0, 1, 0);
          spawnBlastFire(point, dir, ESCAPE_FIRE);
          spawnSmoke(point, dir, ESCAPE_SMOKE);
          playJackalEscape(soundAt(camera, e.x, e.y + 0.8, e.z));
        }
      }

      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'jackal') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        draw(v, e, camera, alpha, dt);
      }
      for (const [id, v] of views) if (!seen.has(id)) remove(id, v);
    },
  };

  function draw(v: JackalView, e: JackalEntity, camera: THREE.Camera, alpha: number, dt: number): void {
    const m = v.mesh;
    m.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    const toCamera = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    m.rotation.y = toCamera; // cylindrical billboard

    // Facing: the simulation's (where it runs, or toward you), turning the shortest way round.
    const target = Math.atan2(e.dirX, e.dirZ);
    const diff = Math.atan2(Math.sin(target - v.yaw), Math.cos(target - v.yaw));
    v.yaw += diff * Math.min(1, TURN_RATE * dt);
    const rel = v.yaw - toCamera;
    const view = Math.cos(rel) > Math.cos(FRONT_ANGLE) ? 'front' : Math.cos(rel) < -Math.cos(FRONT_ANGLE) ? 'back' : 'side';
    const mirror = Math.sin(rel) < 0;

    // The waypoint: bright from afar, gone up close (and gone when it's dead).
    const distance = camera.position.distanceTo(m.position);
    const fade = Math.min(1, Math.max(0, (distance - BEAM_NEAR) / (BEAM_FAR - BEAM_NEAR)));
    v.beam.position.copy(m.position);
    v.beam.visible = e.state !== 'dead' && fade > 0;
    (v.beam.material as THREE.MeshBasicMaterial).opacity = BEAM_OPACITY * fade;

    if (e.state === 'dead') {
      v.material.emissiveIntensity = GLOW * 0.5; // the coins on the ground still shine
      showFrame(v, FRAMES.dead, mirror);
      const remaining = tuning.jackalCorpseTime - e.stateTicks / 60;
      if (remaining < 1) m.position.y -= (1 - remaining) * 0.3; // sinks into the ground
      return;
    }
    v.material.emissiveIntensity = GLOW;
    v.hurtTime -= dt;
    const speed = Math.hypot(e.vx, e.vz);
    v.runPhase += speed * dt * FRAMES_PER_METER;
    const step = Math.floor(v.runPhase);
    sounds(v, e, camera, speed, dt);

    if (e.climbTo >= 0) {
      showFrame(v, FRAMES.back.climb[Math.floor(e.climbTicks / 60 / CLIMB_FRAME_TIME) % 2], false);
    } else if (v.hurtTime > 0) {
      showFrame(v, FRAMES.front.hurt, false);
    } else if (e.state === 'taunt' && e.onGround) {
      showFrame(v, FRAMES.front.taunt[Math.floor((e.stateTicks / 60) * TAUNT_FPS) % 2], false);
    } else if (view === 'front') {
      showFrame(v, FRAMES.front.run[step % 4], false);
    } else if (view === 'back') {
      showFrame(v, FRAMES.back.run[step % 4], false);
    } else {
      showFrame(v, !e.onGround ? FRAMES.side.jump : FRAMES.side.run[step % 4], mirror);
    }

    // Gold glinting out of the sack while it runs.
    if (speed > 1) {
      v.glintOwed += GLINTS_PER_SECOND * dt;
      while (v.glintOwed >= 1) {
        v.glintOwed--;
        point.set(m.position.x + (Math.random() - 0.5) * 0.4, m.position.y + 0.9, m.position.z + (Math.random() - 0.5) * 0.4);
        spawnSparks(point, dir.set(-e.vx * 0.05, 1, -e.vz * 0.05).normalize(), 1);
      }
    }
  }

  /** Its voice and its sack: a cackle now and then (more often taunting), a jingle every stride. */
  function sounds(v: JackalView, e: JackalEntity, camera: THREE.Camera, speed: number, dt: number): void {
    v.cackleIn -= dt;
    if (v.cackleIn <= 0) {
      playJackalCackle(soundAt(camera, e.x, e.y + 1, e.z));
      const [min, max] = e.state === 'taunt' ? CACKLE_TAUNT : CACKLE_FLEE;
      v.cackleIn = min + Math.random() * (max - min);
    }
    if (e.onGround) v.jingleMeters += speed * dt;
    if (v.jingleMeters >= JINGLE_EVERY) {
      v.jingleMeters = 0;
      playJackalJingle(soundAt(camera, e.x, e.y + 0.8, e.z));
    }
  }
}
