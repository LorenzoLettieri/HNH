import * as THREE from 'three';
import { initInput, isTypingInField } from './input';
import { createDebugPanel } from './debug/debugPanel';
import { buildCommand, updateLook, view } from './controls';
import { TICK_DT } from './sim/config';
import { copyPlayer, createPlayer, horizontalSpeed } from './sim/player';
import { createGame, stepGame } from './sim/game';
import { DEFAULT_LEVEL, LEVELS } from './levels';
import { triggerLandingDip, updateLandingDip } from './render/landingDip';
import { updateCameraFeel } from './render/cameraFeel';
import { createBoxMesh, loadMaterials } from './render/materials';
import { ATMOSPHERES, type Atmosphere } from './render/atmospheres';
import { applySunLight, createSunLight } from './render/sunLight';
import { applyFireLights, createFireLights, updateFireLights } from './render/fireLights';
import { createProps } from './render/props';
import { createPostProcess } from './render/postprocess';
import { createWeaponFx } from './render/weaponFx';
import { createTargets } from './render/targets';
import { createGhoulRenderer } from './render/enemies/ghouls';
import { updateHud } from './render/hud';
import { createNavDebug } from './render/navDebug';
import { getFlowField, getNavGraph } from './sim/nav';
import { createViewmodel } from './render/weapons/viewmodel';
import type { SimEvent } from './sim/events';
import { initAudio } from './audio/sfx';
import { applyParticles, createParticles, updateParticles } from './render/particles';
import { applyHeightFog } from './render/heightFog';
import { applySky, createSky, directionFromAngles } from './render/sky';

// --- Renderer -------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
// Shadows are off by default (they cost GPU time). BasicShadowMap = hard,
// unfiltered edges: cheapest, and they match the pixel-art look.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

// Post-processing pipeline: low-res render, color reduction, dithering, ...
const post = createPostProcess(renderer);
post.setSize(window.innerWidth, window.innerHeight);

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
  applyFireLights(a);
  applyParticles(a);
  applyHeightFog(a);
  post.setSun(directionFromAngles(a.sunElevation, a.sunAzimuth), a.godRays);
  viewmodel.applyAtmosphere(a);
  fog.color.set(a.skyHorizon);
  fog.near = a.fogNear;
  fog.far = a.fogFar;
  ambient.color.set(a.ambientSky);
  ambient.groundColor.set(a.ambientGround);
  ambient.intensity = a.ambientIntensity;
}

// --- Level ----------------------------------------------------------------
// The level is pure data (src/levels/). Here we build one textured mesh per box.
// ?level=arena in the URL picks another level (see src/levels/index.ts).
const params = new URLSearchParams(location.search);
const world = LEVELS[params.get('level') ?? DEFAULT_LEVEL] ?? LEVELS[DEFAULT_LEVEL];
// The whole game state (player + entities), created from the level.
const game = createGame(world);

await loadMaterials(); // top-level await: the game starts once textures are ready
// Boxes without a `look` are invisible colliders (e.g. around props): not drawn.
for (const b of world.boxes) if (b.look) scene.add(createBoxMesh(b));
// Props (barrels, signs, torches, lanterns, grass): models + their flames.
const props = createProps(scene, world);
createFireLights(scene, props.fires);
createParticles(scene, props.fires, props.vents);
const weaponFx = createWeaponFx(scene);
const targets = createTargets(scene, game.entities);
const ghouls = createGhoulRenderer(scene);
const navDebug = createNavDebug(scene, getNavGraph(world));
// The gun in your hand: its own scene and camera, drawn over the world.
const viewmodel = createViewmodel();
viewmodel.setAspect(window.innerWidth / window.innerHeight);
weaponFx.onShot.push(() => viewmodel.onShot());
weaponFx.onReload.push(() => viewmodel.onReload());

let atmosphereIndex = 0;
applyAtmosphere(ATMOSPHERES[atmosphereIndex]);

// --- Debug panel (key below Esc) -------------------------------------------
const debugPanel = createDebugPanel({
  onAtmosphereChange: () => applyAtmosphere(ATMOSPHERES[atmosphereIndex]),
  onPostSizeChange: () => post.refresh(),
});
debugPanel.showAtmosphere(ATMOSPHERES[atmosphereIndex]);

// T cycles through the presets. It's a visual setting of this client, not
// something the player does in the game, so it doesn't go through InputCommand.
// P toggles the pixel-art look, to compare before/after.
// Backquote (the key below Esc: ` or \ depending on the keyboard) opens the debug panel and frees the mouse to use it.
window.addEventListener('keydown', (e) => {
  if (e.repeat || isTypingInField(e)) return;
  if (e.code === 'KeyT') {
    atmosphereIndex = (atmosphereIndex + 1) % ATMOSPHERES.length;
    applyAtmosphere(ATMOSPHERES[atmosphereIndex]);
    debugPanel.showAtmosphere(ATMOSPHERES[atmosphereIndex]);
  }
  if (e.code === 'KeyP') post.togglePixelArt();
  if (e.code === 'KeyN') navDebug.toggle();
  if (e.code === 'Backquote') {
    debugPanel.toggle();
    document.exitPointerLock();
  }
});

// --- Player & camera ------------------------------------------------------
// Rotation order 'YXZ': yaw (turn left/right) first, then pitch (look up/down).
// This keeps the horizon level.
camera.rotation.order = 'YXZ';

const overlay = document.getElementById('overlay')!;
const hud = document.getElementById('hud')!;
initInput(renderer.domElement, (locked) => {
  overlay.style.display = locked ? 'none' : 'flex';
  if (locked) initAudio(); // audio is allowed only after a user gesture
});
const ammoHud = document.getElementById('ammo')!;

// Two copies of the player state: the previous tick and the current one.
// The camera is drawn somewhere in between (interpolation).
// `player` is just a shortcut into the game state.
const player = game.player;
const prevPlayer = createPlayer();

// Debug: start from a given spot with ?pos=x,y,z&look=yaw,pitch (degrees)
// in the URL. Handy to jump straight to the thing you're working on.
const startPos = params.get('pos')?.split(',').map(Number);
const startLook = params.get('look')?.split(',').map(Number);
if (startPos?.length === 3) [player.x, player.y, player.z] = startPos;
if (startLook?.length === 2) {
  view.yaw = THREE.MathUtils.degToRad(startLook[0]);
  view.pitch = THREE.MathUtils.degToRad(startLook[1]);
}
copyPlayer(player, prevPlayer);

// --- Resize ---------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  viewmodel.setAspect(window.innerWidth / window.innerHeight);
});

// --- Loop -----------------------------------------------------------------
// Fixed timestep with an accumulator:
// rendering runs at the monitor's rate (60, 144, ... fps), the simulation
// always advances in fixed TICK_DT steps. The accumulator stores the
// "leftover" time that isn't enough for a full tick yet.
let accumulator = 0;
let lastViewYaw = view.yaw;
let lastViewPitch = view.pitch;
let lastTime = performance.now();

// --- Performance readout ---------------------------------------------------------
// "Measure first, optimize later": these numbers tell where the time goes.
// - sim: milliseconds spent in the simulation ticks this frame;
// - render: milliseconds of JavaScript to SEND the frame to the GPU (the GPU's
//   own work isn't measurable from here, but fps drops when it's too much);
// - calls: draw calls, how many separate "draw this" requests went to the GPU.
renderer.info.autoReset = false;
const perf = { sim: 0, render: 0, calls: 0, fps: 60 };
function perfText(frameTime: number, ghouls: number): string {
  // Smoothed fps (exponential average), otherwise the number jitters unreadably.
  if (frameTime > 0) perf.fps += (1 / frameTime - perf.fps) * 0.05;
  return (
    `${perf.fps.toFixed(0)} fps  sim ${perf.sim.toFixed(2)} ms  render ${perf.render.toFixed(2)} ms  ` +
    `${perf.calls} draw calls  ${ghouls} ghouls`
  );
}

renderer.setAnimationLoop((now: number) => {
  // Seconds since the previous frame, capped so a hiccup (e.g. switching tab)
  // doesn't trigger hundreds of ticks in a row ("spiral of death").
  const frameTime = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  updateLook(); // mouse look every frame, for the snappiest aim

  const simStart = performance.now();
  accumulator += frameTime;
  const events: SimEvent[] = [];
  while (accumulator >= TICK_DT) {
    copyPlayer(player, prevPlayer);
    const cmd = buildCommand(game.tick);
    stepGame(game, cmd, world, TICK_DT, events);
    // The renderer only *reads* the state: "were we in the air, and now we're not?"
    if (!prevPlayer.onGround && player.onGround) triggerLandingDip(-prevPlayer.vy);
    accumulator -= TICK_DT;
  }

  // How far we are between the previous tick (0) and the current one (1).
  const alpha = accumulator / TICK_DT;
  perf.sim = performance.now() - simStart;
  // View angles come straight from the mouse, not from the simulation:
  // interpolating them would add a tick of delay to aiming.
  // (rotation.z, the roll, is set by the camera feel below.)
  // The gun animates first: it also returns the visual "punch" of the shot.
  const viewKick = viewmodel.update(
    frameTime,
    player,
    camera,
    view.yaw - lastViewYaw,
    view.pitch - lastViewPitch,
  );
  lastViewYaw = view.yaw;
  lastViewPitch = view.pitch;
  camera.rotation.x = view.pitch + viewKick; // the punch is only visual: aim is unaffected
  camera.rotation.y = view.yaw;
  const eyeHeight = updateCameraFeel(camera, player, frameTime);
  camera.position.set(
    prevPlayer.x + (player.x - prevPlayer.x) * alpha,
    prevPlayer.y + (player.y - prevPlayer.y) * alpha + eyeHeight - updateLandingDip(frameTime),
    prevPlayer.z + (player.z - prevPlayer.z) * alpha,
  );
  // The sky follows the camera: you can never get closer to it.
  sky.position.copy(camera.position);

  const state = player.sliding ? 'SLIDE' : player.onGround ? (player.crouched ? 'CROUCH' : 'GROUND') : 'AIR';
  hud.textContent =
    `${horizontalSpeed(player).toFixed(1)} m/s  ${state}  walljumps ${player.wallJumpsLeft}\n` +
    perfText(frameTime, game.entities.filter((e) => e.type === 'ghoul').length);

  // Weapon events of this frame → effects and sounds.
  weaponFx.handle(events, camera);
  weaponFx.update(frameTime);
  targets.handle(events);
  targets.update(frameTime);
  ghouls.update(game.entities, events, camera, alpha, frameTime);
  updateHud(game, events, frameTime);
  navDebug.update(getFlowField(getNavGraph(world), game.navGoal));
  ammoHud.textContent = player.reloadTicks > 0
    ? 'RELOADING'
    : '●'.repeat(player.ammo) + '○'.repeat(Math.max(0, 6 - player.ammo));

  updateFireLights(now / 1000);
  props.update(now / 1000);
  updateParticles(frameTime, now / 1000, camera, post.sceneSize.y);
  // renderer.info counts draw calls; it normally resets at every render()
  // call, but a frame here is many renders (scene, gun, post passes): we
  // reset it ourselves once per frame to get the total.
  renderer.info.reset();
  const renderStart = performance.now();
  post.render(scene, camera, viewmodel);
  perf.render = performance.now() - renderStart;
  perf.calls = renderer.info.render.calls;
});
