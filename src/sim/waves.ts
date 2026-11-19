// Waves, CoD-zombies style: wave 1, 2, 3... each bigger and tougher, with a
// short breather in between. Also keeps the score.
//
// What spawns is decided with a BUDGET of "weight" points ("director" style,
// like Left 4 Dead): every enemy type has a cost (its weight: how much
// trouble it is), every wave has a budget, and each spawn picks a RANDOM type
// among those the remaining budget can afford. Same budget, different mix in
// every game. A future tough enemy (a brute worth 5) just gets a higher cost.
import { secondsToTicks, tuning } from './config';
import { createEyebat, createGhoul, isEnemy, type Enemy, type GhoulEntity } from './entities';
import { random, randomInt } from './random';
import type { SimEvent } from './events';
import type { GameState } from './game';
import type { World } from './world';

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

export interface Stats {
  kills: number;
  score: number;
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
/** How much weight can be alive at the same time. */
function maxAlive(n: number): number {
  return Math.min(tuning.waveMaxAliveCap, 6 + 2 * n);
}
/** Seconds between two spawns: faster in later waves. */
function spawnInterval(n: number): number {
  return Math.max(0.5, 2 - 0.15 * (n - 1));
}
/** Share of "runners" among the ghouls: none in the first 3 waves, then +10% per wave, max 60%. */
function runnerChance(n: number): number {
  return Math.min(0.6, Math.max(0, (n - 3) * 0.1));
}

/**
 * Health grows in STEPS, slowly: ×1 (waves 1-9), ×2 (10-19), ×3 (20-29)...
 * For a ghoul: 50, 100, 150. Designed in shots to kill (revolver 50,
 * headshot ×3): waves 1-9 any hit kills; 10-29 the body needs more shots but
 * the head is still one; from 30 even the head needs two. The difficulty of
 * early waves comes from numbers, mix and speed, not from bullet sponges.
 */
export function healthForWave(baseHealth: number, n: number): number {
  return baseHealth * (1 + Math.floor(n / tuning.waveHealthStep));
}

/**
 * The roster: every enemy type the waves can spawn, with its cost.
 * Adding an enemy to the waves = adding a line here.
 */
interface EnemyType {
  /** Weight: how many budget points it takes. */
  cost: () => number;
  spawn: (game: GameState, id: number, x: number, y: number, z: number) => Enemy;
}
const ROSTER: EnemyType[] = [
  {
    cost: () => tuning.ghoulCost,
    spawn: (game, id, x, y, z) => {
      const n = game.wave.number;
      const runner = random(game) < runnerChance(n);
      return createGhoul(id, x, y, z, healthForWave(tuning.ghoulHealth, n), runner);
    },
  },
  {
    cost: () => tuning.eyebatCost,
    // Flyers appear in the air above the spawn point, then fly to you.
    spawn: (game, id, x, y, z) =>
      createEyebat(id, x, y + tuning.eyebatSpawnHeight, z, healthForWave(tuning.eyebatHealth, game.wave.number)),
  },
];

/** How much an enemy weighs (for the "alive at the same time" limit). */
function costOf(e: Enemy): number {
  return e.type === 'ghoul' ? tuning.ghoulCost : tuning.eyebatCost;
}

/** Spawn points closer than this to the player are skipped, meters. */
const MIN_SPAWN_DISTANCE = 15;

export function stepWaves(game: GameState, world: World, events: SimEvent[]): void {
  // Dead enemies lie on the ground for a while, then are removed from the list.
  // (The eye-bat counts its own stateTicks in stepEyebat: it keeps falling while dead.)
  const corpseTicks = { ghoul: secondsToTicks(tuning.ghoulCorpseTime), eyebat: secondsToTicks(tuning.eyebatCorpseTime) };
  game.entities = game.entities.filter(
    (e) => !(isEnemy(e) && e.state === 'dead' && e.stateTicks > corpseTicks[e.type]),
  );
  for (const e of game.entities) if (e.type === 'ghoul' && e.state === 'dead') e.stateTicks++;

  if (!tuning.wavesEnabled) return;
  const w = game.wave;
  // Weight alive right now (with every enemy weighing 1: how many are alive).
  let alive = 0;
  for (const e of game.entities) if (isEnemy(e) && e.state !== 'dead') alive += costOf(e);

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
  const points = (world.enemySpawns ?? []).filter(
    (s) => Math.hypot(s.x - game.player.x, s.z - game.player.z) > MIN_SPAWN_DISTANCE,
  );
  if (w.budgetLeft === 0 || alive >= maxAlive(w.number) || points.length === 0) return;

  // Pick a random enemy type among those the remaining budget can afford.
  // (Random from the game's seeded generator: deterministic, see random.ts.)
  const affordable = ROSTER.filter((t) => t.cost() <= w.budgetLeft);
  if (affordable.length === 0) {
    w.budgetLeft = 0; // leftover too small for anything: the wave is fully spawned
    return;
  }
  const type = affordable[randomInt(game, affordable.length)];
  const s = points[randomInt(game, points.length)];
  game.entities.push(type.spawn(game, game.nextEntityId++, s.x, s.y, s.z));
  w.budgetLeft -= type.cost();
  w.spawnCooldownTicks = secondsToTicks(spawnInterval(w.number));
}

/** Points, CoD style: something for every hit, more for the kill. */
export function scoreHits(stats: Stats, events: SimEvent[]): void {
  for (const e of events) {
    if (e.type !== 'hit' || e.surface !== 'flesh') continue;
    stats.score += 10;
    if (e.killed) {
      stats.kills++;
      stats.score += 100;
      if (e.headshot) stats.score += 50; // headshot bonus
    }
  }
}

export function ghoulSpeed(g: GhoulEntity): number {
  return g.runner ? tuning.ghoulRunnerSpeed : tuning.ghoulSpeed;
}
