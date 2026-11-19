// Draws the sharpshooters: a pixel-art sprite each (sharpshooterSprite.ts),
// a billboard always turned toward the camera around the vertical axis, like
// the ghouls. One view for now, the front: it doesn't walk, and it always
// faces you (it aims at you).
//
// The frame comes from the simulation's state, so the shot cycle
// (src/sim/sharpshooter.ts) is readable from its pose:
//   idle → rifle across the chest, laser off: "not now"
//   aim  → rifle at the shoulder, pointed at you, the aiming eye burning
//   lock → lever thrown (cla-CLACK), then aimed again: MOVE
//   shot → recoil, a muzzle flash, a puff of embers
//   dead → collapses into a pile of bones (the hat stays up for an instant)
//
// And the LASER: a red line from the muzzle along the aim, with a glowing dot
// where it touches a surface. It reads the simulation, it doesn't invent
// anything: the direction is the entity's aim (aimX/Y/Z), and how far the
// line goes is a raycast against the level boxes (the same function the
// bullets use). So what you see is exactly where the bullet will go.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, SharpshooterEntity } from '../../sim/entities';
import type { SimEvent } from '../../sim/events';
import { raycastBoxes } from '../../sim/raycast';
import { muzzlePosition } from '../../sim/sharpshooter';
import type { World } from '../../sim/world';
import { playBoneClatter, playLeverAction, playRifleShot, playSharpshooterAim, type Where } from '../../audio/sfx';
import { addHeightFog } from '../heightFog';
import { spawnSnort } from '../particles';
import { soundAt } from '../soundPosition';
import { FRAMES, FRAME_H, FRAME_W, sharpshooterSheet } from './sharpshooterSprite';

const PIXELS_PER_METER = 32;

// --- Laser tuning ---
/** Brightness at the start of the aim and at its end (HDR: above 1 goes into the bloom). */
const LASER_START = 1.2;
const LASER_END = 2.5;
/** While locked the laser blinks this many times per second, between these two brightnesses. */
const LOCK_BLINK_HZ = 14;
const LOCK_BRIGHT = 5;
const LOCK_DIM = 1.2;
/** Size of the dot on the surface, meters. */
const DOT_SIZE = 0.22;

// --- Animation ---
/** Idle: seconds per frame of the sway (two frames). */
const IDLE_FRAME_TIME = 0.5;
/**
 * At the lock the lever frame shows for this long, seconds: lever down, then
 * up again. The sound's second clack is played at the same moment (it's
 * passed to playLeverAction), so eyes and ears agree.
 */
const LEVER_TIME = 0.13;
/** After a shot: the recoil frame, seconds. */
const RECOIL_TIME = 0.15;
/** Dying: seconds per frame of the collapse (the last frame, the pile, stays). */
const DEATH_FRAME_TIME = 0.1;
/** How long the red tint shows after a hit, seconds. */
const HURT_TIME = 0.12;
/** Glow of the eyes and of the laser in the bore (HDR): calm, at the end of the aim, locked. */
const GLOW_CALM = 1.5;
const GLOW_AIM = 4;
const GLOW_LOCK = 8;
/** Muzzle flash: how long, how big (meters), how bright (HDR). */
const FLASH_TIME = 0.06;
const FLASH_SIZE = 0.8;
const FLASH_BRIGHTNESS = 6;
/** Embers blown out of the barrel by the shot (black powder, from hell). */
const SHOT_EMBERS = 10;
/**
 * Its sounds are warnings from far away (it shoots from up to 55 m): played
 * this much louder than the distance alone would give.
 */
const WARNING_BOOST = 1.6;

interface SharpshooterView {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  laser: THREE.Line;
  laserMaterial: THREE.LineBasicMaterial;
  dot: THREE.Sprite;
  dotMaterial: THREE.SpriteMaterial;
  flash: THREE.Sprite;
  flashMaterial: THREE.SpriteMaterial;
  hurtTime: number;
  recoilTime: number;
  flashTime: number;
  /** Stops the laser's whine (it plays while aiming, and stops early if it gives up). */
  stopWhine: (() => void) | null;
}

export interface SharpshooterRenderer {
  /** `alpha`: interpolation between the previous and current tick (0..1). */
  update(entities: Entity[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

/** A soft round dot, 8×8 pixels: white core, red edge. */
function dotTexture(): THREE.CanvasTexture {
  return pixelTexture(8, (d) => (d > 3.6 ? null : d < 1.5 ? '#ffd0c8' : '#ff2010'));
}

/** A muzzle flash, 9×9 pixels: a white-hot core and four spikes of yellow-orange fire (a star). */
function flashTexture(): THREE.CanvasTexture {
  return pixelTexture(9, (d, dx, dy) => {
    const spike = Math.min(Math.abs(dx), Math.abs(dy)) < 0.6; // on the horizontal or vertical axis
    if (d < 1.2) return '#fffbe8';
    if (d < 2.4) return '#ffd860';
    if (spike && d < 4.6) return d < 3.4 ? '#ffb030' : '#e05010';
    return null;
  });
}

/** A tiny round-ish texture: `paint` gets each pixel's distance from the center (and its offset) and returns a color or nothing. */
function pixelTexture(n: number, paint: (d: number, dx: number, dy: number) => string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2;
      const dy = y + 0.5 - n / 2;
      const color = paint(Math.hypot(dx, dy), dx, dy);
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSharpshooterRenderer(scene: THREE.Scene, world: World): SharpshooterRenderer {
  const sheet = sharpshooterSheet();
  const width = FRAME_W / PIXELS_PER_METER;
  const height = FRAME_H / PIXELS_PER_METER;
  // The quad stands on its bottom edge: the boots are at the origin.
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0);
  const white = new THREE.Color(1, 1, 1);
  const hurtTint = new THREE.Color(1, 0.55, 0.5);
  const dotMap = dotTexture();
  const flashMap = flashTexture();
  const views = new Map<number, SharpshooterView>();
  // Scratch vectors for the particle calls (no new objects every frame).
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function create(): SharpshooterView {
    // Own copies of the textures (same image): each one shows its own frame.
    const map = sheet.color.clone();
    const glowMap = sheet.glow.clone();
    const material = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5, // hard pixel edges, no transparency sorting
      emissive: 0xff2a10, // the eyes and the laser in the bore: red, like the laser
      emissiveMap: glowMap,
      emissiveIntensity: GLOW_CALM,
      roughness: 1,
    });
    addHeightFog(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    // The shadow is drawn from a separate depth render: same texture and alphaTest, or it'd be a rectangle.
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
    scene.add(mesh);

    // The laser: a Line with two points (muzzle, end), updated every frame.
    // A WebGL line is always 1 pixel wide: with our low-resolution render
    // (pixel art) that pixel is chunky, exactly the look we want.
    const laserMaterial = new THREE.LineBasicMaterial({
      color: 0xff1a0a,
      transparent: true,
      blending: THREE.AdditiveBlending, // light adds up: it glows, never darkens
      depthWrite: false,
      // No fog: 40 m away the fog would swallow it. It's a WARNING, it must
      // always read (and a light beam in the haze is what you'd see anyway).
      fog: false,
    });
    const laserGeometry = new THREE.BufferGeometry();
    laserGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const laser = new THREE.Line(laserGeometry, laserMaterial);
    laser.frustumCulled = false; // its bounding box changes every frame: don't let Three.js skip it
    scene.add(laser);
    const dotMaterial = new THREE.SpriteMaterial({ map: dotMap, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const dot = new THREE.Sprite(dotMaterial);
    dot.scale.setScalar(DOT_SIZE);
    scene.add(dot);

    // The muzzle flash: a sprite (always faces the camera), additive, only for a few frames.
    const flashMaterial = new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    flashMaterial.color.setScalar(FLASH_BRIGHTNESS);
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(FLASH_SIZE);
    flash.visible = false;
    scene.add(flash);

    return {
      mesh,
      material,
      map,
      glowMap,
      laser,
      laserMaterial,
      dot,
      dotMaterial,
      flash,
      flashMaterial,
      hurtTime: 0,
      recoilTime: 0,
      flashTime: 0,
      stopWhine: null,
    };
  }

  function showFrame(v: SharpshooterView, frame: number): void {
    v.map.offset.x = frame / sheet.frameCount;
    v.glowMap.offset.x = frame / sheet.frameCount;
  }

  function stopWhine(v: SharpshooterView): void {
    v.stopWhine?.();
    v.stopWhine = null;
  }

  /** A warning heard from afar: louder than plain distance would make it. */
  function warning(where: Where): Where {
    return { volume: Math.min(1, where.volume * WARNING_BOOST), pan: where.pan };
  }

  function onEvent(e: SimEvent, byId: Map<number, Entity>, camera: THREE.Camera): void {
    if (e.type !== 'sharpshooterAim' && e.type !== 'sharpshooterLock' && e.type !== 'sharpshooterShot' && e.type !== 'hit') return;
    const s = byId.get(e.entityId);
    if (!s || s.type !== 'sharpshooter') return;
    const v = views.get(s.id);
    if (!v) return;
    const where = soundAt(camera, s.x, s.y + tuning.sharpshooterMuzzleHeight, s.z);
    if (e.type === 'sharpshooterAim') {
      stopWhine(v); // (never two at once)
      v.stopWhine = playSharpshooterAim(where, tuning.sharpshooterAimTime);
    } else if (e.type === 'sharpshooterLock') {
      stopWhine(v);
      playLeverAction(warning(where), LEVER_TIME);
    } else if (e.type === 'sharpshooterShot') {
      playRifleShot(warning(where));
      v.recoilTime = RECOIL_TIME;
      v.flashTime = FLASH_TIME;
      v.flashMaterial.rotation = Math.random() * Math.PI; // every flash a bit different
      const [mx, my, mz] = muzzlePosition(s);
      point.set(mx, my, mz);
      dir.set(s.aimX, s.aimY, s.aimZ);
      spawnSnort(point, dir, SHOT_EMBERS);
    } else {
      v.hurtTime = HURT_TIME;
      if (e.killed) {
        stopWhine(v);
        playBoneClatter(where);
      }
    }
  }

  function updateLaser(v: SharpshooterView, e: SharpshooterEntity, time: number): void {
    const on = e.state === 'aim' || e.state === 'lock';
    v.laser.visible = on;
    v.dot.visible = false;
    if (!on) return;
    // Brightness = how close the shot is. Aiming: it grows. Locked: it blinks.
    let k: number;
    if (e.state === 'aim') {
      const progress = Math.min(1, e.stateTicks / (tuning.sharpshooterAimTime * 60));
      k = LASER_START + (LASER_END - LASER_START) * progress;
    } else {
      k = Math.sin(time * LOCK_BLINK_HZ * Math.PI * 2) > 0 ? LOCK_BRIGHT : LOCK_DIM;
    }
    v.laserMaterial.color.setRGB(1 * k, 0.1 * k, 0.04 * k);
    v.dotMaterial.color.setScalar(k);

    // From the muzzle (the same point the simulation fires from) along the
    // aim, until it hits a box or reaches the rifle's range.
    const [mx, my, mz] = muzzlePosition(e);
    const range = tuning.sharpshooterRange * 1.5;
    const hit = raycastBoxes(mx, my, mz, e.aimX, e.aimY, e.aimZ, range, world.boxes);
    const len = hit ? hit.distance : range;
    const pos = v.laser.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, mx, my, mz);
    pos.setXYZ(1, mx + e.aimX * len, my + e.aimY * len, mz + e.aimZ * len);
    pos.needsUpdate = true;
    if (hit) {
      // A hair off the surface, so it doesn't flicker inside the wall (z-fighting).
      v.dot.position.set(hit.x + hit.nx * 0.03, hit.y + hit.ny * 0.03, hit.z + hit.nz * 0.03);
      v.dot.visible = true;
    }
  }

  function draw(v: SharpshooterView, e: SharpshooterEntity, camera: THREE.Camera, alpha: number, dt: number, time: number): void {
    const m = v.mesh;
    m.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
    // Cylindrical billboard: turn around Y only, to face the camera.
    m.rotation.y = Math.atan2(camera.position.x - m.position.x, camera.position.z - m.position.z);
    v.hurtTime -= dt;
    v.recoilTime -= dt;
    v.flashTime -= dt;
    v.material.color.copy(v.hurtTime > 0 ? hurtTint : white);
    // The whine belongs to the aim: gave up, locked or dead = silence.
    if (e.state !== 'aim') stopWhine(v);

    const t = e.stateTicks / 60; // seconds in the current state
    if (e.state === 'dead') {
      v.material.emissiveIntensity = 0; // the embers in its eyes go out
      const frames = e.headless ? FRAMES.deathHeadless : FRAMES.death;
      showFrame(v, frames[Math.min(frames.length - 1, Math.floor(t / DEATH_FRAME_TIME))]);
      // In its last second, the pile sinks into the ground before it's removed.
      const remaining = tuning.sharpshooterCorpseTime - t;
      if (remaining < 1) m.position.y -= (1 - remaining) * 0.4;
    } else if (v.recoilTime > 0) {
      showFrame(v, FRAMES.recoil);
      v.material.emissiveIntensity = GLOW_AIM;
    } else if (e.state === 'lock') {
      showFrame(v, t < LEVER_TIME ? FRAMES.lever : FRAMES.aim);
      v.material.emissiveIntensity = GLOW_LOCK;
    } else if (e.state === 'aim') {
      showFrame(v, FRAMES.aim);
      const progress = Math.min(1, t / tuning.sharpshooterAimTime);
      v.material.emissiveIntensity = GLOW_CALM + (GLOW_AIM - GLOW_CALM) * progress;
    } else {
      // Idle: a slow sway, out of step from one skeleton to the next (the id shifts the phase).
      showFrame(v, FRAMES.idle[Math.floor(time / IDLE_FRAME_TIME + e.id * 0.5) % 2]);
      v.material.emissiveIntensity = GLOW_CALM;
    }

    updateLaser(v, e, time);
    v.flash.visible = v.flashTime > 0 && e.state !== 'dead';
    if (v.flash.visible) {
      const [mx, my, mz] = muzzlePosition(e);
      v.flash.position.set(mx, my, mz);
    }
  }

  function remove(id: number, v: SharpshooterView): void {
    stopWhine(v);
    scene.remove(v.mesh, v.laser, v.dot, v.flash);
    v.material.dispose();
    (v.mesh.customDepthMaterial as THREE.Material).dispose();
    v.map.dispose();
    v.glowMap.dispose();
    v.laser.geometry.dispose();
    v.laserMaterial.dispose();
    v.dotMaterial.dispose();
    v.flashMaterial.dispose();
    views.delete(id);
  }

  return {
    update(entities, events, camera, alpha, dt) {
      const time = performance.now() / 1000;
      // Views first (a sharpshooter can start aiming on its very first tick),
      // then the events, then drawing.
      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'sharpshooter') continue;
        seen.add(e.id);
        if (!views.has(e.id)) views.set(e.id, create());
      }
      const byId = new Map(entities.map((e) => [e.id, e]));
      for (const ev of events) onEvent(ev, byId, camera);
      for (const e of entities) {
        if (e.type === 'sharpshooter') draw(views.get(e.id)!, e, camera, alpha, dt, time);
      }
      // Removed from the simulation (old corpses): clean up.
      for (const [id, v] of views) if (!seen.has(id)) remove(id, v);
    },
  };
}
