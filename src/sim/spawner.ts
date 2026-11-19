// Spawner: keeps a number of ghouls alive, bringing in new ones at the
// level's spawn points (away from the player). Placeholder for the real
// wave system (CoD-zombies style), which will come with the gameplay loop.
import { secondsToTicks, tuning } from './config';
import { createGhoul } from './entities';
import type { GameState } from './game';
import type { World } from './world';

/** Spawn points closer than this to the player are skipped, meters. */
const MIN_SPAWN_DISTANCE = 15;

export function stepSpawner(game: GameState, world: World): void {
  // Dead ghouls lie on the ground for a while, then are removed from the list.
  const corpseTicks = secondsToTicks(tuning.ghoulCorpseTime);
  game.entities = game.entities.filter(
    (e) => !(e.type === 'ghoul' && e.state === 'dead' && e.stateTicks > corpseTicks),
  );
  for (const e of game.entities) if (e.type === 'ghoul' && e.state === 'dead') e.stateTicks++;

  if (game.spawnCooldownTicks > 0) {
    game.spawnCooldownTicks--;
    return;
  }
  const alive = game.entities.filter((e) => e.type === 'ghoul' && e.state !== 'dead').length;
  const points = (world.enemySpawns ?? []).filter(
    (s) => Math.hypot(s.x - game.player.x, s.z - game.player.z) > MIN_SPAWN_DISTANCE,
  );
  if (alive >= tuning.ghoulMaxAlive || points.length === 0) return;

  // Deterministic "random" pick: based on the tick, so a replay or a server
  // would make the same choice.
  const s = points[game.tick % points.length];
  game.entities.push(createGhoul(game.nextEntityId++, s.x, s.y, s.z));
  game.spawnCooldownTicks = secondsToTicks(tuning.ghoulSpawnInterval);
}
