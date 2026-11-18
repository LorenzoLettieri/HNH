import * as THREE from 'three';
import { initInput } from './input';
import { buildCommand, updateLook, view } from './controls';
import { TICK_DT, EYE_HEIGHT } from './sim/config';
import { copyPlayer, createPlayer, horizontalSpeed, stepPlayer } from './sim/player';
import { testArena } from './levels/testArena';
import { triggerLandingDip, updateLandingDip } from './render/landingDip';
import { createBoxMesh, loadMaterials } from './render/materials';
import { ATMOSPHERES, type Atmosphere } from './render/atmospheres';
import { applySky, createSky } from './render/sky';
import { applySunLight, createSunLight } from './render/sunLight';
import { applyLanterns, createLanterns, updateLanterns } from './render/lanterns';

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// Shadows are off by default (they cost GPU time). BasicShadowMap = hard,
// unfiltered edges: cheapest, and they match the pixel-art look.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

// --- Scene & atmosphere ---------------------------------------------------
const scene = new THREE.Scene();

// Sky + fog. Colors and distances come from the atmosphere preset (see below).
const sky = createSky();
scene.add(sky);
const fog = new THREE.Fog(0x000000);
scene.fog = fog;

// --- Camera ---------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

// --- Lights ---------------------------------------------------------------
// Hemisphere light: soft ambient light, one color from above (sky) and one from below (ground).
const ambient = new THREE.HemisphereLight();
scene.add(ambient);

// Directional light from the sun/moon, with shadows.
const sunLight = createSunLight();
scene.add(sunLight, sunLight.target);

// --- Atmosphere -------------------------------------------------------------
// Applies a preset to sky, fog and ambient light all at once.
// The fog uses the horizon color: walls far away melt into the sky.
function applyAtmosphere(a: Atmosphere): void {
  applySky(sky, a);
  applySunLight(sunLight, a);
  applyLanterns(a);
  fog.color.set(a.skyHorizon);
  fog.near = a.fogNear;
  fog.far = a.fogFar;
  ambient.color.set(a.ambientSky);
  ambient.groundColor.set(a.ambientGround);
  ambient.intensity = a.ambientIntensity;
}

// --- Level ----------------------------------------------------------------
// The level is pure data (src/levels/). Here we build one textured mesh per box.
const world = testArena;

await loadMaterials(); // top-level await: the game starts once textures are ready
for (const b of world.boxes) scene.add(createBoxMesh(b));
createLanterns(scene, world.lanterns);

let atmosphereIndex = 0;
applyAtmosphere(ATMOSPHERES[atmosphereIndex]);

// T cycles through the presets. It's a visual setting of this client, not
// something the player does in the game, so it doesn't go through InputCommand.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyT' || e.repeat) return;
  atmosphereIndex = (atmosphereIndex + 1) % ATMOSPHERES.length;
  applyAtmosphere(ATMOSPHERES[atmosphereIndex]);
});

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
  // The sky follows the camera: you can never get closer to it.
  sky.position.copy(camera.position);

  hud.textContent = `${horizontalSpeed(player).toFixed(1)} m/s  ${player.onGround ? 'GROUND' : 'AIR'}`;

  updateLanterns(now / 1000);
  renderer.render(scene, camera);
});
