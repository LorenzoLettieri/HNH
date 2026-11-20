// Doors and windows: pictures on the walls (World.decals). The buildings are solid
// boxes; these flat pictures, a hair in front of the walls, make them read as houses.
// Like the boxes, all the decals showing the same picture are merged into one mesh
// (quadBatch.ts): about twenty draw calls for every door and window in town.
import * as THREE from 'three';
import type { Decal, DecalLook } from '../sim/world';
import { addHeightFog } from './heightFog';
import { QuadBatch, SIDES } from './quadBatch';

const BASE = import.meta.env.BASE_URL;

/** How a decal look is drawn: which picture (a file in public/textures/) and how. */
interface DecalDef {
  file: string;
  /**
   * Fill the transparent pixels ENCLOSED by the picture (between the bars, inside
   * a frame) with a color: 'dark' = an unlit room, 'lit' = a lit room (it glows).
   * Without it they stay transparent and show the wall behind: right for a frame
   * around a real opening, wrong for a barred window on a solid wall.
   */
  fill?: 'dark' | 'lit';
  /** The bright pixels (lit glass) glow: they don't need light to be seen, and they bloom. */
  glow?: boolean;
}

/** Which picture each decal look uses. Change a file name here to change it everywhere. */
const DECALS: Record<DecalLook, DecalDef> = {
  door: { file: 'door_wood_handle' },
  doorPlain: { file: 'door_wood' },
  doorLit: { file: 'door_wood_window_lit', glow: true },
  doorGate: { file: 'door_metal_gate_lock', fill: 'dark' },
  doorway: { file: 'door_wood_frame', fill: 'dark' }, // an open door on a dark room
  doorFrame: { file: 'door_wood_frame' },
  windowFrame: { file: 'window_square_frame' },
  window: { file: 'window_square_divided' },
  windowLit: { file: 'window_square_divided_lit', glow: true },
  windowBoarded: { file: 'window_square_divided_boarded' },
  windowTall: { file: 'window_tall_divided' },
  windowTallLit: { file: 'window_tall_divided_lit', glow: true },
  windowTallBroken: { file: 'window_tall_divided_damaged' },
  windowArched: { file: 'window_tall_rounded' },
  windowArchedLit: { file: 'window_tall_rounded_lit', glow: true },
  windowArchedBroken: { file: 'window_tall_rounded_damaged' },
  windowRound: { file: 'window_round_divided' },
  windowRoundLit: { file: 'window_round_divided_lit', glow: true },
  windowRoundBoarded: { file: 'window_round_divided_boarded' },
  windowBars: { file: 'window_square_metal_fortified', fill: 'dark' },
  windowBarsLit: { file: 'window_square_metal_fortified', fill: 'lit', glow: true },
  shutters: { file: 'window_square_closed' },
};

/** Colors poured into enclosed holes: an unlit room, a room lit by an oil lamp. */
const FILL = { dark: [14, 11, 10], lit: [242, 194, 122] };
/** Color and strength of the glow of lit glass (above ~1 it blooms: see postprocess.ts). */
const GLOW_COLOR = 0xffb066;
const GLOW_INTENSITY = 1.4;
/** A pixel glows if its brightness (0..1) is above this: the glass, not the wood around it. */
const GLOW_THRESHOLD = 0.6;

/** Downloads a PNG and reads its pixels (through a canvas: images can't be read directly). */
async function loadPixels(file: string): Promise<ImageData> {
  const image = await new THREE.ImageLoader().loadAsync(`${BASE}textures/${file}.png`);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Paints the transparent pixels that the picture ENCLOSES. It's the paint bucket
 * of an image editor, used backwards: we pour from the image's border into the
 * transparent pixels touching it, and from those into their transparent neighbors,
 * and so on ("flood fill"). Everything the pour reaches is OUTSIDE (the corners
 * around a round window). A transparent pixel it can't reach is walled in by the
 * picture (between the bars of a window): that's the one we paint.
 */
function fillEnclosed(img: ImageData, [r, g, b]: number[]): void {
  const { width: w, height: h, data } = img;
  const clear = (i: number) => data[i * 4 + 3] < 128;
  const outside = new Uint8Array(w * h);
  const toVisit: number[] = [];
  const reach = (x: number, y: number) => {
    const i = y * w + x;
    if (x < 0 || y < 0 || x >= w || y >= h || outside[i] || !clear(i)) return;
    outside[i] = 1;
    toVisit.push(i);
  };
  for (let x = 0; x < w; x++) {
    reach(x, 0);
    reach(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    reach(0, y);
    reach(w - 1, y);
  }
  while (toVisit.length > 0) {
    const i = toVisit.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    reach(x + 1, y);
    reach(x - 1, y);
    reach(x, y + 1);
    reach(x, y - 1);
  }
  for (let i = 0; i < w * h; i++) {
    if (!clear(i) || outside[i]) continue;
    data.set([r, g, b, 255], i * 4);
  }
}

/** A black image with only the bright pixels of `img` kept: what glows (the emissive map). */
function glowMask(img: ImageData): ImageData {
  const out = new ImageData(img.width, img.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const brightness = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const glows = d[i + 3] >= 128 && brightness > GLOW_THRESHOLD;
    out.data.set(glows ? [d[i], d[i + 1], d[i + 2], 255] : [0, 0, 0, 255], i);
  }
  return out;
}

/** Pixels → texture, with the same pixel-art settings as the rest of the level. */
function toTexture(img: ImageData): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function decalMaterial(def: DecalDef): Promise<THREE.MeshStandardMaterial> {
  const pixels = await loadPixels(def.file);
  if (def.fill) fillEnclosed(pixels, FILL[def.fill]);
  const material = new THREE.MeshStandardMaterial({
    map: toTexture(pixels),
    roughness: 1,
    // Transparent pixels (the corners around a round window, the middle of a frame)
    // are simply not drawn: a cut-out, no blending, no sorting problems.
    alphaTest: 0.5,
    // The decal lies exactly on the wall: the two would fight over the same depth
    // ("z-fighting") and flicker. polygonOffset nudges the decal's depth a hair
    // toward the camera, without moving it.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  if (def.glow) {
    material.emissiveMap = toTexture(glowMask(pixels));
    material.emissive.set(GLOW_COLOR);
    material.emissiveIntensity = GLOW_INTENSITY;
  }
  addHeightFog(material);
  return material;
}

/** Builds the doors and windows: one mesh per picture. */
export async function createDecalMeshes(decals: readonly Decal[]): Promise<THREE.Mesh[]> {
  const batches = new Map<DecalLook, QuadBatch>();
  for (const d of decals) {
    let batch = batches.get(d.look);
    if (!batch) {
      batch = new QuadBatch();
      batches.set(d.look, batch);
    }
    // The whole picture once on the rectangle (UV from 0 to 1).
    batch.add([d.x, d.y, d.z], SIDES[d.facing], d.width / 2, d.height / 2, (su, sv) => [(su + 1) / 2, (sv + 1) / 2]);
  }
  return Promise.all(
    [...batches].map(async ([look, batch]) => {
      const mesh = new THREE.Mesh(batch.toGeometry(), await decalMaterial(DECALS[look]));
      mesh.receiveShadow = true; // flat on the wall: it receives shadows, it doesn't cast them
      return mesh;
    }),
  );
}
