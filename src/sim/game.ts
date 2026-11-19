// The whole game state in one object, and the one function that advances it
// by one tick. Main loop (and one day the server) only talk to this.
import type { InputCommand } from './command';
import { createEntities, stepEntities, type Entity } from './entities';
import type { SimEvent } from './events';
import { createPlayer, stepPlayer, type PlayerState } from './player';
import { stepWeapon } from './weapon';
import type { World } from './world';

export interface GameState {
  tick: number;
  player: PlayerState;
  entities: Entity[];
}

export function createGame(world: World): GameState {
  return {
    tick: 0,
    player: createPlayer(world.spawn.x, world.spawn.y, world.spawn.z),
    entities: createEntities(world),
  };
}

/**
 * One tick of the whole game, always in the same order:
 * 1. the player moves; 2. the player's weapon fires (and hits);
 * 3. everything else updates. Things that happened go into `events`.
 */
export function stepGame(
  game: GameState,
  cmd: InputCommand,
  world: World,
  dt: number,
  events: SimEvent[],
): void {
  stepPlayer(game.player, cmd, world, dt);
  stepWeapon(game.player, cmd, world, game.entities, events);
  stepEntities(game.entities);
  game.tick++;
}
