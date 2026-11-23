# Server della classifica (Cloudflare Worker + D1)

Un Worker (`src/index.ts`) con le route `GET /scores`, `GET /scores/player`, `POST /scores` e
`PATCH /scores/:id` (rinomina la partita appena giocata, dalla schermata di fine partita), e un database
SQLite gestito da Cloudflare (D1). Piano gratuito: 100.000 richieste al giorno.
Il gioco resta un sito statico su GitHub Pages; questo è un pezzo a parte, con le sue dipendenze.

## Prima volta (una sola volta, dal tuo PC)
Tutti i comandi dalla cartella `server/`.

1. Installa le dipendenze:
   `npm install`
2. Collega wrangler al tuo account Cloudflare (apre il browser):
   `npx wrangler login`
3. Crea il database:
   `npx wrangler d1 create hnh-leaderboard`
   Stampa un `database_id`: copialo in `wrangler.jsonc` al posto di `PASTE-THE-DATABASE-ID-HERE`
   (non è un segreto: senza il tuo login non serve a niente) e fai commit.
4. Pubblica:
   `npm run deploy`
   Crea la tabella (le migrazioni in `migrations/`) e carica il Worker. La prima volta ti chiede
   di scegliere un sottodominio `*.workers.dev`. Alla fine stampa l'indirizzo del Worker,
   tipo `https://hnh-leaderboard.<tuo-sottodominio>.workers.dev`: è quello che serve al gioco.
5. Prova: apri `https://hnh-leaderboard.<tuo-sottodominio>.workers.dev/scores` nel browser: deve rispondere `[]`.
6. Il secret che firma le "ricevute" per rinominare una partita (senza, la rinomina è spenta e il
   nuovo nome vale solo dalla partita dopo):
   `npx wrangler secret put RENAME_SECRET`
   e incolla una stringa lunga a caso (es. l'output di `node -e "console.log(crypto.randomUUID())"`).
   Come `APP_KEY` di Laravel: non va mai nel repo, e cambiarlo invalida solo le ricevute già date.
   In locale (`npm run dev`) lo legge da `server/.dev.vars` (ignorato da git), una riga: `RENAME_SECRET=qualcosa`.

## Dopo
- Ogni modifica al server: `npm run deploy`.
- Provarlo in locale (database finto sul tuo PC, in `.wrangler/`): `npm run dev` → `http://localhost:8787/scores`.
- Una tabella o colonna nuova: un nuovo file in `migrations/` (`0002_...sql`), mai modificare quelli già applicati.
- Vedere i dati: `npx wrangler d1 execute hnh-leaderboard --remote --command "SELECT * FROM scores ORDER BY score DESC"`.
  Cancellare un punteggio finto: stesso comando con `DELETE FROM scores WHERE id = ...`.
- Log in tempo reale del Worker: `npx wrangler tail`.
