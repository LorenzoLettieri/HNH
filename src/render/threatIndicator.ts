// Threat warnings: when an enemy OUTSIDE your view is about to attack you,
// a burning chevron appears on a ring around the crosshair, on its side,
// and blinks until the attack is over (or you turn and see the enemy).
// It's the other half of damageIndicator.ts: that one says where a hit
// CAME from, this one where a hit is ABOUT TO come from.
//
// Which enemy is "winding up" comes straight from its state machine in the
// simulation (we only read the state, never change it):
//   ghoul    'lunge'           crouching and leaping at you
//   eyebat   'charge'          charging a fireball
//   hound    'charge'          running at you after the howl
//   bull     'aim' / 'charge'  pawing the ground and aiming, then charging
//
// Markup: .threat elements created here; CSS in index.html.
import * as THREE from 'three';
import type { Entity } from '../sim/entities';
import type { PlayerState } from '../sim/player';
import { screenAngle } from './damageIndicator';

// --- Tuning ---
/** How many warnings can be on screen at once. */
const MAX_THREATS = 6;
/**
 * How far inside the screen edge an enemy must be to count as "seen", in
 * normalized screen units (1 = the edge): an enemy right at the edge is easy to miss.
 */
const SEEN_MARGIN = 0.85;
/** How fast a warning fades in and out (opacity per second). */
const FADE_SPEED = 8;

/** Is this enemy winding up (or running) an attack at the player right now? */
function isThreat(e: Entity): boolean {
  switch (e.type) {
    case 'ghoul':
      return e.state === 'lunge';
    case 'eyebat':
      return e.state === 'charge';
    case 'hound':
      return e.state === 'charge';
    case 'bull':
      return e.state === 'aim' || (e.state === 'charge' && !e.chargeHit);
    default:
      return false;
  }
}

interface Warning {
  el: HTMLElement;
  id: number; // entity id (-1 = free)
  opacity: number;
  wanted: boolean; // still a threat this frame
}

const container = document.getElementById('threats')!;
const warnings: Warning[] = [];
for (let i = 0; i < MAX_THREATS; i++) {
  const el = document.createElement('div');
  el.className = 'threat';
  el.append(document.createElement('i')); // the chevron (CSS clip-path)
  container.append(el);
  warnings.push({ el, id: -1, opacity: 0, wanted: false });
}

const projected = new THREE.Vector3(); // reused every time: no garbage

/**
 * Where on screen an enemy is, as an angle around the crosshair
 * (0 = up, +π/2 = right), or null if it's on screen and you can see it.
 */
function offscreenAngle(e: Entity, player: PlayerState, camera: THREE.Camera): number | null {
  // Project the enemy's middle onto the screen, the same math Three.js uses
  // to draw it: world → camera → "normalized device coordinates", where the
  // visible screen is -1..1 on x and y. z > 1 means it's BEHIND the camera
  // (the projection flips it, so its x/y would lie).
  projected.set(e.x, e.y + 1, e.z).project(camera);
  const behind = projected.z > 1;
  if (!behind && Math.abs(projected.x) < SEEN_MARGIN && Math.abs(projected.y) < SEEN_MARGIN) return null;
  // In front but off screen (e.g. high above you): the direction on the
  // screen is exact, up included. Behind: only the direction on the ground
  // makes sense (the same angle as the hit arcs).
  if (!behind) return Math.atan2(projected.x, projected.y);
  return screenAngle(player, e.x, e.z);
}

export function updateThreats(entities: Entity[], player: PlayerState, camera: THREE.Camera, dt: number): void {
  for (const w of warnings) w.wanted = false;
  // The camera was just moved this frame: refresh its matrices (normally the
  // renderer does it when drawing, which comes later), or we'd project with
  // last frame's view.
  camera.updateMatrixWorld();

  for (const e of entities) {
    if (!isThreat(e)) continue;
    const angle = offscreenAngle(e, player, camera);
    if (angle === null) continue; // you can see it: no warning needed
    // Its warning: the one it already had, or a free one.
    const w = warnings.find((w) => w.id === e.id) ?? warnings.find((w) => w.id === -1 && w.opacity <= 0);
    if (!w) continue; // all busy
    w.id = e.id;
    w.wanted = true;
    // Rotate the ring element: the chevron sits at its top, like a clock hand.
    w.el.style.transform = `rotate(${angle}rad)`;
  }

  for (const w of warnings) {
    // Fade in when wanted, out when not; free the slot once invisible.
    w.opacity = Math.max(0, Math.min(1, w.opacity + (w.wanted ? 1 : -1) * FADE_SPEED * dt));
    if (!w.wanted && w.opacity === 0) w.id = -1;
    w.el.style.opacity = String(w.opacity);
  }
}
