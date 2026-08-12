# Spécification de structure des profils GeoLeaf — Profile Contract v1

**Version produit :** GeoLeaf Platform V3
**Version du document :** 1.0.1
**Numéro de contrat :** Profile Contract v1
**Date :** 13 juin 2026 (Sprint S1 — roadmap `config-contract`)

📌 **Ancrage des chemins.** Ce contrat décrit la forme d'**un profil** : un chemin cité sans racine
(`profile.json`, `config/core/layers.json`, `layers/<id>/…`) se lit donc depuis
`profiles/<profil>/`, et **jamais** depuis la racine du dépôt. Les schémas sont dans
`profiles/schemas/` ; les chemins commençant par `packages/`, `scripts/` ou `docs/` sont relatifs à
la racine du dépôt.

> ## 🔒 SPEC FIGÉE — Profile Contract v1
>
> **Gelée le 13 juin 2026.** Ce document fait **autorité** sur la **structure** d'un dossier profil GeoLeaf
> et sur le **régime de validation** de ses fichiers de configuration JSON. Il est le pendant, côté
> **données de profil**, du [`PLUGIN_ARCHITECTURE_SPEC.md`](PLUGIN_ARCHITECTURE_SPEC.md) (qui régit, lui,
> la **forme** des plugins).
>
> La **Partie I (§0 à §9)** est **immuable** : tout changement d'un invariant (`PRF-*`), de la cartographie
> fichier→schéma ou de la gouvernance passe **obligatoirement par une RFC acceptée** (voir §9). La
> **Partie II (annexes)** est de **référence vivante** : elle renvoie aux documents et scripts qui suivent
> le code et s'éditent sans RFC.
>
> **Portée S1 (création).** Ce contrat **définit** la structure et **durcit les schémas** (`additionalProperties:false`).
>
> ✅ **S2 est livré (état au 27/07/2026).** Le branchement exécutoire du validateur sur les fichiers
> compagnons et la mise en conformité des profils **sont faits** : `scripts/validate-profiles.cjs` est câblé
> dans `scripts/ci-local.cjs` et dans `.husky/pre-commit`, et sort vert.
> Le paragraphe qui précédait disait « tant que S2 n'est pas livré, seul `profile.json` est validé » — faux
> depuis S2. `§9` classe **l'état du validateur** comme _vivant_ : cette mise à jour ne requiert pas de RFC.
> **Ne pas recopier le compte de profils ici** : `npm run validate:profiles` l'imprime.
>
> ⚠️ **Le compte « 9 profils / 234 fichiers » qui figurait ici est retiré le 02/08/2026** — il annonçait
> le triple du réel, **dans la phrase même qui interdit de le recopier**. La même valeur périmée vivait
> aussi en Annexe A : une seule mesure fausse, recopiée à deux endroits, est exactement le mode d'échec
> que la règle de vérificateur existe pour empêcher.

---

## Table des matières

**Partie I — FIGÉ (contrat normatif, modif via RFC)**

- [§0 — Statut, portée et régime figé/vivant](#0--statut-portée-et-régime-figévivant)
- [§1 — Vocabulaire normatif](#1--vocabulaire-normatif)
- [§2 — Les invariants (le contrat)](#2--les-invariants-le-contrat)
- [§3 — Anatomie d'un dossier profil](#3--anatomie-dun-dossier-profil)
- [§4 — Le manifest `profile.json`](#4--le-manifest-profilejson)
- [§5 — Configuration core (`config/core/*`)](#5--configuration-core-configcore)
- [§6 — Configuration plugin (`config/plugins/*` → `modules.<id>`)](#6--configuration-plugin-configplugins--modulesid)
- [§7 — Schémas-contrat & durcissement](#7--schémas-contrat--durcissement)
- [§8 — Checklist de conformité profil (pré-merge)](#8--checklist-de-conformité-profil-pré-merge)
- [§9 — Gouvernance et immuabilité](#9--gouvernance-et-immuabilité)

**Partie II — RÉFÉRENCE / VIVANT (renvois, édition sans RFC)**

- [Annexe A — Cartographie fichier → schéma](#annexe-a--cartographie-fichier--schéma)
- [Annexe B — Le validateur (`scripts/validate-profiles.cjs`)](#annexe-b--le-validateur-validate-profilescjs)
- [Annexe C — Renvois](#annexe-c--renvois)

---

# Partie I — Contrat figé

## §0 — Statut, portée et régime figé/vivant

### Portée

Cette spécification définit la **structure attendue d'un dossier profil** (`profiles/<id>/`) et le **régime de
validation** de ses fichiers de configuration JSON. Un **profil** est l'unité de configuration métier de
GeoLeaf : un ensemble de fichiers JSON déclaratifs (couches, styles, thèmes, taxonomie POI, UI, fonds de
carte) qui paramètrent entièrement une instance GeoLeaf **sans développement applicatif**.

Le contrat porte sur la **forme** (arborescence, nommage, fichiers compagnons, schémas) — **jamais** sur le
**contenu métier** d'un profil (quelles couches, quels styles, quelle taxonomie : libre, voir §3 « zone
libre »). Il **ne se substitue pas** non plus à l'inventaire **par valeur** des paramètres (effet de chaque
clé), qui relève des phases B/C de la roadmap `config-contract`.

### Modèle de référence

Le contrat est **calqué sur le profil `tourism`** (`profiles/tourism/`), pris comme implémentation de
référence du layout profil v2 (`config/core/*.json` + `config/plugins/<id>.json`), tel qu'établi par la
convergence **Plugin Contract v1** (commit `ada99ef2`).

### Public

- **Auteurs de profils** (internes ou intégrateurs) — §2 à §8 sont la référence.
- **Mainteneurs du core** — §9 régit l'évolution du contrat ; §5/§7 le câblage des schémas.
- **Revue & CI** — §8 (checklist) et Annexe B (gate `scripts/validate-profiles.cjs`, **exécutoire aujourd'hui** : `ci:local` + `pre-commit`).

### Régime figé vs vivant

| Régime     | Sections                                                 | Évolution                   |
| ---------- | -------------------------------------------------------- | --------------------------- |
| **FIGÉ**   | §0–§9 (invariants, cartographie, gouvernance, checklist) | **RFC obligatoire** (§9)    |
| **VIVANT** | Annexes A–C                                              | Édition libre, suit le code |

La distinction est délibérée : les **valeurs de paramètres, enums et défauts** évoluent au fil des releases
et n'ont pas vocation à être gelés — seuls les **invariants de structure** le sont. Les annexes **renvoient**
aux documents et scripts de référence plutôt que de les recopier, pour éviter toute divergence.

---

## §1 — Vocabulaire normatif

Les mots-clés **DOIT**, **NE DOIT PAS**, **DEVRAIT**, **NE DEVRAIT PAS**, **PEUT** suivent la convention
RFC 2119 (équivalents français de MUST / MUST NOT / SHOULD / SHOULD NOT / MAY).

| Terme                 | Définition                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profil**            | Unité de configuration métier sous `profiles/<id>/`. Entièrement déclaratif (JSON), chargé au boot via `geoleaf.config.json → data.activeProfile`.                              |
| **Dossier profil**    | Arborescence `profiles/<id>/` : `profile.json` + `config/` + `layers/` + `icons/`.                                                                                              |
| **Manifest**          | `profile.json` — point d'entrée du profil. Déclare `map.*` et `Files` (§4). Seul nom imposé (PRF-MANIFEST).                                                                     |
| **Fichier compagnon** | Tout fichier de config référencé depuis `Files` : fichier **core** (`config/core/*.json`) ou fichier **plugin** (`config/plugins/<id>.json`).                                   |
| **Fichier core**      | Fichier compagnon décrivant une facette du cœur : `taxonomy`, `themes`, `layers`, `basemaps`, `ui`, `features`.                                                                 |
| **Config plugin**     | `config/plugins/<id>.json`, fusionnée dans `modules.<id>`, lue via `GeoLeaf.Config.getModuleConfig` (§6). Propriété du plugin (INV-CONFIG).                                     |
| **Schéma-contrat**    | Schéma JSON Schema draft-07 sous `profiles/schemas/*.schema.json` validant un type de fichier compagnon (Annexe A). 11 schémas-contrat (`geoleaf-profile` exclu, hors-contrat). |
| **Validateur**        | `scripts/validate-profiles.cjs` (AJV). Applique la cartographie fichier→schéma. **Exécutoire** — `ci:local` + `pre-commit`.                                                     |
| **Durcissement**      | Passage d'un schéma en strict : `additionalProperties:false` sur tout objet à forme fixe, `_comment*` toléré (§7).                                                              |

> ⚠️ _Annotation du 11/08/2026 (relecture 6.11) — **la ligne « Schéma-contrat » porte un compte
> faux, et sa parenthèse désigne un fichier disparu.** Mesuré : **10** schémas sur le disque
> (`ls profiles/schemas/*.schema.json`), dont **9** réellement chargés par le validateur — sa liste
> `SCHEMA_NAMES` : `profile`, `layers`, `basemaps`, `features`, `ui`, `themes`, `mapping`,
> `layer-config`, `style`. Le 10ᵉ, `geoleaf-config.schema.json`, est sur le disque **sans être
> appliqué** — c'est l'écart déjà versé au registre plus bas dans cette annexe. Et
> `geoleaf-profile.schema.json`, que la parenthèse exclut « hors-contrat », **n'existe plus du
> tout** : il n'y a plus rien à exclure._
>
> _**La cellule n'est PAS réécrite** : §1 est en Partie I, et le régime §10 réserve son édition à
> une RFC acceptée. C'est un compte qui a dérivé, pas un invariant qui change — la voie est une RFC
> mineure, ou le retrait du compte au profit de la commande. Le noter ici est le geste que la
> gouvernance autorise ; le corriger en silence ne l'est pas._ |

---

## §2 — Les invariants (le contrat)

Ce sont les **règles immuables** de structure d'un profil. Chaque invariant porte un identifiant stable,
citable en revue de code et en RFC, et indique les piliers qu'il sert (Performance / Sécurité /
Maintenabilité / Évolution).

| ID               | Énoncé normatif                                                                                                                                                                                                                                                                                                             | Piliers                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **PRF-ID**       | Un profil **DOIT** exposer un `id` **unique et stable**, identique au nom de son dossier (`profiles/<id>/`), ainsi que `label` et `version` (SemVer) dans `profile.json`.                                                                                                                                                   | Maintenabilité, Évolution |
| **PRF-MANIFEST** | `profile.json` est le **seul** manifest imposé à la racine du dossier profil. Il **DOIT** déclarer la vue cartographique (`map.*`) et la section `Files`. Aucun autre nom de manifest **NE DOIT** être reconnu.                                                                                                             | Maintenabilité            |
| **PRF-PATHS**    | Tout fichier compagnon **DOIT** être référencé par un **chemin relatif déclaré dans `Files`** (`*File` pour le core, `Files.modules.<id>` pour les plugins). Un fichier non déclaré dans `Files` **NE DOIT PAS** être chargé.                                                                                               | Maintenabilité, Sécurité  |
| **PRF-MODULES**  | La configuration d'un plugin **DOIT** vivre sous `config/plugins/<id>.json`, fusionnée dans `modules.<id>` et lue via `GeoLeaf.Config.getModuleConfig("<id>", clé, défaut)`. Le core **NE DOIT PAS** connaître, valider ni défaut-er les clés d'un plugin (renvoi `INV-CONFIG` / `INV-FRONT` du Plugin Contract v1).        | Maintenabilité, Évolution |
| **PRF-SCHEMA**   | Chaque fichier du profil **DOIT** valider le schéma-contrat associé par la cartographie fichier→schéma (§5 / Annexe A). Les schémas-contrat **DOIVENT** être stricts : `additionalProperties:false` sur tout objet à forme fixe, seule la clé documentaire `_comment*` étant tolérée (`patternProperties`).                 | Maintenabilité, Sécurité  |
| **PRF-NOLEGACY** | Un profil **NE DEVRAIT PAS** recourir à `mapping.json` (normalisation POI légacy) ; sa présence **DOIT** faire l'objet d'une **dérogation documentée** (cas de migration). Aucune clé de config plugin **NE DOIT** subsister à la racine du profil — la forme `modules.<id>` est exclusive depuis Plugin Contract v1 (S14). | Évolution                 |
| **PRF-DATA**     | Les données volumineuses (GeoJSON, tuiles, sprites…) **DOIVENT** vivre **hors** des fichiers de config JSON : sous `layers/<id>/data/` pour les données de couche, `icons/` pour les sprites. Un fichier de config **NE DOIT PAS** embarquer de payload de données inline.                                                  | Performance               |
| **PRF-LAYERS**   | Une couche **DOIT** suivre l'arborescence `layers/<id>/<id>_config.json` (+ `styles/<style>.json`, `data/`). Le fichier de config **DOIT** porter un `id` identique au dossier et **DOIT** être déclaré dans `layers.json` (entrée directe ou instance de `layerTemplates`).                                                | Maintenabilité            |
| **PRF-ICONS**    | Le jeu d'icônes d'un profil **DOIT** être un sprite SVG unique `icons/sprite_<id>.svg`, référencé via `taxonomy.icons.spriteUrl` (chemin relatif) et adressé par `symbolPrefix` + nom de symbole.                                                                                                                           | Maintenabilité            |

> **Règle de lecture :** un invariant énonce une obligation de **structure**. Tout ce qui n'est pas
> explicitement gelé ici relève de la **zone libre** : le **contenu métier** du profil (quelles couches,
> quels styles, quelle taxonomie, quelles valeurs) évolue librement, sous réserve de valider les
> schémas-contrat (PRF-SCHEMA).

> ⚠️ **`PRF-LAYERS` exige un fichier qu'une gate INTERDIT, depuis le 06/08/2026** (relu contre le code
> le 06/08/2026). Le régime figé (§9) interdit de réécrire la Partie I sans RFC ; l'invariant est donc
> **annoté, pas récrit** — même traitement que les deux entrées d'arbre du 27/07 ci-dessus.
>
> - **Sa dernière phrase couvre deux routes qui n'ont pas le même besoin.** « Le fichier de config
>   **DOIT** […] être déclaré dans `layers.json` (entrée directe **ou instance de `layerTemplates`**) »
>   se lit comme si une instance de template devait, elle aussi, porter son `<id>_config.json`. C'est
>   l'inverse : `expandLayerTemplates` (`packages/core/src/kernel/config/profile-loader-helpers.ts`) assemble un
>   `inlineConfig` qui — le TSDoc de `LayerRef`, dans le même fichier, l'écrit — « **skips the
>   fetch entirely** ». Un `<id>_config.json`
>   posé à côté d'une instance **n'est jamais lu**, et `scripts/check-template-layer-configs.cjs`
>   (**TPL-CFG**, posé à la tâche 7.1b③ le 06/08/2026) fait **échouer le build** s'il en trouve un.
> - **Lecture à retenir, en attendant la RFC** : l'arborescence `layers/<id>/` (avec `data/` et
>   `styles/<style>.json`) et l'égalité `id` ≡ nom du dossier valent pour **toute** couche ; le
>   `<id>_config.json`, lui, est **requis pour une entrée directe de `layers[]`** et **proscrit pour
>   une instance de `layerTemplates`**. Mesuré le 06/08/2026 : 24 fichiers de ce type avaient été
>   écrits pour des couches templatées et n'étaient lus par personne — **16 104 octets** de
>   configuration fantôme, retirés à la tâche 7.1b①.
> - ⚠️ **Le danger n'est pas l'octet, c'est la divergence** : un fichier mort qui ressemble à un
>   fichier vivant se fait éditer, et l'édition ne produit rien.

---

## §3 — Anatomie d'un dossier profil

Arborescence de référence (profil `tourism`), **conforme au contrat**. Les éléments **obligatoires** sont
marqués ⬤, les **recommandés/optionnels** ○.

```
profiles/<id>/
├── profile.json                      ⬤  Manifest — id, label, version, map.*, Files  (PRF-MANIFEST, PRF-ID)
├── config/
│   ├── core/                         ⬤  Fichiers core (référencés via Files.*File)
│   │   ├── taxonomy.json             ⛔ RETIRÉ au Lot 2 — voir la note sous cet arbre
│   │   ├── themes.json               ⬤  Préréglages de visibilité       → themes.schema.json
│   │   ├── layers.json               ⬤  Index des couches + templates   → layers.schema.json
│   │   ├── basemaps.json             ⬤  Fonds de carte                  → basemaps.schema.json
│   │   ├── ui.json                   ⬤  Contrôles UI / recherche        → ui.schema.json
│   │   └── features.json             ○  Clustering, géocodage, perf…    → features.schema.json
│   └── plugins/                      ○  Config plugins (référencés via Files.modules.<id>)
│       ├── offline.json              ○  → modules.offline   (schéma embarqué du plugin)
│       └── addpoi.json               ○  → modules.addpoi    (schéma embarqué du plugin)
├── icons/
│   └── sprite_<id>.svg               ○  Sprite SVG unique                (PRF-ICONS)
└── layers/                           ⬤  Une couche par sous-dossier      (PRF-LAYERS)
    └── <layerId>/
        ├── <layerId>_config.json     ⬤  Config de couche                → layer-config.schema.json
        ├── styles/
        │   └── <style>.json          ○  Styles de rendu                 → style.schema.json
        └── data/
            └── <layerId>.geojson     ○  Données (hors config JSON)       (PRF-DATA)
```

**Conventions de nommage (figées).**

- Dossier profil = `id` du profil (PRF-ID). Dossier de couche = `id` de la couche (PRF-LAYERS).
- Fichier de config de couche : `<layerId>_config.json` (PRF-LAYERS).
- Sprite : `sprite_<id>.svg` (PRF-ICONS).
- Données : extensions de données (`.geojson`, `.fgb`, `.pmtiles`…) sous `layers/<id>/data/` (PRF-DATA).

**Zone libre.** Le **nombre** et le **contenu** des couches, styles, thèmes et catégories est libre. La
**discovery des plugins** se fait par **présence** dans `Files.modules` : un profil sans `offline.json`
n'active pas le cache (pas d'erreur). Un profil **PEUT** omettre `features.json` (défauts core).

---

## §4 — Le manifest `profile.json`

Source de vérité du schéma : `profiles/schemas/profile.schema.json`.

```jsonc
{
    "id": "tourism", //                ⬤ unique = nom du dossier (PRF-ID)
    "label": "Profil tourisme", //     ⬤
    "version": "1.3.0", //             ⬤ SemVer
    "description": "…", //             ○
    "map": {
        //                              ⬤ vue cartographique (PRF-MANIFEST)
        "bounds": [
            [-55, -73.5],
            [-21.78, -53.5],
        ],
        "initialMaxZoom": 10, //        alias de maxZoom (legacy — voir registre d'anomalies)
        "padding": [50, 50],
        "positionFixed": true,
        "boundsMargin": 0.7,
    },
    "Files": {
        //                              ⬤ déclaration des compagnons (PRF-PATHS)
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "featuresFile": "config/core/features.json",
        "modules": {
            //                          ⬤ id plugin → chemin (PRF-MODULES)
            "offline": "config/plugins/offline.json", // ⚠️ « storage » avant le renommage
            "addpoi": "config/plugins/addpoi.json",
        },
    },
}
```

> ⚠️ **Deux entrées de l'arbre ci-dessus étaient périmées (relu contre le code le 27/07/2026).**
> Le régime figé (§9) interdit de réécrire la Partie I sans RFC ; elles sont donc **annotées**, pas récrites.
>
> - **`config/core/taxonomy.json` n'existe plus** (retiré au Lot 2, 11/07/2026, avec `taxonomy.schema.json`
>   et `Files.taxonomyFile`). Mesuré : `profiles/schemas/` ne contient **pas** `taxonomy.schema.json`, et
>   `find profiles -name taxonomy.json` ne rend que des `config/plugins/taxonomy.json`. La taxonomie est un
>   **module** — la note de §4 le disait déjà, l'arbre de §3 ne l'avait pas suivi.
> - **`config/plugins/storage.json` s'appelle `offline.json`**, et la clé `Files.modules` est **`offline`**,
>   pas `storage` (mesuré sur `profiles/tourism/profile.json`). Le plugin est `@geoleaf-plugins/offline-ui`,
>   la capacité in-core est `offline`.
>
> 🛑 **Troisième entrée périmée, relevée le 11/08/2026 (relecture 6.11) — `addpoi.json`.** L'arbre
> de §3 et l'exemple de §4 déclarent tous deux `config/plugins/addpoi.json` → `modules.addpoi`.
> **Le plugin `addpoi` a fusionné dans `editor` au Sprint 5 (05/08/2026)** : `packages/plugins/addpoi/`
> n'existe plus, et **aucun des trois profils du dépôt ne déclare ce module** — ils déclarent
> `offline`, `geocoding`, `table`, `theme-selector`, `legend`, `taxonomy`, `feature-info`,
> `cluster`, `filter`, `route`. Ce sont deux **exemples copiables** qui nomment un plugin
> supprimé. Annotés et non récrits, pour la même raison que les deux entrées ci-dessus.
>
> ⚠️ **Et aucune gate ne pouvait le voir** : `doc-profile-examples.guard.test.js` valide ces blocs
> contre `profile.schema.json`, où `Files.modules` est un dictionnaire à **clés dynamiques**. Il
> contrôle la forme, jamais l'existence de ce qui est nommé — c'est précisément la part que le
> protocole documentaire laisse à la relecture humaine.

- **`Files.*File`** : clés **fermées** (whitelist `additionalProperties:false`) — `themesFile`,
  `layersFile`, `basemapsFile`, `uiFile`, `featuresFile`, `mappingFile`. Tout autre `*File` est **refusé** (PRF-PATHS).
  ⚠️ **`taxonomyFile` n'en fait plus partie** : la taxonomie est un **module** depuis le Lot 2 (11/07/2026),
  déclaré sous `Files.modules.taxonomy` → `config/plugins/taxonomy.json`. Un profil qui déclare
  `Files.taxonomyFile` est **rejeté** par `npm run validate:profiles`.
- **`Files.modules`** : dictionnaire `id → chemin` (clés dynamiques). La **présence** d'une entrée déclenche
  la discovery du plugin (PRF-MODULES).
- **`map.*`** : `bounds`, `center`, `zoom`, `maxZoom`/`minZoom`, `initialMaxZoom` (alias legacy de `maxZoom`),
  `padding`, `positionFixed`, `boundsMargin`. L'inventaire **par valeur** (effet, défaut, consommateur) est
  produit en **S3/B1** ; les alias vivants y sont confirmés et consignés.

---

## §5 — Configuration core (`config/core/*`)

Les **cinq** fichiers core décrivent le cœur. Chacun **DOIT** valider son schéma-contrat (PRF-SCHEMA) :

| Fichier core                | Rôle (résumé)                                           | Schéma-contrat           |
| --------------------------- | ------------------------------------------------------- | ------------------------ |
| `config/core/themes.json`   | Préréglages de visibilité des couches (thèmes)          | `themes.schema.json`     |
| `config/core/layers.json`   | Index des couches + `layerTemplates`                    | `layers.schema.json`     |
| `config/core/basemaps.json` | Fonds de carte (tile / maplibre / …)                    | `basemaps.schema.json`   |
| `config/core/ui.json`       | Contrôles UI, recherche, gestionnaire de couches, table | `ui.schema.json`         |
| `config/core/features.json` | Clustering, géocodage, performance, POI, options carte  | `features.schema.json` ⭑ |

> ⚠️ **`config/core/taxonomy.json` ne fait plus partie du core** (retiré au Lot 2, 11/07/2026 —
> supprimé des 9 profils, avec `taxonomy.schema.json` et `Files.taxonomyFile`). La taxonomie est
> désormais un **module** : `config/plugins/taxonomy.json`, déclaré via `Files.modules.taxonomy`
> (§PRF-MODULES). Sa source de vérité côté code est la capacité `modules.taxonomy`
> (`GeoLeaf.Taxonomy.getIcons` / `getCategories` / `getLayerCategories`), pas le profil.

> ⭑ **`features.schema.json` créé en S1** (Sprint courant) — il était **absent** (anomalie structurelle
> `ANO-001` du registre). `config/core/features.json` n'avait donc **aucune** garde structurelle, alors que
> c'est le fichier le plus dense en alias/duplications (ex. `clusteringConfig.maxClusterRadius` ↔
> `poiConfig.clusterRadius`). La cartographie complète figure en **Annexe A**.

La **layer-config** (`layers/<id>/<id>_config.json`) et les **styles** (`layers/<id>/styles/<style>.json`)
relèvent des schémas `layer-config.schema.json` et `style.schema.json` (Annexe A).

---

## §6 — Configuration plugin (`config/plugins/*` → `modules.<id>`)

**Principe figé (PRF-MODULES, calqué sur `INV-CONFIG` du Plugin Contract v1).** La configuration propre à un
plugin **DOIT** être isolée :

1. **Dans le profil** : un fichier `config/plugins/<id>.json`, déclaré dans `Files.modules.<id>`.
2. **Au runtime** : son contenu est fusionné dans le bag `modules.<id>` (merge entrée-par-entrée,
   `mergeModulesBag`), lu **exclusivement** via `GeoLeaf.Config.getModuleConfig("<id>", "<clé>", défaut)`.
3. **Côté core** : le core **NE DOIT PAS** déclarer, valider ni défaut-er les clés d'un plugin. Le schéma de
   `config/plugins/<id>.json` est **embarqué dans le plugin** (`INV-CONFIG`), **hors** `profiles/schemas/`.

> **Conséquence sur la validation.** Le validateur de profils (Annexe B) **ne valide pas** le contenu de
> `config/plugins/<id>.json` contre un schéma-contrat du core (il n'en existe pas, par construction). Il se
> limite à vérifier que le fichier déclaré dans `Files.modules.<id>` **existe** et est un JSON valide. La
> conformité **fonctionnelle** d'un plugin relève de `roadmap_feature-plugin-validation.md`, pas de ce contrat.

Le repli rétrocompatibilité « clés racine legacy ↔ `modules.<id>` » a été **retiré en S14** du Plugin
Contract v1 : `modules.<id>` est l'**unique** forme supportée (PRF-NOLEGACY).

---

## §7 — Schémas-contrat & durcissement

### Règle de durcissement (figée)

Tout schéma-contrat **DOIT** être **strict** sur les objets à **forme fixe** (jeu de clés connu) :

```jsonc
{
    "type": "object",
    "additionalProperties": false, //                    refuse toute clé inconnue
    "patternProperties": { "^_comment": {} }, //         tolère _comment, _comment_xxx (documentation inline)
    "properties": {/* … clés connues … */},
}
```

En AJV draft-07, une clé matchée par `patternProperties` reste autorisée **malgré** `additionalProperties:false` :
`_comment*` est donc admis **partout**, les clés inconnues bloquées **partout**.

### Exception : nœuds dictionnaire et passthrough (NE DOIVENT PAS être verrouillés)

Le durcissement **ne s'applique pas** aux objets dont les **clés sont dynamiques** (indexés par identifiant)
ni aux **passthrough** (relais de propriétés tierces). Les verrouiller casserait des structures légitimes :

| Nœud                                              | Nature               | Régime                                         |
| ------------------------------------------------- | -------------------- | ---------------------------------------------- |
| `taxonomy.categories{}` / `.subcategories{}`      | dictionnaire         | `additionalProperties: { $ref: categoryItem }` |
| `basemaps.basemaps{}`                             | dictionnaire         | `additionalProperties: { $ref: basemapEntry }` |
| `mapping.mapping{}`                               | dictionnaire         | `additionalProperties: { type: string }`       |
| `profile.modules.<id>` / `geoleaf-config.modules` | plugin-owned         | `additionalProperties: true` (INV-CONFIG)      |
| `style.flatStyle.expressionPaint`                 | passthrough          | `additionalProperties: true` (clés MapLibre)   |
| `layers.layerTemplates[].template` / `.instances` | layer-config partiel | permissif (fusionné au runtime)                |
| `layer-config.pointStyle`                         | légacy               | permissif + consigné au registre (retrait S8)  |

### Le modèle attributaire — le bloc `attributes` (figé le 02/08/2026)

**Un fichier, une liste de champs, deux projections.** Le bloc `attributes` vit à la **racine de la
couche** (`layers/<id>/<id>_config.json`) et déclare, pour cette couche, quel champ est montré ou
saisi et comment. Types de référence : `packages/core/src/contracts/attributes.contract.ts`.
Application : `profiles/schemas/layer-config.schema.json`.

**Pourquoi à la racine, et pas sous `capabilities`.** Sous `capabilities`, le bloc aurait hérité
d'`additionalProperties: true` et du statut « propriété du plugin » — deux contradictions avec le
principe d'autonomie du fichier. À la racine, la règle d'édition ci-dessous s'écrit en **JSON Schema
pur**, et une entrée ne peut pas survivre à la couche qu'elle décrit.

#### Les deux colonnes de type

| Colonne     | Ce qu'elle dit                  | Valeurs                                                    |
| ----------- | ------------------------------- | ---------------------------------------------------------- |
| `primitive` | ce que la donnée **EST**        | `string` `number` `boolean` `string[]` `object` `object[]` |
| `widget`    | comment on la **montre/saisit** | les composants de `field-renderer`, **plus `action`**      |

⚠️ **`action` n'est PAS un composant de `field-renderer`** — le paquet n'en a aucun. C'est un widget
de **lecture, propre au core** : un bouton qui émet `geoleaf:popup:action`. Il a été **ajouté au
pré-vol du Sprint 2**, parce que le contrat figé la veille l'avait omis alors que l'événement est
émis, typé et enseigné à trois endroits publiés depuis le 29/07. Sans lui, migrer une couche aurait
rendu un champ `action` **indéclarable** — et rien n'aurait rougi, puisqu'aucun profil n'en déclare.

Deux colonnes et non une : c'est le **couple** qui rend la liste blanche opposable au build. Avec une
seule colonne « représentation », le validateur n'aurait rien à confronter et ne pourrait refuser
aucune combinaison.

⚠️ **`badge`, `link` et `price` portent des OBJETS, pas des scalaires** — respectivement
`{label, color}`, `{href, label?}` et `{amount, currency}`, dérivés du `ComponentDefinition<TValue>`
que chaque composant déclare. C'est la cause exacte du `[object Object]` obtenu en passant l'un
d'eux à un rendu de texte brut.

#### La liste blanche des couples légaux

| `primitive` | `widget` admis                                                                     |
| ----------- | ---------------------------------------------------------------------------------- |
| `string`    | `action` `date` `dropdown` `email` `image` `longtext` `phone` `radio` `text` `url` |
| `number`    | `metric` `number` `rating`                                                         |
| `boolean`   | `checkbox` (simple)                                                                |
| `string[]`  | `checkbox` (`multiple`) `gallery` `list` `tags`                                    |
| `object`    | `badge` `coordinates` `hours` `link` `price`                                       |
| `object[]`  | `reviews` `table`                                                                  |

Un couple hors liste est une **erreur de `validate:profiles`**, pas un silence.

⚠️ **Une asymétrie mesurée, et écrite ici plutôt que tue.** Le contrat TypeScript contraint les
`options` **par widget** (`AttributeWidgetOptions[W]`) ; le schéma, lui, n'a qu'une définition
**plate** de toutes les clés connues. Il refuse donc une faute de frappe, mais **pas** une clé
légale sur le mauvais widget — `{ widget: "rating", options: { maxRows: 5 } }` passe la validation.
Seul `action` porte une contrainte par widget, parce que son `actionId` est porteur. Fermer le cas
général demande une branche par widget : **versé au registre, pas fait au passage**.

#### `action` — le seul widget à contrainte par widget

| Règle                         | Pourquoi                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `options` **requis**          | sans `actionId`, `renderActionButton` rend `null` : le champ serait un no-op   |
| `options.actionId` **requis** | c'est l'identité du bouton, **opaque au core** — jamais interprétée, forwardée |
| `edit` **refusé**             | `display`-seul (Q6) : un bouton est un geste, pas une valeur qu'on saisit      |

Ses autres options sont **dérivées de ce que le code lit**, pas de la prose : `requiresPlugin` (le
bouton n'est pas rendu si le plugin nommé manque), `confirm` / `confirmKey` (confirmation avant
émission), `payloadFields` (liste blanche des propriétés jointes).

⚠️ **Sans `payloadFields`, AUCUNE propriété n'est jointe.** Le défaut va vers la confidentialité :
`geoleaf:popup:action` est un événement de document que **n'importe quel script de la page** peut
écouter.

#### Les cinq surfaces secondaires — amendement du 02/08/2026

Le modèle attributaire n'était pas déclaré à **trois** endroits mais à **huit**, et **deux d'entre
eux étaient déjà en contradiction avec ce schéma** :

| Surface secondaire         | État mesuré avant l'amendement                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `table.columns[].type`     | 🛑 **lu** par le rendu du tableau, **refusé** par ce schéma                                                                                |
| `search.indexingFields`    | ⚰️ **N'EXISTE PLUS** — la doc morte a été retirée le 06/08 (7.1′), et son moteur (`GeoLeaf.Search`, `flexsearch`) était déjà purgé du core |
| `modules.filter.fields[]`  | aucun schéma                                                                                                                               |
| `modules.permalink.fields` | aucun schéma                                                                                                                               |
| `label.field` des styles   | schématisé, mais hors du contrat attributaire                                                                                              |

🛑 **UN BLOC `uses` A PORTÉ CES CINQ LIAISONS DU 02/08 AU 06/08/2026. IL EST RETIRÉ.**

L'amendement avait fait rejoindre les cinq au bloc `attributes` sous une clé `uses`, pour qu'un champ
se déclare **une fois**. La mesure du 06/08 a montré que **le motif était faux sur ses deux termes** :

- **Ce n'est pas « cinq fichiers »**, c'est surtout **un**. Sur `candelabres`, `statut` est déclaré
  **trois fois dans le même fichier** — `attributes.fields[]`, `table.columns[]` et `formSchema`,
  cette dernière avec une **autre convention d'adressage**. **11 configs sur 48** portent plusieurs
  listes.
- **Deux des cinq sous-systèmes ne nomment aucun champ de couche.** `modules.filter.fields[]`
  déclare des **contrôles** (`searchText`, `proximity`, `categories`, `tags`…) ;
  `modules.permalink.fields` n'est **posé par aucun profil**.

**Et le bloc n'en remplaçait aucune** — `table.columns[]` survit (il porte `sortable` et `width`),
`formSchema` survit. Il **s'ajoutait** : câbler `uses` aurait voulu dire écrire `statut` une
**quatrième** fois. Décision **A3‴**.

✅ **Le contrat revient donc à sa forme d'origine : un fichier, une liste de champs, DEUX
projections** — `display` pour lire, `edit` pour capturer.

⚠️ **Ce que le retrait laisse ouvert, et qui n'a pas de propriétaire** : rien ne vérifie qu'un
`table.columns[].field` ou un `label.field` de style désigne une propriété qui **existe**. Une garde
de **réconciliation** — le champ nommé doit résoudre vers un `attributes.fields[].field` **ou** une
propriété réelle du GeoJSON — donnerait cette sûreté sans exiger une seule déclaration de plus.
Versée en option à la tâche 7.1b.

**Conséquence sur la règle de déclaration** : un descripteur ne portant **ni** `display` **ni**
`edit` est refusé — un champ qui n'est ni lu ni capturé n'a pas de raison d'être déclaré.

#### Les trois surfaces, adressables une par une

`display.surfaces` accepte `tooltip`, `popup` et `sidepanel`, au choix, champ par champ. Un booléen
unique « affiché oui/non » est explicitement refusé : il ne saurait pas exprimer « ce champ dans le
panneau, pas dans l'infobulle ». `display.mode` vaut `rendered` (défaut) ou `raw`.

Il n'existe **délibérément aucun mode** qui déléguerait la lecture à `field-renderer` : la lecture
appartient au core, la saisie à `field-renderer`. Le core n'importe pas cette bibliothèque.

#### `display.presentation` — ce qui appartient à la SURFACE, pas à la valeur

| Clé           | Effet                                                       | Portée                   |
| ------------- | ----------------------------------------------------------- | ------------------------ |
| `accordion`   | enveloppe le champ dans une section repliable               | panneau latéral          |
| `defaultOpen` | cette section démarre ouverte — sans effet sans `accordion` | panneau latéral          |
| `emphasis`    | `title`, `category` ou `subcategory`                        | les trois surfaces       |
| `hero`        | sort l'image du flux des champs, en image d'en-tête         | panneau latéral, `image` |

⚠️ **Ce ne sont délibérément pas des `options` de widget.** `accordion` et `hero` ne disent rien de
ce qu'une valeur **est** ni de son formatage : ils disent **où le nœud rendu atterrit sur la
surface**. Les pousser dans `AttributeWidgetOptions` les dupliquerait sur chaque widget et les
soumettrait à une liste blanche qui n'a rien à en dire.

⚠️ **`emphasis` n'admet que trois valeurs, et c'est une MESURE, pas un choix d'ergonomie.** L'union
héritée `FieldStyle` en déclarait 29 ; **3** seulement sont branchées dans le code de rendu, et **2**
portent un modifieur CSS. Les 26 autres ne produisent **ni branche ni classe** — elles ne sont donc
pas reprises.

⚠️ **Ce bloc a été ajouté au pré-vol du Sprint 2 (02/08/2026).** Le descripteur figé la veille ne
pouvait porter **79 déclarations vivantes** des profils sur disque — `accordion` 35, `defaultOpen`
32, `emphasis` 12, `hero` 4. Étant `additionalProperties: false`, il aurait fait **échouer** la
migration plutôt que la dégrader en silence : c'est le bon mode d'échec, mais le trou était réel.
La commande qui l'a trouvé est au §Le pré-vol de `roadmap_collecte-terrain-offline`.

#### La règle d'édition (schéma pur, aucun script)

> **Un champ portant `edit` oblige sa couche à déclarer son éditabilité ET sa cible d'écriture.**

Exprimée en `if` / `contains` / `then` (draft-07) : si `attributes.fields` **contient** un descripteur
ayant `edit`, alors la couche **requiert** `edition.update: true` **et** un bloc `write`. Le `required`
dans le `if` est ce qui empêche une couche sans `attributes` de matcher à vide.

⚠️ **Et `action` ne peut jamais déclencher cette règle** : le widget refuse `edit`, donc un champ
`action` n'oblige aucune couche à devenir éditable.

_(La règle de déclaration minimale — ni `display`, ni `edit` ⟹ refus — est énoncée une seule fois,
au §Les cinq surfaces secondaires ci-dessus. ⚠️ Elle a porté trois formes successives : celle
d'origine, celle de l'amendement `uses` (02/08), et de nouveau celle d'origine après son retrait
(06/08). C'est le genre de va-et-vient qui laisse un énoncé périmé quelque part — vérifier qu'il
n'est écrit qu'à un seul endroit.)_

#### Les deux vocabulaires de géométrie — à ne jamais confondre

| Vocabulaire           | Clés                       | Valeurs                             |
| --------------------- | -------------------------- | ----------------------------------- |
| Minuscules de domaine | `geometry`, `geometryType` | `point` `line` `polyline` `polygon` |
| Canonique GeoJSON     | `editableGeometryTypes`    | `Point` `LineString` `Polygon`      |

⚠️ **Ce n'est pas théorique.** Une couche déclarant `["point"]` en minuscule ne matche jamais le
`"Point"` canonique que produit l'éditeur, et **sort de la liste déroulante d'édition sans aucune
erreur**. `editableGeometryTypes` est passé en enum le 02/08 précisément pour rendre cet échec
bruyant ; la gate a été **vue rougir** sur la couche réellement fautive avant d'être crue.

#### Le contrôle d'échantillon — le 3ᵉ étage

Le profil déclare le nom du champ et son `primitive` ; **la donnée réelle vit dans le GeoJSON**.
`validate:profiles` sait vérifier qu'un couple est légal — il ne peut **pas** vérifier que la colonne
contient effectivement des nombres. D'où trois étages, et non deux :

| Étage                      | Ce qu'il attrape                                     | Quand                                    |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Liste blanche de schéma    | un couple (`primitive`, `widget`) illégal            | au build, **bloquant**                   |
| **Contrôle d'échantillon** | les N premières features confrontées aux `primitive` | au chargement de la couche, **une fois** |
| Journal d'exécution        | une valeur qui diverge en cours d'usage              | à l'usage, **jamais fatal**              |

Le contrôle d'échantillon est **neuf** et reste à coder : c'est le seul endroit où la cohérence réelle
est observable pour une source distante — donc pour un backend interrogé via OGC. Il inspecte les N
premières features au chargement, compare le type effectif au `primitive` déclaré, et **journalise**
sans jamais vider la carte : un mauvais profil dégrade, il ne casse pas.

#### Le mode « tout afficher » est retiré

Le rendu attributaire acceptait un mode `"all"` qui affichait **toutes** les propriétés de l'entité
en texte brut — sans type déclaré, sans widget, sans liste blanche. C'est un contournement complet du
contrat, et il était **aussi le comportement par défaut** d'une surface non déclarée : une couche qui
omettait une surface exposait tout son GeoJSON, identifiants techniques compris.

**Il est retiré.** Une surface non déclarée ne rend rien.

⚠️ **Coût de migration mesuré avant de trancher, et il n'est pas celui qu'on croit** : **1** surface
écrit `"all"` explicitement, **9 couches** (14 surfaces) tombent dans le repli implicite — et les
**30** couches sans bloc ne sont **pas** concernées, car elles n'entrent jamais dans le chemin de
rendu. Ce sont donc **9 couches à migrer, pas 30**, et la bascule sèche doit les déclarer en clair.

#### Ce que le bloc remplace

| Surface héritée                                       | État                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities.feature-info.{tooltip,popup,sidepanel}` | typée puis **retirée** à la migration — remplacée par `display.surfaces`                                                                                                                                                                                                          |
| `capabilities.feature-info.titleField`                | **0 site de lecture** alors que les 18 couches porteuses l'écrivent → `attributes.titleField`                                                                                                                                                                                     |
| `formSchema[]`                                        | remplacée par la projection `edit`                                                                                                                                                                                                                                                |
| `detailLayout`                                        | ⚠️ **un seul mot à trois niveaux d'imbrication** — `layer.detailLayout`, `sidepanelConfig.detailLayout`, `sidepanel.detailLayout`. **Aucun des trois n'est accepté par le schéma**, et `sidepanelConfig` n'est même pas une propriété autorisée. Remplacé par `attributes.fields` |

La migration est une **bascule sèche** : les profils passent au nouveau bloc dans le même commit,
avec un compteur de couches non migrées qui décroît.

### Le cycle de données hors-ligne (figé le 02/08/2026)

Le pendant du modèle attributaire : celui-ci dit **quel champ, montré comment** ; celui-là dit
**d'où vient la donnée, où elle est gardée, et où repartent les modifications**. Types de
référence : `packages/core/src/contracts/sync.contract.ts`.

Le cycle complet : **rapatrier → lire local → éditer → mettre en file → repousser → réconcilier.**

#### Trois propriétés que le contrat existe pour rendre vraies

1. **Une saisie ne disparaît jamais en silence.** Une donnée de terrain n'a **aucune autre
   copie** — ni serveur, ni export. Toutes les règles ci-dessous qui paraissent conservatrices
   découlent de ce seul fait.
2. **Le rapatriement ne confère pas le droit d'écrire.** Une couche non éditable en ligne ne
   devient pas éditable parce qu'on l'a téléchargée.
3. **Ce qui n'est pas synchronisé n'est jamais évincé.** Les navigateurs évincent **par
   origine**, pas par magasin.

⚠️ **Le régime de quota est MESURÉ, pas supposé.** Relevé le 02/08/2026 contre le vhost de dev :
l'application journalise `[PWA] Persistent storage refused — origin stays best-effort`. L'origine
est donc **évinçable**, file de synchronisation comprise. Chrome accorde la persistance sans
demander à une **PWA installée** : ce relevé est le **plancher**, pas le verdict d'une campagne.
Il se relit par appareil — `await navigator.storage.persisted()` —, il ne se déduit pas.

#### Identité, et pourquoi la file ne nomme que le local

| Identifiant | Origine                  | Rôle                                            |
| ----------- | ------------------------ | ----------------------------------------------- |
| `localId`   | client, à la création    | **la seule identité que la file référence**     |
| `serverId`  | serveur, au premier push | `null` tant que la création n'est pas acquittée |
| `version`   | serveur, au rapatriement | rend le conflit **détectable**                  |

Une entité créée hors réseau n'a **pas** d'identité serveur : une file qui ne saurait pas la
nommer serait incapable de mettre en file sa propre création. C'est aussi ce qui rend le rejeu
idempotent et permet de fusionner une création suivie d'une modification.

#### Le vocabulaire d'opération — un seul, et générique

`create` · `update` · `delete`.

⚠️ **Deux vocabulaires incompatibles cohabitent aujourd'hui** — `add_poi`/`update_poi`/`delete_poi`
et `editor.save`/`editor.update`/`editor.delete` — et **le core ne connaît que le premier**, ce qui
explique qu'une géométrie tracée par l'éditeur ne soit jamais restaurée. **Aucun des deux n'est
retenu** : le premier nomme un POI quand le magasin contient des entités quelconques, le second
nomme un plugin quand le core ne doit dépendre d'aucun.

#### Les politiques figées

| Politique           | Valeur                    | Ce qui change réellement                                                                                        |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Rapatriement        | `bboxCapped`              | Emprise + plafond, avec les mécanismes **déjà** présents dans le chargeur OGC — aucun transport à écrire        |
| Conflit             | `lastWriteWins`           | L'issue ne change pas ; le conflit devient **détectable et journalisé**, ce qu'il n'est pas du tout aujourd'hui |
| Suppression serveur | `serverWinsPreserveLocal` | L'entité quitte la carte, la saisie locale passe en **quarantaine** avec son motif — elle n'est jamais détruite |

Le delta par curseur n'est **pas** figé : il dépend d'un filtre serveur qui peut ne pas exister.
Relever un marqueur de version **dès le premier rapatriement** est ce qui garde cette porte
ouverte — le delta devient disponible plus tard **sans changement de schéma ni migration**.

#### Éditabilité : ce qui décide quoi

> **Ce qui décide du STORE, c'est l'éviction. Ce qui décide de l'OUTBOX, c'est l'éditabilité en ligne.**

Toute couche déclarée hors-ligne va dans le store par entité — y compris en lecture seule —, sinon
elle reste dans le cache évinçable et peut disparaître en pleine campagne. Mais `LayerSyncMode` ne
se dérive **jamais** de la déclaration hors-ligne :

| Mode        | Rapatriée | Lisible hors ligne | Outbox |
| ----------- | --------- | ------------------ | ------ |
| `readOnly`  | ✅        | ✅                 | ❌     |
| `readWrite` | ✅        | ✅                 | ✅     |

⚠️ Une entrée de file nommant une couche `readOnly` est une **erreur**, pas un cas limite. Sans
cette règle, « télécharger pour hors-ligne » deviendrait un moyen d'écrire là où le bloc `edition`
et la règle d'édition du modèle attributaire (§ ci-dessus) l'interdisent.

#### Les origines de données déclarées

Le contrat remplace un routage **au jugé**. Le Service Worker décide aujourd'hui par sous-chaîne de
nom d'hôte (`hostname.includes("tile")` matche `mon-site-hostile.tilerie.com`), par reniflage de
chemin, par un domaine fournisseur **codé en dur**, et par une exclusion globale `/api/` qui écarte
le chemin le plus courant d'une API de données. Aucun de ces quatre critères n'est relisable, et
deux sont exploitables.

Une origine se déclare en `scheme://hôte[:port]` — **jamais** une sous-chaîne, **jamais** un nom
d'hôte nu — avec les rôles qu'elle a le droit de servir et son caractère cachable.

⚠️ `cacheable: false` doit rester exprimable : un fournisseur de tuiles tierces qui répond en
**opaque** ne peut pas voir son contenu validé, donc on ne le met pas en cache — décision correcte
dont la **conséquence** (aucun fond raster hors réseau) doit être **déclarée**, pas découverte.

### `geoleaf-profile.schema.json` — **hors-contrat** (ANO-002), et **supprimé depuis**

> 🛑 **Relu contre le disque le 10/08/2026, avant publication : les DEUX schémas décrits dans
> cette sous-section n'existent plus.** `profiles/schemas/` en porte dix, ni
> `geoleaf-profile.schema.json` ni `detail-blocks.schema.json` n'en font partie. La
> « suppression **non exécutée** » annoncée plus bas **a été exécutée** depuis, sans que la
> section soit reprise. Elle est **conservée au présent historique** — elle explique ce
> qu'ANO-002 recouvrait et pourquoi le durcissement avait été refusé —, mais rien de ce qui
> suit ne décrit l'état courant.

`profiles/schemas/geoleaf-profile.schema.json` (draft 2020-12) décrivait un **vocabulaire de blocs UI**
(`text/image/gallery/badge/tags/link/reviews/list/table/checkbox-group/radio-group`) sous
`profile.json → panels.detail.layout[]`. Or :

1. **Aucun profil** n'utilise `panels.detail.layout`. ⚠️ **Cette ligne a renvoyé vers
   `sidepanelConfig.detailLayout[]` « où la mise en page détail vit en réalité » jusqu'au
   02/08/2026 : c'est faux** — `sidepanelConfig` n'est pas une propriété acceptée de
   `layer-config.schema.json`, et aucune des 48 configs de couche ne la porte. La mise en page
   détail vit désormais dans le bloc `attributes` ci-dessus.
2. Le schéma n'est **référencé par aucun code** ni par le validateur (usage IDE `$schema` uniquement).

**Décision (figée S1) :** `geoleaf-profile.schema.json` et le conteneur `panels.detail.layout` sont
**hors-contrat / orphelins** → consignés au registre d'anomalies (`ANO-002`, candidat suppression, **non
exécutée**). Ce schéma **NE DOIT PAS** être durci ni appliqué par le validateur.

⚠️ **La réconciliation annoncée en S7/B5 a produit un SECOND orphelin, pas une résolution.**
`profiles/schemas/detail-blocks.schema.json` (15 types de blocs) a bien été extrait comme « fragment
partagé », mais **aucun `$ref` ne le vise** : un grep du nom sur tout le dépôt ne rend que son propre
`$id` et les deux endroits qui le chargent (`scripts/validate-profiles.cjs`,
`packages/core/__tests__/config/s13-layers-anomalies-lock.test.js`). Trois commentaires affirmaient le contraire, tous corrigés le
02/08/2026. Le fragment est donc **enregistré mais jamais appliqué** ; son retrait appartient à la
passe de suppression du versant affichage, qui emporte ses deux lecteurs dans le même commit.

⚠️ Son vocabulaire porte en outre un **6ᵉ écart de nommage** avec le catalogue de saisie : il dit
`checkbox-group` et `radio-group` là où `field-renderer` dit `checkbox` et `radio`. Le bloc
`attributes` retient la forme de `field-renderer`, qui est celle que le code exécute.

---

## §8 — Checklist de conformité profil (pré-merge)

Chaque case est mappée sur un invariant ou un garde-fou. **Le gate exécutoire (`scripts/validate-profiles.cjs` en
pre-commit) est livré** — la checklist ne remplace plus rien, elle double ce que la machine vérifie déjà.

- [ ] `profile.json` présent, `id` = nom du dossier, `label` + `version` (SemVer) — **PRF-ID, PRF-MANIFEST**
- [ ] `map.*` et `Files` déclarés ; chaque compagnon référencé par chemin relatif dans `Files` — **PRF-PATHS**
- [ ] Config plugin sous `config/plugins/<id>.json` → `modules.<id>` ; aucune clé plugin à la racine — **PRF-MODULES, PRF-NOLEGACY**
- [ ] Chaque fichier valide son schéma-contrat (`npm run validate:profiles` vert) — **PRF-SCHEMA**
- [ ] Pas de `mapping.json` hors dérogation documentée — **PRF-NOLEGACY**
- [ ] Données volumineuses sous `layers/<id>/data/` ; aucune payload inline — **PRF-DATA**
- [ ] Couches sous `layers/<id>/<id>_config.json`, `id` cohérent, déclarées dans `layers.json` — **PRF-LAYERS**
- [ ] Sprite unique `icons/sprite_<id>.svg` référencé via `taxonomy.icons.spriteUrl` — **PRF-ICONS**
- [ ] Schémas-contrat touchés restés stricts (`additionalProperties:false` + `_comment`) — **PRF-SCHEMA**

---

## §9 — Gouvernance et immuabilité

### Ce qui est figé

La **Partie I** (§0–§9), le **numéro de contrat** `Profile Contract v1`, les **invariants `PRF-*`** et la
**checklist §8**. Modifier un invariant, la cartographie fichier→schéma normative ou la gouvernance **exige
une RFC acceptée**.

### Ce qui reste vivant

Les **annexes A–C**, les **valeurs/enums/défauts** des paramètres (inventoriés en phases B/C), le **contenu**
des schémas au-delà de la règle de durcissement, et l'état du **validateur**.

### Processus RFC (léger)

1. Créer `docs/specs/rfc/RFC_{NNN}_{slug}.md` (cycle : Brouillon → En revue → Acceptée / Rejetée → Appliquée).
    > ⚠️ _Corrigé le 11/08/2026 (tâche 6.11) : ce chemin disait `_docs_projet/rfc/`, répertoire
    > qui n'est pas dans ce dépôt. Les RFC vivent sous `docs/specs/rfc/` depuis la refonte
    > documentaire V3 du 27/07/2026 — [`PLUGIN_ARCHITECTURE_SPEC.md`](PLUGIN_ARCHITECTURE_SPEC.md) portait déjà la correction
    > pour son propre processus RFC ; celui-ci était resté en arrière. Le processus est inchangé,
    > seule son adresse l'était._
2. La RFC référence l'`PRF-*` ou la section visée, et la raison du changement.
3. Une RFC **Acceptée** est la **seule** autorisation d'éditer la Partie I.
4. La RFC appliquée met à jour le **journal des versions** ci-dessous.

### Versioning de cette spec

| Composante      | Incrément                                      | Déclencheur                     |
| --------------- | ---------------------------------------------- | ------------------------------- |
| `Z` (1.0.**Z**) | rédactionnel, annexes                          | sans RFC                        |
| `Y` (1.**Y**.0) | invariant ajouté **non cassant**               | RFC légère                      |
| `X` (**X**.0.0) | changement cassant → **Profile Contract vN+1** | RFC + nouveau numéro de contrat |

### Journal des versions

| Version | Contrat             | Date       | RFC | Changement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------- | ---------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.1   | Profile Contract v1 | 2026-07-27 | —   | **Relecture contre le code** (refonte doc V3, aucun invariant touché → pas de RFC, incrément `Z` per §9). Partie I **annotée, non récrite** : l'arbre §3 gardait `config/core/taxonomy.json` (retiré au Lot 2) et `config/plugins/storage.json` (devenu `offline.json`, clé `Files.modules.offline`). Annexe A (vivante) réécrite contre `scripts/validate-profiles.cjs` : colonne « branché en S2 » fausse sur 11 lignes, compteur « 11 schémas » faux (12 sur disque), `detail-blocks.schema.json` absent du tableau. Les 7 clauses « tant que S2 n'est pas livré » corrigées — S2 EST livré (étape « Profile contract (validate:profiles) » de `scripts/ci-local.cjs`, plus `pre-commit` ; 9 profils / 234 fichiers verts à la date). Deux écarts mesurés versés au backlog, non corrigés : `geoleaf.config.json` a un schéma non appliqué, `detail-blocks.schema.json` n'était cartographié nulle part. |
| 1.0.0   | Profile Contract v1 | 2026-06-13 | —   | **Gel initial** (Sprint S1, roadmap `config-contract`). 9 invariants `PRF-*`, cartographie fichier→schéma, règle de durcissement, `geoleaf-profile` tranché hors-contrat (ANO-002), création de `features.schema.json` (ANO-001).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

# Partie II — Référence (vivant)

> Les annexes **renvoient** aux documents et scripts maintenus à jour avec le code. Elles ne sont **pas** gelées.

## Annexe A — Cartographie fichier → schéma

> **Relu contre le code le 27/07/2026.** Cette annexe est en Partie II : elle **n'est pas gelée** (§9,
> « ce qui reste vivant » cite explicitement _l'état du validateur_). La mention « Figée en S0 » qu'elle
> portait était un vestige contredit par la section qui l'héberge — retirée.
>
> **Ne pas recopier de compteur ici.** Le nombre de schémas et la liste appliquée se mesurent :
> `ls profiles/schemas/` et `SCHEMA_NAMES` / `CORE_SCHEMA_BY_FILE` dans `scripts/validate-profiles.cjs`.
> L'ancienne rédaction annonçait « 11 fichiers / 10 schémas-contrat » — il y en a 12 sur le disque
> aujourd'hui, dont `detail-blocks.schema.json`, créé depuis et absent de ce tableau.
>
> ✅ **S2 est livré.** La colonne « ❌ → branché en S2 » était fausse sur 11 lignes : `scripts/validate-profiles.cjs`
> est câblé dans `scripts/ci-local.cjs` **et** dans `.husky/pre-commit`, et sort vert. Toutes les clauses
> conditionnelles « tant que S2 n'est pas livré » de ce document sont donc caduques.
>
> ⚠️ **Le compteur « 9 profils, 234 fichiers » est retiré** — il annonçait le triple de la réalité
> (`npm run validate:profiles` imprime son propre décompte en fin de run), **dans le paragraphe même
> qui interdit de recopier un compteur ici**. C'est la deuxième fois que cette classe se produit dans
> ce fichier ; ne pas la recréer.
>
> 📐 **Le modèle attributaire par couche** — bloc `attributes`, deux colonnes de type, liste blanche
> des couples, règle d'édition et contrôle d'échantillon — est spécifié au **§7**.

| Fichier de profil                         | Schéma                                                   | Appliqué par le validateur ?                                                                               |
| ----------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `profile.json`                            | `profile.schema.json`                                    | ✅                                                                                                         |
| `config/core/layers.json`                 | `layers.schema.json`                                     | ✅                                                                                                         |
| `config/core/ui.json`                     | `ui.schema.json`                                         | ✅                                                                                                         |
| `config/core/basemaps.json`               | `basemaps.schema.json`                                   | ✅                                                                                                         |
| `config/core/themes.json`                 | `themes.schema.json`                                     | ✅                                                                                                         |
| `config/core/features.json`               | `features.schema.json`                                   | ✅                                                                                                         |
| `config/core/mapping.json` (légacy)       | `mapping.schema.json`                                    | ✅                                                                                                         |
| `layers/<id>/<id>_config.json`            | `layer-config.schema.json`                               | ✅                                                                                                         |
| `layers/<id>/styles/<style>.json`         | `style.schema.json`                                      | ✅                                                                                                         |
| ~~`config/core/taxonomy.json`~~           | ~~`taxonomy.schema.json`~~                               | ⛔ **retiré au Lot 2** — ni le fichier ni le schéma n'existent                                             |
| racine `geoleaf.config.json`              | `geoleaf-config.schema.json`                             | ❌ **toujours pas appliqué** — le schéma existe, le validateur ne le charge pas (absent de `SCHEMA_NAMES`) |
| `config/plugins/<id>.json`                | **schéma embarqué du plugin** (hors `profiles/schemas/`) | ⏭️ **délibérément sauté** (propriété du plugin, §6 / scope B7)                                             |
| ~~`profile.json → panels.detail.layout`~~ | `geoleaf-profile.schema.json`                            | **hors-contrat / orphelin** (§7)                                                                           |
| `sidepanelConfig.detailLayout[]`          | `detail-blocks.schema.json`                              | ⚠️ **schéma présent, absent de cette annexe jusqu'au 27/07/2026** — à qualifier                            |

> ⚠️ **Deux écarts restent ouverts, mesurés** et non tranchés par ce document :
> `geoleaf.config.json` a un schéma-contrat que le validateur n'applique pas, et
> `detail-blocks.schema.json` n'était cartographié nulle part. Versés au backlog, pas corrigés ici.
>
> ⚠️ **La docstring de `scripts/validate-profiles.cjs` a été périmée dans le même sens** : elle
> listait `taxonomy` parmi les fichiers `config/core/`, alors que `CORE_SCHEMA_BY_FILE` ne l'a
> jamais contenu. **Corrigé côté code le 27/07/2026**, et la docstring porte désormais l'écart en
> toutes lettres — inutile de la relire pour ce défaut-là.

## Annexe B — Le validateur (`validate-profiles.cjs`)

`scripts/validate-profiles.cjs` (AJV draft-07) est le moteur du gate `PRF-SCHEMA`.

- **État courant (relu le 27/07/2026, citations ré-ancrées le 11/08/2026) :** valide
  `profile.json`, les fichiers `config/core/` de `CORE_SCHEMA_BY_FILE`,
  `layers/<id>/<id>_config.json` et `layers/<id>/styles/*.json`. Les schémas chargés sont
  énumérés par `SCHEMA_NAMES` — les compter là, pas ici. **Branché** dans `ci:local` et
  `pre-commit`. ⏭️ `config/plugins/*.json` est **délibérément sauté** (propriété du plugin, scope B7).
  ❌ `geoleaf.config.json` n'est **pas** validé — son schéma existe mais n'est pas dans `SCHEMA_NAMES`.
- ~~**État cible S2**~~ — atteint, sauf les deux écarts nommés en Annexe A (`geoleaf.config.json`,
  `detail-blocks.schema.json`). La mention « CI gelée jusqu'au 2026-07-01 » est caduque : la CI est dégelée.
- **Garde-fou complémentaire (phase B) :** `scripts/check-config-coverage.cjs` — échoue si une clé présente
  dans le code ou un schéma n'a pas d'entrée d'inventaire.

## Annexe C — Renvois

- [`PLUGIN_ARCHITECTURE_SPEC.md`](PLUGIN_ARCHITECTURE_SPEC.md) — contrat de **forme** des plugins (`INV-*`),
  dont `INV-CONFIG` (référencé par PRF-MODULES).
- [`MODULE_CONTRACT.md`](MODULE_CONTRACT.md) — contrats TypeScript du core.
- [`inventaire_config_parametres.md`](../../reference/inventaire_config_parametres.md) — inventaire **par valeur** (phases B/C).

> ⚠️ **Liste ré-ancrée le 11/08/2026 (tâche 6.11) — elle portait quatre renvois, aucun atteignable.**
> Les quatre visaient `_docs_projet/`, l'atelier interne, **qui n'est pas dans ce dépôt** : une liste
> intitulée « Renvois » dont aucune entrée ne se suit est plus trompeuse qu'une liste vide.
> Mesuré : [`inventaire_config_parametres.md`](../../reference/inventaire_config_parametres.md) existe bel et bien, mais sous `docs/reference/` — il est
> **public**, et c'est le lien ci-dessus. Les trois autres — `CDC_technique.md` §P2-15,
> `registre_anomalies_config.md`, `roadmap_config-contract.md` — **n'existent plus nulle part** ;
> ils sont nommés ici sans lien, comme trace de ce que ce contrat a consommé, et non comme
> destinations. Le comportement du chargeur de profils que décrivait `CDC_technique.md` §P2-15 se
> lit désormais dans [`CDC_kernel.md`](../CDC_kernel.md) et dans l'Annexe B ci-dessus.

---

**Dernière mise à jour :** 13 juin 2026 (doc v1.0.0 — gel initial, Sprint S1).
**Version GeoLeaf :** 2.0.0 — Platform V2 · **Profile Contract v1 (figé)**
