// The whole game state in one object, and the one function that advances it
// by one tick. Main loop (and one day the server) only talk to this.
import type { InputCommand } from './command';
import { createBull, createEntities, createEyebat, createHound, isEnemy, stepTarget, type Entity } from './entities';
import { stepEyebat } from './eyebat';
import { stepProjectiles, type Projectile } from './projectiles';
import { stepGhoul } from './ghoul';
import { stepHound } from './hound';
import { stepBull } from './bull';
import { createWaveState, scoreHits, stepWaves, wavePressure, type Stats, type WaveState } from './waves';
import { BIG_BODY, getFlowField, getNavGraph, nearestNode } from './nav';
import type { SimEvent } from './events';
import { createPlayer, respawn, stepPlayer, type PlayerState } from './player';
import { stepWeapon } from './weapon';
import { stepKick } from './kick';
import { dropFromKills, stepPickups, type Pickup } from './pickups';
import { createStyle, isHighNoon, stepStyle, type StyleState } from './style';
import type { World } from './world';
import { secondsToTicks, tuning } from './config';

export interface GameState {
  tick: number;
  player: PlayerState;
  entities: Entity[];
  /** Ids are never reused: the renderer recognizes entities by id. */
  nextEntityId: number;
  wave: WaveState;
  stats: Stats;
  /** The style meter (chain of stylish actions), see style.ts. */
  style: StyleState;
  /** Navigation goal: the graph node the player stands on (the ghouls go there). */
  navGoal: number;
  /** The same, on the graph for big bodies (bulls): another graph, other node numbers. */
  navGoalBig: number;
  /** Enemy projectiles in flight (fireballs...). */
  projectiles: Projectile[];
  /** Things on the ground to collect (enemy drops), see pickups.ts. */
  pickups: Pickup[];
  /** State of the seeded random generator (see random.ts): what the waves spawn. */
  rng: number;
}

/**
 * `seed` decides the "random" choices of the whole game (which enemies, where).
 * Same seed = same game, if the player does the same things.
 */
export function createGame(world: World, seed = 1): GameState {
  const entities = createEntities(world);
  return {
    tick: 0,
    player: createPlayer(world.spawn.x, world.spawn.y, world.spawn.z),
    entities,
    nextEntityId: entities.length + 1,
    wave: createWaveState(),
    stats: { kills: 0, score: 0 },
    style: createStyle(),
    navGoal: -1,
    navGoalBig: -1,
    projectiles: [],
    pickups: [],
    rng: seed,
  };
}

/**
 * One tick of the whole game, always in the same order:
 * 1. the player moves; 2. the player's weapon fires (and hits), the boot kicks;
 * 3. targets and enemies update; 4. enemy projectiles fly (and hit);
 * 5. the wave system spawns enemies; 6. pickups age and get collected;
 * 7. the style meter reads everything that happened in the tick.
 * Things that happened go into `events`.
 */
export function stepGame(
  game: GameState,
  cmd: InputCommand,
  world: World,
  dt: number,
  events: SimEvent[],
): void {
  // Where this tick's events start: `events` may already hold earlier ticks of the same frame.
  const tickEvents = events.length;
  // Remember where every entity was, for the renderer's interpolation.
  for (const e of game.entities) {
    e.px = e.x;
    e.py = e.y;
    e.pz = e.z;
  }
  stepPlayer(game.player, cmd, world, dt);
  const firstNewEvent = events.length;
  // During HIGH NOON the guns are bottomless (the weapon doesn't know why: it only gets the flag).
  stepWeapon(game.player, cmd, world, game.entities, events, isHighNoon(game.style));
  stepKick(game.player, cmd, world, game.entities, events);
  const playerHits = events.slice(firstNewEvent);
  scoreHits(game.stats, playerHits);
  dropFromKills(game, world, playerHits);

  // Navigation: where's the player on the graph? (Only while standing:
  // in mid-jump we keep the last known node.) Checked 4 times a second;
  // the flow field is recomputed only when that node changes.
  const graph = getNavGraph(world);
  const bigGraph = getNavGraph(world, BIG_BODY);
  if (game.tick % 15 === 0 && game.player.onGround) {
    const node = nearestNode(graph, game.player.x, game.player.y, game.player.z);
    if (node >= 0) game.navGoal = node;
    const big = nearestNode(bigGraph, game.player.x, game.player.y, game.player.z);
    if (big >= 0) game.navGoalBig = big;
  }
  const flow = getFlowField(graph, game.navGoal);
  const pressure = wavePressure(game.wave.number);

  for (const e of game.entities) {
    if (e.type === 'target') stepTarget(e);
    else if (e.type === 'eyebat') stepEyebat(e, game, world, dt, events);
    else if (e.type === 'hound') stepHound(e, game.player, game.entities, world, graph, flow, dt, events);
    else if (e.type === 'bull') {
      // Asked here, not every tick: with no bulls around it's never computed (cached per goal).
      stepBull(e, game.player, game.entities, world, bigGraph, getFlowField(bigGraph, game.navGoalBig), dt, events);
    }
    else if (e.state !== 'dead') stepGhoul(e, game.player, game.entities, world, graph, flow, dt, events, pressure);
  }
  game.projectiles = stepProjectiles(game.projectiles, game.player, world, dt, events);
  stepWaves(game, world, events);
  stepPickups(game, events);
  // Last: it needs the whole tick (your hits come first, the enemies' hits on you later).
  stepStyle(game.style, events, tickEvents);

  // Dead: game over, CoD style. Report how far you got, then start over from
  // wave 1: back to the spawn, the horde is cleared, stats reset.
  if (game.player.health <= 0) {
    events.push({ type: 'playerDied', wave: game.wave.number, kills: game.stats.kills, score: game.stats.score });
    respawn(game.player, world);
    game.entities = game.entities.filter((e) => !isEnemy(e));
    game.projectiles = [];
    game.pickups = [];
    game.wave = createWaveState();
    game.stats = { kills: 0, score: 0 };
    game.style = createStyle();
  }
  game.tick++;
}

/**
 * Debug: spawns an eye-bat in front of the player, up in the air.
 * (Until it's part of the waves, this is how you get one to shoot at.)
 */
export function spawnEyebatInFront(game: GameState): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 8;
  const z = p.z - Math.cos(p.yaw) * 8;
  game.entities.push(createEyebat(game.nextEntityId++, x, p.y + 4, z));
}

/** Debug: spawns a hellhound 8 m in front of the player (G key). */
export function spawnHoundInFront(game: GameState): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 8;
  const z = p.z - Math.cos(p.yaw) * 8;
  game.entities.push(createHound(game.nextEntityId++, x, p.y + 0.5, z));
}

/** Debug: spawns a bull 14 m in front of the player (V key): far enough to see it aim. */
export function spawnBullInFront(game: GameState): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 14;
  const z = p.z - Math.cos(p.yaw) * 14;
  game.entities.push(createBull(game.nextEntityId++, x, p.y + 0.5, z));
}

/** Debug: drops one pickup of each kind in a row 4 m in front of the player (J key), coin included. */
export function dropPickupsInFront(game: GameState): void {
  const p = game.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const kinds = ['coin', 'bullets', 'shells', 'medkit'] as const; // the coin on the left: the gun doesn't hide it
  kinds.forEach((kind, i) => {
    const side = i - 1.5; // -1.5 .. +1.5: from left to right
    game.pickups.push({
      id: game.nextEntityId++,
      kind,
      x: p.x + fx * 4 - fz * side * 1.2,
      y: p.y,
      z: p.z + fz * 4 + fx * side * 1.2,
      ticksLeft: secondsToTicks(kind === 'coin' ? tuning.coinLifetime : tuning.dropLifetime),
      value: kind === 'coin' ? tuning.coinValue : 0,
    });
  });
}
