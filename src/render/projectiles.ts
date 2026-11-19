// Draws the enemy projectiles. The eye-bat's fireballs: a small pixel-art
// fireball sprite, extra bright so the bloom makes it glow, leaving a trail
// of embers. The sharpshooter's bullets: a TRACER, a short bright streak
// behind the bullet (at 90 m/s a dot would be invisible: what the eye
// catches is the line it draws). Plus sparks (and a sound) when they hit.
//
// No real light (PointLight) on purpose: in Three.js changing the NUMBER of
// lights in the scene forces every material to recompile its shader, a
// visible hitch every time a fireball appears or disappears. The bloom gives
// the "it glows" feeling for free.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { Projectile } from '../sim/projectiles';
import { playFireballHit, playRicochet } from '../audio/sfx';
import { spawnSparks } from './particles';
import { soundAt } from './soundPosition';

/** Size of the fireball on screen, meters (a bit bigger than its hitbox: it's a warning, it must be seen). */
const SIZE = 0.7;
/** Brightness multiplier (HDR: above 1 = goes into the bloom). */
const BRIGHTNESS = 4;
/** Embers per second left behind. */
const EMBERS_PER_SECOND = 40;
/** Length of a bullet's tracer streak, meters, and its brightness (HDR). */
const TRACER_LENGTH = 4;
const TRACER_BRIGHTNESS = 6;

interface ProjectileView {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  emberDebt: number;
}

interface TracerView {
  line: THREE.Line;
}

export interface ProjectileRenderer {
  update(projectiles: Projectile[], events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number): void;
}

/** A 12×12 fireball: white-hot core, then yellow, orange, and a ragged red edge. */
function fireballTexture(): THREE.CanvasTexture {
  const n = 12;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2);
      // Ragged edge: a little "noise" from the pixel's coordinates.
      const edge = 5.2 + (((x * 7 + y * 13) % 5) - 2) * 0.35;
      if (d > edge) continue;
      g.fillStyle = d < 1.6 ? '#fffbe8' : d < 2.8 ? '#ffd860' : d < 4 ? '#ff8a20' : '#d0300c';
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createProjectileRenderer(scene: THREE.Scene): ProjectileRenderer {
  const texture = fireballTexture();
  const views = new Map<number, ProjectileView>();
  const tracers = new Map<number, TracerView>();
  // One material for every tracer: they all look the same.
  const tracerMaterial = new THREE.LineBasicMaterial({
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false, // a streak of light: visible through the haze
  });
  tracerMaterial.color.setRGB(1, 0.75, 0.35).multiplyScalar(TRACER_BRIGHTNESS);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  return {
    update(projectiles, events, camera, alpha, dt) {
      for (const e of events) {
        if (e.type !== 'projectileHit') continue;
        point.set(e.x, e.y, e.z);
        normal.set(e.nx, e.ny, e.nz);
        if (e.kind === 'bullet') {
          spawnSparks(point, normal, 8);
          // Missed you and hit a wall: the western ricochet. (Hitting you, you hear the hurt sound.)
          if (!e.player) playRicochet(soundAt(camera, e.x, e.y, e.z));
        } else {
          spawnSparks(point, normal, 25);
          playFireballHit(soundAt(camera, e.x, e.y, e.z));
        }
      }

      const seen = new Set<number>();
      for (const p of projectiles) {
        seen.add(p.id);
        if (p.kind === 'bullet') {
          updateTracer(p, alpha);
          continue;
        }
        let v = views.get(p.id);
        if (!v) {
          // A sprite is a quad that always faces the camera (Three.js does the
          // billboarding for us). One material each: it spins on its own.
          const material = new THREE.SpriteMaterial({ map: texture, alphaTest: 0.5 });
          material.color.setScalar(BRIGHTNESS);
          const sprite = new THREE.Sprite(material);
          sprite.scale.setScalar(SIZE);
          scene.add(sprite);
          v = { sprite, material, emberDebt: 0 };
          views.set(p.id, v);
        }
        v.sprite.position.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        // Flicker: spin and pulse a little, like a living flame.
        v.material.rotation += dt * 9;
        v.sprite.scale.setScalar(SIZE * (0.9 + Math.random() * 0.2));

        // Embers falling off behind it, pushed backward along its flight.
        const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
        normal.set(-p.vx / speed, -p.vy / speed, -p.vz / speed);
        v.emberDebt += dt * EMBERS_PER_SECOND;
        while (v.emberDebt >= 1) {
          spawnSparks(v.sprite.position, normal, 1);
          v.emberDebt--;
        }
      }
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.sprite);
        v.material.dispose();
        views.delete(id);
      }
      for (const [id, t] of tracers) {
        if (seen.has(id)) continue;
        scene.remove(t.line);
        t.line.geometry.dispose();
        tracers.delete(id);
      }
    },
  };

  /** A streak from the bullet backward, never longer than the path it has flown (no streak out of the rifle's back). */
  function updateTracer(p: Projectile, alpha: number): void {
    let t = tracers.get(p.id);
    if (!t) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geometry, tracerMaterial);
      line.frustumCulled = false;
      scene.add(line);
      t = { line };
      tracers.set(p.id, t);
      // Where it started: the streak doesn't reach behind this point.
      line.userData.start = [p.px, p.py, p.pz];
    }
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    const z = p.pz + (p.z - p.pz) * alpha;
    const speed = Math.hypot(p.vx, p.vy, p.vz) || 1;
    const [sx, sy, sz] = t.line.userData.start as number[];
    const len = Math.min(TRACER_LENGTH, Math.hypot(x - sx, y - sy, z - sz));
    const pos = t.line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, x - (p.vx / speed) * len, y - (p.vy / speed) * len, z - (p.vz / speed) * len);
    pos.setXYZ(1, x, y, z);
    pos.needsUpdate = true;
  }
}
