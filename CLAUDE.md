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
- `src/main.ts`: entry point (renderer, scena, luci, caricamento livello, game loop a passo fisso + interpolazione camera).
  Debug: `?pos=x,y,z&look=yaw,pitch` nell'URL per partire da un punto preciso
- `src/input.ts`: input grezzo (tasti premuti, movimento mouse, Pointer Lock)
- `src/controls.ts`: sensibilità mouse (`controlSettings`), angoli di vista, **mappatura tasti** (WASD, Spazio, Shift/C = accovacciati/slide, R = respawn) → `InputCommand` (T = cambia atmosfera, P = pixel art on/off, tasto sotto Esc = pannello debug, in `main.ts`)
- `src/sim/`: simulazione pura (niente Three.js/DOM)
  - `config.ts`: **valori di tuning** (oggetto `tuning`, modificabile dal pannello debug) (tick rate, altezza occhi, dimensioni giocatore, movimento a terra, gravità/salto/coyote/buffer, movimento in aria, accovacciata, slide, wall jump)
  - `command.ts`: tipo `InputCommand` (cosa vuole fare il giocatore in un tick)
  - `world.ts`: tipi del livello (`Box` AABB, `Prop` decorazioni, `World`) e helper `box()`
  - `props.ts`: **box di collisione invisibili dei props** (barile, palo del cartello, torcia)
  - `collision.ts`: movimento con collisioni asse per asse contro i box, `overlapsAny` (c'è spazio?), `findWall` (muro vicino?)
  - `player.ts`: stato del giocatore e `stepPlayer()` (salto, slide/accovacciata, wall jump, attrito, accelerazione Quake a terra/in aria, gravità, respawn)
- `src/debug/`: pannello di debug
  - `panel.ts`: mini-libreria DOM per i controlli (slider, checkbox, colori, "Copy values")
  - `debugPanel.ts`: **quali valori sono esposti nel pannello** e i loro range
- `src/levels/`: **i livelli** (dati puri)
  - `testArena.ts`: arena di prova 40×40 (piattaforma, scale, corridoio, colonne, casse, trave bassa per lo slide) + **props** (lista `props` in cima al file)
- `src/render/`: effetti puramente visivi (non toccano la simulazione)
  - `landingDip.ts`: abbassamento camera all'atterraggio (intensità, recupero)
  - `cameraFeel.ts`: **FOV con la velocità, inclinazione (roll) in strafe/slide, altezza occhi morbida** (`cameraFeelSettings`)
  - `atmospheres.ts`: **preset di atmosfera** (High Noon / High Midnight): colori cielo, sole/luna, stelle, luce del sole, lanterne, particelle, nebbia (distanza + al suolo), god rays, luce ambientale
  - `sky.ts`: cielo (sfera + shader GLSL)
  - `sunLight.ts`: luce direzionale dal sole/luna + **ombre** (area coperta, risoluzione, bias)
  - `fireLights.ts`: luce, alone e tremolio di ogni fiamma (torce, lanterne)
  - `props/`: **modelli procedurali dei props** (geometrie + texture pixel art generate via codice)
    - `barrel.ts`, `sign.ts`, `torch.ts`, `lantern.ts`, `grass.ts`: un file per prop, misure in costanti in cima
    - `textures.ts`: **palette** e texture generate (legno, ferro, ottone, fiamma, erba, insegne)
    - `pixelCanvas.ts`: strumenti per disegnare pixel (random con seed, `shade`, `mixColor`)
    - `pixelFont.ts`: font bitmap 3×5 per le scritte
    - `common.ts`: mattoncini comuni (materiale, box texturizzati, fiamma animata)
    - `index.ts`: costruisce tutti i props di un livello
  - `postprocess.ts`: **pipeline di post-processing** (`postSettings`: risoluzione pixel, livelli di colore, dithering, bloom, god rays)
  - `particles.ts`: **particelle** (polvere/lucciole attorno alla camera, braci dalle lanterne)
  - `heightFog.ts`: nebbia al suolo (patch dello shader della nebbia di Three.js)
  - `materials.ts`: **quale texture usa ogni materiale** (`LOOKS`), densità dei pixel, mesh dei box
- `public/textures/`: texture PNG (servite così come sono da Vite su `/textures/...`)
- `CREDITS.md`: autori e licenze degli asset
- `index.html`: pagina con canvas, overlay "Click to play" e HUD (stili CSS inclusi)
- `vite.config.ts`: config del dev server e della build (`base: './'` per funzionare in sottocartella su GitHub Pages)
- `.github/workflows/deploy.yml`: **deploy automatico su GitHub Pages** a ogni push su `main`.
  Gli asset in `public/` vanno referenziati con `import.meta.env.BASE_URL` (mai `/...` assoluto)

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
- **L'atmosfera è una priorità del progetto**: luci, nebbia, particelle e cielo devono essere curati
  e d'impatto (anche a costo di passi dedicati solo alla resa visiva). Due preset: High Noon e High Midnight.
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
