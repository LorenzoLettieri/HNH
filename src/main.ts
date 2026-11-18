import * as THREE from 'three';
import { consumeMouseDelta, initInput, isKeyDown, isPointerLocked } from './input';

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Scene & atmosphere ---------------------------------------------------
const scene = new THREE.Scene();

// Dusty, hellish dusk: the background and the fog share the same color,
// so distant objects fade seamlessly into the sky.
const SKY_COLOR = 0x3a1810;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 5, 30); // starts at 5m, fully opaque at 30m

// --- Camera ---------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.7, 5); // eye height ~1.7m, 5m back from the origin

// --- Lights ---------------------------------------------------------------
// Hemisphere light: soft ambient light, one color from above (sky) and one from below (ground).
const ambient = new THREE.HemisphereLight(0x8a4a30, 0x1a0d08, 0.6);
scene.add(ambient);

// Point light: a warm "lantern" that lights things around it and fades with distance.
const lantern = new THREE.PointLight(0xffa040, 25, 12); // color, intensity, range (m)
lantern.position.set(-1.5, 2.5, 1.5);
scene.add(lantern);

// --- Objects --------------------------------------------------------------
// A mesh = geometry (the shape) + material (how its surface reacts to light).
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }), // dry dirt
);
floor.rotation.x = -Math.PI / 2; // planes are created vertical: lay it flat
scene.add(floor);

const crate = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }), // wood
);
crate.position.set(0, 0.5, 0); // box is centered on its origin: lift it by half its height
scene.add(crate);

// A few more crates as landmarks, so you can tell you're moving.
for (const [x, z] of [[-6, -4], [5, -8], [8, 3], [-4, 7]]) {
  const extra = crate.clone(); // shares geometry and material with the original
  extra.position.set(x, 0.5, z);
  scene.add(extra);
}

// --- First-person camera --------------------------------------------------
// The view is described by two angles instead of a free 3D rotation:
//   yaw   = turning left/right (around the vertical Y axis)
//   pitch = looking up/down    (around the camera's own X axis)
// Rotation order 'YXZ' applies yaw first, then pitch: this keeps the horizon level.
const MOUSE_SENSITIVITY = 0.002; // radians per pixel of mouse movement
const MOVE_SPEED = 6; // meters per second (temporary, no physics yet)
const MAX_PITCH = Math.PI / 2 - 0.01; // just under 90°, so you can't flip over

let yaw = 0;
let pitch = 0;
camera.rotation.order = 'YXZ';

const overlay = document.getElementById('overlay')!;
initInput(renderer.domElement, (locked) => {
  overlay.style.display = locked ? 'none' : 'flex';
});

function updateCamera(dt: number): void {
  if (!isPointerLocked()) return;

  // Look: mouse right -> turn right (yaw decreases), mouse down -> look down.
  const { dx, dy } = consumeMouseDelta();
  yaw -= dx * MOUSE_SENSITIVITY;
  pitch -= dy * MOUSE_SENSITIVITY;
  pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
  camera.rotation.set(pitch, yaw, 0);

  // Move: build a direction from the keys, relative to where we're facing.
  let forward = 0;
  let strafe = 0;
  if (isKeyDown('KeyW')) forward += 1;
  if (isKeyDown('KeyS')) forward -= 1;
  if (isKeyDown('KeyD')) strafe += 1;
  if (isKeyDown('KeyA')) strafe -= 1;

  // Forward and right vectors on the ground plane, derived from yaw only
  // (looking up shouldn't make you fly).
  const fwdX = -Math.sin(yaw);
  const fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let moveX = fwdX * forward + rightX * strafe;
  let moveZ = fwdZ * forward + rightZ * strafe;

  // Normalize, otherwise diagonal movement would be ~41% faster (√2).
  const len = Math.hypot(moveX, moveZ);
  if (len > 0) {
    moveX /= len;
    moveZ /= len;
  }

  // Distance = speed × time: same speed at 60 or 144 fps.
  camera.position.x += moveX * MOVE_SPEED * dt;
  camera.position.z += moveZ * MOVE_SPEED * dt;
}

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -----------------------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  // Seconds since the previous frame. Capped so a hiccup (e.g. switching tab)
  // doesn't teleport you.
  const dt = Math.min(clock.getDelta(), 0.1);
  updateCamera(dt);
  renderer.render(scene, camera);
});
