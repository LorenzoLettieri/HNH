// Tuning values for the simulation. One place to tweak how the game feels.
//
// They live in ONE mutable object (`tuning`) instead of separate constants,
// so the debug panel can change them while the game runs. The values written
// here are the defaults the game starts with.

/** Simulation ticks per second. Independent of the monitor's refresh rate. Not tunable live. */
export const TICK_RATE = 60;
/** Duration of one tick, in seconds. */
export const TICK_DT = 1 / TICK_RATE;

export const tuning = {
  /** Camera height above the player's feet, meters. */
  eyeHeight: 1.7,

  // --- Player collision box ---
  /** Half the width of the player's box, meters (the box is 0.8 × 0.8 m). */
  playerRadius: 0.4,
  /** Height of the player's box, meters. */
  playerHeight: 1.8,
  /** Falling below this height means you left the level: respawn. */
  killY: -30,

  // --- Ground movement (Quake-style) ---
  /** Target speed when holding a direction on the ground, m/s. */
  maxGroundSpeed: 6.5,
  /**
   * How fast you reach maxGroundSpeed. Each second you gain up to
   * groundAccel × maxGroundSpeed m/s: 14 × 8 = 112 m/s² → full speed in ~0.07 s.
   */
  groundAccel: 14,
  /** How fast you stop when releasing the keys. Higher = snappier stops. */
  groundFriction: 10,
  /**
   * Below this speed, friction acts as if you were going this fast:
   * prevents the endless slow "creep" before stopping completely. m/s.
   */
  stopSpeed: 2.5,

  // --- Gravity & jumping ---
  /** Downward acceleration, m/s². Real world is 9.8; games use more for snappier jumps. */
  gravity: 20,
  /** Upward speed given by a jump, m/s. Jump height = jumpSpeed² / (2 × gravity) ≈ 1.2 m. */
  jumpSpeed: 7,
  /**
   * true  = holding jump re-jumps automatically on landing (easy bunny hopping).
   * false = you must release and press again (timing-based, like classic Quake).
   */
  autoBhop: false,
  /**
   * Coyote time: you can still jump for this long after walking off a ledge,
   * like the cartoon coyote running off a cliff. Seconds.
   */
  coyoteTime: 0.1,
  /**
   * Jump buffer: a jump pressed up to this long BEFORE landing still counts,
   * and fires on the landing tick. Seconds.
   */
  jumpBufferTime: 0.15,

  // --- Air movement (Quake-style) ---
  /** Air acceleration. Higher = more air control and faster strafe gains. */
  airAccel: 12,
  /**
   * Max speed you can ADD along your wished direction while airborne, m/s.
   * Tiny on purpose: you can't simply fly forward faster, but turning while
   * strafing keeps finding "new" directions to accelerate in → air-strafing.
   */
  airSpeedCap: 0.8,
  /**
   * Air control: holding a direction in the air TURNS your velocity toward it
   * (without adding speed). Higher = more precise jumps. 0 = pure Quake.
   */
  airControl: 7,

  // --- Bunny hop helpers (deliberately "unrealistic", to make it accessible) ---
  /**
   * Seconds after landing during which there's no ground friction: jump within
   * this window and you keep all your speed. Real Quake: 1 tick. Here: forgiving.
   */
  bhopGraceTime: 0.12,
  /**
   * Speed added by each successful hop (jumping within the grace window), m/s.
   * It shrinks as you go faster (see bhopBoostFalloff): speed grows, but slower and slower.
   */
  bhopBoost: 0.6,
  /** Above this speed the hop boost starts shrinking: boost × (this / speed)². m/s. */
  bhopBoostFalloff: 9,

  // --- Crouch ---
  /** Height of the collision box while crouched/sliding, meters (fits under 1.1 m). */
  crouchHeight: 1.0,
  /** Camera height while crouched/sliding, meters. */
  crouchEyeHeight: 0.85,
  /** Max walking speed while crouched (and too slow to slide), m/s. */
  crouchSpeed: 3.5,

  // --- Slide ---
  /** Minimum speed to start a slide instead of a plain crouch, m/s. */
  slideStartSpeed: 5,
  /** Speed added when a slide starts, m/s. */
  slideBoost: 5,
  /** The boost only applies below this speed: no infinite acceleration by spamming. m/s. */
  slideBoostMaxSpeed: 13,
  /** Seconds before another slide can give a boost again. */
  slideBoostCooldown: 0.6,
  /** Friction while sliding: much lower than on foot, so you keep your speed. */
  slideFriction: 0.7,
  /** Below this speed the slide ends and you're just crouching, m/s. */
  slideStopSpeed: 3,
  /** How much you can steer during a slide (like air control). */
  slideSteer: 6,

  // --- Wall jump ---
  /** How close a wall must be to jump off it, meters (beyond your body). */
  wallJumpReach: 0.35,
  /** Upward speed of a wall jump, m/s. */
  wallJumpUp: 8.5,
  /** Speed pushing you away from the wall, m/s (small: it's not a bounce). */
  wallJumpPush: 3.5,
  /**
   * Apex-style: speed added along the wall, in the direction you're looking, m/s.
   * Shrinks at high speed like the hop boost (same falloff).
   */
  wallJumpBoost: 2.5,
  /** Wall jumps allowed before touching the ground again. */
  wallJumpsMax: 3,
  /** Minimum seconds between two wall jumps (else holding jump would burn them all at once). */
  wallJumpCooldown: 0.2,

  // --- Body blocking (see bodyBlock.ts) ---
  /** Enemies are solid: you can't run through the horde (CoD Zombies). Off = old ghost behavior. */
  enemyBodyBlock: true,

  // --- Revolver ---
  /** Shots in the cylinder. */
  revolverAmmo: 6,
  /** Card "Tamburo del becchino" (upgrades.ts): extra rounds in the cylinder. */
  undertakerExtraRounds: 2,
  /** Card "Tamburo veloce": the reload takes this fraction of revolverReloadTime (animation and sounds follow). */
  fastCylinderReloadScale: 0.67,
  /** Card "Ricarica in scivolata": seconds of sliding for each round pushed into the cylinder. */
  slideReloadInterval: 0.3,
  /** Card "Mano lesta": the fanning's spread and the time between its shots are multiplied by these. */
  quickHandSpreadScale: 0.5,
  quickHandIntervalScale: 0.7,
  /** Card "Ricochet": how far (meters) the bullet looks for the next enemy after a critical hit, and its damage. */
  ricochetRange: 12,
  ricochetDamage: 50,
  /** Card "Ultimo colpo": radius (meters) and damage of the last round's explosion (100 = two body shots). */
  lastShotRadius: 3,
  lastShotDamage: 100,
  /** Card "Canne lunghe": spread × this, and full damage this many meters farther. */
  longBarrelsSpreadScale: 0.6,
  longBarrelsFalloffExtra: 2,
  /** Card "Fiato di drago": seconds an enemy burns, and damage every dragonBurnInterval seconds. */
  dragonBurnTime: 2,
  dragonBurnInterval: 0.5,
  dragonBurnDamage: 10,
  /** Card "Mulo": your shotgun recoil × this. */
  muleRecoilScale: 2,
  /** Card "Calcio di piombo": knockback × this; damage when a thrown enemy hits a wall, within this many seconds. */
  leadStockKnockbackScale: 2,
  leadStockSlamDamage: 50,
  leadStockSlamTime: 0.8,
  /** Card "Spinta di gruppo": enemies within this many meters behind the one you blasted are thrown too, at this × the strength. */
  groupPushRadius: 2.5,
  groupPushScale: 0.7,
  /** Card "Duellante": seconds without shooting before the next carbine shot does duelistMultiplier × damage. */
  duelistTime: 1.5,
  duelistMultiplier: 2,
  /** Card "Leva da pistolero": the lever's time (rifleFireInterval) × this. */
  gunslingerLeverScale: 0.7,
  /** Card "Occhio di falco": the carbine's critical multiplier when fully aimed (normally rifleHeadshotMultiplier). */
  scopeCritMultiplier: 6,
  /** Card "Quickscope": seconds from starting to aim in which a shot is a critical hit. */
  quickscopeWindow: 0.2,
  /** Card "Marchio": damage × this on a marked enemy. */
  markMultiplier: 2,
  /** Card "Miccia corta": the dynamite's fuse × this (0.5 = it blows up in half the time). */
  shortFuseScale: 0.5,
  /** Card "Botte di polvere": the dynamite's blast radius × this. */
  powderKegRadiusScale: 1.4,
  /** Card "Rimbalzo infernale": +this share of damage for every bounce, counted up to hellBounceMax bounces. */
  hellBounceBonus: 0.25,
  hellBounceMax: 4,
  /**
   * Card "Razzo": the stick is fired this × faster, flies with NO gravity for
   * rocketTime seconds (straight, like a rocket), blows up on any contact,
   * and its dynamite jump pushes this × harder.
   */
  rocketSpeedScale: 1.6,
  rocketTime: 0.5,
  rocketSelfPushScale: 1.5,
  /**
   * Card "A grappolo": the blast throws clusterCount mini sticks around
   * (clusterSpeed outward, clusterLift up); each blows up after clusterFuse
   * seconds (one after the other, clusterStagger apart) with clusterRadius
   * and clusterDamageScale of a stick's damage (0.4 = 60 at the center: a
   * basic ghoul of the first waves).
   */
  clusterCount: 3,
  clusterSpeed: 5,
  clusterLift: 6,
  clusterFuse: 0.55,
  clusterStagger: 0.1,
  clusterRadius: 2.2,
  clusterDamageScale: 0.4,
  /** Minimum seconds between two shots (it's semi-automatic: one click = one shot). */
  revolverFireInterval: 0.32,
  /** A click slightly before the gun is ready still fires as soon as it is, seconds. */
  revolverFireBuffer: 0.12,
  /** Seconds to reload all 6 rounds. */
  revolverReloadTime: 1.5,
  /** Spare bullets in your pockets at the start (the reload takes them from here). */
  revolverReserveStart: 36,
  /** Most spare bullets you can carry: pickups above this are wasted. */
  revolverReserveMax: 54,
  /**
   * Damage per bullet. Health is designed in "shots to kill" (see the
   * breakpoint table in docs/DESIGN.md): 50 = one shot on a basic ghoul.
   */
  revolverDamage: 50,
  /**
   * FANNING (the revolver's alternate fire, right mouse button): the left
   * hand slaps the hammer again and again and the whole cylinder goes out
   * in a burst. Seconds between two shots of the burst (normal fire: revolverFireInterval).
   */
  revolverFanInterval: 0.08,
  /** Fanning is imprecise: each bullet goes off the aim, up to this many degrees. */
  revolverFanSpread: 5,
  /** After the burst: seconds before the revolver can fire again (it's usually empty anyway). */
  revolverFanRecovery: 0.3,
  /** Headshot damage multiplier: this is an aim game, headshots are king. */
  headshotMultiplier: 3,
  /** Max shooting distance, meters. */
  weaponRange: 200,

  // --- Double-barrel shotgun ("la doppietta", see weapon.ts) ---
  /** Shells: one per barrel. */
  shotgunAmmo: 2,
  /** Seconds between the two barrels (you can fire both almost together). */
  shotgunFireInterval: 0.16,
  /** Seconds to break it open, swap both shells and snap it shut. Starts by itself when both barrels are empty. */
  shotgunReloadTime: 1.05,
  /** Spare shells at the start. */
  shotgunReserveStart: 12,
  /** Most spare shells you can carry. */
  shotgunReserveMax: 20,
  /**
   * The PUMP-ACTION (the shotgun reinforced at the Forge, docs/DESIGN.md
   * §6d): shells in the tube magazine, and seconds between two shots (the
   * pump racked back and forth: a new shell in the chamber).
   */
  pumpAmmo: 6,
  pumpFireInterval: 0.55,
  /** It reloads one shell at a time, like the carbine: seconds to bring it to the loading port, then per shell. */
  pumpReloadStart: 0.25,
  pumpReloadPerShell: 0.4,
  /**
   * The pump-action's reload ends with the left hand back on the fore-end,
   * SLAMMING it shut: seconds before it can fire (also when a click stops
   * the reload). The animation (render/weapons/pumpView.ts) fits in here.
   */
  pumpReloadClose: 0.15,
  /** Debug: reloading doesn't use up the reserve. */
  infiniteAmmo: false,

  // --- Lever-action carbine ("la carabina a leva", see weapon.ts) ---
  /** Rounds in the magazine tube. It shoots the revolver's bullets (same pocket). */
  rifleAmmo: 8,
  /** Seconds between two shots: the time to work the lever (the animation is stretched on it). */
  rifleFireInterval: 0.62,
  /** Seconds to bring the gun to the loading gate before the first round. */
  rifleReloadStart: 0.3,
  /** Seconds to push each round in through the gate (it reloads one at a time). */
  rifleReloadPerRound: 0.38,
  /** A click stops the reload: seconds before it can fire (the gun comes back up). */
  rifleReloadInterrupt: 0.12,
  /**
   * Damage per bullet: twice the revolver. Designed on the health steps of
   * healthForWave (ghoul, hound, eye-bat: 50 → 100 at wave 10 → 150 at 20 → 200
   * at 30): ONE body shot kills them up to wave 19, where the revolver already
   * needs two. Per second it's about the revolver's (100 / 0.62 s ≈ 160 vs
   * 50 / 0.32 s ≈ 156): its edge is fewer bullets and one-shot breakpoints.
   */
  rifleDamage: 100,
  /** Critical multiplier: 100 × 4 = 400, a headshot kills any ghoul at any wave (max 200). */
  rifleHeadshotMultiplier: 4,
  /** From the hip the bullet goes off the aim, up to this many degrees; aimed down the sights: 0. */
  rifleHipSpread: 2.5,
  /** Seconds to raise the gun to the eye (and to lower it). */
  rifleAdsTime: 0.18,
  /** Bullets that come with it when you buy it (in your pocket, shared with the revolver). */
  rifleBuyBullets: 24,

  // --- Dynamite launcher ("il lancia-dinamite", see dynamite.ts and weapon.ts) ---
  /** Sticks in the drum. */
  dynamiteAmmo: 5,
  /** Seconds between two sticks (the drum turning to the next one). */
  dynamiteFireInterval: 0.6,
  /** Seconds to swap the drum: all the sticks at once, like the revolver. */
  dynamiteReloadTime: 1.6,
  /** Spare sticks at the start (when you get the launcher) and the most you can carry. */
  dynamiteReserveStart: 10,
  dynamiteReserveMax: 20,
  /** Launch speed of a stick along the aim, m/s (slow enough to see the arc). */
  dynamiteSpeed: 22,
  /** Extra upward speed at launch, m/s: the arc starts a bit above the aim, like a lob. */
  dynamiteLift: 2.5,
  /** How much of YOUR velocity the stick keeps (0..1): throwing while running forward throws farther. */
  dynamiteInherit: 0.5,
  /** Seconds from the shot to the explosion, if it doesn't hit an enemy first. */
  dynamiteFuse: 1.2,
  /** Bounce: fraction of the speed INTO the surface it keeps, coming back out (0 = dead stop, 1 = superball). */
  dynamiteBounce: 0.45,
  /** Bounce: fraction of the speed ALONG the surface it keeps on each impact (friction of the hit). */
  dynamiteBounceGrip: 0.75,
  /** Below this speed into the floor it stops bouncing and rolls, m/s. */
  dynamiteBounceMinSpeed: 2,
  /** Rolling on the floor: how fast it slows down, m/s per second. */
  dynamiteRollFriction: 6,
  /** Radius of the explosion, meters (to the nearest point of an enemy's hitbox). */
  dynamiteRadius: 4,
  /**
   * Damage at the center of the explosion (and on a direct hit, which blows
   * up against the enemy: its distance is 0). Breakpoints (§3): 150 kills a
   * ghoul / hound / eye-bat until wave 29 (×3 = 150), half a bull.
   */
  dynamiteDamage: 150,
  /** Fraction of the damage left at the edge of the radius: 0.4 = 60, still a kill on a basic enemy until wave 9. */
  dynamiteEdgeDamage: 0.4,
  /** Enemies thrown away: horizontal speed and lift at the center, m/s (half at the edge). Bulls and the Smith don't budge. */
  dynamiteKnockback: 12,
  dynamiteKnockbackLift: 6,
  /**
   * DYNAMITE JUMP: speed added to YOU at the center, m/s (0 at the edge).
   * No damage to you (docs/DESIGN.md). Right under your feet: 11 m/s up =
   * ~3 m high on its own; with a jump (7 m/s) on top, ~8 m: a roof.
   */
  dynamiteSelfPush: 20,
  /** The Damned Smith's armor: explosions do this × the damage to it. */
  dynamiteSmithScale: 0.5,
  /**
   * HOLY FIRE (the dynamite launcher reinforced at the Forge, holyFire.ts):
   * where a holy-water stick blows up, a pool of blue fire stays on the floor
   * for holyFireTime seconds, holyFireRadius meters wide. Every enemy that
   * steps in burns (holy burn): holyBurnDamage every holyBurnInterval
   * seconds, for as long as it stands there and holyBurnTime more. The player
   * never burns. 15 every 0.5 s = 30 a second: a basic ghoul of wave 10 (100)
   * dies in about 3 s of fire.
   */
  holyFireRadius: 2.6,
  holyFireTime: 5,
  holyBurnTime: 1.5,
  holyBurnInterval: 0.5,
  holyBurnDamage: 15,

  // --- Drops and pickups (see pickups.ts) ---
  /** Drop chance per point of enemy weight (ghoulCost 1 → 30%, eyebatCost 2 → 60%, houndCost 3 → 80% (the cap), bull too). */
  dropChancePerWeight: 0.3,
  /** The drop chance never goes above this (heavy enemies of the future). */
  dropChanceMax: 0.8,
  /**
   * What a drop is: WEIGHTS, not percentages (see pickKind in pickups.ts).
   * 5/4/3/1 = 38% bullets, 31% shells, 23% medkits, 8% dynamite (with every
   * weapon). Set one to 0 to never drop it.
   */
  dropWeightBullets: 5,
  dropWeightShells: 4,
  dropWeightMedkit: 3,
  /** A bundle of dynamite: rare on purpose (the launcher is the strongest gun against a crowd). */
  dropWeightSticks: 1,
  /** Seconds a drop stays on the ground before vanishing. */
  dropLifetime: 10,
  /**
   * The BURST: drops fly out of the body (see burst in pickups.ts). Outward
   * speed, a random value between min and max, m/s: with the upward kick
   * below they land ~1-2 m from the body.
   */
  dropBurstSpeedMin: 2,
  dropBurstSpeedMax: 4,
  /** Upward speed of the burst, m/s (higher = longer, higher arc). */
  dropBurstUp: 5,
  /** Fraction of the falling speed it bounces back up with (0 = no bounce). */
  dropBounce: 0.35,
  /** Below this falling speed it doesn't bounce anymore: it settles, m/s. */
  dropBounceMinSpeed: 2.5,
  /** How close (horizontally) you must pass to collect it, meters. */
  pickupRadius: 1.5,
  /**
   * How far BELOW your feet a pickup is still collected, meters. A plain jump
   * peaks at jumpSpeed² / (2·gravity) ≈ 1.2 m: above that, jumping over a drop
   * still grabs it.
   */
  pickupReachBelow: 1.5,
  /** How far ABOVE your head a pickup is still collected (one flying over you), meters. */
  pickupReachAbove: 0.5,
  /** Health a medkit gives back. */
  medkitHeal: 25,
  /** Revolver bullets in a 'bullets' drop. */
  ammoPickupBullets: 18,
  /** Shotgun shells in a 'shells' drop. */
  ammoPickupShells: 5,
  /** Dynamite sticks in a 'sticks' drop (a bundle). */
  ammoPickupSticks: 3,
  // --- Shops (see shop.ts) ---
  /** How close to a vendor you must be to trade (horizontal distance, meters). The counter is ~1.6 m from him. */
  shopReach: 3,
  /** ...and how far above/below him you can be: same floor only. */
  shopReachHeight: 1.5,
  /** Price of the shotgun at the armory, in vildenaro (a ghoul drops 10, × the style multiplier). */
  shotgunPrice: 600,
  /** Price of the lever-action carbine at the armory. */
  riflePrice: 1000,
  /** Price of the dynamite launcher: the most expensive gun (it comes with dynamiteReserveStart sticks). */
  dynamitePrice: 1500,
  /** Price of the shovel (it replaces the kick on F). */
  shovelPrice: 400,
  // --- Weapon upgrades: decks of cards at the armory (see upgrades.ts) ---
  /** Price of a weapon's first card, in vildenaro. */
  upgradeBasePrice: 500,
  /** Every card bought makes the next one of the same weapon this many times dearer (500, 1000, 2000). */
  upgradePriceGrowth: 2,
  /** Cards a weapon can take at most. */
  upgradeMaxLevel: 3,
  /** Cards drawn on the counter to choose from. */
  upgradeOfferSize: 2,
  // --- The Forge (docs/DESIGN.md §6d): Damned Iron → a reinforced gun ---
  /**
   * Damage of a reinforced gun (forge level 1), times the plain one. ×2 like
   * the enemies' health at wave 10: the same breakpoints one step later
   * (revolver 100 = one body shot up to wave 19, carbine 200 up to 29).
   */
  forgeDamageMultiplier: 2,
  /**
   * Damned Iron it takes to reinforce a gun: forgeIronCost for the first one,
   * then forgeIronCostStep more for every gun already reinforced (1, 2, 3, 4).
   * With one more Smith at every Smith wave (smithExtraPerWave) the iron comes
   * in as 1, 2, 3, 4 too: one gun per Smith wave, if you kill them all.
   */
  forgeIronCost: 1,
  forgeIronCostStep: 1,
  /** Highest forge level (for now only 1: the next levels are still to design). */
  forgeMaxLevel: 1,
  /**
   * Akimbo revolvers (the reinforced revolver): seconds between shots, as a
   * fraction of revolverFireInterval. The guns alternate, so each one fires
   * every 2 × 0.24 = 0.48 s, but you shoot every 0.24 s.
   */
  akimboFireIntervalScale: 0.75,
  /** Akimbo reload: both guns twirled round the finger, the cylinders full again (pure show), seconds. */
  akimboReloadTime: 1.3,
  // --- Vildenaro: the coins every enemy drops (see dropCoins in pickups.ts) ---
  /** Coins dropped per point of enemy weight: ghoul 1 coin, eye-bat 2, hound 3, bull 5. ALWAYS, not a chance. */
  coinsPerWeight: 1,
  /** Vildenaro one coin is worth. */
  coinValue: 10,
  /** Seconds a coin stays on the ground (a bit longer than the other drops: it's never "not needed"). */
  coinLifetime: 15,
  /** Pellets per shot (a fixed pattern: center + inner ring + outer ring). */
  shotgunPellets: 12,
  /**
   * The pattern is an ELLIPSE, wide and short: enemies stand on the ground,
   * side by side, so the pellets that went above and below the head of a
   * round pattern now hit the ghouls next to it. Half-angles of the outer
   * ring, degrees. Simulated on a row of ghouls 1.4 m apart, aiming at the
   * middle one: it still dies up to ~8 m (126 damage at 4 m, enough for the
   * 100 health of waves 10-19), the two beside it take 14-34 instead of 0.
   * Wider (12°) and the middle one gets 98 at 4 m: no more one-shot at wave 10.
   */
  shotgunSpreadHorizontal: 10,
  shotgunSpreadVertical: 4,
  /** Damage of one pellet at close range (all 12 = 168: anything basic dies point blank). */
  shotgunPelletDamage: 14,
  /** Pellets do full damage up to this distance, meters... */
  shotgunFalloffStart: 6,
  /** ...then less and less, down to shotgunFalloffMin × damage at this distance. */
  shotgunFalloffEnd: 22,
  shotgunFalloffMin: 0.25,
  /** Max distance a pellet flies, meters. */
  shotgunRange: 60,
  /** Critical multiplier PER PELLET (lower than the revolver's: a blast to the head is already a lot of pellets). */
  shotgunHeadshotMultiplier: 1.5,
  /**
   * Recoil on YOU, m/s: shooting backward pushes you forward, shooting down
   * (in the air) pushes you up, a "shotgun jump". It only ever HELPS: the
   * part that would slow you down is thrown away (see weapon.ts).
   */
  shotgunSelfPush: 5,
  /** Point-blank blast throws enemies back (like the kick) within this distance, meters... */
  shotgunKnockbackRange: 5,
  /** ...with this speed at 0 m and with every pellet on target, m/s (it fades with distance and missed pellets). */
  shotgunKnockback: 16,
  /** Upward speed at full strength, m/s. */
  shotgunKnockbackLift: 5,
  /** Weaker than this fraction of full strength: no knockback (it would just stun-lock them with tiny pushes). */
  shotgunKnockbackMin: 0.3,

  // --- Weapon switching ---
  /** Seconds for the new weapon to come up: you can't fire before. */
  weaponSwitchTime: 0.25,

  // --- Kick (melee, see kick.ts) ---
  /** Seconds from the key press to the foot landing (a tiny wind-up: the leg has to get there). */
  kickWindup: 0.08,
  /** Seconds before you can kick again (counted from the press). */
  kickCooldown: 0.55,
  /** How far the foot reaches, meters, from the edge of your body to the edge of theirs. */
  kickRange: 1.6,
  /** Half-width of the cone in front of you, degrees: everything inside gets kicked (crowd control). */
  kickAngle: 45,
  /** Damage of a kick (half a basic ghoul: it's a tool, not your main weapon). */
  kickDamage: 25,
  /** Horizontal speed given to a kicked enemy, m/s. */
  kickKnockback: 13,
  /** Upward speed given to a kicked enemy, m/s: lifting it off its feet makes it fly. */
  kickLift: 5,
  /** A kicked ghoul stays down this long after landing, seconds (can't claw you). */
  kickStun: 0.5,

  // --- Shovel (melee upgrade: bought at the armory, it takes the boot's place on F; see kick.ts) ---
  /**
   * Seconds from the press to the blade landing. Longer than the kick: the
   * gun goes down out of view first (you need both hands), then the golf
   * swing comes round from behind you (the animation in shovelView.ts is
   * timed on this number).
   */
  shovelWindup: 0.24,
  /**
   * Seconds from the press to the gun coming back up. From then on it's drawn
   * like a weapon switch (weaponSwitchTime): you can shoot again at
   * shovelGunBack + weaponSwitchTime. Until then the gun is away: no shots,
   * no reload (a reload in progress is cancelled by the swing, like in CoD).
   */
  shovelGunBack: 0.36,
  /** Seconds before the next swing (counted from the press). */
  shovelCooldown: 0.6,
  /** Reach, meters, edge to edge: the handle makes it longer than a leg. */
  shovelRange: 2.2,
  /** Half-width of the swing, degrees: a wide horizontal arc. */
  shovelAngle: 60,
  /** Damage: 1.5 basic ghouls (the carbine's body shot). Triple the kick: it's what you paid for. */
  shovelDamage: 75,
  /** Horizontal speed given to a hit enemy, m/s. */
  shovelKnockback: 15,
  /** Upward speed given to a hit enemy, m/s. */
  shovelLift: 6,

  // --- Player health ---
  playerMaxHealth: 100,

  // --- Practice targets ---
  /** Health of a target (revolver does 50: 3 body hits). */
  targetHealth: 150,
  /** Seconds before a knocked-down target stands up again. */
  targetRespawnTime: 3,

  // --- Ghoul (basic horde enemy) ---
  /** Health of a ghoul in waves 1-9 (one revolver shot). It grows in steps, see waves.ts. */
  ghoulHealth: 50,
  /** Hits above this height (from the feet) are headshots, meters. */
  ghoulHeadHeight: 1.35,
  /** Walking speed, m/s (the player runs at 8: you can always outrun them). */
  ghoulSpeed: 4,
  /** How quickly it reaches its speed / turns (per second). */
  ghoulAccel: 6,
  /** Half the width of its COLLIDER (walls, alleys). Not what bullets hit: see ghoulHitWidth. */
  ghoulRadius: 0.35,
  /**
   * Width of its HITBOX (what bullets and kicks hit), meters. The sprite is
   * 1 m wide: the hitbox matches it, so a shot that touches the drawing counts.
   */
  ghoulHitWidth: 1.0,
  /** Height of its hitbox, meters (the sprite is ~1.9 m with the hat). */
  ghoulHitHeight: 2.0,
  ghoulHeight: 1.8,
  /** Obstacles up to this height are hopped over, meters. */
  ghoulJumpHeight: 1.1,
  /** Ghouls closer than this push each other apart, meters. */
  ghoulSeparation: 1.4,
  /** Starts an attack when the player is closer than this, meters. */
  ghoulAttackRange: 1.4,
  /** Duration of the attack animation, seconds. */
  ghoulAttackTime: 0.5,
  /** Pause between attacks, seconds. */
  ghoulAttackCooldown: 0.6,
  /** Damage of one claw swipe. */
  ghoulDamage: 15,
  /** The swipe lands at this fraction of the attack animation (when the claws come down). */
  ghoulHitMoment: 0.55,
  /** Push given to the player by a hit, m/s. */
  ghoulKnockback: 4,
  /**
   * While swinging its claws it keeps walking at this fraction of its speed
   * (0 = it stops dead, like before: then the swipe only hit players standing still).
   */
  ghoulAttackMoveFactor: 0.6,

  // --- Ghoul lunge: a pounce at you from a few meters away (src/sim/ghoul.ts) ---
  /** It pounces when you're between these two distances, meters (closer = plain swipe). */
  ghoulLungeMinRange: 2,
  ghoulLungeRange: 6,
  /**
   * Warning before the pounce, seconds: it crouches with its claws up and
   * screeches. That's your window to jump, slide aside or shoot it.
   */
  ghoulLungeWindup: 0.45,
  /** Max horizontal speed of the pounce, m/s (you run at 8: it's faster than you, briefly). */
  ghoulLungeSpeed: 13,
  /** Upward speed of the pounce, m/s: low and flat, ~0.4 s in the air. */
  ghoulLungeUpSpeed: 4,
  /** How much it aims where you'll be when it lands (0 = where you are, 1 = full lead). */
  ghoulLungeLead: 0.6,
  /** Extra reach of the claws in the air, beyond touching bodies, meters. Lower = easier to sidestep. */
  ghoulLungeReach: 0.2,
  ghoulLungeDamage: 20,
  /** After landing it stays still this long, seconds: the moment to punish it. */
  ghoulLungeRecover: 0.6,
  /** Seconds between two pounces of the same ghoul (plus up to 1.5 s of variation). */
  ghoulLungeCooldown: 3,
  /** Climbing speed up walls, m/s. */
  ghoulClimbSpeed: 2.8,
  /** Closer than this (and on the same level) it walks straight at you, ignoring the graph. */
  ghoulDirectChaseRange: 5,
  /**
   * Pursuit mode: closer than this, on your level and seeing you, it stops
   * following the graph and runs to cut you off (see pursuitTarget in ghoul.ts). Meters.
   */
  ghoulPursuitRange: 30,
  /** How much it aims where you're going (0 = where you are, 1 = where you'll be when it arrives). */
  ghoulPursuitLead: 1,
  /** It never aims more than this many seconds of your running ahead of you. */
  ghoulPursuitMaxLead: 1.5,
  /** Max distance to one side of you each ghoul aims at, meters: how wide the horde fans out. */
  ghoulFlankDistance: 5,
  /** How long a dead ghoul lies on the ground before disappearing, seconds. */
  ghoulCorpseTime: 4,
  /** Speed of the "runners" (fast ghouls, from wave 4), m/s. */
  ghoulRunnerSpeed: 5.4,
  /** Weight in the waves' budget (how much trouble it is; see src/sim/waves.ts). */
  ghoulCost: 1,

  // --- Hellhound (fast ground enemy; AI in src/sim/hound.ts) ---
  /** Health: the same as the ghoul (same breakpoints). Its danger is speed, not toughness. */
  houndHealth: 50,
  /**
   * Running speed while stalking / retreating, m/s. Faster than you on foot
   * (maxGroundSpeed 8): it can always keep up and get behind you.
   */
  houndSpeed: 9,
  /** Sprint speed of the ambush, m/s: as fast as a good bunny hop. */
  houndChargeSpeed: 11,
  /** While stalking it keeps about this far from you, meters. */
  houndStalkDistance: 14,
  /** It only launches an ambush from closer than this, meters. */
  houndChargeRange: 20,
  /**
   * "You're looking at it": it's within this angle of where you're looking
   * (degrees, horizontal) and nothing is in between. 55° ≈ the edge of the
   * screen with the default field of view.
   */
  houndSeenAngle: 55,
  /** It charges after staying out of your sight this long, seconds. */
  houndUnseenTime: 0.5,
  /** Closer than this it charges even if you're looking at it (cornered), meters. */
  houndCloseCharge: 5,
  /** After stalking this long it charges anyway (staring at it forever doesn't keep it away), seconds. */
  houndStalkMaxTime: 7,
  /**
   * How fast a charging hound can turn, degrees per second. At the howl it
   * picks a direction (at where you'll be), then it can only bend it this
   * much. Test bot, open ground, 14 m: standing still it bites 94% of the
   * charges, strafing in a straight line 82%; a sidestep or a reversal when
   * it's ~5 m away (~0.4 s) makes it miss 85–90%; too late (3 m) never.
   * The higher, the harder to dodge (at 90 only a reversal works; unlimited
   * = the old homing missile: 93% whatever you do).
   */
  houndChargeTurnRate: 70,
  /**
   * The charge aims at where you'll BE (0 = where you are, 1 = full
   * prediction, like the bull and the eye-bat): strafing in a straight line
   * doesn't save you, CHANGING direction at the right moment does.
   */
  houndLeadFactor: 1,
  /** After a charge that missed (you're behind it, or it hit a wall) it skids to a stop for this long, seconds: shoot it! */
  houndSkidTime: 0.7,
  /** A charge that hasn't reached you in this time gives up (back to stalking), seconds. */
  houndChargeMaxTime: 3,
  /** After a bite it runs away for this long, then stalks again, seconds. */
  houndRetreatTime: 1.2,
  /** How quickly it reaches that speed (1/s, like ghoulAccel): a dog turns fast. */
  houndAccel: 10,
  /** Half the width of its COLLIDER, meters (slim: it fits through alleys). */
  houndRadius: 0.35,
  /** Collider height, meters: a big dog, about half your height. */
  houndHeight: 1.0,
  /** HITBOX width and height (what bullets hit), meters: generous, like the ghoul's. */
  houndHitWidth: 1.3,
  houndHitHeight: 1.1,
  /**
   * A hit above this height (from the paws) is a headshot ×3. From the side
   * the head and ears stick up above the back (~0.7 m); from the front the
   * head is the top of the sprite. One number works for every view.
   */
  houndHeadHeight: 0.7,
  /** Max height of an obstacle it hops over, meters (a bit more than the ghoul: it's a jumper). */
  houndJumpHeight: 1.2,
  /** Bites when you're closer than this, meters. */
  houndBiteRange: 1.3,
  /**
   * The bite's wind-up, seconds: it opens its jaws (and snarls), the teeth
   * close at the end. Short, but enough to dodge it if you're moving away.
   */
  houndBiteWindup: 0.35,
  /** Damage of a bite (less than a claw: it's quick and bites often). */
  houndBiteDamage: 12,
  /** Seconds between two bites. */
  houndBiteCooldown: 1,
  /** Push given to the player by a bite, m/s. */
  houndBiteKnockback: 3,
  /** How long a dead hound lies on the ground before disappearing, seconds. */
  houndCorpseTime: 3,
  /** Weight in the waves' budget (see src/sim/waves.ts): 3, more than a ghoul (1) and an eye-bat (2). */
  houndCost: 3,
  /** First wave where hounds can appear. */
  houndFromWave: 5,
  /**
   * ATTACK TOKENS: how many hounds can be attacking (charge, bite, skid) at
   * the same time. The others keep stalking and wait for a token to free up.
   * 1 = you always face one charge at a time: deadly but readable.
   */
  houndMaxAttackers: 1,
  /** Max hounds alive at the same time: when there are this many, the waves spawn something else. */
  houndMaxAlive: 3,

  // --- Bull (big charging brute; AI in src/sim/bull.ts) ---
  /**
   * Health: TOUGH on purpose (a mini-boss, the exception to "no bullet
   * sponges"): 6 revolver shots to the body. But you're not supposed to
   * shoot it while it's coming: dodge the charge first. Stunned against a
   * wall every hit is critical (×3): 2 revolver shots.
   */
  bullHealth: 300,
  /** Walking speed while it closes in, m/s: slow, you can always walk away from it. */
  bullSpeed: 3.5,
  /** How quickly it reaches its speed (1/s): heavy, it starts and turns slowly. */
  bullAccel: 4,
  /** It only charges from closer than this, meters (and with a clear straight line to you). */
  bullChargeRange: 22,
  /**
   * AIM, the warning: it stops, paws the ground and snorts for this long,
   * seconds, turning toward you. Then it goes.
   */
  bullAimTime: 1.1,
  /**
   * In the last part of the aim it stops turning (head down, direction
   * locked), seconds: that's your cue to move. Before that it keeps tracking you.
   */
  bullAimLockTime: 0.3,
  /** How fast it can turn while aiming, degrees/s: run around it fast enough and it can't follow you. */
  bullAimTurnRate: 160,
  /**
   * Aims where you'll be when it arrives (0 = where you are, 1 = full lead,
   * like eyebatLeadFactor): running straight doesn't save you, changing
   * direction after it locks does.
   */
  bullLeadFactor: 0.9,
  /** Charge speed, m/s: faster than you even when bunny-hopping. It doesn't steer. */
  bullChargeSpeed: 17,
  /** The charge ends this far past you (it overshoots, then skids), meters. */
  bullOvershoot: 5,
  /** A charge never lasts more than this, seconds (safety: open fields). */
  bullChargeMaxTime: 2.5,
  /** Damage when it runs you over. A lot: being hit is the mistake to avoid. */
  bullChargeDamage: 30,
  /** It throws you: horizontal push (m/s, along its charge) and upward push (m/s). */
  bullChargeKnockback: 14,
  bullChargeLift: 7,
  /**
   * Your feet must be below this height (above its feet) to get run over,
   * meters. Jump at the right moment (a jump peaks at ~1.2 m and stays above
   * 0.9 m for ~0.35 s) and it passes under you: you can leap over it.
   */
  bullTrampleHeight: 0.9,
  /**
   * Other enemies in the way of a charge get shoved aside (no damage): a
   * throw, m/s, sideways out of its path and forward; and up.
   */
  bullTrampleKnockback: 12,
  bullTrampleLift: 6,
  /** After an overshoot it skids to a stop for this long, seconds. */
  bullSkidTime: 0.9,
  /**
   * Crashed into a wall (or a low obstacle: it doesn't jump while charging):
   * dazed for this long, seconds. Every hit is critical meanwhile. The reward for dodging.
   */
  bullStunTime: 2.4,
  /** Minimum time between two charges, seconds (counted from the end of the previous one). */
  bullChargeCooldown: 1.5,
  /** Half the width of its COLLIDER, meters: wide, but it still fits in the 2.5 m alleys. */
  bullRadius: 0.65,
  /** Collider height, meters: taller than you. It can't go under the slide passages. */
  bullHeight: 2.1,
  /** HITBOX width and height (what bullets hit), meters: a big target. */
  bullHitWidth: 2.4,
  bullHitHeight: 2.3,
  /** Max height of an obstacle it steps over while walking, meters. */
  bullJumpHeight: 1.0,
  /** How long a dead bull lies on the ground before disappearing, seconds. */
  bullCorpseTime: 4,
  /** Weight in the waves' budget (see src/sim/waves.ts): 5, the heaviest so far. */
  bullCost: 5,
  /** First wave where bulls can appear. */
  bullFromWave: 7,

  // --- Malocchio (flying eye-bat; AI in src/sim/eyebat.ts) ---
  /**
   * Health: the SAME as the ghoul, so it follows the same breakpoints (see
   * docs/DESIGN.md): 1 shot in waves 1-9; from wave 30, 4 body shots or 2 in
   * the pupil. Its difficulty is hitting it (small, high, moving), not soaking bullets.
   */
  eyebatHealth: 50,
  /** Radius of the round body (the eye), meters. Its hitbox is a cube this wide ×2. */
  eyebatRadius: 0.4,
  /**
   * Half the size of its HITBOX, a cube centered on the eye, meters. Bigger
   * than the eye (0.4): it includes the base of the wings. Not the collider.
   */
  eyebatHitRadius: 0.65,
  /**
   * Critical spot: a bullet passing closer than this to the CENTER of the eye
   * hits the pupil (×headshotMultiplier). The pupil always faces you, so
   * "close to the center, as seen from you" = "in the pupil". Meters.
   */
  eyebatPupilRadius: 0.25,
  /** Cruising speed, m/s (slower than you: you can always get away). */
  eyebatSpeed: 8,
  /** How quickly it reaches its speed / turns (per second). Low = floaty, drifting flight. */
  eyebatAccel: 2.5,
  /** Distance it likes to keep from the player, horizontally, meters. */
  eyebatOrbitDistance: 10,
  /** Height it likes to keep above the player's feet, meters. */
  eyebatHoverHeight: 5,
  /** How fast it circles around you, radians/second (direction depends on the id). */
  eyebatOrbitSpeed: 0.35,
  /** Eye-bats closer than this push each other apart, meters. */
  eyebatSeparation: 2.5,
  /** How long a dead eye-bat lies on the ground before disappearing, seconds. */
  eyebatCorpseTime: 3,
  /**
   * Weight in the waves' budget (see src/sim/waves.ts). 2: it shoots from
   * afar and makes you look up, it's worth two ghouls.
   */
  eyebatCost: 2,
  /** First wave where eye-bats can appear: the first two waves are ghouls only, to warm up. */
  eyebatFromWave: 3,
  /** In the waves it appears this high above the spawn point, meters. */
  eyebatSpawnHeight: 4,
  /** It only shoots when you're closer than this (and in sight), meters. */
  eyebatShootRange: 30,
  /** Seconds between two shots (plus up to 1 s of variation, so a group doesn't fire in sync). */
  eyebatShootInterval: 2.5,
  /**
   * Warning before the shot, seconds: the pupil dilates, the iris blazes and
   * a whine rises. It slows down while charging: the best moment to hit the pupil.
   */
  eyebatChargeTime: 0.7,
  /** Speed of its fireball, m/s. Slower than you (8 m/s): you can't outrun it, but you can dodge it. */
  eyebatProjectileSpeed: 13,
  /**
   * How much it LEADS the shot: 0 = aims where you are now (only hits you if
   * you stand still), 1 = aims exactly where you'll be if you keep going
   * straight at the same speed. In between, it aims part of the way.
   * High = running in circles or in a straight line gets you hit: to dodge
   * you must CHANGE direction (jump, slide, cut back) after the warning.
   */
  eyebatLeadFactor: 0.9,
  eyebatProjectileDamage: 12,
  /** Push given to the player by a fireball, m/s. */
  eyebatProjectileKnockback: 3,

  // --- Sharpshooter (skeleton rifleman; AI in src/sim/sharpshooter.ts) ---
  /**
   * Health: the same as the ghoul (1 revolver shot in waves 1-9). A glass
   * cannon: dangerous from afar, fragile once you reach it or hit it.
   */
  sharpshooterHealth: 50,
  /** It only aims at you from closer than this (and with a clear line), meters. A long rifle. */
  sharpshooterRange: 55,
  /**
   * AIM, the warning: the red laser is on and FOLLOWS you (where you'll be)
   * for this long, seconds. It gets brighter as the shot gets closer.
   */
  sharpshooterAimTime: 1,
  /**
   * LOCK: the laser stops following you and blinks, seconds; then the shot.
   * Your cue to change direction: the bullet goes where the laser points.
   */
  sharpshooterLockTime: 0.3,
  /**
   * How fast the rifle can turn while aiming, degrees/s. Moving steadily it
   * follows you exactly; a sudden cut leaves the laser behind for a moment.
   * Running across it fast and CLOSE (bunny hop at 5 m ≈ 150°/s) outruns it.
   */
  sharpshooterTurnRate: 140,
  /**
   * How much it leads you (0 = where you are, 1 = where you'll be if you keep
   * going straight), like eyebatLeadFactor. It accounts for the lock time too.
   */
  sharpshooterLeadFactor: 0.9,
  /** Seconds between the end of a shot and the next aim (plus up to 1 s of variation). */
  sharpshooterShootInterval: 2.5,
  /** Lost sight of you while aiming for this long, seconds: it gives up and aims again later. */
  sharpshooterLoseSightTime: 0.4,
  /** Speed of its bullet, m/s: much faster than a fireball (12). Across 40 m in under half a second. */
  sharpshooterBulletSpeed: 100,
  sharpshooterBulletDamage: 30,
  /** Push given to the player by its bullet, m/s. */
  sharpshooterBulletKnockback: 5,
  /** Radius of its bullet, meters (for hitting the player): small, it's a bullet. */
  sharpshooterBulletRadius: 0.12,
  /** Height of the rifle's muzzle above its feet, meters (where the laser and the bullet start). */
  sharpshooterMuzzleHeight: 1.45,
  /**
   * Half the width of its collider, and its height, meters. EXACTLY the
   * ghoul's: it walks the ghouls' navigation graph, which only promises that
   * a ghoul-sized body fits (a skeleton 5 cm taller could get stuck under a
   * beam the graph says is fine).
   */
  sharpshooterRadius: 0.35,
  sharpshooterHeight: 1.8,
  /**
   * Walking to its perch, m/s: a bit slower than a ghoul (3.6), so you can
   * catch it on the way. While moving it doesn't shoot: that's your window.
   */
  sharpshooterWalkSpeed: 4,
  /** Climbing a wall, m/s (ghoul: 2.8). Halfway up a wall it's an easy target. */
  sharpshooterClimbSpeed: 3,
  /** Not seeing you for this long (seconds), it looks for a new perch. */
  sharpshooterRelocateTime: 3,
  /**
   * Cornered: on its way to the perch, if you're closer than this (meters,
   * horizontally) and it sees you, it stops and shoots you (the usual aim and
   * lock, no shortcuts), then goes on walking to the same perch.
   */
  sharpshooterCorneredRange: 10,
  /**
   * Where a perch can be: at least / at most this far from you (horizontally),
   * meters. Closer is too easy to reach (with 12 they all crowded on the
   * tallest roof next to you); farther, you'd step out of its range
   * (sharpshooterRange) as soon as you move.
   */
  sharpshooterPerchMinRange: 18,
  sharpshooterPerchMaxRange: 40,
  /**
   * How much it likes height: points per meter above you, against 1 point per
   * meter of walking. 6 = it walks 60 m more for a spot 10 m higher. (With 3,
   * in town most of them settled for the street: walking cost more than height.)
   */
  sharpshooterPerchHeightBonus: 6,
  /** It doesn't consider perches farther than this to walk to (graph cost, ≈ meters; climbing costs more). */
  sharpshooterMaxTravel: 90,
  /** HITBOX width and height (what bullets hit), meters: the hat included. */
  sharpshooterHitWidth: 0.9,
  sharpshooterHitHeight: 2.15,
  /** Hits above this height (above the feet) hit the skull or the hat: critical, meters. */
  sharpshooterHeadHeight: 1.55,
  /** How long a dead sharpshooter lies on the ground before disappearing, seconds. */
  sharpshooterCorpseTime: 3,
  /**
   * Weight in the waves' budget (src/sim/waves.ts), and for the drop chance:
   * a bit less than the bull (5), more than the hound (3).
   */
  sharpshooterCost: 4,
  /** First wave where sharpshooters can appear: between the hound (5) and the bull (7). */
  sharpshooterFromWave: 6,

  // --- The Damned Smith (special enemy of waves 9, 19, 29...; AI in src/sim/smith.ts) ---
  /**
   * Health at wave 9 (×2 at 19, like everyone: healthForWave). Tough on
   * purpose: 24 revolver body shots, 8 in the head; 3 carbine headshots.
   */
  smithHealth: 1200,
  /** Above this height (from the feet) a hit is in the head: critical. The rest is armor. */
  smithHeadHeight: 2.25,
  /** Walking speed, m/s: slow (you on foot: 6.5). It doesn't need to catch you: the shockwave reaches far. */
  smithSpeed: 2.8,
  smithAccel: 4,
  /** It starts winding up a slam when you're closer than this (and on its level), meters. */
  smithSlamRange: 9,
  /** The wind-up: hammer raised over its head, seconds. The warning: get ready to jump. */
  smithSlamWindup: 0.9,
  /** After the slam the hammer stays stuck in the ground this long: shoot its head. Seconds. */
  smithSlamRecover: 1.1,
  /** Seconds between the end of a slam and the next wind-up. */
  smithSlamCooldown: 1.8,
  /**
   * The SHOCKWAVE: a ring that spreads along the ground from the hammer,
   * at this speed (m/s) up to this radius (m). Whoever stands on the ground
   * when it passes gets hit; jump over it.
   */
  smithWaveSpeed: 12,
  smithWaveRange: 13,
  /** Thickness of the ring, meters (how precise the jump must be: 0.9 / 12 m/s ≈ 0.08 s). */
  smithWaveThickness: 0.9,
  /** Feet higher than this above the ground the ring runs on = you jumped it. Meters. */
  smithWaveHeight: 0.45,
  smithWaveDamage: 30,
  /** Push given by the wave, outward and up, m/s. */
  smithWaveKnockback: 6,
  smithWaveLift: 5,
  /**
   * The CHAIN HOOK: beyond the slam's reach (smithSlamRange) and within this
   * range (meters), if it sees you, it swings the chain for smithHookWindup
   * seconds (the warning), then throws the hook at where you'll be.
   */
  smithHookRange: 30,
  smithHookWindup: 0.7,
  /** Speed of the flying hook, m/s (18 m in 0.6 s: a sidestep when it leaves its hand dodges it). */
  smithHookSpeed: 28,
  /** How much it leads you (0 = at where you are, 1 = exactly where you'll be): partial, so a sidestep works. */
  smithHookLead: 0.5,
  /** The hook's size for hitting you, meters (added to your body, like the projectiles). */
  smithHookRadius: 0.35,
  /** Damage when the hook bites. */
  smithHookDamage: 7,
  /** Hooked: you're pulled toward it at this speed (m/s), lifted off your feet at the start (m/s up). */
  smithHookPullSpeed: 13,
  smithHookLift: 4,
  /** The pull ends this close to it (meters)... or after this many seconds (or if a wall gets in between). */
  smithHookStopDistance: 3,
  smithHookPullTime: 1.5,
  /** Seconds between two throws (and before the first one). */
  smithHookCooldown: 5,
  /** Collider: the bull's size or less, so it can use the bulls' navigation graph (BIG_BODY in nav.ts). */
  smithRadius: 0.6,
  smithHeight: 2.1,
  /** Hitbox: taller than the collider (the head and the hammer stick out above). */
  smithHitWidth: 1.6,
  smithHitHeight: 2.9,
  smithCorpseTime: 6,
  /** Weight (alive-at-once limit, coins: 10 coins). It's not in the budget: it comes on top of the wave. */
  smithCost: 10,
  /** First wave with a Smith, and every how many waves after it (9, 19, 29...: just before each health step). */
  smithFromWave: 9,
  smithEveryWaves: 10,
  /** Smiths added at every Smith wave after the first: 1 at wave 9, 2 at 19, 3 at 29... (0 = always one). */
  smithExtraPerWave: 1,
  /** It shows up when this share of the wave's budget has spawned (0.5 = halfway through). */
  smithSpawnAt: 0.5,
  /** Seconds the Damned Iron it drops stays on the ground (much longer than the other drops: it's rare). */
  ironLifetime: 90,

  // --- Map events (src/sim/mapEvents.ts, docs/DESIGN.md §5) ---
  /**
   * Waves between two map events: a random number from min to max, both
   * included (4-5 = the next one comes 4 or 5 waves after the last). The first
   * one too comes after one gap (wave 4 or 5). Never in a Damned Smith wave:
   * then it slips to the wave after.
   */
  mapEventGapMin: 4,
  mapEventGapMax: 5,
  /** Fiches for a completed event (one fiche = one drink at the saloon, for now). */
  mapEventFiches: 1,
  // --- "La Scommessa del Diavolo" (src/sim/wager.ts) ---
  /** Fiches for a won bet: more than the other events (it takes two waves, and a whole wave cursed). */
  wagerFiches: 2,
  /** Curse "nemici più veloci": how much faster the enemies' time runs (1.3 = 30% faster: walking, attacks, everything). */
  wagerFastEnemiesScale: 1.3,
  // --- The barman's drinks, the pacts (src/sim/drinks.ts) ---
  /**
   * Fiches per drink, how many drinks on the counter, and the highest level
   * of a drink marked 'levels' in DRINK_INFO (none for now: every drink has
   * one level, the user's choice; the mechanism stays for later).
   */
  drinkPrice: 1,
  drinkOfferSize: 3,
  drinkMaxLevel: 3,
  /** Bloody Mary: health back for each kill. */
  bloodyMaryHeal: 1,
  /** Corazza di vapore: at this ground speed or more (m/s), enemy projectiles do this × their damage. */
  steamArmorSpeed: 12,
  steamArmorScale: 0.5,
  /** Mano del morto: the last round of every magazine does this × the damage (every gun, the launcher too). */
  deadHandMultiplier: 3,
  /** Cambio lampo: after a weapon switch (once the gun is up), the first shot is a critical for this many seconds. */
  quickDrawWindow: 1,
  /** Ferro di cavallo storto: coins worth × this, and they fly out × this far. */
  horseshoeCoinScale: 2,
  horseshoeBurstScale: 2,
  /** Avidità: coins never vanish, but they're worth × this. */
  greedCoinScale: 0.5,
  /** Ali del corvo: jumps in mid-air (refilled on landing), and how fast each one launches you up (m/s). */
  crowJumps: 1,
  crowJumpSpeed: 7,
  /** Zoccolo del diavolo: landing after falling at least this many meters sends out a shockwave... */
  hoofMinDrop: 4,
  /** ...that throws the enemies within this radius (meters) away at this speed, with this lift (m/s). */
  hoofRadius: 6,
  hoofPush: 12,
  hoofLift: 5,
  /** Scia di brace: while sliding, a patch of fire every this many meters, this big, burning this long (s). */
  emberTrailSpacing: 0.8,
  emberTrailRadius: 0.9,
  emberTrailTime: 2,
  /** Zoccolo duro: an enemy hit by your boot or shovel is stunned this long (seconds): no AI, it just stands (or flies) there. */
  hardHoofStun: 1.5,
  /** Bobby: your melee sends back the enemy projectiles within this reach (meters, from your chest, in front of you), this × faster. */
  bobbyReach: 3,
  bobbySpeedScale: 1.3,
  /** ...and they hit the enemies for this × the damage they'd have done to you. */
  bobbyDamageScale: 5,
  /** Debito col diavolo: how far below zero your vildenaro can go. */
  devilsDebtLimit: 1500,
  /** Sangue per piombo: health per shot when the gun and the pockets are empty (it never takes your last point). */
  bloodForLeadCost: 5,
  /** Fondina calda: a gun in the holster pushes one round from the pocket into itself every this many seconds. */
  hotHolsterTime: 1.5,
  /** Ultimo respiro: the enemies within this radius are thrown away when it saves you. */
  lastBreathRadius: 5,
  lastBreathPush: 14,
  /** Tequila del torero: health back for every OLÉ! (a bull's charge dodged close) and every PER UN PELO (a projectile by a hair). */
  tequilaHeal: 10,
  /** Contratto del becchino: every this many kills in a row without taking damage, + this much max health (until you die). */
  contractKills: 15,
  contractHealth: 5,
  /** Mano del baro: a completed event gives this × the fiches; a failed one takes this much max health (until you die). */
  cardSharpFichesScale: 2,
  cardSharpHealthCost: 25,

  // "Le Campane del Giudizio" (src/sim/bells.ts)
  /** How many bells to ring, in order. */
  bellsCount: 3,
  /** Seconds to ring the others once the first one has rung. */
  bellsTime: 45,
  /** Each bell at least this far (meters, on the ground plane) from the one before it. */
  bellsMinSpacing: 25,
  /** A bullet or a blast this close to the bell's middle rings it (meters). */
  bellRadius: 0.8,
  /** Your chest this close to the bell's middle rings it: run into it, kick it (meters). */
  bellTouchReach: 1.6,

  // "Pony Express dell'Inferno" (src/sim/ponyExpress.ts)
  /** How many rings in the trail. */
  ponyRings: 8,
  /** Each ring between these many meters (on the ground plane) from the one before it. */
  ponyMinGap: 12,
  ponyMaxGap: 22,
  /** Your chest passing this close to a ring's middle counts as through it (meters). */
  ponyRingRadius: 1.5,
  /** Seconds on the clock when you pass the first ring, and added by every next one... */
  ponyStartTime: 10,
  ponyRingBonus: 5,
  /** ...but never more than this on the clock (seconds): a fast start can't bank a minute. */
  ponyMaxTime: 15,

  // "Il Cuore di Brace" (src/sim/emberHeart.ts)
  /** Radius of its circle, meters (on the ground plane: it's a column, height doesn't matter). */
  emberHeartRadius: 16,
  /** Souls it wants: this share of the wave's whole weight (waveBudget: ~half the horde). */
  emberHeartShare: 0.5,
  /** How fast it wanders, m/s (you run at 6.5: a bit slower than you, so you can keep up). */
  emberHeartSpeed: 4.5,
  /** Each leg of its wandering ends between these many meters (on the ground plane) from where it starts. */
  emberHeartLegMin: 18,
  emberHeartLegMax: 40,
  /** Seconds it rests at the end of each leg (and right after waking up). */
  emberHeartRest: 2,
  /** Your chest this close to the crystal's middle wakes it up (meters). */
  emberHeartWakeReach: 2.2,

  // "Lo Sciacallo" (src/sim/jackal.ts)
  /** Seconds you have from when it shows up: then it escapes in a puff of fire (if the wave doesn't end first). */
  jackalTime: 75,
  /** Health (× the wave's health step, healthForWave): a revolver body shot does 50, a headshot 150. */
  jackalHealth: 400,
  /** How fast it runs away, m/s: a bit slower than you (6.5), so you can catch up... */
  jackalSpeed: 6,
  /** ...but hit, it bolts: this fast (m/s) for this long (seconds). */
  jackalPanicSpeed: 9,
  jackalPanicTime: 1.2,
  /** Climbing speed, m/s (it climbs only the walls you can get up too). Climbing is where you catch it. */
  jackalClimbSpeed: 3.2,
  /** It starts running when you're this close (meters, on the ground plane)... */
  jackalFleeRange: 22,
  /** ...and stops to taunt you once you're this far, for a second or so. */
  jackalCalmRange: 32,
  /**
   * The escape map: the flow field toward you × −this (nav.ts, computeFleeField).
   * More than 1: it would rather run past you toward open ground than into a corner.
   */
  jackalFleeScale: 1.2,
  /** ...and every meter above you is worth this many meters of distance: it likes roofs (it climbs, rides the vents). */
  jackalHeightBonus: 3,
  /** It shows up this far from you (meters, on the ground plane). */
  jackalSpawnMin: 30,
  jackalSpawnMax: 55,
  /** Coins it loses at every hit, and the ones left in its sack (they all burst out when it dies). */
  jackalCoinsPerHit: 3,
  jackalBagCoins: 20,
  /** Its weight: only for the chance of an item drop (dropChancePerWeight). It isn't part of the wave. */
  jackalCost: 3,
  /** Collider (a small body: it fits everywhere a ghoul does). */
  jackalRadius: 0.3,
  jackalHeight: 1.3,
  /** Hitbox: not tiny on purpose (it's slippery because it moves, not because it's a pixel). */
  jackalHitWidth: 1.0,
  jackalHitHeight: 1.4,
  /** Hits above this height (from its feet) are on the head: critical. Matches the sprite. */
  jackalHeadHeight: 0.95,
  /** Seconds its body lies on the ground. */
  jackalCorpseTime: 4,

  // "Il Pozzo delle Anime" (src/sim/soulWell.ts)
  /** Souls the well wants: this share of the wave's whole weight (waveBudget: ~7 at wave 5, ~15 at wave 10). */
  soulWellShare: 0.4,
  /** Seconds a soul floats on the ground before it goes out (the clock of this event). */
  soulLifetime: 8,
  /** How high over the floor a soul floats (meters): about your chest, so running through it catches it. */
  soulHover: 1.1,
  /** How fast a soul sinks (or rises) to that height, m/s (an eye-bat's soul comes down from the sky). */
  soulSinkSpeed: 3,
  /** Closer than this (meters, to your chest) a soul flies to you by itself... */
  soulMagnetRange: 3.5,
  /** ...this fast, m/s (faster than you run: once it's coming, it's yours). */
  soulMagnetSpeed: 10,
  /** Closer than this (meters, to your chest) and it's caught. */
  soulCollectReach: 1.2,
  /** Within this many meters of the well's middle (on the ground plane) you wake it and drop the souls in. */
  soulWellReach: 3.5,

  // --- Enemy projectiles (src/sim/projectiles.ts) ---
  /** Radius of an enemy projectile, meters (for hitting the player). */
  projectileRadius: 0.25,
  /** Seconds before a projectile that hit nothing fizzles out. */
  projectileLifetime: 5,

  // --- Waves (CoD-zombies style; the curve is in src/sim/waves.ts) ---
  /** Turn off to roam the map without enemies. */
  wavesEnabled: true,
  /** Weight budget of wave 1 (= number of enemies, if they all weigh 1). */
  waveBaseCount: 8,
  /** Max weight alive at the same time, in any wave (reached around wave 17). */
  waveMaxAliveCap: 40,
  /**
   * SPAWN WEIGHTS: how likely each type is at every spawn (among those the
   * budget can afford and that already appear in this wave). Relative
   * numbers: 15 vs 1 = fifteen times more likely. Lots of weak ghouls around
   * you (the horde), a few elites that punish you. With all equal (the old
   * way) wave 9 was ~3 ghouls out of ~12 enemies. Now (simulated): wave 5
   * ≈ 10 ghouls + 3 others, wave 9 ≈ 15 + 6, wave 20 ≈ 43 + 19.
   */
  ghoulSpawnWeight: 15,
  eyebatSpawnWeight: 3,
  houndSpawnWeight: 2,
  bullSpawnWeight: 1,
  sharpshooterSpawnWeight: 1,
  /** Enemy health goes up one step (+ base health) every this many waves. */
  waveHealthStep: 10,
  /**
   * ...but never above this many times the base health: ×4 = ghoul 200 from
   * wave 30 (4 body shots, 2 headshots). No bullet sponges in the late game:
   * the difficulty keeps growing through numbers, speed and aggression.
   */
  waveHealthMaxMultiplier: 4,
  /**
   * The wave where the "pressure" peaks (see wavePressure in waves.ts):
   * eye-bats shoot and ghouls pounce more and more often until here, then stay put.
   */
  wavePeak: 35,
  /** At the peak, eye-bats wait this fraction of eyebatShootInterval between shots. */
  peakShootIntervalFactor: 0.6,
  /** At the peak, ghouls wait this fraction of ghoulLungeCooldown between pounces. */
  peakLungeCooldownFactor: 0.5,
  /** Share of runners among the ghouls at the peak (it's 60% at wave 9, then grows to this). */
  peakRunnerChance: 0.9,
  /** Seconds before the first wave. */
  waveFirstBreak: 4,
  /** Seconds of breather between waves (the 'skipBreak' key, Q, skips it: InputCommand.skipBreak). */
  waveBreak: 10,
  /** Enemies never spawn closer than this to the player, meters. */
  spawnMinDistance: 15,
  /** Spawn points farther than this are used only if there's nothing closer, meters. */
  spawnMaxDistance: 40,
  /**
   * Chance that a spawn is picked AHEAD of you (in the direction you're
   * running), when you're moving. 0 = anywhere. High = laps lead you into the horde.
   */
  spawnAheadChance: 0.7,

  // --- Style meter (src/sim/style.ts) ---
  /**
   * Seconds you have to do something stylish again before the chain BREAKS
   * and the style drops to zero at once. Short = harsh, long = forgiving.
   */
  styleChainTime: 5,
  /** Style points to climb one rank: D → C → B → A → S → SS → HIGH NOON (6 steps = 1500). */
  styleRankPoints: 250,
  /** Style points for every hit on an enemy (a shotgun blast counts once per enemy). */
  styleHit: 5,
  /** Extra style points for a kill (a one-shot kill = styleHit + styleKill). */
  styleKill: 40,
  /** Extra style points if the kill was a headshot (on top of styleKill). */
  styleHeadshotKill: 30,
  // Kill bonuses: extra lines on top of the kill, each with its own points.
  /** A kill while you're in the air ("DAL CIELO"). */
  styleAirKill: 30,
  /** A kill while sliding ("IN SCIVOLATA"). */
  styleSlideKill: 25,
  /** A kill with your boot ("DI STIVALE") or the shovel ("DI BADILE"). */
  styleKickKill: 30,
  /** A kill right after switching weapon ("CAMBIO LAMPO")... */
  styleQuickSwitchKill: 30,
  /** ...within this many seconds after the new weapon is ready. */
  styleQuickSwitchTime: 0.6,
  /** A carbine kill shortly after you started aiming ("QUICKSCOPE")... */
  styleQuickscope: 50,
  /** ...at most this many seconds of aiming (rifleAdsTime is 0.18: the gun must be up). */
  styleQuickscopeTime: 0.5,
  /** A carbine kill from the hip, far away ("NOSCOPE")... */
  styleNoscope: 50,
  /** ...at least this far, meters. */
  styleNoscopeDistance: 15,
  /** A shotgun kill up close ("A BRUCIAPELO")... */
  stylePointBlank: 20,
  /** ...at most this far, meters. */
  stylePointBlankDistance: 2.5,
  /** A revolver or carbine kill from far away ("DA LONTANO")... */
  styleLongShot: 30,
  /** ...at least this far, meters. */
  styleLongShotDistance: 30,
  /** A kill with the last round in the revolver or the carbine ("ULTIMO COLPO"). */
  styleLastRound: 25,
  /** A kill with little health left ("SUL FILO")... */
  styleCloseCall: 30,
  /** ...at most this much health. */
  styleCloseCallHealth: 25,
  /** Several kills with ONE shot (or one kick): points for every kill after the first. */
  styleMultiKill: 40,
  /** Kills in a quick sequence: each kill within this many seconds of the previous one extends the streak... */
  styleStreakTime: 1.5,
  /** ...and gives this × (kills in the streak - 1): DOPPIA +20, TRIPLA +40, ... */
  styleStreak: 20,
  // Movement: style that keeps the chain alive without shooting.
  /** Above this horizontal speed (m/s) you earn style continuously (running is 8: bhop, slide, wall jumps)... */
  styleSpeedMin: 14,
  /** ...this many points per second at styleSpeedMin, more the faster you go (× speed / styleSpeedMin). */
  styleSpeed: 8,
  /** Seconds in the air: from this flight time on, landing gives style ("IN VOLO 1,8 s")... */
  styleAirTimeMin: 1,
  /** ...this many points per second of flight. */
  styleAirTime: 20,
  /** A wall jump: this × how many wall jumps in this flight (the third is worth 3×). */
  styleWallJump: 10,
  /** A bunny hop: this × how many hops in a row (up to 5×). */
  styleBhop: 4,
  /** A jump out of a slide. */
  styleSlideJump: 15,
  /** Launched by a steam vent. */
  styleVent: 10,
  /** An enemy projectile flew past you by a hair ("PER UN PELO")... */
  styleNearMiss: 30,
  /** ...closer than this to your chest, meters. */
  styleNearMissDistance: 1.2,
  /** A charging bull ran past you without hitting you ("OLÉ")... */
  styleTorero: 50,
  /** ...and you were at most this far to its side, meters. */
  styleToreroDistance: 3,
  // Variety: the same action again and again is worth less and less.
  /** Every time you do an action, its next one is worth this much less (0.8 = -20%)... */
  styleRepeatFactor: 0.6,
  /** ...but never less than this fraction of its points... */
  styleRepeatMin: 0.25,
  /** ...and it gets fresh again over time: fraction of its value recovered per second. */
  styleRepeatRecover: 0.15,
  /** Style points lost per point of damage taken (ghoul claw 20 → 60 points). */
  styleHurtPerDamage: 6,
  /**
   * HIGH NOON, the climax: when you reach the top rank, for this many seconds
   * the guns never run dry (no reloading, just shoot). Then the style starts over from zero.
   */
  styleHighNoonTime: 5,
  /**
   * The style MULTIPLIES score and vildenaro: ×(1 + rank × this). With 0.5:
   * D ×1, C ×1.5, B ×2, A ×2.5, S ×3, SS ×3.5, HIGH NOON ×4. No chain = ×1.
   */
  styleMultiplierPerRank: 0.5,
};

/** Converts a duration in seconds to a whole number of ticks. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}
