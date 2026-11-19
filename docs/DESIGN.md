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

### Cosa lo fa scendere
- Il tempo (decadimento costante, più veloce ai rank alti).
- Stare fermi o lenti: il decadimento accelera.
- Subire danni: perdi punti di stile.

### A cosa serve
- **Moltiplicatore** su anime/XP raccolte e punteggio.
- Bonus di danno ai rank alti.
- [DA DECIDERE] Eventuale bonus di drop della salute ai rank alti.

### Risorse dall'aggressività [PROPOSTO]
- Niente rigenerazione della salute: la salute cade dai nemici uccisi.
- Munizioni sparse per la mappa: chi resta fermo le finisce.

---

## 3. Nemici

Regola d'oro: **i nemici attaccano lo spazio, non solo il giocatore**. Ogni tipo mette una
pressione diversa. Proiettili nemici quasi sempre **lenti e visibili**; colpi istantanei solo
con un chiaro preavviso.

| Nemico (provvisorio) | Ruolo | Pressione |
|---|---|---|
| **Ghoul** | Carne da cannone (ispirato agli zombie di CoD Zombies): cammina verso di te, **scavalca gli ostacoli bassi e aggira quelli alti**; in futuro si arrampicherà | A terra non sei mai al sicuro; un muretto non basta |
| **Segugio infernale** | Balzi lunghi e precisi, anche su piattaforme | Devi muoverti continuamente |
| **Avvoltoio** | Volante, gira in cerchio e picchia in picchiata | Raggiunge ogni tetto, obbliga a guardare in alto |
| **Fuoco fatuo** | Volante a distanza, proiettili lenti | Il movimento diventa difesa |
| **Pistolero scheletro** | A distanza, colpo istantaneo **annunciato** (luccichio + click) | Punisce chi sta fermo in vista, premia chi rompe la linea di tiro |
| **Dinamitardo** | Lancia dinamite ad arco, lascia fiamme | Nega zone: ti costringe a spostarti |
| **Toro / Bruto** | Lento, corazzato, carica devastante | Si schiva di lato o si scavalca |
| **Boss** | Pattern complessi, ogni tot ondate | Picco di intensità |

Stile: **sprite 2D** (tipo Doom), coerenti con il resto.

### Nota tecnica: navigazione
- I nemici a terra devono saper **saltare e arrampicarsi**: serve un **grafo di navigazione**
  (superfici calpestabili come nodi + link "cammina / salta / arrampicati / cadi"), generato
  automaticamente dai box del livello. Un flow field 2D non basta per la verticalità.
- I volanti usano uno steering 3D semplice che evita gli ostacoli.

---

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

### Struttura della partita [DA DECIDERE]
Orientamento attuale: **a ondate stile CoD Zombies** (ondate numerate, sempre più dure, pausa
breve tra un'ondata e l'altra). Alternativa: run continua a tempo con level-up alla Megabonk.

Elementi indipendenti dalla scelta:
- I nemici lasciano **anime** (XP/valuta) da raccogliere passandoci sopra; svaniscono dopo
  qualche secondo → altro motivo per muoversi.
- **Potenziamenti** che includono anche il **movimento** (wall jump extra, doppio salto, scatto,
  slide più lungo, lazo più lungo).
- **Eventi sulla mappa** che spostano il giocatore (altari da attivare, forzieri sui punti alti).

[DA DECIDERE] Tra un'ondata e l'altra: negozio? scelta di potenziamenti? macchinette tipo
"Perk-a-Cola" sparse per la mappa (a tema: santuari / altari del diavolo)?

---

### Bersagli d'acciaio [DECISO: tenerli]
I bersagli di prova (piatti d'acciaio su palo, 3 colpi, si rialzano) restano: serviranno per un
futuro **poligono di tiro / tutorial**.

## 6. Armi (bozza)

- **Revolver** — preciso, hitscan, "fanning" (raffica rapida col tasto destro).
- **Canne mozze** — rosa di pallini, contraccolpo che ti spinge (anche come tecnica di movimento).
- **Lazo / rampino** — mobilità (aggancio a punti della mappa) e utilità (tirare a sé i nemici?).

---

## 7. Ordine di sviluppo

1. **Mappa in greybox** — la cittadina fatta di box, per provare percorsi e verticalità col movimento attuale.
2. **Revolver** — viewmodel segnaposto, sparo hitscan, feedback.
3. **Due nemici prototipo**: avvoltoio (volante) e ghoul che salta (grafo di navigazione).
4. **Loop minimo**: ondate, anime, salute dalle uccisioni, meter dello stile.
5. Altri nemici, potenziamenti, lazo, boss.

---

## 8. Domande aperte

- Struttura definitiva della partita (ondate vs run a tempo) e cosa succede tra le ondate.
- Nomi definitivi dei rank di stile.
- Morte: si ricomincia da capo? Progressione persistente tra le partite?
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
