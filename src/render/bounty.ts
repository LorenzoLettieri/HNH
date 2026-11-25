// La Taglia on screen (the simulation: src/sim/bounty.ts). The outlaw is
// drawn by its own renderer (ghouls.ts, hounds.ts...) like any enemy; here
// only what makes it THE outlaw:
// - a gold SHERIFF'S STAR over its head, with the modifier's color in the
//   middle, the same size on screen at any distance and visible through
//   walls (depthTest off): where to go, like the bells' column of light;
// - "Corazzato": a bubble of blue light around it (a low-poly sphere,
//   additive, plus its wireframe), as bright as the shield is full; it
//   flashes and tinks when a bullet bounces off it, and shatters;
// - "Lesto": a trail of embers behind it when it runs;
// - "Polveriera": a red glow that breathes on its body; when it lights a
//   stick (the warning) the glow moves to its hand, swells and blinks faster
//   and faster, sparks and the hiss of the fuse, then the throw (the stick in
//   flight is drawn by dynamite.ts like yours, its blast by explosions.ts:
//   kind 'bounty');
// - the escape: a puff of smoke where it was, the gallop and the whistle.
//
// It only READS the simulation (game.mapEvent, the entity, the events).
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import { hitBox, type Enemy } from '../sim/entities';
import { bountyEntity, type BountyModifier } from '../sim/bounty';
import { tuning } from '../sim/config';
import {
  playBountyClaimed,
  playBountyShieldBreak,
  playBountyShieldHit,
  playBountyShieldUp,
  playFuseHiss,
  playMatchStrike,
  playStickThrow,
  playOutlawArrived,
  playOutlawEscaped,
  type LoopingSound,
} from '../audio/sfx';
import { spawnSmoke, spawnSnort, spawnSparks } from './particles';
import { soundAt } from './soundPosition';

// --- The star ---
/** Pixels of the star texture (odd: it has a middle pixel). */
const STAR_PX = 15;
/** Size on screen (sizeAttenuation off: fraction of the view at distance 1, ≈ half a screen height per 1). */
const STAR_SIZE = 0.09;
/** Meters above the hitbox, and the bob (m, Hz). */
const STAR_LIFT = 0.5;
const STAR_BOB = 0.12;
const STAR_BOB_HZ = 1.2;
/** The color in the middle of the star, one per modifier. */
const MODIFIER_COLOR: Record<BountyModifier, string> = { swift: '#ff8a20', shielded: '#40b8ff', explosive: '#ff2818' };

// --- "Corazzato" ---
/** The bubble's color (× above 1 = bloom), its size around the hitbox, how fast it turns (rad/s). */
const SHIELD_COLOR = new THREE.Color(0.25, 0.65, 1.6);
const SHIELD_SCALE = 1.2;
const SHIELD_SPIN = 0.6;
/** Opacity of the fill and of the wireframe at full shield; extra on a hit, fading in SHIELD_FLASH_TIME s. */
const SHIELD_FILL = 0.06;
const SHIELD_WIRE = 0.35;
const SHIELD_FLASH = 0.5;
const SHIELD_FLASH_TIME = 0.25;

// --- "Lesto" ---
/** An ember puff every this many seconds, when it moves faster than this (m/s). */
const TRAIL_EVERY = 0.04;
const TRAIL_MIN_SPEED = 2;

// --- "Polveriera" ---
/** The glow on the body: size (m), breaths per second; while it lights a stick: blinks per second from → to. */
const GLOW_SIZE = 1.1;
const GLOW_HZ = 1.5;
const LIT_HZ_FROM = 4;
const LIT_HZ_TO = 14;
/** While it lights a stick the glow swells up to × this, and sparks fly every this many seconds. */
const LIT_SWELL = 1.8;
const LIT_SPARK_EVERY = 0.04;

/** A 15×15 sheriff's star: five points, a gold body with a dark rim, the modifier's color in the middle. */
function starTexture(center: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STAR_PX;
  const g = canvas.getContext('2d')!;
  const mid = (STAR_PX - 1) / 2;
  const outer = mid;
  const inner = mid * 0.45;
  /**
   * Inside the star? In polar coordinates the edge of a star is a radius that
   * goes back and forth between `outer` (a point) and `inner` (between two
   * points) as the angle turns: a "triangle wave" with 5 teeth. Inside = closer
   * to the middle than the edge at that angle.
   */
  const edge = (x: number, y: number) => {
    const a = Math.atan2(x - mid, -(y - mid)); // 0 = straight up: a point on top
    const tooth = ((a / (Math.PI * 2)) * 5 + 100) % 1; // 0..1 along one point
    const t = Math.abs(tooth - 0.5) * 2; // 1 at a point, 0 between two
    return inner + (outer - inner) * t ** 1.4;
  };
  for (let y = 0; y < STAR_PX; y++) {
    for (let x = 0; x < STAR_PX; x++) {
      const d = Math.hypot(x - mid, y - mid);
      const r = edge(x, y);
      if (d > r + 0.5) continue;
      if (d > r - 0.6) g.fillStyle = '#3a2008'; // the rim
      else if (d < 2.1) g.fillStyle = center; // the gem in the middle
      else if (d < 2.9) g.fillStyle = '#7a5010'; // its setting
      else g.fillStyle = (x + y) % 5 === 0 ? '#fff0a0' : x < mid ? '#f0c040' : '#c89020'; // gold, lit from the left
      g.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A soft round glow (white in the middle, transparent at the edge): tinted by the material's color. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

export interface BountyRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, alpha: number, dt: number, time: number): void;
}

export function createBountyRenderer(scene: THREE.Scene): BountyRenderer {
  // Everything built once and hidden (no materials created while playing).
  const stars = {} as Record<BountyModifier, THREE.SpriteMaterial>;
  for (const m of Object.keys(MODIFIER_COLOR) as BountyModifier[]) {
    stars[m] = new THREE.SpriteMaterial({ map: starTexture(MODIFIER_COLOR[m]), transparent: true, fog: false, depthTest: false, sizeAttenuation: false });
  }
  const star = new THREE.Sprite(stars.swift);
  star.renderOrder = 11; // over the enemies, over the "Marchio" sigils
  star.visible = false;
  scene.add(star);

  const shield = new THREE.Group();
  const shieldGeometry = new THREE.IcosahedronGeometry(1, 1); // 80 triangles: low-poly, like the rest
  const fill = new THREE.MeshBasicMaterial({ color: SHIELD_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const wire = new THREE.MeshBasicMaterial({ color: SHIELD_COLOR, wireframe: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  shield.add(new THREE.Mesh(shieldGeometry, fill), new THREE.Mesh(shieldGeometry, wire));
  shield.visible = false;
  scene.add(shield);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(3, 0.5, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.visible = false;
  scene.add(glow);

  let shieldFlash = 0;
  let trailClock = 0;
  let sparkClock = 0;
  let litTime = 0;
  let hiss: LoopingSound | null = null;
  const point = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /** Where the outlaw's body is drawn this frame: between the last two ticks, like the sprites. */
  function bodyAt(e: Enemy, alpha: number, out: THREE.Vector3): { box: ReturnType<typeof hitBox> } {
    const b = hitBox(e);
    const ix = e.px + (e.x - e.px) * alpha - e.x;
    const iy = e.py + (e.y - e.py) * alpha - e.y;
    const iz = e.pz + (e.z - e.pz) * alpha - e.z;
    out.set((b.minX + b.maxX) / 2 + ix, (b.minY + b.maxY) / 2 + iy, (b.minZ + b.maxZ) / 2 + iz);
    return { box: b };
  }

  return {
    update(game, events, camera, alpha, dt, time) {
      const ev = game.mapEvent.active?.kind === 'bounty' ? game.mapEvent.active : null;
      const outlaw = ev ? bountyEntity(ev, game) : null;

      // --- One-off moments, from the events ---
      for (const e of events) {
        if (e.type === 'bountySpawned') playOutlawArrived();
        else if (e.type === 'bountyShield') {
          point.set(e.x, e.y, e.z);
          if (e.up) {
            playBountyShieldUp(soundAt(camera, e.x, e.y, e.z));
            shieldFlash = 1;
          } else {
            playBountyShieldBreak(soundAt(camera, e.x, e.y, e.z));
            spawnSparks(point, up, 40);
          }
        } else if (e.type === 'hit' && outlaw && e.entityId === outlaw.id && e.surface === 'metal') {
          // A bullet that the shield stopped (bounty.ts → gunDamage.ts: 'metal').
          shieldFlash = 1;
          bodyAt(outlaw, 1, point);
          playBountyShieldHit(soundAt(camera, point.x, point.y, point.z));
          spawnSparks(point, dir.set(Math.random() - 0.5, 0.6, Math.random() - 0.5).normalize(), 6);
        } else if (e.type === 'bountyWindup') {
          // The stick lit: a match struck, then the fuse hissing in its hand.
          litTime = 0;
          playMatchStrike(soundAt(camera, e.x, e.y, e.z));
          hiss?.stop();
          hiss = playFuseHiss(soundAt(camera, e.x, e.y, e.z));
        } else if (e.type === 'bountyThrow') {
          // From here the stick hisses on its own (render/dynamite.ts).
          hiss?.stop();
          hiss = null;
          playStickThrow(soundAt(camera, e.x, e.y, e.z));
        } else if (e.type === 'bountyEscaped') {
          point.set(e.x, e.y, e.z);
          spawnSmoke(point, up, 30);
          playOutlawEscaped();
        } else if (e.type === 'mapEventEnd' && e.kind === 'bounty') {
          hiss?.stop();
          hiss = null;
          // The coins burst out of the body on their own (pickups); here the sound of the prize.
          if (e.success) playBountyClaimed({ volume: 0.7, pan: 0 });
        }
      }

      // --- The star: over the living outlaw ---
      const alive = outlaw && outlaw.state !== 'dead' && ev ? outlaw : null;
      star.visible = !!alive;
      if (alive && ev) {
        const { box } = bodyAt(alive, alpha, point);
        star.material = stars[ev.modifier];
        star.position.set(point.x, point.y + (box.maxY - box.minY) / 2 + STAR_LIFT + STAR_BOB * Math.sin(time * STAR_BOB_HZ * Math.PI * 2), point.z);
        star.scale.setScalar(STAR_SIZE);
      }

      // --- "Corazzato": the bubble ---
      shieldFlash = Math.max(0, shieldFlash - dt / SHIELD_FLASH_TIME);
      const shieldLeft = alive && alive.shieldMax ? (alive.shield ?? 0) / alive.shieldMax : 0;
      shield.visible = !!alive && shieldLeft > 0;
      if (alive && shield.visible) {
        const { box } = bodyAt(alive, alpha, point);
        shield.position.copy(point);
        shield.scale.set(((box.maxX - box.minX) / 2) * SHIELD_SCALE, ((box.maxY - box.minY) / 2) * SHIELD_SCALE, ((box.maxZ - box.minZ) / 2) * SHIELD_SCALE);
        shield.rotation.y = time * SHIELD_SPIN;
        // A square root: the bubble stays visible until it's almost gone, then fades fast.
        const strength = Math.sqrt(shieldLeft);
        fill.opacity = SHIELD_FILL * strength + SHIELD_FLASH * shieldFlash * 0.5;
        wire.opacity = SHIELD_WIRE * strength + SHIELD_FLASH * shieldFlash;
      }

      // --- "Lesto": embers behind it ---
      trailClock += dt;
      if (alive && ev?.modifier === 'swift' && trailClock >= TRAIL_EVERY) {
        trailClock = 0;
        const speed = Math.hypot(alive.x - alive.px, alive.z - alive.pz) * 60; // meters per tick × ticks per second
        if (speed > TRAIL_MIN_SPEED) {
          bodyAt(alive, alpha, point);
          dir.set(alive.px - alive.x, 0.3, alive.pz - alive.z).normalize(); // backwards
          spawnSnort(point, dir, 2);
        }
      }

      // --- "Polveriera": the glow on its body, in its hand while a stick is lit ---
      const lit = alive && (alive.throwWindup ?? 0) > 0 ? alive : null;
      if (lit) {
        litTime += dt;
        const t = Math.min(1, litTime / Math.max(0.05, tuning.bountyThrowWindup));
        // The blinking speeds up: the phase is the INTEGRAL of the frequency
        // (from → to in a straight line: the area of a trapezoid). Using
        // frequency × time directly would make the blinks jump around.
        const phase = LIT_HZ_FROM * litTime + ((LIT_HZ_TO - LIT_HZ_FROM) * litTime * t) / 2;
        const on = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
        const { box } = bodyAt(lit, alpha, point);
        point.y = Math.max(point.y, box.maxY - 0.3); // the raised hand, like the simulation's throwPoint
        glow.visible = true;
        glow.position.copy(point);
        glow.scale.setScalar(GLOW_SIZE * (1 + (LIT_SWELL - 1) * t) * (0.7 + 0.3 * on));
        glow.material.opacity = 0.4 + 0.6 * on;
        sparkClock += dt;
        if (sparkClock >= LIT_SPARK_EVERY) {
          sparkClock = 0;
          spawnSparks(point, up, 3);
        }
        hiss?.move(soundAt(camera, point.x, point.y, point.z));
      } else if (alive && ev?.modifier === 'explosive') {
        bodyAt(alive, alpha, point);
        const on = 0.5 + 0.5 * Math.cos(time * GLOW_HZ * Math.PI * 2);
        glow.visible = true;
        glow.position.copy(point);
        glow.scale.setScalar(GLOW_SIZE * (0.8 + 0.2 * on));
        glow.material.opacity = 0.25 + 0.5 * on;
      } else {
        glow.visible = false;
      }
      // Killed (or gone) with a stick lit in its hand: the hiss stops with it.
      if (!lit && hiss) {
        hiss.stop();
        hiss = null;
      }
    },
  };
}
