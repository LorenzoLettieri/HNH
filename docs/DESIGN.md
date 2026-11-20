# High Noon Hell — Game Design

Documento vivo: raccoglie le decisioni di design prese finora e le domande ancora aperte.
Le decisioni marcate **[DECISO]** sono state concordate; **[DA DECIDERE]** sono aperte.

---

## 1. Visione

Boomer shooter western infernale per browser, da giocare con gli amici.
**Il movimento è il cuore del gioco**: correre, scivolare, saltare sui muri e sfruttare la
verticalità deve essere la cosa più forte che puoi fare, non solo la più divertente.

### Pilastri
1. **Movimento come potere** — chi si muove bene uccide di più, sopravvive di più, guadagna di più.
2. **Pressione da ogni direzione** — ogni nemico rende scomoda una posizione diversa: nessun posto è sicuro a lungo.
3. **Leggibilità** — ogni minaccia è annunciata (suono, luccichio, proiettile visibile): morire deve sembrare colpa tua, non del gioco.
4. **Atmosfera** — luci, nebbia, particelle e cielo curati; due ambientazioni: High Noon e High Midnight.

### Cosa vogliamo evitare
- Il "camperare" fermo su un tetto.
- Il loop ripetitivo "corri, girati, spara, ripeti" dei survivor-like con nemici che vanno solo dritti.

---

## 2. Anti-camping: il meter dello Stile [DECISO]

Niente punizioni dirette per chi sta fermo (per ora). Il giocatore si muove perché **conviene**.

### Rank dello stile
Barra con rank a lettere, convenzione classica dei beat-'em-up / action (DMC, ULTRAKILL…):

| Rank | Nome (proposta, a tema) |
|------|-------------------------|
| D    | Dusty                   |
| C    | Cowpoke                 |
| B    | Bandit                  |
| A    | Desperado               |
| S    | Sharpshooter            |
| SS   | Showdown                |
| **HN** | **HIGH NOON** (rank massimo, col nome del gioco) |

Le lettere sono una convenzione di genere; per differenziarci usiamo **nomi western** e un rank
finale unico, "HIGH NOON". [DA DECIDERE: nomi definitivi]

### Cosa fa salire lo stile
- Velocità alta mantenuta, tempo in aria, catene di slide-hop.
- Wall jump, uccisioni in aria o durante uno slide.
- **Varietà**: armi diverse, nemici diversi, modi diversi. Ripetere la stessa azione rende sempre meno.
- Schivate ravvicinate di proiettili (bonus "near miss").

### Cosa lo fa scendere [DECISO: la catena si spezza]
- Lo stile è una **catena**, come le combo di Tony Hawk: ogni azione che dà stile aggiunge punti e
  **riavvia un timer** di pochi secondi (`styleChainTime`, 3 s). Se scade senza che tu abbia fatto
  niente di stiloso, la catena **si spezza** e lo stile **torna a zero di colpo**. Niente calo graduale
  (scartato: il modello DMC/ULTRAKILL, in cui la barra cala piano un rank alla volta).
- Stare fermi o lenti, quando arriverà lo stile dal movimento, vuol dire non alimentare la catena.
- Subire danni: perdi punti in proporzione al danno (`styleHurtPerDamage`), ma la catena non si spezza.
- [DA DECIDERE] Timer più corto ai rank alti?

### Stato [FATTO: passo 1]
`src/sim/style.ts`: punti, catena e rank nella simulazione; per ora danno stile solo i colpi (5) e le
uccisioni (+40, +30 se alla testa). Un rank ogni **200 punti** (HIGH NOON a 1200). Numeri grezzi nella
riga di debug in alto a sinistra; valori nel pannello debug (cartella "Style").
Prova: 25 uccisioni di fila, una al secondo = SS (1185 punti), a un passo da HIGH NOON.

**A schermo** [FATTO: passo 2] (`src/render/styleMeter.ts`): sul lato destro, leggermente storta come un
manifesto inchiodato, la **lettera del rank** in **Rye** (font western da "wanted", licenza OFL), il nome
sotto e una **barra** col progresso dentro il rank (piena a HIGH NOON). I colori seguono il **metallo che si
scalda nella forgia**: D grigio cenere, C rosso spento, B rosso, A arancio, S giallo, SS giallo chiaro,
HIGH NOON bianco incandescente con l'alone che pulsa; l'alone cresce col rank. Appare quando parte una
catena, sparisce quando si spezza (resta la lettera di prima mentre svanisce). Salire di rank = la lettera
cala come un **timbro**; perdere un rank per i danni = la lettera **trema**.
**Timer della catena** [FATTO: passo 3]: negli ultimi **1,5 s** prima che la catena si spezzi la lettera
**lampeggia**, sempre più veloce (da 3 a 12 volte al secondo, come il bip di una bomba); ogni azione
stilosa riavvia la catena e il lampeggio si ferma. Niente barra del tempo: la barra resta il progresso del rank.
**Elenco delle azioni** [FATTO: passo 4] (`src/render/styleFeed.ts`): sotto il meter, per un attimo, le
azioni appena fatte e quanto valgono ("HEADSHOT +75"). Ogni azione stilosa è un **premio** (`StyleAward`
in `style.ts`: un id e i punti) e la simulazione manda un evento `styleAward`; il nome a schermo sta nel
rendering. **Un premio per colpo**, col nome della cosa migliore che ha fatto (un headshot letale è una
riga sola, non "colpo + uccisione + headshot"). La stessa azione ripetuta mentre la riga è ancora a schermo
**si somma** ("COLPO ×3 +15") invece di aggiungere righe. Animazione: la riga **entra di scatto da destra**,
grande e incandescente, si raffredda nel suo colore; i punti sono nel colore del rank; poi scivola via.

**Azioni stilose** [FATTO: passi 5–7, da tarare giocando] (`StyleAward` in `style.ts`, punti in `config.ts`):
- *Cosa ha fatto il colpo* (una riga per colpo): COLPO, UCCISIONE, HEADSHOT, NELL'OCCHIO (pupilla del
  Malocchio), MATADOR (toro ucciso mentre è stordito).
- *Come hai ucciso* (righe in più): DAL CIELO (in volo), IN SCIVOLATA, DI STIVALE (calcio), CAMBIO LAMPO
  (entro 0,6 s da quando la nuova arma è pronta), QUICKSCOPE (carabina, entro 0,5 s da quando inizi a
  mirare), NOSCOPE (carabina dall'anca da 15 m in su), A BRUCIAPELO (doppietta entro 2,5 m), DA LONTANO
  (revolver/carabina da 30 m in su), ULTIMO COLPO (il colpo che svuota revolver o carabina), SUL FILO (25 di vita o meno).
- *Più uccisioni*: DUE PICCIONI / STRAGE ×n con un colpo solo (o un calcio); in serie, ognuna entro 1,5 s
  dalla precedente: DOPPIA, TRIPLA, QUADRUPLA, CINQUINA, MASSACRO ×n (la riga si aggiorna invece di moltiplicarsi).
- *Movimento*: VELOCITÀ (sopra 10 m/s, punti continui che crescono con la velocità, dati due volte al
  secondo), IN VOLO x s (all'atterraggio, da 1 s in su), WALL JUMP (il secondo vale doppio, il terzo
  triplo), BHOP ×n (di più per bhop di fila, fino a 5), SLIDE JUMP, SFIATATOIO, PER UN PELO (un proiettile
  nemico ti passa a meno di 1,2 m), OLÉ! (la carica del toro ti manca di poco).
- **Deciso: il movimento da solo tiene viva la catena** (è il cuore del gioco), frenato dalla varietà.
- **Varietà** [FATTO]: ogni azione ha una **freschezza** (0..1). Farla la moltiplica per 0,8 (fino a un minimo
  di 0,25); il tempo la riporta su (+0,15 al secondo). Il colpo semplice e la velocità non calano.
- Con molte più fonti di punti, il rank sale prima: **un rank ogni 250 punti** (HIGH NOON a 1500). Da tarare giocando.

### A cosa serve
- **Moltiplicatore** sul **punteggio** e sul **vildenaro** guadagnato (la moneta: vedi §5, Economia).
- **Climax "HIGH NOON"** [DECISO]: quando raggiungi il rank massimo, per **5 s** le armi non consumano
  i colpi del caricatore (niente ricarica: spari e basta). Va annunciato forte (scritta, suono, tinta
  dello schermo, magari la campana della chiesa). **Finito il climax lo stile si azzera**: si riparte
  da D, quindi HIGH NOON è un evento da inseguire, non uno stato in cui restare.
  **Passo 1** [FATTO]: la meccanica. Arrivato in cima parte il conto alla rovescia (`styleHighNoonTime`);
  l'arma in mano è **sempre piena** (riempita gratis, anche se il climax ti coglie a tamburo vuoto o passi
  all'altra arma; una ricarica in corso viene annullata) e sparare non consuma colpi, né nell'arma né in
  tasca. Finito il climax l'arma resta piena: un piccolo regalo. Durante il climax lo stile è **congelato**
  (né guadagni né perdite, la catena non scade). Sul meter la barra diventa la **miccia** che si consuma e
  la lettera lampeggia nell'ultimo secondo e mezzo. Annuncio **provvisorio**: scritta "HIGH NOON" e tre
  rintocchi rapidi di campana.
  **Passo 2** [FATTO]: **tinta dello schermo** (`src/render/highNoon.ts`). All'inizio un **lampo bianco
  caldo**, come guardare il sole a mezzogiorno; per tutto il climax l'immagine è **calda** (tinta che
  mantiene il contrasto) e i **bordi dello schermo ardono** pulsando; svanisce nell'ultimo mezzo secondo.
  **Passo 3** [FATTO, da sentire]: **suoni**. All'inizio una **campana enorme e grave** (non quella delle
  ondate) e un **fischio da duello** (melodia originale: sale, tiene col vibrato, scende); per tutto il climax
  un'**eco da canyon** su ogni suono (spari, nemici, il fischio stesso), che si spegne alla fine.
  **Passo 4** [FATTO]: **la fine**. Chiude la metafora della forgia: la lettera incandescente viene
  **temprata** come ferro rovente nell'acqua. Diventa grigio ferro di colpo, con uno **sbuffo di vapore**
  e il "tink" del metallo che si raffredda, fa un saltello e **cade** dallo schermo ruotando. Succede anche
  se muori durante il climax (senza il vapore). Un colpo durante la caduta fa ripartire subito la catena da D.
- [DA DECIDERE] Bonus di danno ai rank alti (forse superato dal climax).
- [DA DECIDERE] Eventuale bonus di drop della salute ai rank alti.

### Risorse dall'aggressività [PROPOSTO]
- Niente rigenerazione della salute: la salute cade dai nemici uccisi.
- Munizioni sparse per la mappa: chi resta fermo le finisce.
- **Munizioni di riserva** [FATTO, da tarare]: ogni arma ha i colpi caricati e quelli **in tasca**;
  la ricarica sposta dalla tasca all'arma. Si parte con 36 proiettili (max 72) e 12 cartucce (max 24).
  Tasca vuota = click a vuoto, niente ricarica (resta il calcio). Anche il revolver è finito.
  Le tasche si riempiono coi **drop dei nemici** (sotto); [DA DECIDERE] munizioni fisse sulla mappa.
- **Drop dei nemici** [FATTO, da tarare]: niente loot table per nemico, una regola sola: probabilità
  = **peso del nemico × 30%** (ghoul 30%, Malocchio 60%, cane e toro 80% = il massimo). Il tipo è scelto coi **pesi**
  5/4/3: 42% **proiettili** (+18, revolver), 33% **cartucce** (+5, doppietta), 25% **medikit** (+25 salute).
  (Alzati dopo il playtest: le munizioni finivano troppo in fretta. Prima: 20% per punto di peso, 4/3/3, +12 e +4.)
  Munizioni **separate apposta**: se per un po' non cadono cartucce sei costretto a cambiare stile. Si raccolgono passandoci
  sopra; se non ti servono restano a terra. **Spariscono dopo 10 s** (lampeggiano negli ultimi 3).
- **I drop esplodono fuori dal corpo** [FATTO, da tarare]: monete e oggetti di un'uccisione schizzano
  a ventaglio (angoli equidistanti, un po' di casualità), fanno un arco, rimbalzano una volta e si posano
  a **1–3 m** dal corpo. Così non si sovrappongono mai, e la pioggia di bottino è più soddisfacente.
  Si possono raccogliere anche mentre volano: corri dentro l'esplosione.
  Aspetto: sprite pixel art che galleggiano sopra una pozza di luce del loro colore (ottone =
  proiettili, rosso = cartucce, verde = tonico/medikit), visibili anche di notte; suono diverso per tipo.

---

## 3. Nemici

Regola d'oro: **i nemici attaccano lo spazio, non solo il giocatore**. Ogni tipo mette una
pressione diversa. Proiettili nemici quasi sempre **lenti e visibili**; colpi istantanei solo
con un chiaro preavviso.

| Nemico (provvisorio) | Ruolo | Pressione |
|---|---|---|
| **Ghoul** | Carne da cannone (ispirato agli zombie di CoD Zombies): cammina verso di te, **scavalca gli ostacoli bassi e aggira quelli alti**; in futuro si arrampicherà | A terra non sei mai al sicuro; un muretto non basta |
| **Cane infernale** [FATTO, da tarare; suoni provvisori] | **Agguato**: ti pedina a distanza e scatta quando non lo guardi (dettagli sotto). Pesa **3** nelle ondate, dall'ondata 5 | Devi guardarti alle spalle: nessun angolo morto è sicuro |
| **Avvoltoio** | Volante, gira in cerchio e picchia in picchiata | Raggiunge ogni tetto, obbliga a guardare in alto |
| **Malocchio** [FATTO] | Occhio-pipistrello volante: orbita attorno a te a distanza (10 m, 5 m più in alto) e spara proiettili lenti. **Pupilla = punto critico** (×3, come la testa del ghoul) | Il movimento diventa difesa; obbliga a guardare in alto e a mirare con precisione |
| **Fuoco fatuo** | Volante a distanza, proiettili lenti (forse superato dal Malocchio) | Il movimento diventa difesa |
| **Tiratore scelto** (sharpshooter) [FATTO, da tarare] | Scheletro col cappello da cowboy e una **Winchester** (la prossima arma del giocatore). Spara **da lontano** con un colpo velocissimo annunciato da un **laser rosso**; cerca di appostarsi sulle **alture**, arrampicandosi (dettagli sotto). Pesa **4** nelle ondate, dall'ondata 6 | Punisce chi sta fermo o corre dritto in vista, premia chi rompe la linea di tiro o cambia direzione al momento giusto |
| **Dinamitardo** | Lancia dinamite ad arco, lascia fiamme | Nega zone: ti costringe a spostarti |
| **Toro** [FATTO, da tarare; suoni provvisori] | Grosso e resistente: ti punta (preavviso), poi **carica dritto** senza sterzare (dettagli sotto). Pesa **5** nelle ondate, dall'ondata 7 | Prima si schiva (cambio di direzione o salto), poi si uccide: meglio con un muro alle spalle |
| **Boss** | Pattern complessi, ogni tot ondate | Picco di intensità |

Stile: **sprite 2D** (tipo Doom), coerenti con il resto.

### I nemici sono solidi (body block) [FATTO: passo 1]
Come in CoD Zombies, **non si passa attraverso l'orda correndo**: da una brutta situazione si
esce col **movimento** (aggirare, saltare sopra le teste, wall jump) o **aprendosi un varco**
(calcio e doppietta buttano a terra, e un nemico a terra non blocca). Ghoul, cani e tori sono
cilindri solidi per il giocatore; i Malocchi (volano) no. Solo il giocatore viene spinto:
i nemici sono "pesanti", e l'orda che preme ti sposta (mai dentro un muro).
Da valutare dopo il playtest: atterrare sulle teste (oggi scivoli giù), nemici che si fermano
al contatto invece di spingerti.

### Navigazione [FATTO]
- **Grafo di navigazione** generato automaticamente dai box del livello (`src/sim/nav.ts`):
  nodi ogni 1,5 m su ogni superficie + link "cammina / salta / cadi / arrampicati".
  I ghoul **si arrampicano sui muri fino a 15 m** e **usano gli sfiatatoi** (solo quando lo scelgono):
  nessun tetto è sicuro (campanile compreso).
- **Flow field**: una sola ricerca (Dijkstra) dal giocatore, condivisa da tutti i ghoul.
- Tasto **N** in gioco: mostra il grafo.
- **Inseguimento e accerchiamento**: quando un ghoul ti **vede** sul suo stesso livello (entro 30 m),
  smette di seguire il grafo e corre **dove stai andando** (intercettazione, fino a 1,5 s di anticipo),
  ognuno puntando qualche metro **di lato** (fino a 5 m, lato e distanza dipendono dall'id): l'orda si
  apre a ventaglio e ti chiude da più direzioni invece di metterti in fila dietro. Da vicino (5 m)
  torna a puntarti dritto. Distanza minima tra ghoul: 1,4 m (era 1).
  Col bot di prova (giro in tondo, ondata 30): ghoul entro 6 m in media da 0,5 a ~4.
- I volanti usano uno steering 3D semplice che evita gli ostacoli.
- **Un grafo per taglia** [FATTO]: dove passa un corpo dipende da quanto è grosso (un vicolo largo 1 m è una
  strada per un ghoul e un muro per un toro). Stessi box, due grafi: **piccolo** (ghoul e cani, nodi ogni 1,5 m)
  e **grande** (tori: raggio 0,65 m, alti 2,1 m, nodi ogni **1 m** così c'è sempre una fila di nodi nel mezzo
  dei vicoli da 2,5 m; niente arrampicate né sfiatatoi). Ognuno ha il suo flow field. Grafo grande: ~7600 nodi,
  ~0,3 s per costruirlo all'avvio; il suo flow field si calcola solo se c'è almeno un toro.
  Tasto **N** due volte: mostra il grafo grande.

---

### Danni e salute: la regola dei breakpoint [DECISO]
Gioco **aim-intensive** che premia il movimento: niente nemici "spugna".
- **Si progetta in colpi per uccidere**, non in punti vita: il giocatore sente "2 colpi", non "130 HP".
  La salute si sceglie in base ai breakpoint (le soglie dove cambia il numero di colpi).
- Revolver **50 danni**, **testa ×3** (super premiata: segnalino dorato, suono dedicato, testa che
  esplode, +50 punti sull'uccisione).
- **Salute dei ghoul a gradini lenti** (ogni 10 ondate):

| Ondate | Salute | Corpo | Testa |
|---|---|---|---|
| 1–9 | 50 | 1 colpo | 1 colpo |
| 10–19 | 100 | 2 colpi | 1 colpo |
| 20–29 | 150 | 3 colpi | 1 colpo |
| 30+ | 200 | 4 colpi | 2 colpi |

  La salute **si ferma a ×4** (`waveHealthMaxMultiplier`): prima continuava a salire (all'ondata 50
  un ghoul aveva 300 HP e un Malocchio 600, cioè spugne). Il Malocchio ha la stessa tabella del ghoul.

- La difficoltà delle prime ondate viene da **quantità, velocità, direzioni, tipi di nemico**;
  la salute alta arriva solo molto tardi. Nemici resistenti = **miniboss** (eventi, non la norma).
- **Hitbox generose, separate dal collider** [DECISO]: la scatola che urta i muri (stretta, per
  passare nei vicoli) non è quella che prende i colpi. La hitbox copre **tutto lo sprite**: ghoul
  1,0 × 2,0 m (il collider è 0,7 m), Malocchio un cubo di 1,3 m attorno all'occhio (prima 0,8 m),
  pupilla con raggio 0,25 m (prima 0,15). Regola: un colpo che tocca visibilmente il disegno deve
  contare. Tasto **H** per vederle.
- **Malocchio**: **stessa salute del ghoul** (50, stessi gradini), quindi stessi colpi per uccidere:
  1 colpo nelle ondate 1–9, dalla 30 4 al corpo o 2 nella pupilla. La sua difficoltà è colpirlo
  (piccolo, in alto, in movimento), non la resistenza. Il critico si calcola
  come distanza tra la traiettoria del proiettile e il centro dell'occhio (lo sprite guarda
  sempre verso di te, quindi il centro visto da te è la pupilla): raggio 0,15 m.
- **Sparo del Malocchio**: ogni ~2,5–3,5 s, solo se ti vede (entro 30 m). **Preavviso di 0,7 s**
  (pupilla dilatata, iride sempre più accesa, sibilo crescente; intanto rallenta: è il momento
  migliore per colpirgli la pupilla). Palla di fuoco a **12 m/s** (tu corri a 8+), 15 danni,
  **mirata dove sarai** (tiro d'anticipo, `eyebatLeadFactor` 0,9): se continui dritto o in tondo
  alla stessa velocità ti prende. Per schivarla devi **cambiare direzione** dopo il preavviso
  (salto, slide, inversione). Prima mirava dove eri: bastava muoversi, e al playtest girare in
  tondo rendeva immortali (0 colpi su 190 col bot di prova).
- **Ghoul: artigliata e balzo.** L'artigliata (20 danni) non lo ferma più: continua a camminare
  al 60% della velocità mentre colpisce, quindi passargli accanto non è gratis. Tra **2 e 6 m**,
  con la linea libera, **balza**: 0,45 s accovacciato a braccia alzate con uno **stridio che sale**
  (il preavviso), poi un salto basso e veloce (fino a 13 m/s, ~0,4 s in aria, preavviso 0,45 s) mirato **dove sarai**
  all'atterraggio. Ti ferisce se ti tocca in volo (20 danni). Atterrato resta **a terra 0,6 s**:
  è il momento di punirlo. Ricarica di 3–4,5 s. Resta un nemico che punisce le distrazioni:
  per chi lo vede arrivare è schivabile (salto, slide di lato).
- **Cane infernale: l'agguato.** Salute 50 come il ghoul (la difficoltà è la sorpresa, non la
  resistenza). Ciclo **pedina → carica → morso → fuga**:
  - **Pedina** a ~12 m girandoti attorno **verso le spalle** (9,5 m/s: a piedi non lo semini).
  - Quando resta **fuori dalla tua vista** per 0,5 s (oltre 55° da dove guardi, cioè fuori dallo
    schermo, o dietro un muro) **ulula** e **carica** a 13 m/s. L'ululato è il preavviso, con il
    panning stereo: ti dice da dove arriva. Carica comunque se gli lasci arrivare a 5 m o se ti pedina
    da più di 7 s (fissarlo non basta a tenerlo lontano per sempre).
  - **Morso** (15 danni, preavviso 0,25 s), poi **scappa** per 1,2 s e ricomincia.
  - Non si arrampica: se sei su un tetto raggiungibile solo arrampicandosi, ti aspetta sotto.
  - **Aspetto**: segugio scheletrico color carbone, costole e spina dorsale scoperte, cornetti, collare
    d'ottone chiodato, crepe di brace che si accendono quando carica. Sprite con **tre viste** (lato,
    fronte, retro) scelte dall'angolo, perché ti gira attorno e va visto di profilo.
  - **Critico**: colpi sopra **0,7 m** (testa e orecchie) = ×3, come la testa del ghoul.
  - Bot di prova (non spara mai), 3 cani: ululato in media a ~90° da dove guardi (di lato o alle
    spalle), a 10–20 m; tra ululato e morso **~0,8–1,3 s**: il tempo per girarsi e sparare.
    Fermo: 525 danni in 40 s; correndo in tondo: 150.
- **Toro: la carica.** L'eccezione voluta alla regola "niente spugne": **300 di salute** (6 colpi di
  revolver al corpo), ma non va affrontato a colpi mentre arriva. Priorità: **schivarlo, poi ucciderlo**.
  Ciclo **avvicinamento → mira → carica → sbandata / stordito**:
  - **Avvicinamento** a 3,5 m/s (più lento di te) sul flow field; non si arrampica e non usa gli sfiatatoi.
  - **Mira** (il preavviso, 1,1 s), quando ti ha in linea retta entro 22 m: si ferma, **raspa il terreno e
    sbuffa**, abbassa la testa e si gira verso **dove sarai** (tiro d'anticipo vero, con l'intercettazione
    del Malocchio; gira al massimo di 160°/s). Negli **ultimi 0,3 s smette di girare**: testa giù, occhi
    accesi = direzione bloccata, è il momento di muoversi.
  - **Carica** a **17 m/s** (più veloce anche del bhop) in linea retta, senza sterzare. Se ti prende:
    **40 danni** e vieni lanciato (14 m/s lungo la carica, un po' di lato, 7 m/s in alto).
    Ti prende solo coi piedi sotto **0,9 m**: con un **salto al momento giusto** ti passa sotto.
  - Se ti manca e ti supera di 5 m **sbanda** (0,9 s) e ricomincia. Se **sbatte** contro un muro (o un
    ostacolo basso: in carica non salta) resta **stordito 2,2 s** e **ogni colpo è critico** (×3:
    2 colpi di revolver). È la ricompensa della schivata con un muro dietro.
  - **Troppo pesante** per calcio e doppietta: prende il danno ma non si sposta.
  - **Spinge via gli altri nemici** (ghoul, cani, Malocchi bassi) che trova sulla traiettoria, **senza
    danno**: li lancia di lato e i ghoul restano a terra un attimo, come dopo un calcio. Attirarlo
    attraverso l'orda ti apre un varco, non te la uccide.
  - Bot di prova in campo aperto (bersaglio a 8–20 m): **fermo, che corre dritto di lato, che scappa
    o che gli va incontro: preso**. **Cambia direzione** dopo il blocco (inverte, si ferma, scarta da
    fermo): **mancato**. **Salto**: funziona se parte quando il toro è a 5–7 m (finestra di ~0,15 s).
  - **Aspetto**: toro enorme color carbone con una **gobba** gigantesca sulle spalle, corna a lira, **anello
    d'ottone** al naso, narici e crepe di brace; sulla schiena una **piastra d'ottone rivettata con due tubi di
    scarico** che brillano (il tocco steampunk). Sprite a **tre viste** come il cane; la mira si legge dalla
    posa: raspa il terreno → testa giù e occhi accesi (bloccato) → galoppo; da stordito testa ciondoloni,
    lingua fuori e stelline. Più largo e tondo (pancia a botte, zampe a colonna); hitbox larga **2,4 m** per
    coprire lo sprite (il collider resta 1,3 m, per passare nei vicoli).
  - **Preavviso della carica rinforzato**: durante la mira **trema** sempre di più, ogni raspata **solleva
    terra**, **sbuffi di fuoco** dalle narici e dai tubi sempre più fitti. Al **blocco**: vampata dalle narici,
    colonna di fiamme dai tubi, nuvola di terra e il toro si **gonfia** per un istante. In carica lascia una
    scia di terra e fiamme.
  - **Grafo tutto suo** (vedi Navigazione): col grafo dei ghoul s'incastrava nei passaggi stretti.
- **Tiratore scelto: il laser.** Sostituisce il vecchio "pistolero scheletro". Salute 50 come il ghoul
  (fragile: pericoloso da lontano, facile una volta raggiunto o colpito). Critico sopra **1,55 m** (teschio e cappello).
  Ciclo **attesa → mira → blocco → sparo**:
  - **Mira** (1,3 s), quando ti vede entro **55 m**: si accende un **laser rosso** dalla canna, sempre più
    luminoso, che **ti segue** puntando **dove sarai** quando arriva il colpo (anticipo, come Malocchio e toro).
    Il fucile gira al massimo di **120°/s**: chi si muove regolare viene seguito esatto, uno scatto lo lascia
    indietro per un attimo, e correndogli di traverso **vicino e veloce** lo semini. Se ti nascondi per 0,4 s rinuncia.
  - **Blocco** (0,4 s): il laser **si ferma e lampeggia**. Il colpo andrà esattamente lì: è il momento di
    cambiare direzione (salto, slide, inversione).
  - **Sparo**: proiettile a **90 m/s** (la palla di fuoco va a 12), 30 danni. Non istantaneo (40 m in ~0,45 s) ma
    quasi: la difesa vera è il preavviso. Si vede come una **scia luminosa** (tracer).
  - Bot di prova in campo aperto, a 10 e 18 m: **fermo e in linea retta: preso sempre**; **cambio di
    direzione al blocco: mancato sempre**; correre in tondo: preso ~1 volta su 4.
  - Il laser e la scia **ignorano la nebbia**: un avviso deve leggersi anche a 50 m.
  - **Passo 1** [FATTO]: simulazione, laser, scia, segnaposto fatto di scatole (tasto **L** per farlo apparire).
    Per ora sta fermo dove nasce.
  - **Passo 2** [FATTO]: **sprite pixel art** (scheletro pistolero: cappello, bandana rossa, cartucciera, fondina,
    stivali con speroni, Winchester col castello d'ottone) e **suoni**. La **posa dice lo stato**: a riposo il
    fucile è di traverso sul petto (laser spento, "non ora"); in mira è alla spalla e **ti guarda dentro la canna**
    (anello di ferro con il puntino rosso al centro, disegnato più grande del vero perché si legga da 40 m) e
    l'occhio che mira arde; al blocco **tira la leva** (cla-CLACK: è il suono che vuol dire "muoviti"); sparo
    con rinculo, lampo e braci; da morto **crolla in un mucchio d'ossa** (il cappello resta sospeso un istante).
    Suoni: fucile alla spalla e **ronzio del laser** per tutta la mira (si interrompe se rinuncia), leva, sparo
    secco con eco lunga, **rimbalzo "ptiiing"** quando il colpo ti manca e prende un muro, ossa che crollano.
    I suoni di preavviso e lo sparo sono più forti di quanto direbbe la distanza: deve sentirsi da 50 m.
    Per ora **solo vista frontale** (non cammina e ti guarda sempre). La canna nella simulazione è stata
    avvicinata al corpo (da 0,55 a 0,1 m): lo sprite è piatto, e un punto mezzo metro davanti al cartone
    visto dall'alto non coincide più con la canna disegnata (parallasse).
  - **Passo 3** [FATTO]: **va ad appostarsi**. Appena nasce, e ogni volta che non ti vede per **3 s**, sceglie
    una **postazione**: tra i posti che può raggiungere (camminando, saltando, arrampicandosi fino a 15 m, con
    gli sfiatatoi) tiene quelli **tra 18 e 40 m da te** (più vicino lo raggiungi troppo facilmente, più lontano
    esci dalla sua portata appena ti muovi), lontani almeno 6 m da quelli degli altri tiratori, e dà a ognuno un
    **punteggio = 6 punti per metro di altezza sopra di te − il costo del cammino** (10 m più in alto valgono
    60 m di strada in più). Dal migliore in giù, prende il primo **da cui ti vedrebbe**. Se non c'è niente di
    meglio resta dov'è.
    **Mentre si sposta non spara**: è il momento di raggiungerlo, e a metà di un muro è un bersaglio facile
    (si arrampica a 2,4 m/s, cammina a 3,4: più lento di un ghoul).
    Provato in simulazione (giocatore fermo, 8 tiratori dagli spawn della città): con il peso dell'altezza a 3
    quasi tutti si fermavano in strada (camminare costava più che salire); con la distanza minima a 12 si
    ammassavano tutti sul tetto più alto accanto a te. Con 6 e 18: tetti da 4 a 8 m, a 24–40 m, quasi tutti
    arrivano; nessuno rimane bloccato a metà strada. Dagli angoli della mappa ci mette 15–20 s.
  - **Tattica** [DECISO]: cambia postazione **solo quando non ti vede più** per un po' (3 s). Niente fuga
    quando ti avvicini, niente "spara e cambia posto": se lo raggiungi, è tuo.
  - **Passo 4** [FATTO]: **tre viste** (fronte, lato, retro) scelte dall'angolo tra dove guarda e la camera,
    con camminata (4 fotogrammi) e arrampicata (2). Mentre si muove porta la **Winchester a tracolla sulla
    schiena**: a colpo d'occhio sai che in quel momento non può spararti (in mano = può). Arrampicandosi
    guarda il muro, quindi di solito lo vedi da dietro; dall'alto (sei sul tetto che sta scalando) lo vedi
    di fronte che guarda su. Di lato ha la mira e la leva col fucile di profilo, e laser e lampo partono
    dalla punta della canna disegnata (sempre sulla linea del proiettile).
  - **Passo 5** [FATTO, da provare in partita]: **nelle ondate**, appena sotto il toro: pesa **4** (cane 3,
    toro 5) e compare **dall'ondata 6** (cane 5, toro 7). Salute a gradini come gli altri. Prova senza
    browser (ondate 6-12, giocatore immortale che gira in tondo): compaiono insieme agli altri, passano
    circa un quarto del tempo a spostarsi (metà se ti muovi molto) e il resto appostati; nessun rallentamento
    (tick peggiore 4-6 ms, a parte la costruzione dei grafi al primo tick).
    Da valutare: schegge d'osso al posto del sangue quando lo colpisci, fischio del proiettile che ti sfiora.
  - **Proiettili più veloci, collisione "a spazzata"**: a 90 m/s il proiettile fa 1,5 m per tick, quindi non
    basta controllare dov'è arrivato (ti passerebbe attraverso): si controlla tutto il segmento percorso
    nel tick contro la scatola del giocatore **ingrandita del raggio del proiettile** (somma di Minkowski).
- **Calcio (melee)** [FATTO, da tarare]: **F** (il tasto destro ora è il **fuoco alternativo** delle armi). Colpisce **tutto** in un cono davanti
  (1,6 m, ±45°), 25 danni (mezzo ghoul base: è uno strumento, non l'arma principale), e **spinge via**
  (13 m/s in avanti, 5 m/s in alto): il ghoul vola via, interrompe artigliata e balzo, e resta a terra
  0,5 s. Si può calciare mentre si ricarica. Ricarica di 0,55 s.
- **Niente rigenerazione della salute.** La salute torna coi **medikit** lasciati dai nemici (vedi Stile → Risorse).

## 4. La mappa [DECISO: cittadina all'aperto]

**Una cittadina fantasma western sprofondata all'inferno.** Non deve essere realistica: va bene
un tocco **distopico e assurdo** — torri altissime collegate da ponti, edifici enormi che non
avrebbero senso, strutture sospese.

Possibili luoghi: strada principale, saloon, chiesa con campanile, ufficio dello sceriffo,
torre dell'acqua, ingresso di una miniera, binari con vagone, cimitero, forca.

### Tre livelli di altezza
1. **Strade** — spazio ampio, tanti nemici, munizioni. Il piano di battaglia.
2. **Tetti e balconate** — raggiungibili con salti e wall jump; al riparo dalle orde a terra
   ma **esposti** a volanti e pistoleri.
3. **Punti alti** (campanile, torri, ponti sospesi) — raggiungibili con catene di wall jump
   (e in futuro con il lazo). Contengono **ricompense temporanee**: si visitano, non si abitano.

### Stato attuale: greybox (`src/levels/town.ts`)
Cittadina 92 × 92 m chiusa da un canyon. Saloon (tetto 7,3 m, balconata a 3 m), chiesa (9,3 m)
con campanile (22 m), sceriffo (5,3 m), banca (8,3 m), torre dell'acqua (8 m), torri gemelle
(14 m) unite da un ponte sopra Main Street, piattaforme sospese tra i tetti, forca, cimitero,
vagoni. 4 sfiatatoi di vapore. Tutti i percorsi sono stati verificati in simulazione.

### Passata "corpo a corpo" (dopo il playtest dell'ondata 50) [FATTO]
Il playtest ha mostrato che la mappa era **troppo vuota**: interi quadranti di 20×20 m di terra
nuda e strade larghe 20 m, quindi bastava correre in tondo. Ora:
- **Edifici nuovi nei quadranti vuoti**: hotel (con scala di casse, tetto 5,3 m), impresario,
  stalla, deposito ferroviario, casa, bagni pubblici, ufficio del telegrafo, armeria, magazzino (scala
  di casse, tetto 6,3 m), ingresso della miniera. La cittadina diventa una **griglia di strade e
  vicoli** (2,5–10 m) invece di una pista.
- **Linea del treno**: 4 vagoni in fila lungo x = 30, un muro con tre passaggi stretti (5–7 m).
- **Tettoie aperte** (forgia, segheria) e **portici** davanti a sceriffo e banca: ti nascondono
  dai Malocchi (serve la linea libera per sparare), ma non dai ghoul.
- **Ostacoli bassi in strada** (abbeveratoi, casse, diligenza, pozzo, carro, staccionata del
  cimitero): sotto 1 m li scavalcano tutti. Chi salta passa sopra mantenendo la velocità, chi corre
  a terra ci sbatte. Col bot di prova: girando in tondo **senza saltare** ci si incastra (velocità
  media 5,8 m/s invece di 8) e i ghoul ti raggiungono; **saltando** si subisce circa 4 volte meno danno.
- Tutti i vecchi percorsi verso l'alto restano invariati; i punti di spawn sono stati ricontrollati.
- Costo: da ~700 a ~840 draw call nella vista più pesante (+21%). Se pesa: static batching (§9).

![Pianta prima e dopo la passata corpo a corpo](map-close-quarters.png)

### Seconda passata: attraversare la mappa col movimento [FATTO]
Obiettivo: **premiare il movimento preciso** per spostarsi, non solo per schivare.
- **Strada alta**: tetti collegati da salti di precisione. Hotel → due **pilastri da 1×1 m** →
  impresario (si saltella da un pilastro all'altro senza fermarsi); hotel → due piattaforme sospese
  → saloon, che si collega alla rete di prima (piattaforme → chiesa → campanile); banca → armeria
  (salto nel vuoto) → cassa sull'angolo → magazzino.
- **Tetti bassi da wall jump**: un muro fino a ~4,5 m si scala con 3 wall jump ben cadenzati
  (provato col bot: funziona solo col tempismo giusto). Impresario, case, armeria, emporio, telegrafo.
- **Passaggi solo da slide** (1,1 m di luce; i ghoul sono alti 1,8 e fanno il giro): sotto la
  pedana fra i vagoni (varco centrale della ferrovia) e sotto il carro di Cross Street. Sono **vie di
  fuga** per chi sa scivolare.
- **Emporio in cui si entra**: porte a est e ovest, finestre a nord e sud (davanzale 0,8 m, ci si
  salta dentro). Dentro i Malocchi non ti vedono, ma i ghoul ti seguono: corpo a corpo vero, al chiuso.
- Tutti i percorsi sono verificati con un giocatore simulato (fisica vera, comandi scritti a mano).
- Draw call: fino a ~930 nella vista più carica. Lo **static batching** (§9) sta diventando utile.

### Regole pratiche emerse (vincoli del movimento attuale)
- **Salto massimo ≈ 1,17 m**: gradini e scalini al massimo **1 m**.
- **Salto in corsa ≈ 5,6 m** di distanza: gap tra piattaforme ≤ 3–4 m per stare comodi.
- **Wall jump in stile Apex**: spinta forte verso l'alto, piccola spinta via dal muro e
  **velocità lungo il muro** nella direzione in cui guardi.
  - Guardando il muro e concatenando i 3 wall jump si sale di **≈4,5 m** su una parete singola.
  - Guardando lungo il muro il wall jump è uno slancio in avanti (+2,5 m/s).
  - Oltre i ~4,5 m servono sfiatatoi, percorsi a gradini o (in futuro) il lazo.
- **Bunny hop facilitato**: finestra di 0,12 s dopo l'atterraggio senza attrito, e ogni hop
  riuscito dà velocità extra che cala con la velocità (8 → 13 m/s in ~8 hop tenendo solo W).
  Nessun tetto rigido.

### Principi
- **Niente vicoli ciechi**: ogni percorso è un anello.
- **Linee di flusso**: percorsi che permettono di concatenare slide, salti e wall jump senza fermarsi.
- **Sfiatatoi di vapore** steampunk che lanciano in alto (jump pad).
- **Punti di aggancio** per il futuro lazo: pali, insegne, travi.

---

## 5. Gameplay loop

### Struttura della partita [FATTO: ondate stile CoD Zombies]
Ondate numerate (`src/sim/waves.ts`), sempre più dure, 8 s di pausa tra una e l'altra,
annunciate dalla campana della chiesa. Alla morte: riepilogo (ondata, uccisioni, punti) e
si ricomincia dall'ondata 1.

**Composizione casuale a budget [DECISO]**: niente ondate scritte a mano. Ogni tipo di nemico ha
un **peso** (quanto è pericoloso), ogni ondata un **budget** di peso; a ogni spawn si pesca un tipo
a caso tra quelli che il budget residuo si può permettere. Stesso budget, mix diverso in ogni
partita. Il ghoul pesa **1**, il Malocchio **2** e compare **dall'ondata 3** (`eyebatFromWave`):
le prime due ondate sono di soli ghoul, per scaldarsi. Il cane infernale pesa **3** e compare dall'ondata 5. Il toro pesa **5** e compare dall'ondata 7.
Il caso usa un generatore con **seed** (deterministico: stesso seed = stessa partita).

| Ondata | Budget (peso) | Corridori (tra i ghoul) | Salute (ghoul = Malocchio) |
|---|---|---|---|
| 1 | 6 | 0 | 50 |
| 4 | 13 | ~10% | 50 |
| 8 | 27 | ~50% | 50 |
| 10 | 36 | 60% | 100 |
| 20 | 98 | ~73% | 150 |
| 35+ | 247+ | 90% | 200 |

- Peso vivo insieme: 6 + 2·ondata (**max 40**, raggiunto all'ondata 17; prima era 24, raggiunto
  all'ondata 9, e da lì la pressione non cresceva più). La salute di tutti i nemici sale a gradini
  ogni 10 ondate, fino a ×4. Intervallo di spawn: da 2 s a 0,5 s.
- **Corridori** (dall'ondata 4): 5,4 m/s invece di 3,6, **occhi rossi**. +10% a ondata fino al 60%
  all'ondata 9, poi sempre più lentamente fino al **90% al picco**.
- **Pressione** (`wavePressure`): 0 all'ondata 1, sale fino a 1 all'**ondata 35** (`wavePeak`), poi
  resta lì. Al picco i Malocchi sparano ogni 1,5 s invece di 2,5 e i ghoul balzano ogni 1,5 s invece
  di 3. Il picco è attorno a 30–40 perché l'ondata 50 è già "late game" per un giocatore molto bravo.
- Bot di prova (gira in tondo, **non spara mai**: un limite superiore, un giocatore vero uccide):
  danni al minuto ghoul + palle di fuoco ≈ 340 (ondata 2), 500 (5), 780 (10), 1100 (35+).
  Prima di questi cambi: **0 a qualsiasi ondata**.
- **Dove nascono i nemici** (stile CoD Zombies / Left 4 Dead): 24 punti di spawn sparsi per tutta la
  cittadina (non solo ai bordi). A ogni spawn si preferisce un punto **fuori vista** (un muro tra
  i tuoi occhi e il punto), tra 15 e 40 m, e nel 70% dei casi **davanti a te** (entro 60° dalla
  direzione in cui corri). Girare in tondo non vuol più dire trascinarsi l'orda dietro: ti porta
  dritto nella prossima.
- **Punteggio** stile CoD: 10 per colpo, 100 per uccisione. **Non si spende**: misura solo quanto
  hai giocato bene (riepilogo alla morte, in futuro record e classifica).

### Economia: il vildenaro [DECISO]
Punteggio e moneta sono **separati**:
- **Punteggio**: quanto hai giocato bene.
- **Vildenaro**: la moneta della partita. Si spende negli **shop** per **comprare armi e potenziamenti**.
- **Lo Stile moltiplica entrambi**: chi si muove bene fa più punti *e* diventa più forte prima.
  È un effetto valanga voluto (pilastro "movimento come potere").

**Shop** [DECISO]
- Uno o più, in una parte della mappa. Si comprano le **armi** (si parte col solo revolver; la
  doppietta si compra) e i **potenziamenti**.
- **Venditore**: un **NPC disegnato come sprite** (stile Doom, come i nemici), a tema. I nemici lo
  ignorano. **Aspetto** [FATTO]: mercante infernale pallido col cilindro, finanziera rosso sangue, panciotto
  senape con la catena d'oro, occhi accesi, ghigno coi denti d'oro e un **braccio meccanico d'ottone**
  (ingranaggio al gomito, pistone, artiglio a tre dita che tamburella spazientito sul bancone).
- **Menu che NON mette in pausa**: ti avvicini al venditore, premi **E** e il menu si apre sopra il
  gioco mentre l'orda continua ad arrivare. **Sempre aperto, anche a metà ondata**: chi vuole comprare
  durante il round deve farlo in fretta. Funziona uguale in multiplayer (lì il tempo non si può fermare).
- **Armeria** [FATTO: passo 1, il posto]: al **piano di sopra del GUNSMITH** (sud-est, tra la torre est e
  il magazzino), che ora ha due piani e una pianta più grande (8 × 7 m, dentro 7,4 × 6,4). **Niente
  scale: ci si arriva col parkour**, ma **entrare e uscire non deve essere la parte difficile**: tre
  entrate larghe. **Est**: una scala di casse lungo il muro fino alla porta di carico. **Sud**: gradini
  di casse → tetto del magazzino (6,3 m) → salto di 1,2 m verso ovest sul **balcone** (profondo 1,8 m;
  frena in aria, il salto è corto) → porta larga. **Ovest**: un finestrone basso (davanzale a 0,5 m), per
  chi scende dalla torre est o sale a wall jump. Dal tetto del gunsmith (8 m: dalla banca o dalla torre)
  si scende anche sul balcone. Dentro: bancone lungo la parete nord, lanterna, due rastrelliere, il
  venditore dietro il bancone. (Primo tentativo troppo piccolo, 6 × 5 m con una finestra stretta: bocciato
  in playtest.)
- [PROPOSTO] **Emporio** per i potenziamenti (ci si entra già, e c'è un bancone con la lanterna).
  Lo shop non è un rifugio: i ghoul ti seguono dentro.
- **Menu col mouse libero** [FATTO], come il buy menu di CS:GO: vicino al venditore compare
  "E · COMMERCIA"; premendo E il cursore si libera e il pannello si apre a destra, **sopra il gioco
  che continua** (niente velo scuro: vedi l'orda arrivare). Intanto non miri e non spari, ma **ti muovi
  con WASD**. E (o "Chiudi") richiude e riprende il mouse; Esc chiude e mette in pausa, come sempre.
  Lo shop **si chiude** con E, con **Esc** e **allontanandosi** dal venditore (anche morendo). Chiudendo
  si riprende il mouse; se il browser non lo concede (vuole un click o un tasto recente), il gioco non va
  in pausa: compare "Clicca per riprendere la mira".
  Dentro: saluto del venditore, il tuo vildenaro, gli articoli col prezzo (rosso se non basta).
  **Prezzo della doppietta: 800** [DECISO per ora, da tarare] (un ghoul ne lascia 10, × lo Stile).
- **Acquisto** [FATTO]: **si parte col solo revolver**. Il click su "Compra" non tocca il gioco: diventa
  una richiesta nel comando di input del tick dopo, e la **simulazione** controlla tutto (venditore a
  portata, già tua, vildenaro) e risponde con un evento. Comprata, la doppietta arriva carica, con 12
  cartucce in tasca, e **finisce subito in mano** (la carabina: 1200, carica, con 24 proiettili). Senza soldi: la riga trema e il venditore ti sfotte.
  **Doppio click** [FATTO]: tutto il box dell'articolo è cliccabile; il primo click lo trasforma in
  "CONFERMA · paga 800 vildenaro", il secondo compra (la conferma scade dopo 3 s). Un click sbagliato
  di fretta, con l'orda alla porta, non deve costare 800.
  Le armi comprate si perdono alla morte (si ricomincia da capo). Le **munizioni cadono solo per le armi
  che possiedi** (niente cartucce finché non hai la doppietta).

**Vildenaro come drop** [DECISO]
- **Monete lasciate dai nemici**, raccolte passandoci sopra (prendono il posto delle vecchie "anime"):
  altro motivo per muoversi. Si riusa il sistema dei raccoglibili, ma le monete si raccolgono
  **sempre** (non c'è un massimo) e spariscono anche loro dopo un po'.
- **Quante** [DECISO, da tarare]: ogni nemico lascia **sempre** monete (non è un tiro di dado come
  munizioni e medikit), **tante quanto il suo peso**: ghoul 1, Malocchio 2, cane 3, toro 5. Ogni moneta
  vale **10**. Schizzano fuori dal corpo insieme agli altri drop (ognuna cade dove capita: un toro che muore
  sul bordo di un tetto ne lascia un po' sul tetto e un po' in strada). Restano a terra **15 s** (le altre cose 10).
- **Lo Stile moltiplica il valore al momento dell'uccisione** [DECISO] (il valore è già scritto sulla
  moneta quando cade): conta quanto eri stiloso quando hai ucciso, non quando raccogli. Se la catena si
  spezza prima che tu la raccolga, la moneta vale lo stesso.
- **Passo 1** [FATTO]: monete nella simulazione (`player.money`, si azzera alla morte), sprite di una
  **piletta di monete d'oro** (due pile disordinate, niente moneta che gira alla Mario), pozza di
  luce dorata, "ka-ching", contatore provvisorio sotto le uccisioni.
- **Passo 2** [FATTO]: **contatore nell'HUD**, in alto a destra sotto i punti: la stessa piletta del
  raccoglibile e il numero in oro che **sale come un registratore di cassa** (non salta: i soldi che
  "scorrono" sembrano di più). Sotto, un **"+N"** che somma tutto quello che raccogli di fila (le cinque
  pilette di un toro = un "+50") e poi svanisce.
- **Passo 3** [FATTO, da tarare]: **moltiplicatore dello Stile** su punti e vildenaro: ×1 a D, +0,5 per
  ogni rank (C ×1,5, B ×2, A ×2,5, S ×3, SS ×3,5), **×4 per tutto HIGH NOON**. Si legge col rank che avevi
  quando hai premuto il grilletto (non con quello che quell'uccisione ti fa raggiungere). Sul meter dello
  Stile, sotto la barra, c'è scritto quanto vale il rank ("×2,5").

**Progressione nella partita** [DECISO, novembre 2026]: due strati con ruoli netti.
- **Potenziamenti delle armi**: si comprano all'armeria col vildenaro, scegliendo 1 carta tra 3 pescate
  dal mazzo dell'arma. È lo strato affidabile, quello su cui si pianifica. Vedi §6c.
- **Patti**: vengono dagli **eventi sulla mappa** (sotto). È lo strato di rischio e caso, quello che
  rende diversa ogni partita. [DA DECIDERE: l'elenco dei patti]
- **Niente meta-progressione** che renda più forte la partita dopo (almeno per la v1). Se un giorno
  servirà, solo sblocchi "orizzontali" (carte o patti nuovi nel mazzo), mai statistiche.
- **Niente level-up a esperienza** con un menu ogni 30 s: il gioco non si ferma, e la build non deve
  sostituire mira e movimento (al contrario dei survivor-like come Megabonk, dove l'attacco è automatico).
- Scartato: **arma che sale di livello usandola** (stile Roboquest). Spingerebbe a usare sempre la stessa
  arma (noi vogliamo il contrario: munizioni separate, premio "cambio lampo"), sarebbe un secondo binario
  di potere che non passa dallo Stile, e il livello arriverebbe nel mezzo di uno scontro.

[DA DECIDERE]
- Potenziamenti del **movimento** (wall jump extra, doppio salto, slide più lungo, lazo più lungo):
  carte dell'emporio o patti?
- Si comprano anche le munizioni?

**Eventi sulla mappa** [DECISO l'idea, da progettare]: ogni tot ondate compare un evento (stile gli
eventi di Diablo 4) **durante un'ondata**, annunciato e facoltativo. Avviarlo **costa vildenaro**
(tensione voluta: potenziamento sicuro allo shop o scommessa?); completarlo dà la scelta di un **patto**
a caso o il **livello successivo di un patto che hai già**.
- Gli obiettivi devono **far muovere**, non tenere fermi in un cerchio (sarebbe camping per regolamento):
  uccisioni dentro un raggio largo (15–20 m), più punti in sequenza (tre campane sui tetti in 60 s),
  trasportare qualcosa (un teschio fino all'altare), un bersaglio marcato da uccidere prima che scappi,
  raggiungere un rank di Stile vicino all'altare. "Resta qui" solo se la zona si sposta.
- Fallire non deve voler dire solo soldi buttati: rimborso parziale o un patto "scarso" (1 su 2).
- I livelli dei patti salgono **a salti interi** ("rimette 1 colpo" → "2 colpi"), mai +10%.

---

### Bersagli d'acciaio [DECISO: tenerli]
I bersagli di prova (piatti d'acciaio su palo, 3 colpi, si rialzano) restano: serviranno per un
futuro **poligono di tiro / tutorial**.

## 6. Armi (bozza)

- **Revolver** — preciso, hitscan. **Fanning** [FATTO, da tarare] col tasto destro: una pressione svuota
  **tutto il tamburo** in raffica (un colpo ogni 0,08 s invece di 0,22), ma ogni proiettile devia a caso
  fino a 5° dalla mira. Tanto danno in un attimo, solo da vicino (ghoul addosso, toro stordito). Dopo
  la raffica 0,3 s di recupero; R durante la raffica aspetta che finisca; cambiare arma la interrompe.
- **Doppietta (canne mozze)** [FATTO] — tasto 2. Due colpi, 12 pallini in una **rosata fissa** (non casuale:
  impari cosa fa), danno pieno fino a 6 m e poi in calo fino al 25% a 22 m: devastante da vicino, quasi
  inutile lontano. Ricarica da sola quando le canne sono vuote. **A bruciapelo (entro 5 m) i nemici volano
  via** come col calcio, più forte quanto più sei vicino e quanti più pallini vanno a segno.
  **Contraccolpo che non frena mai**: sparare indietro ti dà un piccolo boost in avanti, sparare dove stai
  andando non ti rallenta; in aria, sparare verso il basso ti spinge su (annulla la caduta: shotgun jump),
  sparare in alto non ti schiaccia a terra.
  **Si compra all'armeria** per 800 vildenaro (si parte col solo revolver).
- **Carabina a leva** [FATTO, da tarare] — tasto 3. L'arma **per i nemici lontani e i colpi critici**:
  75 danni al corpo (1,5× il revolver), **critico ×4** (300: una testa uccide quasi tutto), 8 colpi nel
  serbatoio, un colpo ogni **0,62 s** (il tempo di **azionare la leva**, che è il pezzo forte
  dell'animazione). **Usa gli stessi proiettili del revolver** (.44-40, come Colt e Winchester del 1873:
  la tasca è una sola), così non serve un nuovo tipo di munizione a terra. **Dall'anca non è precisa**
  (fino a 2,5° fuori mira, a caso); **col tasto destro si mira dal mirino (ADS)**: zoom (FOV 75 → 50),
  mouse più lento in proporzione, precisione perfetta, mirino a croce nascosto, meno rinculo. Mirare
  richiede 0,18 s e non si può durante la ricarica. **Ricarica un colpo alla volta** dallo sportello
  laterale (0,3 s per portarla allo sportello + 0,38 s a colpo): un click la interrompe e spari (dopo
  0,12 s). **Si compra all'armeria** per 1200 vildenaro, con 24 proiettili in tasca.
- **Fuoco alternativo (tasto destro)** [DECISO]: ogni arma può averne uno. Revolver: fanning;
  carabina: mira dal mirino; doppietta: da decidere.
- **Lazo / rampino** — mobilità (aggancio a punti della mappa) e utilità (tirare a sé i nemici?).

---

## 6c. Potenziamenti delle armi [DECISO il sistema, PROPOSTO il dettaglio]

**Come funziona**
- All'**armeria**, per ogni arma che possiedi c'è "Potenzia". Il bancone mostra **2 carte pescate a caso**
  dal **mazzo di quell'arma**: ne compri una. Il prezzo **sale a ogni livello** dell'arma (come il
  Pack-a-Punch). [DA TARARE: es. 500 / 1000 / 2000; quanti livelli al massimo per arma]
- **Rimescolare costa** (es. 100 vildenaro): il caso diventa una decisione, non una condanna.
- La pescata resta **salvata nello stato** finché non compri o rimescoli: chiudere e riaprire lo shop
  non pesca carte nuove gratis. La pesca usa il generatore col seed (`rng` del `GameState`).
- Ogni carta si prende **una volta sola**; presa, esce dal mazzo. Alcune carte sono **esclusive tra loro**:
  prenderne una toglie l'altra dal mazzo (è lì che sopravvivono i "bivi").
- Si perdono alla morte, come le armi. Tutto deciso dalla **simulazione** (un domani lo fa il server).
- Regole per ogni carta: cambia **come** giochi, non solo quanto sei forte; il danno sale **a salti interi**
  (regola dei breakpoint, §3), mai a percentuali; l'effetto **si vede o si sente**.

**Mazzo del revolver** (7 carte)
- **Tamburo del becchino**: 8 colpi invece di 6; il fanning svuota tutto il tamburo. [FATTA]
- **Mano lesta**: fanning più stretto e veloce; ogni uccisione durante la raffica aggiunge un colpo alla raffica (gratis). [FATTA]
- **Ricochet**: dopo un headshot (o un critico) il colpo rimbalza sul corpo del nemico più vicino (entro 12 m, in vista, danno 50, un rimbalzo solo). [FATTA]
- **Ricarica in scivolata**: scivolare rimette un colpo nel tamburo ogni 0,3 s. [FATTA]
- **Ultimo colpo**: l'ultimo proiettile del tamburo esplode (raggio 3 m, 100 danni = due colpi al corpo, non attraverso i muri). [FATTA]
- **Tamburo veloce**: ricarica più rapida di un terzo. [FATTA]
- **Colpo da cavaliere**: il primo colpo dopo un wall jump è un critico garantito (finché non tocchi terra). [FATTA]

**Mazzo della doppietta** (9 carte) [FATTO]
- **Canne lunghe**: rosata stretta (×0,6), danno pieno fino a 8 m (oggi 6).
- **Fiato di drago**: pallini incendiari, il nemico brucia per 2 s (10 danni ogni 0,5 s). Come carta **senza
  il malus** "meno spinta" che aveva come bivio [DECISO].
- **Mulo**: contraccolpo doppio, shotgun jump enorme. **Esclusiva con Calcio di piombo.**
- **Calcio di piombo**: nessun contraccolpo, spinta doppia sui nemici; chi sbatte contro un muro entro 0,8 s prende 50 danni.
- **Bruciapelo fortunato**: uccidere a bruciapelo (entro 5 m) rimette la cartuccia.
- **Doppio botto**: con due cartucce in canna il primo sparo fa partire le due canne insieme (due rosate, doppio contraccolpo).
- **Volo di piombo**: lo shotgun jump (sparo verso il basso in aria) non consuma la cartuccia se uccidi qualcuno prima di
  toccare terra (torna nella canna, o in tasca se la canna è piena).
- **Pallini rimbalzanti**: i pallini che toccano il pavimento rimbalzano una volta (il calo col danno conta tutto il percorso).
- **Spinta di gruppo**: la spinta a bruciapelo lancia anche chi sta entro 2,5 m dietro al primo nemico (al 70%).

**Mazzo della carabina** (7 carte)
- **Duellante**: dopo 1,5 s senza sparare il colpo successivo fa danno doppio (150 al corpo, 600 critico),
  con un "tic" quando è pronto.
- **Leva da pistolero**: niente imprecisione dall'anca (in aria e a terra) e leva più veloce. Mirare
  serve ancora per lo zoom e per Cannocchiale.
- **Perforante**: il colpo attraversa tutti i nemici in fila.
- **Cannocchiale**: zoom più forte; mirando il critico vale ×6 invece di ×4.
- **Quickscope**: un colpo entro 0,2 s dall'inizio della mira è un critico garantito.
- **Marchio**: il colpo marca il nemico, il colpo successivo su di lui fa danno doppio.
- **Due alla volta**: la ricarica infila due colpi per volta.

**Stato** [FATTO: passo 1] la simulazione (`src/sim/upgrades.ts`): mazzi, pescata, prezzo che cresce,
acquisto controllato dalla simulazione (armeria a portata, arma tua, carta sul bancone, soldi) e la prima
carta, **Tamburo del becchino**. Il pannello dello shop non mostra ancora le carte: per provarla c'è un
bottone nel pannello debug. Il modello 3D del revolver ha 6 camere: con 8 colpi l'animazione di ricarica
ne mostra comunque 6 (le munizioni a schermo sono giuste).
**Passo 2** [FATTO]: le carte **nel pannello dello shop**, sotto le armi: per ogni arma che possiedi un titolo
"Potenzia: Revolver" con il livello a rombi (◆ preso, ◇ libero), le carte del bancone come box cliccabili col
solito doppio click, prezzo rosso se non basta. Dopo un acquisto la lista si ricostruisce con la nuova pescata;
a mazzo finito "Per quest'arma non ho altro", al livello massimo "Al massimo". Le armi senza carte non mostrano
la sezione.
**Passo 3** [FATTO]: **interfaccia a due pannelli**. Nell'elenco dell'armeria c'è anche il **revolver** (sempre tuo);
su un'arma che possiedi il prezzo diventa **"POTENZIA"**, e il click apre **a sinistra** dello shop il pannello
dei potenziamenti di quell'arma (titolo, livello a rombi, le carte, "Scegli un potenziamento. Il prossimo costerà
di più."); un altro click sulla stessa arma lo chiude. **Due carte** sul bancone invece di tre (`upgradeOfferSize`).
**Passo 4** [FATTO, da tarare]: altre tre carte del revolver (4 in tutto). **Tamburo veloce**: ricarica in 2/3 del
tempo (animazione e suoni si accorciano con lei). **Ricarica in scivolata**: un colpo dalla tasca ogni 0,3 s di
scivolata col revolver in mano (non durante ricarica o fanning; il timer riparte a ogni scivolata, così non si
sfrutta a colpetti). **Colpo da cavaliere**: dopo un wall jump il primo colpo è critico ovunque colpisca, finché
non tocchi terra (un colpo a vuoto lo spreca; vale anche per il primo colpo del fanning).
**Passo 5** [FATTO]: il mazzo del revolver è completo (7 carte). Il rimescolamento è rimandato.

Scartate: Proiettili d'argento, Rimbalzo (carabina), Colpo di grazia, Polso fermo, Mozzata corta,
Leva in corsa, Sangue freddo, Ottone caldo.

---

## 6b. HUD [FATTO]
- **Stile "sangue e cenere"**: niente cornici né targhe (risultavano comiche), elementi appoggiati
  sullo schermo come in Prodeus, colori presi dalla scena (rosso sangue secco, ottone opaco, cenere),
  leggibili grazie a una macchia scura sfumata negli angoli e a ombre sfocate, non a contorni da fumetto.
- **Basso a sinistra**: numero della salute (pulsa come un battito quando è bassa) e barra con la
  fascia "fantasma" del colpo subito. [FATTO]
- **In alto**: a sinistra l'**ondata** (numero rosso, come il conteggio dei round di CoD Zombies),
  a destra **punti e uccisioni**. [FATTO]
- **Basso a destra**: munizioni, colpi disegnati con forma diversa per arma + riserva. [FATTO]
- **Attacco in arrivo da fuori schermo**: freccia arancio lampeggiante intorno al mirino dalla parte
  del nemico durante i preavvisi (balzo del ghoul, carica del Malocchio, carica del cane, mira e carica
  del toro). Sparisce appena il nemico è sullo schermo. [FATTO]
- **Al centro**: scritte delle ondate (titolo rosso sangue con animazione a timbro, riga color cenere),
  HIGH NOON color ferro rovente, conto alla rovescia; **morte**: sipario scuro con le statistiche
  e un rintocco funebre, che nasconde il ritorno all'ondata 1. [FATTO]
- **Vita bassa** (sotto il 35%): stile CoD, sangue scuro che entra dai bordi, immagine che perde colore,
  battito del cuore (visivo e sonoro) sempre più veloce. [FATTO]
- **Colpo subito**: deve sentirsi e deve dire **da dove** arriva: arco rosso intorno al mirino che punta
  verso il colpo (anche mentre ti giri), la testa spinta via dal colpo (molla smorzata), lampo rosso. [FATTO]
- **Mappa (tieni premuto Tab)**: la cittadina vista dall'alto con il nord in alto, edifici più chiari
  quanto più sono alti; nemici come puntini rossi, tu come freccia, shop (piletta di monete + nome) e
  sfiatatoi. Serve soprattutto a fine ondata per trovare l'ultimo nemico: con 3 o meno rimasti ogni
  puntino manda un "ping" radar. Il gioco non si ferma mentre la guardi. [FATTO]
  [DA DECIDERE] mostrare se un nemico è sopra o sotto di te (tetti); minimappa sempre visibile in un angolo?

## 7. Ordine di sviluppo

1. **Mappa in greybox** — la cittadina fatta di box, per provare percorsi e verticalità col movimento attuale.
2. **Revolver** — viewmodel segnaposto, sparo hitscan, feedback.
3. **Due nemici prototipo**: avvoltoio (volante) e ghoul che salta (grafo di navigazione).
4. **Loop minimo**: ondate, anime, salute dalle uccisioni, meter dello stile.
5. Altri nemici, potenziamenti, lazo, boss.

### Prossimi passi [PROPOSTO, novembre 2026]
1. **Stile**: punti e catena nella simulazione (numeri nella riga di debug). [FATTO]
2. Barra e rank dello stile nell'HUD. [FATTO, col timer della catena]
3. Fonti dal movimento (velocità, tempo in aria, wall jump) + premio calante per le azioni ripetute.
4. **Climax HIGH NOON** (5 s di caricatore infinito). [FATTO: meccanica, tinta, suoni, fine]
5. **Vildenaro**: monete lasciate dai nemici + contatore nell'HUD; lo Stile moltiplica punti e vildenaro.
   [FATTO: monete, contatore, moltiplicatore]
6. **Shop**: venditore (sprite), tasto E, menu che non mette in pausa, primo acquisto: la doppietta.
   [FATTO: armeria, venditore, tasto E e menu, acquisto della doppietta]
7. **Potenziamenti delle armi** all'armeria (mazzi di carte, §6c), poi **eventi e patti**.
8. Lazo / rampino.

---

## 8. Domande aperte

- Struttura definitiva della partita (ondate vs run a tempo) e cosa succede tra le ondate.
- Nomi definitivi dei rank di stile.
- Morte: si ricomincia da capo (niente progressione persistente per la v1, vedi §5).
- Elenco dei patti e degli eventi.
- Multiplayer co-op alle orde (in futuro): come si condivide lo stile?

---

## 9. Prestazioni: regole e ottimizzazioni rimandate

**Regola: prima misura, poi ottimizza.** Le ottimizzazioni complicano il codice: si fanno solo
quando una misura (l'indicatore in basso a sinistra: fps, ms di simulazione e di disegno,
draw call) mostra che servono, e solo nel punto che costa. Eccezione: le scelte corrette per
costruzione che non complicano nulla (es. il limite di voci per i versi dei nemici).

### Misure (simulazione, novembre 2026)
| Ghoul | Costo per tick | Quota di un fotogramma a 60 fps |
|---|---|---|
| 100 | 0,24 ms | 1,4% |
| 200 | 0,8 ms | 5% |
| 400 | 2,6 ms | 16% |
| 800 | 10,4 ms | 63% |

### Ottimizzazioni pronte all'uso (quando servono)
| Ottimizzazione | Quando farla | Cosa risolve |
|---|---|---|
| **Static batching**: unire tutte le mesh statiche del livello e dei props in poche mesh (una per materiale) | se le draw call pesano: oggi ~470 con 4 ghoul, quasi tutte dal livello e dai props (ogni pezzo è un oggetto, ×2 per le ombre) | costo per-oggetto della geometria che non si muove mai |
| **Instancing degli sprite** (un'unica draw call per tutti i ghoul) | draw call > ~300 o fps che calano con molti nemici | costo per-oggetto del disegno (oggi 2 draw call per ghoul: corpo + ombra) |
| **Griglia spaziale** per la separazione | > ~200 nemici insieme | costo O(N²) della separazione (ogni ghoul controlla tutti gli altri) |
| **Ombre "a macchia"** per i nemici lontani | se le ombre pesano (molti nemici visibili) | ogni nemico viene disegnato 2 volte (scena + shadow map) |
| **IA a frequenza ridotta** per i nemici lontani | > ~300 nemici | ricalcoli inutili per chi è lontano |
| **Interest management** di rete | multiplayer | banda: mandare a ogni client solo i nemici vicini |
