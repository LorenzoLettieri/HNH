// Weapon bar, above the ammo (bottom-right): one slot per weapon you carry,
// with its silhouette and the key that selects it (1, 2…). The weapon in
// your hands is lit and underlined, the others are dim.
//
// The silhouettes are pixel art drawn here on tiny canvases, one rectangle
// at a time, and scaled up by CSS without smoothing (image-rendering:
// pixelated), like the rest of the game. Markup is built here; CSS in
// index.html (#weapon-bar, .weapon-slot).
import type { PlayerState } from '../sim/player';
import { heldItem, isMelee, MELEE_KEY, SLOTS, type SlotId } from '../sim/weapon';
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

/** A ring of pixels (the lasso's loops): every pixel whose distance from the center is within half a pixel of r. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      // Distance in "ellipse units": 1 on the ellipse. Within ±half a pixel of it: paint.
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (Math.abs(d - 1) * Math.min(rx, ry) < 0.55) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * One silhouette per slot. A Record keyed by SlotId: adding a weapon to
 * SLOTS without drawing it here is a compile error, not a missing icon.
 */
const SILHOUETTES: Record<SlotId, Silhouette> = {
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
  // Lever-action carbine, 44 × 11: long barrel with the magazine tube under
  // it, the receiver, hammer, the lever's loop, and the stock dropping back.
  rifle: {
    width: 44,
    height: 11,
    draw(ctx) {
      ctx.fillRect(18, 1, 26, 2); // barrel
      ctx.fillRect(43, 0, 1, 1); // front sight
      ctx.fillRect(22, 3, 21, 1); // magazine tube
      ctx.fillRect(18, 3, 8, 2); // fore-end
      ctx.fillRect(11, 1, 8, 5); // receiver
      ctx.fillRect(10, 0, 2, 1); // hammer
      // The lever: a loop under the wrist (a hollow rectangle).
      ctx.fillRect(7, 7, 7, 1);
      ctx.fillRect(7, 9, 7, 1);
      ctx.fillRect(7, 7, 1, 3);
      ctx.fillRect(13, 6, 1, 4);
      // Stock: each row starts further back, so it slants down to the butt.
      for (let y = 2; y < 9; y++) ctx.fillRect(Math.round(1 + (8 - y) * 0.1), y, 11 - Math.max(0, y - 5) * 3, 1);
    },
  },
  // Dynamite launcher, 36 × 13: a short fat barrel, the DRUM full of sticks
  // (a big round block with gaps between the sticks), pistol grip, a
  // stubby stock. Squat on purpose: it reads as "heavy" next to the others.
  dynamite: {
    width: 36,
    height: 13,
    draw(ctx) {
      ctx.fillRect(18, 2, 17, 5); // barrel (fat: a stick goes through it)
      ctx.fillRect(34, 1, 2, 7); // muzzle ring
      ctx.fillRect(9, 0, 11, 10); // drum...
      ctx.clearRect(10, 3, 9, 1); // ...with the sticks showing between its bands
      ctx.clearRect(10, 6, 9, 1);
      ctx.fillRect(4, 3, 6, 5); // frame
      ctx.fillRect(13, 11, 6, 1); // trigger guard
      ctx.fillRect(14, 10, 1, 1); // trigger
      for (let y = 8; y < 13; y++) ctx.fillRect(Math.round(10 - (y - 8) * 0.6), y, 3, 1); // grip
      ctx.fillRect(0, 4, 5, 4); // stock
    },
  },
  // Shovel, 32 × 11: the D-grip, the long shaft, the blade's socket and the pointed blade.
  shovel: {
    width: 32,
    height: 11,
    draw(ctx) {
      ctx.fillRect(0, 3, 1, 5); // D-grip: the bar...
      ctx.fillRect(1, 3, 3, 1); // ...and its loop
      ctx.fillRect(1, 7, 3, 1);
      ctx.fillRect(4, 4, 1, 3);
      ctx.fillRect(5, 5, 15, 1); // shaft
      ctx.fillRect(19, 4, 3, 3); // socket
      // Blade: wide at the socket, a point at the end (each column a bit shorter).
      for (let x = 22; x < 32; x++) {
        const half = x < 28 ? 5 : 5 - (x - 27) * 1.2;
        ctx.fillRect(x, Math.round(5.5 - half), 1, Math.max(1, Math.round(half * 2)));
      }
    },
  },
  // Lasso, 24 × 14: the coil (three loops one over the other) and the open noose with its honda.
  lasso: {
    width: 24,
    height: 14,
    draw(ctx) {
      ring(ctx, 6, 7, 5, 6); // the coil
      ring(ctx, 6.5, 7, 4, 5);
      ctx.fillRect(4, 0, 4, 2); // the tie on top
      ring(ctx, 17, 6, 6, 4.5); // the noose
      ctx.fillRect(11, 3, 2, 2); // the honda
      ctx.fillRect(9, 8, 3, 1); // the rope from the coil to the noose
    },
  },
};

const bar = document.getElementById('weapon-bar')!;
const slots = new Map<SlotId, HTMLElement>();

// Build the slots once, in slot order (= key order).
// (The two melee weapons share key 5: only the one you carry is shown.)
SLOTS.forEach((weapon, i) => {
  const slot = document.createElement('div');
  slot.className = 'weapon-slot';
  const key = document.createElement('span');
  key.className = 'weapon-key';
  key.textContent = String(isMelee(weapon) ? MELEE_KEY : i + 1);
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

let shown = ''; // what the bar shows now: weapon in hand + owned weapons, as one string

export function updateWeaponBar(player: PlayerState): void {
  // Touch the DOM only when something changes (weapon in hand, or a weapon
  // bought / lost at death), not every frame. One string is an easy "key".
  const held = heldItem(player);
  const key = `${held}|${player.melee}|${SLOTS.map((w) => (player.owned[w] ? 1 : 0)).join('')}`;
  if (key === shown) return;
  shown = key;
  for (const [weapon, slot] of slots) {
    slot.classList.toggle('active', weapon === held);
    // A weapon you don't own (yet): no slot. It appears when you buy it.
    // A melee weapon left at the armory's counter: not carried, no slot.
    slot.hidden = !player.owned[weapon] || (isMelee(weapon) && player.melee !== weapon);
  }
}
