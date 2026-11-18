# High Noon Hell

Boomer shooter per browser, ambientazione **dark western / dark fantasy con tocchi steampunk**.
Armi: revolver, canne mozze, lazo/rampino. Progetto personale tra amici: semplicità prima di tutto.

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
- Lavorare su un branch per feature; non fare push su `main` senza richiesta esplicita.
- Asset generati via codice o con licenza libera; niente asset di altri giochi.
