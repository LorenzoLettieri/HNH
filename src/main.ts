import * as THREE from 'three';
import { initInput } from './input';
import { buildCommand, updateLook, view } from './controls';
import { TICK_DT, EYE_HEIGHT } from './sim/config';
import { copyPlayer, createPlayer, horizontalSpeed, stepPlayer } from './sim/player';
import { testArena } from './levels/testArena';
import { triggerLandingDip, updateLandingDip } from './render/landingDip';

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
scene.fog = new THREE.Fog(SKY_COLOR, 8, 45); // starts at 8m, fully opaque at 45m

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

// --- Level ----------------------------------------------------------------
// The level is pure data (src/levels/). Here we just build one mesh per box.
// A mesh = geometry (the shape) + material (how its surface reacts to light).
const world = testArena;

const materials = {
  dirt: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x5a4a44, roughness: 1 }),
};

for (const b of world.boxes) {
  const sizeX = b.maxX - b.minX;
  const sizeY = b.maxY - b.minY;
  const sizeZ = b.maxZ - b.minZ;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), materials[b.look]);
  // BoxGeometry is centered on its origin: place the mesh at the box's center.
  mesh.position.set(b.minX + sizeX / 2, b.minY + sizeY / 2, b.minZ + sizeZ / 2);
  scene.add(mesh);
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
const player = createPlayer(world.spawn.x, world.spawn.y, world.spawn.z);
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
    stepPlayer(player, buildCommand(tick), world, TICK_DT);
    // The renderer only *reads* the state: "were we in the air, and now we're not?"
    if (!prevPlayer.onGround && player.onGround) triggerLandingDip(-prevPlayer.vy);
    tick++;
    accumulator -= TICK_DT;
  }

  // How far we are between the previous tick (0) and the current one (1).
  const alpha = accumulator / TICK_DT;
  camera.position.set(
    prevPlayer.x + (player.x - prevPlayer.x) * alpha,
    prevPlayer.y + (player.y - prevPlayer.y) * alpha + EYE_HEIGHT - updateLandingDip(frameTime),
    prevPlayer.z + (player.z - prevPlayer.z) * alpha,
  );
  // View angles come straight from the mouse, not from the simulation:
  // interpolating them would add a tick of delay to aiming.
  camera.rotation.set(view.pitch, view.yaw, 0);

  hud.textContent = `${horizontalSpeed(player).toFixed(1)} m/s  ${player.onGround ? 'GROUND' : 'AIR'}`;

  renderer.render(scene, camera);
});
