// Draws the shops' vendors (src/sim/world.ts: World.shops): a sprite standing
// where the level says, turned toward the camera around the vertical axis
// only (a cylindrical billboard, like the pickups and Doom's characters).
// The vendor is pure decoration for the simulation: enemies ignore him,
// bullets go through him. The only animation: the brass claw drumming on
// the counter, three quick taps then a pause (an impatient merchant).
// The saloon's barman (barmanSprite.ts) is drawn the same way: he polishes a glass.
import * as THREE from 'three';
import type { World } from '../sim/world';
import { addHeightFog } from './heightFog';
import { VENDOR_FRAMES, VENDOR_H, VENDOR_W, vendorSheet } from './vendorSprite';
import { BARMAN_FRAMES, BARMAN_H, BARMAN_W, barmanSheet } from './barmanSprite';
import type { SpriteSheet } from './enemies/spriteSheet';

const PIXELS_PER_METER = 32;
/** Glow of the eyes and the glints of gold (HDR: above 1 goes into the bloom). */
const GLOW = 3;
/** The drumming: one cycle every DRUM_CYCLE seconds, taps starting at these times, each lasting TAP_TIME. */
const DRUM_CYCLE = 2.6;
const TAPS = [0, 0.22, 0.44];
const TAP_TIME = 0.1;
/** The barman polishing a glass: the rag changes side every POLISH_TIME seconds. */
const POLISH_TIME = 0.3;

export interface VendorRenderer {
  update(camera: THREE.Camera, time: number): void;
}

export function createVendorRenderer(scene: THREE.Scene, world: World): VendorRenderer {
  const vendor = vendorSheet();
  const barman = barmanSheet();

  /** One figure behind a counter: a sprite of `w` × `h` px with its own material (one per kind, shared). */
  function figures(kind: 'weapons' | 'saloon', sheet: SpriteSheet, w: number, h: number): THREE.Mesh[] {
    const width = w / PIXELS_PER_METER;
    const height = h / PIXELS_PER_METER;
    // Origin at the feet: mesh.position is where he stands.
    const geometry = new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0);
    // ONE material per kind: all the vendors animate in sync, nobody will notice.
    const material = new THREE.MeshStandardMaterial({
      map: sheet.color,
      alphaTest: 0.5,
      emissive: 0xff5a20,
      emissiveMap: sheet.glow,
      emissiveIntensity: GLOW,
      roughness: 1,
    });
    addHeightFog(material);
    return (world.shops ?? []).filter((shop) => shop.kind === kind).map((shop) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(shop.x, shop.y, shop.z);
      mesh.castShadow = true;
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: sheet.color,
        alphaTest: 0.5,
      });
      scene.add(mesh);
      return mesh;
    });
  }
  // The armory has a merchant, the saloon a barman; at the Forge you work the iron yourself.
  const meshes = [
    ...figures('weapons', vendor, VENDOR_W, VENDOR_H),
    ...figures('saloon', barman, BARMAN_W, BARMAN_H),
  ];

  return {
    update(camera, time) {
      // Drumming: is one of the taps happening right now?
      const t = time % DRUM_CYCLE;
      const tapping = TAPS.some((start) => t >= start && t < start + TAP_TIME);
      vendor.color.offset.x = vendor.glow.offset.x = (tapping ? 1 : 0) / VENDOR_FRAMES;
      // Polishing: the rag goes back and forth.
      barman.color.offset.x = barman.glow.offset.x = (Math.floor(time / POLISH_TIME) % 2) / BARMAN_FRAMES;
      for (const mesh of meshes) {
        mesh.rotation.y = Math.atan2(camera.position.x - mesh.position.x, camera.position.z - mesh.position.z);
      }
    },
  };
}
