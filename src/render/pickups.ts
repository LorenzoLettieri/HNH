// Draws the pickups on the ground: a pixel-art sprite (see pickupSprites.ts)
// floating and bobbing above a soft pool of colored light on the floor, so
// you spot them from far away even at night. In the last seconds before
// vanishing they blink. Plus nothing else: the pickup sound and the screen
// flash are in hud.ts (they're about YOU collecting it, not about the object).
import * as THREE from 'three';
import type { Pickup, PickupKind } from '../sim/pickups';
import { TICK_DT } from '../sim/config';
import { addHeightFog } from './heightFog';
import { PICKUP_FRAME, PICKUP_FRAMES, pickupSheet } from './pickupSprites';

/** Sprite size: pixels per meter (the enemies use 32; a bit bigger here: they must be noticed). */
const PIXELS_PER_METER = 26;
/** Height of the sprite's bottom above the floor, and how much it bobs up and down, meters. */
const HOVER = 0.15;
const BOB = 0.08;
/** Glow of the shiny parts (HDR: above 1 goes into the bloom), and how much it pulses. */
const GLOW = 1.6;
const GLOW_PULSE = 0.5;
/** The pool of light on the floor: radius (meters) and strength. */
const POOL_RADIUS = 0.8;
const POOL_STRENGTH = 0.55;
/** Seconds before vanishing in which it blinks (the warning: hurry up). */
const BLINK_TIME = 3;
/** Color of the pool of light under each kind: brass, red-orange, green, gold. */
const GLOW_COLORS: Record<PickupKind, number> = { bullets: 0xffc040, shells: 0xff5020, medkit: 0x40ff60, coin: 0xffb020 };
/** Coins: how fast they spin (turns per second), and their pool of light is smaller (they come in piles). */
const COIN_SPIN = 0.8;
const COIN_POOL = 0.5;

interface PickupView {
  sprite: THREE.Mesh;
  pool: THREE.Mesh;
}

export interface PickupRenderer {
  update(pickups: Pickup[], camera: THREE.Camera, time: number): void;
}

/**
 * A round, soft spot: white in the middle fading to transparent at the edge.
 * Drawn with a canvas radial gradient (the same API you'd use on a web page).
 * It's the one non-pixelated texture here: light has no hard edges.
 */
function poolTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  return new THREE.CanvasTexture(canvas);
}

export function createPickupRenderer(scene: THREE.Scene): PickupRenderer {
  const sheet = pickupSheet();
  const size = PICKUP_FRAME / PIXELS_PER_METER;
  // The quad's origin at its bottom center (translate the geometry up by half):
  // so mesh.position.y is where the bottom of the sprite is.
  const spriteGeometry = new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0);
  // The pool lies flat on the floor: rotate the quad from vertical to horizontal.
  const poolGeometry = new THREE.PlaneGeometry(POOL_RADIUS * 2, POOL_RADIUS * 2).rotateX(-Math.PI / 2);
  const pool = poolTexture();

  // ONE material per kind, shared by all the pickups of that kind (not one
  // per pickup like the enemies: pickups don't animate individually, so they
  // can share). Each has its own copy of the sheet, shifted to its frame.
  const spriteMaterials = {} as Record<PickupKind, THREE.MeshStandardMaterial>;
  const poolMaterials = {} as Record<PickupKind, THREE.MeshBasicMaterial>;
  for (const kind of Object.keys(PICKUP_FRAMES) as PickupKind[]) {
    const map = sheet.color.clone();
    const glowMap = sheet.emissive.clone();
    map.offset.x = glowMap.offset.x = PICKUP_FRAMES[kind] / sheet.frameCount;
    spriteMaterials[kind] = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.5,
      // White × the emissive texture = each pixel emits its own color (dimmed,
      // except the glowing ones: see pickupSheet). Readable in the dark.
      emissive: 0xffffff,
      emissiveMap: glowMap,
      emissiveIntensity: GLOW,
      roughness: 1,
    });
    addHeightFog(spriteMaterials[kind]);
    // ADDITIVE blending: the pool's color is ADDED to what's behind it, like
    // real light (it can only brighten the floor, never darken it).
    // depthWrite off: a transparent light must not hide things behind it.
    poolMaterials[kind] = new THREE.MeshBasicMaterial({
      map: pool,
      color: new THREE.Color(GLOW_COLORS[kind]).multiplyScalar(POOL_STRENGTH),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  // One view per pickup id (same pattern as the enemies): create the new
  // ones, remove the ones no longer in the list.
  const views = new Map<number, PickupView>();

  return {
    update(pickups, camera, time) {
      // The glow pulses, same rhythm for everyone (the material is shared).
      const pulse = GLOW * (1 + GLOW_PULSE * Math.sin(time * 4));
      for (const m of Object.values(spriteMaterials)) m.emissiveIntensity = pulse;

      const alive = new Set<number>();
      for (const d of pickups) {
        alive.add(d.id);
        let v = views.get(d.id);
        if (!v) {
          v = {
            sprite: new THREE.Mesh(spriteGeometry, spriteMaterials[d.kind]),
            pool: new THREE.Mesh(poolGeometry, poolMaterials[d.kind]),
          };
          if (d.kind === 'coin') v.pool.scale.setScalar(COIN_POOL);
          scene.add(v.sprite, v.pool);
          views.set(d.id, v);
        }
        // The phase is offset by the id, so two drops side by side don't bob in sync.
        v.sprite.position.set(d.x, d.y + HOVER + (1 + Math.sin(time * 3 + d.id)) * BOB, d.z);
        // CYLINDRICAL billboard (Doom's items): turn only around the vertical
        // axis to face the camera. Looking down from a roof you see it
        // upright, not lying flat like a fully camera-facing sprite would.
        // atan2 of the camera's offset gives the angle to turn to.
        v.sprite.rotation.y = Math.atan2(camera.position.x - d.x, camera.position.z - d.z);
        // The coin SPINS, the classic arcade trick: no 3D model, just squash
        // the sprite horizontally with cos(). At 0 it's edge-on, at ±1 face-on
        // (at -1 mirrored: the back of the coin). Never quite 0: a coin seen
        // edge-on is still a thin line, it doesn't vanish.
        if (d.kind === 'coin') {
          const c = Math.cos((time * COIN_SPIN + d.id * 0.37) * Math.PI * 2);
          v.sprite.scale.x = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
        }
        v.pool.position.set(d.x, d.y + 0.02, d.z); // just above the floor: no z-fighting
        // Blinking: on/off 8 times a second in the last BLINK_TIME seconds.
        const visible = d.ticksLeft * TICK_DT > BLINK_TIME || Math.floor(time * 8) % 2 === 0;
        v.sprite.visible = v.pool.visible = visible;
      }
      for (const [id, v] of views) {
        if (alive.has(id)) continue;
        scene.remove(v.sprite, v.pool);
        views.delete(id);
      }
    },
  };
}
