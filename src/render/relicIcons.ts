// The relics' icons (src/sim/relics.ts): 16 × 16 pixel art, painted in code
// rectangle by rectangle (x right, y down, like a canvas). The SAME picture is
// used twice: in the HUD's row of relics (relicHud.ts) and on the sprite that
// rises out of the coffin (coffin.ts).
//
// Every icon is a dead man's belonging, readable by its shape first:
// a heart, a hide, a powder horn, a belt, a glove, a magnet, a rabbit's foot,
// a vial. The light comes from the upper left, as in every sprite of the game.
//
// THE OUTLINE IS AUTOMATIC: we paint only the object, then every empty pixel
// that touches a painted one (up, down, left or right) becomes the dark
// outline. The same idea as the "stroke" of an image editor, in four lines:
// no need to draw the outline by hand, and it's always one pixel thick.
import * as THREE from 'three';
import type { RelicId } from '../sim/relics';

export const RELIC_ICON_SIZE = 16;

const OUTLINE = [20, 8, 6];

const C = {
  // blood and flesh
  heart: '#a01818',
  heartLight: '#e04838',
  heartDark: '#5a0a0a',
  // brass
  brass: '#c89a40',
  brassLight: '#f0d878',
  brassDark: '#8a6420',
  // leather and hide
  hide: '#b07a48',
  hideLight: '#d8a870',
  hideDark: '#7a4a24',
  stitch: '#f0e0b8',
  // the powder horn
  horn: '#e0d0a8',
  hornDark: '#a8946a',
  powder: '#302820',
  // the belt
  belt: '#6a3a1c',
  beltLight: '#8a5430',
  // the magnet
  red: '#c02018',
  redLight: '#f05040',
  steel: '#c8ccd4',
  steelDark: '#7a7e88',
  // the rabbit's foot
  fur: '#d8d0c0',
  furDark: '#9a9080',
  pink: '#d88890',
  chain: '#a8a8b0',
  // the vial of cold blood
  glass: '#4a6878',
  glassLight: '#b8e0f0',
  blood: '#3070e0',
  bloodLight: '#90d0ff',
  cork: '#8a6038',
};

type Paint = (r: (x: number, y: number, w: number, h: number, color: string) => void) => void;

/** One painter per relic. A relic without one doesn't compile (Record<RelicId, ...>). */
const PAINTERS: Record<RelicId, Paint> = {
  // Cuore del bandito: a heart with a brass bullet stuck in it.
  banditHeart: (r) => {
    r(3, 4, 4, 2, C.heart);
    r(9, 4, 4, 2, C.heart);
    r(2, 5, 12, 4, C.heart);
    r(3, 9, 10, 2, C.heart);
    r(4, 11, 8, 1, C.heart);
    r(5, 12, 6, 1, C.heart);
    r(6, 13, 4, 1, C.heartDark);
    r(7, 14, 2, 1, C.heartDark);
    r(3, 5, 2, 2, C.heartLight); // the shine, upper left
    r(4, 4, 2, 1, C.heartLight);
    r(10, 9, 3, 2, C.heartDark); // the shade, lower right
    r(9, 11, 3, 1, C.heartDark);
    // The bullet, going in from the upper right.
    r(10, 2, 2, 3, C.brass);
    r(10, 2, 1, 3, C.brassLight);
    r(11, 5, 1, 1, C.brassDark);
  },
  // Pelle conciata: a hide stretched flat, with the stitches where it was mended.
  tannedHide: (r) => {
    r(4, 2, 8, 1, C.hide);
    r(2, 3, 12, 10, C.hide);
    r(1, 4, 1, 3, C.hide);
    r(14, 4, 1, 3, C.hide);
    r(1, 9, 1, 3, C.hide);
    r(14, 9, 1, 3, C.hide);
    r(4, 13, 8, 1, C.hide);
    r(3, 3, 4, 3, C.hideLight);
    r(9, 10, 4, 3, C.hideDark);
    // Stitches: a dashed seam across.
    for (let x = 4; x <= 11; x += 2) r(x, 8, 1, 1, C.stitch);
    r(5, 7, 1, 1, C.hideDark);
    r(9, 9, 1, 1, C.hideDark);
  },
  // Polvere fine: a powder horn, curving from the wide end (a wooden plug in a
  // brass rim, upper right) down to the brass spout (lower left), on a leather strap.
  finePowder: (r) => {
    r(10, 1, 5, 2, C.brassDark); // the plug's rim
    r(10, 1, 5, 1, C.brassLight);
    r(9, 3, 6, 4, C.horn); // the horn, narrowing as it curves down
    r(7, 6, 6, 3, C.horn);
    r(5, 8, 5, 3, C.horn);
    r(3, 10, 4, 2, C.horn);
    r(2, 12, 3, 1, C.horn);
    r(9, 3, 1, 3, '#fff4d8'); // the shine
    r(7, 6, 1, 2, '#fff4d8');
    r(13, 4, 2, 3, C.hornDark); // the shade
    r(10, 8, 3, 1, C.hornDark);
    r(7, 10, 3, 1, C.hornDark);
    r(1, 13, 2, 2, C.brass); // the spout
    r(1, 13, 1, 1, C.brassLight);
    for (let i = 0; i < 5; i++) r(4 + i, 6 - i, 1, 1, C.hideDark); // the strap
    r(0, 15, 1, 1, C.powder); // a few grains spilled
    r(3, 15, 1, 1, C.powder);
  },
  // Cinturone del pistolero: a curled belt with a row of cartridges and the buckle.
  gunslingerBelt: (r) => {
    r(1, 7, 14, 4, C.belt);
    r(1, 7, 14, 1, C.beltLight);
    for (let x = 2; x <= 9; x += 2) {
      r(x, 4, 1, 4, C.brass); // the cartridges in their loops
      r(x, 4, 1, 1, C.steel);
    }
    r(11, 6, 4, 6, C.brassDark); // the buckle: a frame...
    r(12, 7, 2, 4, C.belt); // ...with the belt through it
    r(11, 6, 4, 1, C.brassLight);
    r(13, 8, 1, 2, C.steel); // the prong
  },
  // Guanti di daino: a buckskin glove, the fingers up, the cuff fringed.
  buckskinGloves: (r) => {
    r(4, 2, 2, 6, C.hide); // fingers
    r(6, 1, 2, 7, C.hide);
    r(8, 2, 2, 6, C.hide);
    r(10, 3, 2, 5, C.hide);
    r(4, 7, 8, 5, C.hide); // palm
    r(2, 7, 2, 3, C.hide); // thumb
    r(3, 9, 2, 2, C.hide);
    r(4, 2, 1, 5, C.hideLight);
    r(6, 1, 1, 6, C.hideLight);
    r(8, 2, 1, 5, C.hideLight);
    r(10, 9, 2, 3, C.hideDark);
    r(4, 12, 8, 2, C.hideDark); // the cuff
    for (let x = 4; x <= 11; x += 2) r(x, 14, 1, 2, C.hideDark); // fringe
  },
  // Calamita del cercatore: a horseshoe magnet, red with steel tips.
  prospectorMagnet: (r) => {
    r(3, 3, 3, 8, C.red);
    r(10, 3, 3, 8, C.red);
    r(4, 10, 8, 3, C.red);
    r(5, 12, 6, 1, '#7a0c08');
    r(3, 3, 1, 8, C.redLight);
    r(4, 10, 1, 2, C.redLight);
    r(3, 1, 3, 2, C.steel); // the tips
    r(10, 1, 3, 2, C.steel);
    r(5, 1, 1, 2, C.steelDark);
    r(12, 1, 1, 2, C.steelDark);
  },
  // Zampa di coniglio: a lucky rabbit's foot on a little chain.
  rabbitFoot: (r) => {
    r(7, 1, 2, 1, C.chain); // the chain
    r(7, 2, 1, 1, C.chain);
    r(8, 3, 1, 1, C.chain);
    r(6, 4, 4, 2, C.brass); // the cap
    r(6, 4, 1, 2, C.brassLight);
    r(5, 6, 6, 6, C.fur);
    r(4, 8, 8, 5, C.fur);
    r(5, 13, 6, 2, C.fur);
    r(5, 6, 2, 4, '#fffaf0');
    r(9, 10, 3, 4, C.furDark);
    r(5, 14, 1, 1, C.pink); // the toes
    r(7, 15, 1, 1, C.pink);
    r(9, 14, 1, 1, C.pink);
  },
  // Sangue freddo: a vial of blue blood, cork on top, frost on the glass.
  coldBlood: (r) => {
    r(7, 1, 2, 2, C.cork);
    r(6, 3, 4, 2, C.glass); // the neck
    r(4, 5, 8, 9, C.glass);
    r(5, 14, 6, 1, C.glass);
    r(5, 8, 6, 6, C.blood); // the blood inside
    r(5, 8, 6, 1, C.bloodLight);
    r(5, 6, 1, 7, C.glassLight); // the shine on the glass
    r(10, 6, 1, 1, '#ffffff'); // frost
    r(9, 11, 1, 1, '#ffffff');
  },
};

const canvases = new Map<RelicId, HTMLCanvasElement>();

/** The icon of a relic, painted once (copy it with drawImage: the same canvas can't be in two places of the page). */
export function relicIcon(id: RelicId): HTMLCanvasElement {
  let canvas = canvases.get(id);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = RELIC_ICON_SIZE;
  const g = canvas.getContext('2d')!;
  PAINTERS[id]((x, y, w, h, color) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  });
  outline(g);
  canvases.set(id, canvas);
  return canvas;
}

/** A copy of the icon, to put in the page. */
export function relicIconCopy(id: RelicId): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = copy.height = RELIC_ICON_SIZE;
  copy.getContext('2d')!.drawImage(relicIcon(id), 0, 0);
  return copy;
}

/** The icon as a texture with sharp pixels (the sprite over the coffin). */
export function relicTexture(id: RelicId): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(relicIcon(id));
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Every empty pixel next to a painted one (4 neighbours) becomes the dark
 * outline. Read from a COPY of the pixels: deciding on the image we're
 * changing would make the new outline pixels grow more outline (a blob).
 */
function outline(g: CanvasRenderingContext2D): void {
  const n = RELIC_ICON_SIZE;
  const image = g.getImageData(0, 0, n, n);
  const before = new Uint8ClampedArray(image.data);
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && before[(y * n + x) * 4 + 3] > 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (filled(x, y)) continue;
      if (!filled(x - 1, y) && !filled(x + 1, y) && !filled(x, y - 1) && !filled(x, y + 1)) continue;
      const i = (y * n + x) * 4;
      image.data[i] = OUTLINE[0];
      image.data[i + 1] = OUTLINE[1];
      image.data[i + 2] = OUTLINE[2];
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
}
