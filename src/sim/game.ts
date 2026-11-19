// The whole game state in one object, and the one function that advances it
// by one tick. Main loop (and one day the server) only talk to this.
import type { InputCommand } from './command';
import { createEntities, stepTarget, type Entity } from './entities';
import { stepGhoul } from './ghoul';
import { stepSpawner } from './spawner';
import { getFlowField, getNavGraph, nearestNode } from './nav';
import type { SimEvent } from './events';
import { createPlayer, respawn, stepPlayer, type PlayerState } from './player';
import { secondsToTicks } from './config';
import { stepWeapon } from './weapon';
import type { World } from './world';

export interface GameState {
  tick: number;
  player: PlayerState;
  entities: Entity[];
  /** Ids are never reused: the renderer recognizes entities by id. */
  nextEntityId: number;
  spawnCooldownTicks: number;
  /** Navigation goal: the graph node the player stands on (the ghouls go there). */
  navGoal: number;
}

export function createGame(world: World): GameState {
  const entities = createEntities(world);
  return {
    tick: 0,
    player: createPlayer(world.spawn.x, world.spawn.y, world.spawn.z),
    entities,
    nextEntityId: entities.length + 1,
    spawnCooldownTicks: 0,
    navGoal: -1,
  };
}

/**
 * One tick of the whole game, always in the same order:
 * 1. the player moves; 2. the player's weapon fires (and hits);
 * 3. targets and enemies update; 4. the spawner adds/removes enemies.
 * Things that happened go into `events`.
 */
export function stepGame(
  game: GameState,
  cmd: InputCommand,
  world: World,
  dt: number,
  events: SimEvent[],
): void {
  // Remember where every entity was, for the renderer's interpolation.
  for (const e of game.entities) {
    e.px = e.x;
    e.py = e.y;
    e.pz = e.z;
  }
  stepPlayer(game.player, cmd, world, dt);
  stepWeapon(game.player, cmd, world, game.entities, events);

  // Navigation: where's the player on the graph? (Only while standing:
  // in mid-jump we keep the last known node.) Checked 4 times a second;
  // the flow field is recomputed only when that node changes.
  const graph = getNavGraph(world);
  if (game.tick % 15 === 0 && game.player.onGround) {
    const node = nearestNode(graph, game.player.x, game.player.y, game.player.z);
    if (node >= 0) game.navGoal = node;
  }
  const flow = getFlowField(graph, game.navGoal);

  for (const e of game.entities) {
    if (e.type === 'target') stepTarget(e);
    else if (e.state !== 'dead') stepGhoul(e, game.player, game.entities, world, graph, flow, dt, events);
  }
  stepSpawner(game, world);

  // Dead: back to the start, the horde is cleared, a short breather.
  if (game.player.health <= 0) {
    events.push({ type: 'playerDied' });
    respawn(game.player, world);
    game.entities = game.entities.filter((e) => e.type !== 'ghoul');
    game.spawnCooldownTicks = secondsToTicks(3);
  }
  game.tick++;
}
