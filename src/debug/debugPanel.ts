// The game's debug panel: which values can be tweaked live, and their ranges.
// To expose a new value, add one line here.
import { tuning } from '../sim/config';
import { postSettings } from '../render/postprocess';
import { cameraFeelSettings } from '../render/cameraFeel';
import { viewmodelSettings } from '../render/weapons/viewmodel';
import { recoilSettings, type RecoilKind } from '../render/weapons/recoil';
import { fanSettings } from '../render/weapons/hands';
import { shovelSettings } from '../render/weapons/shovelView';
import { hitStopSettings } from '../render/hitStop';
import type { Atmosphere } from '../render/atmospheres';
import { copyToClipboard, createPanel, toSource, type Folder } from './panel';
import { checkTuning, markPractice } from '../fairPlay';

const ATMOSPHERE_COLORS = [
  'skyTop',
  'skyHorizon',
  'sunColor',
  'sunLightColor',
  'lanternColor',
  'dustColor',
  'ambientSky',
  'ambientGround',
];

export interface DebugPanel {
  toggle(): void;
  readonly visible: boolean;
  /** Rebuilds the atmosphere section for the preset now in use. */
  showAtmosphere(a: Atmosphere): void;
}

/**
 * Slow motion, to look at animations frame by frame: the time of each frame
 * is multiplied by this before going to the simulation and the effects
 * (main.ts). The sounds aren't slowed: they go out of sync. Also from the
 * URL: ?slow=0.2.
 */
export const debugTime = { timeScale: 1 };

/** A debug action shown as a button in the "Debug tools" folder (they used to be hotkeys). */
export interface DebugTool {
  label: string;
  run: () => void;
}

export function createDebugPanel(options: {
  /** The buttons of the "Debug tools" folder, in order (defined in main.ts, next to what they touch). */
  tools: DebugTool[];
  onAtmosphereChange: () => void;
  onPostSizeChange: () => void;
  /** Debug: clear the enemies and start wave n. */
  onJumpToWave: (wave: number) => void;
  /** Debug: vildenaro for free, to try the shop. */
  onGiveMoney: (amount: number) => void;
  /** Debug: one Damned Iron for free, to try the Forge. */
  onGiveIron: () => void;
}): DebugPanel {
  const panel = createPanel();
  // Any control moved in the panel: check whether the tuning still matches
  // config.ts (fairPlay.ts). One listener on the panel's root catches the
  // 'input' events of every slider and box inside it: event delegation,
  // the same trick as $(document).on('input', ...) in jQuery.
  document.getElementById('debug-panel')!.addEventListener('input', checkTuning);

  // --- Debug tools: spawn enemies, toggle debug views, respawn (src/main.ts) ---
  const tools = panel.folder('Debug tools (src/main.ts)');
  for (const tool of options.tools) tools.button(tool.label, tool.run);

  // --- Waves (first: it's the one you use most while testing) ---
  const waves = panel.folder('Waves (src/sim/waves.ts)');
  const jump = { wave: 10 };
  waves.number(jump, 'wave', 1, 60, 1);
  waves.button('Go to this wave', () => options.onJumpToWave(jump.wave));
  waves.number(tuning, 'mapEventGapMin', 1, 10, 1);
  waves.number(tuning, 'mapEventGapMax', 1, 10, 1);
  waves.number(tuning, 'ghoulSpawnWeight', 0, 30, 1);
  waves.number(tuning, 'eyebatSpawnWeight', 0, 30, 1);
  waves.number(tuning, 'houndSpawnWeight', 0, 30, 1);
  waves.number(tuning, 'bullSpawnWeight', 0, 30, 1);
  waves.number(tuning, 'sharpshooterSpawnWeight', 0, 30, 1);

  // --- Time ---
  const time = panel.folder('Time (slow motion, src/main.ts)');
  time.number(debugTime, 'timeScale', 0.02, 1, 0.01, () => markPractice('rallentatore'));

  // --- Shop ---
  const shop = panel.folder('Shop (src/sim/config.ts, src/sim/shop.ts)');
  shop.number(tuning, 'shopReach', 1, 6, 0.1);
  shop.number(tuning, 'shotgunPrice', 0, 3000, 50);
  shop.number(tuning, 'riflePrice', 0, 3000, 50);
  shop.number(tuning, 'dynamitePrice', 0, 3000, 50);
  shop.number(tuning, 'shovelPrice', 0, 3000, 50);
  shop.button('+500 vildenaro', () => options.onGiveMoney(500));
  shop.button('+1 Ferro Dannato', () => options.onGiveIron());
  shop.number(tuning, 'forgeDamageMultiplier', 1, 5, 0.5);
  shop.number(tuning, 'upgradeBasePrice', 0, 3000, 50);
  shop.number(tuning, 'upgradePriceGrowth', 1, 4, 0.1);
  shop.number(tuning, 'upgradeMaxLevel', 0, 6, 1);
  shop.number(tuning, 'upgradeOfferSize', 1, 5, 1);
  shop.number(tuning, 'undertakerExtraRounds', 0, 6, 1);
  shop.number(tuning, 'fastCylinderReloadScale', 0.2, 1, 0.01);
  shop.number(tuning, 'slideReloadInterval', 0.05, 1, 0.01);
  shop.number(tuning, 'quickHandSpreadScale', 0, 1, 0.05);
  shop.number(tuning, 'quickHandIntervalScale', 0.2, 1, 0.05);
  shop.number(tuning, 'ricochetRange', 1, 40, 1);
  shop.number(tuning, 'ricochetDamage', 0, 300, 5);
  shop.number(tuning, 'lastShotRadius', 0.5, 8, 0.1);
  shop.number(tuning, 'lastShotDamage', 0, 400, 5);
  shop.number(tuning, 'longBarrelsSpreadScale', 0.2, 1, 0.05);
  shop.number(tuning, 'longBarrelsFalloffExtra', 0, 10, 0.5);
  shop.number(tuning, 'dragonBurnTime', 0, 6, 0.1);
  shop.number(tuning, 'dragonBurnInterval', 0.1, 2, 0.05);
  shop.number(tuning, 'dragonBurnDamage', 0, 100, 1);
  shop.number(tuning, 'muleRecoilScale', 1, 4, 0.1);
  shop.number(tuning, 'leadStockKnockbackScale', 1, 4, 0.1);
  shop.number(tuning, 'leadStockSlamDamage', 0, 300, 5);
  shop.number(tuning, 'groupPushRadius', 0.5, 6, 0.1);
  shop.number(tuning, 'groupPushScale', 0, 1.5, 0.05);
  shop.number(tuning, 'duelistTime', 0.2, 5, 0.1);
  shop.number(tuning, 'duelistMultiplier', 1, 4, 0.1);
  shop.number(tuning, 'gunslingerLeverScale', 0.3, 1, 0.05);
  shop.number(tuning, 'scopeCritMultiplier', 1, 10, 0.5);
  shop.number(tuning, 'quickscopeWindow', 0.05, 1, 0.01);
  shop.number(tuning, 'markMultiplier', 1, 4, 0.1);
  shop.number(tuning, 'shortFuseScale', 0.1, 1, 0.05);
  shop.number(tuning, 'powderKegRadiusScale', 1, 3, 0.05);
  shop.number(tuning, 'hellBounceBonus', 0, 1, 0.05);
  shop.number(tuning, 'hellBounceMax', 0, 10, 1);
  shop.number(tuning, 'rocketSpeedScale', 1, 3, 0.05);
  shop.number(tuning, 'rocketTime', 0, 2, 0.05);
  shop.number(tuning, 'rocketSelfPushScale', 1, 3, 0.05);
  shop.number(tuning, 'clusterCount', 0, 8, 1);
  shop.number(tuning, 'clusterSpeed', 0, 15, 0.5);
  shop.number(tuning, 'clusterLift', 0, 15, 0.5);
  shop.number(tuning, 'clusterFuse', 0.1, 2, 0.05);
  shop.number(tuning, 'clusterStagger', 0, 0.5, 0.01);
  shop.number(tuning, 'clusterRadius', 0.5, 5, 0.1);
  shop.number(tuning, 'clusterDamageScale', 0, 1, 0.05);

  // --- Style meter ---
  const style = panel.folder('Style (src/sim/config.ts, src/sim/style.ts)');
  style.number(tuning, 'styleChainTime', 0.5, 10, 0.1);
  style.number(tuning, 'styleRankPoints', 20, 1000, 10);
  style.number(tuning, 'styleHit', 0, 50, 1);
  style.number(tuning, 'styleKill', 0, 200, 5);
  style.number(tuning, 'styleHeadshotKill', 0, 200, 5);
  style.number(tuning, 'styleHurtPerDamage', 0, 20, 0.5);
  style.number(tuning, 'styleAirKill', 0, 200, 5);
  style.number(tuning, 'styleSlideKill', 0, 200, 5);
  style.number(tuning, 'styleKickKill', 0, 200, 5);
  style.number(tuning, 'styleQuickSwitchKill', 0, 200, 5);
  style.number(tuning, 'styleQuickSwitchTime', 0, 3, 0.05);
  style.number(tuning, 'styleQuickscope', 0, 200, 5);
  style.number(tuning, 'styleQuickscopeTime', 0.1, 2, 0.05);
  style.number(tuning, 'styleNoscope', 0, 200, 5);
  style.number(tuning, 'styleNoscopeDistance', 0, 60, 1);
  style.number(tuning, 'stylePointBlank', 0, 200, 5);
  style.number(tuning, 'stylePointBlankDistance', 0, 10, 0.25);
  style.number(tuning, 'styleLongShot', 0, 200, 5);
  style.number(tuning, 'styleLongShotDistance', 5, 100, 1);
  style.number(tuning, 'styleLastRound', 0, 200, 5);
  style.number(tuning, 'styleCloseCall', 0, 200, 5);
  style.number(tuning, 'styleCloseCallHealth', 0, 100, 5);
  style.number(tuning, 'styleMultiKill', 0, 200, 5);
  style.number(tuning, 'styleStreakTime', 0.2, 5, 0.1);
  style.number(tuning, 'styleStreak', 0, 200, 5);
  style.number(tuning, 'styleSpeedMin', 0, 30, 0.5);
  style.number(tuning, 'styleSpeed', 0, 100, 1);
  style.number(tuning, 'styleAirTimeMin', 0, 5, 0.1);
  style.number(tuning, 'styleAirTime', 0, 200, 5);
  style.number(tuning, 'styleWallJump', 0, 100, 1);
  style.number(tuning, 'styleBhop', 0, 100, 1);
  style.number(tuning, 'styleSlideJump', 0, 100, 1);
  style.number(tuning, 'styleVent', 0, 100, 1);
  style.number(tuning, 'styleNearMiss', 0, 200, 5);
  style.number(tuning, 'styleNearMissDistance', 0, 5, 0.1);
  style.number(tuning, 'styleTorero', 0, 200, 5);
  style.number(tuning, 'styleToreroDistance', 0, 10, 0.25);
  style.number(tuning, 'styleRepeatFactor', 0.3, 1, 0.05);
  style.number(tuning, 'styleRepeatMin', 0, 1, 0.05);
  style.number(tuning, 'styleRepeatRecover', 0, 1, 0.01);
  style.number(tuning, 'styleHighNoonTime', 1, 20, 0.5);
  style.number(tuning, 'styleMultiplierPerRank', 0, 2, 0.05);
  style.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Movement ---
  const move = panel.folder('Movement (src/sim/config.ts)');
  move.number(tuning, 'maxGroundSpeed', 2, 25, 0.1);
  move.number(tuning, 'groundAccel', 1, 40, 0.5);
  move.number(tuning, 'groundFriction', 0, 20, 0.5);
  move.number(tuning, 'stopSpeed', 0, 6, 0.1);
  move.number(tuning, 'gravity', 5, 50, 0.5);
  move.number(tuning, 'jumpSpeed', 2, 15, 0.1);
  move.boolean(tuning, 'enemyBodyBlock');
  move.boolean(tuning, 'autoBhop');
  move.number(tuning, 'coyoteTime', 0, 0.3, 0.01);
  move.number(tuning, 'jumpBufferTime', 0, 0.3, 0.01);
  move.number(tuning, 'airAccel', 0, 50, 0.5);
  move.number(tuning, 'airSpeedCap', 0, 10, 0.1);
  move.number(tuning, 'airControl', 0, 20, 0.5);
  move.number(tuning, 'bhopGraceTime', 0, 0.4, 0.01);
  move.number(tuning, 'bhopBoost', 0, 4, 0.1);
  move.number(tuning, 'bhopBoostFalloff', 4, 30, 0.5);
  move.number(tuning, 'eyeHeight', 1, 1.8, 0.05);
  move.number(tuning, 'crouchEyeHeight', 0.4, 1.2, 0.05);
  move.number(tuning, 'crouchSpeed', 1, 8, 0.1);
  move.number(tuning, 'slideStartSpeed', 1, 12, 0.1);
  move.number(tuning, 'slideBoost', 0, 10, 0.1);
  move.number(tuning, 'slideBoostMaxSpeed', 5, 30, 0.5);
  move.number(tuning, 'slideBoostCooldown', 0, 2, 0.05);
  move.number(tuning, 'slideFriction', 0, 5, 0.05);
  move.number(tuning, 'slideStopSpeed', 0, 8, 0.1);
  move.number(tuning, 'slideSteer', 0, 30, 0.5);
  move.number(tuning, 'wallJumpReach', 0.05, 1, 0.05);
  move.number(tuning, 'wallJumpUp', 0, 15, 0.1);
  move.number(tuning, 'wallJumpPush', 0, 15, 0.1);
  move.number(tuning, 'wallJumpBoost', 0, 10, 0.1);
  move.number(tuning, 'wallJumpsMax', 0, 10, 1);
  move.number(tuning, 'wallJumpCooldown', 0, 1, 0.05);
  move.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Weapon ---
  const gun = panel.folder('Revolver (src/sim/config.ts + render/weapons/viewmodel.ts)');
  gun.number(tuning, 'revolverFireInterval', 0.05, 1, 0.01);
  gun.number(tuning, 'revolverFireBuffer', 0, 0.3, 0.01);
  gun.number(tuning, 'revolverReloadTime', 0.2, 3, 0.05);
  gun.number(tuning, 'revolverAmmo', 1, 12, 1);
  gun.boolean(tuning, 'infiniteAmmo');
  gun.number(tuning, 'revolverReserveStart', 0, 200, 1);
  gun.number(tuning, 'revolverReserveMax', 0, 200, 1);
  gun.number(tuning, 'revolverDamage', 5, 200, 5);
  gun.number(tuning, 'revolverFanInterval', 0.02, 0.3, 0.01);
  gun.number(tuning, 'revolverFanSpread', 0, 20, 0.5);
  gun.number(tuning, 'revolverFanRecovery', 0, 1, 0.05);
  gun.number(tuning, 'headshotMultiplier', 1, 5, 0.25);
  const drops = panel.folder('Drops (src/sim/config.ts + pickups.ts)');
  drops.number(tuning, 'dropChancePerWeight', 0, 1, 0.05);
  drops.number(tuning, 'dropChanceMax', 0, 1, 0.05);
  drops.number(tuning, 'dropWeightBullets', 0, 10, 1);
  drops.number(tuning, 'dropWeightShells', 0, 10, 1);
  drops.number(tuning, 'dropWeightMedkit', 0, 10, 1);
  drops.number(tuning, 'dropWeightSticks', 0, 10, 1);
  drops.number(tuning, 'dropLifetime', 1, 60, 1);
  drops.number(tuning, 'pickupRadius', 0.3, 3, 0.1);
  drops.number(tuning, 'pickupReachBelow', 0, 4, 0.1);
  drops.number(tuning, 'pickupReachAbove', 0, 3, 0.1);
  drops.number(tuning, 'medkitHeal', 5, 100, 5);
  drops.number(tuning, 'ammoPickupBullets', 0, 36, 1);
  drops.number(tuning, 'ammoPickupShells', 0, 12, 1);
  drops.number(tuning, 'ammoPickupSticks', 0, 10, 1);
  drops.number(tuning, 'coinsPerWeight', 0, 5, 1);
  drops.number(tuning, 'coinValue', 1, 100, 1);
  drops.number(tuning, 'dropBurstSpeedMin', 0, 10, 0.5);
  drops.number(tuning, 'dropBurstSpeedMax', 0, 10, 0.5);
  drops.number(tuning, 'dropBurstUp', 0, 15, 0.5);
  drops.number(tuning, 'dropBounce', 0, 0.9, 0.05);
  drops.number(tuning, 'dropBounceMinSpeed', 0, 10, 0.5);
  drops.number(tuning, 'coinLifetime', 1, 60, 1);

  const sg = panel.folder('Shotgun (src/sim/config.ts + render/weapons/viewmodel.ts, shotgunView.ts)');
  sg.number(tuning, 'shotgunPellets', 1, 30, 1);
  sg.number(tuning, 'shotgunSpreadHorizontal', 0, 25, 0.5);
  sg.number(tuning, 'shotgunSpreadVertical', 0, 25, 0.5);
  sg.number(tuning, 'shotgunPelletDamage', 1, 50, 1);
  sg.number(tuning, 'shotgunFalloffStart', 0, 30, 0.5);
  sg.number(tuning, 'shotgunFalloffEnd', 1, 60, 0.5);
  sg.number(tuning, 'shotgunFalloffMin', 0, 1, 0.05);
  sg.number(tuning, 'shotgunHeadshotMultiplier', 1, 3, 0.1);
  sg.number(tuning, 'shotgunFireInterval', 0.05, 1, 0.01);
  sg.number(tuning, 'shotgunReloadTime', 0.3, 3, 0.05);
  sg.number(tuning, 'shotgunReserveStart', 0, 60, 1);
  sg.number(tuning, 'shotgunReserveMax', 0, 60, 1);
  sg.number(tuning, 'shotgunSelfPush', 0, 20, 0.5);
  sg.number(tuning, 'shotgunKnockbackRange', 0, 15, 0.5);
  sg.number(tuning, 'shotgunKnockback', 0, 40, 0.5);
  sg.number(tuning, 'shotgunKnockbackLift', 0, 15, 0.5);
  sg.number(tuning, 'shotgunKnockbackMin', 0, 1, 0.05);
  sg.number(tuning, 'weaponSwitchTime', 0, 1, 0.05);
  sg.number(viewmodelSettings, 'shotgunX', -0.3, 0.3, 0.005);
  sg.number(viewmodelSettings, 'shotgunY', -0.3, 0.1, 0.005);
  sg.number(viewmodelSettings, 'shotgunZ', -0.6, 0, 0.005);
  sg.number(viewmodelSettings, 'shotgunPitch', -0.5, 1, 0.01);
  sg.number(viewmodelSettings, 'shotgunYaw', -0.3, 0.3, 0.005);
  sg.number(viewmodelSettings, 'shotgunRoll', -0.5, 0.5, 0.01);
  // The pump-action (the Forge's shotgun, render/weapons/pumpView.ts).
  sg.number(tuning, 'pumpAmmo', 1, 10, 1);
  sg.number(tuning, 'pumpFireInterval', 0.2, 1.5, 0.01);
  sg.number(tuning, 'pumpReloadStart', 0, 1, 0.01);
  sg.number(tuning, 'pumpReloadPerShell', 0.1, 1, 0.01);
  sg.number(tuning, 'pumpReloadClose', 0, 0.5, 0.01);
  sg.number(viewmodelSettings, 'pumpX', -0.3, 0.3, 0.005);
  sg.number(viewmodelSettings, 'pumpY', -0.3, 0.1, 0.005);
  sg.number(viewmodelSettings, 'pumpZ', -0.6, 0, 0.005);
  sg.number(viewmodelSettings, 'pumpPitch', -0.5, 1, 0.01);
  sg.number(viewmodelSettings, 'pumpYaw', -0.3, 0.3, 0.005);
  sg.number(viewmodelSettings, 'pumpRoll', -0.5, 0.5, 0.01);
  const dyn = panel.folder('Dynamite (src/sim/config.ts + dynamite.ts, explosion.ts, render/weapons/dynamiteView.ts)');
  dyn.number(tuning, 'dynamiteSpeed', 5, 50, 0.5);
  dyn.number(tuning, 'dynamiteLift', 0, 10, 0.25);
  dyn.number(tuning, 'dynamiteInherit', 0, 1, 0.05);
  dyn.number(tuning, 'dynamiteFuse', 0.2, 5, 0.05);
  dyn.number(tuning, 'dynamiteBounce', 0, 1, 0.05);
  dyn.number(tuning, 'dynamiteBounceGrip', 0, 1, 0.05);
  dyn.number(tuning, 'dynamiteBounceMinSpeed', 0, 10, 0.25);
  dyn.number(tuning, 'dynamiteRollFriction', 0, 30, 0.5);
  dyn.number(tuning, 'dynamiteRadius', 0.5, 10, 0.1);
  dyn.number(tuning, 'dynamiteDamage', 0, 600, 5);
  dyn.number(tuning, 'dynamiteEdgeDamage', 0, 1, 0.05);
  dyn.number(tuning, 'dynamiteKnockback', 0, 30, 0.5);
  dyn.number(tuning, 'dynamiteKnockbackLift', 0, 20, 0.5);
  dyn.number(tuning, 'dynamiteSelfPush', 0, 30, 0.5);
  dyn.number(tuning, 'dynamiteSmithScale', 0, 1, 0.05);
  // The Forge's holy-water sticks (sim/holyFire.ts).
  dyn.number(tuning, 'holyFireRadius', 0.5, 6, 0.1);
  dyn.number(tuning, 'holyFireTime', 0.5, 15, 0.5);
  dyn.number(tuning, 'holyBurnTime', 0, 5, 0.1);
  dyn.number(tuning, 'holyBurnInterval', 0.1, 2, 0.05);
  dyn.number(tuning, 'holyBurnDamage', 0, 100, 1);
  dyn.number(cameraFeelSettings, 'blastShake', 0, 8, 0.1);
  // The launcher in your hand (render/weapons/dynamiteView.ts): its rest pose.
  dyn.number(viewmodelSettings, 'dynamiteX', -0.3, 0.3, 0.005);
  dyn.number(viewmodelSettings, 'dynamiteY', -0.3, 0.1, 0.005);
  dyn.number(viewmodelSettings, 'dynamiteZ', -0.6, 0, 0.005);
  dyn.number(viewmodelSettings, 'dynamitePitch', -0.5, 0.5, 0.01);
  dyn.number(viewmodelSettings, 'dynamiteYaw', -0.5, 0.5, 0.005);
  dyn.number(viewmodelSettings, 'dynamiteRoll', -0.5, 0.5, 0.01);
  dyn.number(viewmodelSettings, 'dynamiteHandPitch', -1, 1, 0.01);
  dyn.number(viewmodelSettings, 'dynamiteHandYaw', -1, 1, 0.01);
  dyn.number(viewmodelSettings, 'dynamiteHandRoll', -1, 1, 0.01);

  const rifle = panel.folder('Carbine (src/sim/config.ts + render/weapons/viewmodel.ts, rifleView.ts)');
  rifle.number(tuning, 'rifleDamage', 5, 300, 5);
  rifle.number(tuning, 'rifleHeadshotMultiplier', 1, 6, 0.25);
  rifle.number(tuning, 'rifleFireInterval', 0.2, 1.5, 0.01);
  rifle.number(tuning, 'rifleHipSpread', 0, 10, 0.25);
  rifle.number(tuning, 'rifleAdsTime', 0, 0.5, 0.01);
  rifle.number(tuning, 'rifleAmmo', 1, 15, 1);
  rifle.number(tuning, 'rifleReloadStart', 0, 1, 0.01);
  rifle.number(tuning, 'rifleReloadPerRound', 0.1, 1, 0.01);
  rifle.number(tuning, 'rifleReloadInterrupt', 0, 0.5, 0.01);
  rifle.number(tuning, 'rifleBuyBullets', 0, 72, 1);
  rifle.number(cameraFeelSettings, 'adsFov', 20, 75, 1);
  rifle.number(cameraFeelSettings, 'opticAdsFov', 10, 75, 1);
  rifle.number(viewmodelSettings, 'rifleScopeAdsY', -0.2, 0, 0.001);
  rifle.number(viewmodelSettings, 'rifleScopeAdsZ', -0.5, 0, 0.005);
  rifle.number(viewmodelSettings, 'rifleX', -0.3, 0.3, 0.005);
  rifle.number(viewmodelSettings, 'rifleY', -0.3, 0.1, 0.005);
  rifle.number(viewmodelSettings, 'rifleZ', -0.6, 0, 0.005);
  rifle.number(viewmodelSettings, 'riflePitch', -0.5, 0.5, 0.01);
  rifle.number(viewmodelSettings, 'rifleYaw', -0.3, 0.3, 0.005);
  rifle.number(viewmodelSettings, 'rifleRoll', -0.5, 0.5, 0.01);
  rifle.number(viewmodelSettings, 'rifleAdsY', -0.15, 0, 0.001);
  rifle.number(viewmodelSettings, 'rifleAdsZ', -0.4, 0, 0.005);
  rifle.number(viewmodelSettings, 'rifleAdsRecoil', 0, 1, 0.05);
  // The shot's kick of every gun: the gun in your hand and your view (render/weapons/recoil.ts).
  const kinds: RecoilKind[] = ['revolver', 'shotgun', 'pump', 'rifle'];
  for (const kind of kinds) {
    const r = recoilSettings[kind];
    const recoil = panel.folder(`Recoil: ${kind} (render/weapons/recoil.ts)`);
    recoil.number(r, 'up', 0, 1.5, 0.01);
    recoil.number(r, 'back', 0, 0.3, 0.005);
    recoil.number(r, 'rise', 0, 0.1, 0.002);
    recoil.number(r, 'twist', -0.5, 0.5, 0.01);
    recoil.number(r, 'scatter', 0, 0.3, 0.005);
    recoil.number(r, 'stiffness', 50, 3000, 10);
    recoil.number(r, 'bounce', 0.1, 1.5, 0.02);
    recoil.number(r, 'snap', 0, 1, 0.05);
    recoil.number(r, 'view', 0, 0.2, 0.005);
    recoil.number(r, 'viewRoll', 0, 0.1, 0.002);
    recoil.number(r, 'fov', 0, 15, 0.25);
  }
  const shotView = panel.folder('Recoil: the view (render/cameraFeel.ts)');
  shotView.number(cameraFeelSettings, 'shotStiffness', 50, 3000, 10);
  shotView.number(cameraFeelSettings, 'shotDamping', 0.1, 1.5, 0.02);
  shotView.number(cameraFeelSettings, 'shotSnap', 0, 1, 0.05);
  shotView.button('Copy recoil values', () => copyToClipboard(toSource(recoilSettings)));
  const kick = panel.folder('Kick (src/sim/config.ts, src/sim/kick.ts)');
  kick.number(tuning, 'kickWindup', 0, 0.3, 0.01);
  kick.number(tuning, 'kickCooldown', 0.1, 2, 0.05);
  kick.number(tuning, 'kickRange', 0.3, 4, 0.1);
  kick.number(tuning, 'kickAngle', 10, 90, 1);
  kick.number(tuning, 'kickDamage', 0, 200, 5);
  kick.number(tuning, 'kickKnockback', 0, 30, 0.5);
  kick.number(tuning, 'kickLift', 0, 15, 0.5);
  kick.number(tuning, 'kickStun', 0, 2, 0.05);

  const shovel = panel.folder('Shovel (src/sim/config.ts, src/sim/kick.ts)');
  shovel.number(tuning, 'shovelWindup', 0, 0.4, 0.01);
  shovel.number(tuning, 'shovelGunBack', 0.1, 1, 0.01);
  shovel.number(tuning, 'shovelCooldown', 0.1, 2, 0.05);
  shovel.number(tuning, 'shovelRange', 0.3, 5, 0.1);
  shovel.number(tuning, 'shovelAngle', 10, 120, 1);
  shovel.number(tuning, 'shovelDamage', 0, 300, 5);
  shovel.number(tuning, 'shovelKnockback', 0, 40, 0.5);
  shovel.number(tuning, 'shovelLift', 0, 15, 0.5);
  // The swing on screen (render/weapons/shovelView.ts).
  shovel.number(shovelSettings, 'gunDownTime', 0.02, 0.3, 0.01);
  shovel.number(shovelSettings, 'gunDownDrop', 0, 0.8, 0.01);
  shovel.number(shovelSettings, 'gunDownTilt', 0, 2, 0.05);
  shovel.number(shovelSettings, 'gripX', -0.5, 0.5, 0.01);
  shovel.number(shovelSettings, 'gripY', -0.8, 0, 0.01);
  shovel.number(shovelSettings, 'gripZ', -0.6, 0.2, 0.01);
  shovel.number(shovelSettings, 'gripSwing', 0, 0.5, 0.01);
  shovel.number(shovelSettings, 'gripRise', -0.2, 0.5, 0.01);
  shovel.number(shovelSettings, 'gripBack', -0.2, 0.6, 0.01);
  shovel.number(shovelSettings, 'backYaw', -3.2, 0, 0.05);
  shovel.number(shovelSettings, 'backPitch', -0.5, 2.5, 0.05);
  shovel.number(shovelSettings, 'impactYaw', -1, 1, 0.01);
  shovel.number(shovelSettings, 'impactPitch', -0.8, 1, 0.01);
  shovel.number(shovelSettings, 'throughYaw', 0, 3.2, 0.05);
  shovel.number(shovelSettings, 'throughPitch', -0.5, 2.5, 0.05);
  shovel.number(shovelSettings, 'roll', -3.2, 3.2, 0.05);
  shovel.number(shovelSettings, 'rollTwist', -1.5, 1.5, 0.05);
  shovel.number(shovelSettings, 'windBack', 0, 1, 0.01);
  shovel.number(shovelSettings, 'backShare', 0.1, 0.9, 0.05);
  shovel.number(shovelSettings, 'strikeEase', 1, 4, 0.1);
  shovel.number(shovelSettings, 'throughEase', 1, 8, 0.1);
  shovel.number(shovelSettings, 'throughTime', 0.05, 0.6, 0.01);
  shovel.number(shovelSettings, 'quiverKick', 0, 30, 0.5);
  shovel.number(shovelSettings, 'quiverStiffness', 100, 5000, 50);
  shovel.number(shovelSettings, 'quiverDamping', 1, 60, 0.5);
  shovel.number(shovelSettings, 'variation', 0, 0.5, 0.01);
  // Feel of the impact: camera dip (viewmodel.ts) and hit-stop (render/hitStop.ts).
  shovel.number(viewmodelSettings, 'shovelViewPunch', 0, 0.2, 0.005);
  shovel.number(hitStopSettings, 'shovel', 0, 0.2, 0.005);
  shovel.number(hitStopSettings, 'perExtraHit', 0, 0.05, 0.005);
  shovel.number(hitStopSettings, 'max', 0, 0.3, 0.01);
  gun.number(viewmodelSettings, 'fov', 30, 100, 1);
  gun.number(viewmodelSettings, 'x', -0.3, 0.3, 0.005);
  gun.number(viewmodelSettings, 'y', -0.3, 0.1, 0.005);
  gun.number(viewmodelSettings, 'z', -0.6, -0.1, 0.005);
  gun.number(viewmodelSettings, 'sway', 0, 2, 0.05);
  gun.number(viewmodelSettings, 'bob', 0, 0.04, 0.001);
  gun.number(fanSettings, 'strikeTime', 0.05, 0.3, 0.01);
  gun.number(fanSettings, 'readyHold', 0, 3, 0.05);
  gun.number(fanSettings, 'raiseRate', 2, 60, 1);
  gun.number(fanSettings, 'lowerRate', 1, 30, 0.5);
  gun.button('Copy viewmodel values', () => copyToClipboard(toSource(viewmodelSettings)));

  // --- Ghouls ---
  const ghoul = panel.folder('Ghoul (src/sim/config.ts)');
  ghoul.boolean(tuning, 'wavesEnabled');
  ghoul.number(tuning, 'waveBaseCount', 1, 30, 1);
  ghoul.number(tuning, 'waveMaxAliveCap', 1, 60, 1);
  ghoul.number(tuning, 'waveHealthStep', 1, 30, 1);
  ghoul.number(tuning, 'waveHealthMaxMultiplier', 1, 10, 1);
  ghoul.number(tuning, 'wavePeak', 2, 80, 1);
  ghoul.number(tuning, 'peakShootIntervalFactor', 0.1, 1, 0.05);
  ghoul.number(tuning, 'peakLungeCooldownFactor', 0.1, 1, 0.05);
  ghoul.number(tuning, 'peakRunnerChance', 0, 1, 0.05);
  ghoul.number(tuning, 'ghoulHeadHeight', 0.8, 1.8, 0.05);
  ghoul.number(tuning, 'ghoulHitWidth', 0.3, 2.5, 0.05);
  ghoul.number(tuning, 'ghoulHitHeight', 1, 3, 0.05);
  ghoul.number(tuning, 'waveBreak', 0, 30, 0.5);
  ghoul.number(tuning, 'spawnMinDistance', 0, 40, 1);
  ghoul.number(tuning, 'spawnMaxDistance', 10, 100, 1);
  ghoul.number(tuning, 'spawnAheadChance', 0, 1, 0.05);
  ghoul.number(tuning, 'ghoulRunnerSpeed', 1, 12, 0.1);
  ghoul.number(tuning, 'ghoulSpeed', 0.5, 10, 0.1);
  ghoul.number(tuning, 'ghoulAccel', 1, 20, 0.5);
  ghoul.number(tuning, 'ghoulHealth', 10, 500, 5);
  ghoul.number(tuning, 'ghoulJumpHeight', 0, 2, 0.05);
  ghoul.number(tuning, 'ghoulSeparation', 0, 3, 0.05);
  ghoul.number(tuning, 'ghoulAttackRange', 0.5, 3, 0.05);
  ghoul.number(tuning, 'ghoulAttackMoveFactor', 0, 1, 0.05);
  ghoul.number(tuning, 'ghoulDirectChaseRange', 0, 15, 0.5);
  ghoul.number(tuning, 'ghoulPursuitRange', 0, 60, 1);
  ghoul.number(tuning, 'ghoulPursuitLead', 0, 1.5, 0.05);
  ghoul.number(tuning, 'ghoulPursuitMaxLead', 0, 4, 0.1);
  ghoul.number(tuning, 'ghoulFlankDistance', 0, 15, 0.5);
  ghoul.number(tuning, 'ghoulDamage', 1, 100, 1);
  ghoul.number(tuning, 'ghoulLungeMinRange', 0, 6, 0.1);
  ghoul.number(tuning, 'ghoulLungeRange', 0, 15, 0.1);
  ghoul.number(tuning, 'ghoulLungeWindup', 0.05, 1.5, 0.05);
  ghoul.number(tuning, 'ghoulLungeSpeed', 2, 30, 0.5);
  ghoul.number(tuning, 'ghoulLungeUpSpeed', 0, 12, 0.1);
  ghoul.number(tuning, 'ghoulLungeLead', 0, 1.2, 0.05);
  ghoul.number(tuning, 'ghoulLungeReach', 0, 1, 0.05);
  ghoul.number(tuning, 'ghoulLungeDamage', 1, 100, 1);
  ghoul.number(tuning, 'ghoulLungeRecover', 0, 2, 0.05);
  ghoul.number(tuning, 'ghoulLungeCooldown', 0, 10, 0.1);
  ghoul.number(tuning, 'ghoulCost', 1, 10, 1);
  ghoul.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Eye-bat ---
  const eyebat = panel.folder('Malocchio / eye-bat (src/sim/config.ts)');
  eyebat.number(tuning, 'eyebatHealth', 10, 500, 5);
  eyebat.number(tuning, 'eyebatCost', 1, 10, 1);
  eyebat.number(tuning, 'eyebatFromWave', 1, 30, 1);
  eyebat.number(tuning, 'eyebatPupilRadius', 0.02, 0.6, 0.01);
  eyebat.number(tuning, 'eyebatHitRadius', 0.2, 1.5, 0.05);
  eyebat.number(tuning, 'eyebatSpeed', 0.5, 15, 0.1);
  eyebat.number(tuning, 'eyebatAccel', 0.5, 10, 0.1);
  eyebat.number(tuning, 'eyebatOrbitDistance', 2, 30, 0.5);
  eyebat.number(tuning, 'eyebatHoverHeight', 0, 15, 0.5);
  eyebat.number(tuning, 'eyebatOrbitSpeed', 0, 2, 0.05);
  eyebat.number(tuning, 'eyebatSeparation', 0, 6, 0.1);
  eyebat.number(tuning, 'eyebatLeadFactor', 0, 1.2, 0.05);
  eyebat.number(tuning, 'eyebatShootInterval', 0.5, 6, 0.1);
  eyebat.number(tuning, 'eyebatChargeTime', 0.1, 2, 0.05);
  eyebat.number(tuning, 'eyebatProjectileSpeed', 4, 40, 0.5);
  eyebat.number(tuning, 'eyebatProjectileDamage', 1, 100, 1);
  eyebat.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Hellhound ---
  const hound = panel.folder('Hellhound (src/sim/config.ts)');
  hound.number(tuning, 'houndHealth', 10, 500, 5);
  hound.number(tuning, 'houndCost', 1, 10, 1);
  hound.number(tuning, 'houndFromWave', 1, 30, 1);
  hound.number(tuning, 'houndMaxAttackers', 1, 6, 1);
  hound.number(tuning, 'houndMaxAlive', 1, 12, 1);
  hound.number(tuning, 'houndSpeed', 1, 20, 0.1);
  hound.number(tuning, 'houndAccel', 1, 30, 0.5);
  hound.number(tuning, 'houndChargeSpeed', 1, 25, 0.5);
  hound.number(tuning, 'houndStalkDistance', 3, 30, 0.5);
  hound.number(tuning, 'houndChargeRange', 5, 40, 1);
  hound.number(tuning, 'houndSeenAngle', 10, 90, 1);
  hound.number(tuning, 'houndUnseenTime', 0, 3, 0.05);
  hound.number(tuning, 'houndCloseCharge', 0, 10, 0.5);
  hound.number(tuning, 'houndStalkMaxTime', 1, 20, 0.5);
  hound.number(tuning, 'houndChargeTurnRate', 0, 360, 5);
  hound.number(tuning, 'houndLeadFactor', 0, 1.5, 0.05);
  hound.number(tuning, 'houndSkidTime', 0, 2, 0.05);
  hound.number(tuning, 'houndChargeMaxTime', 0.5, 8, 0.1);
  hound.number(tuning, 'houndRetreatTime', 0, 4, 0.1);
  hound.number(tuning, 'houndHitWidth', 0.3, 2.5, 0.05);
  hound.number(tuning, 'houndHitHeight', 0.3, 2.5, 0.05);
  hound.number(tuning, 'houndHeadHeight', 0.2, 1.2, 0.05);
  hound.number(tuning, 'houndJumpHeight', 0, 2, 0.05);
  hound.number(tuning, 'houndBiteRange', 0.5, 3, 0.05);
  hound.number(tuning, 'houndBiteDamage', 1, 100, 1);
  hound.number(tuning, 'houndBiteCooldown', 0.1, 5, 0.1);
  hound.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Bull ---
  const bull = panel.folder('Bull (src/sim/config.ts)');
  bull.number(tuning, 'bullHealth', 50, 2000, 10);
  bull.number(tuning, 'bullCost', 1, 15, 1);
  bull.number(tuning, 'bullFromWave', 1, 40, 1);
  bull.number(tuning, 'bullSpeed', 0.5, 10, 0.1);
  bull.number(tuning, 'bullAccel', 0.5, 20, 0.5);
  bull.number(tuning, 'bullChargeRange', 5, 50, 1);
  bull.number(tuning, 'bullAimTime', 0.2, 3, 0.05);
  bull.number(tuning, 'bullAimLockTime', 0, 1.5, 0.05);
  bull.number(tuning, 'bullAimTurnRate', 10, 720, 10);
  bull.number(tuning, 'bullLeadFactor', 0, 1.5, 0.05);
  bull.number(tuning, 'bullChargeSpeed', 5, 35, 0.5);
  bull.number(tuning, 'bullOvershoot', 0, 20, 0.5);
  bull.number(tuning, 'bullChargeMaxTime', 0.5, 6, 0.1);
  bull.number(tuning, 'bullChargeDamage', 1, 100, 1);
  bull.number(tuning, 'bullChargeKnockback', 0, 40, 0.5);
  bull.number(tuning, 'bullChargeLift', 0, 20, 0.5);
  bull.number(tuning, 'bullTrampleHeight', 0, 2.5, 0.05);
  bull.number(tuning, 'bullTrampleKnockback', 0, 30, 0.5);
  bull.number(tuning, 'bullTrampleLift', 0, 20, 0.5);
  bull.number(tuning, 'bullSkidTime', 0, 3, 0.05);
  bull.number(tuning, 'bullStunTime', 0, 6, 0.1);
  bull.number(tuning, 'bullChargeCooldown', 0, 8, 0.1);
  bull.number(tuning, 'bullHitWidth', 0.5, 4, 0.05);
  bull.number(tuning, 'bullHitHeight', 0.5, 4, 0.05);
  bull.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Damned Smith (the special enemy of waves 9, 19, 29...) ---
  const smith = panel.folder('Damned Smith (src/sim/config.ts)');
  smith.number(tuning, 'smithHealth', 100, 5000, 50);
  smith.number(tuning, 'smithHeadHeight', 1, 3, 0.05);
  smith.number(tuning, 'smithSpeed', 0.5, 8, 0.1);
  smith.number(tuning, 'smithFromWave', 1, 40, 1);
  smith.number(tuning, 'smithEveryWaves', 1, 20, 1);
  smith.number(tuning, 'smithSpawnAt', 0, 1, 0.05);
  smith.number(tuning, 'smithSlamRange', 2, 20, 0.5);
  smith.number(tuning, 'smithSlamWindup', 0.2, 3, 0.05);
  smith.number(tuning, 'smithSlamRecover', 0, 4, 0.1);
  smith.number(tuning, 'smithSlamCooldown', 0, 8, 0.1);
  smith.number(tuning, 'smithWaveSpeed', 2, 40, 0.5);
  smith.number(tuning, 'smithWaveRange', 2, 30, 0.5);
  smith.number(tuning, 'smithWaveThickness', 0.2, 3, 0.05);
  smith.number(tuning, 'smithWaveHeight', 0.1, 2, 0.05);
  smith.number(tuning, 'smithWaveDamage', 0, 100, 1);
  smith.number(tuning, 'smithHookRange', 5, 40, 0.5);
  smith.number(tuning, 'smithHookWindup', 0.1, 3, 0.05);
  smith.number(tuning, 'smithHookSpeed', 5, 80, 1);
  smith.number(tuning, 'smithHookLead', 0, 1.5, 0.05);
  smith.number(tuning, 'smithHookDamage', 0, 100, 1);
  smith.number(tuning, 'smithHookPullSpeed', 2, 30, 0.5);
  smith.number(tuning, 'smithHookPullTime', 0.2, 4, 0.1);
  smith.number(tuning, 'smithHookCooldown', 0, 15, 0.5);
  smith.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Sharpshooter ---
  const sharp = panel.folder('Sharpshooter (src/sim/config.ts)');
  sharp.number(tuning, 'sharpshooterHealth', 10, 500, 5);
  sharp.number(tuning, 'sharpshooterCost', 1, 15, 1);
  sharp.number(tuning, 'sharpshooterFromWave', 1, 40, 1);
  sharp.number(tuning, 'sharpshooterRange', 10, 100, 1);
  sharp.number(tuning, 'sharpshooterAimTime', 0.2, 4, 0.05);
  sharp.number(tuning, 'sharpshooterLockTime', 0, 1.5, 0.05);
  sharp.number(tuning, 'sharpshooterTurnRate', 10, 720, 10);
  sharp.number(tuning, 'sharpshooterLeadFactor', 0, 1.5, 0.05);
  sharp.number(tuning, 'sharpshooterShootInterval', 0.2, 8, 0.1);
  sharp.number(tuning, 'sharpshooterBulletSpeed', 10, 300, 5);
  sharp.number(tuning, 'sharpshooterBulletDamage', 1, 100, 1);
  sharp.number(tuning, 'sharpshooterHitWidth', 0.3, 2, 0.05);
  sharp.number(tuning, 'sharpshooterHitHeight', 0.5, 3, 0.05);
  sharp.number(tuning, 'sharpshooterHeadHeight', 0.5, 2.5, 0.05);
  sharp.number(tuning, 'sharpshooterWalkSpeed', 0.5, 10, 0.1);
  sharp.number(tuning, 'sharpshooterClimbSpeed', 0.5, 8, 0.1);
  sharp.number(tuning, 'sharpshooterRelocateTime', 0.5, 15, 0.5);
  sharp.number(tuning, 'sharpshooterCorneredRange', 0, 30, 0.5);
  sharp.number(tuning, 'sharpshooterPerchMinRange', 0, 40, 1);
  sharp.number(tuning, 'sharpshooterPerchMaxRange', 10, 80, 1);
  sharp.number(tuning, 'sharpshooterPerchHeightBonus', 0, 10, 0.25);
  sharp.number(tuning, 'sharpshooterMaxTravel', 10, 200, 5);
  sharp.button('Copy values', () => copyToClipboard(toSource(tuning)));

  // --- Camera feel ---
  const feel = panel.folder('Camera feel (src/render/cameraFeel.ts)');
  feel.number(cameraFeelSettings, 'baseFov', 50, 110, 1);
  feel.number(cameraFeelSettings, 'speedFovExtra', 0, 40, 1);
  feel.number(cameraFeelSettings, 'speedFovStart', 0, 20, 0.5);
  feel.number(cameraFeelSettings, 'speedFovFull', 1, 40, 0.5);
  feel.number(cameraFeelSettings, 'strafeRoll', 0, 6, 0.1);
  feel.number(cameraFeelSettings, 'slideRoll', 0, 10, 0.1);
  feel.number(cameraFeelSettings, 'fovRate', 1, 30, 0.5);
  feel.number(cameraFeelSettings, 'rollRate', 1, 30, 0.5);
  feel.number(cameraFeelSettings, 'eyeRate', 1, 40, 0.5);
  feel.number(cameraFeelSettings, 'hurtKick', 0, 15, 0.5);
  feel.number(cameraFeelSettings, 'hurtKickDamage', 5, 60, 1);
  feel.number(cameraFeelSettings, 'hurtStiffness', 50, 800, 10);
  feel.number(cameraFeelSettings, 'hurtDamping', 0.1, 1.5, 0.05);
  feel.number(cameraFeelSettings, 'hurtShake', 0, 6, 0.1);
  feel.number(cameraFeelSettings, 'hurtShakeDecay', 2, 30, 0.5);
  feel.button('Copy values', () => copyToClipboard(toSource(cameraFeelSettings)));

  // --- Post-processing ---
  const post = panel.folder('Post-processing (src/render/postprocess.ts)');
  post.number(postSettings, 'pixelHeight', 120, 720, 10, options.onPostSizeChange);
  post.number(postSettings, 'colorLevels', 2, 64, 1);
  post.number(postSettings, 'dither', 0, 1, 0.05);
  post.number(postSettings, 'bloomThreshold', 0, 3, 0.05);
  post.number(postSettings, 'bloomStrength', 0, 3, 0.05);
  post.number(postSettings, 'bloomPasses', 0, 6, 1);
  post.button('Copy values', () => copyToClipboard(toSource(postSettings)));

  // --- Atmosphere (rebuilt when switching preset from Debug tools) ---
  const atmo = panel.folder('Atmosphere');

  function fillAtmosphere(folder: Folder, a: Atmosphere): void {
    folder.clear();
    folder.setTitle(`Atmosphere: ${a.name} (src/render/atmospheres.ts)`);
    const obj = a as unknown as Record<string, unknown>;
    const apply = options.onAtmosphereChange;
    for (const key of ATMOSPHERE_COLORS) folder.color(obj, key, apply);
    folder.number(obj, 'skyCurve', 0.1, 2, 0.05, apply);
    folder.number(obj, 'sunSize', 0.5, 20, 0.5, apply);
    folder.number(obj, 'sunElevation', -5, 90, 1, apply);
    folder.number(obj, 'sunAzimuth', -180, 180, 1, apply);
    folder.number(obj, 'sunGlow', 0, 3, 0.05, apply);
    folder.number(obj, 'sunGlowTightness', 1, 30, 0.5, apply);
    folder.number(obj, 'sunBrightness', 0.5, 8, 0.1, apply);
    folder.number(obj, 'stars', 0, 1, 0.05, apply);
    folder.number(obj, 'eclipse', 0, 1, 0.01, apply);
    folder.number(obj, 'sunLightIntensity', 0, 8, 0.1, apply);
    folder.number(obj, 'lanternIntensity', 0, 40, 0.5, apply);
    folder.number(obj, 'dustAmount', 0, 1, 0.05, apply);
    folder.number(obj, 'dustAlpha', 0, 2, 0.05, apply);
    folder.number(obj, 'dustWindX', -6, 6, 0.1, apply);
    folder.number(obj, 'dustWindZ', -6, 6, 0.1, apply);
    folder.number(obj, 'dustBlink', 0, 1, 0.05, apply);
    folder.number(obj, 'fogNear', 0, 60, 1, apply);
    folder.number(obj, 'fogFar', 5, 150, 1, apply);
    folder.number(obj, 'groundFogDensity', 0, 0.2, 0.005, apply);
    folder.number(obj, 'groundFogFalloff', 0.05, 3, 0.05, apply);
    folder.number(obj, 'godRays', 0, 3, 0.05, apply);
    folder.number(obj, 'ambientIntensity', 0, 3, 0.05, apply);
    folder.button('Copy values', () => copyToClipboard(toSource(obj, ATMOSPHERE_COLORS)));
  }

  return {
    toggle: () => panel.toggle(),
    get visible() {
      return panel.visible;
    },
    showAtmosphere: (a) => fillAtmosphere(atmo, a),
  };
}
