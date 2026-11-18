# High Noon Hell

Boomer shooter per browser, ambientazione **dark western / dark fantasy con tocchi steampunk**.
Armi: revolver, canne mozze, lazo/rampino. Progetto personale tra amici: semplicità prima di tutto.

## ⚠️ Regola principale: sviluppiamo insieme, l'obiettivo è imparare
L'utente è un web developer (Laravel/JS) che usa questo progetto per **imparare** game dev,
Three.js, netcode, ecc. Il codice prodotto conta meno della sua comprensione.
- **Passi piccoli**: un pezzo alla volta (una funzione, un sistema minimo), mai feature intere in un colpo solo.
- **Spiega sempre il lato tecnico** di ciò che scrivi: cosa fa, perché è fatto così,
  quali concetti c'entrano (es. game loop, matrici, collisioni, predizione), alternative scartate.
- Collega i concetti nuovi a ciò che l'utente conosce già dal web development, quando possibile.
- Dopo ogni passo **fermati** e lascia che l'utente provi, faccia domande o lo scriva lui.
  Proponi il passo successivo, non implementarlo di tua iniziativa.
- Se un passo richiederebbe molto codice, scomponilo e proponi l'ordine.
- **Le implementazioni le fa Claude**: niente esercizi o parti lasciate da scrivere all'utente.
- Indica invece **dove mettere le mani**: in quale file stanno i parametri di tuning e le config,
  in quale cartella vanno texture/modelli/suoni, cosa modificare per cambiare un comportamento.
  Tieni aggiornata la sezione "Dove trovare le cose" qui sotto.
- Niente codice "magico" o librerie che nascondono ciò che si vuole imparare, salvo accordo esplicito.

## Obiettivi
- **v1**: modalità a orde singleplayer (stile Megabonk), giocabile come sito statico.
- **Poi**: arena multiplayer con server autoritativo Node.js (TypeScript) e WebSocket.
  Il codice va scritto fin da ora pensando a questo (vedi Architettura).

## Stack
- Vite + TypeScript (strict) + Three.js. Nessun framework UI: HUD e menu in HTML/CSS sopra il canvas.
- Niente motore fisico generico per il giocatore: controller cinematico custom in stile Quake.

## Comandi
- `npm run dev`: server di sviluppo
- `npm run build`: typecheck + build di produzione (deve passare prima di ogni commit)

## Dove trovare le cose
Mappa per l'utente, da aggiornare ogni volta che si aggiunge un file/cartella rilevante.
- `src/main.ts`: entry point (renderer, scena, luci, oggetti di prova, game loop a passo fisso + interpolazione camera)
- `src/input.ts`: input grezzo (tasti premuti, movimento mouse, Pointer Lock)
- `src/controls.ts`: sensibilità mouse, angoli di vista, mappatura tasti → `InputCommand`
- `src/sim/`: simulazione pura (niente Three.js/DOM)
  - `config.ts`: **costanti di tuning** (tick rate, velocità, altezza occhi)
  - `command.ts`: tipo `InputCommand` (cosa vuole fare il giocatore in un tick)
  - `player.ts`: stato del giocatore e `stepPlayer()` (movimento per tick)
- `index.html`: pagina che ospita il canvas e l'overlay "Click to play"
- `vite.config.ts`: config del dev server e della build

## Architettura (regole)
- **Simulazione separata dal rendering**: la logica di gioco (giocatore, nemici, proiettili,
  collisioni) è TypeScript puro, senza import di Three.js né accesso al DOM.
  Il rendering legge lo stato e lo disegna; non lo modifica.
- **Passo fisso**: la simulazione avanza a tick fissi; il rendering interpola tra due tick.
- **Input come comandi**: ogni tick riceve un comando di input (tasti, angoli di vista, numero tick),
  mai letture dirette di tastiera/mouse dentro la simulazione.
- **Stato serializzabile**: entità come dati semplici, così un giorno girano su un server.
- Costanti di tuning (velocità, attriti, danni) raccolte in un unico posto, modificabili a runtime da pannello debug.

## Stile visivo (riferimento: Prodeus)
- Geometria relativamente dettagliata ma render a **bassa risoluzione** ingrandito con `NearestFilter`.
- Texture piccole (32–64 px), senza filtro; palette limitata con dithering in post-process.
- Atmosfera scura: nebbia, luci calde di lanterne/fuoco, cielo infernale rosso-arancio.
- Nemici come sprite 2D (stile Doom) per prestazioni e look.

## Feel del gameplay
- Movimento **veloce e snappy**: accelerazione a terra alta, attrito alto, air-strafe, bhop,
  slide, slide-jump, wall jump, coyote time, jump buffer. Niente smoothing sull'input.
- Il feel conta più delle feature: preferire meno cose ma ben tarate.

## Convenzioni
- Codice, nomi e commenti in inglese; comunicazione con l'utente in italiano.
- Commit e push **direttamente su `main`**, un commit per passo: l'utente fa solo `git pull`.
  Branch solo per esperimenti grossi o se richiesto esplicitamente.
- Asset generati via codice o con licenza libera; niente asset di altri giochi.
