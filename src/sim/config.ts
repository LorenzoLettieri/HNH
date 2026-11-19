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
  /**
   * Damage per bullet. Health is designed in "shots to kill" (see the
   * breakpoint table in docs/DESIGN.md): 50 = one shot on a basic ghoul.
   */
  revolverDamage: 50,
  /** Headshot damage multiplier: this is an aim game, headshots are king. */
  headshotMultiplier: 3,
  /** Max shooting distance, meters. */
  weaponRange: 200,

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
  ghoulRadius: 0.35,
  ghoulHeight: 1.8,
  /** Obstacles up to this height are hopped over, meters. */
  ghoulJumpHeight: 1.1,
  /** Ghouls closer than this push each other apart, meters. */
  ghoulSeparation: 1,
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
  ghoulLungeWindup: 0.35,
  /** Max horizontal speed of the pounce, m/s (you run at 8: it's faster than you, briefly). */
  ghoulLungeSpeed: 13,
  /** Upward speed of the pounce, m/s: low and flat, ~0.4 s in the air. */
  ghoulLungeUpSpeed: 4,
  /** How much it aims where you'll be when it lands (0 = where you are, 1 = full lead). */
  ghoulLungeLead: 0.8,
  ghoulLungeDamage: 20,
  /** After landing it stays still this long, seconds: the moment to punish it. */
  ghoulLungeRecover: 0.6,
  /** Seconds between two pounces of the same ghoul (plus up to 1.5 s of variation). */
  ghoulLungeCooldown: 3,
  /** Climbing speed up walls, m/s. */
  ghoulClimbSpeed: 2.8,
  /** Closer than this (and on the same level) it walks straight at you, ignoring the graph. */
  ghoulDirectChaseRange: 5,
  /** How long a dead ghoul lies on the ground before disappearing, seconds. */
  ghoulCorpseTime: 4,
  /** Speed of the "runners" (fast ghouls, from wave 4), m/s. */
  ghoulRunnerSpeed: 5.4,
  /** Weight in the waves' budget (how much trouble it is; see src/sim/waves.ts). */
  ghoulCost: 1,

  // --- Malocchio (flying eye-bat; AI in src/sim/eyebat.ts) ---
  /**
   * Health: 2 body shots, 1 in the pupil (50 × 3 = 150). Breakpoints, see
   * docs/DESIGN.md: it's a "hit the pupil" enemy, not a sponge.
   */
  eyebatHealth: 100,
  /** Radius of the round body (the eye), meters. Its hitbox is a cube this wide ×2. */
  eyebatRadius: 0.4,
  /**
   * Critical spot: a bullet passing closer than this to the CENTER of the eye
   * hits the pupil (×headshotMultiplier). The pupil always faces you, so
   * "close to the center, as seen from you" = "in the pupil". Meters.
   */
  eyebatPupilRadius: 0.15,
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
  /** Weight in the waves' budget (see src/sim/waves.ts). */
  eyebatCost: 1,
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
  /** Max weight alive at the same time, in any wave. */
  waveMaxAliveCap: 24,
  /** Enemy health goes up one step (+ base health) every this many waves. */
  waveHealthStep: 10,
  /** Seconds before the first wave. */
  waveFirstBreak: 4,
  /** Seconds of breather between waves. */
  waveBreak: 8,
};

/** Converts a duration in seconds to a whole number of ticks. */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICK_RATE);
}
