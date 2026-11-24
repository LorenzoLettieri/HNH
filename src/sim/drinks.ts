// The barman's drinks: the PACTS (docs/DESIGN.md §5). You earn fiches by
// completing the map events, and spend them at the saloon: the counter shows
// a few drinks drawn at random, you pick one, and it lasts until you die.
// Taking a drink you already have raises it one LEVEL (whole steps, never
// "+10%"). Some are pure buffs; others are a deal with the devil: stronger,
// but they cost you something.
//
// The same structure as the armory's cards (upgrades.ts): a table of
// everything (DRINKS), a counter that is a PURE FUNCTION of a few numbers
// (barOffer: same numbers → same drinks, so reopening the panel is never a
// free reroll), and a step that reads the command's request (stepBar). The
// effects are read where they matter, through small functions here
// (maxHealth, runSpeed...): the rest of the code asks "how much?", not
// "which drinks do you have?".
import type { InputCommand } from './command';
import { tuning } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { randomInt, seedFrom } from './random';
import { shopInReach } from './shop';
import type { World } from './world';

/**
 * Every drink, and how many levels it has: 'levels' = up to
 * tuning.drinkMaxLevel (an effect that grows in whole steps: +25 health,
 * +25 more...); 1 = an effect that's either there or not (a double jump
 * doesn't get "more double"). The list of pacts the player wrote is in
 * docs/PATTI.md.
 */
export const DRINK_INFO = {
  // Pure buffs
  undertakerWhiskey: { levels: 'levels' },
  bloodyMary: { levels: 'levels' },
  lightningShine: { levels: 'levels' },
  deadMansRum: { levels: 'levels' },
  steamArmor: { levels: 1 },
  deadMansHand: { levels: 1 },
  quickDraw: { levels: 1 },
  crowWings: { levels: 1 },
  devilsHoof: { levels: 1 },
  emberTrail: { levels: 1 },
  ghost: { levels: 1 },
  // Pacts with a price
  devilsMilk: { levels: 'levels' },
  hellfireBourbon: { levels: 'levels' },
  crookedHorseshoe: { levels: 1 },
  greed: { levels: 1 },
} as const satisfies Record<string, { levels: 'levels' | 1 }>;

/** A drink's id: the keys of DRINK_INFO (one place to add a drink). */
export type DrinkId = keyof typeof DRINK_INFO;

/** Every drink, in a fixed order (it matters: the offer shuffles THIS list). */
export const DRINKS = Object.keys(DRINK_INFO) as DrinkId[];

/** The highest level of a drink. */
export function drinkMaxLevel(id: DrinkId): number {
  const levels = DRINK_INFO[id].levels;
  return levels === 'levels' ? tuning.drinkMaxLevel : levels;
}

/** Do you have it? (For the drinks with one level: their effect is on or off.) */
export function hasDrink(p: PlayerState, id: DrinkId): boolean {
  return p.drinks[id] > 0;
}

/** No drinks: every level at 0 (a new game, or after dying). */
export function noDrinks(): Record<DrinkId, number> {
  return Object.fromEntries(DRINKS.map((d) => [d, 0])) as Record<DrinkId, number>;
}

/** How many levels of this drink you've had. */
export function drinkLevel(p: PlayerState, id: DrinkId): number {
  return p.drinks[id];
}

// --- The effects: how much, asked by the code that needs it -----------------

/** Max health: Whiskey del Becchino adds, Latte del Diavolo takes away (never under 25). */
export function maxHealth(p: PlayerState): number {
  return Math.max(
    25,
    tuning.playerMaxHealth +
      tuning.whiskeyHealth * p.drinks.undertakerWhiskey -
      tuning.devilsMilkHealthCost * p.drinks.devilsMilk,
  );
}

/** Ground speed: Acquavite Fulmine adds to the run. */
export function runSpeed(p: PlayerState): number {
  return tuning.maxGroundSpeed + tuning.shineSpeed * p.drinks.lightningShine;
}

/** Your damage, every gun and blast and the boot: Latte del Diavolo (×1.5, ×2, ×2.5). */
export function drinkDamageMultiplier(p: PlayerState): number {
  return 1 + tuning.devilsMilkDamage * p.drinks.devilsMilk;
}

/** Damage you TAKE: Bourbon Infernale's price (×1.25, ×1.5...). */
export function damageTakenMultiplier(p: PlayerState): number {
  return 1 + tuning.bourbonHurt * p.drinks.hellfireBourbon;
}

/** Added to the style multiplier on score and vildenaro: Bourbon Infernale. */
export function rewardBonus(p: PlayerState): number {
  return tuning.bourbonMultiplier * p.drinks.hellfireBourbon;
}

/** Seconds added to the style chain: Rum del Morto. */
export function chainBonus(p: PlayerState): number {
  return tuning.rumChainSeconds * p.drinks.deadMansRum;
}

/** Health back for each kill: Bloody Mary. */
export function healPerKill(p: PlayerState): number {
  return tuning.bloodyMaryHeal * p.drinks.bloodyMary;
}

/** Corazza di vapore: an enemy projectile hits half as hard while you're this fast. */
export function projectileDamageScale(p: PlayerState): number {
  const fast = Math.hypot(p.vx, p.vz) >= tuning.steamArmorSpeed;
  return hasDrink(p, 'steamArmor') && fast ? tuning.steamArmorScale : 1;
}

/** What a coin is worth, × these: Ferro di cavallo storto doubles it, Avidità halves it. */
export function coinValueScale(p: PlayerState): number {
  return (hasDrink(p, 'crookedHorseshoe') ? tuning.horseshoeCoinScale : 1) * (hasDrink(p, 'greed') ? tuning.greedCoinScale : 1);
}

/** How far the coins fly out of a body: Ferro di cavallo storto (the price: you run after them). */
export function coinBurstScale(p: PlayerState): number {
  return hasDrink(p, 'crookedHorseshoe') ? tuning.horseshoeBurstScale : 1;
}

// --- The counter ------------------------------------------------------------

/** How many drinks you've had in total: it changes the draw after every drink. */
function drinksTaken(p: PlayerState): number {
  return DRINKS.reduce((sum, d) => sum + p.drinks[d], 0);
}

/**
 * The drinks on the counter right now: `drinkOfferSize` of those not at
 * their max level, shuffled with a seed made of the player's card seed (once
 * per game) and how many drinks you've had. Partial Fisher-Yates shuffle,
 * like the cards' upgradeOffer.
 */
export function barOffer(p: PlayerState): DrinkId[] {
  const left = DRINKS.filter((d) => p.drinks[d] < drinkMaxLevel(d));
  const rng = { rng: seedFrom(p.cardSeed, 0xba7, drinksTaken(p)) };
  const count = Math.min(tuning.drinkOfferSize, left.length);
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(rng, left.length - i);
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, count);
}

/** Why a drink can't be had right now (null = it can). The panel uses it too, to show it before the click. */
export type DrinkRefusal = 'far' | 'unavailable' | 'fiches';

export function drinkRefusal(p: PlayerState, id: DrinkId, world: World): DrinkRefusal | null {
  if (shopInReach(p, world)?.kind !== 'saloon') return 'far';
  if (!barOffer(p).includes(id)) return 'unavailable';
  if (p.fiches < tuning.drinkPrice) return 'fiches';
  return null;
}

/**
 * One tick at the bar: the command asks for a drink (cmd.drink, queued by a
 * click in the saloon's panel). Check, pay, pour. An event either way.
 */
export function stepBar(p: PlayerState, cmd: InputCommand, world: World, events: SimEvent[]): void {
  const id = cmd.drink;
  if (!id) return;
  const refusal = drinkRefusal(p, id, world);
  if (refusal) {
    events.push({ type: 'drinkFailed', drink: id, reason: refusal });
    return;
  }
  const before = maxHealth(p);
  p.fiches -= tuning.drinkPrice;
  p.drinks[id]++;
  // Max health changed: a higher cap comes with the health to fill it (the
  // whiskey heals that much), a lower one cuts what's above it.
  const after = maxHealth(p);
  p.health = Math.min(after, p.health + Math.max(0, after - before));
  events.push({ type: 'drinkBought', drink: id, level: p.drinks[id] });
}
