// The leaderboard as table rows: used by the menu ("Classifica") and by the
// end-of-game screen. Your rows are highlighted (class "mine", CSS in
// index.html); if your best score is not among the rows shown, it's added at
// the bottom after a "…" row, with its real position.
import { fetchEntry, fetchTop, isMine, myBestId, type ScoreEntry } from '../leaderboard';

/** A row to show: an entry and its position. */
interface ShownRow {
  entry: ScoreEntry;
  rank: number;
}

/**
 * Asks the server and fills the table body. Shows "loading" first, and a
 * message if the server can't be reached. `limit` = how many of the top rows.
 */
export async function fillScoreTable(body: HTMLElement, limit: number): Promise<void> {
  body.replaceChildren(message('carico la classifica…'));
  try {
    const top = (await fetchTop()).slice(0, limit);
    if (top.length === 0) {
      body.replaceChildren(message('nessuna partita, ancora'));
      return;
    }
    const rows: ShownRow[] = top.map((entry, i) => ({ entry, rank: i + 1 }));
    // Your best isn't in the top rows: one more request for it and its position.
    const best = myBestId();
    let yours: ShownRow | null = null;
    if (best !== null && !top.some((e) => e.id === best)) {
      try {
        const entry = await fetchEntry(best);
        yours = { entry, rank: entry.rank };
      } catch {
        // Gone or the server is old: just the top rows.
      }
    }
    body.replaceChildren(
      ...rows.map(tableRow),
      ...(yours ? [message('…'), tableRow(yours)] : []),
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
function tableRow({ entry, rank }: ShownRow): HTMLTableRowElement {
  const tr = document.createElement('tr');
  if (rank === 1) tr.classList.add('first');
  if (isMine(entry.id)) tr.classList.add('mine');
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
