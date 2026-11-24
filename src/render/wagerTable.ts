// The devil's gambling table, "La Scommessa del Diavolo" (the simulation:
// src/sim/wager.ts). A card table with green felt in the middle of town:
// a fan of cards, stacks of bone chips, a skull with a candle on it, an empty
// chair for you and, across the table, the devil's own high-backed chair with
// horns (empty too: he's always "just stepped away"). Over the table floats
// THE STAKE: a big card showing the curse you'd play the next wave with,
// slowly turning, glowing red. A red column of light goes up into the sky
// while the bet is on offer (the bells' waypoint trick), so you find it.
//
// Taken: the column goes out, the card spins and burns brighter ("the deal is
// sealed"). When the cursed wave starts (or nobody took the bet) the table
// sinks into the ground in a burst of hellfire.
//
// It only READS the simulation: game.mapEvent (where, what curse, which
// phase) and the wager events for the sounds.
//
// Everything is built ONCE at startup and hidden, the light included: adding
// a light to the scene while playing makes Three.js recompile every shader
// (a hitch right when the table appears; see the explosions' light pool).
// A light that's always there with intensity 0 costs nothing to switch on.
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/game';
import { CURSES, type WagerCurse, type WagerEvent } from '../sim/wager';
import { playWagerAccepted, playWagerCurse, playWagerVanish } from '../audio/sfx';
import { addHeightFog } from './heightFog';
import { beamTexture } from './bells';
import { spawnBlastFire, spawnSmoke, spawnSparks } from './particles';
import { createFlame, propMaterial, solid, texturedBox } from './props/common';
import { PixelCanvas, seededRandom, shade } from './props/pixelCanvas';
import { postWoodTexture } from './props/textures';
import { soundAt } from './soundPosition';

// --- Shape (meters) ---
/** The table top: size and height of its surface. */
const TOP_X = 1.6;
const TOP_Z = 1.0;
const TOP_Y = 0.85;
const TOP_THICK = 0.08;
/** Legs: square, this thick, this far in from the corners. */
const LEG = 0.09;
const LEG_IN = 0.12;
/** The devil's chair: its back this tall, horns on top. */
const THRONE_BACK = 1.6;
/** The stake card: size, how high its middle floats above the felt, how fast it turns (rad/s) and bobs. */
const CARD_W = 0.42;
const CARD_H = 0.62;
const CARD_FLOAT = 1.05;
const CARD_TURN = 0.8;
const CARD_BOB = 0.06;
/** Taken: the card spins this fast for a moment (rad/s), then slows back down. */
const SEAL_SPIN = 14;
const SEAL_TIME = 1.2;

// --- Look ---
/** The card's red glow: calm while offered, bright once sealed (above 1 it blooms). */
const CARD_GLOW = 0.5;
const CARD_GLOW_SEALED = 1.6;
const CARD_GLOW_HZ = 1.1;
/** The red light over the table. */
const LIGHT_COLOR = 0xff3018;
const LIGHT_INTENSITY = 4;
const LIGHT_RANGE = 10;
/** The column of light while the bet is on offer: radius, height, color (×, above 1 = bloom). */
const BEAM_RADIUS = 0.6;
const BEAM_HEIGHT = 60;
const BEAM_COLOR = new THREE.Color(2.4, 0.35, 0.2);
const BEAM_OPACITY = 0.4;

// --- Going away ---
/** Seconds the table takes to sink into the ground, burning. */
const VANISH_TIME = 0.9;
/** How deep it sinks (meters). */
const VANISH_DEPTH = 1.4;
/** Fire puffs per second while it sinks. */
const VANISH_FIRE = 40;

// --- Palette ---
const C = {
  felt: 0x1e4a2a,
  feltDark: 0x10301a,
  gold: 0xc89a3c,
  blood: 0x8a1410,
  bloodDark: 0x4a0808,
  bone: 0xe8dcc0,
  boneDark: 0xa89878,
  ink: 0x140c0c,
  velvet: 0x6a0c14,
  wax: 0x5a1010,
  green: 0x3cc048,
};

export interface WagerTableRenderer {
  update(game: GameState, events: SimEvent[], camera: THREE.Camera, dt: number, time: number): void;
}

export function createWagerTableRenderer(scene: THREE.Scene): WagerTableRenderer {
  const root = new THREE.Group(); // at the table's feet; sinks when it goes away
  root.visible = false;
  scene.add(root);

  const wood = postWoodTexture();
  // --- The table ---
  // The felt on top, the dark wood on the sides: a box with one material per face (+x, −x, +y, −y, +z, −z).
  const woodMat = propMaterial(wood);
  const feltMat = propMaterial(feltTexture());
  const top = solid(new THREE.BoxGeometry(TOP_X, TOP_THICK, TOP_Z), [woodMat, woodMat, feltMat, woodMat, woodMat, woodMat]);
  top.position.y = TOP_Y - TOP_THICK / 2;
  root.add(top);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = texturedBox(LEG, TOP_Y - TOP_THICK, LEG, wood);
      leg.position.set(sx * (TOP_X / 2 - LEG_IN), (TOP_Y - TOP_THICK) / 2, sz * (TOP_Z / 2 - LEG_IN));
      root.add(leg);
    }
  }

  // --- Chairs: yours (+Z, pulled out: sit down), the devil's (−Z, a throne) ---
  root.add(chair(wood, 0.95, 0.55, false));
  const throne = chair(wood, THRONE_BACK, 0.5, true);
  throne.rotation.y = Math.PI;
  throne.position.z = -0.05;
  root.add(throne);

  // --- On the felt: a fan of cards, chips, the skull with its candle ---
  const cardBack = cardBackTexture();
  const smallCard = new THREE.PlaneGeometry(0.09, 0.13);
  smallCard.rotateX(-Math.PI / 2); // lying on the felt
  const faceMat = propMaterial(cardFaceTexture());
  for (let i = 0; i < 5; i++) {
    const card = new THREE.Mesh(smallCard, faceMat);
    card.position.set(0.25 + (i - 2) * 0.035, TOP_Y + 0.002 + i * 0.0005, 0.25);
    card.rotation.y = (i - 2) * 0.25;
    root.add(card);
  }
  const deck = texturedBox(0.09, 0.04, 0.13, cardBack);
  deck.position.set(-0.05, TOP_Y + 0.02, -0.1);
  deck.rotation.y = 0.3;
  root.add(deck);
  const chipGeometry = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 10);
  const chipMat = propMaterial(chipTexture());
  const stacks: [number, number, number][] = [[-0.45, 0.2, 6], [-0.36, 0.28, 4], [-0.5, 0.32, 9], [0.55, -0.2, 5]];
  for (const [x, z, n] of stacks) {
    for (let i = 0; i < n; i++) {
      const chip = solid(chipGeometry, chipMat);
      chip.position.set(x + (i % 2) * 0.003, TOP_Y + 0.006 + i * 0.012, z);
      root.add(chip);
    }
  }
  // The skull: a low-poly ball squashed a little, two dark eye sockets, a candle stuck on top.
  const boneMat = new THREE.MeshStandardMaterial({ color: C.bone, roughness: 0.8, flatShading: true });
  addHeightFog(boneMat);
  const skull = solid(new THREE.IcosahedronGeometry(0.1, 1), boneMat);
  skull.scale.set(1, 0.85, 1.1);
  skull.position.set(-0.5, TOP_Y + 0.08, -0.2);
  root.add(skull);
  const socketMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const side of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.02), socketMat);
    socket.position.set(-0.5 + side * 0.035, TOP_Y + 0.09, -0.2 + 0.105);
    root.add(socket);
  }
  const waxMat = new THREE.MeshStandardMaterial({ color: C.wax, roughness: 0.6 });
  addHeightFog(waxMat);
  const candle = solid(new THREE.CylinderGeometry(0.022, 0.026, 0.14, 8), waxMat);
  candle.position.set(-0.5, TOP_Y + 0.21, -0.2);
  root.add(candle);
  const flame = createFlame(0.07, 0.12);
  flame.sprite.position.set(-0.5, TOP_Y + 0.28, -0.2);
  root.add(flame.sprite);

  // --- The stake: a big card floating over the table, front = the curse, back = the deck's back ---
  const cardMats = new Map<WagerCurse, THREE.MeshStandardMaterial>();
  for (const curse of CURSES) {
    const tex = curseCardTexture(curse);
    // emissiveMap = the card itself: it glows with its own colors, not a flat red blob.
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xff4030, emissiveIntensity: CARD_GLOW, roughness: 0.6 });
    cardMats.set(curse, m);
  }
  const backMat = new THREE.MeshStandardMaterial({ map: cardBack, emissiveMap: cardBack, emissive: 0xff4030, emissiveIntensity: CARD_GLOW, roughness: 0.6 });
  const stake = new THREE.Group();
  stake.position.y = TOP_Y + CARD_FLOAT;
  root.add(stake);
  const cardGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const front = new THREE.Mesh(cardGeometry, cardMats.get('noMedkits')!);
  const back = new THREE.Mesh(cardGeometry, backMat);
  back.rotation.y = Math.PI; // back to back: each face shows from its own side
  stake.add(front, back);

  // --- The column of light and the red light ---
  const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true);
  beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: beamTexture(),
    color: BEAM_COLOR,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.position.y = TOP_Y + CARD_FLOAT + CARD_H / 2 + 0.2; // above the card: it mustn't hide it
  root.add(beam);
  const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE);
  light.position.y = TOP_Y + 0.9;
  root.add(light); // always in the scene (see the top of the file)

  // --- State of the drawing ---
  let shown: WagerEvent | null = null; // the event the table is showing (a copy of where and what)
  let sealedAt = -1; // time the bet was taken (the spin), -1 = not taken
  let angle = 0;
  let vanish = -1; // seconds into going away, -1 = not going away
  const at = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function startVanish(camera: THREE.Camera): void {
    vanish = 0;
    beam.visible = false;
    if (shown) {
      playWagerVanish(soundAt(camera, shown.x, shown.y + 1, shown.z));
      at.set(shown.x, shown.y + TOP_Y, shown.z);
      spawnBlastFire(at, up, 14);
      spawnSmoke(at, up, 10);
    }
  }

  return {
    update(game, events, camera, dt, time) {
      const active = game.mapEvent.active;
      const ev = active?.kind === 'wager' && active.phase !== 'cursed' ? active : null;

      // A new bet on the table: put it there, the right card on top.
      if (ev && (!shown || vanish >= 0)) {
        shown = { ...ev };
        root.position.set(ev.x, ev.y, ev.z);
        root.scale.y = 1;
        root.visible = true;
        vanish = -1;
        sealedAt = ev.phase === 'accepted' ? time - SEAL_TIME : -1;
        front.material = cardMats.get(ev.curse)!;
      }
      // Gone from the simulation (the cursed wave started, or nobody bet): it sinks.
      if (!ev && shown && vanish < 0) startVanish(camera);

      for (const e of events) {
        if (e.type === 'wagerAccepted') {
          sealedAt = time;
          if (shown) {
            playWagerAccepted(soundAt(camera, shown.x, shown.y + 1, shown.z));
            at.set(shown.x, shown.y + TOP_Y + CARD_FLOAT, shown.z);
            spawnSparks(at, up, 24);
          }
        }
        if (e.type === 'wagerCurse') playWagerCurse(e.curse);
      }

      if (!root.visible) {
        light.intensity = 0;
        return;
      }

      // Sinking into the ground, burning.
      if (vanish >= 0) {
        vanish += dt;
        const t = Math.min(1, vanish / VANISH_TIME);
        root.position.y = (shown?.y ?? 0) - VANISH_DEPTH * t * t; // ease-in: slow, then swallowed
        light.intensity = LIGHT_INTENSITY * 2 * (1 - t); // a last flare
        const puffs = Math.floor((vanish - dt) * VANISH_FIRE) !== Math.floor(vanish * VANISH_FIRE);
        if (puffs && shown) {
          at.set(shown.x + (Math.random() - 0.5) * TOP_X, shown.y + 0.1, shown.z + (Math.random() - 0.5) * TOP_Z);
          spawnBlastFire(at, up, 2);
        }
        if (t >= 1) {
          root.visible = false;
          shown = null;
          light.intensity = 0;
        }
      }

      // The stake: turning and bobbing; taken = a fast spin that slows down, and brighter.
      const sealed = sealedAt >= 0;
      const sinceSeal = sealed ? time - sealedAt : 0;
      const spin = sealed && sinceSeal < SEAL_TIME ? SEAL_SPIN * (1 - sinceSeal / SEAL_TIME) ** 2 : 0;
      angle += (CARD_TURN + spin) * dt;
      stake.rotation.y = angle;
      stake.position.y = TOP_Y + CARD_FLOAT + Math.sin(time * 1.7) * CARD_BOB;
      const pulse = 0.5 + 0.5 * Math.sin(time * Math.PI * 2 * CARD_GLOW_HZ);
      const glow = (sealed ? CARD_GLOW_SEALED : CARD_GLOW) * (0.7 + 0.3 * pulse);
      (front.material as THREE.MeshStandardMaterial).emissiveIntensity = glow;
      backMat.emissiveIntensity = glow;

      if (vanish < 0) {
        beam.visible = !sealed; // the waypoint: only while the bet is waiting for you
        beamMaterial.opacity = BEAM_OPACITY * (0.75 + 0.25 * pulse);
        // The light breathes with the card, and flickers with the candle.
        const flicker = 0.9 + 0.1 * Math.sin(time * 23) * Math.sin(time * 7.3);
        light.intensity = LIGHT_INTENSITY * (sealed ? 1.4 : 1) * (0.8 + 0.2 * pulse) * flicker;
      }
      flame.update(time);
    },
  };
}

/**
 * A chair: four legs, a seat, a back of `backHeight` meters. The devil's
 * (`throne`) has a red velvet panel on its back and two horns on top.
 * Built facing +Z (you sit looking at −Z, toward the table's middle), at the
 * table's +Z side; the caller turns it around for the other side.
 */
function chair(wood: THREE.Texture, backHeight: number, seatZ: number, throne: boolean): THREE.Group {
  const g = new THREE.Group();
  const SEAT = 0.45;
  const SEAT_Y = 0.48;
  const z = TOP_Z / 2 + seatZ;
  const seat = texturedBox(SEAT, 0.05, SEAT, wood);
  seat.position.set(0, SEAT_Y, z);
  g.add(seat);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = texturedBox(0.05, SEAT_Y, 0.05, wood);
      leg.position.set(sx * (SEAT / 2 - 0.04), SEAT_Y / 2, z + sz * (SEAT / 2 - 0.04));
      g.add(leg);
    }
    // The back's two uprights, from the floor up.
    const post = texturedBox(0.06, backHeight, 0.06, wood);
    post.position.set(sx * (SEAT / 2 - 0.03), backHeight / 2, z + SEAT / 2 - 0.03);
    g.add(post);
  }
  if (throne) {
    const panel = texturedBox(SEAT - 0.1, backHeight - SEAT_Y - 0.15, 0.04, velvetTexture());
    panel.position.set(0, SEAT_Y + (backHeight - SEAT_Y) / 2, z + SEAT / 2 - 0.03);
    g.add(panel);
    // Horns: a cone on each upright, leaning out and curling back.
    const hornMat = new THREE.MeshStandardMaterial({ color: C.boneDark, roughness: 0.7, flatShading: true });
    addHeightFog(hornMat);
    for (const sx of [-1, 1]) {
      const horn = solid(new THREE.ConeGeometry(0.05, 0.32, 6), hornMat);
      horn.position.set(sx * (SEAT / 2 + 0.04), backHeight + 0.12, z + SEAT / 2 - 0.03);
      horn.rotation.z = -sx * 0.6;
      horn.rotation.x = 0.3;
      g.add(horn);
    }
  } else {
    // Your chair: two slats across the back.
    for (const y of [0.75, 0.88]) {
      const slat = texturedBox(SEAT - 0.06, 0.06, 0.03, wood);
      slat.position.set(0, y, z + SEAT / 2 - 0.03);
      g.add(slat);
    }
    g.rotation.y = 0.25; // pulled out a little, askew: sit down
  }
  return g;
}

// --- Textures (pixel art, painted once) ---

/** The felt: deep green with a little noise, a gold trim line, and a blood-red ring where the stake goes. */
function feltTexture(): THREE.Texture {
  const W = 48;
  const H = 30;
  const c = new PixelCanvas(W, H);
  const rand = seededRandom(66);
  c.fill(C.felt);
  c.noise(rand, 0.18);
  for (let x = 0; x < W; x++) {
    c.set(x, 2, C.gold);
    c.set(x, H - 3, C.gold);
  }
  for (let y = 2; y < H - 2; y++) {
    c.set(2, y, C.gold);
    c.set(W - 3, y, C.gold);
  }
  // A ring in the middle: every pixel at distance ~6 from the center.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2);
      if (Math.abs(d - 6.5) < 0.6) c.set(x, y, C.blood);
      else if (d < 6) c.set(x, y, shade(C.feltDark, 0.9 + rand() * 0.2));
    }
  }
  return c.toTexture();
}

/** Red velvet with vertical folds: the back of the devil's chair. */
function velvetTexture(): THREE.Texture {
  const c = new PixelCanvas(16, 32);
  const rand = seededRandom(13);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) c.set(x, y, shade(C.velvet, 0.7 + 0.35 * Math.sin((x / 16) * Math.PI * 4) ** 2));
  }
  c.noise(rand, 0.2);
  return c.toTexture();
}

/** Bone chips with blood-red stripes around the edge (the HUD's fiches). On a cylinder U goes around. */
function chipTexture(): THREE.Texture {
  const c = new PixelCanvas(16, 2);
  for (let x = 0; x < 16; x++) {
    const stripe = x % 4 === 0;
    c.set(x, 0, stripe ? C.blood : C.bone);
    c.set(x, 1, stripe ? C.blood : C.boneDark);
  }
  return c.toTexture();
}

/** The back of the cards: blood red, a gold border and a lattice of diamonds. */
function cardBackTexture(): THREE.Texture {
  const W = 16;
  const H = 24;
  const c = new PixelCanvas(W, H);
  c.fill(C.bloodDark);
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) if ((x + y) % 4 === 0 || (x - y + 40) % 4 === 0) c.set(x, y, C.blood);
  }
  frameCard(c, C.gold);
  return c.toTexture();
}

/** The cards on the felt, face up: bone with a red border and a red pip in the middle. */
function cardFaceTexture(): THREE.Texture {
  const c = new PixelCanvas(8, 12);
  c.fill(C.bone);
  c.rect(3, 4, 2, 4, C.blood);
  c.rect(2, 5, 4, 2, C.blood);
  frameCard(c, C.blood);
  return c.toTexture();
}

/** A 1-pixel border, corners cut (a rounded card, in pixels). */
function frameCard(c: PixelCanvas, color: number): void {
  for (let x = 1; x < c.width - 1; x++) {
    c.set(x, 0, color);
    c.set(x, c.height - 1, color);
  }
  for (let y = 1; y < c.height - 1; y++) {
    c.set(0, y, color);
    c.set(c.width - 1, y, color);
  }
  for (const [x, y] of [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]]) c.set(x, y, 0, 0);
}

/**
 * The stake card: bone with a red border and the curse's sign, 16 × 24 px.
 * A sign you read from across the square:
 * - noMedkits: the medkit's green cross, crossed out in red;
 * - oneGun: a revolver and a big "1";
 * - fastEnemies: an hourglass with the sand running, and speed lines;
 * - darkness: a black card with a red eye, half shut.
 */
function curseCardTexture(curse: WagerCurse): THREE.Texture {
  const W = 16;
  const H = 24;
  const c = new PixelCanvas(W, H);
  c.fill(curse === 'darkness' ? C.ink : C.bone);
  if (curse === 'noMedkits') {
    c.rect(6, 6, 4, 12, C.green);
    c.rect(3, 10, 10, 4, C.green);
    for (let i = 0; i < 12; i++) {
      c.set(2 + i, 6 + i, C.blood);
      c.set(3 + i, 6 + i, C.blood);
    }
  } else if (curse === 'oneGun') {
    // The revolver, side view, pointing left: barrel, cylinder, grip.
    c.rect(2, 6, 8, 2, C.ink);
    c.rect(9, 5, 3, 4, C.ink);
    c.rect(11, 8, 3, 5, C.ink);
    c.set(10, 9, C.ink);
    c.set(10, 10, C.ink);
    // A big "1".
    c.rect(7, 13, 2, 7, C.blood);
    c.set(6, 14, C.blood);
    c.rect(5, 19, 6, 1, C.blood);
  } else if (curse === 'fastEnemies') {
    // The hourglass: two triangles touching at the waist, gold frame, red sand falling.
    c.rect(4, 4, 8, 1, C.gold);
    c.rect(4, 19, 8, 1, C.gold);
    for (let i = 0; i < 7; i++) {
      const half = 3 - Math.floor(i / 2);
      c.set(8 - half - 1, 5 + i, C.ink);
      c.set(8 + half, 5 + i, C.ink);
      c.set(8 - half - 1, 18 - i, C.ink);
      c.set(8 + half, 18 - i, C.ink);
    }
    c.rect(7, 9, 2, 3, C.blood); // the last of the sand on top
    c.rect(7, 12, 1, 3, C.blood); // the thread falling
    c.rect(5, 16, 6, 2, C.blood); // the pile below
    // Speed lines on the left.
    for (const y of [8, 12, 16]) c.rect(1, y, 2, 1, C.boneDark);
  } else {
    // The eye: an almond of red, a black slit, the lid coming down.
    for (let x = 3; x < 13; x++) {
      const h = Math.round(3 * Math.sin(((x - 3) / 9) * Math.PI));
      for (let y = 12 - h; y <= 12 + h; y++) c.set(x, y, C.blood);
    }
    c.rect(7, 10, 2, 5, 0x000000);
    c.rect(3, 9, 10, 2, C.ink); // the lid
    // A thin crescent moon above it.
    for (let a = 0; a < 7; a++) c.set(5 + a, 4 + Math.round(Math.abs(a - 3) * 0.6), C.boneDark);
  }
  frameCard(c, C.blood);
  return c.toTexture();
}
