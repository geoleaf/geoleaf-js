# Carte du fonctionnement — qui fait quoi

> **À quoi sert cette page.** Répondre à « qui fait quoi » **sans lire le code ni la doc**.
> Chaque nœud porte son chemin : le graphe est un **index de navigation**, pas une illustration.
> On regarde le graphe, on lit le chemin, on ouvre le bon fichier.
>
> **Autorité.** [`docs/specs/CDC_kernel.md`](../specs/CDC_kernel.md) pour le kernel et le boot ;
> [`DIRECTION.md`](../../packages/core/docs/DIRECTION.md) pour le périmètre produit.
> ⚠️ `docs/specs/contrats/INITIALIZATION_FLOW.md` porte un diagramme de séquence
> **partiellement périmé** — il cite encore un plugin de stockage, POI et `app/init.ts`. Ne rien
> en dériver.
>
> **Ce que cette page n'est pas.** Elle ne documente aucun usage (→
> [`GETTING_STARTED`](../../packages/core/docs/GETTING_STARTED.md)) et ne spécifie aucun contrat
> (→ [`specs/`](../specs/CDC_kernel.md)). Elle **renvoie** aux deux.

---

## Vue 1 — La carte des acteurs

Les **quatre canaux** par lesquels un plugin atteint le core sont dessinés comme **quatre arêtes
distinctes en pointillé**, et aucun n'est un `import` : c'est la forme que la règle
`no-plugin-in-core` impose. L'**ordre de chargement**, lui, n'est pas ici — il est en vue 2.

📌 **Lire les chemins.** Dans les étages ② et ③, ils sont relatifs à
`packages/core/src/` — `kernel/`, `capabilities/`, `api/`, `app/`, `adapters/maplibre/`.
Partout ailleurs ils partent de la racine du dépôt.

```mermaid
flowchart TD
    subgraph HOTE["① L'HÔTE — ce que l'intégrateur écrit"]
        IDX["index.html<br/>fixe l'ordre de chargement"]
        INIT["init.js<br/>appelle GeoLeaf.boot"]
        PROF[/"profiles/<br/>LA SOURCE UNIQUE<br/>un profil JSON = toute l'application"/]
    end

    subgraph SURF["② LA SURFACE PUBLIQUE — ce qu'on appelle"]
        FACADE["30 façades PURES<br/>api/geoleaf.*.ts<br/>exposent GeoLeaf.*"]
        REG["Les 3 REGISTRES<br/>Plugin · Capability — kernel/api/<br/>Module — app/module-registry.ts"]
    end

    subgraph ENG["③ LE MOTEUR — le core"]
        KERNEL["kernel/ — 13 sous-systèmes<br/>config · geojson · themes · storage<br/>security · events · ui · layer-manager…"]
        CAPS["capabilities/ — 21 capacités<br/>offline · filter · legend · pwa · labels…<br/>lien TYPÉ, jamais le global"]
        ADAPT["adapters/maplibre/ — 22 fichiers<br/>LE SEUL endroit qui parle MapLibre<br/>derrière IMapAdapter"]
    end

    subgraph ADD["④ CE QUI S'AJOUTE"]
        PLUG["15 PLUGINS — packages/plugins/<br/>editor · connector · offline-ui · table<br/>print · measure · geocoding · cog…"]
        LIBS["2 LIBS — packages/libs/<br/>host-runtime · field-renderer"]
    end

    ML(["MapLibre GL JS 6 — peerDependency, HORS bundle<br/>le global est reposé par vendor/maplibre-gl/global.mjs"])

    subgraph DEV["⑤ L'APPAREIL — ce qui tient sans réseau"]
        IDB[("IndexedDB geoleaf-db v5<br/>features · outbox · layers<br/>local_images · routes")]
        SW["sw-core.js — UN seul, pour<br/>toutes les variantes livrées"]
        CACHE[("Cache API<br/>shell + tuiles")]
    end

    subgraph SRV["⑥ LE SERVEUR — trois endpoints DÉCLARATIFS, aucun produit nommé"]
        WRITE(["write.endpoint<br/>écriture, PAR COUCHE"])
        PULL(["offline.source.url<br/>rapatriement — PAS la source d'affichage"])
        UP(["uploadEndpoint<br/>photos, PAR CHAMP"])
    end

    IDX --> FACADE
    INIT --> REG
    PROF -->|"lu au boot, puis fusionné"| KERNEL
    FACADE -->|"réexporte, sans logique"| KERNEL
    REG -->|"tri topologique, init awaité"| CAPS
    CAPS -->|"R.8 : baril, hub de types ou seam —<br/>jamais un import profond"| KERNEL
    KERNEL -->|"ne connaît QUE IMapAdapter"| ADAPT
    ADAPT --> ML

    PLUG -.->|"① événements DOM typés"| FACADE
    PLUG -.->|"② seams INVERSÉS — le plugin pousse,<br/>le core itère"| KERNEL
    PLUG -.->|"③ chargeur de couche plugin:id"| REG
    PLUG -.->|"④ globalThis.GeoLeaf.* — JAMAIS un import"| FACADE
    LIBS --> PLUG

    CAPS -->|"capabilities/offline — chunk dynamique,<br/>HORS du chemin de boot"| IDB
    CAPS -->|"enregistre, par la capacité pwa"| SW
    SW --> CACHE
    SW -->|"lit tuiles et couches"| IDB
    IDB -->|"rejeu du drain"| WRITE
    CAPS -->|"rapatrie, page par page"| PULL
    PLUG -->|"POST multipart"| UP

    classDef ext fill:#eef4fb,stroke:#2b6cb0,color:#12324f
    classDef gen fill:#f7f3e8,stroke:#b8860b,color:#4a3a09
    classDef dev fill:#f3eef7,stroke:#7a4fa3,color:#331a47
    class ML,WRITE,PULL,UP ext
    class PROF gen
    class IDB,CACHE,SW dev
```

### Répondre à une question avec ce graphe

| Ma question                           | Le nœud à regarder                              | Où j'ouvre                                                                                        |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| La carte ne s'affiche pas du tout     | le nœud MapLibre, puis ①                        | `vendor/maplibre-gl/global.mjs` — et **le type MIME `.mjs` du serveur** : sans lui, rien ne boote |
| Dans quel ordre les choses se montent | ② et ③                                          | **Vue 2** ci-dessous                                                                              |
| Où se décide l'affichage d'une couche | ③ `kernel/` → `adapters/maplibre/`              | `packages/core/src/kernel/geojson/loader/single-layer.ts`                                         |
| Comment j'ajoute un comportement      | ④ — et la question est « capacité ou plugin ? » | §Dépendances et frontières de [`CDC_kernel.md`](../specs/CDC_kernel.md)                           |
| Comment un plugin parle au core       | les **quatre** arêtes en pointillé              | [`PLUGIN_ARCHITECTURE_SPEC.md`](../specs/contrats/PLUGIN_ARCHITECTURE_SPEC.md)                    |
| Où passe une écriture                 | ⑤ et ⑥                                          | **Vue 3** ci-dessous                                                                              |
| Qui parle à MapLibre                  | ③ `adapters/maplibre/` — **et lui seul**        | `packages/core/src/contracts/map-adapter.contract.ts`                                             |
| Où se configure tout ça               | le nœud `profiles/`                             | [`PROFILE_CONTRACT_SPEC.md`](../specs/contrats/PROFILE_CONTRACT_SPEC.md)                          |

---

## Vue 2 — Le boot, en DEUX phases

⚠️ **« B1→B11 » ne sont pas onze étapes d'exécution.** Ce sont des étiquettes historiques
regroupées dans **six** fichiers `globals.*`, et l'ordre est encodé par **l'ordre des `import`
ESM** — pas par une convention externe. Il n'existe pas de `globals.poi.ts` : tout « B10 POI »
décrit un état révolu.

La frontière entre les deux phases est la seule chose à retenir : **la phase A ne touche pas le
réseau et ne passe pas par les registres** — les façades sont un _prérequis_ des registres, pas
leur produit.

```mermaid
sequenceDiagram
    autonumber
    participant H as index.html
    participant V as global.mjs
    participant E as bundle-esm-entry.ts
    participant G as globals/ (6 fichiers)
    participant I as installBoot
    participant N as init.js (l'hôte)
    participant B as app/boot-core.ts
    participant R as Les registres
    participant J as GeoJSONModule
    participant T as kernel/themes

    Note over H,G: PHASE A — à l'import du bundle. Aucun réseau.
    H->>V: charge le shim
    V->>V: pose globalThis.maplibregl
    H->>E: charge dist/geoleaf.esm.js
    E->>G: import side-effect
    G->>G: globals.core — log, errors, sécurité (PREMIER)
    G->>G: globals.config — helpers, validateurs, config, map
    G->>G: globals.geojson — geojson, route
    G->>G: globals.ui — labels, légende, couches, thèmes
    G->>G: globals.storage — APRÈS l'UI, décision ADR-05
    G->>G: globals.api — 30 façades + PluginRegistry (DERNIER)
    E->>I: installBoot, exactement UNE fois par bundle
    I->>R: enregistre les 6 modules noyau
    Note over I,R: 6 modules, pas 8 : Security et API retirés,<br/>leurs sous-systèmes sont des façades pures
    I-->>N: expose GeoLeaf.boot

    Note over N,R: PHASE B — le runtime.
    N->>B: GeoLeaf.boot(beforeBoot)
    B->>B: beginBoot — watchdog armé, 45 s
    B->>B: loadConfig — configuration de base
    B->>R: Pass 1 — les DÉCLARATIONS, non gatées
    B->>R: Pass 2 — les MODULES, dans gatedModule
    Note over B,R: la Pass 2 ne lit AUCUNE config :<br/>la gate s'évalue dans init, sur la config effective
    B->>B: loadActiveProfileResources — le profil fusionné
    B->>N: hook beforeBoot — watchdog SUSPENDU
    N->>R: l'hôte charge ici ses plugins lazy
    Note over N,B: jeter dans ce hook interrompt le boot :<br/>c'est la gate d'authentification
    B->>R: registry.init — tri topologique, init awaité
    R->>J: init
    J->>J: attend le RÉSEAU — les couches du thème, par lots
    R->>T: applique le thème, par lots
    T-->>B: événement geoleaf:theme:applied
    B->>B: revealApp — retire le voile, resize, fitBounds
    Note over N,B: puis geoleaf:map:ready et geoleaf:app:ready.<br/>Un échec est SIGNALÉ, jamais un spinner muet.
```

**Le fait qui coûte cher à ignorer** : la révélation de l'application est conditionnée à
`geoleaf:theme:applied`. Un thème qui n'arrive jamais laisse le voile en place — c'est
`app/init-reveal.ts` qui le retire, et lui seul.

---

## Vue 3 — Le cycle d'écriture hors-ligne

C'est l'axe le plus différenciant du produit, et le moins lisible dans le code.

🛑 **Le chemin en ligne n'est PAS un repli.** La décision est prise **avant** l'écriture, sur la
**capacité de l'appareil à tenir la file** — jamais sur la météo du réseau. Une écriture ne
change donc **jamais de chemin en vol**. Le prédécesseur décidait par joignabilité et produisait
un doublon indétectable : le chemin en ligne ne mettait aucune identité client sur le fil, la
file oui.

```mermaid
sequenceDiagram
    autonumber
    actor U as L'agent de terrain
    participant ED as editor (plugin)
    participant SS as storage-seam
    participant LE as local-edit-api (in-core)
    participant DB as IndexedDB geoleaf-db
    participant TR as drain-triggers
    participant PE as push-engine
    participant CX as connector (plugin)
    participant SV as write.endpoint

    U->>ED: dessine une géométrie, remplit le formulaire
    ED->>ED: adapter-factory — LA DÉCISION, avant l'écriture
    Note over ED,LE: canQueueWrites ? → la FILE, en ligne ou non.<br/>Sinon → chemin en ligne direct.<br/>JAMAIS selon l'état du réseau.
    ED->>SS: applyEdit
    SS->>LE: GeoLeaf.Storage.applyEdit
    Note over SS,LE: liaison TARDIVE : l'éditeur doit builder<br/>et tourner sans le moteur hors-ligne
    LE->>LE: grantsEdition — gate PAR OPÉRATION
    Note over LE,DB: create, update, delete séparément.<br/>Une clé absente = REFUSÉ.
    LE->>DB: UNE SEULE transaction
    Note over LE,PE: l'entité dans features — ce que la carte relira<br/>ET l'opération dans outbox — ce que le push rejouera
    LE-->>TR: événement outbox-queued
    LE-->>U: bandeau de synchro — la saisie est tenue

    Note over DB,PE: QUATRE déclencheurs de drain, aucun redondant
    TR->>TR: storageReady — une file laissée par la session d'avant
    TR->>TR: window online — l'événement NATIF, pas celui de GeoLeaf
    TR->>TR: visibilitychange — l'appareil se réveille
    TR->>TR: tick périodique — le BACKOFF, que rien ne relançait
    TR->>PE: drain

    PE->>ED: itère les hooks d'avant-drain, UNE passe, en ordre
    ED->>SV: téléverse d'abord les photos locales
    Note over PE,SV: un hook qui échoue n'arrête JAMAIS le drain
    PE->>DB: lit l'outbox EN ENTIER — pending ET failed
    Note over LE,PE: ne lire que pending faisait qu'une saisie<br/>échouée une fois ne revenait jamais :<br/>le mode de perte le plus probable sur le terrain
    PE->>CX: fetch borné
    CX->>SV: la même requête, avec Authorization
    Note over DB,SV: local_id part SUR LE FIL, hors liste blanche —<br/>c'est du protocole : le serveur refuse le doublon,<br/>et un 409 est un SUCCÈS
    SV-->>PE: identité serveur, ou un statut d'échec
    PE->>DB: réconcilie serverId DANS L'ENREGISTREMENT
    Note over LE,PE: l'entrée de file ne référence que localId,<br/>puis elle disparaît

    rect rgb(250, 238, 235)
        Note over PE,SV: LE CAS SESSION MORTE
        SV-->>PE: 401 / 403
        PE->>PE: haltedBy authRequired — le drain S'ARRÊTE
        PE-->>TR: les quatre déclencheurs s'éteignent
        Note over TR,PE: le core ne peut PAS voir une session revenir,<br/>et il le DIT. Sans cet arrêt, une session morte<br/>mettait une saisie à l'écart PAR MINUTE.
        CX->>CX: voit l'authentification revenir
        CX->>DB: requeueAll authRequired
        CX->>PE: pushOutbox
        Note over TR,SV: deux gestes PUBLICS — une application qui<br/>s'authentifie autrement fait exactement les deux mêmes
    end
```

**Le rejeu manuel** suit le même moteur : le bouton du panneau de synchro d'`offline-ui` appelle
le handler qu'`editor` a poussé dans le seam, qui délègue au **même** `push-engine` in-core. Le
handler reste **silencieux** : `offline-ui` possède le message du bouton qu'il pilote, sinon
l'utilisateur recevrait deux notifications pour une seule action.

---

## Ce que ces trois vues ne couvrent pas

- **Le hors-ligne préparé** — déclaré dans le profil, téléchargé à l'avance, données _et_ tuiles :
  fiche [`docs/specs/capacites/offline.md`](../specs/capacites/offline.md).
- **Le détail des 21 capacités et des 15 plugins** : une fiche chacun sous
  [`docs/specs/`](../specs/CDC_kernel.md).
- **L'arbre de fichiers complet** : `docs/reference/ARBORESCENCE_QUALIFIEE.md`, **généré** par
  `npm run docs:tree`.
