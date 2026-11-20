// The end-of-game screen, CoD Zombies style: "SEI MORTO", the wave you
// reached, the game's statistics counted up one by one, and the leaderboard
// with your placement. The game stays frozen behind it (main.ts) until you
// press Space/Enter or "Ricomincia" (a new game, mouse grabbed again) or
// Esc/"Menu".
//
// Plain DOM: markup and CSS in index.html (#death). Timings in constants below.
import { playBell } from '../audio/sfx';
import type { Placement } from '../leaderboard';
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
/** Rows in the leaderboard box (your best is added below if it's further down). */
const BOARD_ROWS = 5;

/** What the screen needs to know about the game that just ended. */
export interface GameOver {
  wave: number;
  stats: Stats;
  /** Why it's a practice game (not sent), or null. */
  practice: string | null;
  /** The answer of the leaderboard (null = no answer), or null if nothing was sent. */
  placement: Promise<Placement | null> | null;
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

      // The leaderboard box: first what happened to this score, then the table
      // (asked AFTER the submit is answered, so your new row is in it).
      placementLine.className = '';
      board.replaceChildren();
      if (game.practice) {
        placementLine.textContent = `PARTITA DI PROVA · NON IN CLASSIFICA (${game.practice})`;
        void fillScoreTable(board, BOARD_ROWS);
      } else if (!game.placement) {
        placementLine.textContent = 'NESSUN PUNTO, NIENTE CLASSIFICA';
        void fillScoreTable(board, BOARD_ROWS);
      } else {
        placementLine.textContent = 'INVIO IL PUNTEGGIO…';
        game.placement
          .then((p) => {
            if (id !== gameId) return; // another game ended meanwhile
            if (!p) placementLine.textContent = '';
            else if (p.rank === 1) {
              placementLine.textContent = 'NUOVO RECORD!';
              placementLine.className = 'record';
            } else placementLine.textContent = `${p.rank}° POSTO SU ${p.total}`;
          })
          .catch(() => {
            if (id === gameId) placementLine.textContent = 'CLASSIFICA NON RAGGIUNGIBILE';
          })
          .finally(() => {
            if (id === gameId) void fillScoreTable(board, BOARD_ROWS);
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
