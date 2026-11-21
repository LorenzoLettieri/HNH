// Waves, CoD-zombies style: wave 1, 2, 3... each bigger and tougher, with a
// short breather in between. Also keeps the score.
//
// What spawns is decided with a BUDGET of "weight" points ("director" style,
// like Left 4 Dead): every enemy type has a cost (its weight: how much
// trouble it is), every wave has a budget, and each spawn picks a RANDOM type
// among those the remaining budget can afford. Same budget, different mix in
// every game. A future tough enemy (a brute worth 5) just gets a higher cost.
import { secondsToTicks, tuning } from './config';
import { createBull, createEyebat, createGhoul, createHound, createSharpshooter, isEnemy, type Enemy, type GhoulEntity } from './entities';
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
}


export function createWaveState(): WaveState {
  return { number: 0, phase: 'break', breakTicks: secondsToTicks(tuning.waveFirstBreak), budgetLeft: 0, spawnCooldownTicks: 0 };
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
    fromWave: () => tuning.eyebatFromWave,
    // Flyers appear in the air above the spawn point, then fly to you.
    spawn: (game, id, x, y, z) =>
      createEyebat(id, x, y + tuning.eyebatSpawnHeight, z, healthForWave(tuning.eyebatHealth, game.wave.number)),
  },
  {
    type: 'hound',
    cost: () => tuning.houndCost,
    fromWave: () => tuning.houndFromWave,
    maxAlive: () => tuning.houndMaxAlive,
    spawn: (game, id, x, y, z) => createHound(id, x, y, z, healthForWave(tuning.houndHealth, game.wave.number)),
  },
  {
    type: 'bull',
    cost: () => tuning.bullCost,
    fromWave: () => tuning.bullFromWave,
    spawn: (game, id, x, y, z) => createBull(id, x, y, z, healthForWave(tuning.bullHealth, game.wave.number)),
  },
  {
    type: 'sharpshooter',
    cost: () => tuning.sharpshooterCost,
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
  };
  game.entities = game.entities.filter(
    (e) => !(isEnemy(e) && e.state === 'dead' && e.stateTicks > corpseTicks[e.type]),
  );
  for (const e of game.entities) if (e.type === 'ghoul' && e.state === 'dead') e.stateTicks++;

  if (!tuning.wavesEnabled) return;
  const w = game.wave;
  // Weight alive right now (with every enemy weighing 1: how many are alive).
  let alive = 0;
  const aliveByType: Record<Enemy['type'], number> = { ghoul: 0, eyebat: 0, hound: 0, bull: 0, sharpshooter: 0 };
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
      events.push({ type: 'waveStart', wave: w.number });
    }
    return;
  }

  // Active: wave cleared when everything has spawned AND died.
  if (w.budgetLeft === 0 && alive === 0) {
    events.push({ type: 'waveEnd', wave: w.number });
    w.phase = 'break';
    w.breakTicks = secondsToTicks(tuning.waveBreak);
    return;
  }

  if (w.spawnCooldownTicks > 0) {
    w.spawnCooldownTicks--;
    return;
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
  const type = allowed[randomInt(game, allowed.length)];
  game.entities.push(type.spawn(game, game.nextEntityId++, s.x, s.y, s.z));
  w.budgetLeft -= type.cost();
  w.spawnCooldownTicks = secondsToTicks(spawnInterval(w.number));
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
  game.player.health = tuning.playerMaxHealth;
  game.wave = { number: n - 1, phase: 'break', breakTicks: secondsToTicks(2), budgetLeft: 0, spawnCooldownTicks: 0 };
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
