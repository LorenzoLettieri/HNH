// The leaderboard as table rows: used by the menu ("Classifica") and by the
// end-of-game screen. One row per player (the server keeps only each name's
// best). Your row (your nickname) is highlighted (class "mine", CSS in
// index.html); if it's not among the rows shown, it's added at the bottom
// after a "…" row, with its real position.
import { fetchPlayer, fetchTop, samePlayer, type ScoreEntry } from '../leaderboard';

/** A row to show: an entry and its position. */
interface ShownRow {
  entry: ScoreEntry;
  rank: number;
}

/**
 * Asks the server and fills the table body. Shows "loading" first, and a
 * message if the server can't be reached. `limit` = how many of the top rows.
 */
export async function fillScoreTable(body: HTMLElement, limit: number, playerName: string): Promise<void> {
  body.replaceChildren(message('carico la classifica…'));
  try {
    const top = (await fetchTop(limit)).slice(0, limit);
    if (top.length === 0) {
      body.replaceChildren(message('nessuna partita, ancora'));
      return;
    }
    const mine = (e: ScoreEntry): boolean => samePlayer(e.name, playerName);
    const rows: ShownRow[] = top.map((entry, i) => ({ entry, rank: i + 1 }));
    // You're not in the top rows: one more request for your best and its position.
    let yours: ShownRow | null = null;
    if (!top.some(mine)) {
      try {
        const entry = await fetchPlayer(playerName);
        yours = { entry, rank: entry.rank };
      } catch {
        // Never played with this name (or the server is old): just the top rows.
      }
    }
    body.replaceChildren(
      ...rows.map((r) => tableRow(r, mine(r.entry))),
      ...(yours ? [message('…'), tableRow(yours, true)] : []),
    );
  } catch {
    body.replaceChildren(message('classifica non raggiungibile'));
  }
}

/**
 * One table row. textContent, never innerHTML: names are typed by players,
 * and a name like "<img onerror=...>" in innerHTML would run as code (XSS,
 * the same reason Blade escapes {{ }} by default).
 */
function tableRow({ entry, rank }: ShownRow, mine: boolean): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (rank === 1) tr.classList.add('first');
  if (mine) tr.classList.add('mine');
  for (const text of [`${rank}`, entry.name, `${entry.wave}`, `${entry.score}`]) {
    tr.appendChild(document.createElement('td')).textContent = text;
  }
  return tr;
}

/** A row with just a message in the name column. */
function message(text: string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'note';
  for (const t of ['', text, '', '']) tr.appendChild(document.createElement('td')).textContent = t;
  return tr;
}
