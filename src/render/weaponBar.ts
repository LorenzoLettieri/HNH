// Weapon bar, above the ammo (bottom-right): one slot per weapon you carry,
// with its silhouette and the key that selects it (1, 2…). The weapon in
// your hands is lit and underlined, the others are dim.
//
// The silhouettes are pixel art drawn here on tiny canvases, one rectangle
// at a time, and scaled up by CSS without smoothing (image-rendering:
// pixelated), like the rest of the game. Markup is built here; CSS in
// index.html (#weapon-bar, .weapon-slot).
import type { PlayerState } from '../sim/player';
import { WEAPONS, type WeaponId } from '../sim/weapon';
import './fonts'; // the key numbers are written in Rye

/** Silhouette color (bone, like the HUD numbers); the CSS dims the inactive ones. */
const INK = '#d8c8a8';
/** How much the silhouettes are scaled up on screen. */
const SCALE = 2;

interface Silhouette {
  width: number;
  height: number;
  /** Paints the weapon, facing right, with fillRect(x, y, w, h) in pixels. */
  draw(ctx: CanvasRenderingContext2D): void;
}

/**
 * One silhouette per weapon. A Record keyed by WeaponId: adding a weapon to
 * WEAPONS without drawing it here is a compile error, not a missing icon.
 */
const SILHOUETTES: Record<WeaponId, Silhouette> = {
  // Revolver, 24 × 13: barrel, cylinder, frame, hammer, trigger guard, slanted grip.
  revolver: {
    width: 24,
    height: 13,
    draw(ctx) {
      ctx.fillRect(9, 2, 14, 3); // barrel
      ctx.fillRect(22, 1, 1, 1); // front sight
      ctx.fillRect(4, 1, 6, 5); // frame
      ctx.fillRect(8, 2, 7, 5); // cylinder (wider than the barrel)
      ctx.fillRect(3, 0, 2, 2); // hammer
      ctx.fillRect(8, 8, 5, 1); // trigger guard, bottom
      ctx.fillRect(12, 7, 1, 1); // trigger guard, front
      ctx.fillRect(10, 7, 1, 1); // trigger
      // Grip: each row a bit further back, so it slants like a real one.
      for (let y = 6; y < 13; y++) ctx.fillRect(Math.round(5 - (y - 6) * 0.6), y, 4, 1);
    },
  },
  // Sawed-off double barrel, 34 × 10: two stacked barrels, the action, two hammers, pistol grip.
  shotgun: {
    width: 34,
    height: 10,
    draw(ctx) {
      ctx.fillRect(12, 1, 22, 4); // the two barrels...
      ctx.clearRect(14, 3, 20, 1); // ...with a seam between them
      ctx.fillRect(6, 1, 7, 5); // action
      ctx.fillRect(6, 0, 2, 1); // hammers
      ctx.fillRect(9, 0, 2, 1);
      ctx.fillRect(9, 6, 4, 1); // trigger guard
      ctx.fillRect(10, 5, 1, 1); // trigger
      for (let y = 5; y < 10; y++) ctx.fillRect(Math.round(6 - (y - 5) * 0.8), y, 4, 1); // grip
    },
  },
};

const bar = document.getElementById('weapon-bar')!;
const slots = new Map<WeaponId, HTMLElement>();

// Build the slots once, in slot order (= key order).
WEAPONS.forEach((weapon, i) => {
  const slot = document.createElement('div');
  slot.className = 'weapon-slot';
  const key = document.createElement('span');
  key.className = 'weapon-key';
  key.textContent = String(i + 1);
  const sil = SILHOUETTES[weapon];
  const canvas = document.createElement('canvas');
  canvas.width = sil.width;
  canvas.height = sil.height;
  canvas.style.width = `${sil.width * SCALE}px`;
  canvas.style.height = `${sil.height * SCALE}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = INK;
  sil.draw(ctx);
  slot.append(key, canvas);
  bar.append(slot);
  slots.set(weapon, slot);
});

let shown: WeaponId | null = null;

export function updateWeaponBar(player: PlayerState): void {
  // Touch the DOM only when the weapon changes, not every frame.
  if (player.weapon === shown) return;
  shown = player.weapon;
  for (const [weapon, slot] of slots) slot.classList.toggle('active', weapon === shown);
}
