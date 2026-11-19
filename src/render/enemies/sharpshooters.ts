// Draws the sharpshooters. For now a PLACEHOLDER made of boxes (bone body,
// skull, hat, rifle): the pixel-art sprite comes in the next step. What's
// already final is the LASER: a red line from the muzzle along the aim,
// with a glowing dot where it touches a surface.
//
// The laser reads the simulation, it doesn't invent anything: the direction
// is the entity's aim (aimX/Y/Z), and how far the line goes is a raycast
// against the level boxes (the same function the bullets use). So what you
// see is exactly where the bullet will go.
import * as THREE from 'three';
import { tuning } from '../../sim/config';
import type { Entity, SharpshooterEntity } from '../../sim/entities';
import { raycastBoxes } from '../../sim/raycast';
import { muzzlePosition } from '../../sim/sharpshooter';
import type { World } from '../../sim/world';
import { addHeightFog } from '../heightFog';

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
/** How quickly the corpse falls over (radians per second). */
const FALL_SPEED = 6;

interface SharpshooterView {
  body: THREE.Group;
  head: THREE.Group;
  rifle: THREE.Group;
  laser: THREE.Line;
  laserMaterial: THREE.LineBasicMaterial;
  dot: THREE.Sprite;
  dotMaterial: THREE.SpriteMaterial;
  fallAngle: number;
}

export interface SharpshooterRenderer {
  update(entities: Entity[], camera: THREE.Camera, alpha: number, dt: number): void;
}

/** A soft round dot, 8×8 pixels: white core, red edge. */
function dotTexture(): THREE.CanvasTexture {
  const n = 8;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext('2d')!;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2);
      if (d > 3.6) continue;
      g.fillStyle = d < 1.5 ? '#ffd0c8' : '#ff2010';
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
  const bone = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 1 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.5 });
  for (const m of [bone, leather, iron]) addHeightFog(m);
  const dotMap = dotTexture();
  const views = new Map<number, SharpshooterView>();

  function part(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  }

  function create(): SharpshooterView {
    // The body group turns around Y to face where it aims; its local +Z is "forward".
    const body = new THREE.Group();
    body.rotation.order = 'YXZ'; // turn first, then fall over (around its own X)
    body.add(part(bone, 0.12, 0.85, 0.12, -0.12, 0.42, 0)); // legs
    body.add(part(bone, 0.12, 0.85, 0.12, 0.12, 0.42, 0));
    body.add(part(bone, 0.44, 0.6, 0.22, 0, 1.15, 0)); // ribcage
    const head = new THREE.Group(); // skull + hat: hidden after a headshot
    head.add(part(bone, 0.26, 0.28, 0.26, 0, 1.6, 0));
    head.add(part(leather, 0.62, 0.04, 0.62, 0, 1.76, 0)); // brim
    head.add(part(leather, 0.3, 0.2, 0.3, 0, 1.88, 0)); // crown
    body.add(head);
    // The rifle pivots up/down at the shoulder (its own group, inside the body).
    const rifle = new THREE.Group();
    rifle.position.set(0, tuning.sharpshooterMuzzleHeight, 0);
    rifle.add(part(iron, 0.06, 0.08, 0.95, 0, 0, 0.1));
    body.add(rifle);
    scene.add(body);

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

    return { body, head, rifle, laser, laserMaterial, dot, dotMaterial, fallAngle: 0 };
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

  return {
    update(entities, _camera, alpha, dt) {
      const time = performance.now() / 1000;
      const seen = new Set<number>();
      for (const e of entities) {
        if (e.type !== 'sharpshooter') continue;
        seen.add(e.id);
        let v = views.get(e.id);
        if (!v) {
          v = create();
          views.set(e.id, v);
        }
        v.body.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
        // Turn to face the aim. Rotating around Y by θ takes local +Z to
        // (sin θ, 0, cos θ): so θ = atan2(x, z) of the direction we want.
        v.body.rotation.y = Math.atan2(e.aimX, e.aimZ);
        // Rifle pitch: rotating around X by φ takes +Z to (0, −sin φ, cos φ).
        v.rifle.rotation.x = -Math.asin(Math.max(-1, Math.min(1, e.aimY)));
        v.head.visible = !e.headless;
        if (e.state === 'dead') {
          v.fallAngle = Math.min(Math.PI / 2, v.fallAngle + dt * FALL_SPEED);
          v.body.rotation.x = -v.fallAngle; // falls backward
        } else {
          v.body.rotation.x = 0;
        }
        updateLaser(v, e, time);
      }
      // Removed from the simulation (old corpses): clean up.
      for (const [id, v] of views) {
        if (seen.has(id)) continue;
        scene.remove(v.body, v.laser, v.dot);
        v.body.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        v.laser.geometry.dispose();
        v.laserMaterial.dispose();
        v.dotMaterial.dispose();
        views.delete(id);
      }
    },
  };
}
