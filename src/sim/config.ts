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
  maxGroundSpeed: 8,
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
  bhopBoost: 1,
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
  slideBoost: 3,
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
  wallJumpUp: 7,
  /** Speed pushing you away from the wall, m/s (small: it's not a bounce). */
  wallJumpPush: 2.5,
  /**
   * Apex-style: speed added along the wall, in the direction you're looking, m/s.
   * Shrinks at high speed like the hop boost (same falloff).
   */
  wallJumpBoost: 2.5,
  /** Wall jumps allowed before touching the ground again. */
  wallJumpsMax: 3,
  /** Minimum seconds between two wall jumps (else holding jump would burn them all at once). */
  wallJumpCooldown: 0.2,

  // --- Revolver ---
  /** Shots in the cylinder. */
  revolverAmmo: 6,
  /** Minimum seconds between two shots (it's semi-automatic: one click = one shot). */
  revolverFireInterval: 0.22,
  /** A click slightly before the gun is ready still fires as soon as it is, seconds. */
  revolverFireBuffer: 0.12,
  /** Seconds to reload all 6 rounds. */
  revolverReloadTime: 1.1,
  /** Spare bullets in your pockets at the start (the reload takes them from here). */
  revolverReserveStart: 36,
  /** Most spare bullets you can carry: pickups above this are wasted. */
  revolverReserveMax: 72,
  /**
   * Damage per bullet. Health is designed in "shots to kill" (see the
   * breakpoint table in docs/DESIGN.md): 50 = one shot on a basic ghoul.
   */
  revolverDamage: 50,
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
  shotgunReserveMax: 24,
  /** Debug: reloading doesn't use up the reserve. */
  infiniteAmmo: false,

  // --- Drops and pickups (see pickups.ts) ---
  /** Drop chance per point of enemy weight (ghoulCost 1 → 20%, eyebatCost 2 → 40%, houndCost 3 → 60%). */
  dropChancePerWeight: 0.2,
  /** The drop chance never goes above this (heavy enemies of the future). */
  dropChanceMax: 0.8,
  /**
   * What a drop is: WEIGHTS, not percentages (see pickKind in pickups.ts).
   * 4/3/3 = 40% bullets, 30% shells, 30% medkits. Set one to 0 to never drop it.
   */
  dropWeightBullets: 4,
  dropWeightShells: 3,
  dropWeightMedkit: 3,
  /** Seconds a drop stays on the ground before vanishing. */
  dropLifetime: 10,
  /** How close (horizontally) you must pass to collect it, meters. */
  pickupRadius: 1.0,
  /** Health a medkit gives back. */
  medkitHeal: 25,
  /** Revolver bullets in a 'bullets' drop. */
  ammoPickupBullets: 12,
  /** Shotgun shells in a 'shells' drop. */
  ammoPickupShells: 4,
  /** Pellets per shot (a fixed pattern: center + inner ring + outer ring). */
  shotgunPellets: 12,
  /** Half-angle of the outer ring of the pattern, degrees (7° = ~1.2 m wide at 10 m). */
  shotgunSpread: 7,
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
  ghoulSpeed: 3.6,
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
  ghoulAttackTime: 0.7,
  /** Pause between attacks, seconds. */
  ghoulAttackCooldown: 0.6,
  /** Damage of one claw swipe. */
  ghoulDamage: 20,
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
  houndSpeed: 9.5,
  /** Sprint speed of the ambush, m/s: as fast as a good bunny hop. */
  houndChargeSpeed: 13,
  /** While stalking it keeps about this far from you, meters. */
  houndStalkDistance: 12,
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
  houndBiteWindup: 0.25,
  /** Damage of a bite (less than a claw: it's quick and bites often). */
  houndBiteDamage: 15,
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
  bullChargeDamage: 40,
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
   * Other enemies in the way of a charge get run over too: damage (100 =
   * a ghoul dies up to wave 19) and a throw (m/s, sideways out of its path
   * and forward; and up). Lure it through the horde.
   */
  bullTrampleDamage: 100,
  bullTrampleKnockback: 12,
  bullTrampleLift: 6,
  /** After an overshoot it skids to a stop for this long, seconds. */
  bullSkidTime: 0.9,
  /**
   * Crashed into a wall (or a low obstacle: it doesn't jump while charging):
   * dazed for this long, seconds. Every hit is critical meanwhile. The reward for dodging.
   */
  bullStunTime: 2.2,
  /** Minimum time between two charges, seconds (counted from the end of the previous one). */
  bullChargeCooldown: 1.5,
  /** Half the width of its COLLIDER, meters: wide, but it still fits in the 2.5 m alleys. */
  bullRadius: 0.65,
  /** Collider height, meters: taller than you. It can't go under the slide passages. */
  bullHeight: 2.1,
  /** HITBOX width and height (what bullets hit), meters: a big target. */
  bullHitWidth: 2.0,
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
  eyebatSpeed: 6,
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
  eyebatProjectileSpeed: 12,
  /**
   * How much it LEADS the shot: 0 = aims where you are now (only hits you if
   * you stand still), 1 = aims exactly where you'll be if you keep going
   * straight at the same speed. In between, it aims part of the way.
   * High = running in circles or in a straight line gets you hit: to dodge
   * you must CHANGE direction (jump, slide, cut back) after the warning.
   */
  eyebatLeadFactor: 0.9,
  eyebatProjectileDamage: 15,
  /** Push given to the player by a fireball, m/s. */
  eyebatProjectileKnockback: 3,

  // --- Enemy projectiles (src/sim/projectiles.ts) ---
  /** Radius of an enemy projectile, meters (for hitting the player). */
  projectileRadius: 0.25,
  /** Seconds before a projectile that hit nothing fizzles out. */
  projectileLifetime: 5,

  // --- Waves (CoD-zombies style; the curve is in src/sim/waves.ts) ---
  /** Turn off to roam the map without enemies. */
  wavesEnabled: true,
  /** Weight budget of wave 1 (= number of enemies, if they all weigh 1). */
  waveBaseCount: 6,
  /** Max weight alive at the same time, in any wave (reached around wave 17). */
  waveMaxAliveCap: 40,
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
  /** Seconds of breather between waves. */
  waveBreak: 8,
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
  styleChainTime: 3,
  /** Style points to climb one rank: D → C → B → A → S → SS → HIGH NOON (6 steps = 1200). */
  styleRankPoints: 200,
  /** Style points for every hit on an enemy (a shotgun blast counts once per enemy). */
  styleHit: 5,
  /** Extra style points for a kill (a one-shot kill = styleHit + styleKill). */
  styleKill: 40,
  /** Extra style points if the kill was a headshot (on top of styleKill). */
  styleHeadshotKill: 30,
  /** Style points lost per point of damage taken (ghoul claw 20 → 60 points). */
  styleHurtPerDamage: 3,
};

/** Converts a duration in seconds to a whole number of ticks. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}
