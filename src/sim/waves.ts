// Waves, CoD-zombies style: wave 1, 2, 3... each with more ghouls, tougher
// and faster, and a short breather in between. Also keeps the score.
import { secondsToTicks, tuning } from './config';
import { createGhoul, isEnemy, type GhoulEntity } from './entities';
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
  /** Active: ghouls of this wave not spawned yet. */
  toSpawn: number;
  spawnCooldownTicks: number;
}

export interface Stats {
  kills: number;
  score: number;
}

export function createWaveState(): WaveState {
  return { number: 0, phase: 'break', breakTicks: secondsToTicks(tuning.waveFirstBreak), toSpawn: 0, spawnCooldownTicks: 0 };
}

// --- The difficulty curve: everything that changes from wave to wave --------
/** Total ghouls in wave n: 6, 8, 10, 12, 15, 17, 20... growing faster and faster. */
export function waveSize(n: number): number {
  return Math.round(tuning.waveBaseCount + 2 * (n - 1) + 0.15 * (n - 1) ** 2);
}
/** How many can be alive at the same time. */
function maxAlive(n: number): number {
  return Math.min(tuning.waveMaxAliveCap, 6 + 2 * n);
}
/** Seconds between two spawns: faster in later waves. */
function spawnInterval(n: number): number {
  return Math.max(0.5, 2 - 0.15 * (n - 1));
}
/** Share of "runners" (fast ghouls): none in the first 3 waves, then +10% per wave, max 60%. */
function runnerChance(n: number): number {
  return Math.min(0.6, Math.max(0, (n - 3) * 0.1));
}

/**
 * Ghoul health grows in STEPS, slowly: 50 (waves 1-9), 100 (10-19), 150
 * (20-29)... Designed in shots to kill (revolver 50, headshot ×3):
 * waves 1-9 any hit kills; 10-29 the body needs more shots but the head is
 * still one; from 30 even the head needs two. The difficulty of early waves
 * comes from numbers and speed, not from bullet sponges.
 */
export function ghoulHealthForWave(n: number): number {
  return tuning.ghoulHealth * (1 + Math.floor(n / tuning.waveHealthStep));
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
  const alive = game.entities.filter((e) => isEnemy(e) && e.state !== 'dead').length;

  if (w.phase === 'break') {
    w.breakTicks--;
    if (w.breakTicks <= 0) {
      w.number++;
      w.phase = 'active';
      w.toSpawn = waveSize(w.number);
      w.spawnCooldownTicks = 0;
      events.push({ type: 'waveStart', wave: w.number });
    }
    return;
  }

  // Active: wave cleared when everything has spawned AND died.
  if (w.toSpawn === 0 && alive === 0) {
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
  if (w.toSpawn === 0 || alive >= maxAlive(w.number) || points.length === 0) return;

  // Deterministic "random" choices, based on the tick and the id: a replay or
  // a server would make the same ones.
  const id = game.nextEntityId++;
  const s = points[(game.tick + id) % points.length];
  const runner = ((id * 7919) % 100) / 100 < runnerChance(w.number);
  const health = ghoulHealthForWave(w.number);
  game.entities.push(createGhoul(id, s.x, s.y, s.z, health, runner));
  w.toSpawn--;
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
