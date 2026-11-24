// The whole game state in one object, and the one function that advances it
// by one tick. Main loop (and one day the server) only talk to this.
import { knockBack } from './kick';
import { hasDrink, healPerKill, maxHealth, stepBar } from './drinks';
import { hasCurse } from './wager';
import type { InputCommand } from './command';
import { createBull, createEntities, createEyebat, createHound, createSharpshooter, createSmith, isEnemy, stepTarget, type Entity } from './entities';
import { stepEyebat } from './eyebat';
import { batProjectiles, stepProjectiles, type Projectile } from './projectiles';
import { stepDynamite, throwDynamite, type Dynamite } from './dynamite';
import { spawnEmberPatch, spawnHolyFire, stepHolyFire, type HolyFire } from './holyFire';
import { stepGhoul } from './ghoul';
import { stepHound } from './hound';
import { stepBull } from './bull';
import { stepSmith } from './smith';
import { stepSharpshooter } from './sharpshooter';
import { createWaveState, scoreHits, stepWaves, wavePressure, type WaveState } from './waves';
import { countStats, createStats, type Stats } from './stats';
import { createMapEventState, stepMapEvents, type MapEventState } from './mapEvents';
import { BIG_BODY, getFlowField, getNavGraph, nearestNode, NO_CLIMB, NO_VENT } from './nav';
import type { SimEvent } from './events';
import { cellAt, getAirGrid } from './airNav';
import { createPlayer, currentHeight, respawn, stepPlayer, type PlayerState } from './player';
import { refundLeadFlight, spurRound, stepWeapon } from './weapon';
import { stepStatus, stepStunned } from './status';
import { stepKick } from './kick';
import { blockPlayerWithBodies } from './bodyBlock';
import { stepShop } from './shop';
import { stepForge } from './forge';
import { createPickup, dropFromKills, stepPickups, type Pickup } from './pickups';
import { createStyle, isHighNoon, stepStyle, styleMultiplier, type StyleState } from './style';
import type { World } from './world';
import { tuning } from './config';
import { randomInt } from './random';

export interface GameState {
  tick: number;
  player: PlayerState;
  entities: Entity[];
  /** Ids are never reused: the renderer recognizes entities by id. */
  nextEntityId: number;
  wave: WaveState;
  /** Map events: when the next one comes, the one being played (mapEvents.ts). */
  mapEvent: MapEventState;
  stats: Stats;
  /** The style meter (chain of stylish actions), see style.ts. */
  style: StyleState;
  /** Navigation goal: the graph node the player stands on (the ghouls go there). */
  navGoal: number;
  /** The same, on the graph for big bodies (bulls): another graph, other node numbers. */
  navGoalBig: number;
  /** Goal of the fliers' air flow field: the grid cell of the player's chest (airNav.ts). */
  airGoal: number;
  /** Enemy projectiles in flight (fireballs...). */
  projectiles: Projectile[];
  /** The player's dynamite sticks in flight or rolling on the floor (dynamite.ts). */
  dynamite: Dynamite[];
  /** Pools of holy fire on the floor (the Forge's dynamite, holyFire.ts). */
  holyFires: HolyFire[];
  /** Things on the ground to collect (enemy drops), see pickups.ts. */
  pickups: Pickup[];
  /** State of the seeded random generator (see random.ts): what the waves spawn. */
  rng: number;
  /**
   * The wager's "faster enemies" curse (wager.ts): enemy time owed, in ticks.
   * Every tick adds (scale − 1); each whole tick owed is an extra AI step.
   */
  enemyTimeDebt: number;
}

/**
 * `seed` decides the "random" choices of the whole game (which enemies, where).
 * Same seed = same game, if the player does the same things.
 */
export function createGame(world: World, seed = 1): GameState {
  const entities = createEntities(world);
  const game: GameState = {
    tick: 0,
    player: createPlayer(world.spawn.x, world.spawn.y, world.spawn.z),
    entities,
    nextEntityId: entities.length + 1,
    wave: createWaveState(),
    mapEvent: createMapEventState({ rng: seed }), // replaced below, from the game's own generator
    stats: createStats(),
    style: createStyle(),
    navGoal: -1,
    navGoalBig: -1,
    airGoal: -1,
    projectiles: [],
    dynamite: [],
    holyFires: [],
    pickups: [],
    rng: seed,
    enemyTimeDebt: 0,
  };
  rollCardSeed(game);
  game.mapEvent = createMapEventState(game);
  return game;
}

/**
 * A new seed for the armory's cards (upgrades.ts): once per game, taken from
 * the game's generator, so the same game seed gives the same cards.
 */
function rollCardSeed(game: GameState): void {
  game.player.cardSeed = randomInt(game, 0x7fffffff);
}

/**
 * One tick of the whole game, always in the same order:
 * 1. the player moves; 2. the player's weapon fires (and hits), the boot kicks, the dynamite flies;
 * 3. targets and enemies update, their bodies block the player; 4. enemy projectiles fly (and hit);
 * 5. the wave system spawns enemies, the map events listen to it; 6. pickups age and get collected;
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
  const beforePlayer = events.length;
  stepPlayer(game.player, cmd, world, dt, events);
  stepPactMoves(game, events, beforePlayer, dt);
  // Shopping first: a weapon bought this tick is in your hands for the rest of it.
  stepShop(game.player, cmd, world, events);
  stepForge(game.player, cmd, world, events);
  stepBar(game.player, cmd, world, events);
  const firstNewEvent = events.length;
  // During HIGH NOON the guns are bottomless (the weapon doesn't know why: it only gets the flag).
  stepWeapon(game.player, cmd, world, game.entities, events, isHighNoon(game.style), game);
  const beforeKick = events.length;
  stepKick(game.player, cmd, world, game.entities, events);
  // Drink "Bobby": the boot (or shovel) that lands bats the projectiles back.
  if (hasDrink(game.player, 'bobby') && events.slice(beforeKick).some((e) => e.type === 'kickLand')) {
    batProjectiles(game.projectiles, game.player, events);
  }
  // Fire and wall slams from the shotgun's cards: their kills are yours too.
  stepStatus(game.player, game.entities, events);
  // The launcher fired: a new stick leaves the barrel (weapon.ts only reports the shot).
  for (let i = firstNewEvent; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'fire' && e.weapon === 'dynamite') game.dynamite.push(throwDynamite(game.player, world, game.nextEntityId++));
  }
  // Your dynamite: its explosions are your hits too (score, drops, style).
  const beforeSticks = events.length;
  game.dynamite = stepDynamite(game.dynamite, game.player, world, game.entities, dt, events, () => game.nextEntityId++);
  // A holy-water stick blew up: the water splashes down and burns (same idea
  // as the sticks: the explosion only reports, the game creates the pool).
  for (let i = beforeSticks; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'explosion' && e.kind === 'holyDynamite') {
      spawnHolyFire(game.holyFires, game.nextEntityId++, e.x, e.y, e.z, world, events);
    }
  }
  // The pools burn the enemies in them; their kills are yours too.
  game.holyFires = stepHolyFire(game.holyFires, game.entities);
  const playerHits = events.slice(firstNewEvent);
  refundLeadFlight(game.player, playerHits);
  // The style multiplies what you earn. Read BEFORE stepStyle (end of the
  // tick): a kill counts with the rank you had when you pulled the trigger,
  // not with the rank that same kill is about to give you.
  scoreHits(game.stats, playerHits, styleMultiplier(game.style));
  dropFromKills(game, playerHits);
  // Bloody Mary (drinks.ts): every kill of yours gives some health back.
  const kills = playerHits.filter((e) => e.type === 'hit' && e.killed && e.target !== 'target').length;
  const heal = healPerKill(game.player);
  if (heal > 0 && game.player.health > 0) {
    game.player.health = Math.min(maxHealth(game.player), game.player.health + kills * heal);
  }
  stepContract(game.player, kills, events);

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
  // Fliers: the cell of the 3D air grid your chest is in, also in mid-air (they fly).
  const air = getAirGrid(world, tuning.eyebatRadius);
  if (game.tick % 15 === 0) {
    const p = game.player;
    game.airGoal = cellAt(air, p.x, p.y + currentHeight(p) * 0.6, p.z);
  }
  const pressure = wavePressure(game.wave.number);

  // One step of every enemy's AI. Usually once per tick; with the wager's
  // "faster enemies" curse, sometimes twice (see below).
  const stepEnemies = (targets: boolean) => {
    for (const e of game.entities) {
      if (e.type === 'target') {
        if (targets) stepTarget(e);
      }
      // Drink "Zoccolo duro": a stunned enemy doesn't think, it only falls and slides (status.ts).
      else if (stepStunned(e, world, dt)) continue;
      else if (e.type === 'eyebat') stepEyebat(e, game, world, air, dt, events);
      else if (e.type === 'sharpshooter') stepSharpshooter(e, game, world, graph, dt, events);
      // Hounds: the ghouls' graph, but their own flow field with no climbing (they ride the vents instead).
      else if (e.type === 'hound') stepHound(e, game.player, game.entities, world, graph, getFlowField(graph, game.navGoal, NO_CLIMB), dt, events);
      else if (e.type === 'bull') {
        // Asked here, not every tick: with no bulls around it's never computed (cached per goal).
        stepBull(e, game.player, game.entities, world, bigGraph, getFlowField(bigGraph, game.navGoalBig), dt, events);
      } else if (e.type === 'smith') {
        // The Smith has the bull's body: it walks on the bulls' graph, but it doesn't ride the
        // vents (too heavy to fly: it waits below and pulls you down with the hook).
        stepSmith(e, game.player, game.entities, world, bigGraph, getFlowField(bigGraph, game.navGoalBig, NO_VENT), dt, events);
      }
      else if (e.state !== 'dead') stepGhoul(e, game.player, game.entities, world, graph, flow, dt, events, pressure);
    }
  };
  stepEnemies(true);
  // The wager's "faster enemies" curse: their TIME runs faster, not their
  // numbers. Changing every speed in config.ts would miss half of it (the
  // windups, the cooldowns, the charge timers...); an extra step of the whole
  // AI makes everything faster together: walking, jumping, aiming, biting.
  // ×1.3 = an extra step every ~3 ticks: the debt grows by 0.3 a tick, and
  // each whole tick owed is paid with one more step (like a fixed-step game
  // loop paying the frame time in ticks, main.ts). Deterministic: no clock.
  if (hasCurse(game.player, 'fastEnemies')) {
    game.enemyTimeDebt += Math.max(0, tuning.wagerFastEnemiesScale - 1);
    while (game.enemyTimeDebt >= 1) {
      game.enemyTimeDebt -= 1;
      stepEnemies(false);
    }
  } else {
    game.enemyTimeDebt = 0;
  }
  // Enemies are solid: push the player out of their bodies (after they moved, see bodyBlock.ts).
  blockPlayerWithBodies(game.player, game.entities, world, dt);
  game.projectiles = stepProjectiles(game.projectiles, game.player, world, dt, events, game.entities);
  // Drink "Ultimo respiro": a hit this tick should have killed you; you're at 1, and the enemies around are thrown away.
  if (game.player.lastBreathNow) {
    game.player.lastBreathNow = false;
    lastBreath(game, events);
  }
  stepWaves(game, world, events, cmd.skipBreak);
  // Right after the waves: it listens to their waveStart/waveEnd, and to
  // this tick's shots and blasts for the objectives (mapEvents.ts).
  stepMapEvents(game, world, cmd, events, tickEvents);
  // Drink "Ultimo respiro": once per wave, it's back at every new wave.
  if (events.slice(tickEvents).some((e) => e.type === 'waveStart')) game.player.lastBreathUsed = false;
  stepPickups(game, world, dt, events);
  // Last: it needs the whole tick (your hits come first, the enemies' hits on you later).
  stepStyle(game.style, game.player, events, tickEvents);
  stepTequila(game.player, events, tickEvents);
  countStats(game.stats, events.slice(tickEvents), game.style);

  // Dead: game over, CoD style. Report how far you got, then start over from
  // wave 1: back to the spawn, the horde is cleared, stats reset.
  if (game.player.health <= 0) {
    events.push({ type: 'playerDied', wave: game.wave.number, stats: game.stats });
    respawn(game.player, world);
    game.entities = game.entities.filter((e) => !isEnemy(e));
    game.projectiles = [];
    game.dynamite = [];
    game.holyFires = [];
    game.pickups = [];
    game.wave = createWaveState();
    game.stats = createStats(); // a new object: the event keeps the old one
    game.style = createStyle();
    rollCardSeed(game); // new game, new cards on the counter
    game.mapEvent = createMapEventState(game);
  }
  game.tick++;
}

/**
 * The movement pacts that touch the world (drinks.ts): "Zoccolo del
 * diavolo" (a hard landing throws the enemies around you away) and "Scia di
 * brace" (sliding leaves patches of fire). Here and not in player.ts: the
 * player's step doesn't know the enemies or the fires, the game does (the
 * same split as the dynamite: player.ts only reports the landing).
 */
/**
 * Drink "Contratto del becchino": count the kills since you last took damage
 * (hurtPlayer resets the count); every contractKills of them, the contract
 * pays: + contractHealth max health, and that much health with it.
 */
function stepContract(p: PlayerState, kills: number, events: SimEvent[]): void {
  if (!hasDrink(p, 'undertakerContract') || kills === 0 || p.health <= 0) return;
  for (let i = 0; i < kills; i++) {
    if (++p.cleanKills < tuning.contractKills) continue;
    p.cleanKills = 0;
    p.contractHealth += tuning.contractHealth;
    p.health = Math.min(maxHealth(p), p.health + tuning.contractHealth);
    events.push({ type: 'contractPaid', maxHealth: maxHealth(p) });
  }
}

/**
 * Drink "Tequila del torero": the risky dodges heal. It listens to the
 * style's own awards (the same "OLÉ!" and "PER UN PELO" you see on screen),
 * so a dodge counts for the drink exactly when it counts for the style.
 */
function stepTequila(p: PlayerState, events: SimEvent[], from: number): void {
  if (!hasDrink(p, 'toreroTequila') || p.health <= 0) return;
  const end = events.length;
  for (let i = from; i < end; i++) {
    const e = events[i];
    if (e.type !== 'styleAward' || (e.award !== 'torero' && e.award !== 'nearMiss')) continue;
    p.health = Math.min(maxHealth(p), p.health + tuning.tequilaHeal);
    events.push({ type: 'tequilaHeal', amount: tuning.tequilaHeal });
  }
}

function lastBreath(game: GameState, events: SimEvent[]): void {
  const p = game.player;
  for (const en of game.entities) {
    if (!isEnemy(en) || en.state === 'dead') continue;
    const dx = en.x - p.x;
    const dz = en.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > tuning.lastBreathRadius || Math.abs(en.y - p.y) > 3) continue;
    knockBack(en, d > 0.01 ? dx / d : 1, d > 0.01 ? dz / d : 0, tuning.lastBreathPush, 5);
  }
  events.push({ type: 'lastBreath', x: p.x, y: p.y, z: p.z });
}

function stepPactMoves(game: GameState, events: SimEvent[], from: number, dt: number): void {
  const p = game.player;
  const end = events.length;
  for (let i = from; i < end; i++) {
    const e = events[i];
    if (e.type !== 'land' || e.drop < tuning.hoofMinDrop || !hasDrink(p, 'devilsHoof')) continue;
    let hits = 0;
    for (const en of game.entities) {
      if (!isEnemy(en) || en.state === 'dead') continue;
      const dx = en.x - p.x;
      const dz = en.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > tuning.hoofRadius || Math.abs(en.y - p.y) > 2) continue;
      // Thrown straight away from where you landed (anywhere, if right under you).
      knockBack(en, d > 0.01 ? dx / d : 1, d > 0.01 ? dz / d : 0, tuning.hoofPush, tuning.hoofLift);
      hits++;
    }
    events.push({ type: 'hoofSlam', x: p.x, y: p.y, z: p.z, radius: tuning.hoofRadius, hits });
  }
  // Drink "Sperone d'argento": every wall jump pushes a round from the pocket into the gun in your hands.
  if (hasDrink(p, 'silverSpur')) {
    for (let i = from; i < end; i++) {
      if (events[i].type === 'wallJump' && spurRound(p)) events.push({ type: 'spurRound', weapon: p.weapon });
    }
  }
  // A patch of fire every emberTrailSpacing meters of slide (speed × time = meters this tick).
  if (p.sliding && p.onGround && hasDrink(p, 'emberTrail')) {
    p.emberTrailMeters += Math.hypot(p.vx, p.vz) * dt;
    if (p.emberTrailMeters >= tuning.emberTrailSpacing) {
      p.emberTrailMeters = 0;
      spawnEmberPatch(game.holyFires, game.nextEntityId++, p.x, p.y, p.z);
    }
  } else {
    p.emberTrailMeters = tuning.emberTrailSpacing; // the first patch comes as soon as you start sliding
  }
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

/** Debug: a pool of holy fire 5 m in front of the player (to look at it without the Forge). */
export function spawnHolyFireInFront(game: GameState, world: World): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 5;
  const z = p.z - Math.cos(p.yaw) * 5;
  spawnHolyFire(game.holyFires, game.nextEntityId++, x, p.y + 1, z, world, []);
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

/** Debug: spawns a Damned Smith 14 m in front of the player (U key). */
export function spawnSmithInFront(game: GameState): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 14;
  const z = p.z - Math.cos(p.yaw) * 14;
  game.entities.push(createSmith(game.nextEntityId++, x, p.y + 0.5, z));
}

/** Debug: spawns a sharpshooter 20 m in front of the player (L key): it shoots from afar. */
export function spawnSharpshooterInFront(game: GameState): void {
  const p = game.player;
  const x = p.x - Math.sin(p.yaw) * 20;
  const z = p.z - Math.cos(p.yaw) * 20;
  game.entities.push(createSharpshooter(game.nextEntityId++, x, p.y + 0.5, z));
}

/** Debug: drops one pickup of each kind in a row 4 m in front of the player (J key), coin included. */
export function dropPickupsInFront(game: GameState): void {
  const p = game.player;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const kinds = ['coin', 'bullets', 'shells', 'sticks', 'medkit'] as const; // the coin on the left: the gun doesn't hide it
  kinds.forEach((kind, i) => {
    const side = i - (kinds.length - 1) / 2; // centered on the aim: from left to right
    const x = p.x + fx * 4 - fz * side * 1.2;
    const z = p.z + fz * 4 + fx * side * 1.2;
    game.pickups.push(createPickup(game, kind, x, p.y + 0.5, z, kind === 'coin' ? tuning.coinValue : 0));
  });
}
