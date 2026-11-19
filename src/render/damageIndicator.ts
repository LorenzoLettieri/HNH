// Damage direction indicator: when you get hit, a blood-red arc appears
// around the crosshair, on the side the hit came from (top = in front of
// you, bottom = behind you, sides = left/right), and fades out.
// The arc keeps pointing at the place the hit came from while you turn,
// so you can spin around and face whoever hit you.
// Markup: a few .hurt-arc elements created here; CSS in index.html.
import type { PlayerState } from '../sim/player';

// --- Tuning ---
/** How many arcs can be on screen at once (the oldest is reused). */
const MAX_ARCS = 4;
/** Seconds an arc stays at full strength, then seconds to fade out. */
const HOLD = 0.35;
const FADE = 0.8;
/** Damage that makes a full-strength arc (smaller hits are fainter). */
const FULL_DAMAGE = 20;

interface Arc {
  el: HTMLElement;
  x: number; // where the hit came from, world coordinates
  z: number;
  age: number; // seconds since the hit (Infinity = unused)
  strength: number; // 0..1
}

const container = document.getElementById('hurt-arcs')!;
const arcs: Arc[] = [];
for (let i = 0; i < MAX_ARCS; i++) {
  const el = document.createElement('div');
  el.className = 'hurt-arc';
  container.append(el);
  arcs.push({ el, x: 0, z: 0, age: Infinity, strength: 0 });
}

export function addHurtArc(fromX: number, fromZ: number, damage: number): void {
  // Reuse the oldest arc: a fixed pool instead of creating elements on every hit.
  const arc = arcs.reduce((a, b) => (b.age > a.age ? b : a));
  arc.x = fromX;
  arc.z = fromZ;
  arc.age = 0;
  arc.strength = Math.min(1, 0.5 + (0.5 * damage) / FULL_DAMAGE);
}

/**
 * Screen angle of a world point as seen by the player, in radians:
 * 0 = straight ahead (top of the screen), +π/2 = right, ±π = behind.
 */
export function screenAngle(player: PlayerState, x: number, z: number): number {
  const dx = x - player.x;
  const dz = z - player.z;
  // The player's forward and right directions on the ground, from the yaw.
  // Three.js cameras look down -Z when yaw = 0: forward = (-sin, -cos).
  const forward = -dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw);
  const right = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw);
  // atan2(side, ahead): the angle measured from "ahead", clockwise like a clock face.
  return Math.atan2(right, forward);
}

export function updateHurtArcs(player: PlayerState, dt: number): void {
  for (const arc of arcs) {
    if (arc.age === Infinity) continue;
    arc.age += dt;
    const fade = arc.age < HOLD ? 1 : 1 - (arc.age - HOLD) / FADE;
    if (fade <= 0) {
      arc.age = Infinity;
      arc.el.style.opacity = '0';
      continue;
    }
    // Rotate the whole ring element: the arc is drawn at its top, so a
    // rotation of `angle` moves it around the crosshair like a clock hand.
    arc.el.style.transform = `rotate(${screenAngle(player, arc.x, arc.z)}rad)`;
    arc.el.style.opacity = String(fade * arc.strength);
  }
}
