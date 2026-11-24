// HUD: health plate (healthPlate.ts), red flash, direction arc (damageIndicator.ts)
// and head snap (cameraFeel.ts) when you get hit, low health (lowHealth.ts),
// wave number, enemies left, fps, speed, score, wave banners, the style meter (styleMeter.ts) and its feed (styleFeed.ts)
// (the end-of-game screen is endScreen.ts).
// Plain HTML/CSS elements (see index.html), updated from here.
import { tuning } from '../sim/config';
import type { SimEvent } from '../sim/events';
import type { PlayerState } from '../sim/player';
import { playBell, playMapEventEnd, playMapEventStart, playPickup, playPlayerHurt, playSmithArrived } from '../audio/sfx';
import { BOUNTY_MODIFIER_TEXT, MAP_EVENT_TEXT, WAGER_CURSE_TEXT } from './mapEventText';
import { outlawName } from '../randomName';
import { bountyEntity } from '../sim/bounty';
import { PONY_HURRY } from './ponyRings';
import { maxHealth } from '../sim/drinks';
import type { GameState } from '../sim/game';
import { horizontalSpeed } from '../sim/player';
import { isEnemy } from '../sim/entities';
import { updateStyleMeter } from './styleMeter';
import { updateStyleFeed } from './styleFeed';
import { updateHighNoon } from './highNoon';
import { updateHealthPlate } from './healthPlate';
import { updateLowHealth } from './lowHealth';
import { addHurtArc, screenAngle, updateHurtArcs } from './damageIndicator';
import { hurtKick } from './cameraFeel';
import { mainKeyName } from '../keybinds';

const damage = document.getElementById('damage')!;
const pickupFlash = document.getElementById('pickup-flash')!;
const waveHud = document.getElementById('wave')!;
const waveBox = document.getElementById('wave-box')!;
const scoreHud = document.getElementById('score')!;
const killsHud = document.getElementById('kills')!;
const enemiesHud = document.getElementById('enemies-left')!;
const fpsHud = document.getElementById('fps')!;
const speedHud = document.getElementById('speed')!;
const eventLine = document.getElementById('event-line')!;
const eventName = document.getElementById('event-name')!;
const eventGoal = document.getElementById('event-goal')!;
/** Under this many seconds the event's clock turns red. */
const EVENT_HURRY = 10;
/** La Taglia: with this many other enemies left (or fewer, all spawned) the line turns red: the outlaw is about to leave. */
const BOUNTY_HURRY = 3;
let fps = 60; // smoothed
const banner = document.getElementById('banner')!;
const bannerTitle = document.getElementById('banner-title')!;
const bannerSub = document.getElementById('banner-sub')!;
let bannerTime = 0; // seconds left of the current message
let countdownShown = -1; // the countdown digit on screen (-1 = none)
/**
 * Messages waiting for the banner to be free: a FIFO queue (first in, first
 * out, like a job queue). The map event shows up in the same tick as
 * "ONDATA 5": shown together one would erase the other, so it waits its
 * turn. `sound` plays when the message is SHOWN, not when it's queued.
 */
const bannerQueue: { title: string; sub: string; seconds: number; sound: () => void }[] = [];


/**
 * Restarts a CSS animation: remove the class, force the browser to compute
 * the layout (reading offsetWidth does it), add the class back. Without the
 * read in the middle the browser would merge remove+add into "nothing
 * changed" and the animation wouldn't play again.
 */
function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** kind: 'hot' = HIGH NOON colors, 'countdown' = small line on top. */
function setBanner(title: string, sub: string, kind: '' | 'hot' | 'countdown' = ''): void {
  bannerTitle.textContent = title;
  bannerSub.textContent = sub;
  banner.classList.toggle('hot', kind === 'hot');
  banner.classList.toggle('countdown', kind === 'countdown');
  restartAnimation(bannerTitle, 'stamp');
}

function showBanner(title: string, sub: string, seconds: number, kind: '' | 'hot' = ''): void {
  setBanner(title, sub, kind);
  bannerTime = seconds;
  countdownShown = -1;
}

/** Shows the message now if the banner is free, otherwise after the ones before it. */
function queueBanner(title: string, sub: string, seconds: number, sound: () => void): void {
  bannerQueue.push({ title, sub, seconds, sound });
}

let flash = 0; // 0..1, the red flash after a hit
/** Damage of a "full strength" hit, for sounds and flash. */
const HARD_HIT = 40;
/** How far (% of the screen) the red flash's center moves away from the hit. */
const FLASH_SHIFT = 30;
/** How fast the red flash fades (per second). */
const FLASH_FADE = 2;
/** Screen tint for each pickup: same colors as their glow (render/pickups.ts). */
const PICKUP_TINTS = { bullets: 'rgb(255, 200, 70)', shells: 'rgb(255, 90, 40)', medkit: 'rgb(70, 255, 100)', coin: 'rgb(255, 190, 40)', iron: 'rgb(255, 70, 30)', sticks: 'rgb(255, 50, 30)' };
/** Coins tint the screen less: you pick up dozens, it shouldn't feel like a camera flash every time. */
const COIN_FLASH = 0.4;
let pickupTime = 0; // 0..1, the short flash when you collect something

export function updateHud(game: GameState, events: SimEvent[], dt: number): void {
  const player: PlayerState = game.player;
  // A bull's 5 coins can be collected in the same frame: one sound, not five on top of each other.
  const soundsPlayed = new Set<string>();
  for (const e of events) {
    if (e.type === 'playerHurt') {
      // How hard: 0..1 (a hound bite 0.4, a ghoul claw 0.5, a bull charge 1).
      const strength = Math.min(1, e.damage / HARD_HIT);
      const angle = screenAngle(player, e.fromX, e.fromZ);
      playPlayerHurt(strength);
      // Where it came from: an arc around the crosshair, the head snapping away...
      addHurtArc(e.fromX, e.fromZ, e.damage);
      hurtKick(angle, e.damage);
      // ...and the red flash thicker on the hit's side: the center of the
      // vignette's gradient moves AWAY from the hit (CSS variables in index.html).
      flash = Math.max(flash, 0.6 + 0.4 * strength);
      damage.style.setProperty('--hx', `${Math.sin(angle) * FLASH_SHIFT}%`);
      damage.style.setProperty('--hy', `${Math.cos(angle) * FLASH_SHIFT}%`);
    }
    if (e.type === 'pickup') {
      // Doom's "bonus flash": the whole screen tinted for a moment, in the
      // pickup's color (a CSS variable read by #pickup-flash in index.html).
      pickupTime = Math.max(pickupTime, e.kind === 'coin' ? COIN_FLASH : 1);
      pickupFlash.style.setProperty('--tint', PICKUP_TINTS[e.kind]);
      if (!soundsPlayed.has(e.kind)) playPickup(e.kind);
      soundsPlayed.add(e.kind);
    }
    if (e.type === 'playerDied') {
      bannerTime = 0; // no wave message left over for the next game
      bannerQueue.length = 0;
    }
    if (e.type === 'waveStart') {
      // Every waveHealthStep waves the ghouls get tougher: tell the player.
      const tougher = e.wave % tuning.waveHealthStep === 0;
      showBanner(`ONDATA ${e.wave}`, tougher ? 'sono più resistenti: mira alla testa' : '', tougher ? 4 : 3);
      playBell(2); // the church bell tolls: here they come
    }
    if (e.type === 'smithArrived') {
      // The special enemy: announced like a wave (docs/DESIGN.md §6d). With more
      // than one: the banner once (with how many), the anvil for each of them.
      if (e.first) {
        if (e.total === 1) showBanner('IL FABBRO DANNATO', 'porta il Ferro Dannato: mira alla testa, salta l’onda', 4);
        else showBanner(`${e.total} FABBRI DANNATI`, 'ognuno porta il Ferro Dannato: mira alla testa, salta l’onda', 4);
      }
      playSmithArrived();
    }
    if (e.type === 'waveEnd') {
      showBanner('ONDATA SUPERATA', '', 2.5);
      playBell(1, 240);
    }
    // Map events (mapEvents.ts): queued, they usually come with a wave message.
    if (e.type === 'mapEventStart') {
      const text = MAP_EVENT_TEXT[e.kind];
      queueBanner(text.title, text.goal, 4, playMapEventStart);
    }
    if (e.type === 'mapEventEnd') {
      const name = MAP_EVENT_TEXT[e.kind].title.toLowerCase();
      if (e.declined) queueBanner('IL DIAVOLO SI ALZA DAL TAVOLO', 'scommessa rifiutata: niente vinto, niente perso', 3, () => playMapEventEnd(false));
      else if (e.kind === 'bounty' && e.success) queueBanner('TAGLIA RISCOSSA', `raccogli le monete · +${e.fiches} ${e.fiches === 1 ? 'fiche' : 'fiches'}`, 3, () => playMapEventEnd(true));
      else if (e.kind === 'bounty') queueBanner('IL RICERCATO È FUGGITO', 'la taglia è persa', 3, () => playMapEventEnd(false));
      else if (e.success) queueBanner('EVENTO COMPLETATO', `+${e.fiches} ${e.fiches === 1 ? 'fiche' : 'fiches'} · spendile al saloon`, 3, () => playMapEventEnd(true));
      else queueBanner('EVENTO FALLITO', name, 3, () => playMapEventEnd(false));
    }
    // The devil's wager (wager.ts): the bet is taken, then the cursed wave starts.
    if (e.type === 'wagerAccepted') {
      queueBanner('SCOMMESSA ACCETTATA', `prossima ondata: ${WAGER_CURSE_TEXT[e.curse].name.toLowerCase()}`, 3, () => {}); // its sound: at the table (render/wagerTable.ts)
    }
    if (e.type === 'wagerCurse') {
      queueBanner(WAGER_CURSE_TEXT[e.curse].name, `${WAGER_CURSE_TEXT[e.curse].rule} · sopravvivi`, 4, () => {}); // its sound: playWagerCurse (render/wagerTable.ts)
    }
    // The banner says what the climax gives you; tint and sounds are in highNoon.ts.
    if (e.type === 'highNoon') showBanner('HIGH NOON', 'caricatore infinito', 2.5, 'hot');
  }

  // Wave number and score, always visible. During the break: a countdown.
  const w = game.wave;
  waveBox.hidden = w.number === 0; // nothing to show before the first wave
  waveHud.textContent = String(w.number);
  scoreHud.textContent = String(game.stats.score);
  killsHud.textContent = `${game.stats.kills} UCCISIONI`;
  // Enemies alive right now (corpses still on the ground don't count). A "+"
  // while the wave is still spawning: more are coming than you can see here.
  let alive = 0;
  for (const e of game.entities) if (isEnemy(e) && e.state !== 'dead') alive++;
  enemiesHud.textContent = `${alive}${w.phase === 'active' && w.budgetLeft > 0 ? '+' : ''} NEMICI`;
  // Frames per second, averaged (exponential average: each frame moves it 5%
  // of the way), otherwise the number jitters too fast to read. dt = 0 while paused.
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  fpsHud.textContent = `${Math.round(fps)} FPS`;
  updateEventLine(game);
  // Speed on the ground (m/s), the number to watch when bunny hopping.
  speedHud.textContent = `${horizontalSpeed(player).toFixed(1)} m/s`;
  // The banner is free: the next queued message, if any (before the countdown: it doesn't queue).
  if (bannerTime <= 0 && bannerQueue.length > 0) {
    const next = bannerQueue.shift()!;
    showBanner(next.title, next.sub, next.seconds);
    next.sound();
  }
  // The countdown for the whole break (as soon as "ONDATA SUPERATA" is gone),
  // with the key that skips it (the 'skipBreak' action, keybinds.ts).
  if (w.phase === 'break' && w.number > 0 && bannerTime <= 0) {
    // A new stamp only when the digit changes, not every frame.
    const n = Math.ceil(w.breakTicks / 60);
    if (n !== countdownShown) {
      setBanner(String(n), `prossima ondata tra · ${mainKeyName('skipBreak')} per iniziare subito`, 'countdown');
      countdownShown = n;
    }
    banner.style.opacity = '0.85';
  } else {
    countdownShown = -1;
    bannerTime = Math.max(0, bannerTime - dt);
    banner.style.opacity = String(Math.min(1, bannerTime));
  }

  updateStyleMeter(game.style, dt);
  updateStyleFeed(events, dt);
  updateHighNoon(game.style, events, dt);

  // The max is the player's: the barman's drinks change it (drinks.ts).
  const max = maxHealth(player);
  updateLowHealth(player.health / max, player.health <= 0, dt); // first: it moves the heartbeat
  updateHealthPlate(player.health, max, dt);

  // Red vignette: a flash on each hit (low health has its own effect, lowHealth.ts).
  flash = Math.max(0, flash - dt * FLASH_FADE);
  updateHurtArcs(player, dt);
  damage.style.opacity = String(flash);

  pickupTime = Math.max(0, pickupTime - dt * 5); // gone in 0.2 s
  pickupFlash.style.opacity = String(pickupTime * 0.35);

}

/**
 * The map event in progress, under the wave: its name, and where you are
 * with it. Bells: before the first one, where to start; then which bell and
 * the clock (m:ss), red in the last seconds. Hidden with no event.
 */
function updateEventLine(game: GameState): void {
  const ev = game.mapEvent.active;
  eventLine.hidden = !ev;
  if (!ev) return;
  eventName.textContent = MAP_EVENT_TEXT[ev.kind].title;
  // The wager has no clock: what's on the table, then the curse you're playing with.
  if (ev.kind === 'wager') {
    const curse = WAGER_CURSE_TEXT[ev.curse].name;
    eventGoal.textContent =
      ev.phase === 'offered'
        ? `IN PALIO: ${curse} · vai al tavolo nella piazza`
        : ev.phase === 'accepted'
          ? `SCOMMESSA FATTA · prossima ondata: ${curse}`
          : `${curse} · sopravvivi all’ondata`;
    eventGoal.classList.toggle('hurry', ev.phase === 'cursed');
    return;
  }
  // The bounty has no clock either: who, what kind, and how far. Red when
  // the wave is about to end (it gets away).
  if (ev.kind === 'bounty') {
    const name = outlawName(ev.nameSeed).toUpperCase();
    const outlaw = bountyEntity(ev, game);
    if (ev.phase === 'posted' || !outlaw) {
      eventGoal.textContent = `${name} · sta arrivando in città`;
      eventGoal.classList.remove('hurry');
    } else {
      const p = game.player;
      const meters = Math.round(Math.hypot(outlaw.x - p.x, outlaw.y - p.y, outlaw.z - p.z));
      eventGoal.textContent = `${name} · ${BOUNTY_MODIFIER_TEXT[ev.modifier].name} · ${meters} m`;
      // The others are almost all dead: the wave ends with the last of them, and the outlaw leaves.
      let others = 0;
      for (const e of game.entities) if (isEnemy(e) && e.state !== 'dead' && !e.bounty) others++;
      eventGoal.classList.toggle('hurry', game.wave.budgetLeft === 0 && game.wave.smithsPending === 0 && others <= BOUNTY_HURRY);
    }
    return;
  }
  if (ev.ticksLeft < 0) {
    eventGoal.textContent = ev.kind === 'bells' ? 'suona la campana che brilla' : 'attraversa il primo anello';
    eventGoal.classList.remove('hurry');
    return;
  }
  const seconds = Math.ceil(ev.ticksLeft / 60);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  eventGoal.textContent =
    ev.kind === 'bells'
      ? `CAMPANA ${ev.rung + 1} / ${ev.bells.length} · ${clock}`
      : `ANELLO ${ev.passed + 1} / ${ev.rings.length} · ${clock}`;
  // The Pony Express clock never goes over 15 s: red only at the very end (like its ring's flicker).
  eventGoal.classList.toggle('hurry', seconds <= (ev.kind === 'ponyExpress' ? PONY_HURRY : EVENT_HURRY));
}
