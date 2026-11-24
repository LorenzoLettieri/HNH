// La Taglia's WANTED poster (the simulation: src/sim/bounty.ts). When the
// event is drawn, a poster slides in on the left of the screen: RICERCATO,
// VIVO O MORTO, a mugshot, the outlaw's name, what it is and its modifier,
// what the modifier means for you, and the bounty. It stays until a few
// seconds after the outlaw shows up in town, then slides away (the HUD line
// under the wave keeps the name and the distance).
//
// The MUGSHOT is the enemy's own sprite, the first frame of its sprite sheet
// (the same canvas the 3D sprites use), cropped around the head and turned
// into "printer's ink": every pixel's brightness picks one of a few sepia
// tones, like an old engraving. Different enemies, different faces, zero new art.
//
// Markup and style in index.html (#bounty-poster); it only reads the simulation.
import type { GameState } from '../sim/game';
import type { BountyEvent, BountyTarget } from '../sim/bounty';
import { tuning } from '../sim/config';
import { outlawName } from '../randomName';
import { BOUNTY_MODIFIER_TEXT, BOUNTY_TARGET_TEXT } from './mapEventText';
import type { SpriteSheet } from './enemies/spriteSheet';
import { ghoulSheet } from './enemies/ghoulSprite';
import { eyebatSheet } from './enemies/eyebatSprite';
import { houndSheet } from './enemies/houndSprite';
import { bullSheet } from './enemies/bullSprite';
import { sharpshooterSheet } from './enemies/sharpshooterSprite';

/** Seconds the poster stays after the outlaw shows up (it's already up during the bounty's delay). */
const STAY_AFTER_SPAWN = 4;
/** The ink: from the darkest to the lightest tone (the paper shows where the sprite is transparent). */
const INK = [[34, 18, 6], [80, 46, 18], [128, 84, 40], [176, 132, 80]];

const SHEETS: Record<BountyTarget, () => SpriteSheet> = {
  ghoul: ghoulSheet,
  eyebat: eyebatSheet,
  hound: houndSheet,
  bull: bullSheet,
  sharpshooter: sharpshooterSheet,
};

const root = document.getElementById('bounty-poster')!;
const portrait = root.querySelector('canvas')!;
const nameEl = root.querySelector<HTMLElement>('.bp-name')!;
const kindEl = root.querySelector<HTMLElement>('.bp-kind')!;
const ruleEl = root.querySelector<HTMLElement>('.bp-rule')!;
const rewardEl = root.querySelector<HTMLElement>('.bp-reward')!;

/**
 * The mugshot: frame 0 of the enemy's sprite sheet, cropped to a square
 * around the top of its silhouette (the head and shoulders of a standing
 * enemy, the whole body of a low, wide one), in ink tones.
 */
function paintPortrait(target: BountyTarget): void {
  const sheet = SHEETS[target]();
  const image = sheet.color.image as HTMLCanvasElement;
  const fw = Math.floor(image.width / sheet.frameCount);
  const fh = image.height;
  const src = image.getContext('2d')!.getImageData(0, 0, fw, fh);
  // The bounding box of the opaque pixels: where the enemy actually is in its frame.
  let minX = fw;
  let minY = fh;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      if (src.data[(y * fw + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  // A square: as wide as the body (plus a margin), from the top of it down.
  // A tall enemy gets cut at the chest: a mugshot.
  const side = Math.max(bw + 4, Math.min(bh + 4, Math.round(bw * 1.15)));
  const left = Math.round((minX + maxX) / 2 - side / 2);
  const top = minY - 2;
  portrait.width = portrait.height = side;
  const ctx = portrait.getContext('2d')!;
  const out = ctx.createImageData(side, side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= fw || sy >= fh) continue;
      const i = (sy * fw + sx) * 4;
      if (src.data[i + 3] === 0) continue;
      // Brightness (the eye's weights for red, green, blue), stretched a bit
      // so dark sprites still use the light tones, then one of the ink tones.
      const lum = (0.3 * src.data[i] + 0.59 * src.data[i + 1] + 0.11 * src.data[i + 2]) / 255;
      const tone = INK[Math.min(INK.length - 1, Math.floor(Math.min(1, lum * 1.8) * INK.length))];
      const o = (y * side + x) * 4;
      out.data.set([tone[0], tone[1], tone[2], 255], o);
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Fills the poster for this bounty (only when a new one is posted). */
function fill(ev: BountyEvent): void {
  paintPortrait(ev.target);
  const mod = BOUNTY_MODIFIER_TEXT[ev.modifier];
  nameEl.textContent = outlawName(ev.nameSeed);
  kindEl.innerHTML = `${BOUNTY_TARGET_TEXT[ev.target]} · <b>${mod.name}</b>`;
  ruleEl.textContent = mod.rule;
  // The coins that burst out of it × what a coin is worth with no style (the style multiplies it).
  rewardEl.textContent = `TAGLIA: ${tuning.bountyCoins * tuning.coinValue} VILDENARO`;
}

export function createBountyPoster() {
  /** Which bounty is on the poster (wave + name: a new bounty = a new poster). */
  let shownKey = '';
  /** Seconds since the outlaw showed up (-1 = not yet). */
  let sinceSpawn = -1;
  return {
    update(game: GameState, dt: number): void {
      const ev = game.mapEvent.active?.kind === 'bounty' ? game.mapEvent.active : null;
      if (!ev) {
        root.classList.remove('shown');
        shownKey = '';
        return;
      }
      const key = `${ev.wave}:${ev.nameSeed}`;
      if (key !== shownKey) {
        shownKey = key;
        sinceSpawn = -1;
        fill(ev);
      }
      if (ev.phase !== 'posted' && sinceSpawn < 0) sinceSpawn = 0;
      if (sinceSpawn >= 0) sinceSpawn += dt;
      root.classList.toggle('shown', sinceSpawn < STAY_AFTER_SPAWN);
    },
  };
}
