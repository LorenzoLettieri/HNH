import * as THREE from 'three';
import { initInput, isKeyDown, isPointerLocked, isTypingInField, requestLock } from './input';
import { loadSettings, settings } from './settings';
import { submitScore } from './leaderboard';
import { markPractice, practiceGame, startGame } from './fairPlay';
import { createMenu } from './menu';
import { createDebugPanel, debugTime } from './debug/debugPanel';
import { buildCommand, controlSettings, updateLook, view } from './controls';
import { TICK_DT } from './sim/config';
import { copyPlayer, createPlayer } from './sim/player';
import { createGame, spawnBullInFront, spawnSharpshooterInFront, spawnEyebatInFront, spawnHoundInFront, dropPickupsInFront, stepGame } from './sim/game';
import { jumpToWave } from './sim/waves';
import { DEFAULT_LEVEL, LEVELS } from './levels';
import { triggerLandingDip, updateLandingDip } from './render/landingDip';
import { lookScale, updateCameraFeel } from './render/cameraFeel';
import { createGroundMeshes, createLevelMeshes, loadMaterials } from './render/materials';
import { createDecalMeshes } from './render/decals';
import { ATMOSPHERES, type Atmosphere } from './render/atmospheres';
import { applySunLight, createSunLight } from './render/sunLight';
import { applyFireLights, createFireLights, updateFireLights } from './render/fireLights';
import { createProps } from './render/props';
import { createPostProcess } from './render/postprocess';
import { createWeaponFx } from './render/weaponFx';
import { createTargets } from './render/targets';
import { createGhoulRenderer } from './render/enemies/ghouls';
import { createEyebatRenderer } from './render/enemies/eyebats';
import { createHoundRenderer } from './render/enemies/hounds';
import { createBullRenderer } from './render/enemies/bulls';
import { createSharpshooterRenderer } from './render/enemies/sharpshooters';
import { createProjectileRenderer } from './render/projectiles';
import { createPickupRenderer } from './render/pickups';
import { createVendorRenderer } from './render/vendors';
import { createShopMenu } from './render/shopMenu';
import { createMapOverlay } from './render/mapOverlay';
import { shopInReach } from './sim/shop';
import './render/crosshair'; // paints the crosshair once
import { adsAmount, GEAR } from './sim/weapon';
import { updateHud } from './render/hud';
import { createEndScreen } from './render/endScreen';
import { updateAmmoHud } from './render/ammoHud';
import { updateWeaponBar } from './render/weaponBar';
import { updateMoneyHud } from './render/moneyHud';
import { updateThreats } from './render/threatIndicator';
import { createNavDebug } from './render/navDebug';
import { createHitboxDebug } from './render/hitboxDebug';
import { BIG_BODY, getFlowField, getNavGraph } from './sim/nav';
import { createViewmodel } from './render/weapons/viewmodel';
import type { SimEvent } from './sim/events';
import { initAudio, setAudioPaused } from './audio/sfx';
import { applyParticles, createParticles, updateParticles } from './render/particles';
import { updateBurning } from './render/burning';
import { createMarks } from './render/marks';
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
// The level is pure data (src/levels/). Here we turn its boxes into textured meshes.
// ?level=arena in the URL picks another level (see src/levels/index.ts).
const params = new URLSearchParams(location.search);
const world = LEVELS[params.get('level') ?? DEFAULT_LEVEL] ?? LEVELS[DEFAULT_LEVEL];
// The whole game state (player + entities), created from the level.
// The seed makes every game different (which enemies, where). ?seed=123 in
// the URL replays the same sequence: handy to test a specific situation.
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 2 ** 32));
console.log(`seed: ${seed}`);
const game = createGame(world, seed);

await loadMaterials(); // top-level await: the game starts once textures are ready
// All the level's boxes, merged into one mesh per texture (see createLevelMeshes).
for (const mesh of createLevelMeshes(world.boxes)) scene.add(mesh);
// Streets, squares, boardwalks and rails painted on the ground.
for (const mesh of createGroundMeshes(world.ground ?? [])) scene.add(mesh);
// Doors and windows: pictures on the walls (see decals.ts).
for (const mesh of await createDecalMeshes(world.decals ?? [])) scene.add(mesh);
// Props (barrels, signs, torches, lanterns, grass): models + their flames.
const props = createProps(scene, world);
createFireLights(scene, props.fires);
createParticles(scene, props.fires, props.vents);
const weaponFx = createWeaponFx(scene);
const targets = createTargets(scene, game.entities);
const marks = createMarks(scene); // "Marchio": the sigil over marked enemies
const ghouls = createGhoulRenderer(scene);
const eyebats = createEyebatRenderer(scene);
const hounds = createHoundRenderer(scene);
const bulls = createBullRenderer(scene);
const sharpshooters = createSharpshooterRenderer(scene, world);
const projectiles = createProjectileRenderer(scene);
const pickups = createPickupRenderer(scene);
const vendors = createVendorRenderer(scene, world);
const mapOverlay = createMapOverlay(world);
const navDebug = createNavDebug(scene, getNavGraph(world));
const navDebugBig = createNavDebug(scene, getNavGraph(world, BIG_BODY));
/** N cycles: 0 = off, 1 = ghouls' graph, 2 = bulls' graph. */
let navView = 0;
const hitboxDebug = createHitboxDebug(scene);
// The gun in your hand: its own scene and camera, drawn over the world.
const viewmodel = createViewmodel();
viewmodel.setAspect(window.innerWidth / window.innerHeight);
weaponFx.onShot.push((weapon, barrel) => viewmodel.onShot(weapon, barrel));
weaponFx.onReload.push((weapon, seconds) => viewmodel.onReload(weapon, seconds));
weaponFx.onKick.push((tool) => viewmodel.onKick(tool));

let atmosphereIndex = 0;
applyAtmosphere(ATMOSPHERES[atmosphereIndex]);

// --- Debug panel (key below Esc) -------------------------------------------
const debugPanel = createDebugPanel({
  onAtmosphereChange: () => applyAtmosphere(ATMOSPHERES[atmosphereIndex]),
  onPostSizeChange: () => post.refresh(),
  onJumpToWave: (n) => {
    markPractice('ondata scelta dal pannello di debug');
    jumpToWave(game, n);
  },
  onGiveMoney: (amount) => {
    markPractice('vildenaro regalato dal pannello di debug');
    game.player.money += amount;
  },
});
debugPanel.showAtmosphere(ATMOSPHERES[atmosphereIndex]);

// T cycles through the presets. It's a visual setting of this client, not
// something the player does in the game, so it doesn't go through InputCommand.
// P toggles the pixel-art look, to compare before/after.
// Backquote (the key below Esc: ` or \ depending on the keyboard) opens the debug panel and frees the mouse to use it.
window.addEventListener('keydown', (e) => {
  // Tab = the map (held down: read in the loop below). In a browser Tab moves
  // the keyboard focus to the next button: stop that while playing, or a
  // focused button would get "clicked" by the next Space (jump). Before the
  // e.repeat check: holding the key sends a keydown every few ms, and each
  // one would move the focus again.
  if (e.code === 'Tab' && !paused && !isTypingInField(e)) e.preventDefault();
  if (e.repeat || isTypingInField(e)) return;
  // End screen: Space/Enter = play again, Esc = menu (after a moment: you were
  // probably pressing Space when you died). Nothing else while it's open.
  if (endScreen.isOpen) {
    if (!endScreen.acceptsInput) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault(); // or the focused button would be "clicked" too
      endScreen.close();
      updatePause();
      requestLock(renderer.domElement);
    }
    if (e.code === 'Escape') {
      e.preventDefault(); // "used": the menu that opens now must not read it as "resume" (menu.ts)
      endScreen.close();
      updatePause();
    }
    return;
  }
  // Debug keys that change the game: this game won't count (fairPlay.ts).
  if (['KeyB', 'KeyG', 'KeyV', 'KeyL', 'KeyJ'].includes(e.code)) markPractice('nemici o raccoglibili fatti apparire');
  if (e.code === 'KeyT') {
    atmosphereIndex = (atmosphereIndex + 1) % ATMOSPHERES.length;
    applyAtmosphere(ATMOSPHERES[atmosphereIndex]);
    debugPanel.showAtmosphere(ATMOSPHERES[atmosphereIndex]);
  }
  if (e.code === 'KeyP') post.togglePixelArt();
  if (e.code === 'KeyN') {
    navView = (navView + 1) % 3;
    if (navView !== 2) navDebug.toggle(); // on at 1, off at 2
    if (navView !== 1) navDebugBig.toggle(); // on at 2, off at 0
  }
  if (e.code === 'KeyH') hitboxDebug.toggle();
  // Debug: B spawns an eye-bat in front of you (until they're in the waves).
  if (e.code === 'KeyB') spawnEyebatInFront(game);
  // G: a hellhound.
  if (e.code === 'KeyG') spawnHoundInFront(game);
  // V: a bull.
  if (e.code === 'KeyV') spawnBullInFront(game);
  // L: a sharpshooter (20 m away: it shoots from afar).
  if (e.code === 'KeyL') spawnSharpshooterInFront(game);
  // J: one pickup of each kind (bullets, shells, medkit).
  if (e.code === 'KeyJ') dropPickupsInFront(game);
  // E: open/close the shop, if a vendor is within reach (src/sim/shop.ts).
  // Opening frees the mouse (to click in the panel); closing grabs it back.
  if (e.code === 'KeyE') {
    if (shopMenu.isOpen) {
      closeShop();
    } else {
      const shop = paused ? null : shopInReach(player, world);
      if (shop) {
        shopMenu.open(shop.kind); // first: when the lock is released, updatePause must know
        document.exitPointerLock();
      }
    }
  }
  // Esc with the shop open: the mouse is already free, so the browser doesn't
  // use Esc for itself and we get it: it closes the shop, like E.
  // Esc while waiting for a click to aim again (grabPending): that's a pause.
  // Esc while playing reaches us only in full screen with the Esc key ours
  // (fullscreen.ts): then WE free the mouse, and the pause menu opens. Since
  // the page released it, Esc in the menu may grab it back (menu.ts).
  if (e.code === 'Escape') {
    if (shopMenu.isOpen) {
      closeShop();
    } else if (grabPending) {
      e.preventDefault(); // "used", as above
      grabPending = false;
      updatePause();
    } else if (isPointerLocked()) {
      document.exitPointerLock();
    }
  }
  if (e.code === 'Backquote') {
    debugPanel.toggle();
    document.exitPointerLock();
    updatePause();
  }
});

// --- Player & camera ------------------------------------------------------
// Rotation order 'YXZ': yaw (turn left/right) first, then pitch (look up/down).
// This keeps the horizon level.
camera.rotation.order = 'YXZ';

// --- Menu & settings --------------------------------------------------------
// Saved settings first, so the menu shows (and the game uses) the right values.
loadSettings();
startGame(); // the first game: does it count for the leaderboard? (fairPlay.ts)
const menu = createMenu({ onPlay: () => requestLock(renderer.domElement) });
const shopMenu = createShopMenu({ onCloseClick: () => closeShop() });
// The end-of-game screen (render/endScreen.ts). While it's open the game is
// frozen (updatePause). "Ricomincia" grabs the mouse again: the new game
// starts as soon as the browser gives it to us; "Menu" shows the pause menu.
const endScreen = createEndScreen({
  onRestart: () => {
    endScreen.close();
    updatePause();
    requestLock(renderer.domElement);
  },
  onMenu: () => {
    endScreen.close();
    updatePause();
  },
});

/**
 * Closes the shop and tries to grab the mouse back. The browser grants the
 * Pointer Lock only right after a "user gesture" (a click, a key press: the
 * same rule as audio autoplay). E and the "Chiudi" button ARE gestures. Esc
 * is not, and walking away has none of its own, but a key pressed in the last
 * few seconds still counts (W, to walk away!), so it usually works anyway.
 * When it doesn't, the game does NOT pause: it keeps going, and a line says
 * "click to aim again" (grabPending) until you do.
 */
let grabPending = false;
function closeShop(): void {
  shopMenu.close();
  grabPending = true; // until the mouse is back (onLockChange clears it)
  requestLock(renderer.domElement);
  updatePause();
}

// --- Pause ------------------------------------------------------------------
// Esc already makes the browser release the mouse (pointer lock): we use that
// as the pause signal. No mouse = no game. Exceptions: with the debug panel
// open the game keeps running, so you can tweak values and watch the result;
// and with the SHOP open (docs/DESIGN.md: buying is a race against the horde).
let paused = true; // until the first click
function updatePause(): void {
  // The end screen freezes the game too, but it isn't the pause menu, and
  // the audio keeps going (the funeral bell).
  paused = endScreen.isOpen || (!isPointerLocked() && !debugPanel.visible && !shopMenu.isOpen && !grabPending);
  setAudioPaused(paused && !endScreen.isOpen);
  menu.setOpen(paused && !endScreen.isOpen);
  shopMenu.setGrabHint(grabPending && !isPointerLocked());
}
initInput(renderer.domElement, (locked) => {
  if (locked) {
    initAudio(); // audio is allowed only after a user gesture
    menu.markStarted(); // from now on, the menu means "paused"
    // Got the mouse back while the shop was open (a click on the game): close it.
    if (shopMenu.isOpen) shopMenu.close();
    grabPending = false;
    if (endScreen.isOpen) endScreen.close(); // a click on the game = start again
  }
  updatePause();
});

// Two copies of the player state: the previous tick and the current one.
// The camera is drawn somewhere in between (interpolation).
// `player` is just a shortcut into the game state.
const player = game.player;
const prevPlayer = createPlayer();

// Debug: start from a given spot with ?pos=x,y,z&look=yaw,pitch (degrees)
// in the URL. Handy to jump straight to the thing you're working on.
// ?slow=0.2: slow motion from the start (see debugTime).
if (params.get('slow')) debugTime.timeScale = Number(params.get('slow'));
// ?guns=all: start with every weapon (to try them without going to the shop).
if (params.get('guns') === 'all') for (const w of GEAR) game.player.owned[w] = true; // the shovel too
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
const crosshair = document.getElementById('crosshair')!;
let lastViewYaw = view.yaw;
let lastViewPitch = view.pitch;
let lastTime = performance.now();

renderer.setAnimationLoop((now: number) => {
  // Seconds since the previous frame, capped so a hiccup (e.g. switching tab)
  // doesn't trigger hundreds of ticks in a row ("spiral of death").
  const frameTime = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  updateLook(); // mouse look every frame, for the snappiest aim

  // Paused: the simulation doesn't advance (no time goes into the
  // accumulator) and everything animated by the game gets dt = 0: the scene
  // freezes like a photo, but keeps being drawn (the overlay sits on top).
  const dt = paused ? 0 : frameTime * debugTime.timeScale;
  accumulator += dt;
  const events: SimEvent[] = [];
  while (accumulator >= TICK_DT) {
    copyPlayer(player, prevPlayer);
    const cmd = buildCommand(game.tick);
    if (cmd.respawn) markPractice('respawn col tasto K');
    stepGame(game, cmd, world, TICK_DT, events);
    // The renderer only *reads* the state: "were we in the air, and now we're not?"
    if (!prevPlayer.onGround && player.onGround) triggerLandingDip(-prevPlayer.vy);
    accumulator -= TICK_DT;
  }

  // How far we are between the previous tick (0) and the current one (1).
  const alpha = accumulator / TICK_DT;
  // View angles come straight from the mouse, not from the simulation:
  // interpolating them would add a tick of delay to aiming.
  // (rotation.z, the roll, is set by the camera feel below.)
  // The gun animates first: it also returns the visual "punch" of the shot.
  const viewKick = viewmodel.update(
    dt,
    player,
    camera,
    view.yaw - lastViewYaw,
    view.pitch - lastViewPitch,
  );
  lastViewYaw = view.yaw;
  lastViewPitch = view.pitch;
  camera.rotation.x = view.pitch + viewKick; // the punch is only visual: aim is unaffected
  camera.rotation.y = view.yaw;
  const eyeHeight = updateCameraFeel(camera, player, dt);
  controlSettings.lookScale = lookScale(camera); // zoomed in: slower mouse
  // Aimed down the sights the crosshair goes away: the sights ARE the crosshair.
  crosshair.style.opacity = adsAmount(player) > 0.6 ? '0' : '';
  camera.position.set(
    prevPlayer.x + (player.x - prevPlayer.x) * alpha,
    prevPlayer.y + (player.y - prevPlayer.y) * alpha + eyeHeight - updateLandingDip(dt),
    prevPlayer.z + (player.z - prevPlayer.z) * alpha,
  );
  // The sky follows the camera: you can never get closer to it.
  sky.position.copy(camera.position);

  // Weapon events of this frame → effects and sounds.
  weaponFx.handle(events, camera);
  weaponFx.update(dt);
  targets.handle(events);
  targets.update(dt);
  ghouls.update(game.entities, events, camera, alpha, dt);
  eyebats.update(game.entities, events, camera, alpha, dt);
  hounds.update(game.entities, events, camera, alpha, dt);
  bulls.update(game.entities, events, camera, alpha, dt);
  sharpshooters.update(game.entities, events, camera, alpha, dt);
  updateBurning(game.entities, dt); // "Fiato di drago": burning enemies
  marks.update(game.entities, alpha, dt);
  projectiles.update(game.projectiles, events, camera, alpha, dt);
  pickups.update(game.pickups, camera, alpha, now / 1000);
  vendors.update(camera, now / 1000);
  // Walked away from the vendor (or died, and woke up at the spawn): the shop closes.
  const shopNearby = shopInReach(player, world);
  if (shopMenu.isOpen && !shopNearby) closeShop();
  shopMenu.onEvents(events);
  shopMenu.update(player, shopNearby, paused);
  updateHud(game, events, dt);
  // Game over: send the score (unless it was a practice game, fairPlay.ts)
  // and show the end screen. The simulation has already reset everything for
  // the next game: it waits, frozen, behind the screen. The submit isn't
  // awaited here: the screen gets the Promise and shows the answer when it comes.
  for (const e of events) {
    if (e.type !== 'playerDied') continue;
    const practice = practiceGame();
    // Nothing to send for a practice game or a game with no points.
    const placement = practice || e.stats.score <= 0
      ? null
      : submitScore({ name: settings.playerName, score: e.stats.score, wave: e.wave, kills: e.stats.kills });
    if (shopMenu.isOpen) shopMenu.close();
    grabPending = false;
    endScreen.open({ wave: e.wave, stats: e.stats, playerName: settings.playerName, practice, placement });
    document.exitPointerLock(); // free the mouse for the buttons
    updatePause();
    startGame(); // fairPlay: the next game starts clean
  }
  updateThreats(game.entities, player, camera, dt);
  navDebug.update(getFlowField(getNavGraph(world), game.navGoal));
  navDebugBig.update(getFlowField(getNavGraph(world, BIG_BODY), game.navGoalBig));
  hitboxDebug.update(game.entities);
  updateAmmoHud(player);
  updateWeaponBar(player);
  updateMoneyHud(game.player.money, dt);
  // The map: only while Tab is held, never over the pause menu.
  mapOverlay.update(game, alpha, camera.position.x, camera.position.z, view.yaw, isKeyDown('Tab') && !paused, now / 1000);

  updateFireLights(now / 1000);
  props.update(now / 1000);
  updateParticles(dt, now / 1000, camera, post.sceneSize.y);
  post.render(scene, camera, viewmodel);
});
