// Oil lantern (the "hurricane" kind): brass tank, glowing glass globe
// protected by wire guards, a cap with a chimney and a carrying handle.
// Either standing on something, or hanging from an iron wall bracket.
import * as THREE from 'three';
import { addHeightFog } from '../heightFog';
import { createFlame, propMaterial, scaleUV, solid, type PropModel } from './common';
import { brassTexture, ironTexture } from './textures';

const SIDES = 8;
const GLASS_BOTTOM = 0.07;
const GLASS_HEIGHT = 0.19;
/** Distance of the hanging lantern from the wall, meters. */
const BRACKET_LENGTH = 0.5;
/**
 * Lanterns are scaled up a bit compared to a real one (~35 cm): at our low
 * resolution a realistic size reads as a few pixels. Boomer shooters always
 * exaggerate pickups and props for readability.
 */
const LANTERN_SCALE = 1.4;

function createLanternBody(): {
  body: THREE.Group;
  glass: THREE.MeshStandardMaterial;
  update: (t: number) => void;
} {
  const body = new THREE.Group();
  const brass = propMaterial(brassTexture());
  const iron = propMaterial(ironTexture());

  // Fuel tank at the bottom.
  const tank = solid(scaleUV(new THREE.CylinderGeometry(0.1, 0.11, 0.07, SIDES), 2, 1), brass);
  tank.position.y = 0.035;
  body.add(tank);

  // Glass globe: a lathe profile that bulges in the middle, like the real thing.
  // Emissive = it emits its own light color, so it glows even in the dark.
  // Semi-transparent, so the flame shows through.
  const glass = new THREE.MeshStandardMaterial({
    color: 0xffc080,
    emissive: 0xffa040,
    emissiveIntensity: 2,
    transparent: true,
    opacity: 0.55,
    roughness: 0.2,
    depthWrite: false,
  });
  addHeightFog(glass);
  const globeProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    globeProfile.push(
      new THREE.Vector2(0.06 + 0.03 * Math.sin(t * Math.PI), GLASS_BOTTOM + t * GLASS_HEIGHT),
    );
  }
  body.add(new THREE.Mesh(new THREE.LatheGeometry(globeProfile, SIDES), glass));

  // Wire guards around the glass.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const guard = solid(new THREE.BoxGeometry(0.012, GLASS_HEIGHT, 0.012), iron);
    guard.position.set(Math.cos(a) * 0.097, GLASS_BOTTOM + GLASS_HEIGHT / 2, Math.sin(a) * 0.097);
    body.add(guard);
  }

  // Cap (a cone) and chimney.
  const capY = GLASS_BOTTOM + GLASS_HEIGHT;
  const cap = solid(scaleUV(new THREE.CylinderGeometry(0.035, 0.1, 0.06, SIDES), 2, 1), brass);
  cap.position.y = capY + 0.03;
  body.add(cap);
  const chimney = solid(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 6), brass);
  chimney.position.y = capY + 0.085;
  body.add(chimney);

  // Handle: half a torus (arc of PI radians), standing upright above the cap.
  const handle = solid(new THREE.TorusGeometry(0.075, 0.008, 4, 10, Math.PI), iron);
  handle.position.y = capY + 0.06;
  body.add(handle);

  // A small flame inside the glass.
  const flame = createFlame(0.06, 0.11);
  flame.sprite.position.y = GLASS_BOTTOM + 0.03;
  body.add(flame.sprite);

  return { body, glass, update: flame.update };
}

export function createLantern(mount: 'wall' | 'ground'): PropModel {
  const group = new THREE.Group();
  const { body, glass, update } = createLanternBody();
  body.scale.setScalar(LANTERN_SCALE);
  const handleTop = (GLASS_BOTTOM + GLASS_HEIGHT + 0.06 + 0.075) * LANTERN_SCALE;

  if (mount === 'ground') {
    group.add(body);
  } else {
    // Wall bracket, sticking out along +Z from the wall point (the origin).
    const iron = propMaterial(ironTexture());
    const plate = solid(new THREE.BoxGeometry(0.12, 0.22, 0.02), iron);
    plate.position.set(0, -0.06, 0.01);
    group.add(plate);
    const arm = solid(new THREE.BoxGeometry(0.03, 0.03, BRACKET_LENGTH), iron);
    arm.position.set(0, 0, BRACKET_LENGTH / 2);
    group.add(arm);
    // Diagonal strut from the bottom of the plate to the middle of the arm.
    const strut = solid(new THREE.BoxGeometry(0.02, 0.02, 0.3), iron);
    strut.rotation.x = Math.PI / 4;
    strut.position.set(0, -0.1, 0.1);
    group.add(strut);
    // Hook at the tip.
    const hook = solid(new THREE.BoxGeometry(0.015, 0.05, 0.015), iron);
    hook.position.set(0, -0.025, BRACKET_LENGTH - 0.02);
    group.add(hook);

    // The lantern hangs with its handle on the hook.
    body.position.set(0, -0.05 - handleTop, BRACKET_LENGTH - 0.02);
    group.add(body);
  }

  // Where the light comes from, in the group's coordinates.
  const flameCenter = new THREE.Vector3(0, (GLASS_BOTTOM + GLASS_HEIGHT / 2) * LANTERN_SCALE, 0).add(
    body.position,
  );

  return {
    object: group,
    fires: [
      {
        position: flameCenter,
        // Weaker than a torch: it's small, and wall lanterns sit very close
        // to the wall, which would otherwise get a blinding hot spot.
        intensity: 0.22,
        range: 7,
        flicker: 0.08, // behind glass: a calmer flame
        haloSize: 1.1,
        emberRate: 0.6, // only the odd spark escapes from the chimney
        glowMaterials: [glass],
      },
    ],
    update,
  };
}
