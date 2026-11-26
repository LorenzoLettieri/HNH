// The undertaker's coffin and its RELICS (docs/DESIGN.md §5, "La Bara del
// Becchino"). In front of the undertaker's door there's a coffin: pay
// vildenaro, the lid flies open and out comes a dead man's belonging, drawn
// at random. It's yours until you die, and every copy stacks.
//
// The design rule that keeps relics apart from everything else:
// - the CARDS (upgrades.ts) change one weapon;
// - the PACTS (drinks.ts) are rules with a condition ("when you do X, Y happens");
// - a RELIC is a plain NUMBER, always on, that stacks. Never an "if", never a "when".
// That's why they can't clash with the pacts: those change HOW you play,
// relics make whoever plays sturdier. And every draw is useful, even the
// tenth copy of the same one.
//
// Left out on purpose (they would change the game, not just the numbers):
// movement numbers that change your reach (jump, gravity, top speed: the map
// is tuned on them) and any help with the aim.
//
// HOW THEY STACK: two shapes.
// - LINEAR: n copies = n × the bonus (max health: +15, +30, +45...). For
//   things with no natural ceiling.
// - HYPERBOLIC: for reductions and chances, which must never reach 100%.
//   A time or damage scale of 1 / (1 + k·n): with k = 0.1, one copy = 0.91,
//   five = 0.67, ten = 0.5. It always gets better, every copy a little less
//   (the formula Risk of Rain uses). A chance goes the other way:
//   1 − 1 / (1 + k·n) of what's missing to 100%.
// Combined with the other sources (the Corazza di vapore, the Tamburo veloce
// card...) they MULTIPLY, never add: halving twice is a quarter, never zero.
//
// The effects are asked through the small functions below, like the drinks:
// the rest of the code asks "how much?", never "which relics do you have?".
import type { InputCommand } from './command';
import { canAfford } from './drinks';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import type { PlayerState } from './player';
import { randomInt, type RandomState } from './random';
import type { AmmoType } from './weapon';
import type { World } from './world';

/**
 * Every relic, in a fixed order (it matters: the draw picks an index in
 * THIS list, so the same seed gives the same relics). Adding one = an id
 * here, its number in config.ts, its effect in a function below (read where
 * it matters), its name in RELIC_TEXT (render/relicText.ts) and its icon in
 * render/relicIcons.ts (the compiler complains about the last two).
 */
export const RELICS = [
  'banditHeart', // Cuore del bandito: + max health (linear)
  'tannedHide', // Pelle conciata: less damage taken (hyperbolic)
  'finePowder', // Polvere fine: more damage with every gun (×, compounding)
  'gunslingerBelt', // Cinturone del pistolero: bigger pockets (linear)
  'buckskinGloves', // Guanti di daino: faster reloads (hyperbolic)
  'prospectorMagnet', // Calamita del cercatore: pickups from farther away (linear, with a ceiling)
  'rabbitFoot', // Zampa di coniglio: more ammo and medkits dropped (hyperbolic)
  'coldBlood', // Sangue freddo: health comes back by itself (linear)
] as const;

export type RelicId = (typeof RELICS)[number];

/** No relics: every count at 0 (a new game, or after dying). */
export function noRelics(): Record<RelicId, number> {
  return Object.fromEntries(RELICS.map((r) => [r, 0])) as Record<RelicId, number>;
}

/** How many copies of a relic you have. */
export function relicCount(p: PlayerState, id: RelicId): number {
  return p.relics[id];
}

/** 1 / (1 + k·n): the hyperbolic scale (1 with no copies, toward 0 but never there). */
function diminish(k: number, n: number): number {
  return 1 / (1 + k * n);
}

// --- The effects: how much, asked by the code that needs it -----------------

/** Cuore del bandito: max health added (drinks.ts maxHealth adds it to the rest). */
export function relicMaxHealth(p: PlayerState): number {
  return tuning.relicHeartHealth * p.relics.banditHeart;
}

/** Pelle conciata: × every damage you take (player.ts hurtPlayer). */
export function damageTakenScale(p: PlayerState): number {
  return diminish(tuning.relicHideK, p.relics.tannedHide);
}

/**
 * Polvere fine: × the damage of every gun's own bullet (weapon.ts gunPower;
 * the dynamite stick takes it with it). It COMPOUNDS: (1 + step)^n, so the
 * fifth copy is worth more than the first. Mind the breakpoints (DESIGN §3):
 * a bonus only counts when it takes one shot off a kill. Revolver 50 against
 * a 150-health ghoul (wave 20) = 3 shots; with 5 copies (×1.61, 80.5) = 2.
 */
export function gunDamageScale(p: PlayerState): number {
  return Math.pow(1 + tuning.relicPowderStep, p.relics.finePowder);
}

/** Cinturone del pistolero: how many spare rounds a pocket holds (everything that fills a pocket asks this). */
export function reserveMax(p: PlayerState, ammo: AmmoType): number {
  const base =
    ammo === 'bullets' ? tuning.revolverReserveMax
    : ammo === 'shells' ? tuning.shotgunReserveMax
    : tuning.dynamiteReserveMax;
  return Math.round(base * (1 + tuning.relicBeltStep * p.relics.gunslingerBelt));
}

/** Guanti di daino: × the time of every reload (weapon.ts; the reload animations read it too). */
export function reloadScale(p: PlayerState): number {
  return diminish(tuning.relicGlovesK, p.relics.buckskinGloves);
}

/** Calamita del cercatore: how close a pickup must be to be collected, meters (pickups.ts). */
export function pickupRadius(p: PlayerState): number {
  return Math.min(tuning.relicMagnetMax, tuning.pickupRadius + tuning.relicMagnetStep * p.relics.prospectorMagnet);
}

/**
 * Zampa di coniglio: the chance that a dead enemy drops an item (ammo or a
 * medkit, pickups.ts), raised toward 100% without ever reaching it: it
 * closes 1 − 1/(1 + k·n) of the gap. A ghoul's 30% with one copy (k 0.15)
 * becomes 39%, with five 60%.
 */
export function dropChance(p: PlayerState, base: number): number {
  return base + (1 - base) * (1 - diminish(tuning.relicRabbitK, p.relics.rabbitFoot));
}

/**
 * Sangue freddo: every relicRegenInterval seconds, health back = the copies
 * × relicRegenAmount (game.ts). The only regeneration in the game: slow on
 * purpose, the medkits stay the real healing.
 */
export function stepRegen(p: PlayerState, maxHealth: number): void {
  const n = p.relics.coldBlood;
  if (n === 0 || p.health <= 0) return;
  if (++p.regenTicks < secondsToTicks(tuning.relicRegenInterval)) return;
  p.regenTicks = 0;
  p.health = Math.min(maxHealth, p.health + tuning.relicRegenAmount * n);
}

// --- The coffin -------------------------------------------------------------

/**
 * What opening the coffin costs now: coffinPrice × coffinPriceGrowth^(times
 * you've opened it). Exponential on purpose: 300, 375, 469... 915 the sixth
 * time, 2794 the eleventh. Early on it's a relic a wave; later it's a real
 * choice against the armory's cards.
 */
export function coffinPrice(p: PlayerState): number {
  return Math.round(tuning.coffinPrice * Math.pow(tuning.coffinPriceGrowth, p.coffinOpens));
}

/**
 * Close enough to the coffin to open it? The same reach as the shops
 * (horizontal distance, same floor). The page asks it too, for "E · BARA".
 */
export function coffinInReach(p: PlayerState, world: World): boolean {
  const c = world.coffin;
  if (!c) return false;
  return Math.hypot(p.x - c.x, p.z - c.z) < tuning.shopReach && Math.abs(p.y - c.y) < tuning.shopReachHeight;
}

/** Why the coffin stays shut: too far, no money, or still closing from the last time. */
export type CoffinRefusal = 'far' | 'money' | 'busy';

/**
 * One tick at the coffin: the command asks to open it (cmd.coffin, E next
 * to it). Check, pay, draw a relic with the game's seeded generator (same
 * seed = same relics), hand it over. The coffin needs a moment to close
 * again (coffinBusyTicks, on the game: one day it's the town's coffin,
 * shared by every player), so the animation is never cut short.
 *
 * Fully random: every relic has the same chance. That's fine only because
 * every relic stacks and is always useful.
 */
export function stepCoffin(
  p: PlayerState,
  cmd: InputCommand,
  world: World,
  game: RandomState & { coffinBusyTicks: number },
  events: SimEvent[],
): void {
  if (game.coffinBusyTicks > 0) game.coffinBusyTicks--;
  if (!cmd.coffin) return;
  const refusal: CoffinRefusal | null =
    !coffinInReach(p, world) ? 'far'
    : game.coffinBusyTicks > 0 ? 'busy'
    : !canAfford(p, coffinPrice(p)) ? 'money' // Debito col diavolo works here too
    : null;
  if (refusal) return void events.push({ type: 'coffinFailed', reason: refusal });

  const price = coffinPrice(p);
  const relic = RELICS[randomInt(game, RELICS.length)];
  p.money -= price;
  p.coffinOpens++;
  p.relics[relic]++;
  // A bigger heart comes full: the new max health arrives with the health to fill it (like a drink).
  if (relic === 'banditHeart') p.health += tuning.relicHeartHealth;
  game.coffinBusyTicks = secondsToTicks(tuning.coffinBusyTime);
  events.push({ type: 'coffinOpened', relic, count: p.relics[relic], price });
}
