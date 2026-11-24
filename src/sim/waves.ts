// Waves, CoD-zombies style: wave 1, 2, 3... each bigger and tougher, with a
// short breather in between. Also keeps the score.
//
// What spawns is decided with a BUDGET of "weight" points ("director" style,
// like Left 4 Dead): every enemy type has a cost (its weight: how much
// trouble it is), every wave has a budget, and each spawn picks a RANDOM type
// among those the remaining budget can afford. Same budget, different mix in
// every game. A future tough enemy (a brute worth 5) just gets a higher cost.
import { maxHealth } from './drinks';
import { secondsToTicks, tuning } from './config';
import { createBull, createEyebat, createGhoul, createHound, createSharpshooter, createSmith, isEnemy, type Enemy, type GhoulEntity } from './entities';
import { random, randomInt } from './random';
import type { SimEvent } from './events';
import type { GameState } from './game';
import type { SpawnPoint, World } from './world';
import { raycastBoxes } from './raycast';
import { currentEyeHeight } from './player';
import type { Stats } from './stats';

export interface WaveState {
  /** Current wave (0 = before the first one). */
  number: number;
  /** 'break' = the pause between waves; 'active' = ghouls are coming. */
  phase: 'break' | 'active';
  /** Break: ticks until the next wave. */
  breakTicks: number;
  /** Active: weight points of this wave not spawned yet (see waveBudget). */
  budgetLeft: number;
  spawnCooldownTicks: number;
  /** Damned Smiths that still have to show up in this wave (waves 9, 19, 29...: see smithsForWave). */
  smithsPending: number;
}


export function createWaveState(): WaveState {
  return {
    number: 0,
    phase: 'break',
    breakTicks: secondsToTicks(tuning.waveFirstBreak),
    budgetLeft: 0,
    spawnCooldownTicks: 0,
    smithsPending: 0,
  };
}

/**
 * Is wave n one with a Damned Smith? 9, 19, 29...: the wave right BEFORE each
 * health step (healthForWave: ×2 at 10, ×3 at 20). Killing it gives you the
 * Damned Iron, and the Forge reinforces a gun just as the enemies get tougher.
 * (n − first) % every === 0 → "every `every` waves, starting from `first`".
 */
export function isSmithWave(n: number): boolean {
  return n >= tuning.smithFromWave && (n - tuning.smithFromWave) % tuning.smithEveryWaves === 0;
}

/**
 * How many Smiths wave n brings: 0 outside the Smith waves, then 1 at the
 * first, and smithExtraPerWave more at each one after (1, 2, 3... at 9, 19, 29).
 * (n − first) / every = how many Smith waves came before this one.
 */
export function smithsForWave(n: number): number {
  if (!isSmithWave(n)) return 0;
  return 1 + tuning.smithExtraPerWave * ((n - tuning.smithFromWave) / tuning.smithEveryWaves);
}

// --- The difficulty curve: everything that changes from wave to wave --------
/**
 * Weight budget of wave n: 6, 8, 10, 12, 15, 17, 20... growing faster and
 * faster. With every enemy weighing 1, it's simply the number of enemies.
 */
export function waveBudget(n: number): number {
  return Math.round(tuning.waveBaseCount + 2 * (n - 1) + 0.15 * (n - 1) ** 2);
}
/** How much weight can be alive at the same time: 8, 10, 12... up to waveMaxAliveCap. */
function maxAlive(n: number): number {
  return Math.min(tuning.waveMaxAliveCap, 6 + 2 * n);
}

/**
 * "Pressure": 0 at wave 1, growing in a straight line to 1 at tuning.wavePeak,
 * then it stays at 1. One number for "how aggressive are the enemies now",
 * used to scale how often eye-bats shoot and ghouls pounce. (A linear
 * interpolation, "lerp": value = start + (end − start) × pressure.)
 */
export function wavePressure(n: number): number {
  return Math.min(1, Math.max(0, (n - 1) / Math.max(1, tuning.wavePeak - 1)));
}
/** Linear interpolation: a at t = 0, b at t = 1. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Seconds between two spawns: faster in later waves. */
function spawnInterval(n: number): number {
  return Math.max(0.5, 2 - 0.15 * (n - 1));
}
/**
 * Share of "runners" among the ghouls: none in the first 3 waves, then +10%
 * per wave up to 60% at wave 9; then slower, up to peakRunnerChance at the peak.
 */
function runnerChance(n: number): number {
  if (n <= 9) return Math.max(0, (n - 3) * 0.1);
  const t = Math.min(1, (n - 9) / Math.max(1, tuning.wavePeak - 9));
  return lerp(0.6, tuning.peakRunnerChance, t);
}

/**
 * Health grows in STEPS, slowly: ×1 (waves 1-9), ×2 (10-19), ×3 (20-29)...
 * For a ghoul: 50, 100, 150. Designed in shots to kill (revolver 50,
 * headshot ×3): waves 1-9 any hit kills; 10-29 the body needs more shots but
 * the head is still one; from 30 even the head needs two. The difficulty of
 * early waves comes from numbers, mix and speed, not from bullet sponges.
 */
export function healthForWave(baseHealth: number, n: number): number {
  const steps = 1 + Math.floor(n / tuning.waveHealthStep);
  return baseHealth * Math.min(steps, tuning.waveHealthMaxMultiplier);
}

/**
 * The roster: every enemy type the waves can spawn, with its cost.
 * Adding an enemy to the waves = adding a line here.
 */
interface EnemyType {
  /** Which entity it spawns (to count how many of this type are alive). */
  type: Enemy['type'];
  /** Weight: how many budget points it takes. */
  cost: () => number;
  /** Spawn weight: how likely it is to be picked (relative to the others, see pickWeighted). */
  chance: () => number;
  /** First wave it can appear in. */
  fromWave: () => number;
  /** Optional: max alive at the same time (when reached, the budget goes to the other types). */
  maxAlive?: () => number;
  spawn: (game: GameState, id: number, x: number, y: number, z: number) => Enemy;
}
const ROSTER: EnemyType[] = [
  {
    type: 'ghoul',
    cost: () => tuning.ghoulCost,
    chance: () => tuning.ghoulSpawnWeight,
    fromWave: () => 1,
    spawn: (game, id, x, y, z) => {
      const n = game.wave.number;
      const runner = random(game) < runnerChance(n);
      return createGhoul(id, x, y, z, healthForWave(tuning.ghoulHealth, n), runner);
    },
  },
  {
    type: 'eyebat',
    cost: () => tuning.eyebatCost,
    chance: () => tuning.eyebatSpawnWeight,
    fromWave: () => tuning.eyebatFromWave,
    // Flyers appear in the air above the spawn point, then fly to you.
    spawn: (game, id, x, y, z) =>
      createEyebat(id, x, y + tuning.eyebatSpawnHeight, z, healthForWave(tuning.eyebatHealth, game.wave.number)),
  },
  {
    type: 'hound',
    cost: () => tuning.houndCost,
    chance: () => tuning.houndSpawnWeight,
    fromWave: () => tuning.houndFromWave,
    maxAlive: () => tuning.houndMaxAlive,
    spawn: (game, id, x, y, z) => createHound(id, x, y, z, healthForWave(tuning.houndHealth, game.wave.number)),
  },
  {
    type: 'bull',
    cost: () => tuning.bullCost,
    chance: () => tuning.bullSpawnWeight,
    fromWave: () => tuning.bullFromWave,
    spawn: (game, id, x, y, z) => createBull(id, x, y, z, healthForWave(tuning.bullHealth, game.wave.number)),
  },
  {
    type: 'sharpshooter',
    cost: () => tuning.sharpshooterCost,
    chance: () => tuning.sharpshooterSpawnWeight,
    fromWave: () => tuning.sharpshooterFromWave,
    // Born without a perch: the first thing it does is pick one and walk there (sharpshooter.ts).
    spawn: (game, id, x, y, z) =>
      createSharpshooter(id, x, y, z, healthForWave(tuning.sharpshooterHealth, game.wave.number)),
  },
];

/** How much an enemy weighs (for the "alive at the same time" limit, and the drop chance in pickups.ts). */
export function enemyCost(e: Enemy): number {
  if (e.type === 'ghoul') return tuning.ghoulCost;
  if (e.type === 'eyebat') return tuning.eyebatCost;
  if (e.type === 'hound') return tuning.houndCost;
  if (e.type === 'sharpshooter') return tuning.sharpshooterCost;
  if (e.type === 'smith') return tuning.smithCost;
  return tuning.bullCost;
}

export function stepWaves(game: GameState, world: World, events: SimEvent[]): void {
  // Dead enemies lie on the ground for a while, then are removed from the list.
  // (Eye-bats, hounds, bulls and sharpshooters count their own stateTicks: they keep falling while dead.)
  const corpseTicks = {
    ghoul: secondsToTicks(tuning.ghoulCorpseTime),
    eyebat: secondsToTicks(tuning.eyebatCorpseTime),
    hound: secondsToTicks(tuning.houndCorpseTime),
    bull: secondsToTicks(tuning.bullCorpseTime),
    sharpshooter: secondsToTicks(tuning.sharpshooterCorpseTime),
    smith: secondsToTicks(tuning.smithCorpseTime),
  };
  game.entities = game.entities.filter(
    (e) => !(isEnemy(e) && e.state === 'dead' && e.stateTicks > corpseTicks[e.type]),
  );
  for (const e of game.entities) if (e.type === 'ghoul' && e.state === 'dead') e.stateTicks++;

  if (!tuning.wavesEnabled) return;
  const w = game.wave;
  // Weight alive right now (with every enemy weighing 1: how many are alive).
  let alive = 0;
  const aliveByType: Record<Enemy['type'], number> = { ghoul: 0, eyebat: 0, hound: 0, bull: 0, sharpshooter: 0, smith: 0 };
  for (const e of game.entities) {
    if (!isEnemy(e) || e.state === 'dead') continue;
    alive += enemyCost(e);
    aliveByType[e.type]++;
  }

  if (w.phase === 'break') {
    w.breakTicks--;
    if (w.breakTicks <= 0) {
      w.number++;
      w.phase = 'active';
      w.budgetLeft = waveBudget(w.number);
      w.spawnCooldownTicks = 0;
      w.smithsPending = smithsForWave(w.number);
      events.push({ type: 'waveStart', wave: w.number });
    }
    return;
  }

  // Active: wave cleared when everything has spawned AND died (the Smiths too).
  if (w.budgetLeft === 0 && alive === 0 && w.smithsPending === 0) {
    events.push({ type: 'waveEnd', wave: w.number });
    w.phase = 'break';
    w.breakTicks = secondsToTicks(tuning.waveBreak);
    return;
  }

  if (w.spawnCooldownTicks > 0) {
    w.spawnCooldownTicks--;
    return;
  }
  // The Damned Smiths: once smithSpawnAt of the budget has spawned (halfway
  // through the wave), on top of the budget and of the alive limit: it's an
  // event, it doesn't wait for a free spot. More than one (wave 19 on): one
  // per spawn, a spawn interval apart, so each picks its own spawn point.
  if (w.smithsPending > 0 && w.budgetLeft <= waveBudget(w.number) * (1 - tuning.smithSpawnAt)) {
    const at = pickSpawn(game, world);
    if (at) {
      const smith = createSmith(game.nextEntityId++, at.x, at.y, at.z, healthForWave(tuning.smithHealth, w.number));
      game.entities.push(smith);
      // first = the one that opens the group (the banner), total = how many in the wave.
      const total = smithsForWave(w.number);
      events.push({ type: 'smithArrived', entityId: smith.id, first: w.smithsPending === total, total });
      w.smithsPending--;
      w.spawnCooldownTicks = secondsToTicks(spawnInterval(w.number));
      return;
    }
  }
  if (w.budgetLeft === 0 || alive >= maxAlive(w.number)) return;
  const s = pickSpawn(game, world);
  if (!s) return;

  // Pick a random enemy type among those the remaining budget can afford.
  // (Random from the game's seeded generator: deterministic, see random.ts.)
  const affordable = ROSTER.filter((t) => t.cost() <= w.budgetLeft && w.number >= t.fromWave());
  if (affordable.length === 0) {
    w.budgetLeft = 0; // leftover too small for anything: the wave is fully spawned
    return;
  }
  // ...minus the types already at their max alive (e.g. hounds): this spawn
  // goes to the others. If ALL the affordable ones are full (only hounds left
  // in the budget), wait for one to die.
  const allowed = affordable.filter((t) => !t.maxAlive || aliveByType[t.type] < t.maxAlive());
  if (allowed.length === 0) return;
  const type = pickWeighted(game, allowed);
  game.entities.push(type.spawn(game, game.nextEntityId++, s.x, s.y, s.z));
  w.budgetLeft -= type.cost();
  w.spawnCooldownTicks = secondsToTicks(spawnInterval(w.number));
}

/**
 * A WEIGHTED random pick ("roulette wheel"): line the weights up one after
 * the other on a segment (ghoul 15, eye-bat 3, hound 2 = a segment 20 long,
 * the ghoul taking the first 15), throw a random point on it, and see whose
 * slice it falls into. Each type comes out with probability weight / total
 * (like Laravel's Arr::random, but with unequal odds). With every weight at 0 it falls back to an equal
 * chance, so a wave always finishes spawning.
 */
function pickWeighted(game: GameState, types: EnemyType[]): EnemyType {
  let total = 0;
  for (const t of types) total += Math.max(0, t.chance());
  if (total <= 0) return types[randomInt(game, types.length)];
  let roll = random(game) * total;
  for (const t of types) {
    roll -= Math.max(0, t.chance());
    if (roll < 0) return t;
  }
  return types[types.length - 1]; // only by rounding: roll landed exactly on the end
}

/**
 * Where does the next enemy come from? Like CoD Zombies or Left 4 Dead,
 * the spawns try to be in a place you can't see, and in FRONT of you:
 * running in circles shouldn't mean dragging the whole horde behind you,
 * it should lead you straight into the next one.
 *
 * It filters in layers, keeping a layer only if it isn't empty:
 *   1. not too close (spawnMinDistance), preferably not too far (spawnMaxDistance)
 *   2. hidden: a wall between your eyes and the spot (no enemies popping up in plain sight)
 *   3. (spawnAheadChance of the time, if you're moving) ahead of you
 * then picks at random among what's left.
 */
function pickSpawn(game: GameState, world: World): SpawnPoint | null {
  const p = game.player;
  const far = (world.enemySpawns ?? []).filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > tuning.spawnMinDistance);
  if (far.length === 0) return null;
  let pool = prefer(far, (s) => Math.hypot(s.x - p.x, s.z - p.z) < tuning.spawnMaxDistance);
  pool = prefer(pool, (s) => !visibleFromPlayer(game, s, world));

  const speed = Math.hypot(p.vx, p.vz);
  if (speed > 3 && random(game) < tuning.spawnAheadChance) {
    // "Ahead" = the direction to the spot is close to the direction you're
    // running: the dot product of the two unit vectors is the cosine of the
    // angle between them (1 = straight ahead, 0 = to the side). > 0.5 = within 60°.
    pool = prefer(pool, (s) => {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      return ((s.x - p.x) / d) * (p.vx / speed) + ((s.z - p.z) / d) * (p.vz / speed) > 0.5;
    });
  }
  return pool[randomInt(game, pool.length)];
}

/** The items that pass the test... unless none do: then all of them (a preference, not a rule). */
function prefer<T>(items: T[], test: (item: T) => boolean): T[] {
  const kept = items.filter(test);
  return kept.length > 0 ? kept : items;
}

/** Can the player see this spot? A ray from their eyes to its chest height. */
function visibleFromPlayer(game: GameState, s: SpawnPoint, world: World): boolean {
  const p = game.player;
  const ex = p.x;
  const ey = p.y + currentEyeHeight(p);
  const ez = p.z;
  const dx = s.x - ex;
  const dy = s.y + 1.2 - ey;
  const dz = s.z - ez;
  const d = Math.hypot(dx, dy, dz);
  return raycastBoxes(ex, ey, ez, dx / d, dy / d, dz / d, d, world.boxes) === null;
}

/**
 * Debug: jump to wave n. Clears the enemies and their projectiles, heals the
 * player, and starts wave n after a short break, exactly as if wave n-1 had
 * just ended (so budget, health steps and runners are those of wave n).
 */
export function jumpToWave(game: GameState, n: number): void {
  game.entities = game.entities.filter((e) => !isEnemy(e));
  game.projectiles = [];
  game.player.health = maxHealth(game.player);
  game.wave = { number: n - 1, phase: 'break', breakTicks: secondsToTicks(2), budgetLeft: 0, spawnCooldownTicks: 0, smithsPending: 0 };
}

/**
 * Points, CoD style: something for every hit, more for the kill. All of it
 * × the style multiplier (`multiplier`, from styleMultiplier in style.ts),
 * rounded: the score stays a whole number.
 */
export function scoreHits(stats: Stats, events: SimEvent[], multiplier: number): void {
  for (const e of events) {
    if (e.type !== 'hit' || e.surface !== 'flesh') continue;
    let points = 10;
    if (e.killed) {
      stats.kills++;
      points += 100;
      if (e.headshot) points += 50; // headshot bonus
    }
    stats.score += Math.round(points * multiplier);
  }
}

export function ghoulSpeed(g: GhoulEntity): number {
  return g.runner ? tuning.ghoulRunnerSpeed : tuning.ghoulSpeed;
}
