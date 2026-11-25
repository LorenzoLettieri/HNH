// Weapon upgrades (docs/DESIGN.md §6c): every weapon has a DECK of cards; at
// the armory the counter shows a few of them drawn at random, you buy one,
// it's yours until you die. Pure simulation, like the shop: one day the
// server decides what you were offered and what you bought.
//
// The draw is NOT taken from the game's shared random stream (game.rng).
// That stream moves every time an enemy spawns, so "what's on the counter"
// would depend on when you walk in: reopening the shop would show other
// cards (a free reroll). Instead the offer is a pure FUNCTION of a few
// numbers: the player's card seed (rolled once per game), which weapon, and
// how many cards it already has. Same numbers → same offer, every time you
// ask; nothing to store, nothing to keep in sync. Buying a card changes the
// level, and so the next offer. (Same idea as a URL hash or an ETag: derive
// it from the data instead of storing it.)
import { tuning } from './config';
import type { PlayerState } from './player';
import { randomInt, seedFrom } from './random';
import { GEAR, type GearId } from './weapon';

/**
 * Every card of every deck. A card belongs to ONE weapon (see CARDS), so its
 * id alone is enough to buy it. To add a card: an id here, a row in CARDS,
 * its effect where the weapon reads it (hasCard), its name in shopMenu.ts.
 */
export type CardId =
  // Revolver
  | 'undertakerCylinder'
  | 'fastCylinder'
  | 'slideReload'
  | 'riderShot'
  | 'quickHand'
  | 'ricochet'
  | 'lastShot'
  // Shotgun
  | 'longBarrels'
  | 'dragonBreath'
  | 'mule'
  | 'leadStock'
  | 'pointBlankLuck'
  | 'doubleBang'
  | 'leadFlight'
  | 'bouncingPellets'
  | 'groupPush'
  // Carbine
  | 'duelist'
  | 'gunslingerLever'
  | 'piercing'
  | 'hawkEye'
  | 'quickscope'
  | 'mark'
  | 'twoAtATime'
  // Dynamite launcher
  | 'shortFuse'
  | 'powderKeg'
  | 'hellBounce'
  | 'sticky'
  | 'rocket'
  | 'cluster'
  // Shovel
  | 'momentum'
  | 'pogo'
  | 'skySlam'
  | 'parry'
  | 'slideSweep'
  // Lasso
  | 'longRope'
  | 'slingshot'
  | 'doubleLoop'
  | 'slamYank'
  | 'hotRope'
  | 'bootArrival'
  | 'napalmTrail';

export interface CardInfo {
  /** The weapon (or gear: the shovel) whose deck it's in. */
  weapon: GearId;
  /**
   * Cards that can't live with this one (they contradict each other): once
   * you take one, the others leave the deck. Written on ONE of the two is
   * enough, the check goes both ways (see `excluded`). A list: Razzo
   * contradicts two cards at once.
   */
  excludes?: CardId[];
}

export const CARDS: Record<CardId, CardInfo> = {
  /** Tamburo del becchino: 8 rounds in the cylinder instead of 6 (magazineSize in weapon.ts). */
  undertakerCylinder: { weapon: 'revolver' },
  /** Tamburo veloce: the reload takes fastCylinderReloadScale of the time (reloadTime in weapon.ts). */
  fastCylinder: { weapon: 'revolver' },
  /** Ricarica in scivolata: sliding pushes a round into the cylinder every slideReloadInterval (stepSlideReload). */
  slideReload: { weapon: 'revolver' },
  /** Colpo da cavaliere: the first shot after a wall jump is a critical hit (wallJumpShot in player.ts). */
  riderShot: { weapon: 'revolver' },
  /** Mano lesta: tighter, faster fanning; every kill during the burst adds a free shot to it (stepWeapon). */
  quickHand: { weapon: 'revolver' },
  /** Ricochet: after a critical hit the bullet bounces into the body of the nearest enemy (ricochet in weapon.ts). */
  ricochet: { weapon: 'revolver' },
  /** Ultimo colpo: the cylinder's last round explodes where it lands (explode in weapon.ts). */
  lastShot: { weapon: 'revolver' },

  /** Canne lunghe: tighter spread, full damage farther away (fireShotgun). */
  longBarrels: { weapon: 'shotgun' },
  /** Fiato di drago: the pellets set enemies on fire (burnTicks, see status.ts). */
  dragonBreath: { weapon: 'shotgun' },
  /** Mulo: double recoil on you, a huge shotgun jump. Can't live with Calcio di piombo (no recoil). */
  mule: { weapon: 'shotgun', excludes: ['leadStock'] },
  /** Calcio di piombo: no recoil, double knockback; thrown into a wall, an enemy takes damage (status.ts). */
  leadStock: { weapon: 'shotgun' },
  /** Bruciapelo fortunato: a point-blank kill puts the shell back in the barrel. */
  pointBlankLuck: { weapon: 'shotgun' },
  /** Doppio botto: with both barrels loaded, the first shot fires both together. */
  doubleBang: { weapon: 'shotgun' },
  /** Volo di piombo: a shotgun jump gives the shell back if you kill something before landing (refundLeadFlight). */
  leadFlight: { weapon: 'shotgun' },
  /** Pallini rimbalzanti: pellets hitting the floor bounce once. */
  bouncingPellets: { weapon: 'shotgun' },
  /** Spinta di gruppo: the point-blank knockback also throws whoever is right behind the enemy. */
  groupPush: { weapon: 'shotgun' },

  /** Duellante: after duelistTime seconds without shooting, the next shot does double damage (quietTicks). */
  duelist: { weapon: 'rifle' },
  /** Leva da pistolero: no hip-fire spread, and the lever is faster (fireInterval). */
  gunslingerLever: { weapon: 'rifle' },
  /** Perforante: the bullet goes through every enemy in a line (fireRifle). */
  piercing: { weapon: 'rifle' },
  /** Occhio di falco (it was "Cannocchiale", until the Forge's optic took the zoom): critical ×scopeCritMultiplier when fully aimed. */
  hawkEye: { weapon: 'rifle' },
  /** Quickscope: a shot within quickscopeWindow of starting to aim is a critical hit (aimHeldTicks). */
  quickscope: { weapon: 'rifle' },
  /** Marchio: a hit marks the enemy; the next hit on it does double damage (Entity.marked). */
  mark: { weapon: 'rifle' },
  /** Due alla volta: the reload pushes in two rounds at a time. */
  twoAtATime: { weapon: 'rifle' },

  /** Miccia corta: the fuse burns in shortFuseScale of the time (throwDynamite in dynamite.ts). */
  shortFuse: { weapon: 'dynamite' },
  /** Botte di polvere: a bigger blast, × powderKegRadiusScale (the stick's `radius`). */
  powderKeg: { weapon: 'dynamite' },
  /** Rimbalzo infernale: every bounce adds hellBounceBonus to the blast's damage, up to hellBounceMax bounces. */
  hellBounce: { weapon: 'dynamite' },
  /** Appiccicosa: the stick sticks where it first touches the level, and waits for its fuse (stepDynamite). */
  sticky: { weapon: 'dynamite', excludes: ['hellBounce'] },
  /** Razzo: flies straight and fast for rocketTime, blows up on ANY contact (floor too); a stronger dynamite jump. */
  rocket: { weapon: 'dynamite', excludes: ['sticky', 'hellBounce'] },
  /** A grappolo: the blast throws clusterCount mini sticks around, which blow up a moment later (stepDynamite). */
  cluster: { weapon: 'dynamite' },

  /** Slancio: the faster you run, the harder it hits, in whole steps (momentumMultiplier in kick.ts). */
  momentum: { weapon: 'shovel' },
  /** Pogo: a swing that hits something while you're in the air bounces you up (landKick). */
  pogo: { weapon: 'shovel' },
  /** Schianto dal cielo: a swing in the air looking down dives you to the ground, a shockwave where you land (stepSkySlam). */
  skySlam: { weapon: 'shovel' },
  /** Parata: the swing bats the enemy projectiles back, like the drink "Bobby" (batProjectiles). */
  parry: { weapon: 'shovel' },
  /** Spazzata in scivolata: sliding, the swing is a wide, longer arc that knocks everyone down (landKick). */
  slideSweep: { weapon: 'shovel' },

  /** Rampino lungo: the hook reaches farther and reels faster (hookRange, reelAccel, reelMaxSpeed in lasso.ts). */
  longRope: { weapon: 'lasso' },
  /** Fionda: letting go of the rope in mid-air throws you forward, along where you were going (release). */
  slingshot: { weapon: 'lasso' },
  /** Laccio doppio: the loop also catches the enemy nearest to the first (landLasso). */
  doubleLoop: { weapon: 'lasso' },
  /** Strattone che schianta: a yanked enemy hurts itself and whoever it flies into (markSlam, status.ts). */
  slamYank: { weapon: 'lasso' },
  /** Corda rovente: whatever the loop or the hook catches catches fire (ignite). */
  hotRope: { weapon: 'lasso' },
  /** Arrivo di stivale: hooked onto an enemy, you arrive with a kick that stuns it (bootArrival in lasso.ts). */
  bootArrival: { weapon: 'lasso' },
  /** Scia Napalm (the user's idea): flying on the rope you leave patches of fire on the floor below (stepNapalmTrail in game.ts). */
  napalmTrail: { weapon: 'lasso' },
};

/** Is this card out of the deck because you took one that excludes it (or that it excludes)? */
function excluded(p: PlayerState, id: CardId): boolean {
  const taken = p.cards[CARDS[id].weapon];
  return taken.some((t) => CARDS[t].excludes?.includes(id) || CARDS[id].excludes?.includes(t));
}

/** The deck of a weapon: every card that belongs to it, in a fixed order (the draw shuffles a copy). */
export function deckOf(weapon: GearId): CardId[] {
  return (Object.keys(CARDS) as CardId[]).filter((id) => CARDS[id].weapon === weapon);
}

/** Every weapon with no cards: the starting state (and after death). */
export function noCards(): Record<GearId, CardId[]> {
  return { revolver: [], shotgun: [], rifle: [], dynamite: [], shovel: [], lasso: [] };
}

/** Do you have this card? (The weapons ask this to change how they work.) */
export function hasCard(p: PlayerState, id: CardId): boolean {
  return p.cards[CARDS[id].weapon].includes(id);
}

/** Level of a weapon = how many cards it has. */
export function upgradeLevel(p: PlayerState, weapon: GearId): number {
  return p.cards[weapon].length;
}

/**
 * Price of the NEXT card of a weapon, or null if it can't take more.
 * Grows at every level (Pack-a-Punch style): base × growth^level.
 */
export function upgradePrice(p: PlayerState, weapon: GearId): number | null {
  const level = upgradeLevel(p, weapon);
  if (level >= tuning.upgradeMaxLevel) return null;
  return Math.round(tuning.upgradeBasePrice * Math.pow(tuning.upgradePriceGrowth, level));
}

/**
 * The cards on the counter for a weapon right now. Up to upgradeOfferSize,
 * fewer if the deck is running out, none if the weapon is maxed out.
 *
 * How: the cards still in the deck, shuffled with a generator seeded from
 * (card seed, weapon, level), and the first few taken. The shuffle is a
 * PARTIAL Fisher-Yates: for each position, swap in a random card from the
 * rest; stop once the positions we need are filled. Every card has the same
 * chance to end up in each position (a naive "sort by random" doesn't).
 */
export function upgradeOffer(p: PlayerState, weapon: GearId): CardId[] {
  if (upgradePrice(p, weapon) === null) return [];
  const left = deckOf(weapon).filter((id) => !p.cards[weapon].includes(id) && !excluded(p, id));
  const rng = { rng: seedFrom(p.cardSeed, GEAR.indexOf(weapon), upgradeLevel(p, weapon)) };
  const count = Math.min(tuning.upgradeOfferSize, left.length);
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(rng, left.length - i);
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, count);
}
