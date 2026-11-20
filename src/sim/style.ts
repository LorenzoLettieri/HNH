// The style meter (see docs/DESIGN.md §2): rewards playing with flair.
//
// Style is a CHAIN, like a Tony Hawk combo:
// - every stylish action adds points AND restarts a short timer (styleChainTime);
// - if the timer runs out (a few seconds without anything stylish) the chain
//   BREAKS and the points drop to zero at once. No slow drain: either you keep
//   the chain going, or you start over.
// - taking damage costs points (more for a bigger hit), but doesn't break the chain.
// The points decide the rank: one rank every `styleRankPoints`, up to HIGH NOON.
//
// HIGH NOON, the top rank, is a CLIMAX, not a place to stay: reaching it starts
// a countdown (styleHighNoonTime) during which the guns never run dry
// (weapon.ts, "bottomless"). Meanwhile the style is frozen at the top: no
// gains, no losses, the chain doesn't run out. When the countdown ends, the
// style starts over from zero: HIGH NOON is something to chase again.
//
// The style also MULTIPLIES what you earn (styleMultiplier): score and
// vildenaro. Who moves well gets richer, and stronger, sooner: a snowball
// effect, on purpose (DESIGN.md, "movement as power").
//
// Every stylish action is an AWARD (StyleAward: an id and its points): stepStyle
// appends a 'styleAward' event for each one, and the HUD lists them under the
// meter ("HEADSHOT +30"). The simulation decides WHAT was stylish and how much
// it's worth; the screen only decides how to show it.
//
// What gives style (the full list is StyleAward, the points are in config.ts):
// - what a hit did: hit, kill, headshot (and its variants);
// - HOW you got a kill: in the air, sliding, with the boot, right after a
//   weapon switch, quickscope/noscope, point blank, long shot, last round,
//   with little health;
// - several kills: with one shot, or one right after the other (a streak);
// - movement: speed, air time, wall jumps, bunny hops, slide jumps, vents,
//   enemy projectiles and bull charges dodged by a hair.
// Movement alone keeps the chain alive: the movement IS the game. But
// repeating the same action is worth less and less (freshness): variety pays.
import type { SimEvent } from './events';
import { secondsToTicks, TICK_DT, tuning } from './config';
import { horizontalSpeed, type PlayerState } from './player';

export interface StyleState {
  /** Points of the current chain (0 = no chain). */
  points: number;
  /** Ticks left before the chain breaks, if nothing stylish happens. 0 = no chain. */
  chainTicks: number;
  /** Ticks left of the HIGH NOON climax. 0 = not in progress. */
  highNoonTicks: number;

  // --- Memory, to recognize the stylish actions (kept even when the chain breaks) ---
  /** Kills in the current streak (kills each within styleStreakTime of the previous one). */
  streak: number;
  /** Ticks left before the streak ends (0 = no streak). */
  streakTicks: number;
  /** Ticks since your last weapon switch (for "CAMBIO LAMPO"). */
  sinceSwitchTicks: number;
  /** Ticks spent aiming down the sights without a break (for "QUICKSCOPE"). */
  aimTicks: number;
  /**
   * How "fresh" each action is, 0..1: what fraction of its points it's
   * worth right now. Doing it lowers it, time brings it back to 1 (then the
   * key is removed: an action you've never done, or not for a while, isn't listed).
   */
  freshness: Partial<Record<StyleAward, number>>;
  /** Counts the ticks (to hand out the speed points at a steady pace). */
  tick: number;
  /** Bunny hops in a row (a jump that isn't a hop starts over). */
  bhops: number;
  /** Speed points earned but not given yet: they're handed out every SPEED_EVERY ticks, in one line. */
  speedPoints: number;
}

/** How often the speed points become an award (ticks): one line every half second, not 60 a second. */
const SPEED_EVERY = 30;

/** The ranks, lowest first (western names: proposals, see DESIGN.md). */
export const STYLE_RANKS = [
  { letter: 'D', name: 'Dusty' },
  { letter: 'C', name: 'Cowpoke' },
  { letter: 'B', name: 'Bandit' },
  { letter: 'A', name: 'Desperado' },
  { letter: 'S', name: 'Sharpshooter' },
  { letter: 'SS', name: 'Showdown' },
  { letter: 'HN', name: 'HIGH NOON' },
] as const;

/**
 * The stylish actions, each with its id (the HUD gives it a name on screen,
 * see STYLE_AWARD_NAMES in render/styleFeed.ts). A new action = a new id here.
 */
export type StyleAward =
  // What a hit did (one award per hit, the best one).
  | 'hit'
  | 'kill'
  | 'headshot'
  | 'pupil' // headshot on an eye-bat: right in the eye
  | 'matador' // a bull killed while stunned against a wall
  // Kill bonuses: how you got the kill.
  | 'airKill'
  | 'slideKill'
  | 'kickKill'
  | 'quickSwitch'
  | 'quickscope'
  | 'noscope'
  | 'pointBlank'
  | 'longShot'
  | 'lastRound'
  | 'closeCall'
  // Several kills.
  | 'multiKill' // with one shot: `count` = how many
  | 'streak' // one after the other: `count` = kills in the streak
  // Movement.
  | 'speed'
  | 'airTime' // `count` = tenths of a second in the air
  | 'wallJump' // `count` = wall jumps in this flight
  | 'bhop' // `count` = hops in a row
  | 'slideJump'
  | 'vent'
  | 'nearMiss' // a projectile missed you by a hair
  | 'torero'; // a bull's charge missed you by a hair

export function createStyle(): StyleState {
  return {
    points: 0,
    chainTicks: 0,
    highNoonTicks: 0,
    streak: 0,
    streakTicks: 0,
    sinceSwitchTicks: 9999,
    aimTicks: 0,
    freshness: {},
    tick: 0,
    bhops: 0,
    speedPoints: 0,
  };
}

/** Index in STYLE_RANKS for these points: 0 = D, the last one = HIGH NOON. */
export function styleRank(points: number): number {
  return Math.min(STYLE_RANKS.length - 1, Math.floor(points / tuning.styleRankPoints));
}

/** The multiplier of a rank: ×1 at D, then + styleMultiplierPerRank for every rank up. */
export function rankMultiplier(rank: number): number {
  return 1 + rank * tuning.styleMultiplierPerRank;
}

/**
 * How much the style multiplies score and vildenaro RIGHT NOW. No chain = ×1
 * (the points are 0, so the rank is D anyway). During HIGH NOON the points
 * are frozen at the top: the maximum multiplier for the whole climax.
 */
export function styleMultiplier(style: StyleState): number {
  return rankMultiplier(isHighNoon(style) ? STYLE_RANKS.length - 1 : styleRank(style.points));
}

/** Is the HIGH NOON climax in progress? (The guns never run dry.) */
export function isHighNoon(style: StyleState): boolean {
  return style.highNoonTicks > 0;
}

/**
 * Updates the style with what happened in this tick: `events` from index `from`
 * on (the array may also hold the events of earlier ticks of the same frame).
 * `player` is read for the "how": in the air, sliding, aiming, low on health...
 * (stepStyle runs at the end of the tick, but the player moved at its start,
 * before shooting: their state is the one they had when they pulled the trigger.)
 * Appends a 'styleAward' event for every stylish action, and 'highNoon' /
 * 'highNoonEnd' when the climax starts / ends.
 */
export function stepStyle(style: StyleState, player: PlayerState, events: SimEvent[], from: number): void {
  // The awards are appended at the END of `events`, while we're reading it:
  // remember where this tick's events stop, so we don't read our own awards.
  const end = events.length;

  // Memory first: it must keep up even during HIGH NOON.
  remember(style, player, events, from, end);

  // HIGH NOON in progress: everything else is frozen, only the climax runs out.
  if (style.highNoonTicks > 0) {
    style.highNoonTicks--;
    if (style.highNoonTicks === 0) {
      // Over: back to zero, with no chain (the meter fades out, the next hit starts from D).
      style.points = 0;
      style.chainTicks = 0;
      events.push({ type: 'highNoonEnd' });
    }
    return;
  }

  let gained = 0;
  let lost = 0;
  const award = (id: StyleAward, base: number, count?: number): void => {
    // Variety: worth less if you've just done the same thing. (Not the
    // plain hit, the bread and butter, nor the speed, a trickle anyway.)
    let points = base;
    if (id !== 'hit' && id !== 'speed') {
      const fresh = style.freshness[id] ?? 1;
      points = Math.max(1, Math.round(base * fresh));
      style.freshness[id] = Math.max(tuning.styleRepeatMin, fresh * tuning.styleRepeatFactor);
    }
    gained += points;
    events.push({ type: 'styleAward', award: id, points, count });
  };

  // Kills of this tick, per source: several kills by the same gun (or boot)
  // in the same tick came from ONE shot. (A gun can't fire twice in a tick.)
  const killsBySource = new Map<string, number>();

  for (let i = from; i < end; i++) {
    const e = events[i];
    if (e.type === 'playerHurt') lost += e.damage * tuning.styleHurtPerDamage;

    // Movement.
    if (e.type === 'land' && e.airTicks * TICK_DT >= tuning.styleAirTimeMin) {
      const seconds = e.airTicks * TICK_DT;
      award('airTime', Math.round(seconds * tuning.styleAirTime), Math.round(seconds * 10));
    }
    if (e.type === 'wallJump') {
      const n = tuning.wallJumpsMax - e.left; // 1st, 2nd, 3rd of this flight
      award('wallJump', tuning.styleWallJump * n, n);
    }
    if (e.type === 'jump' && e.hop) award('bhop', tuning.styleBhop * Math.min(style.bhops, 5), style.bhops);
    if (e.type === 'jump' && e.slide) award('slideJump', tuning.styleSlideJump);
    if (e.type === 'ventLaunch') award('vent', tuning.styleVent);
    if (e.type === 'nearMiss') award('nearMiss', tuning.styleNearMiss);
    if (e.type === 'bullMiss' && e.side <= tuning.styleToreroDistance) award('torero', tuning.styleTorero);

    // Your hits on enemies, not the steel targets (metal). (A bull's charge
    // shoves enemies without damage: it never produces 'hit' events.)
    if (e.type !== 'hit' || e.surface !== 'flesh') continue;

    // One award per hit, named after the best thing it did: a headshot
    // kill is "HEADSHOT +75" (hit + kill + headshot), not three lines.
    if (!e.killed) {
      award('hit', tuning.styleHit);
      continue;
    }
    const base = tuning.styleHit + tuning.styleKill;
    if (!e.headshot) award('kill', base);
    else {
      const name = e.target === 'eyebat' ? 'pupil' : e.target === 'bull' ? 'matador' : 'headshot';
      award(name, base + tuning.styleHeadshotKill);
    }

    // How you got it: every bonus that applies is a line of its own.
    const gun = e.source !== 'kick';
    if (!player.onGround) award('airKill', tuning.styleAirKill);
    if (player.sliding) award('slideKill', tuning.styleSlideKill);
    if (!gun) award('kickKill', tuning.styleKickKill);
    if (style.sinceSwitchTicks <= secondsToTicks(tuning.weaponSwitchTime + tuning.styleQuickSwitchTime)) {
      award('quickSwitch', tuning.styleQuickSwitchKill);
    }
    if (e.source === 'rifle') {
      if (style.aimTicks > 0 && style.aimTicks <= secondsToTicks(tuning.styleQuickscopeTime)) {
        award('quickscope', tuning.styleQuickscope);
      } else if (style.aimTicks === 0 && e.distance >= tuning.styleNoscopeDistance) {
        award('noscope', tuning.styleNoscope);
      }
    }
    if (e.source === 'shotgun' && e.distance <= tuning.stylePointBlankDistance) {
      award('pointBlank', tuning.stylePointBlank);
    }
    if ((e.source === 'revolver' || e.source === 'rifle') && e.distance >= tuning.styleLongShotDistance) {
      award('longShot', tuning.styleLongShot);
    }
    // The shot that emptied the gun (the weapon already took the round away).
    if ((e.source === 'revolver' || e.source === 'rifle') && player.loaded[e.source] === 0) {
      award('lastRound', tuning.styleLastRound);
    }
    if (player.health <= tuning.styleCloseCallHealth) award('closeCall', tuning.styleCloseCall);

    killsBySource.set(e.source, (killsBySource.get(e.source) ?? 0) + 1);
  }

  // Several kills: with one shot, and one after the other.
  let kills = 0;
  for (const n of killsBySource.values()) {
    kills += n;
    if (n >= 2) award('multiKill', tuning.styleMultiKill * (n - 1), n);
  }
  if (kills > 0) {
    // Still inside the window of the previous kill: the streak goes on.
    style.streak = style.streakTicks > 0 ? style.streak + kills : kills;
    style.streakTicks = secondsToTicks(tuning.styleStreakTime);
    if (style.streak >= 2) award('streak', tuning.styleStreak * (style.streak - 1), style.streak);
  }

  // Speed: points keep coming while you're fast, handed out twice a second.
  // (`speedPoints` is the "piggy bank": fractions of a point add up every tick.)
  const speed = horizontalSpeed(player);
  if (speed >= tuning.styleSpeedMin) {
    style.speedPoints += tuning.styleSpeed * (speed / tuning.styleSpeedMin) * TICK_DT;
  }
  if (style.speedPoints >= 1 && style.tick % SPEED_EVERY === 0) {
    const points = Math.floor(style.speedPoints);
    style.speedPoints -= points;
    award('speed', points);
  }

  // Something stylish: more points, and the countdown starts again from the top.
  if (gained > 0) {
    style.points += gained;
    style.chainTicks = secondsToTicks(tuning.styleChainTime);
  }
  style.points = Math.max(0, style.points - lost);

  // The countdown. When it reaches zero the chain breaks: everything is lost at once.
  if (style.chainTicks > 0) {
    style.chainTicks--;
    if (style.chainTicks === 0) style.points = 0;
  }

  // Reached the top rank: HIGH NOON! (Points above zero mean the chain is
  // still going: when it breaks they drop to zero, right above.)
  if (styleRank(style.points) === STYLE_RANKS.length - 1) {
    style.highNoonTicks = secondsToTicks(tuning.styleHighNoonTime);
    events.push({ type: 'highNoon' });
  }
}

/**
 * The style's memory of what you've been doing: timers that the awards read.
 * Updated every tick, chain or not.
 */
function remember(style: StyleState, player: PlayerState, events: SimEvent[], from: number, end: number): void {
  style.tick++;
  style.sinceSwitchTicks++;
  for (let i = from; i < end; i++) {
    const e = events[i];
    if (e.type === 'weaponSwitch') style.sinceSwitchTicks = 0;
    // A hop extends the run of bunny hops, any other jump starts a new one.
    if (e.type === 'jump') style.bhops = e.hop ? style.bhops + 1 : 0;
  }

  // Aiming: counts up while the carbine is (even partly) at the eye.
  style.aimTicks = player.adsTicks > 0 ? style.aimTicks + 1 : 0;
  if (style.streakTicks > 0) style.streakTicks--;
  // Actions done a while ago get fresh again, a bit every tick.
  for (const id of Object.keys(style.freshness) as StyleAward[]) {
    const fresh = style.freshness[id]! + tuning.styleRepeatRecover * TICK_DT;
    if (fresh >= 1) delete style.freshness[id];
    else style.freshness[id] = fresh;
  }
}
