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
- `npm run models`: rigenera i modelli 3D con Blender (serve una volta `tools/blender/setup.sh`)

## Dove trovare le cose
Mappa per l'utente, da aggiornare ogni volta che si aggiunge un file/cartella rilevante.
- `src/main.ts`: entry point (renderer, scena, luci, caricamento livello, game loop a passo fisso + interpolazione camera,
  **pausa** (Esc: senza mouse catturato la simulazione si ferma e l'audio si sospende; col pannello debug aperto il gioco continua),
  **indicatore prestazioni**: fps, ms simulazione/disegno, draw call).
  Debug: `?pos=x,y,z&look=yaw,pitch` nell'URL per partire da un punto preciso; `?level=arena` per l'arena di prova;
  `?seed=123` per rigiocare la stessa sequenza di ondate (il seed di ogni partita è scritto nella console del browser)
- `src/menu.ts`: **menu di avvio/pausa** (pagine Gioca / Impostazioni / Comandi; il markup e lo stile stanno in `index.html`)
- `src/settings.ts`: **impostazioni del giocatore** salvate nel `localStorage` (per ora la sensibilità del mouse, scala Quake/CS)
- `src/input.ts`: input grezzo (tasti e tasti del mouse premuti, pressioni brevi "memorizzate", **rotellina** come tasti `WheelUp`/`WheelDown`, movimento mouse, Pointer Lock)
- `src/controls.ts`: sensibilità mouse in radianti (`controlSettings`, impostata da `settings.ts`), angoli di vista, **mappatura tasti** (WASD, Spazio, Shift/C = accovacciati/slide, click = spara, R = ricarica, **F / tasto destro = calcio**, **1/2 = revolver/doppietta, Q/rotellina = cambia arma**, K = respawn) → `InputCommand` (T = cambia atmosfera, P = pixel art on/off, N = grafo IA (premuto di nuovo: grafo dei corpi grandi), **H = hitbox**, **B = fai apparire un Malocchio**, **G = fai apparire un cane infernale**, **V = fai apparire un toro**, **J = fai cadere un raccoglibile di ogni tipo** (debug), tasto sotto Esc = pannello debug, in `main.ts`)
- `src/sim/`: simulazione pura (niente Three.js/DOM)
  - `config.ts`: **valori di tuning** (oggetto `tuning`, modificabile dal pannello debug) (tick rate, altezza occhi, salute, **ondate** (anche picco della pressione e spawn), dimensioni giocatore, movimento a terra, gravità/salto/coyote/buffer, movimento e controllo in aria, aiuti al bhop, accovacciata, slide, wall jump, **revolver**, **munizioni di riserva** (`*ReserveStart`/`*ReserveMax`, `infiniteAmmo` per il debug), **drop e raccoglibili** (`drop*`: probabilità per punto di peso, **pesi dei tipi** `dropWeight*`, durata; `pickupRadius`, `medkitHeal`, `ammoPickup*`), **calcio** (`kick*`), **doppietta** (`shotgun*`: pallini, rosata, danno e calo con la distanza, contraccolpo sul giocatore, **spinta sui nemici a bruciapelo** `shotgunKnockback*`), **tempo di cambio arma**, bersagli, **ghoul**, **Malocchio** (anche sparo: carica, intervallo, velocità/danno della palla di fuoco, **tiro d'anticipo** `eyebatLeadFactor`), **balzo del ghoul** (`ghoulLunge*`), **cane infernale** (`hound*`: velocità, **agguato** (distanza di pedinamento, angolo "ti sta guardando", tempi), morso, peso nelle ondate), **toro** (`bull*`: velocità, mira (tempo, blocco, rotazione, anticipo), carica (velocità, danno, lancio, altezza per scavalcarlo, **spinta sugli altri nemici** `bullTrample*`), sbandata, stordimento, taglia, peso nelle ondate), **proiettili nemici**, **Stile** (`style*`: durata della catena, punti per rank, punti per colpo/uccisione/testa, punti persi per danno, **durata del climax HIGH NOON** `styleHighNoonTime`))
  - `game.ts`: **stato di gioco unico** (`GameState`: giocatore, entità, **proiettili nemici**, ondata, statistiche) **raccoglibili**, e `stepGame()` (un tick di tutto il gioco; game over alla morte)
  - `entities.ts`: **entità colpibili** (bersagli, ghoul, Malocchio, **cane infernale**, **toro**): dati, salute, danno, **hitbox** (`hitBox`: separata dal collider, misure in `config.ts`: `ghoulHitWidth/Height`, `houndHitWidth/Height/HeadHeight`, `bullHitWidth/Height`, `eyebatHitRadius`, `eyebatPupilRadius`)
  - `ghoul.ts`: **IA del ghoul** (segue il flow field: cammina, salta con traiettoria balistica, si lascia cadere, **si arrampica**; da vicino inseguimento diretto con salto/aggiramento; separazione; artigliata senza fermarsi; **inseguimento** quando ti vede: punta dove stai andando e di lato, così l'orda accerchia; **balzo** da 2–6 m con preavviso, tiro d'anticipo e recupero a terra)
  - `eyebat.ts`: **IA del Malocchio** (occhio-pipistrello volante: orbita attorno al giocatore a distanza e quota fisse, steering 3D, separazione, sale sopra gli ostacoli; **sparo**: macchina a stati volo → carica (preavviso, rallenta) → palla di fuoco **mirata dove sarai** (intercettazione), solo con linea di vista; da morto cade)
  - `hound.ts`: **IA del cane infernale** (**agguato**: macchina a stati pedina → carica → morso → fuga. Pedina a ~12 m girandoti **alle spalle**; quando non lo guardi (fuori dal cono di vista o dietro un muro) **ulula** (il preavviso) e scatta a 13 m/s; carica anche se gli lasci avvicinarsi troppo o se pedina da troppo; dopo il morso scappa e ricomincia. Salta buchi e ostacoli bassi, **non si arrampica** (aspetta sotto); spinto da calcio e doppietta)
  - `bull.ts`: **IA del toro** (macchina a stati avvicinamento → **mira** (si ferma, raspa e sbuffa, gira verso dove sarai con l'intercettazione di `eyebat.ts`; negli ultimi istanti la direzione si blocca) → **carica** dritta senza sterzare (ti travolge e ti lancia, ma puoi saltarlo; **spinge via (senza danno) gli altri nemici** sulla sua strada) → **sbandata** se ti supera, **stordito** se sbatte contro un muro (ogni colpo critico); non si arrampica, immune alla spinta di calcio e doppietta, separazione tra tori)
  - `pickups.ts`: **drop dei nemici e raccoglibili** (**proiettili** per il revolver, **cartucce** per la doppietta, **medikit**): probabilità di drop = peso del nemico × `dropChancePerWeight`, tipo scelto a caso coi pesi (`pickKind`), appoggiati sul pavimento con un raggio verso il basso, raccolti passandoci sopra (restano a terra se non ti servono), spariscono dopo `dropLifetime`
  - `projectiles.ts`: **proiettili nemici** (palle di fuoco lente: movimento a ogni tick, collisione col livello lungo il segmento percorso, sfera contro il box del giocatore, danno e spinta)
  - `nav.ts`: **grafo di navigazione** generato dai box, **uno per taglia di corpo** (`NavBody`: `SMALL_BODY` per ghoul e cani, `BIG_BODY` per i tori, con raggio, altezza, salto, arrampicata e passo dei nodi) (nodi ogni 1,5 m, link cammina/salta/cadi/arrampicati/**sfiatatoio** (lancio simulato in anticipo), limiti di salto/caduta/arrampicata) e **flow field** (Dijkstra dal giocatore)
  - `waves.ts`: **ondate stile CoD Zombies** con **budget di peso**: ogni nemico ha un costo (`ghoulCost`, `eyebatCost` in `config.ts`), ogni ondata un budget (`waveBudget`), e a ogni spawn si sceglie un tipo a caso tra quelli che il budget si può permettere. **`ROSTER`** = elenco dei nemici delle ondate (aggiungere un nemico = aggiungere una riga). Curva di difficoltà (budget, peso vivo insieme, **salute a gradini con tetto** `healthForWave`, corridori, intervallo di spawn, **pressione** `wavePressure`: spari e balzi più frequenti fino all'ondata di picco), ondata minima di ogni nemico (`fromWave`), **scelta del punto di spawn** (`pickSpawn`: fuori vista e davanti al giocatore) e **punteggio**
  - `style.ts`: **meter dello Stile** come **catena** (stile Tony Hawk): ogni azione stilosa aggiunge punti e riavvia il timer (`styleChainTime`), se scade lo stile torna a zero di colpo; i danni subiti tolgono punti; **rank** (`STYLE_RANKS`: D → HIGH NOON, uno ogni `styleRankPoints`); **climax HIGH NOON** (`highNoonTicks`: arrivato in cima, per qualche secondo armi senza fondo e stile congelato, poi si azzera; eventi `highNoon`/`highNoonEnd`). Per ora danno stile solo colpi e uccisioni; i numeri si vedono nella riga di debug in alto al centro
  - `random.ts`: **numeri casuali con seed** (mulberry32): deterministici, stato salvato nel `GameState` (`rng`)
  - `command.ts`: tipo `InputCommand` (cosa vuole fare il giocatore in un tick)
  - `world.ts`: tipi del livello (`Box` AABB, `Prop` decorazioni, `TargetSpawn` bersagli, `World`) e helper `box()`
  - `props.ts`: **box di collisione invisibili dei props** (barile, palo del cartello, torcia) e zona di lancio degli sfiatatoi
  - `weapon.ts`: **armi del giocatore** (elenco `WEAPONS` = slot 1, 2…; **cambio arma**; sparo semi-automatico, munizioni **su due livelli: nell'arma e in tasca** (`reserve` in `player.ts`), la ricarica prende dalla tasca, hitscan, **colpo alla testa**, **colpo nella pupilla** del Malocchio, **senza fondo** durante HIGH NOON: parametro `bottomless`, arma sempre piena, niente ricarica). **Revolver**: un proiettile. **Doppietta**: rosata fissa di pallini (`pelletPattern`), danno sommato per nemico, calo con la distanza (`falloff`), ricarica automatica a canne vuote, **spinta sui nemici a bruciapelo** (`blastBack`), **contraccolpo sul giocatore che non frena mai** (`recoil`: tiene solo la parte di spinta che aiuta; shotgun jump in aria)
  - `kick.ts`: **calcio (melee)**: preavviso minimo, cono davanti al giocatore (portata, angolo, altezza, niente attraverso i muri), danno e **spinta** (`knockBack`, usata anche dalla doppietta: il ghoul vola e resta a terra, stato `staggered` in `ghoul.ts`)
  - `raycast.ts`: raggio contro i box (metodo degli "slab"): cosa colpisce un proiettile
  - `events.ts`: eventi della simulazione (**`fire`** = l'arma ha sparato, **`shot`** = un proiettile/pallino e dove è arrivato, **cambio arma**, colpo su un'entità, **calcio**, attacco del ghoul, carica/sparo del Malocchio, impatto di un proiettile, giocatore ferito/morto, colpo a vuoto, ricarica) per effetti e suoni
  - `collision.ts`: movimento con collisioni asse per asse contro i box, `overlapsAny` (c'è spazio?), `findWall` (muro vicino?)
  - `player.ts`: stato del giocatore e `stepPlayer()` (salto e bhop facilitato, slide/accovacciata, wall jump stile Apex, attrito, accelerazione Quake + air control, gravità, sfiatatoi, respawn)
- `src/debug/`: pannello di debug
  - `panel.ts`: mini-libreria DOM per i controlli (slider, checkbox, colori, "Copy values")
  - `debugPanel.ts`: **quali valori sono esposti nel pannello** e i loro range; in cima **"Waves"**: scegli un'ondata e "Go to this wave" per provarla subito (`jumpToWave` in `src/sim/waves.ts`), poi **"Style"**
- `src/levels/`: **i livelli** (dati puri)
  - `index.ts`: elenco dei livelli e livello di default
  - `town.ts`: **la cittadina** (mappa principale, greybox): edifici, torri, ponte, piattaforme sospese, sfiatatoi, **vicoli e ostacoli bassi** (helper `porch`, `shed`, `fence`, `crateSteps`, **`wallZ`/`wallX` = muri con porte e finestre** in cima al file), **strada alta** sui tetti, **passaggi da slide**, **emporio** in cui si entra, **bersagli** (`targets`), **punti di spawn dei nemici** (`enemySpawns`, sparsi per tutta la mappa); percorsi descritti in cima al file
  - `testArena.ts`: arena di prova 40×40 (piattaforma, scale, corridoio, colonne, casse, trave bassa per lo slide) + **props** (lista `props` in cima al file)
- `src/render/`: effetti puramente visivi (non toccano la simulazione)
  - `landingDip.ts`: abbassamento camera all'atterraggio (intensità, recupero)
  - `cameraFeel.ts`: **FOV con la velocità, inclinazione (roll) in strafe/slide, altezza occhi morbida, scossone quando sei colpito** (`hurtKick`: la testa viene spinta via dal colpo con una molla smorzata; forza, rigidità e smorzamento `hurt*` nel pannello debug) (`cameraFeelSettings`)
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
  - `particles.ts`: **particelle** (polvere/lucciole, braci, vapore, scintille e sangue degli impatti, **terra sollevata** e **sbuffi di fuoco** del toro: `spawnDirt`, `spawnSnort`)
  - `heightFog.ts`: nebbia al suolo (patch dello shader della nebbia di Three.js)
  - `weapons/`: **l'arma in mano (viewmodel)**
    - `viewmodel.ts`: scena/camera dell'arma, **posa, rinculo, ondeggiamento, bob, ricarica, lampo, calcio** (`viewmodelSettings`)
    - `viewmodel.ts` contiene anche **posa della doppietta** (`shotgun*` in `viewmodelSettings`: posizione, rotazione, rinculo) e l'animazione di **cambio arma** (la nuova arma sale dal basso)
    - `revolverModel.ts`: modello procedurale del revolver (canna, tamburo, cane, calcio)
    - `shotgunView.ts`: **doppietta in mano**: carica `public/models/shotgun.glb`, braccia di `arms.glb` rimesse in posa (`shotgunArmSettings`), animazioni in codice ruotando le parti del modello (**cani** che cadono allo sparo, **ricarica**: canne che si aprono, bossoli espulsi, cartucce nuove, chiusura; fasi come frazioni del tempo di ricarica in cima al file)
    - `kickLeg.ts`: **gamba del calcio**: carica `public/models/leg.glb` (GLTFLoader), lo anima con `AnimationMixer` sincronizzando il fotogramma d'impatto con `kickWindup`
    - `hands.ts`: **braccia** (carica `public/models/arms.glb`: braccio destro sull'impugnatura, sinistro mosso come un blocco; le stesse braccia, rimesse in posa in `shotgunView.ts`, tengono anche la doppietta) e **keyframe del fanning** della mano sinistra
  - `ammoHud.ts`: **munizioni** (basso a destra, look "sangue e cenere"): un colpo disegnato per ogni colpo nell'arma, **forma diversa per arma** (cartucce sottili d'ottone per il revolver, cartucce rosse tozze per la doppietta: classi `.round.revolver` / `.round.shotgun` in `index.html`), colpi sparati come contorni vuoti, lampeggio durante la ricarica, riserva in Rye (rossa quando è finita)
  - `hud.ts`: collega gli elementi dell'HUD, vignetta rossa, **lampo colorato quando raccogli qualcosa** (+ suono), **ondata (in alto a sinistra), punti e uccisioni (in alto a destra), scritte di inizio/fine ondata e conto alla rovescia**, riepilogo alla morte
  - `damageIndicator.ts`: **da dove arriva il colpo**: un **arco rosso intorno al mirino** dalla parte del colpo (in alto = davanti, in basso = dietro), che **continua a puntare lì mentre ti giri** (`screenAngle`: angolo a schermo di un punto del mondo); fino a `MAX_ARCS` insieme, tempi in cima al file, forma in `index.html` (`.hurt-arc`)
  - `lowHealth.ts`: **vita bassa stile CoD** (sotto `LOW_HEALTH`): **sangue che entra dai bordi** (texture disegnata in codice una volta, `drawBlood`: sfumatura scura + centinaia di gocce sul bordo + colature dall'alto), **immagine che perde colore** (livello grigio in `mix-blend-mode: saturation`), **battito** (lub-dub, più veloce verso la morte, con suono `playHeartbeat`). È qui **l'unico battito del gioco**: `heartbeat()` lo legge anche il numero della salute. Soglia, ritmo, opacità, saturazione minima in cima al file; livelli `#low-health` e `#low-health-gray` in `index.html`
  - `healthPlate.ts`: **salute** (basso a sinistra, look "sangue e cenere": niente cornice, numero in Rye rosso sangue secco con una **macchia scura sfumata** dietro (`.hud-smudge`) per leggerlo, **riga sottile con la fascia "fantasma"** che mostra quanto ti è costato l'ultimo colpo, numero che sobbalza quando sei colpito e **pulsa col battito** di `lowHealth.ts`; tempi e soglie in cima al file, stile in `index.html` (`#health-plate`))
  - `styleMeter.ts`: **meter dello Stile a schermo** (a destra: lettera del rank, nome, barra del progresso verso il rank successivo). **Colori di ogni rank** (`RANK_LOOKS`: gradiente e alone, scala "metallo che si scalda"), **animazioni** in cima al file (timbro quando sali di rank, tremolio quando lo perdi, dissolvenze, **lampeggio della lettera quando la catena sta per spezzarsi o il climax sta per finire** (`CHAIN_WARN_TIME`, `BLINK_HZ_*`), pulsazione a HIGH NOON; durante il climax la **barra è la miccia** che si consuma; **alla fine del climax la lettera viene "temprata"**: diventa ferro grigio (`QUENCHED`) e cade con un saltello e una parabola, `FALL_*`); markup e CSS in `index.html` (`#style-meter`)
  - `highNoon.ts`: **il climax HIGH NOON a schermo**: **tinta dello schermo** (lampo bianco all'inizio, poi immagine "calda" e bordi che ardono pulsando, dissolvenza alla fine; costanti in cima, due livelli CSS in `index.html`: `#high-noon-heat` (blend overlay) e `#high-noon` (blend screen)) e **suoni** (campana e fischio all'inizio, eco da canyon accesa per tutto il climax, sbuffo di vapore alla fine)
  - `fonts.ts`: **font del gioco** caricati con la FontFace API (per ora **Rye**, western); per cambiarlo: metti il file in `public/fonts/` e cambia nome e percorso qui
  - `pickups.ts`: **raccoglibili a terra**: billboard **cilindrico** (ruota solo in orizzontale, come gli oggetti di Doom) che galleggia, **bagliore pulsante**, **pozza di luce colorata** sul pavimento (blending additivo), lampeggio prima di sparire. Misure, colori e intensità in costanti in cima
  - `pickupSprites.ts`: **sprite dei raccoglibili** 16×16 (scatola di proiettili, cartucce rosse, bottiglia di tonico verde con la croce): palette e disegno pixel per pixel, texture **emissiva** (ogni pixel emette `SELF_LIGHT` del suo colore, quelli della maschera tutto)
  - `projectiles.ts`: **palle di fuoco nemiche** (sprite pixel art luminoso, scia di braci, scintille e suono all'impatto)
  - `soundPosition.ts`: volume e panning di un suono in base alla posizione rispetto alla camera
  - `weaponFx.ts`: effetti degli spari (lampo di luce, fori, scintille, suoni; effetti più piccoli per i pallini)
  - `enemies/`: **i nemici**
    - `spriteSheet.ts`: strumenti comuni per gli sprite (`PixelFrame`: pixel, rettangoli, arti, triangoli, contorno; `buildSheet`: sprite sheet + maschera di glow)
    - `eyebatSprite.ts`: **sprite del Malocchio** (palette, ali, occhio con iride luminosa e pupilla, fotogrammi)
    - `eyebats.ts`: disegno dei Malocchi (billboard sferico, battito d'ali, **bagliore della carica**, suoni, morte)
    - `ghoulSprite.ts`: **sprite del ghoul** disegnato pixel per pixel (palette, pose dei fotogrammi)
    - `houndSprite.ts`: **sprite del cane infernale** (palette, zampe anteriori/posteriori, galoppo in 4 fotogrammi; **tre viste**: lato, fronte, retro, più il cadavere)
    - `hounds.ts`: disegno dei cani (billboard con **scelta della vista dall'angolo** tra dove corre e la camera, lato specchiato via texture; basso e con le crepe spente quando pedina, accese quando carica; ululato)
    - `bullSprite.ts`: **sprite del toro** (palette, sagoma con la gobba come profilo a punti di controllo, **testa disegnata una volta e ruotata** con una matrice di rotazione per le pose su/abbassata/giù/stordita, piastra d'ottone con tubi di scarico; **tre viste**: lato (camminata 4, galoppo 2, raspata 2, bloccato, sbandata, stordito), fronte (camminata, carica, stordito), retro, più il cadavere)
    - `bulls.ts`: disegno dei tori (billboard con **vista scelta dall'angolo** tra dove guarda (`dirX/dirZ` della simulazione) e la camera; fotogramma per stato; bagliore che si scalda durante la mira; **preavviso della carica**: tremore crescente, terra dallo zoccolo, sbuffi di fuoco da narici e tubi, vampata e "gonfiata" al blocco, scia in carica (costanti `SHAKE_*`, `SNORT_*`, `LOCK_SWELL`, `TRAIL_EVERY` in cima); lampo rosso quando colpito; suoni)
    - `ghouls.ts`: disegno dei ghoul (billboard verso la camera, fotogramma per stato, caduta da morti)
  - `navDebug.ts`: vista del grafo di navigazione (tasto N; seconda pressione = grafo dei tori): link colorati per tipo, nodi colorati per distanza dal giocatore
  - `hitboxDebug.ts`: vista delle **hitbox** dei nemici (tasto H): verde = corpo, giallo = zona critica (testa / pupilla / toro stordito)
  - `targets.ts`: **bersagli** (modello, oscillazione a molla quando colpiti, caduta e rialzata)
  - `impacts.ts`: fori di proiettile sulle superfici (decal, dimensione, quanti ne restano)
  - `materials.ts`: **quale texture usa ogni materiale** (`LOOKS`), densità dei pixel, mesh dei box
- `src/audio/sfx.ts`: **effetti sonori sintetizzati** con Web Audio (sparo, ricarica, **doppietta** (sparo più grave, ricarica a tempo con l'animazione), **cambio arma**, **calcio** (fruscio e tonfo), **ululato del cane infernale**, **battito del cuore** a vita bassa, **toro** (sbuffo e zoccolo del preavviso, muggito della carica, schianto), "ding" dei bersagli, versi/artigliate/morte dei ghoul con panning stereo, **carica, sparo e impatto delle palle di fuoco del Malocchio**, giocatore ferito, **campana delle ondate**, **raccolta** (un suono per tipo: tintinnio, clack, tappo + rintocco), **HIGH NOON** (campana grave e fischio da duello; **tempra** a fine climax: vapore e "tink" del metallo; **eco da canyon** sul bus principale, `setCanyonEcho`, costanti `ECHO_*` in cima), volume, pausa dell'audio)
- `tools/blender/`: **modelli 3D generati con script Python per Blender** (`bpy`, Blender senza interfaccia)
  - `setup.sh`: installazione una tantum (venv con `bpy` in `tools/blender/.venv`)
  - `lib.py`: mini-libreria di modellazione: **loft** (anelli di sezione uniti in un tubo), anelli ellittici, box/cilindri/stelle, **texture pixel art** (`Pixels`), materiali con filtro "Closest", **render di anteprima** (`setup_preview`, `render_frame`)
  - `leg.py`: **gamba sinistra con stivale da cowboy**, **low-poly** (pochi lati per sezione, shading piatto, texture 8–32 px) (jeans, gambale con cuciture, punta, tacco cubano, sperone, borchia), **scheletro** (anca → coscia → stinco → piede), **animazione del calcio** con IK poi "bakata", render di anteprima, export. **Proporzioni** (`LEG_STRETCH` = lunghezza gamba, `BOOT_SCALE` = grandezza stivale), tabelle delle forme (`FOOT`, `SOLE_TOP`), pose del calcio (`key_foot`, `KICK_HIP`) e fotogrammi (`IMPACT_FRAME` ecc.) in cima
  - `arms.py`: **braccia** (guanti con dita a 3 falangi e polsino a gauntlet, maniche dello spolverino), scheletro con dita, **posa**: mano destra stretta sull'impugnatura (IK per polso/gomito, `curl` per le dita), mano sinistra aperta con l'origine al centro del palmo; la posa viene "congelata" come posa di riposo. Proporzioni della mano (`PALM_*`, `FINGERS`, `THUMB`) e posizione dell'impugnatura (`GRIP_*`) in cima
  - `shotgun.py`: **doppietta** a canne mozze (canne brunite, bascula in ottone inciso con ingranaggi, impugnatura a pistola in noce zigrinata, cani esterni, cartucce). **Niente scheletro**: parti rigide con l'origine sul perno (`stock` → `barrels` (cerniera) → `shell_L/R`; `hammer_L/R`), animate dal gioco. **Misure** (`BARREL_*`, `HINGE`, `HAMMER_*`), palette e texture in cima al file
  - `previews/`: render di anteprima (non nel repo)
- `public/models/`: **modelli glTF (.glb) generati** da `tools/blender/` (nel repo, così il sito non ha bisogno di Blender)
- `public/textures/`: texture PNG (servite così come sono da Vite su `/textures/...`)
- `public/fonts/`: **font** (TTF) con la loro licenza accanto (es. `Rye-OFL.txt`)
- `docs/DESIGN.md`: **documento di design** (decisioni di gameplay e domande aperte)
- `CREDITS.md`: autori e licenze degli asset
- `index.html`: pagina con canvas, **menu** (pagine Impostazioni e **Comandi**: la lista dei tasti va aggiornata qui quando se ne aggiunge uno), HUD, mirino, **hitmarker**, **munizioni** (`#ammo-box`, forme dei colpi `.round`), **targa della salute** (`#health-plate`), riga di debug in alto al centro (`#hud`), **ondata** (`#wave-box`) e **punti** (`#score-box`) in alto, **macchie scure sfumate negli angoli** (`.hud-smudge`), vignetta di danno, **archi della direzione del colpo** (`#hurt-arcs`), **vita bassa** (`#low-health`, `#low-health-gray`), **lampo di raccolta** (`#pickup-flash`), **ondata, punteggio, banner**, **meter dello Stile** (`#style-meter`), **tinta di HIGH NOON** (`#high-noon-heat`, `#high-noon`), riepilogo di morte (stili CSS inclusi)
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
