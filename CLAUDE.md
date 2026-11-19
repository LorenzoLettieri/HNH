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

## Design del gioco
Le decisioni di gameplay (stile, nemici, mappa, loop) sono in **`docs/DESIGN.md`**: leggilo
prima di lavorare su gameplay, nemici, armi o livelli, e aggiornalo quando si decide qualcosa.
In sintesi: il **movimento è il cuore del gioco**; meter dello **Stile** a rank (niente punizioni
per chi sta fermo); nemici che attaccano lo spazio (anche volanti e a distanza); mappa all'aperto
(cittadina infernale, verticale, anche assurda/distopica).

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
- `src/main.ts`: entry point (renderer, scena, luci, caricamento livello, game loop a passo fisso + interpolazione camera,
  **indicatore prestazioni**: fps, ms simulazione/disegno, draw call).
  Debug: `?pos=x,y,z&look=yaw,pitch` nell'URL per partire da un punto preciso; `?level=arena` per l'arena di prova;
  `?seed=123` per rigiocare la stessa sequenza di ondate (il seed di ogni partita è scritto nella console del browser)
- `src/input.ts`: input grezzo (tasti e tasti del mouse premuti, pressioni brevi "memorizzate", movimento mouse, Pointer Lock)
- `src/controls.ts`: sensibilità mouse (`controlSettings`), angoli di vista, **mappatura tasti** (WASD, Spazio, Shift/C = accovacciati/slide, click = spara, R = ricarica, K = respawn) → `InputCommand` (T = cambia atmosfera, P = pixel art on/off, N = grafo IA, **B = fai apparire un Malocchio** (debug), tasto sotto Esc = pannello debug, in `main.ts`)
- `src/sim/`: simulazione pura (niente Three.js/DOM)
  - `config.ts`: **valori di tuning** (oggetto `tuning`, modificabile dal pannello debug) (tick rate, altezza occhi, salute, **ondate**, dimensioni giocatore, movimento a terra, gravità/salto/coyote/buffer, movimento e controllo in aria, aiuti al bhop, accovacciata, slide, wall jump, **revolver**, bersagli, **ghoul**, **Malocchio** (anche sparo: carica, intervallo, velocità/danno della palla di fuoco), **proiettili nemici**)
  - `game.ts`: **stato di gioco unico** (`GameState`: giocatore, entità, **proiettili nemici**, ondata, statistiche) e `stepGame()` (un tick di tutto il gioco; game over alla morte)
  - `entities.ts`: **entità colpibili** (bersagli, ghoul, Malocchio): dati, salute, danno, hitbox
  - `ghoul.ts`: **IA del ghoul** (segue il flow field: cammina, salta con traiettoria balistica, si lascia cadere, **si arrampica**; da vicino inseguimento diretto con salto/aggiramento; separazione; artigliata con finestra per schivare)
  - `eyebat.ts`: **IA del Malocchio** (occhio-pipistrello volante: orbita attorno al giocatore a distanza e quota fisse, steering 3D, separazione, sale sopra gli ostacoli; **sparo**: macchina a stati volo → carica (preavviso, rallenta) → palla di fuoco, solo con linea di vista; da morto cade)
  - `projectiles.ts`: **proiettili nemici** (palle di fuoco lente: movimento a ogni tick, collisione col livello lungo il segmento percorso, sfera contro il box del giocatore, danno e spinta)
  - `nav.ts`: **grafo di navigazione** generato dai box (nodi ogni 1,5 m, link cammina/salta/cadi/arrampicati/**sfiatatoio** (lancio simulato in anticipo), limiti di salto/caduta/arrampicata) e **flow field** (Dijkstra dal giocatore)
  - `waves.ts`: **ondate stile CoD Zombies** con **budget di peso**: ogni nemico ha un costo (`ghoulCost`, `eyebatCost` in `config.ts`), ogni ondata un budget (`waveBudget`), e a ogni spawn si sceglie un tipo a caso tra quelli che il budget si può permettere. **`ROSTER`** = elenco dei nemici delle ondate (aggiungere un nemico = aggiungere una riga). Curva di difficoltà (budget, peso vivo insieme, **salute a gradini** `healthForWave`, corridori, intervallo di spawn) e **punteggio**
  - `random.ts`: **numeri casuali con seed** (mulberry32): deterministici, stato salvato nel `GameState` (`rng`)
  - `command.ts`: tipo `InputCommand` (cosa vuole fare il giocatore in un tick)
  - `world.ts`: tipi del livello (`Box` AABB, `Prop` decorazioni, `TargetSpawn` bersagli, `World`) e helper `box()`
  - `props.ts`: **box di collisione invisibili dei props** (barile, palo del cartello, torcia) e zona di lancio degli sfiatatoi
  - `weapon.ts`: revolver (sparo semi-automatico, munizioni, ricarica, hitscan, **colpo alla testa**, **colpo nella pupilla** del Malocchio)
  - `raycast.ts`: raggio contro i box (metodo degli "slab"): cosa colpisce un proiettile
  - `events.ts`: eventi della simulazione (sparo, colpo su un'entità, attacco del ghoul, carica/sparo del Malocchio, impatto di un proiettile, giocatore ferito/morto, colpo a vuoto, ricarica) per effetti e suoni
  - `collision.ts`: movimento con collisioni asse per asse contro i box, `overlapsAny` (c'è spazio?), `findWall` (muro vicino?)
  - `player.ts`: stato del giocatore e `stepPlayer()` (salto e bhop facilitato, slide/accovacciata, wall jump stile Apex, attrito, accelerazione Quake + air control, gravità, sfiatatoi, respawn)
- `src/debug/`: pannello di debug
  - `panel.ts`: mini-libreria DOM per i controlli (slider, checkbox, colori, "Copy values")
  - `debugPanel.ts`: **quali valori sono esposti nel pannello** e i loro range
- `src/levels/`: **i livelli** (dati puri)
  - `index.ts`: elenco dei livelli e livello di default
  - `town.ts`: **la cittadina** (mappa principale, greybox): edifici, torri, ponte, piattaforme sospese, sfiatatoi, **bersagli** (`targets`), **punti di spawn dei nemici** (`enemySpawns`); percorsi descritti in cima al file
  - `testArena.ts`: arena di prova 40×40 (piattaforma, scale, corridoio, colonne, casse, trave bassa per lo slide) + **props** (lista `props` in cima al file)
- `src/render/`: effetti puramente visivi (non toccano la simulazione)
  - `landingDip.ts`: abbassamento camera all'atterraggio (intensità, recupero)
  - `cameraFeel.ts`: **FOV con la velocità, inclinazione (roll) in strafe/slide, altezza occhi morbida** (`cameraFeelSettings`)
  - `atmospheres.ts`: **preset di atmosfera** (High Noon / High Midnight): colori cielo, sole/luna, stelle, luce del sole, lanterne, particelle, nebbia (distanza + al suolo), god rays, luce ambientale
  - `sky.ts`: cielo (sfera + shader GLSL)
  - `sunLight.ts`: luce direzionale dal sole/luna + **ombre** (area coperta, risoluzione, bias)
  - `fireLights.ts`: luce, alone e tremolio di ogni fiamma (torce, lanterne)
  - `props/`: **modelli procedurali dei props** (geometrie + texture pixel art generate via codice)
    - `barrel.ts`, `sign.ts`, `torch.ts`, `lantern.ts`, `grass.ts`, `vent.ts`: un file per prop, misure in costanti in cima
    - `textures.ts`: **palette** e texture generate (legno, ferro, ottone, fiamma, erba, insegne)
    - `pixelCanvas.ts`: strumenti per disegnare pixel (random con seed, `shade`, `mixColor`)
    - `pixelFont.ts`: font bitmap 3×5 per le scritte
    - `common.ts`: mattoncini comuni (materiale, box texturizzati, fiamma animata)
    - `index.ts`: costruisce tutti i props di un livello
  - `postprocess.ts`: **pipeline di post-processing** (`postSettings`: risoluzione pixel, livelli di colore, dithering, bloom, god rays)
  - `particles.ts`: **particelle** (polvere/lucciole, braci, vapore, scintille e sangue degli impatti)
  - `heightFog.ts`: nebbia al suolo (patch dello shader della nebbia di Three.js)
  - `weapons/`: **l'arma in mano (viewmodel)**
    - `viewmodel.ts`: scena/camera dell'arma, **posa, rinculo, ondeggiamento, bob, ricarica, lampo** (`viewmodelSettings`)
    - `revolverModel.ts`: modello procedurale del revolver (canna, tamburo, cane, calcio)
    - `hands.ts`: **mani a blocchi** (guanti, maniche) e **keyframe del fanning** della mano sinistra
  - `hud.ts`: barra della salute, vignetta rossa, **numero dell'ondata, punteggio, scritte di inizio/fine ondata e conto alla rovescia**, riepilogo alla morte
  - `projectiles.ts`: **palle di fuoco nemiche** (sprite pixel art luminoso, scia di braci, scintille e suono all'impatto)
  - `soundPosition.ts`: volume e panning di un suono in base alla posizione rispetto alla camera
  - `weaponFx.ts`: effetti degli spari (lampo di luce, fori, scintille, suoni)
  - `enemies/`: **i nemici**
    - `spriteSheet.ts`: strumenti comuni per gli sprite (`PixelFrame`: pixel, rettangoli, arti, triangoli, contorno; `buildSheet`: sprite sheet + maschera di glow)
    - `eyebatSprite.ts`: **sprite del Malocchio** (palette, ali, occhio con iride luminosa e pupilla, fotogrammi)
    - `eyebats.ts`: disegno dei Malocchi (billboard sferico, battito d'ali, **bagliore della carica**, suoni, morte)
    - `ghoulSprite.ts`: **sprite del ghoul** disegnato pixel per pixel (palette, pose dei fotogrammi)
    - `ghouls.ts`: disegno dei ghoul (billboard verso la camera, fotogramma per stato, caduta da morti)
  - `navDebug.ts`: vista del grafo di navigazione (tasto N): link colorati per tipo, nodi colorati per distanza dal giocatore
  - `targets.ts`: **bersagli** (modello, oscillazione a molla quando colpiti, caduta e rialzata)
  - `impacts.ts`: fori di proiettile sulle superfici (decal, dimensione, quanti ne restano)
  - `materials.ts`: **quale texture usa ogni materiale** (`LOOKS`), densità dei pixel, mesh dei box
- `src/audio/sfx.ts`: **effetti sonori sintetizzati** con Web Audio (sparo, ricarica, "ding" dei bersagli, versi/artigliate/morte dei ghoul con panning stereo, **carica, sparo e impatto delle palle di fuoco del Malocchio**, giocatore ferito, **campana delle ondate**, volume)
- `public/textures/`: texture PNG (servite così come sono da Vite su `/textures/...`)
- `docs/DESIGN.md`: **documento di design** (decisioni di gameplay e domande aperte)
- `CREDITS.md`: autori e licenze degli asset
- `index.html`: pagina con canvas, overlay "Click to play", HUD, mirino, **hitmarker**, munizioni, **salute**, vignetta di danno, **ondata, punteggio, banner**, riepilogo di morte (stili CSS inclusi)
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
