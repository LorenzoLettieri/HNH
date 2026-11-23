// The end-of-game screen, CoD Zombies style: "SEI MORTO", the wave you
// reached, the game's statistics counted up one by one, and the leaderboard
// with your placement. The game stays frozen behind it (main.ts) until you
// press Space/Enter or "Ricomincia" (a new game, mouse grabbed again) or
// Esc/"Menu".
//
// The name box ("GIOCHI COME"): the score was already sent when the screen
// opens, under your current name (maybe a random one, randomName.ts). Changing
// it here saves the new name AND moves this game to it on the server, with the
// receipt the submit answered (renameScore in leaderboard.ts).
//
// Plain DOM: markup and CSS in index.html (#death). Timings in constants below.
import { playBell } from '../audio/sfx';
import { NAME_MAX_LENGTH, renameScore, type RankResult, type SubmitResult } from '../leaderboard';
import { set, settings } from '../settings';
import { STYLE_RANKS } from '../sim/style';
import type { Stats } from '../sim/stats';
import { TICK_DT } from '../sim/config';
import { fillScoreTable } from './scoreTable';

/** Seconds before the first stat row appears (the title sinks in first). */
const FIRST_ROW_DELAY = 0.9;
/** Seconds between one stat row and the next. */
const ROW_GAP = 0.22;
/** Seconds a number takes to count up to its value. */
const COUNT_TIME = 0.6;
/** Seconds before Space/Enter can close it: you were probably pressing Space when you died. */
const INPUT_DELAY = 1.2;
/** Players in the leaderboard box (you're added below if you're further down). */
const BOARD_ROWS = 8;

/** What the screen needs to know about the game that just ended. */
export interface GameOver {
  wave: number;
  stats: Stats;
  /** Your nickname: your row in the leaderboard. */
  playerName: string;
  /** Why it's a practice game (not sent), or null. */
  practice: string | null;
  /** The answer of the leaderboard (null = no answer), or null if nothing was sent. */
  placement: Promise<SubmitResult | null> | null;
}

export interface EndScreen {
  open(game: GameOver): void;
  close(): void;
  readonly isOpen: boolean;
  /** Can a key close it yet? (see INPUT_DELAY) */
  readonly acceptsInput: boolean;
}

export function createEndScreen(options: { onRestart: () => void; onMenu: () => void }): EndScreen {
  const root = document.getElementById('death')!;
  const survived = document.getElementById('death-survived')!;
  const statsList = document.getElementById('death-stats')!;
  const placementLine = document.getElementById('death-placement')!;
  const board = document.getElementById('death-board')!;
  document.getElementById('death-restart')!.addEventListener('click', () => options.onRestart());
  document.getElementById('death-menu')!.addEventListener('click', () => options.onMenu());

  let open = false;
  let openedAt = 0;
  /** Bumped at every open: an answer from the server for an older game is ignored. */
  let gameId = 0;
  /** The game on screen: the name its score is saved under on the server... */
  let sentName = '';
  /** ...the server's answer with the rename receipt (null = not sent, or no answer)... */
  let receipt: SubmitResult | null = null;
  /** ...and whether that answer is still on its way. */
  let waiting = false;

  const refreshBoard = (): void => void fillScoreTable(board, BOARD_ROWS, settings.playerName);

  /** The line above the table: what happened to this game's score. */
  function showPlacement(p: RankResult | null): void {
    placementLine.className = '';
    // One row per player: a game that isn't your best doesn't move you.
    if (!p) placementLine.textContent = '';
    else if (p.personalBest && p.rank === 1) {
      placementLine.textContent = 'NUOVO RECORD!';
      placementLine.className = 'record';
    } else if (p.personalBest) placementLine.textContent = `RECORD PERSONALE · ${p.rank}° SU ${p.total}`;
    else placementLine.textContent = `IL TUO RECORD RESTA ${p.rank}° SU ${p.total}`;
  }

  /** The name changed: if this game was sent under another name, move it (then the table). */
  async function moveScore(): Promise<void> {
    const id = gameId;
    const name = settings.playerName;
    if (receipt && name !== sentName) {
      placementLine.className = '';
      placementLine.textContent = 'CAMBIO NOME…';
      try {
        if (!receipt.token) throw new Error('no receipt'); // the server can't rename (old version, no secret)
        const p = await renameScore(receipt, name);
        if (id !== gameId) return;
        sentName = name;
        showPlacement(p);
      } catch {
        // The name is saved anyway (settings): it just counts from the next game.
        if (id === gameId) placementLine.textContent = 'IL NUOVO NOME VALE DALLA PROSSIMA PARTITA';
      }
    }
    if (id === gameId) refreshBoard(); // your row, highlighted under the new name
  }

  // --- The name box -----------------------------------------------------------
  // Same rules as the menu's (menu.ts): 'change' = when you leave the box or
  // press Enter; empty = a new random name. Keys typed here don't reach the
  // game (isTypingInField in input.ts): Space doesn't restart while you type.
  const nameBox = document.getElementById('death-name-box') as HTMLInputElement;
  nameBox.maxLength = NAME_MAX_LENGTH;
  nameBox.placeholder = 'Vuoto = nome a caso';
  nameBox.addEventListener('change', () => {
    set('playerName', nameBox.value);
    nameBox.value = settings.playerName;
    // Still waiting for the submit: its answer will see the new name and move it.
    if (open && !waiting) void moveScore();
  });
  // Enter or Esc = done: leave the box, so the next Space/Enter restarts the game.
  nameBox.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Escape') nameBox.blur();
  });

  return {
    get isOpen() {
      return open;
    },
    get acceptsInput() {
      return open && performance.now() - openedAt > INPUT_DELAY * 1000;
    },
    open(game) {
      open = true;
      openedAt = performance.now();
      const id = ++gameId;
      root.hidden = false;
      // Restart the CSS animations (title, rows): see restartAnimation in hud.ts.
      root.classList.remove('show');
      void root.offsetWidth;
      root.classList.add('show');
      playBell(1, 90); // one deep, slow toll: a funeral bell

      survived.textContent = game.wave === 0 ? 'NON HAI VISTO NEMMENO LA PRIMA ONDATA' : `SEI ARRIVATO ALL'ONDATA ${game.wave}`;
      showStats(statsList, game.stats);

      // The leaderboard box: your name, what happened to this score, then the
      // table (asked AFTER the submit is answered, so your new row is in it).
      nameBox.value = game.playerName;
      sentName = game.playerName;
      receipt = null;
      waiting = false;
      placementLine.className = '';
      board.replaceChildren();
      if (game.practice) {
        placementLine.textContent = `PARTITA DI PROVA · NON IN CLASSIFICA (${game.practice})`;
        refreshBoard();
      } else if (!game.placement) {
        placementLine.textContent = 'NESSUN PUNTO, NIENTE CLASSIFICA';
        refreshBoard();
      } else {
        placementLine.textContent = 'INVIO IL PUNTEGGIO…';
        waiting = true;
        game.placement
          .then((p) => {
            if (id !== gameId) return; // another game ended meanwhile
            waiting = false;
            receipt = p;
            // Renamed while the submit was on its way: move the game now.
            if (p && settings.playerName !== sentName) return moveScore();
            showPlacement(p);
            refreshBoard();
          })
          .catch(() => {
            if (id !== gameId) return;
            waiting = false;
            placementLine.textContent = 'CLASSIFICA NON RAGGIUNGIBILE';
            refreshBoard();
          });
      }
    },
    close() {
      open = false;
      root.hidden = true;
    },
  };
}

/** One line of the stats: label, final value, and how to write it while it counts up. */
interface StatRow {
  label: string;
  value: number;
  format: (n: number) => string;
}

function showStats(list: HTMLElement, s: Stats): void {
  const whole = (n: number): string => String(Math.round(n));
  const rows: StatRow[] = [
    { label: 'PUNTI', value: s.score, format: whole },
    { label: 'UCCISIONI', value: s.kills, format: whole },
    { label: 'COLPI ALLA TESTA', value: s.headshots, format: whole },
    { label: 'PRECISIONE', value: s.shots > 0 ? (100 * s.shotsHit) / s.shots : 0, format: (n) => `${Math.round(n)}%` },
    { label: 'VILDENARO RACCOLTO', value: s.moneyEarned, format: whole },
    { label: 'HIGH NOON', value: s.highNoons, format: whole },
    { label: 'TEMPO', value: s.ticks * TICK_DT, format: clock },
  ];
  list.replaceChildren();
  rows.forEach((row, i) => {
    const delay = FIRST_ROW_DELAY + i * ROW_GAP;
    const number = statLine(list, row.label, delay);
    countUp(number, row, delay);
  });
  // The best style rank isn't a number: its letter, no counting.
  const rank = STYLE_RANKS[s.bestRank];
  statLine(list, 'STILE MASSIMO', FIRST_ROW_DELAY + rows.length * ROW_GAP).textContent = `${rank.letter} · ${rank.name}`;
}

/**
 * One row: label on the left, value on the right. The row slides in after
 * `delay` seconds (CSS animation-delay, set from here: one stylesheet rule,
 * a different delay per row). Returns the value cell.
 */
function statLine(list: HTMLElement, label: string, delay: number): HTMLElement {
  const line = document.createElement('div');
  line.className = 'death-row';
  line.style.animationDelay = `${delay}s`;
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'death-value';
  line.append(name, value);
  list.appendChild(line);
  return value;
}

/**
 * The number runs from 0 to its value, like a tally. requestAnimationFrame
 * calls us before every screen refresh; "eased" = fast at first, slow at the
 * end (1 − (1 − t)³), so it lands softly on the final value.
 */
function countUp(cell: HTMLElement, row: StatRow, delay: number): void {
  cell.textContent = row.format(0);
  const start = performance.now() + delay * 1000;
  const frame = (now: number): void => {
    const t = Math.min(1, Math.max(0, (now - start) / (COUNT_TIME * 1000)));
    cell.textContent = row.format(row.value * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Seconds → "m:ss". */
function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
