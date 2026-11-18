import * as THREE from 'three';
import { initInput } from './input';
import { buildCommand, updateLook, view } from './controls';
import { TICK_DT, EYE_HEIGHT } from './sim/config';
import { copyPlayer, createPlayer, horizontalSpeed, stepPlayer } from './sim/player';

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

// --- Player & camera ------------------------------------------------------
// Rotation order 'YXZ': yaw (turn left/right) first, then pitch (look up/down).
// This keeps the horizon level.
camera.rotation.order = 'YXZ';

const overlay = document.getElementById('overlay')!;
const hud = document.getElementById('hud')!;
initInput(renderer.domElement, (locked) => {
  overlay.style.display = locked ? 'none' : 'flex';
});

// Two copies of the player state: the previous tick and the current one.
// The camera is drawn somewhere in between (interpolation).
const player = createPlayer(0, 0, 5);
const prevPlayer = createPlayer();
copyPlayer(player, prevPlayer);

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Loop -----------------------------------------------------------------
// Fixed timestep with an accumulator:
// rendering runs at the monitor's rate (60, 144, ... fps), the simulation
// always advances in fixed TICK_DT steps. The accumulator stores the
// "leftover" time that isn't enough for a full tick yet.
let tick = 0;
let accumulator = 0;
let lastTime = performance.now();

renderer.setAnimationLoop((now: number) => {
  // Seconds since the previous frame, capped so a hiccup (e.g. switching tab)
  // doesn't trigger hundreds of ticks in a row ("spiral of death").
  const frameTime = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  updateLook(); // mouse look every frame, for the snappiest aim

  accumulator += frameTime;
  while (accumulator >= TICK_DT) {
    copyPlayer(player, prevPlayer);
    stepPlayer(player, buildCommand(tick), TICK_DT);
    tick++;
    accumulator -= TICK_DT;
  }

  // How far we are between the previous tick (0) and the current one (1).
  const alpha = accumulator / TICK_DT;
  camera.position.set(
    prevPlayer.x + (player.x - prevPlayer.x) * alpha,
    prevPlayer.y + (player.y - prevPlayer.y) * alpha + EYE_HEIGHT,
    prevPlayer.z + (player.z - prevPlayer.z) * alpha,
  );
  // View angles come straight from the mouse, not from the simulation:
  // interpolating them would add a tick of delay to aiming.
  camera.rotation.set(view.pitch, view.yaw, 0);

  hud.textContent = `${horizontalSpeed(player).toFixed(1)} m/s  ${player.onGround ? 'GROUND' : 'AIR'}`;

  renderer.render(scene, camera);
});
