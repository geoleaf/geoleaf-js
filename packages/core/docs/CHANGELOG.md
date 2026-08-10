---
title: "Changelog"
description: "Historique des versions @geoleaf/core"
---

# Changelog

All notable changes to `@geoleaf/core` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) — [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed — **CASSANT EN COMPORTEMENT** : `analyzeMemoryLeaks()` ne rend plus `normal` sur un navigateur qui ne mesure rien

`GeoLeaf.Utils.PerformanceProfiler.analyzeMemoryLeaks()` rendait un verdict qui était une
**constante**. Elle calcule `growthRate` sur des échantillons de `getMemoryUsage()`, qui lit
`performance.memory.usedJSHeapSize` — que Chrome quantifie **et fige pour la durée de la page**
hors `--enable-precise-memory-info`. Les échantillons étaient donc rigoureusement égaux,
`growthRate` valait exactement `0`, et `warning` / `critical` étaient **inatteignables**.

Le fait qui a tranché est une mesure : sur une page retenant délibérément 9,0 à 15,1 Mo (vérifiés
hors page, par CDP `Runtime.getHeapUsage` après GC forcé), l'API rendait
`{"status":"normal","growthRate":0,"recommendation":"No action needed"}` — **six fois sur six**.

**Ce qui change**

- `status` peut désormais valoir **`"unavailable"`**, accompagné d'un `reason` :
  `"heap-readings-constant"` (tous les échantillons de la fenêtre égaux à l'octet) ou
  `"heap-api-unavailable"` (la fenêtre s'ouvre sur une lecture nulle). Deux tests
  **arithmétiques**, sans seuil à régler.
- `"heap-api-unavailable"` ferme une seconde cécité : hors Chromium, `performance.memory` n'existe
  pas, tous les échantillons valent `0`, et l'ancien calcul faisait `(0 − 0) / 0 = NaN`. `NaN`
  n'étant supérieur à aucun seuil, le verdict retombait sur `normal` — avec un `growthRate: NaN`
  publié tel quel.
- `generateReport()` porte l'indisponibilité dans ses recommandations : c'est le chemin réellement
  lu par un intégrateur, et il continuait de se lire « tout va bien ».

**Ce qui ne change pas, et c'est délibéré**

`status` reste typé `string` — il n'est **pas** resserré en union, ce qui casserait le `switch`
d'un consommateur existant. Le seul ajout de type est `reason?: string`, **optionnel**. Aucune
signature n'est modifiée : la rupture est de **comportement**, pas de compilation.

📌 **Une fenêtre qui bouge et revient à son point de départ reste `normal`**, avec
`growthRate: 0`. Même chiffre que le cas figé, verdict opposé — parce que l'entrée, elle, a varié.

⚠️ **`unavailable` ne se lit PAS comme « aucune fuite ».** Il dit que le navigateur n'a rien donné
à juger. Un appelant qui traitait `"normal"` comme un feu vert doit désormais traiter
`"unavailable"` à part : sur un Chrome standard, **cette API ne rendra plus jamais `normal`**. Elle
a cessé de mentir, elle n'a pas appris à voir — et elle perd le droit de confirmer une bonne santé.
Pour un chiffre réel, mesurer **hors de la page** (DevTools, ou CDP `Runtime.getHeapUsage` après
`HeapProfiler.collectGarbage`, ce que fait la propre garde de heap du dépôt).

### Added — `modules.offline.cache.maxTileCacheEntries`, et `geoleaf:cache:evicted` typé au contrat

Le cache de tuiles du Service Worker n'était borné par **rien**. Il vit dans la Cache API, sur la
même origine qu'IndexedDB — or les navigateurs évincent **par origine, pas par magasin**. Un cache
de tuiles sans plafond pouvait donc faire emporter `sync_queue` sous pression disque, c'est-à-dire
des saisies terrain non synchronisées, qui n'ont **aucune autre copie**.

```json
{ "modules": { "offline": { "cache": { "maxTileCacheEntries": 2000 } } } }
```

Plafond **déclarable**, défaut **2 000**, `0` désactive l'éviction. Au-delà du plafond les entrées
les plus anciennes partent d'abord ; sous pression du quota d'origine le trim devient nettement
plus agressif.

⚠️ **Compté en ENTRÉES, pas en octets** — la Cache API n'expose la taille d'aucune entrée, et
`storage.estimate()` mesure l'origine entière plutôt qu'un magasin. À ne pas confondre avec
`maxCacheBytes`, qui borne IndexedDB en octets (défaut 250 Mo) : ce sont **deux budgets distincts
contre le même quota d'origine** — voir `specs/capacites/offline.md` §Les DEUX budgets.

`geoleaf:cache:evicted` porte désormais un détail typé, `GeoLeafCacheEvictedDetail`
(`contracts/event-bus.contract.ts`) : `{ evicted, freedBytes?, totalBefore?, totalAfter? }`.

⚠️ **L'événement a DEUX producteurs, et c'est délibéré** : `cache-manager.ts` pour IndexedDB,
`sw-core.js` → `sw-register.ts` pour la Cache API. Les deux magasins évincent depuis des contextes
qui ne peuvent partager aucun code — un Service Worker n'a pas de `document` et ne peut importer ni
le contrat ni le bus. **`freedBytes` est absent côté Cache API**, pour la raison ci-dessus : un
consommateur doit traiter son absence, pas supposer un `0`.

#### Ce qui a été mesuré en navigateur

Relevé le 08/08/2026 sur les deux variantes déployées, Service Workers bloqués, premier
chargement — `scripts/probe-boot-waterfall.mjs` et `scripts/probe-csp-origins.mjs` reproduisent :

| Mesure                                                | `deploy-core` | `deploy-full` |
| ----------------------------------------------------- | ------------- | ------------- |
| Origines tierces au boot (unpkg, Google Fonts)        | **0**         | **0**         |
| Violations CSP                                        | **0**         | **0**         |
| Chunks eager démarrés **après** réception de l'entrée | **0 / 3**     | **0 / 3**     |
| `DOMContentLoaded`                                    | ~75 ms        | ~120 ms       |
| Connexions ouvertes en plus de la navigation          | **0** (h2)    | **0** (h2)    |

⚠️ **Ce n'est pas un avant/après apparié.** L'artefact « avant » (origines tierces, MapLibre 5)
n'existe plus sur le disque, et le reconstruire mêlerait quatre chantiers dans un seul delta. Les
valeurs ci-dessus sont l'**état mesuré**, pas un gain attribué. Les millisecondes varient d'un run
à l'autre et ne sont assorties d'aucun seuil — seules les quatre premières lignes sont assertées
par les sondes.

### Added — `GeoLeaf.Introspection.getCapabilityStatus()`

Une question, une réponse : **qu'est-ce qui est allumé, et pourquoi**. Rend, pour chaque
capacité déclarée, `{ id, embarked, enabled, gate, hasModule }`.

À distinguer de ses deux voisines, qui ne répondent pas à la même chose :

- `getAllCapabilities()` rend ce qui est **déclaré** (le schéma) ;
- `getActiveModules()` rend ce qui **tourne** (les modules initialisés) ;
- `getCapabilityStatus()` rend le **verdict de config**.

`enabled` est **relu à chaque appel** contre `GeoLeaf.Config`, donc contre la config fusionnée
dès que le profil est chargé. Avant `boot()`, aucune config n'existe et chaque gate répond son
`enableWhenAbsent` — la réponse exacte à « avec ce qui est configuré en ce moment », pas une
valeur de repli.

⚠️ `embarked` dit **d'où vient la déclaration**, pas si la capacité figure dans le manifeste
complet : `true` quand elle vient d'un installeur de preset (le build), `false` par le canal
runtime (`GeoLeaf.plugins.registerCapability`). Comparer au manifeste complet obligerait à
l'importer, ce qui annulerait le tree-shaking qu'une entrée composée sur mesure achète.

⚠️ `hasModule` est un fait **structurel** — la capacité contribue un `ICoreModule` — jamais un
fait d'exécution, et l'id de ce module n'est pas nécessairement celui de la capacité
(`permalink` contribue `share`). Pour « est-ce que ça tourne », la réponse est
`getActiveModules()`.

### Changed — **CASSANT** : `registerPresetDeclarations()` exige un `noteInstaller`

Son deuxième paramètre doit désormais porter `noteInstaller(id, facts)` en plus de
`register(decl)`. N'affecte que le code qui compose son propre preset en appelant directement
`presets/apply-preset.js` ; le contrat est durci plutôt qu'optionnel pour qu'un oubli soit une
erreur de compilation et non un `embarked: false` silencieux.

### Removed — **CASSANT** : `@geoleaf-plugins/addpoi` a fusionné dans `@geoleaf-plugins/editor`

Il n'y a plus qu'**un** plugin d'édition. **`GeoLeaf.AddPOI` disparaît SANS ALIAS** — c'est une
décision assumée (`V2`) : l'application n'a pas d'utilisateurs déployés, et un chemin d'adoption
serait du code à écrire, tester, puis supprimer, pour zéro bénéficiaire.

⚠️ **Il n'y a RIEN à déprécier : `@geoleaf-plugins/addpoi` n'a jamais été publié.** Le registre
npm rend `E404` — mesure : `npm view @geoleaf-plugins/addpoi version`. Aucune version n'a donc
jamais été installable, et **personne ne peut avoir écrit `GeoLeaf.AddPOI`** contre un paquet
publié. La table de migration ci-dessous décrit une bascule interne au dépôt, pas un chemin de
mise à jour pour un intégrateur.

🛑 **Le vrai cassant pour un intégrateur est ailleurs, et c'est `ui.showAddPoi`** — cette clé
existait dans le schéma de `@geoleaf/core` **2.1.8**, la version publiée, et disparaît en 3.0.0.
C'est le seul élément de cette section qu'un consommateur réel peut avoir dans son profil.

**Note de migration :**

| Avant                                     | Après                                         |
| ----------------------------------------- | --------------------------------------------- |
| `GeoLeaf.AddPOI.AddForm.openAddForm(ll)`  | `GeoLeaf.Editor.AddForm.openAddForm(ll)`      |
| `GeoLeaf.AddPOI.PlacementMode.activate()` | `GeoLeaf.Editor.PlacementMode.activate()`     |
| `ui.showAddPoi`                           | `modules.editor.showAddPoi`                   |
| `modules.addpoi.defaultPosition`          | `modules.editor.poiAddDefaultPosition`        |
| `ui.showPoiExport` · `ui.showPoiSubmit`   | `modules.editor.showExport` — voir ci-dessous |
| `<script src="geoleaf-addpoi.plugin.js">` | rien : `editor` se charge **paresseusement**  |

⚠️ **`ui.showAddPoi`, `ui.showPoiExport` et `ui.showPoiSubmit` sont RETIRÉS du type `UIConfig` et
du schéma.** Les deux derniers n'étaient déclarés dans **aucun** schéma alors que `ui.schema.json`
est `additionalProperties: false` : les écrire faisait échouer la validation de profil. Un bouton
était donc visible sans pouvoir être masqué, l'autre caché sans pouvoir être montré. Leurs
remplaçants vivent sous `modules.editor.*` et sont **déclarés**.

⚠️ **Changement de défaut :** `ui.showAddPoi` valait `false` (opt-in) ; `modules.editor.showAddPoi`
vaut `true` (opt-out), comme les autres créneaux paresseux du plugin. Un profil qui ne posait pas la
clé et ne chargeait pas `addpoi` n'avait pas le bouton ; s'il charge `editor`, il l'aura.

**Ce que la fusion change dans le core :**

- Le seam `kernel/ui/poi-addform-seam.ts` et son contrat `contracts/poi-addform.contract.ts` sont
  **supprimés** (180 lignes). Le core ne résout plus le namespace d'un plugin pour dessiner un
  bouton : le bouton est un **créneau de barre d'outils paresseux**, déclaré par l'application hôte.
- `GeoLeaf.Utils.poiToFeature` **reste** — c'est une API publique du core, indépendante du plugin.
- Les variantes de déploiement passent de **3 à 2** : `deploy-addpoi` disparaît, `deploy-full` porte
  l'édition **et** le hors-ligne.

---

### Changed — **CASSANT** : `enableEdition` / `enableEditionFull` deviennent un bloc `edition`

Les deux drapeaux d'éditabilité d'une couche sont remplacés par un bloc **par opération**.
`enableEditionFull` **ne voulait pas dire « édition complète »** : il n'était lu qu'une seule fois
utilement, comme `canDelete()` — c'était **le droit de supprimer**. Personne ne devine ça d'un nom.

**Mode d'échec :** `layer-config.schema.json` est `additionalProperties: false`, donc un profil qui
porte encore les anciennes clés **échoue à la validation**, clé nommée. Arrêt franc, pas de
dégradation silencieuse.

| Avant                        | Après                                           |
| ---------------------------- | ----------------------------------------------- |
| `"enableEdition": true`      | `"edition": { "create": true, "update": true }` |
| `"enableEditionFull": true`  | ajouter `"delete": true` au même bloc           |
| `"enableEditionFull": false` | omettre `delete` (ou l'écrire `false`)          |

⚠️ **Le cas majoritaire est le plus surprenant, et c'est voulu** : un profil qui n'avait que
`enableEdition: true` casse **aussi**. Il doit écrire `create` et `update` séparément, et **décider**
de la suppression. C'est précisément ce que l'ancienne paire ne permettait pas d'exprimer.

**Sémantique — absent vaut REFUSÉ, et aucune clé n'en implique une autre :**

```
edition absent          → create=false, update=false, delete=false
edition: {}             → idem — déclarer le bloc n'accorde RIEN
edition: {create:true}  → create seul ; update et delete restent false
```

⚠️ **Aucune couche ne change d'état par omission** : une couche qui ne déclarait rien n'était pas
éditable avant non plus. Le défaut restrictif ne retire donc l'édition à personne — un défaut
permissif l'aurait accordée, en silence, aux 42 couches sur 48 qui ne déclarent rien.

⚠️ **Le gate devient par opération là où `enableEdition` gouvernait _tout_.** Ce n'est pas
iso-comportemental pour `create` et `update` : ils sont désormais refusables indépendamment.

🛑 **Ce que ce bloc ne fait PAS, et il faut le lire avant de s'y fier.** `edition.delete` est
appliqué sur le chemin d'écriture **hors ligne uniquement**. En ligne, l'adaptateur REST du plugin
d'édition émet un `DELETE` sans condition, et sa barre d'outils gate l'outil de suppression sur sa
propre configuration, jamais sur la couche. **Une couche déclarant `delete: false` reste donc
supprimable par un utilisateur connecté.** Ce n'est pas un modèle d'autorisation de bout en bout.

- **La règle A14 est réancrée** : un champ `attributes.fields[].edit` exige désormais
  `edition.update: true` (et non plus `enableEdition: true`), toujours accompagné d'un bloc `write`.
  `update` et non `create`, parce que `edit` décrit la modification d'une valeur **existante**.

### Changed — **CASSANT** pour la configuration de couche

- **Le rendu attributaire se déclare dans un bloc `attributes` à la RACINE de la couche.** Le bloc
  `capabilities["feature-info"]` et ses trois listes parallèles (`tooltip` / `popup` / `sidepanel`)
  sont **retirés du schéma** : une couche qui les porte encore n'est plus validée.

    ```json
    {
        "attributes": {
            "titleField": "properties.nom",
            "fields": [
                {
                    "field": "properties.nom",
                    "label": "Nom",
                    "primitive": "string",
                    "widget": "text",
                    "display": {
                        "surfaces": ["tooltip", "popup", "sidepanel"],
                        "presentation": { "emphasis": "title" }
                    }
                }
            ]
        }
    }
    ```

    **Une liste unique**, où chaque champ nomme lui-même les surfaces sur lesquelles il apparaît, au
    lieu de trois listes de formes différentes qu'il fallait tenir parallèles à la main. Le bloc est
    **strict** : il vivait sous `capabilities`, qui était `additionalProperties: true`, donc une
    faute de frappe y passait en silence.

    Le type se déclare en **deux colonnes** — `primitive` dit ce que la valeur EST dans le GeoJSON,
    `widget` dit comment on la montre. C'est le couple qui permet à `validate:profiles` de refuser
    au build un nombre qu'on demande d'afficher en date ; une seule colonne « représentation »
    n'aurait rien à confronter.

- 🛑 **Le mode `"all"` est retiré, et il se déclenchait par le SILENCE.** `"all"`, une surface
  absente et une surface `null` passaient par la même branche : une couche qui **omettait**
  simplement une surface y exposait **toutes** les propriétés de ses entités — identifiants
  techniques et colonnes de travail compris. Une couche qui ne déclare rien ne peint désormais
  rien.

    ⚠️ **Si vous comptiez sur ce comportement**, déclarez explicitement les champs voulus. La liste
    plate de ce qu'un profil déclare est générée par `npm run gen:attributes-report`.

### Fixed

- **Une même donnée s'affichait différemment selon la surface.** Un champ `price` rendait un montant
  formaté dans le panneau latéral et `[object Object]` dans la bulle ; `badge` et `link` avaient le
  même défaut dans l'infobulle. Les trois surfaces partagent maintenant **une seule** projection de
  valeur.

- **Un champ `action` déclaré sur le panneau latéral n'était ni rendu, ni signalé.** La cause n'était
  pas une branche manquante mais une **charge utile** : le panneau ne recevait que l'identifiant de
  couche, alors que `geoleaf:popup:action` promet `featureId` et `lngLat`. Les deux surfaces
  interactives rendent désormais le bouton, avec sa charge utile complète.

- **`coordinates` et `hours` disparaissaient de la bulle**, rendus par le panneau seul.

- **`date`, `url` et `email` étaient déclarés et rendus nulle part** — un champ qui en portait un
  disparaissait sans avertissement. Ils rendent désormais : `date` via `Intl` en honorant une locale
  par champ, `url` et `email` en liens. ⚠️ Une adresse `mailto:` que le validateur d'URL refuse
  **dégrade en texte lisible** plutôt que d'être supprimée — la sanitisation n'est jamais contournée.

- **Un `widget` inconnu n'est plus muet** : il n'est pas rendu, il est **journalisé**, et il n'est
  jamais fatal — un profil incorrect ne doit pas vider la carte.

### Added

- **`@geoleaf/core` publie désormais son namespace ambiant.** `dist/types/global.d.ts` est émis au build et référencé par l'entrée (`/// <reference path="./global.d.ts" />`), donc `GeoLeaf.*` **résout chez l'intégrateur** sans déclaration manuelle — en TypeScript comme dans l'auto-complétion de l'éditeur.

    ```ts
    // Plus besoin de `declare const GeoLeaf: any;` dans votre projet.
    GeoLeaf.Layers.getFeatures("mes-points"); // typé
    ```

    Effet de bord mesuré au moment du câblage : les exemples de la documentation passant par ce namespace sont devenus **compilables**, ce qui a fait tomber quatre API fantômes qui y étaient copiables-collables.

- **Les façades publiques portent leur documentation dans les types livrés.** Les cinq sous-modules IndexedDB du hors-ligne (`LayersDBInstance`, `SyncDBInstance`, `ImagesDBInstance`, `BackupsDBInstance`, `PreferencesAPI`), les types de légende, `ProgressData`, `ResolverZone`, `ConfigFacade` et l'export `Utils` documentent maintenant **ce qu'ils font et pourquoi** — visible directement dans l'éditeur.

    ⚠️ `Utils` porte une précision qui manquait : l'export ESM et le global `GeoLeaf.Utils` ont **la même forme mais sont deux objets distincts**. Muter l'un n'affecte pas l'autre.

### Fixed

- **La vitrine npm du paquet (`README.md`) enseignait une API dissoute et un sous-chemin qui ne résout pas.** Elle portait un `GeoLeaf.POI.add({…})` copiable-collable — `GeoLeaf.POI` est retiré depuis la 3.0.0 — un `import { Core, POI, Filters }` dont deux membres n'existent plus, et deux `import "@geoleaf/core/dist/…"` qui lèvent `ERR_PACKAGE_PATH_NOT_EXPORTED` : la carte `exports` n'ouvre pas `dist/`.

    ```js
    // La CSS s'importe par le sous-chemin déclaré :
    import "@geoleaf/core/style.css";
    ```

    Elle annonçait aussi « Platform V2 / 2.0.0 » sur un paquet en 3.0.0, `node ≥18` pour un moteur qui en exige 22.13, un CDN épinglé `@2.0.0`, et un lien mort vers `docs/poi/`. **Réécrite en vitrine + pointeurs** — la duplication avec `docs/` était la cause mécanique de la dérive, et rien ne la voyait : le périmètre des gates documentaires s'arrêtait à `docs/`, il couvre désormais aussi le README.

- **`repository` et `bugs` du manifeste pointaient un dépôt miroir gelé.** Ils visaient `GeoLeaf-Core`, dont la synchronisation automatique est supprimée ; ils pointent maintenant le dépôt réel. Les liens « Repository » et « Issues » de la page npm mènent donc à un dépôt vivant.

- **Deux déclarations publiques de `CacheMetrics` dépendaient d'un drapeau de compilateur ou d'un type non exporté.** Aucun consommateur interne n'exerçait ni l'une ni l'autre, donc les seize passes `tsc -p` du dépôt sortaient vertes pendant qu'un intégrateur, lui, ne compilait plus.
    - `getStorageQuota()` — les propriétés qu'un ternaire à branches multiples fait synthétiser passaient de `?: undefined` à `?: never` selon qu'`exactOptionalPropertyTypes` était posé ou non. Le retour est désormais **annoté explicitement** : la déclaration publiée ne dépend plus d'un réglage de compilation.
    - `estimateProfileSize()` — son retour inféré référençait une `interface` **non exportée**, donc sans signature d'index implicite. `const r: Record<string, number> = estimate.byType` **cessait de compiler**, et le type partait quand même dans `dist/types/` sous un nom que personne ne pouvait écrire. Le type est exporté.

    Les deux ont été trouvées en **comparant deux émissions de `dist/types/`**, pas par une gate : `gen:api-surface` n'indexe que les symboles exportés, ce qui la rend aveugle au second cas par construction (contre-épreuve faite).

- **Le tutoriel de démarrage ne fonctionnait pas si on le suivait à la lettre.** `QUICKSTART_TUTORIAL.md` demandait de créer `layers.json`, `ui.json` et `basemaps.json` **à la racine du profil**, tandis que le `profile.json` de la même page les déclarait sous `config/core/`. Structure, clé `Files` et titres d'étape sont alignés.

- **Deux clés de profil mortes étaient enseignées comme vivantes** — `clusteringConfig` et `poiConfig`. Aucune n'existe au schéma, aucune n'est lue par le code. Le clustering se configure par la capacité : un défaut au profil (`Files.modules.cluster` → `config/plugins/cluster.json`), un override par couche.

    ```jsonc
    // config/plugins/cluster.json
    { "clustering": true, "clusterStrategy": "unified", "clusterRadius": 80 }
    ```

    Corrigé dans `QUICKSTART_TUTORIAL`, `PLUGIN_CONFIGURATION_GUIDE` et `GEOJSON_LAYERS_GUIDE`, où quatre passages les présentaient encore comme le mécanisme courant.

- **Des exemples de la documentation publiée appelaient `GeoLeaf.POI.*`**, retiré du core à la v3.0.0. Migrés vers `GeoLeaf.Layers.*` dans `USER_GUIDE`, `helpers/` et `security/`. Les mentions **historiques** de ce namespace (ce changelog, l'avertissement de rupture du `COOKBOOK`) sont conservées : un registre de rupture doit nommer l'API retirée.

- **Les descriptions de `configSchema` renvoyées par `GeoLeaf.Introspection.getCapabilitySchema()` citaient des numéros de ligne du code source.** Une citation `fichier:ligne` se périme à la première insertion en amont, et celles-ci partaient dans le paquet publié. Retirées.

### Removed

- **BREAKING — le sous-chemin `@geoleaf/core/presets/preset.contract.js` est retiré.** Il devient **`@geoleaf/core/contracts/preset.contract.js`** ; le module, ses types et son contenu sont inchangés, seule l'adresse bouge.

    ```ts
    // avant
    import type { PresetManifest } from "@geoleaf/core/presets/preset.contract.js";
    // après
    import type { PresetManifest } from "@geoleaf/core/contracts/preset.contract.js";
    ```

    **Pourquoi.** Ce fichier est 100 % type-only et c'était le **seul** des 15 `.contract.ts` du dépôt à vivre hors de `contracts/`. La gate qui vérifie que cette famille reste une surface de types pure lit `contracts/` sans récursion : il lui échappait donc entièrement, et rien n'aurait signalé qu'il acquière une valeur exécutable — que 21 installeurs de capacité auraient alors tirée dans le bundle. Le déplacer le met sous garde.

    Le sous-chemin n'a **pas** été conservé en alias : `./presets/*` aurait continué d'annoncer un répertoire que le fichier a quitté, c'est-à-dire exactement le défaut corrigé.

### Added

- **Trois sélecteurs d'interface, en capacités gatées** — `GeoLeaf.ProfileSwitcher`, `GeoLeaf.LanguageSwitcher` et `GeoLeaf.ThemePalette`. Chacune s'active par `modules.<id>.enabled` et est **opt-in** : absente de votre configuration, elle n'ajoute ni interface ni poids (le code ET son CSS sont tree-shakés).

    ```ts
    GeoLeaf.ProfileSwitcher.list(); // profils offerts (récoltés au déploiement)
    GeoLeaf.ProfileSwitcher.switchTo("france-rail"); // persiste + recharge

    GeoLeaf.LanguageSwitcher.list(); // langues offertes
    GeoLeaf.LanguageSwitcher.switchTo("en"); // persiste + recharge avec ?lang=

    GeoLeaf.ThemePalette.list(); // palettes offertes
    GeoLeaf.ThemePalette.set("green"); // applique À CHAUD, sans rechargement
    ```

    - `profile-switcher` — sélecteur de jeu de données en tête du gestionnaire de couches. La liste vient de `data.availableProfiles`, **générée au déploiement** depuis les `profile.json` (un navigateur ne peut pas énumérer un répertoire serveur). Ne s'affiche qu'à partir de 2 profils.
    - `language-switcher` — bouton de langue dans le bandeau d'onglets. Aucune traduction ajoutée : les 6 dictionnaires sont déjà dans le cœur. `display: "code"` remplace les drapeaux par `FR`/`EN` sur les plateformes qui ne les dessinent pas.
    - `theme-palette` — couleur d'accent (orange / vert / bleu), portée par `data-gl-palette` sur `<html>`. Orthogonale au mode clair/sombre et aux thèmes de carte. Le `default` configuré s'applique même quand le sélecteur reste masqué.

- **`profile.json` accepte `displayLabel` et `icon`** (tous deux optionnels) — libellé court et emoji du sélecteur de profil. Le `label` existant n'est pas modifié.

- **Les contrats d'extension sont désormais publics.** Six sous-chemins `types`-seuls exposent les interfaces qu'un plugin doit implémenter, et les mêmes symboles sont ré-exportés depuis l'entrée principale :

    ```ts
    import type { ICoreModule, IMapAdapter, GeoLeafEventMap } from "@geoleaf/core";
    // ou, forme longue :
    import type { ICoreModule } from "@geoleaf/core/contracts/core-module.contract.js";
    ```

    Sous-chemins publiés : `core-module.contract.js` (`ICoreModule`, `ILifecycleModule`, `IUISlotModule`, `IModuleRegistry`, `IModuleUISlot`), `capability.contract.js` (`ICapabilityDeclaration`, `ICapabilityRegistry`, `ICapabilitySchema`, …), `config.contract.js` (`IGeoLeafConfig`), `map-adapter.contract.js` (`IMapAdapter` + les types de géométrie), `layer-data.contract.js` (`LayerDataApi`, `LayerFeatureState`), `event-bus.contract.js` (`GeoLeafEventMap`, `GeoLeafRawEventMap`, `IEventBus`). Ces modules sont **type-only** : ils ne déclarent qu'une condition `types` et n'émettent aucun JavaScript — `import type` fonctionne, un import de valeur est refusé franchement. `PluginMetadata` (les métadonnées de `GeoLeaf.plugins.register`) est également ré-exporté depuis l'entrée.

    Jusqu'ici ces types n'étaient atteignables par **aucun canal** : un plugin qui implémentait `ICoreModule` devait le redéclarer.

- **`CapabilityRegistry`** — exporté depuis `@geoleaf/core` et `@geoleaf/core/kernel`. Le registre de capacités (`register`, `isEnabled`, `isLoaded`, `ensureLoaded`, `getSchema`, `getAllSchemas`) était complet mais joignable par aucune entrée ESM : déclarer une capacité n'était possible que par `GeoLeaf.plugins.registerCapability(decl)`, sans type, `ICapabilityDeclaration` n'étant pas exposé non plus.

- **`geoleaf:toolbar:action` est typé** — `GeoLeaf.Events.on("geoleaf:toolbar:action", …)` donne maintenant `detail: { action: string; element: HTMLElement }`. C'est le point d'extension par lequel un plugin réagit au clic sur son bouton de barre d'outils ; il fallait jusqu'ici passer par un `document.addEventListener` brut avec un cast écrit à la main.

    L'événement vit dans une **seconde carte**, `GeoLeafRawEventMap`, et non dans `GeoLeafEventMap`. La distinction est fonctionnelle : le bus interne clone ses payloads en JSON, ce qui détruirait la référence `element`. `Events.on` / `off` / `once` acceptent les clés des deux cartes ; l'émission reste réservée aux événements sérialisables.

- **`GeoLeafHost` (`@geoleaf/host-runtime`) décrit six membres de plus** — `GeoJSON`, `Utils`, `Log`, `Sync`, `Notifications`, `Layers`. Ils tombaient jusqu'ici dans la traîne `[key: string]: unknown`, donc `GeoLeaf.GeoJSON.getLayerById(id)` rendait `unknown`. Ajout **additif**, aucune rupture.

- **`GeoLeaf.Print.registerSlot(slot)`** (`@geoleaf-plugins/print`) — point d'extension pour ajouter du contenu au canvas composé (cartouche, champs additionnels) à l'un des `placement` `title` / `legend` / `footer` / `overlay-tl|tr|bl|br`. Réenregistrer le même `id` remplace le slot précédent. La fonction et son type `ComposeSlot` existaient déjà et le CDC les documentait comme appelables ainsi, mais elles n'étaient **pas montées sur la façade** : `GeoLeaf.Print.registerSlot` était `undefined` à l'exécution, et aucun slot personnalisé ne pouvait donc être dessiné. Ajout **additif**, aucune rupture.
- **`GeoLeaf.Permalink.stopSync()`** — nouvelle méthode publique qui arrête la synchronisation d'URL démarrée par `startSync()` et détache tous les écouteurs qu'elle avait posés (`moveend` de la carte + trois écouteurs `document`). Utile pour les hôtes SPA qui recréent la carte. `startSync()` est par ailleurs devenu **idempotent** : un second appel démonte la session précédente au lieu d'empiler des écouteurs.
- **`GeoLeaf.Notifications.show(message, typeOrOptions?, duration?)`** — la méthode manquait à la façade alors que le moteur de rendu, la surface historique `GeoLeaf.UI.showNotification` et la documentation des plugins la nommaient toutes. L'appeler atteignait `undefined` et **échouait en silence** (le garde `?.show?.()` avalait l'erreur, aucun toast n'apparaissait). C'est un alias de `notify()`.

### Removed

- **BREAKING — le namespace `GeoLeaf.Filters` (pluriel) est supprimé, sur les deux canaux.** L'export nommé `import { Filters } from "@geoleaf/core"` et le global `GeoLeaf.Filters` disparaissent ensemble, avec leur unique méthode `filterRouteList(baseRoutes, filterState)`.

    **Pourquoi.** Ce n'est pas sa taille qui l'a condamné, c'est son **nom** : une lettre le séparait de `GeoLeaf.Filter` (singulier), un objet **différent** de 8 membres qui pilote le panneau de filtre et porte le contrat de sérialisation du permalien. L'asymétrie rendait le piège d'autant plus sûr — le typé (`Filter`) n'était **pas** sur l'entrée ESM racine, le non typé (`Filters`) y était. Et `filterRouteList` n'avait **aucun appelant** : ni dans le core, ni dans les 13 plugins, ni dans l'application, ni dans les profils, ni dans les exemples — nulle part hors de sa propre définition.

    **Migration.** Il n'y a pas de remplacement direct, et il n'en faut pas :
    - pour filtrer la carte, utilisez la capacité **`GeoLeaf.Filter`** (singulier) — `getActiveFilter()`, `applyFilter(state)`, `reset()` — **inchangée** ;
    - pour filtrer un tableau dans votre propre code, utilisez `Array.prototype.filter`. C'est tout ce que `filterRouteList` faisait.

    Sont partis avec lui, faute de lecteur atteignable : le moteur `route-filter` (~320 lignes) et le seam de contribution par lequel la capacité `route` l'injectait. La capacité `route` elle-même — décoration des points de départ et d'arrivée d'itinéraire, pilotée par `modules.route.*` — est **inchangée**.

- **Le sous-chemin fourre-tout `@geoleaf/core/dist/*` est retiré.** Il rendait importable n'importe quel fichier de `dist/` — chunks internes et déclarations d'implémentation compris —, ce qui contournait l'ensemble des sous-chemins définis à côté. **Si vous chargiez la feuille de style par `@geoleaf/core/dist/geoleaf-main.min.css`, utilisez `@geoleaf/core/style.css`** : ce sous-chemin existe déjà, désigne exactement le même fichier, et c'est celui que la documentation emploie désormais. Aucun autre chemin sous `dist/` n'était documenté.

### Changed

- **BREAKING — deux sous-chemins `@geoleaf/core/capabilities/*` changent de nom.** Ils restent publiés, sous un nom qui décrit ce qu'ils font :

    | Avant                                                       | Après                                                    |
    | ----------------------------------------------------------- | -------------------------------------------------------- |
    | `@geoleaf/core/capabilities/permalink/permalink-manager.js` | `@geoleaf/core/capabilities/permalink/permalink-sync.js` |
    | `@geoleaf/core/capabilities/offline/core-config.js`         | `@geoleaf/core/capabilities/offline/config-seam.js`      |

    **Pourquoi.** `permalink-manager` n'exportait aucun objet `PermalinkManager` — seulement quatre fonctions libres de capture et de synchronisation d'URL ; `permalink-sync` les nomme. `core-config` était l'un de **trois** fichiers de ce nom exportant trois fonctions différentes, au point que son propre en-tête devait avertir « Not to be confused with `capabilities/feature-info/utils/core-config.ts` » — une note qui rattrape un nom ambigu est le symptôme du défaut, pas son remède. `config-seam` rejoint la famille `*-seam.ts` des accesseurs runtime gardés.

    **Qui est concerné.** Personne, sauf un import profond explicite de ces deux chemins. Ils n'apparaissent dans aucun README ni exemple, et ne sont ré-exportés par aucune entrée principale. Aucun autre renommage de ce lot ne touche la surface publiée : les six `<cap>-types.js` renommés en `types.js` sont des modules **type-only**, dont le `.js` n'a jamais été émis (leurs types restent résolvables sous le nouveau nom).

- **BREAKING — le plugin `@geoleaf-plugins/storage` devient `@geoleaf-plugins/offline-ui`.** Le paquet npm, le bundle (`geoleaf-storage.plugin.js` → `geoleaf-offline-ui.plugin.js`) et l'id de plugin runtime (`"storage"` → `"offline-ui"`) changent ensemble.

    **Pourquoi.** Le paquet ne contenait plus de stockage. Le moteur hors-ligne — IndexedDB, cache, téléchargement, synchronisation — a été intégré au core (`capabilities/offline`) et le plugin ne livre plus que l'interface : bouton de cache, sélecteur de couches, panneau de synchronisation. Son propre en-tête l'écrivait déjà (« Entry point (offline UI) […] the offline engine is in-core »), et « storage » désignait **trois** choses à la fois dans la base de code : ce plugin, la façade `GeoLeaf.Storage` et le moteur. `offline-ui` fait paire avec `capabilities/offline` et rend le nom vrai.

    **Migration.**
    - `npm install @geoleaf-plugins/offline-ui` (et désinstaller l'ancien) ; `import "@geoleaf-plugins/offline-ui"` ;
    - balise `<script>` : `dist/geoleaf-offline-ui.plugin.js` ;
    - `GeoLeaf.plugins.isLoaded("storage")` → `isLoaded("offline-ui")`, et de même pour la valeur rendue par `getLoadedPlugins()` ;
    - si vous ciblez le bouton dans le DOM ou en test : l'attribut passe de `data-gl-toolbar-action="storage"` à `data-gl-toolbar-action="offline-ui"`.

    **Ce qui NE change pas** — et c'est délibéré :
    - la façade **`GeoLeaf.Storage` est inchangée** : elle appartient au core, pas au plugin, et reste le point d'entrée du hors-ligne ;
    - les **clés i18n gardent leur préfixe `storage.*`**. C'est un namespace distinct de l'identité du paquet, et surtout une surface d'**override de profil** : le renommer casserait des traductions personnalisées sans rien clarifier ;
    - la configuration de profil est inchangée — elle passe déjà par `modules.offline.*` et `config/plugins/offline.json`.

- **La langue de l'interface est mémorisée.** Ordre de résolution : `?lang=` → `localStorage['gl-lang']` → `ui.language` → `fr`. Le paramètre d'URL reste **prioritaire**, pour qu'un lien partagé affiche la même langue chez son destinataire que chez son auteur.
- **Le profil actif est mémorisé** (`localStorage['gl-profile']`). `sessionStorage['gl-selected-profile']` conserve sa priorité et son comportement one-shot : le contrat existant n'est pas rompu.

- **`ICoreModule` devient une union** — `ILifecycleModule | IUISlotModule`. Le type déclarait `dependencies`, `init` et `destroy` comme obligatoires, alors que `GeoLeaf.registry.register()` accepte depuis toujours **deux** formes : un module de cycle de vie complet, **ou** un simple slot d'interface `{ id, ui }` (ce que fait tout plugin qui pose un bouton de barre d'outils sans embarquer de code au démarrage). Le contrat décrivait la première et rejetait la seconde — publié tel quel, il aurait refusé les huit points d'enregistrement réels de ce dépôt.

    ⚠️ **Si vous écriviez `class MonModule implements ICoreModule`, écrivez `implements ILifecycleModule`** : TypeScript n'accepte pas de clause `implements` sur un type union. Le nom `ICoreModule` reste celui du paramètre de `register()` et n'a pas changé de rôle. **Aucun changement de comportement à l'exécution** — c'est le type qui rejoint le runtime, pas l'inverse.

- **`exports` énumère désormais les sous-chemins `./facades/*` et `./presets/*` au lieu de les annoncer par un glob.** Un glob promettait tout ce que `dist/types/` contenait, y compris des modules jamais émis (voir _Fixed_). Le champ liste maintenant les **15 façades réellement livrées** — `branding`, `cluster`, `coordinates`, `featureinfo`, `filter`, `geolocation`, `labels`, `layers`, `legend`, `permalink`, `scale`, `share`, `sync`, `taxonomy`, `theme-toggle` — et les 2 presets exécutables. `@geoleaf/core/presets/preset.contract.js` ne déclare plus qu'une condition `types` : c'est un module type-only, `import type` fonctionne, un import de valeur est désormais refusé franchement plutôt que de résoudre dans le vide.
- **Les bannières d'installation PWA (Android et iOS) affichent désormais le nom d'application configuré** — `modules.pwa.short_name` sinon `modules.pwa.name` (repli « GeoLeaf ») — au lieu d'un « GeoLeaf » codé en dur, et **tous leurs libellés sont traduits** (fr/en/es/pt/it/de) via le dictionnaire i18n du core. Un profil qui ne définit pas `short_name`/`name` voit le texte inchangé.
- **`Notifications.notify()` / `show()` / `success()` / `error()` / `warning()` / `info()` renvoient désormais l'élément du toast** (`HTMLElement | null | undefined`) au lieu de `void`. C'est ce que `Notifications.dismiss(toast)` attend depuis toujours : sans valeur de retour, aucune façon d'obtenir la référence, et l'exemple documenté était inapplicable. Élargissement de type — **aucun appel existant n'est cassé**.

### Fixed

- **BREAKING — `GeoLeaf.BaseLayers` valait `undefined` en production.** L'alias rétro-compatible de `GeoLeaf.Baselayers` était bien monté, puis **écrasé par `undefined`** quelques instructions plus loin. `GeoLeaf.BaseLayers === GeoLeaf.Baselayers` rend désormais `true`.

    **Pourquoi ça arrivait.** L'alias était écrit `get BaseLayers() { return this.Baselayers; }` **à l'intérieur du littéral d'un `Object.assign`**. Or `Object.assign` lit les propriétés propres de la source, donc il **invoque** le getter — avec `this` lié au littéral, qui ne déclare pas `Baselayers`. Il écrivait `undefined`, par-dessus la valeur correcte posée juste avant par l'autre moitié de l'assemblage du namespace.

    **Pourquoi personne ne l'avait vu.** Le module qui portait ce getter était réputé **éliminé par le tree-shaking** — un commentaire l'affirmait depuis plusieurs versions. Il ne l'est pas : il est présent dans le bundle livré, et il s'exécute **en dernier**. Et aucun contrôle interne ne pouvait le détecter : ils comparent des **noms** de membres, et la clé `BaseLayers` existait bien — avec `undefined` pour valeur.

    ⚠️ **Ce correctif est marqué _breaking_ par prudence** : si votre code teste `GeoLeaf.BaseLayers` pour décider d'un repli vers `GeoLeaf.Baselayers`, ce repli ne se déclenchera plus. C'est le comportement attendu depuis toujours ; la valeur, elle, était fausse.

- **`GeoLeaf.getMetrics()` levait une exception dès qu'on la détachait du namespace.** `const { getMetrics } = GeoLeaf; getMetrics();` produisait `TypeError: Cannot read properties of undefined (reading 'getHealth')`, la méthode livrée étant écrite `this.getHealth()`. Elle ne dépend plus de `this` : la déstructuration, le passage en callback et `map(GeoLeaf.getMetrics)` fonctionnent. `GeoLeaf.getHealth()` était et reste correcte.

- **Le namespace `GeoLeaf` est typé à 81 % au lieu de 31 %.** Quarante-quatre clés publiques tombaient dans la traîne `[key: string]: unknown` de la déclaration ambiante : en TypeScript, `GeoLeaf.init({...})` rendait `unknown` et n'était pas vérifié. Les onze façades de capacité (`Branding`, `Cluster`, `Coordinates`, `FeatureInfo`, `Labels`, `NotificationSystem`, `PWA`, `Permalink`, `Scale`, `Share`, `ThemeToggle`), les douze façades kernel (`API`, `BaseLayers`/`Baselayers`, `CONSTANTS`, `Errors`, `Events`/`events`, `Helpers`, `LayerManager`, `ThemeCache`, `Validators`, `version`) et les vingt et une méthodes de premier niveau (`init`, `boot`, `setTheme`, `loadConfig`, `createMap`, `getMap`, `getAllMaps`, `getModule`, `hasModule`, `getNamespace`, `getHealth`, `getMetrics`, `fetch`, `get`, `post`, `bootInfo`, `mark`, `measure`, `getPerformanceReport`, `establishBaseline`, `notify`) sont désormais déclarées.

    ⚠️ **La traîne `[key: string]: unknown` reste en place** : aucun accès existant ne cesse de compiler. Ce qui change, c'est que les accès aux clés ci-dessus sont désormais **vérifiés** — un appel dont les arguments étaient faux et passaient en silence peut maintenant être signalé par votre compilateur. C'est l'effet recherché.

    Deux précisions sur des formes que la documentation présentait autrement :
    - **`GeoLeaf.init(options)` exige `map.target`** (ou son raccourci `target` / `mapId`) et lève sans lui. La forme attendue est `{ map: { target }, data: { activeProfile, profilesBasePath } }`.
    - **`GeoLeaf.init()` et `GeoLeaf.boot()` ne sont pas interchangeables** : `boot()` démarre l'application pilotée par profil, `init()` est l'enveloppe manuelle de `GeoLeaf.Core.init()`. Le chemin de démarrage n'appelle jamais `GeoLeaf.init()`.

- **`registry.getModuleSchema()` et `getActiveModules()` rendaient `dependencies: undefined`** pour tout slot d'interface enregistré après le démarrage — c'est-à-dire pour chaque plugin chargé à la demande. Leur propre type de retour (`IModuleInfo.dependencies`) annonce pourtant un tableau non optionnel. Les deux lisent désormais `dependencies ?? []`, comme le fait déjà le tri topologique du registre.
- **Treize sous-chemins `@geoleaf/core/facades/*` compilaient puis échouaient à l'import.** Le champ `exports` annonçait `./facades/*` par un glob dont la branche `types` résolvait **28** fichiers et la branche `import` seulement **15** : Rollup n'émet pas de module pour une façade qui n'est qu'une coquille de ré-export, à juste titre — elle n'a pas de code. Conséquence, `import { Core } from "@geoleaf/core/facades/core.js"` **passait le typage** puis levait `ERR_MODULE_NOT_FOUND` à l'exécution. Étaient concernés `api`, `baselayers`, `constants`, `core`, `events`, `filters`, `helpers`, `introspection`, `layer-manager`, `pwa`, `storage`, `ui`, `validators`. Les symboles correspondants restaient — et restent — accessibles depuis l'entrée principale : `import { Core, UI, Events } from "@geoleaf/core"`. `./facades/legend.js`, le seul sous-chemin que la documentation citait, n'a jamais été affecté.
- **`@geoleaf-plugins/table` n'apparaissait dans aucun rapport de démarrage.** Le nom `"table"` figurait encore dans la liste des modules internes du core exclus de `reportPlugins()`, héritage de l'époque où Table était embarqué. Le plugin s'enregistrait normalement mais restait invisible à la console de boot.
- **Les déclarations TypeScript des plugins étaient publiées mais introuvables.** Onze paquets (`@geoleaf-plugins/cog`, `editor`, `file-import`, `flatgeobuf`, `geocoding`, `measure`, `print`, `realtime-layer`, `table`, `websocket` et `@geoleaf/connector`) embarquaient bien leurs fichiers `.d.ts` dans le tarball npm, mais ne déclaraient **aucune condition `types`** dans leur `exports` : un `import "@geoleaf-plugins/table"` depuis un projet TypeScript échouait en **TS7016** (« Could not find a declaration file »), alors que les types étaient là, à côté. La condition est désormais déclarée par les onze. Aucune API n'a changé — ce qui change, c'est que votre éditeur les voit.
- **`@geoleaf-plugins/addpoi` et `@geoleaf-plugins/storage` n'embarquent plus les déclarations internes du core.** Ces deux paquets compilent des sources du core, ce qui faisait sortir leurs déclarations à une racine erronée : le tarball d'`addpoi` contenait **514 fichiers `.d.ts` (2,6 Mo), dont 483 appartenant à `@geoleaf/core`**, et sa propre entrée à un chemin qu'aucune configuration ne pouvait désigner. Ces deux paquets **n'exposent désormais aucun type** — ils sont consommés comme bundles à effet de bord (`import "@geoleaf-plugins/storage"` monte `GeoLeaf.Storage`), ce qui reste inchangé. Le typage reviendra quand leur couplage au core sera dénoué.
- **`@geoleaf-plugins/print` — l'échelle imprimée est enfin celle qui est verrouillée.** La carte re-rendue hors écran couvre la page utile entière ; elle était **étirée** dans la zone carte, que tout bandeau (titre, légende, pied) rétrécit. Dès qu'un titre était saisi — le cas nominal — la carte était écrasée verticalement : 1:25 000 s'imprimait en **1:26 331** avec un titre, en **1:30 240** avec titre + légende + description, pendant que la barre d'échelle continuait d'annoncer le dénominateur demandé. La capture est désormais **recadrée au centre, pixel pour pixel** ; `computeBbox()` tient compte des bandeaux, donc les annotations reportées depuis `@geoleaf-plugins/measure` et la charge utile du repli serveur sont replacées correctement. Corrige aussi bien le modal d'aperçu que `exportImage()` / `exportPDF()`.
- **`Permalink.startSync()` ne fuit plus d'écouteurs** lors d'une ré-initialisation (recréation de carte / SPA) : la session est idempotente et ses écouteurs sont libérés par `stopSync()` / le reset interne.
- **La bannière d'installation Android et la bannière iOS ne fuient plus** d'écouteurs globaux ni de minuterie en attente entre deux initialisations.
- **Une rafale de toasts d'erreur ne dépasse plus la limite `maxVisible`.** Quand plusieurs notifications attendaient dans la file et étaient traitées d'un seul tenant, chaque erreur « libérait » une place en visant un toast **déjà en cours de retrait** — opération sans effet, mais comptée comme réussie. Les toasts s'empilaient au-delà de la limite configurée (mesuré : 4 affichés pour `maxVisible: 2`). L'éviction ne cible plus qu'un toast réellement retirable.
- **Le liséré coloré des toasts s'affiche enfin.** Les quatre types (`success`, `error`, `warning`, `info`) sont censés se distinguer par une barre de couleur à gauche : la règle de base référençait une variable de thème **inexistante** (`--gl-accent` au lieu de `--gl-color-accent`), ce qui invalidait la déclaration et annulait le style de bordure — les modificateurs ne posant qu'une _couleur_, plus aucun liséré n'était rendu. **L'anneau de focus du toast** (`:focus-within`) était absent pour la même raison, ce qui en faisait aussi un défaut d'accessibilité.
- **En thème sombre, le fond des toasts suit de nouveau les variables de thème.** Une seconde règle, de spécificité identique et déclarée plus loin dans la feuille, imposait un gris fixe et rendait inopérants le fond calculé et l'ombre sombre que le fichier définit pourtant explicitement.
- **La visionneuse d'images des formulaires (`@geoleaf/field-renderer`, plugin AddPOI) ne disparaît plus au bout de 150 ms.** Le core publiait une règle `.gl-lightbox { opacity: 0 }` héritée d'une ancienne visionneuse qu'il n'utilise plus (la sienne est `.gl-poi-lightbox-*`), sur une classe qui appartient en réalité à `field-renderer`. Son animation d'ouverture n'ayant pas de `animation-fill-mode`, l'opacité retombait sur cette règle en fin d'animation : l'image s'affichait puis s'effaçait. La règle est supprimée.
- **À l'ouverture du panneau de filtres, le bloc bas-gauche (branding, échelle) et l'affichage des coordonnées se décalent de nouveau.** Les deux règles de décalage étaient écrasées par une remise à zéro des marges appliquée en `!important` sur le conteneur partagé.
- **La liste blanche `modules.permalink.fields` est enfin respectée par les URL compactes.** Le permalink encode l'état en base64 (`#gl=…`) quand `mode: "compact"` est demandé **ou**, automatiquement, dès que l'URL verbeuse dépasse 200 caractères — et ce chemin ignorait `fields` dans les deux sens : en lecture, une URL compacte forgée pilotait **toutes** les facettes (filtre, thème, catégories, tags, note, couches) y compris celles qu'un profil avait exclues ; en écriture, `buildUrl()` publiait l'état **entier** alors que le chemin verbeux venait de le filtrer. Les deux encodages appliquent désormais la même liste blanche. Aucun risque d'injection n'était en jeu (les valeurs alimentent des recherches sur des listes connues), mais `fields` ne tenait pas sa promesse.
- **Un paramètre de vue présent mais vide ne recentre plus silencieusement la carte sur 0,0.** `#gl_lat=&gl_lng=2.35&gl_zoom=12` passait le contrôle de présence (la valeur est `""`, pas absente), puis `Number("")` valait `0` : la carte s'ouvrait au large du golfe de Guinée au lieu d'ignorer un permalink invalide. Une valeur vide ou blanche est maintenant traitée comme absente — l'URL est rejetée et la vue du profil s'applique. Un `gl_lat=0` explicite reste évidemment valide.
- **`gl_rating` est validé comme les autres champs numériques.** Il était le seul à ne pas passer par le validateur commun : `#gl_rating=Infinity` (ou un `1e400` glissé dans une charge compacte, que `JSON.parse` transforme en `Infinity`) était accepté tel quel comme note minimale. Les valeurs non finies et négatives sont désormais rejetées.
- **Un permalink contenant du texte non latin ne casse plus l'URL.** Le format compact (`#gl=…`) encodait en base64 par un procédé qui **échoue sur tout caractère au-delà de l'alphabet latin-1** : un filtre en japonais, en russe — ou de simples points de suspension typographiques — faisait échouer l'encodage. La panne était **silencieuse** : la synchronisation d'URL avale l'erreur, donc l'adresse cessait simplement de suivre la carte, sans message. Ce chemin est par ailleurs emprunté **automatiquement** dès que l'URL classique dépasse 200 caractères, donc sans que le profil ait demandé le mode compact. L'encodage passe en UTF-8 ; **les liens compacts déjà partagés restent lisibles**, l'ancien format étant reconnu et accepté à la lecture.
- **Une couche de tuiles vectorielles avec contour ne laisse plus de résidu à chaque reconstruction.** Au changement de fond de carte ou de thème, la sous-couche de contour (`casing`) n'était pas retirée — la liste de nettoyage visait un identifiant que le constructeur ne produit pas. Chaque reconstruction laissait donc l'ancienne derrière elle, et la source était libérée alors qu'une couche y faisait encore référence.
- **La progression d'un téléchargement hors-ligne ne dépasse plus 100 %.** Le pourcentage émis n'était pas borné : une ressource comptée deux fois — une reprise enregistrée à la fois en succès et en échec, une énumération qui produit un doublon — poussait l'affichage au-delà de 100 (mesuré : 150 % et 200 %). La valeur est désormais bornée à `[0, 100]`.
- **La file de synchronisation hors-ligne se vide de nouveau.** `GeoLeaf.Storage.DB` n'exposait pas `updateSyncQueueStatus()` ni `removeSyncQueueEntry()`, alors que les plugins de collecte terrain (AddPOI, Storage, Editor) les appellent pour marquer puis retirer chaque opération rejouée. Selon le site d'appel, la tentative levait une `TypeError` ou ne faisait rien du tout — dans les deux cas la file n'était jamais purgée, et les opérations déjà synchronisées y restaient indéfiniment. Les deux méthodes sont désormais déléguées au moteur de synchronisation, comme les quatre autres opérations de file qui l'étaient déjà.
- **`maxRetries: 0` ne fait plus échouer un téléchargement sans l'avoir tenté.** L'orthographe évidente de « ne pas réessayer » rendait la boucle de tentatives **inatteignable** : l'opération n'était jamais appelée et le cache hors-ligne rapportait un échec sans cause. Le champ est renommé **`maxAttempts`** — il a toujours compté le nombre **total** de tentatives, pas le nombre de reprises. `maxRetries` reste accepté comme alias déprécié et normalisé, donc aucun profil existant ne bascule silencieusement sur la valeur par défaut.
- **Le cache hors-ligne ne gonfle plus indéfiniment à cause des thèmes.** Les entrées mises en cache sans profil — c'est le cas de tout thème — étaient stockées hors de l'index d'éviction : elles n'étaient **ni comptées dans le budget, ni jamais supprimées**. Un cache composé uniquement de thèmes se déclarait vide et n'évinçait rien, quel que soit le quota configuré.
- **Le téléchargement hors-ligne ne signale plus les URL de schéma dangereux, il les ignore.** Deux points de récupération (résolution de style, calcul d'emprise) suivaient sans contrôle des URL provenant d'un style ou d'un TileJSON distants ; une entrée en `javascript:`, `data:`, `file:` ou `blob:` y était atteignable. Elles sont désormais refusées avant tout appel réseau, et l'énumération continue sur les entrées suivantes au lieu de s'interrompre.
- **La fin d'un téléchargement hors-ligne n'échoue plus dans un contexte sans DOM** (service worker, rendu serveur) : l'émission de l'événement de progression levait une erreur **après** que toutes les ressources avaient été récupérées, transformant une opération réussie en échec.
- **Les notifications ne deviennent plus muettes après une réinitialisation de la carte.** Quand la capacité de notification était détruite puis recréée (hôte SPA, rechargement de profil), le moteur revenait désactivé : `notify()` et ses variantes ne levaient rien, n'affichaient rien, et **ne se repliaient pas non plus sur la console** — le noyau croyait toujours disposer d'un moteur de rendu, donc les messages étaient **perdus** plutôt que dégradés. Une réinitialisation ramène désormais un moteur actif, et les messages émis pendant l'intervalle sont mis en file puis délivrés.
- **Les libellés de couche réagissent de nouveau au zoom après un changement de fond de carte ou de thème.** Quand l'adaptateur cartographique était remplacé **sans** destruction préalable, l'abonnement au zoom restait attaché à l'ancienne carte : les libellés cessaient silencieusement de se recalculer jusqu'au rechargement de la page.
- **Les boutons de libellés et le bouton de partage ne survivent plus à la destruction de leur capacité.** Ils restaient dans le DOM après un `destroy()` ; cliquer sur un bouton de libellé appelait encore le module détruit.
- **Les listes d'identifiants du permalink sont plafonnées en longueur, pas seulement en nombre.** `gl_layers` / `gl_shown` / `gl_cats` / `gl_tags` limitaient déjà le nombre d'éléments à 100, mais un élément unique pouvait peser des mégaoctets ; chaque élément est maintenant tronqué à 200 caractères, comme les champs texte.

- **Le panneau de filtres annonçait aux lecteurs d'écran un libellé différent de celui affiché.** Quand un profil ne définit pas `modules.filter.title`, la région annonçait « Filter » pendant que son titre visible affichait « Filtrer » — un nom accessible qui ne correspond pas au libellé visible (WCAG 2.5.3). Les deux viennent désormais d'une source unique.
- **Le panneau de filtres est enfin traduit.** Son titre, ses boutons Appliquer/Réinitialiser, son bouton de fermeture et son message « aucune catégorie » étaient des chaînes françaises en dur — alors que les traductions correspondantes existaient déjà, complètes, dans les six dictionnaires. Un utilisateur anglophone ou germanophone voyait du français. Les libellés définis par le profil restent prioritaires.
- **Le panneau latéral de détails et le gestionnaire de couches parlent la langue choisie.** Deux clés de traduction du panneau latéral manquaient dans les six dictionnaires, et trois du gestionnaire de couches manquaient en espagnol, portugais, italien et allemand : ces éléments retombaient sur le français quelle que soit la langue configurée.
- **Quatre profils livrés affichent enfin le libellé de recherche que leur auteur avait écrit.** `france-risques-inondation`, `france-urbanisme-btp`, `guyane-biodiversite` et `tourism` renseignaient une invite spécifique (« Rechercher une station… », « Rechercher un bâtiment, chantier… », « Rechercher un nom, une parcelle… », « Rechercher un POI… ») dans `modules.filter.searchPlaceholder` — la clé que personne ne lisait — tout en laissant le générique « Rechercher... » dans celle qui est réellement rendue. Ces libellés sont remontés sur le champ de recherche concerné, où ils alimentent aussi son nom accessible.
- **Le titre du panneau de légende est traduit.** Son défaut était la chaîne **anglaise** « Legend », servie telle quelle aux six langues dans une interface par ailleurs française. Il vient désormais du dictionnaire et suit `ui.language`. Un profil qui définit `modules.legend.title` reste prioritaire.
- **`GeoLeaf.Storage` : un assainisseur qui n'assainit pas ne peut plus écrire.** Quand un validateur rejetait une valeur et qu'un `sanitize` était fourni, le résultat de l'assainissement était stocké **sans être revalidé** — le validateur devenait donc consultatif dès qu'un assainisseur existait. Le résultat est maintenant revalidé une fois, et refusé s'il est encore invalide.
- **Les bornes `min`/`max` d'un schéma de validation sont appliquées.** Elles étaient ignorées, sans message, si le champ ne déclarait pas aussi `type: "number"` : un schéma écrit `{ min: 5 }` ne vérifiait rien du tout.
- **La sérialisation JSON ne renvoie plus `undefined` là où elle promet une chaîne.** Pour une valeur que JSON ne peut pas représenter (`undefined`, une fonction, un symbole), `JSON.stringify` _retourne_ `undefined` au lieu de lever — le repli n'était donc jamais emprunté, et l'appelant recevait `undefined` d'une fonction déclarée rendre une chaîne.
- **Les valeurs par défaut de la légende sont enfin annoncées par l'introspection.** `modules.legend` appliquait trois défauts (`title`, `position`, `collapsedByDefault`) que son schéma ne déclarait pas : un outil de configuration ne pouvait pas les afficher. ⚠️ Le défaut de `title` est la chaîne **anglaise** « Legend » alors que le reste de l'interface est en français — le schéma le signale désormais explicitement plutôt que de le laisser découvrir à l'usage.
- **La configuration de taxonomie est enfin visible par l'introspection.** `modules.taxonomy` déclarait **1 clé sur les ~19 qu'il consomme** : un outil de configuration interrogeant le schéma ne voyait ni les icônes, ni les options de rendu par surface, ni les taxonomies elles-mêmes. Les quatre sous-arbres (`icons`, `render`, `taxonomies`, `layers`) sont désormais déclarés avec leurs valeurs par défaut réelles.
- **Le partage exécution / build de `modules.pwa` est documenté dans le schéma.** `description`, `theme_color` et `background_color` ne sont lues qu'à la génération du `manifest.json` — jamais à l'exécution —, alors que `name` et `short_name` le sont des deux côtés. Rien ne le disait : chaque clé porte maintenant la mention correspondante.

### Changed — BREAKING

- **`modules.filter.searchPlaceholder` est supprimé.** La clé était déclarée, typée et écrite par les profils, mais **aucun code ne l'a jamais lue** : le panneau de filtres n'a pas de champ de recherche global, seul un descripteur `fields[]` de type texte porte un placeholder (`fields[].placeholder`), qui lui est bien rendu. Aucun changement visible : une carte affichait déjà le placeholder par champ.

    **Ce qui change pour vous** : rien au runtime — un profil JSON qui garde la clé la voit ignorée, exactement comme avant. En TypeScript, une configuration typée `FilterConfig` qui la mentionne ne compile plus ; le remplacement est `fields[].placeholder` sur le champ de recherche concerné.

- **`modules.permalink.fields` n'accepte plus `"lat"`, `"lng"` ni `"zoom"`.** Ces trois valeurs étaient **inertes** : l'état de vue est écrit inconditionnellement et exigé au parsing (un permalink sans vue ne restaure rien), donc les retirer de la liste ne changeait rien. Plutôt que de laisser le type promettre une granularité que le runtime n'honore pas, la vue est déclarée obligatoire et sortie de l'énumération — `fields` ne contient plus que ce qu'il gouverne réellement : `layers`, `shownLayers`, `filter`, `categories`, `tags`, `rating`, `theme`.

    **Ce qui change pour vous** : rien au runtime — un profil JSON qui liste encore `"lat"`/`"lng"`/`"zoom"` continue de fonctionner à l'identique, ces entrées sont simplement ignorées. En TypeScript, une configuration typée `PermalinkConfig` qui les mentionne ne compile plus : retirez-les. La vue reste toujours sérialisée, y compris avec `"fields": []`.

### Removed

- **Documentation `GeoLeaf.UI.PanelBuilder` retirée.** Cette page décrivait une API absente du code : aucune des fonctions documentées (`createPlainSection`, `renderText`, `renderTable`…) n'existe plus, et les classes CSS `.gl-poi-panel__*` qu'elle présentait n'étaient produites par rien. La feuille de style correspondante est supprimée du même coup. Les intégrateurs qui composent leurs propres panneaux de détail doivent utiliser `GeoLeaf.FeatureInfo`.

### Internal

- **Feuilles de style allégées de ~24 %** (`geoleaf-main.min.css` : 127 → 97 Ko). Trois feuilles de la capacité `feature-info` étaient chargées en double — l'une étant la concaténation exacte des deux autres — et environ 850 lignes de règles ne correspondaient à aucun élément produit par le code. Aucun changement d'apparence attendu ; les classes publiques documentées sont inchangées.
- **`maxPersistent` est enfin appliqué.** Le champ était accepté et documenté (`@default 2`) mais `init()` ne le lisait jamais : la valeur du constructeur s'appliquait quoi qu'il arrive, et le configurer ne changeait rien à l'écran.

### Removed — BREAKING

- **Les deux méthodes de rapport de plugins sont remplacées par `GeoLeaf.plugins.reportPlugins()`.** Elles partitionnaient le registre en deux catégories. Il n'y en a plus qu'une : tous les plugins sont MIT et publiés sur npmjs.

    Le partage était de surcroît faux. Chaque rapport s'appuyait sur une liste de noms codée en dur qui **écrasait** le champ `type` déclaré par le plugin, et les deux listes le contredisaient en sens inverse : `storage` et `editor` figuraient chacun dans la liste opposée à celle qu'ils déclaraient. Résultat, ces deux plugins étaient affichés par **les deux** rapports, et chaque démarrage les comptait deux fois.

    **Ce qui change pour vous** : remplacez les deux appels par `GeoLeaf.plugins.reportPlugins()`. Il n'y a plus qu'un rapport, sans doublon. Un plugin dont `healthCheck()` échoue est signalé sur sa ligne mais ne déclenche plus de `console.warn` — l'un des deux anciens rapports le faisait, l'autre non, et c'est le second comportement qui est retenu : `connector` n'est légitimement pas connecté au boot, avertir à chaque chargement de page serait une fausse alerte.

- **Le champ `type` du manifeste `plugins.register()` est supprimé.** Il ne servait qu'aux deux rapports ci-dessus, et après leur fusion plus rien ne le lisait. Le contrat Plugin Contract v1 (règle PC-03) ne l'exige plus.

    **Ce qui change pour vous** : retirez `type` de votre appel `plugins.register()`. Le laisser est sans effet — les champs inconnus sont ignorés — mais il ne sera plus validé ni lu.

### Changed

- Le message de démarrage liste désormais simplement les plugins chargés (`<plugins>`, ou `open source` si aucun). L'ancien format les séparait en deux groupes sur une liste de préfixes codée en dur (`storage`, `addpoi`) qui **omettait `cog`** et ignorait le champ `type` : il étiquetait mal les plugins qu'il connaissait et manquait celui qu'il ne connaissait pas.

- **La légende résout l'icône d'une catégorie de taxonomie via le seul champ `svgId`.** Elle s'aligne sur le reste de la capacité taxonomy (icônes carte, pastilles de badge) et sur le résolveur partagé, qui n'ont jamais lu que `svgId`. Les champs hérités `icon` / `iconId` d'une entrée de catégorie ne sont plus lus **par la légende** (ils l'étaient encore, en repli). Aucun profil livré n'était concerné — les 9 déclarent `svgId`. **Ce qui change pour vous** : si un profil personnalisé posait `icon` ou `iconId` dans ses catégories `taxonomy.json` pour la légende, renommez-les en `svgId` (déjà la forme documentée).

- **`modules.cluster.clusterRadius` et `modules.cluster.disableClusteringAtZoom` pilotent enfin le clustering des couches point GeoJSON.** Ces deux clés étaient exposées par le schéma d'introspection mais **jamais appliquées** : le rayon réel d'une couche GeoJSON restait figé à 80 px (max-zoom 14) quelle que soit la valeur configurée au niveau du profil, la clé ne servant en interne qu'à une comparaison de stratégie. La précédence est désormais **override par-couche → `modules.cluster.*` → défaut**. Le schéma est corrigé en conséquence : `clusterRadius` annonce son vrai défaut `80` (l'introspection indiquait `50`, qui ne correspondait à rien d'appliqué) et `disableClusteringAtZoom` déclare son défaut `14`. **Ce qui change pour vous** : si vous posiez `modules.cluster.clusterRadius` / `disableClusteringAtZoom` en attendant qu'ils agissent, ils agissent maintenant — vérifiez la valeur voulue. Un profil qui ne les définissait pas garde exactement le rendu actuel (80 / 14). Le rayon du cluster POI partagé (50 px) est inchangé et reste indépendant de cette clé.

### Added

- **`GeoLeaf.Events` existe enfin au runtime.** `index.d.ts` déclarait `GeoLeaf.Events` et la page `EVENTS_API.md` l'employait dans 18 exemples, mais **rien ne montait cette casse** : seul `GeoLeaf.events` (minuscule) était posé sur le global. Conséquence, `GeoLeaf.Events.on(...)` **compilait** — les typages l'affirmaient — puis levait un `TypeError` à l'exécution.

    Les deux formes sont désormais montées et strictement équivalentes (`GeoLeaf.Events === GeoLeaf.events`). `Events` est la casse canonique ; **`events` reste un alias permanent et n'est pas déprécié**, exactement comme `Baselayers` / `BaseLayers`.

    **Ce qui change pour vous** : rien à faire. Si vous suiviez la documentation, votre code fonctionne maintenant tel qu'il est écrit ; si vous aviez contourné le problème en écrivant `events`, il continue de fonctionner à l'identique.

- **`GeoLeaf.Utils.wktToGeoJSON()` existe enfin.** Elle était annoncée au CHANGELOG depuis la v2 et documentée comme membre du namespace, mais **n'a jamais été posée au runtime** : elle ne vivait que sur un objet assemblé par un module devenu injoignable au retrait des builds UMD (v2.0.0). L'appeler levait un `TypeError`. Elle est désormais réellement montée.

- **`import { Utils }` et `window.GeoLeaf.Utils` exposent enfin la même chose.** L'export ESM ne portait que 12 membres là où le global en portait 27 : le même nom désignait deux objets de formes différentes selon la façon de l'atteindre, et rien ne l'empêchait de diverger davantage. Les deux surfaces sont désormais composées au même endroit et verrouillées par un test.

    Ce sont toujours **deux objets distincts** — le global doit rester modifiable et ré-appliquable par le cycle de vie des modules — mais leurs membres sont identiques.

    **Ce qui change pour vous** : `import { Utils }` donne accès à 16 membres qu'il ne portait pas (`DOMSecurity`, `FetchHelper`, `ObjectUtils`, `ScaleUtils`, `TimerManager`, `createElement`…). Rien n'est retiré.

- **`GeoLeaf.Utils` est enfin typé.** Son interface publique était déclarée `{ [key: string]: unknown }` : aucune complétion, chaque membre typé `unknown` (donc `Utils.debounce(fn)` exigeait un cast), et surtout **aucun écart entre la documentation et le runtime n'était détectable à la compilation**. Les 28 membres sont désormais déclarés.

- **`IMapAdapter` expose `getMarkerHandle(id)`.** Nouvelle méthode **optionnelle** du contrat d'adaptateur : elle retourne un handle typé (`GeoLeafMarkerHandle` — `getLngLat()` + `on(event, cb)`) sur un marqueur créé via `createMarker()`, ou `null`. Elle existe pour les deux interactions que la gestion par identifiant ne couvre pas — lire la position d'un marqueur **après que l'utilisateur l'a glissé**, et s'abonner à ses propres événements.

    **Ce qui change pour vous** : rien à faire. La méthode est optionnelle, donc un adaptateur personnalisé qui ne l'implémente pas reste conforme. Si vous écrivez un adaptateur pour un moteur doté d'un modèle d'événements par marqueur, vous pouvez désormais l'exposer proprement au lieu d'obliger l'appelant à contourner le contrat.

### Fixed

- **Un filtre de proximité sans rayon ne vide plus la liste.** Une recherche de proximité activée avec un centre mais **sans rayon** rejetait tous les itinéraires (la comparaison portait sur un rayon `undefined`), au lieu de se comporter comme un critère absent. Un rayon manquant est désormais traité comme l'est déjà un centre manquant : le critère ne s'applique pas, et rien n'est filtré à tort.

- **Une sélection de tags vide ne filtre plus tout.** Sur les listes d'itinéraires, activer le filtre par tags **sans cocher aucun tag** vidait le résultat, alors que le moteur de filtrage général traite une sélection vide comme « aucune contrainte » et laisse tout passer. Les deux chemins répondent désormais à l'identique — une sélection vide n'exclut rien.

- **Un titre écrit `variant: "title"` est enfin honoré dans le panneau latéral.** Un champ de détail se déclare titre de deux façons, `variant: "title"` ou `style: "title"`, et le schéma accepte les deux partout. Le popup les traitait à égalité ; le panneau latéral ne reconnaissait que `style`. Un champ authoré avec `variant` y perdait donc son statut de champ requis — il **disparaissait** quand sa valeur était vide — et son icône de catégorie, alors que le même champ s'affichait correctement en popup. Les deux écritures sont désormais équivalentes sur les deux surfaces. Aucun rendu ne change pour les profils existants : la convention d'écriture actuelle n'atteignait pas le défaut.

- **Le focus ne s'échappe plus de la visionneuse d'images au clavier.** Le piège de focus de la lightbox ne reconnaissait que les boutons : une visionneuse contenant un lien (crédit photo, lien source) laissait `Tab` sortir du dialogue. Liens, champs de saisie, listes déroulantes et zones de texte sont désormais pris en compte. Même correction sur la modale de partage, qui incluait à l'inverse les éléments désactivés — `Tab` pouvait y bloquer le focus sur un élément incapable de le recevoir.

- **Les étiquettes ne disparaissent plus définitivement après un changement de fond de carte.** Lorsque le style de la carte est rechargé (changement de fond ou de thème), la suppression d'une couche d'étiquettes peut échouer. Sur le chemin déclenché par le zoom, cette erreur n'était pas rattrapée : elle interrompait le traitement, et le calque restait considéré comme « étiquettes affichées » — il ne les reconstruisait donc plus jamais pour le reste de la session.

- **Le thème que vous choisissez survit enfin à un rechargement.** Le boot ré-appliquait le thème du profil en l'écrivant dans `localStorage`, écrasant la préférence qu'il venait d'y lire : aucun thème choisi ne tenait. La précédence est désormais explicite — **choix utilisateur stocké → `ui.theme` du profil → `prefers-color-scheme`** — et le boot n'écrit plus jamais. Seule une action explicite (le bouton de thème, ou `GeoLeaf.setTheme()`) persiste.

- **Le bouton d'une couche masquée par le zoom l'éteint enfin.** `toggleLayer()` décidait à partir de la visibilité _physique_, que le zoom peut forcer à « invisible », alors que le bouton reflète l'état _logique_. Sur une couche que vous aviez activée mais que le zoom courant masquait, le clic la ré-activait au lieu de l'éteindre.

- **Changement rapide de fond de carte : plus de résultat périmé.** Passer d'un fond WMTS à un fond raster pendant que la requête WMTS était encore en vol laissait le résultat périmé s'appliquer par-dessus le nouveau fond. La requête est désormais annulée et son résultat écarté.

- **Contraste du survol des boutons de fond de carte.** En thème clair, le libellé passait à un ratio de 1,10:1 au survol — c'est-à-dire illisible (WCAG AA demande 4,5:1). Corrigé à 15,48:1. Le thème sombre n'était pas affecté.

- **Le jeton CSRF dégrade au lieu de planter.** Son rafraîchissement automatique n'était pas gardé : si la source cryptographique disparaissait après le démarrage, le minuteur levait une erreur toutes les ~55 minutes, dans une file où rien ne pouvait l'intercepter.

### Changed

- **`style.shape` est restreint à `"circle"`.** Le schéma le déclarait en texte libre et la documentation annonçait `"square"` et `"triangle"` — **aucune des deux n'a jamais été rendue**. Les points sont dessinés par une couche `circle` MapLibre, qui ne dessine que des cercles. La clé est par ailleurs inerte (aucun code ne la lit) et reste réservée. Pour différencier des catégories, utilisez `styleRules` ou la taxonomie.

    **Ce qui change pour vous** : un profil déclarant `"shape": "square"` est désormais rejeté par la validation, au lieu d'être accepté puis ignoré silencieusement.

- **Libellés du gestionnaire de couches traduisibles.** « Gestionnaire de layers » (franglais) devient « Gestionnaire de couches » et passe, comme « Fond de carte » et « Couches GeoJSON », par des clés i18n surchargeables.

### Removed

- **`GeoLeaf.ensureMap()`, `GeoLeaf.requireMap()`, `GeoLeaf.hasMap()` et `GeoLeaf.Utils.MapHelpers` sont retirés.** Ils n'étaient déclarés dans aucun typage, documentés nulle part, et n'avaient **aucun appelant** dans l'ensemble du monorepo (plugins, démos, e2e, profils).

    Ils étaient surtout **faux** : leur duck-typing exigeait `setView`, une méthode **Leaflet** qui n'existe pas dans l'API MapLibre. `GeoLeaf.ensureMap(maCarteMapLibre)` retournait donc `null`. Ils ne validaient pas « est-ce une carte ? » mais « est-ce l'adaptateur GeoLeaf ? », sans le dire.

    **Le résolveur à utiliser est `GeoLeaf.Utils.ensureMap()`** — celui qui est documenté, exporté en ESM et effectivement appelé. Il a repris la validation que cette paire portait, **moins l'exigence Leaflet**.

- **Trois pages de documentation décrivaient des API qui n'existaient pas.** Elles sont corrigées ou retirées. Aucune n'était appelable : un copier-coller de leurs exemples levait un `TypeError`.
    - `GeoLeaf.Helpers.createElement()` — **retirée en v3** (aucun appelant, et sa forme d'options divergeait en silence de la fabrique canonique : elle lisait `styles` là où l'autre lit `style`, et faisait gagner `innerHTML` sur `textContent`). La documentation la présentait toujours. **Migration : `GeoLeaf.Utils.createElement(tag, props, ...children)`**, en renommant `styles` → `style`.
    - `GeoLeaf.Utils.escapeHtml()` — **n'a jamais été montée au runtime** (même cause que `wktToGeoJSON` ci-dessus). **Utiliser `GeoLeaf.Security.escapeHtml()`**, qui est montée, testée et documentée.
    - La page `AbstractRenderer` décrivait une classe **et un fichier source** supprimés lors de la purge du code Leaflet-era. Page retirée.

    **Cause commune, et corrigée** : le contrôle qui valide les exemples de la documentation existait mais **n'était branché nulle part** — ni en CI locale, ni dans un workflow. Un contrôle jamais exécuté ne se distingue pas d'un contrôle absent. Il est désormais câblé, et ces trois API y sont épinglées.

### Changed

- **`GeoLeaf.Utils.ensureMap()` valide désormais son argument.** Elle retournait auparavant **tel quel** tout argument non vide : `ensureMap("foo")` valait `"foo"`, alors que sa documentation promet « l'instance carte MapLibre GL » et que l'exemple enchaîne `map.fitBounds(...)`. La panne n'apparaissait donc qu'au premier appel de méthode, loin de la cause.

    Un argument qui n'est pas une carte donne maintenant `null`, comme une carte absente. Le duck-typing porte sur `getCenter` / `getBounds` / `on` / `off` — présents à la fois sur un adaptateur GeoLeaf et sur une `maplibregl.Map` brute.

    **Ce qui change pour vous** : rien si vous testiez déjà le retour (`if (map) …`, la forme documentée). Si vous faisiez transiter autre chose qu'une carte par cette fonction, passez-la directement.

- **Protection anti-prototype-pollution — source unique.** Les gardes `__proto__` / `constructor` / `prototype` étaient recopiés dans **quatre modules**, sous quatre formes divergentes dont trois silencieuses. Ils sont désormais tous adossés à une blocklist canonique unique. Trois écritures atteignables depuis le bloc `modules` d'un profil (`mergeModulesBag`, `mergeModuleBags`, chargeur `Files.modules`) n'étaient **pas** gardées et le sont ; un identifiant de module valant `__proto__` dans un profil ne peut plus reparenter le sac de configuration. **Aucun changement d'API** — les identifiants légitimes sont inchangés.

### Fixed

- **`GeoLeaf.Filters.filterRouteList()` — le rayon de proximité valait tantôt des kilomètres, tantôt des mètres.** La fonction résolvait sa distance par `GeoLeaf.Utils.getDistance ?? haversine`. Les deux satisfont la **même signature** `(lat1, lng1, lat2, lng2) => number`, mais la première retourne des **kilomètres** et la seconde des **mètres** : le rayon était donc interprété à un facteur 1000 près **selon que `GeoLeaf.Utils` avait été chargé ou non**. Dans un bundle complet c'était la branche kilomètres qui gagnait ; la suite de tests, elle, ne posait jamais `GeoLeaf.Utils`, donc elle validait depuis toujours la branche mètres — d'où un défaut resté invisible.

    **`proximity.radius` est désormais en mètres, sans condition**, en cohérence avec le prédicat du moteur de filtre et avec la conversion `radiusKm * 1000` déjà faite par le panneau et le sérialiseur de permalien. L'unité est maintenant **documentée** dans les typages (`FilterStateInput.proximity`), ce qu'elle n'était nulle part.

    **Ce qui change pour vous** : si vous appeliez `filterRouteList()` avec une proximité active et que vous compensiez le comportement kilomètres, divisez votre rayon par 1000. Les filtres catégorie, sous-catégorie, tags, note et recherche sont inchangés, et le filtrage de proximité du panneau intégré n'était pas affecté (il passait déjà par le moteur, correct depuis toujours).

- **Typages publics — `GeoLeaf.Errors` décrivait des signatures qui n'étaient pas celles du code.** Six écarts, tous corrigés dans `index.d.ts` sans toucher au runtime :
    - `createError()` était déclarée `(message, code?, context?)` alors que son **premier argument est la classe d'erreur** : `createError(Errors.ValidationError, "message")`. Le code TypeScript écrit d'après les typages passait un message là où le runtime attend un constructeur.
    - `safeErrorHandler()` était déclarée `(error, handler)` — le runtime attend **`(handler, error)`**.
    - `GeoLeafError.timestamp` était typée `number` ; c'est une **chaîne ISO-8601**.
    - Le constructeur était déclaré `(message, code?, context?)` ; il est `(message, context?)` — un appel à trois arguments compilait et rangeait le code dans le contexte.
    - `code` était déclarée requise alors que la classe de base ne l'assigne jamais.
    - `normalizeError()` omettait son second paramètre `defaultMessage`.

- **Typages publics — `GeoLeaf.Helpers` déclarait quatre méthodes qui n'existent pas.** `debounce`, `throttle`, `fetchWithTimeout` et `batchDomOperations` figuraient dans `HelpersAPI` mais n'ont **jamais** été présentes sur l'objet runtime : les appeler compilait puis levait `TypeError`. Même défaut que `_UIComponents.clearElement()` / `createEmptyMessage()`, corrigé en v3.0.0. Déclarations retirées.

    **Migration** : `debounce` et `throttle` existent bel et bien — sur **`GeoLeaf.Utils`**, pas sur `Helpers`. `fetchWithTimeout` n'a pas d'équivalent : utilisez `Helpers.createAbortController(timeout)` avec `fetch`. `batchDomOperations` non plus : `Helpers.createFragment()` couvre le cas.

    À l'inverse, six méthodes **bien réelles** étaient absentes des typages et sont maintenant déclarées : `applyCssText`, `lazyLoadImage`, `lazyExecute`, `addEventListener`, `addEventListeners`, `delegateEvent`. Aucun changement de runtime : `GeoLeaf.Helpers` expose les mêmes 23 membres qu'avant.

- **`GeoLeaf.Core.setTheme()` / `getTheme()` étaient désynchronisés du moteur de thème.** Les deux méthodes maintenaient leur **propre état interne**, jamais mis à jour par le moteur canonique (`GeoLeaf.UI`) — celui que pilotent le bouton de thème, `GeoLeaf.setTheme()` et la séquence de boot. Conséquences observables :
    - `Core.getTheme()` retournait `"light"` sur une page en thème sombre **dès la première frame**, et restait faux après tout changement fait ailleurs qu'à travers `Core.setTheme()`.
    - `Core.setTheme()` n'écrivait que la classe de `document.body` : pas de persistance `localStorage`, pas de classe sur le conteneur `#geoleaf-map` (thème incorrect en plein écran), pas de mise à jour de `aria-pressed` sur le bouton de thème (**défaut d'accessibilité**), pas d'émission de `geoleaf:ui-theme-changed`.

    Les deux méthodes **délèguent désormais au moteur canonique** quand `GeoLeaf.UI` est présent, et retombent sur la classe `body` sinon. `GeoLeaf.Core.setTheme()`, `GeoLeaf.setTheme()` et `GeoLeaf.UI.applyTheme()` sont donc **réellement interchangeables** — ce que la documentation affirmait déjà sans que ce soit vrai.

    **Aucun changement de signature ni de surface.** Le seul comportement modifié est celui qui était faux : `getTheme()` renvoie maintenant le thème réellement appliqué. Le message d'avertissement pour une valeur invalide devient `[GeoLeaf.Core] setTheme() ignored an invalid theme: {valeur}`.

    ⚠️ **Le thème choisi ne survit toujours pas à un rechargement**, pour une raison distincte et pré-existante : la séquence de boot ré-applique le thème d'initialisation en écrasant la valeur stockée. `setTheme()` écrit désormais bien `localStorage`, mais le boot repasse derrière. Ce point est suivi séparément et n'est pas modifié par cette version.

- **`GeoLeaf.Storage.OfflineDetector` — trois défauts.** (1) Le minuteur d'abandon du ping de connectivité n'était annulé que sur le chemin nominal : chaque ping en échec laissait un timer de 5 s vivant, s'accumulant tant que le réseau restait coupé. (2) L'état initial était lu depuis `navigator.onLine` **à l'import du module**, ce qui levait une exception dans tout environnement sans `navigator` (SSR, test Node sans jsdom) ; la lecture se fait maintenant dans `init()`, sous garde. (3) `init()` est désormais **idempotent** : un second appel démonte le précédent au lieu d'empiler une seconde série d'écouteurs `window`.

### Removed

- **BREAKING — `GeoLeaf.Bus` et `GeoLeaf.Utils.createEventBus()` retirés.** Un pub/sub en mémoire, monté au boot et **jamais relu** : aucune lecture dans la bibliothèque, les profils, les tests d'intégration ou les plugins, et il n'était déclaré ni dans `index.d.ts` ni dans les typings ambiants. Il portait de surcroît le même nom de fichier que le **vrai** bus d'événements du core, ce qui a produit deux diagnostics erronés en revue.

    **Migration.** Le système d'événements réel est inchangé et reste la seule voie supportée : `GeoLeaf.Events.on(name, handler)` / `.off()` / `.once()` côté écoute (26 événements documentés dans `EVENTS_API.md`). Si vous aviez besoin d'un bus applicatif générique, `EventTarget` du navigateur couvre le cas en trois lignes — ce module n'apportait rien de plus.

- **BREAKING — `GeoLeaf.DOMSecurity.createElement()` retiré.** ⚠️ **Malgré son namespace, cette fonction ne sanitisait rien** : elle n'appelait pas `setSafeHTML`, ne gérait pas `innerHTML`, et écrivait les attributs inconnus via `element[key] = value` **sans aucune garde**. Son nom promettait une protection qu'elle n'apportait pas — un piège d'autant plus sérieux que le contrat plugin dirige explicitement les auteurs vers `GeoLeaf.DOMSecurity.*` pour les opérations DOM sensibles. Elle n'avait aucun appelant.

    **Migration.** Utilisez `GeoLeaf.Utils.createElement(tag, props, ...children)` : elle garde les écritures de propriété et route `innerHTML` par `DOMSecurity.setSafeHTML()`. Le reste de `GeoLeaf.DOMSecurity` (`setSafeHTML`, `setTextContent`, `clearElement`, `clearElementFast`, `createSVGIcon`, `getIcon`, `SVG_ICONS`) est **inchangé** et reste la voie recommandée.

- **BREAKING — `GeoLeaf.Helpers.createElement()` retiré.** Aucun appelant, et sa forme d'options divergeait silencieusement de la fabrique canonique : elle lisait `styles` là où l'autre lit `style`, et faisait gagner `innerHTML` sur `textContent` (précédence inverse). Les deux interfaces portant un index signature, aucune vérification de type n'aurait signalé une substitution.

    **Migration.** `GeoLeaf.Utils.createElement()` — attention à renommer `styles` en `style` si vous passiez un objet de styles. Le reste de `GeoLeaf.Helpers` est inchangé.

### Security

- **Durcissement — les URL `data:` sont désormais validées contre la même liste blanche partout.** `GeoLeaf.Validators.validateUrl()` testait le **préfixe** `image/`, acceptant donc n'importe quel sous-type (`data:image/bmp`, `data:image/x-quoi-que-ce-soit`), là où `GeoLeaf.Security.validateUrl()` appliquait une liste blanche **exacte** de six types (`png`, `jpeg`, `jpg`, `gif`, `svg+xml`, `webp`). La même URL recevait donc des verdicts opposés selon le point d'entrée. Les deux fonctions partagent maintenant la liste blanche **et** le même analyseur de type MIME.

    **Effet observable.** `GeoLeaf.Validators.validateUrl("data:image/bmp;base64,…")` retourne désormais `{ valid: false }` au lieu de `{ valid: true }`. Les six types autorisés sont inchangés. Les signatures, les formes de retour et les messages d'erreur ne changent pas.

    Corrigé au passage : l'extraction du type MIME renvoyait `image/png;base64` au lieu de `image/png` (invisible face à un test de préfixe, bloquant face à une liste blanche exacte).

### Fixed

- **`GeoLeaf.Validators.validateUrl()` retournait un domaine inventé pour les URL relatives.** La fonction résolvait contre une base codée en dur (`http://dummy.com`), si bien que `validateUrl("/api/data.json")` retournait `{ valid: true, url: "http://dummy.com/api/data.json" }`. Elle résout désormais contre l'origine courante, comme `GeoLeaf.Security.validateUrl()`.

- **Typages publics — l'interface `ValidatorsAPI` était inutilisable.** `index.d.ts` déclarait **les huit** méthodes (`validateUrl`, `validateCoordinates`, `validateEmail`, `validatePhone`, `validateZoom`, `validateRequiredFields`, `validateGeoJSON`, `validateColor`) avec un type de retour `void`, alors que toutes retournent un objet `{ valid, error }`. Tout code TypeScript écrivant `if (GeoLeaf.Validators.validateUrl(u).valid)` échouait à la compilation. Les signatures déclarées correspondent maintenant aux implémentations, options comprises (`ValidatorOptions`, `ValidateUrlOptions`, `ValidateZoomOptions`, `ValidationOutcome` sont exportés).

- **BREAKING — `GeoLeaf._UIDomUtils` retiré du namespace.** Ce module interne (préfixe `_`) n'exposait plus que deux membres, tous deux **sans aucun appelant** dans la bibliothèque, les profils ou les tests d'intégration — mais tous deux **documentés avec exemples** dans `GeoLeaf_UI_Components_README.md`, publié sur npm. C'est cette page, et non le code, qui en faisait un contrat : le retrait est donc traité comme un _breaking change_, au même titre que `attachAccordionBehavior()` en son temps.

    **Migration.**
    - `GeoLeaf._UIDomUtils.resolveField(obj, path)` n'était qu'un **alias** du helper canonique interne ; il n'a jamais eu d'équivalent public. Un intégrateur qui s'en servait pour lire une propriété imbriquée peut le remplacer par une ligne sans dépendance :
      `const at = (o, p) => p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), o);`
    - `GeoLeaf._UIDomUtils.getActiveProfileConfig()` déléguait déjà à `GeoLeaf.Config.getActiveProfile()` — **appelez celle-ci directement**, elle est publique et inchangée.

    `GeoLeaf.UI._getActiveProfileConfig()`, la façade legacy qui enveloppait le second, est retirée dans le même mouvement (même absence d'appelant, même chemin de migration).

- **Documentation corrigée — `GeoLeaf._UIComponents.clearElement()` et `createEmptyMessage()` n'ont jamais existé.** Les deux étaient décrites avec un exemple copiable dans `GeoLeaf_UI_Components_README.md` alors qu'aucune n'est implémentée : les appeler levait un `TypeError`. Sections retirées. (`GeoLeaf.Utils.DOMSecurity.clearElement()` existe et est, elle, bien réelle — mais c'est un autre namespace.)

- **BREAKING — `GeoLeaf.LayerManager` : retrait de `updateSections()`, `addSection()`, `toggleCollapse()` et `isCollapsed()`.** Ces quatre méthodes étaient documentées mais **absentes des typings** (`index.d.ts` n'a jamais déclaré que `init()` et `refresh()`), et aucune n'avait d'appelant — ni dans la bibliothèque, ni dans les tests d'intégration, ni dans les profils. `toggleCollapse()` était de surcroît **cassé après un `Core.destroy()`** : il déréférençait `_container`, remis à `null` au démontage.

    **Migration.** Le repli du panneau reste piloté par son bouton d'en-tête (aucune action requise). Les sections se déclarent dans le profil JSON (`layerManagerConfig.sections`) — c'est le chemin nominal, et il était déjà le seul utilisé. L'ajout dynamique de section n'a pas de remplaçant programmatique : si vous en aviez un usage réel, ouvrez une issue, la méthode sera réintroduite **avec des typings et une couverture de bout en bout**.

    `GeoLeaf.LayerManager.init()` et `refresh()` sont inchangés.

- **`GeoLeaf._LayerManagerShared` retiré du namespace.** Clé interne (préfixe `_`, hors API publique documentée) qui exposait un objet d'état **sans aucun lecteur** : le véritable état du gestionnaire de couches vit dans le module lui-même. Son `reset()` ne nettoyait donc rien, et le panneau survivait à un cycle `destroy → recreate`. Corrigé : le teardown agit maintenant sur l'état réel.

### Fixed

- **Le gestionnaire de couches ne survit plus à un cycle `Core.destroy()` → `Core.init()`.** La carte, le contrôle et les sections accumulées persistaient d'une instance à l'autre, et un rafraîchissement différé en attente pouvait se déclencher sur un DOM détaché.

### Security

- **La validation des URLs de features applique désormais une whitelist de protocole.** Les propriétés `link`, `photo` et `url` d'une feature GeoJSON étaient contrôlées par un simple `new URL()` en `try/catch` — or `new URL("javascript:alert(1)")` **réussit**. Conséquence : une valeur en `javascript:`, `vbscript:`, `data:text/html` ou `file://` était considérée valide et **n'émettait aucun avertissement**. C'était le seul contrôle d'URL de la bibliothèque sans whitelist ; il délègue maintenant au validateur de sécurité canonique (`http:`, `https:`, `data:` images).

    **Portée exacte** : il s'agit d'un **avertissement de validation**, pas d'une faille d'injection. Ces valeurs n'atteignaient pas le DOM par ce chemin — le rendu (`renderLink` / `renderImage`) validait déjà l'URL **au sink** et n'affichait rien pour un protocole non autorisé. Le défaut est que la validation de features **taisait** un profil malveillant au lieu de le signaler.

    **Ce qui change pour vous** : de nouveaux avertissements en console si vos données contiennent ces protocoles. Les chemins relatifs (`/img/a.png`, `./a.png`, `../a.png`), les URLs protocol-relative (`//host/a.png`), les `data:` images et les schémas de contact (`mailto:`, `tel:`) restent acceptés à l'identique. Trois cas deviennent avertis alors qu'ils passaient avant : `ftp://`, `blob:` et les `data:image/*` hors whitelist MIME. Tous restent de sévérité `warning` — **aucune feature n'est invalidée**, rien n'est rendu différemment.

- **Durcissement anti-prototype-pollution du chemin d'écriture de configuration.** `Config.Storage.setValueByPath()` refuse désormais tout segment de chemin nommant `__proto__`, `constructor` ou `prototype` — **le dernier segment inclus** (un chemin d'un seul segment contournait la garde). Le même contrôle est appliqué à `GeoLeaf.Utils.setNestedValue()`, qui n'en avait aucun. Les autres écrivains de config (`set`, `merge`, `deepMerge`) étaient déjà protégés.

    **Impact concret** : un fichier `mapping.json` de profil dont une clé de `mapping` visait un prototype pouvait greffer une propriété **héritée** sur chaque POI normalisé, laquelle se propageait ensuite aux properties de features, aux popups et aux colonnes de tableau. **La pollution globale de `Object.prototype` n'était pas atteignable** — la portée était limitée aux objets POI en cours de construction. Aucun profil livré n'était affecté.

    **Non cassant** pour les configurations légitimes : seuls des chemins visant un prototype sont refusés, et l'écriture devient un no-op assorti d'un avertissement. Si vous utilisiez `GeoLeaf.Utils.setNestedValue()` avec de tels chemins, l'appel ne modifie plus l'objet.

    Documentation de sécurité (`docs/SECURITY.md`, `docs/security/SECURITY_CONTRACT.md`) réécrite et vérifiée contre le code : elle attribuait plusieurs vecteurs à une fonction inexistante.

### Fixed

- **Deux `aria-label` français comportaient un reste de franglais** (« Afficher / hide la layer » et « Afficher/hide les étiquettes »). Corrigés en français idiomatique (« Afficher / masquer la couche » et « Afficher/masquer les étiquettes »). Seul le dictionnaire français par défaut était concerné — les cinq autres locales étaient déjà correctes, et tant la clé i18n (`aria.layer.toggle`, `aria.labels.toggle`) que l'API `getLabel()` restent inchangées.

## [3.0.0] - 2026-07-16

> **Release majeure v3.0.0.** Elle consolide l'intégralité du chantier v3 : dissolution du sous-système POI en couches de points génériques, taxonomy v3 (le symbole du point), extraction des modules optionnels en capacités in-core et en plugins MIT, refonte multi-instance, durcissement sécurité (CSP `style-src` stricte) et **retrait dur de tout le legacy** (alias d'API dépréciés, shims de ré-export, fallbacks de format, clés de configuration legacy).
>
> Le saut depuis la dernière version publiée sur npm (**2.1.8**, 13/05/2026) est important : les changements cassants sont nombreux, et **chacun porte sa propre note « Migration »**.

> **⚠️ Reclassification (SR0, 04/07/2026) — `taxonomy` + `feature-info` sont des capacités intégrées à `@geoleaf/core`, PAS des packages npm séparés.** Les entrées ci-dessous rédigées avant cette date mentionnent `@geoleaf-plugins/feature-info` et `@geoleaf-plugins/taxonomy` comme plugins externes à installer/charger via `<script>` : **c'est caduc**. Ces deux capacités sont désormais **livrées dans le bundle core** (`geoleaf.esm.js` + `dist/geoleaf-main.min.css`), activées par configuration — aucune installation ni balise `<script>` supplémentaire. **Migration** : retirer les balises `<script src="dist/geoleaf-taxonomy.plugin.js">` et `<script src="dist/geoleaf-feature-info.plugin.js">`.

### Fixed

- **🔥 Le formulaire AddPOI n'affichait AUCUN champ catégorie / sous-catégorie — sur tous les profils.** Le plugin cherchait la taxonomie dans une clé `taxonomy` à la racine du profil actif, que le chargeur de profil n'a jamais produite : la lecture renvoyait donc toujours « rien », le constructeur de formulaire en concluait « ce profil n'a pas de taxonomie » et n'ajoutait ni la liste des catégories ni celle des sous-catégories. Silencieux : aucune erreur, aucun avertissement. La taxonomie est liée **à la couche** (`modules.taxonomy.layers.<id>.use`) : le formulaire la résout désormais à partir de la couche sur laquelle le POI est créé ou modifié, et la recharge quand vous changez de couche dans le sélecteur.
- **🔥 Le sprite d'icônes d'un profil n'était JAMAIS mis en cache pour le hors-ligne — sur tous les profils.** L'énumérateur de ressources cherchait `spriteUrl` à la racine du profil, là où il vivait **avant** la refonte `taxonomy` v3 ; depuis, il est déclaré dans le fichier de configuration de la capacité (`config/plugins/taxonomy.json`). Le fichier de config était bien téléchargé — mais pas le SVG qu'il désigne, donc les icônes manquaient une fois hors ligne. La résolution se fait maintenant via le manifeste `Files`, comme pour les couches, et l'URL est demandée **exactement** telle que le moteur la demande en ligne (une URL réécrite aurait été stockée sous une clé jamais consultée). Une capacité `taxonomy` désactivée ne télécharge toujours rien.
- **🔥 Un style sans `id` faisait échouer le chargement de sa couche — la couche n'apparaissait jamais.** Le schéma a cessé d'exiger `id` (le nom de fichier en tient lieu, cas d'environ 20 % des fichiers de style), mais le validateur runtime, lui, l'exigeait toujours : le style était rejeté, le loader levait, et la couche n'était jamais créée. Aucun message ne pointait la vraie cause. **15 styles de 3 profils de démonstration** étaient dans ce cas. Le validateur est aligné sur le schéma, et le loader dérive désormais l'`id` du nom de fichier — la dérivation que le schéma documentait sans que personne ne l'implémente. Un `id` déclaré explicitement reste prioritaire, et son format continue d'être validé.
- **Un `map.center` écrit `[lng, lat]` passait sans un mot.** `center` est `[lat, lng]`, comme `bounds`. Trois profils l'avaient inversé (`[-53, 4]` plaçait la Guyane dans l'océan Austral), sans effet visible tant qu'ils déclaraient aussi des `bounds` — que le loader préfère. Corrigés, et le chargeur de profil avertit maintenant quand un centre tombe **hors de ses propres bounds mais y rentre une fois permuté**, ou quand sa latitude sort de `[-90 ; 90]`. Un simple contrôle de plage ne suffisait pas : `-53` est une latitude parfaitement valide.
- **🔥 Une couche déclarant un seuil de zoom en `zoomConfig.minZoom`/`maxZoom` était invisible à TOUS les zooms.** Le champ s'appelait `minZoom`/`maxZoom` mais le moteur lisait son contenu comme un **dénominateur d'échelle** (le `X` de `1:X`) : un `minZoom: 6` était donc compris comme « échelle 1:6 », soit un zoom d'environ 27 — hors d'atteinte (MapLibre plafonne à 24). La couche n'apparaissait jamais ; cochée manuellement dans le gestionnaire de couches, elle apparaissait mais ne respectait alors plus aucun seuil. **18 couches de 3 profils de démonstration** étaient concernées. Le champ est renommé **`scaleConfig.minScale`/`maxScale`**, dont le nom énonce l'unité, et le validateur rejette désormais toute valeur `<= 24` ainsi que l'ancien bloc `zoomConfig` (cf. Breaking Changes ci-dessous). _Un profil dont les seuils étaient déjà des dénominateurs n'était pas affecté et garde ses valeurs telles quelles._
- **🔥 `import { Config } from "@geoleaf/core"` livrait un `Config` SANS `.get()`, `.set()`, `.getAll()`, `.loadUrl()` ni `.getSection()`.** Le build de `dist/esm/` — l'artefact que `exports["."]` résout, donc **ce que reçoit tout consommateur bundler (Vite, webpack, Rollup)** — élaguait les trois modules qui posent ces méthodes sur le singleton `Config`. **Le bundle CDN (`dist/geoleaf.esm.js`, `<script type="module">`, unpkg/jsdelivr) n'a jamais été touché** : si vous l'utilisez, vous n'avez rien à faire. Si vous importez `@geoleaf/core` depuis un bundler, **mettez à jour** : c'est un correctif, pas un changement d'API.
- **`package.json#sideEffects` ne protégeait rien.** Toutes ses entrées visaient `src/**/*.ts` — un dossier que `files` ne publie pas. Pour votre bundler, **tout le paquet était déclaré sans effet de bord**, ce qui l'autorisait à supprimer les modules qui peuplent `window.GeoLeaf.*`. Réécrit sur les chemins publiés, et désormais **dérivé du code** et gaté à chaque build.

### Added

- **`GeoLeaf.Taxonomy.getLayerCategories(layerId): Record<string, TaxonomyCategory>`** — les catégories associées à **une couche**, en résolvant `modules.taxonomy.layers.<id>.use` pour vous. Renvoie `{}` si la couche n'a pas de binding, si le binding désigne une taxonomie inconnue, ou si la capacité est désactivée (`enabled: false`).
    - À préférer à `getCategories(ref)` **dès que vous partez d'une couche** : `getCategories` attend le **nom** d'une taxonomie, que seule la table `layers` connaît. La lire vous-même revient à réimplémenter la résolution du binding — ce qui a coûté au formulaire AddPOI ses listes de catégories, vides sur tous les profils sans le moindre message (corrigé dans cette version, voir _Fixed_).

- **`GeoLeaf.PWA.isInstallable(): boolean`** — pour afficher **votre propre** bouton d'installation au lieu de la bannière intégrée. Elle suit le même aiguillage que la bannière : sur **iOS Safari**, `true` si l'app tourne sur iOS sans être déjà installée (iOS n'émet jamais `beforeinstallprompt`, c'est le seul signal disponible) ; sur **Android/Chrome/Edge**, `true` une fois que le navigateur a proposé un prompt d'installation différé.
    - ⚠️ Sur Android, la réponse signifie **« un prompt est disponible »**, pas « ce navigateur saurait installer l'app » : le prompt différé n'est capté que si `installPrompt.enabled` vaut `true`. Bannière désactivée ⇒ `false` même sur un Chrome installable. iOS n'est pas concerné.
    - _Note : le CDC interne annonçait cette méthode (ainsi que `prompt()`, `dismiss()` et `getInstallState()`) depuis la v2.1.0, alors qu'aucune n'était exposée. Seule `isInstallable()` avait une implémentation ; elle est désormais branchée, les trois autres n'ont jamais existé et sont retirées de la doc interne._

- **Sous-chemins `exports` stables**, pour composer votre propre entrée et n'embarquer que ce que vous listez :

    | sous-chemin                                  | contenu                                                                    |
    | -------------------------------------------- | -------------------------------------------------------------------------- |
    | `@geoleaf/core/kernel`                       | les façades du noyau (`Core`, `Config`, `UI`, `LayerManager`, `Events`, …) |
    | `@geoleaf/core/globals`                      | effet de bord : peuple `window.GeoLeaf.*` **et** tire la feuille du kernel |
    | `@geoleaf/core/helpers`                      | effet de bord : câble `GeoLeaf._app`                                       |
    | `@geoleaf/core/boot`                         | `installBoot(manifest)`                                                    |
    | `@geoleaf/core/capabilities/<id>/install.js` | l'installeur d'une capacité (`LEGEND_INSTALLER`, …)                        |
    | `@geoleaf/core/facades/<nom>.js`             | `Legend`, `Permalink`, `Share`                                             |
    | `@geoleaf/core/presets/manifest.full.js`     | le manifeste des 18 capacités livrées                                      |

    Tous typés. Voir **COOKBOOK.md, Recipe 8**.

- **Le CSS suit le code.** Chaque capacité importe sa feuille depuis son `install.ts` : le CSS est un nœud du graphe de modules et **tree-shake avec la capacité**. Une entrée sans `filter` n'embarque ni son JS, ni le CSS de sa barre de proximité (mesuré : **−19 % de CSS** sur l'exemple à 9 capacités).
- **Cascade explicite — `@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities, gl.overrides`.** L'ordre ne dépend plus de la façon dont votre bundler concatène. **`gl.overrides` vous est réservée** : une règle que vous y posez gagne sans `!important` et sans guerre de spécificité.

### Changed

- **⚠️ `GeoLeaf.registry.getAll()` et l'introspection listent 6 modules kernel au lieu de 8** — `security` et `api` n'y figurent plus. **Rien n'est retiré de l'API publique** : `GeoLeaf.Security`, `GeoLeaf.CSRFToken`, `GeoLeaf.DOMSecurity`, `GeoLeaf.API.*` et les autres façades sont inchangées, et sont même disponibles **plus tôt** (voir ci-dessous). Ces deux entrées n'étaient que des enveloppes de cycle de vie autour de sous-systèmes qui n'ont ni carte ni configuration à attendre : leurs `init()`/`destroy()` étaient vides. Vous n'êtes concerné que si vous **énumérez** les modules du registre (diagnostic, outillage) — pas si vous appelez leurs façades.
- **Les façades du kernel sont posées à l'import du bundle, avant `GeoLeaf.boot()`.** La surface disponible dès l'import passe de 64 à 88 clés : `GeoLeaf.GeoJSON`, `GeoLeaf.ThemeCache`, les aides `_LayerManager*` / `_UI*` / `_Theme*`, `_OfflineDetector`, `_StyleUtils`… **Aucune clé n'a disparu.** Concrètement, un plugin ou un script chargé avant `boot()` peut de nouveau appeler `GeoLeaf.I18n.registerDict()`, `GeoLeaf.notify()` ou `GeoLeaf.Utils.*` à son propre top-level sans que l'appel soit silencieusement perdu. C'est la restauration d'un comportement qu'une refonte interne (v2.x) avait retiré sans le documenter — et dont la perte était **muette** : le plugin se montait quand même, seuls ses libellés disparaissaient.
- **Le changement de fond de carte raster ne recrée plus la source quand seules les tuiles changent.** L'ancienne bascule détruisait la source et la couche pour les rebâtir à l'identique ; elle mute désormais les URLs en place (`setTiles`), ce qui évite le clignotement. Le comportement précédent reste employé dès qu'autre chose change (taille de tuile, attribution, bornes de zoom) : ces propriétés sont figées à la création de la source et une mutation les perdrait en silence.
- **L'affichage des coordonnées ne s'écrit plus qu'une fois par image.** Le curseur émet bien plus d'événements que l'écran n'affiche d'images : les écritures intermédiaires étaient invisibles par construction. La position affichée reste la dernière connue — la lecture ne se fige pas sur une position périmée.

### Added

- **Avertissement quand une couche affiche beaucoup de points sans clustering** (au-delà de 1000). Un profil lourd dégradait le navigateur sans le moindre signal. Le message nomme la couche, son nombre de points et l'option à activer. C'est un **avertissement seul** : le rendu n'est pas modifié, le clustering n'est pas forcé — à vous de décider.

### Changed

- **La fenêtre d'échelle d'une couche est désormais portée par le moteur, et elle fait loi.** `scaleConfig.minScale`/`maxScale` sont convertis en `minzoom`/`maxzoom` MapLibre et posés sur chaque sous-couche : la couche apparaît et disparaît **pendant** le zoom, au lieu d'attendre la fin du geste. Deux conséquences visibles :
    - **Cocher une couche hors de sa plage d'échelle ne l'affiche plus.** Auparavant, un clic dans le gestionnaire de couches outrepassait le seuil et la couche restait visible à tous les zooms. C'est ce contournement qui a masqué trois mois durant le bug `zoomConfig` corrigé ci-dessus. Le comportement est désormais celui d'un SIG : une couche a une plage, et la plage prime.
    - Les couches **clusterisées** respectent enfin leur plage : les pastilles de cluster étaient les seules sous-couches à ne pas recevoir les bornes, et continuaient de s'afficher hors fenêtre.
    - La conversion dépendant de la latitude (le même 1:X ne tombe pas au même zoom en Guyane et en Norvège), les bornes sont recalculées quand la carte se déplace suffisamment en latitude. Zoomer ne déclenche aucun recalcul.

- **💥 BREAKING — la recette « composer sa propre entrée » a changé de chemins.** Ceux que le COOKBOOK affichait (`@geoleaf/core/src/…`) **n'ont jamais fonctionné** : `src/` n'est pas publié. Utilisez les sous-chemins du tableau ci-dessus.
- **💥 BREAKING — `GeoLeaf._loadModule()` et `GeoLeaf._loadAllSecondaryModules()` sont SUPPRIMÉS, et rien ne les remplace.** Toute la machinerie de lazy loading disparaît (`src/lazy/`, le dispatcher, `_app._ensureModule`). **Migration : supprimez l'appel.** Ce que ces fonctions allaient chercher est déjà dans le bundle au moment où votre script s'exécute — elles répondaient au runtime à une question de **build**.
- **`@geoleaf/core/style.css` (→ `dist/geoleaf-main.min.css`) : chemin, nom et contenu inchangés.** Le fichier est désormais produit par Rollup au lieu de `postcss-cli`, mais il contient toujours le kernel **et** les 18 capacités. **Rien à changer si vous le chargez par `<link>`.**
    - **Elles ne tenaient d'ailleurs plus leur promesse.** Chaque capacité in-core s'ancre via son `install.ts` depuis la v3 : son code est dans la clôture eager. Les derniers chunks servis étaient donc des **coquilles de ré-export sur du code déjà présent** — Rollup les émettait **vides** (`Generated empty chunks`), et le navigateur les téléchargeait quand même à chaque chargement de page. Le boot faisait un aller-retour asynchrone pour rien.
    - **Le tableau des noms de modules de `COOKBOOK.md` était déjà faux à 7/9** (`poi`, `poiCore`, `poiExtras`, `legend`, `labels`, `themes`, `search` n'existaient plus) : un appel avec l'un de ces noms tombait déjà dans un `console.warn("Module inconnu")`.
    - **Si ce que vous vouliez était un bundle plus PETIT** (et non différé), c'est désormais un choix de build, et il est supporté : composez votre propre entrée à partir des installers de capacité dont vous avez besoin — le reste est **tree-shaké**, pas différé : **absent**. Recette complète et testée : `examples/minimal/entry.ts` (9 capacités sur 18, **−15 %** de charge au boot, mesuré à chaque build). Voir `COOKBOOK.md` — _Recipe 8 : Shipping less than the whole library_.
    - Un drapeau de config (`modules.<id>.enabled`) **désactive** une capacité ; il ne peut pas retirer son code du fichier que le navigateur a téléchargé. Seul le choix au build le peut.
- **💥 BREAKING — `taxonomy` v3 : la capacité gère désormais le SYMBOLE DU POINT, et rien d'autre.** Elle possède l'**icône**, sa **couleur**, la **pastille** (fond / bordure) et la **couleur des badges pill** catégorie / sous-catégorie des surfaces feature-info. La **couleur de la géométrie** (remplissage de polygone, trait de polyligne, **et couleur métier des points**) ainsi que la **taille du point** reviennent au `styleRules` de chaque couche.
    - **Ce qui disparaît de la config** : `categories.<val>.colorFill`, `.colorStroke`, `.color`, `.colorRoute`. Ces clés étaient documentées comme pilotant `fill-color` / `line-color` par catégorie — **elles ne peignaient rien** : le module qui les lisait n'a jamais été enregistré (son gate lisait une clé de profil chargée _après_ l'évaluation du gate). **Migration** : exprimer la couleur de géométrie dans les `styleRules` de la couche (`when.field` accepte n'importe quel attribut, y compris `properties.categoryId`).
    - **`modules.taxonomy.enabled` devient OPT-OUT** (défaut `true`) **et gate réellement tout** : `false` coupe icônes de carte, pastille, pills, icônes de légende et options de filtre par catégorie. Jusqu'ici la clé était opt-in **et ne désactivait rien** — la poser à `false` n'avait aucun effet observable. Un profil qui compte sur ce non-effet doit désormais retirer la clé.
    - **Règle de composition** : taxonomy **remplace la valeur par défaut** du paint du point ; les `styleRules` de la couche gardent la priorité. Cascade : `styleRules > sous-catégorie > catégorie > défaut de la couche`.
- **💥 BREAKING — retrait de `GeoLeaf.Helpers.StyleResolver`, `GeoLeaf.Helpers.getColorsFromLayerStyle()` et `GeoLeaf.Helpers.resolvePoiColors()`.** Ces trois helpers résolvaient une couleur de POI depuis les `styleRules` d'une couche, mais **codaient en dur** les noms de colonnes `properties.categoryId` / `properties.subCategoryId` et n'avaient **aucun appelant** dans le core. La résolution des `styleRules` est assurée par le convertisseur de style de l'adapter, qui accepte n'importe quel champ. Aucune API de remplacement — ces fonctions n'avaient pas d'usage documenté.
- **💥 BREAKING — retrait de `GeoLeaf.UI.hasActiveFilters()`, `GeoLeaf.UI.getActiveFilters()` et `GeoLeaf.UI.resetAllFilters()`.** Ces trois méthodes **ne répondaient déjà rien d'utile** : elles lisaient un état interne (`_UIFilterStateManager`) dont l'unique écrivain était conditionné à une clé de profil, `filters` à la racine, qu'**aucun profil n'a jamais déclarée** — pas même le profil de référence. En pratique `hasActiveFilters()` renvoyait donc **toujours `false`**, `getActiveFilters()` **toujours `[]`**, et `resetAllFilters()` ne remettait rien à zéro. C'est le dernier vestige de l'UI de filtres pré-capacités.
    - **Migration** : utilisez la capacité `filter`, qui lit le panneau réel — `GeoLeaf.Filter.hasActiveFilters()`, `GeoLeaf.Filter.getActiveFilter()`, `GeoLeaf.Filter.reset()`. Si votre code appelait les versions `GeoLeaf.UI.*`, il recevait déjà une réponse constante : le remplacement corrige un comportement, il ne le reproduit pas.
    - Le schéma de configuration correspondant (`profile.filters`) n'existe plus non plus : les filtres se déclarent sous `modules.filter` (fichier `config/plugins/filter.json` d'un profil).

### Added

- **Symbole du point — `iconColor` + `marker`** _(non-breaking, opt-in)_ : une catégorie (ou sous-catégorie) accepte désormais **`iconColor`** (teinte du glyphe ; absent ⇒ blanc, le rendu historique) et **`marker`** — soit `{ fill, stroke, strokeWidth }` pour une pastille sous l'icône, soit `false` pour une **icône nue** (ni fond ni bordure). Absent ⇒ taxonomy ne surcharge rien et le style de couche garde la main. **Aucun rayon** : la taille du point appartient à la couche (une même catégorie sert des couches aux rayons différents). Les icônes teintées sont rasterisées et enregistrées comme images MapLibre distinctes — un profil qui ne déclare aucune couleur conserve des identifiants de symbole **byte-identiques**.
- **`modules.taxonomy.render.<surface>.colorBadges`** _(non-breaking, opt-in, défaut `false`)_ : colore les badges pill catégorie / sous-catégorie de la surface (`popup` / `tooltip` / `sidepanel`) aux couleurs du `marker` de la catégorie — la pill et le symbole sur la carte se lisent comme un même objet. Nouvelle méthode de façade **`GeoLeaf.Taxonomy.resolveBadgeStyle(layerId, feature, surface, field)`** (taxonomy décide, feature-info pose le DOM).
- **`modules.taxonomy.icons.iconSize`** _(non-breaking, défaut `0.5`)_ : `icon-size` MapLibre de la sous-couche de symboles. Le défaut reprend exactement la valeur jusqu'ici codée en dur.
- **`GeoLeaf.Taxonomy.getIconVariants()` et `.resolveMarkerPaint(layerId, paint)`** _(non-breaking)_ : consommées par l'adapter MapLibre pour, respectivement, enregistrer les icônes teintées et composer le paint de la pastille.

### Fixed

- **Les badges pill étaient illisibles.** Une règle CSS non scopée de la feuille du side-panel écrasait celle du popup et imposait un texte quasi-blanc **sans aucun fond**, sur les deux surfaces. Les variantes colorées existaient dans la feuille de style mais n'étaient **jamais émises**, et leurs deux jeux de couleurs étaient **intervertis**. Les pills ont désormais un fond, un contraste vérifié, et les classes `gl-poi-badge--category` / `--subcategory`.
- **Le badge de synchronisation hors-ligne disparaissait au changement de thème.** Le chemin de re-stylage reconstruisait le paint des points sans réappliquer la décoration de synchro. Elle est désormais réappliquée, comme à la création de la couche.
- **Icônes de sprite définies par alias (`<use href="#…">`)** : elles s'affichaient dans les popups mais restaient **invisibles sur la carte** (le rasteriseur ne suivait pas la référence). L'alias est désormais résolu.

- **`GeoLeaf.Taxonomy.getIcons()` + clé `modules.taxonomy.icons.showOnMap`** _(non-breaking)_ : la façade `GeoLeaf.Taxonomy` expose désormais `getIcons()` (retourne le bloc `modules.taxonomy.icons` — `spriteUrl` / `symbolPrefix` / `defaultIcon` / `showOnMap` — ou `null`), **source unique** de la config d'icônes lue par l'injecteur de sprite POI et la légende (successeur in-core de l'ancien `GeoLeaf.Config.getIconsConfig()`, retiré — voir §Removed). Nouvelle clé optionnelle **`modules.taxonomy.icons.showOnMap`** (booléen, défaut « on » quand absent) : porte d'affichage des icônes de catégorie en légende (parité de l'ancien gate legacy).
- **Icône de catégorie à côté du titre dans les popups / tooltips / sidepanels — `modules.taxonomy.render`** _(non-breaking, opt-in)_ : nouveau bloc de config `modules.taxonomy.render.{popup,tooltip,sidepanel}.{showIconCategory,showIconSubcategory}` (6 flags booléens, défauts `false`) affichant l'**icône du POI à côté du titre** des surfaces d'info (comportement rétabli après la dissolution POI), par symétrie avec `showIconsOnMap` (icônes sur la carte). L'icône apparaît quand la taxonomie est activée, la couche est liée (`modules.taxonomy.layers.<id>.use`), un flag de la surface est `true`, et une icône résout — priorité **sous-catégorie → catégorie → icône par défaut**. Nouvelles méthodes de façade **`GeoLeaf.Taxonomy.resolveTitleIcon(layerId, feature, surface)`** et **`GeoLeaf.Taxonomy.ensureSprite()`** (la capacité `taxonomy` résout, la capacité `feature-info` injecte le glyphe `<use>` du sprite, CSP-safe). Comportement **byte-identique** tant qu'aucun profil n'active un flag.

- **Clustering — capacité in-core `GeoLeaf.Cluster` + `modules.cluster`** _(reclassification interne, façade additive)_ : le clustering de points (POI + couches GeoJSON de points, natif MapLibre `cluster:true`) est désormais une **capacité intégrée** déclarée (`cluster`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("cluster")`, active par défaut (**opt-out** via `modules.cluster.enabled: false`). Nouvelle façade lecture **`GeoLeaf.Cluster`** (`isEnabled()`, `getConfig()`). Le clustering est natif de bout en bout (aucune dépendance `supercluster` externe) ; rendu et comportement **inchangés**.

- **Événements d'interaction géométrique** _(non-breaking)_ : deux nouveaux événements DOM **`geoleaf:feature:click`** et **`geoleaf:feature:hover`** (`{ layerId, featureId, properties, lngLat, point, zIndex }`) émis par les couches GeoJSON et vector-tiles interactives lors d'un clic ou d'un survol. Ces événements remplacent les binders popup-tooltip internes et permettent à une capacité externe (par ex. `@geoleaf-plugins/feature-info`) de réagir aux interactions géométriques sans couplage au core. Le comportement POI (curseur, popup, side-panel) est **inchangé** ; POI continue d'émettre `geoleaf:poi:click` sur sa propre voie.

- **Plomberie de stylage par couche (pour capacités externes)** _(non-breaking)_ : nouvel événement DOM **`geoleaf:layer:added`** (`{ layerId, sourceId, geometryTypes }`), émis une fois par couche dès la création de ses sous-couches MapLibre (couches GeoJSON **et** groupes de clusters POI). Le registre de couches MapLibre expose désormais le **type géométrique réel** d'une couche : champ `geometryTypes` + accesseur `getGeometryTypes(layerId)` — distinct des sous-couches créées (un polygone crée aussi une sous-couche `line` pour son contour). Ces ajouts permettent à une capacité externe d'appliquer un style par couche sans polling. Premier consommateur : le plugin MIT **`@geoleaf-plugins/taxonomy`** — stylage par catégorie **géométrie-agnostique** (icône POI, remplissage polygone, trait polyligne) piloté par un mapping déclaratif `valeur → style` (taxonomies nommées réutilisables, `categoryField` explicite). Le moteur de rendu POI/GeoJSON du core est **inchangé** (la taxonomie POI legacy reste en place ; sa migration est planifiée avec la dissolution POI).

- **Seam i18n `GeoLeaf.I18n.t(key, fallback?)`** _(non-breaking)_ : le namespace `GeoLeaf.I18n` expose désormais `t(key, fallback?)` en plus de `registerDict` / `getLabel`. Il résout `key` via les dictionnaires enregistrés (core + plugins) et retombe sur `fallback` (ou la clé) si non résolue. Ce seam — promis par le contrat field-renderer mais jamais monté — permet aux capacités (feature-info) et plugins de traduire leurs libellés (aria-labels…) ; sortie **byte-identique** au fallback quand aucun dictionnaire ne fournit la clé.

- **Filtre attributaire générique — capacité in-core `GeoLeaf.Filter` + `modules.filter`** _(refonte)_ : le panneau de filtrage devient une **capacité intégrée** générique, **géométrie-agnostique** (point/ligne/polygone) et multi-sources, pilotée par un descripteur déclaratif de champs (`modules.filter.fields[]`, 6 kinds : `taxonomy` / `tag` / `range` / `text` / `boolean` / `proximity`), avec **portée par couche opt-in** (`layers` : absent ⟹ toutes les couches, présent ⟹ uniquement celles-ci). Nouvelle façade lecture **`GeoLeaf.Filter`** (`isEnabled()`, `getConfig()`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("filter")`, active par défaut (**opt-out** via `modules.filter.enabled: false`). Le prédicat est **hybride** : natif MapLibre `setFilter` (GPU, zéro re-tuilage) pour `taxonomy` / `boolean` / `range`, repli JS pour `tag` / `text` / `proximity` (liste, sous-chaîne, distance haversine). `taxonomy` et `tag` partagent un moteur unique (appartenance à un ensemble de valeurs sur un champ).

- **Renderer de toasts — capacité in-core `toast-renderer` + `modules.toast-renderer`** _(reclassification interne, additif)_ : le **rendu DOM des notifications** (« toasts ») devient une **capacité intégrée** (`capabilities/toast-renderer/`), active par défaut (**opt-out** via `modules.toast-renderer.enabled: false`). La **primitive `notify()` reste au noyau** (`GeoLeaf.notify(message, level)` — ancre stable montée au boot, buffer + repli `console.*`) ; la capacité en est le renderer enfichable (via `registerRenderer()`) et re-monte les surfaces riches (`GeoLeaf.UI.Notifications`, `_UINotifications`, export ESM `{ Notifications }`) — **API publique et comportement inchangés** par défaut. Sans la capacité (opt-out désactivé), `GeoLeaf.notify()` **dégrade proprement** en `console.*`. Correctif : le warning « style par défaut introuvable » d'une couche GeoJSON, jusqu'ici muet (lecteur interne `GeoLeaf.Notifications` jamais monté), est désormais émis via la primitive.

### Changed

- **Offline — moteur déplacé in-core (`modules.offline`, `import()` dynamique) ** _(breaking — profils + distribution)_ : le moteur hors-ligne (IndexedDB + cache + download + sync, ~9 000 l.) migre de `@geoleaf-plugins/storage` vers **`@geoleaf/core` (`capabilities/offline/`)**, chargé en **`import()` dynamique** (hors budget boot — `bootGz` inchangé) sur le gate **opt-in `modules.offline.enabled`** (dépend de `modules.pwa.enabled`). La configuration migre de **`modules.storage.*` → `modules.offline.*`** (`{ enabled, cache: { enableProfileCache, enableTileCache } }`). Le plugin résiduel `@geoleaf-plugins/storage` est réduit à l'**UI de sélection offline** (publié sur **npmjs, `access: public`**) ; il pilote le moteur core via le seam `StorageContract` (nouveau **`whenReady(): Promise<void>`** — l'UI diffère ses actions tant que le moteur n'est pas initialisé, et indéfiniment si `modules.offline` est désactivé). La façade publique **`GeoLeaf.Storage` est inchangée** (`init` / `isOffline` / `getStats` / `downloadProfileForOffline` / …). **Migration** : renommer `config/plugins/storage.json` → `offline.json`, `Files.modules.storage` → `Files.modules.offline`, `modules.storage.cache.*` → `modules.offline.cache.*`. Avec `modules.offline.enabled` absent ou `false` → **aucun chunk moteur téléchargé**.

- **Permalink — activation + configuration déplacées de `ui.permalink` vers `modules.permalink`** _(breaking — profils)_ : la synchronisation état ↔ URL (deep-linking) devient une **capacité intégrée** (`permalink`, **opt-out** — active sauf `modules.permalink.enabled: false`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("permalink")`. Le bloc `ui.permalink` (`config/core/ui.json`) migre vers **`modules.permalink`** (`{ enabled, mode }`), sur le modèle `modules.share` / `modules.legend`. Façade `GeoLeaf.Permalink` **inchangée** (complétée de `isEnabled` / `getConfig`). **Changement de comportement** : opt-in → **opt-out** (permalink actif par défaut ; auparavant seul `ui.permalink.enabled: true` l'activait). En interne, la restauration de l'état de filtre passe désormais par le contrat public `GeoLeaf.Filter` (plus de scraping DOM ni d'injection de faux champs cachés). La taxonomie est sérialisée en **un seul paramètre plat `gl_cats`** (le `gl_subs` legacy est retiré — aligné sur le modèle générique du filtre où catégories et sous-catégories forment un seul ensemble de valeurs). **Migration** : remplacer `"ui": { "permalink": { … } }` par `"modules": { "permalink": { … } }` (ou l'omettre — opt-out).
- **`GeoLeaf.Filter` — nouvelle surface de sérialisation** _(non-breaking, additif)_ : la façade expose `getActiveFilter()` (état de filtre actif sérialisable), `applyFilter(state)` (restauration sans DOM), `reset()`, `applyNow()`, `hasActiveFilters()` et `proximity.{setRadius,toggle}` — contrat consommé par la capacité `permalink` et disponible pour le no-code.
- **Bouton de partage — activation via `modules.permalink.share.enabled`** _(breaking — profils)_ : le bouton « Partager la vue » (modal lien + QR code) devient une **sous-fonction de la capacité permalink** (S13 F7 — share n'a de sens qu'avec permalink, qui encode l'URL partagée). Gate **opt-out** `modules.permalink.share.enabled` (actif sauf `false`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("permalink")` (sous-clé `share`). L'ancien drapeau `ui.showShareButton` (`config/core/ui.json`) est retiré. Façade `GeoLeaf.Share` (`openShareDialog` / `closeShareDialog` / `getShareUrl` / `isOpen` / `isEnabled` / `getConfig`), événement `geoleaf:toolbar:action`, QR lazy (`qrcode-generator`) et rendu **inchangés**. **Migration** : remplacer `"ui": { "showShareButton": false }` par `"modules": { "permalink": { "share": { "enabled": false } } }` (l'omettre laisse le bouton actif — opt-out). En interne, le code vit sous `capabilities/permalink/share/`.
- **Taxonomie — unification : lecteurs core (légende, filtre, icônes POI) basculés sur la capacité `GeoLeaf.Taxonomy` ; taxonomie legacy retirée** _(breaking — profils + API interne)_ : la légende, le filtre `taxonomy` et l'injection d'icônes POI lisent désormais leurs catégories via la capacité in-core **`GeoLeaf.Taxonomy`** (bloc `modules.taxonomy`), et non plus l'ancienne taxonomie « plate » du core (`config/core/taxonomy.json` lue via `GeoLeaf.Config.getCategories()`). **Activation par binding** : une couche POI reçoit ses icônes/catégories seulement si elle est déclarée dans `modules.taxonomy.layers` (`{ "<layerId>": { "use": "poi-cat" } }`) ; un filtre de type `taxonomy` doit porter `taxonomyRef` (ex. `"poi-cat"`). **Retiré** (API interne `_`/non contractuelle) : `GeoLeaf.Config.getCategories()` / `getCategory()` / `getSubcategory()` / `loadTaxonomy()`, `GeoLeaf._ConfigTaxonomy`, et les options `ConfigInitOptions.{mappingUrl, mappingHeaders, mappingStrictContentType}`. **Inchangés** : la façade publique `GeoLeaf.Taxonomy`, la résolution de taxonomie des profils modulaires. _(MAJ Lot 2 : `GeoLeaf.Config.getIconsConfig()` et le fichier `config/core/taxonomy.json` sont désormais retirés — voir §Removed « Taxonomy legacy ».)_ **Migration** : peupler `modules.taxonomy.taxonomies` (cf. `config/plugins/taxonomy.json`), binder les couches POI via `modules.taxonomy.layers`, ajouter `taxonomyRef` aux filtres `taxonomy` ; remplacer tout appel `GeoLeaf.Config.getCategories()` par `GeoLeaf.Taxonomy.getCategories("poi-cat")`. Rendu **byte-identique** (le modèle reprend arbre, libellés et icônes de l'ancien). Note : `modules.taxonomy.icons.defaultIcon` n'est PAS appliqué à l'injection d'icônes POI (parité avec l'ancien moteur, qui n'injectait aucune icône par défaut). **Correctif de rendu associé** : les icônes des couches POI chargées via un changement de **thème de données** (sans changement de fond de carte) sont désormais correctement enregistrées dans le moteur de rendu MapLibre au moment de l'ajout de la couche — auparavant le sprite n'était (ré)enregistré qu'au changement de fond de carte, si bien qu'une couche POI apparue via un thème pouvait s'afficher sans ses icônes.
- **Légende — activation + configuration déplacées de `ui.showLegend` + `legendConfig` vers `modules.legend`** _(breaking — profils)_ : la légende cartographique devient une **capacité intégrée** (`legend`), gatée via `CapabilityRegistry` (**opt-out** : active sauf `modules.legend.enabled: false`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("legend")`. Le drapeau `ui.showLegend` et le bloc `legendConfig` (`config/core/ui.json`) migrent vers le bloc dédié **`modules.legend`** (fichier `config/plugins/legend.json` : `{ enabled, title, position, collapsedByDefault }`), sur le modèle `modules.table` / `modules.theme-selector`. **Changement de comportement** : `title` / `position` / `collapsedByDefault`, auparavant **ignorés** (écrasés par des valeurs par défaut internes), sont désormais **effectivement appliqués** au contrôle — un profil portant l'ancien `legendConfig` verra sa légende rendue avec son titre, sa position et son état replié configurés (auparavant figés à « Legend », bas-gauche, dépliée). Nouvel événement DOM **`geoleaf:legend:ready`** (`{ position, layerCount }`) émis une fois au 1er montage du contrôle. Façade `GeoLeaf.Legend` **inchangée**. **Migration** : créer `config/plugins/legend.json` (reprendre les clés `legendConfig` + `enabled: true`), déclarer `"legend": "config/plugins/legend.json"` dans `profile.json` → `Files.modules`, retirer `ui.showLegend` et `legendConfig` de `ui.json`.
- **Sélecteur de thèmes — activation déplacée de `ui.showThemeSelector` vers `modules.theme-selector.enabled`** _(breaking — profils)_ : le drapeau d'affichage de la barre de sélection de thèmes quitte `config/core/ui.json` (`ui.showThemeSelector`) pour le bloc dédié **`modules.theme-selector`** (fichier `config/plugins/theme-selector.json`, `{ "enabled": true }`), sur le même modèle que `modules.table` / `modules.filter`. Le sélecteur devient une **capacité intégrée** déclarée (`theme-selector`), gatée via `CapabilityRegistry` (**opt-out** : actif sauf `modules.theme-selector.enabled: false`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("theme-selector")`. **Migration** : créer `config/plugins/theme-selector.json` avec `{ "enabled": true }`, déclarer `"theme-selector": "config/plugins/theme-selector.json"` dans `profile.json` → `Files.modules`, retirer `ui.showThemeSelector` de `ui.json`. Façade `GeoLeaf.ThemeSelector`, événements, permalink `gl_theme` et rendu **inchangés**. En interne, le **chargement des couches est désormais découplé du système de thème** (via le registry : `GeoJSONModule` charge les données, `ThemeEngineModule` applique le thème par défaut) — les données s'affichent même sans thème déclaré ou avec le sélecteur désactivé ; sortie **byte-identique** lorsque des thèmes existent.
- **Configuration du clustering déplacée de `poiConfig` vers `modules.cluster`** _(breaking — profils)_ : les clés de clustering **global** quittent `poiConfig` pour le bloc dédié **`modules.cluster`** (fichier `config/plugins/cluster.json`) — `poiConfig.clustering` → `modules.cluster.clustering`, `poiConfig.clusterStrategy` → `…clusterStrategy`, `poiConfig.clusterRadius` → `…clusterRadius`, `poiConfig.disableClusteringAtZoom` → `…disableClusteringAtZoom`, `poiConfig.clusterStrategies` → `…clusterStrategies`. Les **overrides par-couche** (`layers[].clustering.{enabled,maxClusterRadius,disableClusteringAtZoom}`) sont **inchangés**. La clé de features **`clusteringConfig` (jamais lue au runtime) est supprimée** (schéma + profils). **Migration** : déplacer tout bloc `poiConfig.cluster*` vers `config/plugins/cluster.json`, déclarer `"cluster": "config/plugins/cluster.json"` dans `profile.json` → `Files.modules`, retirer `clusteringConfig`. Valeurs reprises à l'identique (rendu inchangé) ; clustering actif par défaut sans configuration. **Retiré au passage** (internes `_`-préfixés, non contractuels) : `GeoLeaf._GeoJSONClustering`, `GeoLeaf.GeoJSON._getClusteringStrategy`, `GeoLeaf.GeoJSON._getPoiConfig`.
- **`@geoleaf-plugins/feature-info` — API publique `GeoLeaf.FeatureInfo` complétée à 5 méthodes** _(breaking, plugin uniquement — `@geoleaf/core` non affecté)_ : `openSidePanel(detail, layout?)` et `getConfig(layerId)` ajoutées (`isEnabled`/`close`/`openPopup` déjà présentes). `close()` ferme désormais la popup **et** le side-panel. `openPopup(detail)` exige désormais `detail.geometry` (auparavant forcé à `null` en interne) — un appelant scripté doit fournir ce champ (`null` accepté). Le side-panel est réécrit en DOM standalone (append `document.body`), sans dépendance à `GeoLeaf.POI`. Les boutons d'action (`type: "action"`) dispatchent `geoleaf:popup:action` (événement déjà documenté) avec des `properties` limitées aux champs configurés pour la surface — jamais l'ensemble brut des propriétés de la feature.
- **`GeoLeaf.FeatureInfo.openPopup` accepte désormais un second paramètre `layout?: SidePanelLayout`** _(non-breaking — ajout d'un paramètre optionnel)_, mirroring `openSidePanel`. Permet à un appelant sans configuration `layers.<id>.capabilities.feature-info` (ex. injection POI) de fournir un layout explicite plutôt que de tomber sur l'auto-résolution générique (toutes propriétés en texte brut).
- **POI — popup et side-panel délégués entièrement à `@geoleaf-plugins/feature-info`** _(breaking)_ : le rendu attributaire des POI (popup au clic sur un marqueur, panneau latéral « Voir plus ») **exige désormais que le plugin `@geoleaf-plugins/feature-info` soit chargé et activé** (`modules.feature-info.enabled: true`). Il n'existe plus de rendu de secours interne au core — sans le plugin, le clic sur un marqueur POI ne produit plus de popup ni de panneau (même convention que tout plugin optionnel absent, ex. `addpoi`/`storage`). **Migration** : s'assurer que `@geoleaf-plugins/feature-info` est chargé (déjà requis pour le rendu attributaire GeoJSON/VT depuis S2) et que `modules.feature-info.enabled` est `true` dans le profil actif.
- **Itinéraires — refonte en capacité in-core `modules.route` (décorateur d'endpoints) ; façade `GeoLeaf.Route` + modèle `routes[]` retirés** _(breaking — profils + API)_ : le module Route legacy (façade impérative `GeoLeaf.Route`, tableau `routes[]` de premier niveau) est **dissous** en une **capacité in-core** (`route`, gate `modules.route`, **opt-in**), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("route")`. Nouveau modèle : la capacité **décore** une couche de polylignes existante avec des **marqueurs de départ / arrivée** dérivés automatiquement de la géométrie de chaque feature — le **tracé reste une couche GeoJSON `line` générique** (rendue par le moteur). **Binding par couche** `modules.route.layers.<id>.{start,end,showStart,showEnd}` (modèle `modules.taxonomy.layers`). Event-driven (`geoleaf:layer:added` / `geoleaf:map:ready`). **Retiré** : la façade `GeoLeaf.Route` (`init` / `loadFromConfig` / `loadGPX` / `loadGeoJSON` / `show` / `hide` / `filterVisibility`), le tableau `routes[]`, les globals `_RouteLayerManager` / `_RouteLoaders` / `_RouteStyleResolver`, le contrat `RouteContract`, l'événement `geoleaf:route:loaded`, le chunk lazy `route`. **Lecture GPX / KML / KMZ** : hors périmètre — utiliser `@geoleaf-plugins/file-import`. **Migration** : (1) déclarer `"route": "config/plugins/route.json"` dans `profile.json` → `Files.modules` + `{ "enabled": true, "layers": { "<layerId>": { … } } }` ; (2) un itinéraire dynamique passe par `GeoLeaf.Layers.setData(layerId, featureCollection)` (la capacité re-dérive les marqueurs) au lieu de `GeoLeaf.Route.loadFromConfig`. L'interactivité des tracés (clic / survol) reste assurée par le seam générique `geoleaf:feature:click` / `hover` des couches GeoJSON (inchangé).
- **Filtrage GeoJSON appliqué sur le GPU** _(non-breaking, amélioration de performance)_ : `GeoLeaf.GeoJSON.filterFeatures(predicate)` conserve sa signature (le prédicat reste une fonction JS — recherche par sous-chaîne, distance, champs imbriqués restent supportés), mais applique désormais l'ensemble visible via `map.setFilter` sur l'`id` des features (expression `match`, **sans re-tuilage** de la source) pour les couches **non clusterisées** dont toutes les features portent un `properties.id` **unique**. Les couches clusterisées ou dont les features n'ont pas d'id retombent sur le ré-envoi des données (comportement d'origine, compteurs de cluster préservés). Le filtrage par catégorie / recherche du panneau est plus fluide sur les gros jeux de données ; **aucun changement d'API ni de résultat de filtrage**.
- **Changement de fond de carte : préservation native des couches (`transformStyle`)** _(non-breaking côté comportement observable)_ : le switch d'un fond vectoriel utilise désormais `map.setStyle(next, { diff: true, transformStyle })` (MapLibre v5) pour **préserver nativement** les sources et couches GeoLeaf (GeoJSON, clusters POI, sentinelle) au lieu de tout détruire puis ré-injecter en JS. Fin de la « danse » reset + reconstruction totale : gain de **correction / anti-fuite** (moins de churn, plus de perte transitoire de couches) au switch. Les icônes de sprite POI (effacées par `setStyle`) sont ré-enregistrées après le swap. Rendu et comportement de basculement **inchangés**.
- **POI — halo de survol / sélection** _(nouvelle UX, non-breaking)_ : survoler un marqueur POI (non clusterisé) trace une **bordure de mise en évidence** ; cliquer sur un marqueur le **sélectionne** (halo persistant jusqu'au clic sur un autre marqueur). Piloté par `setFeatureState` (paint réactif GPU), sans donnée supplémentaire ni configuration. Le rendu au repos (couleurs, badge de statut) est **inchangé**.
- **POI — badge de synchronisation sans reconstruction de source** _(non-breaking, amélioration de performance)_ : le badge « en attente » (`GeoLeaf.POI.updatePoiSyncStatus`, utilisé par `@geoleaf-plugins/addpoi` et `@geoleaf-plugins/storage`) est désormais appliqué via `setFeatureState` (mutation O(1)) au lieu de reconstruire toute la `FeatureCollection` des POI à chaque changement de statut. La source POI déclare `promoteId: "id"` (id de feature stable). Aucun changement d'API ni de rendu visible. La résolution de style par POI ne force plus de recalcul de style (`getComputedStyle`) par marqueur à l'affichage de masse.

- **Légende — mapping « attribut → catégorie » piloté par configuration** _(non-breaking pour le core ; potentiellement breaking pour un profil s'appuyant sur l'ancien mapping tourisme intégré)_ : la résolution d'icône de légende pour une règle `when.field` sur un attribut brut (ex. OpenStreetMap `fclass`) lit désormais un mapping déclaratif **`taxonomy.fieldMappings`** (`{ <field>: { <value>: { categoryId, subCategoryId } } }`) au lieu d'une table tourisme codée en dur dans le core. Le core MIT ne porte plus aucune donnée métier. **Migration** : un profil dont la légende dépendait du mapping `fclass` intégré (archaeological / museum / camp_site / hotel) doit désormais le déclarer sous `taxonomy.fieldMappings` (le profil de démonstration `tourism` l'inclut).
- **Étiquettes (`GeoLeaf.Labels`) — capacité in-core + gate `modules.labels`** _(breaking — config)_ : les étiquettes de couche (texte, rendues en **couche `symbol` MapLibre native**) sont désormais une **capacité intégrée** déclarée (`labels`), introspectable via `GeoLeaf.Introspection.getCapabilitySchema("labels")`, active par défaut (**opt-out** via `modules.labels.enabled: false`). Le gate global quitte la clé racine **`labels.enabled`** pour **`modules.labels.enabled`** (la clé racine `labels` est désormais réservée au dictionnaire i18n d'overrides). Le stylage par-couche des étiquettes (police, couleur, halo, échelle) reste **inchangé** dans les fichiers de style (clé `label.*`). **Migration** : un profil posant `labels.enabled: false` à la racine doit le déplacer vers `modules.labels.enabled: false`. API `GeoLeaf.Labels`, rendu et bouton d'affichage **inchangés**.
- **Configuration du filtre migrée de `searchConfig` / `ui.showFilterPanel` vers `modules.filter`** _(breaking — profils)_ : le panneau de filtre/recherche quitte `ui.json > searchConfig` (+ le flag `ui.showFilterPanel`) pour le bloc dédié **`modules.filter`** (fichier `config/plugins/filter.json`, déclaré dans `profile.json` → `Files.modules.filter`). Correspondances : `ui.showFilterPanel` → `modules.filter.enabled` (opt-out) ; `searchConfig.title` / `searchPlaceholder` / `actions` → `modules.filter.*` ; `searchConfig.radius{Min,Max,Step,Default}` → un champ `kind:"proximity"` ; `filters[] type:"search"|"proximity"|"tree"|"multiselect-tags"` → `fields[] kind:"text"|"proximity"|"taxonomy"|"tag"`. Le filtre « catégories » devient **explicite** (`field` / `taxonomyRef` / `layers`) et n'est migré que si les features portent les identifiants de catégorie. La façade interne **`GeoLeaf.FilterPanel` est supprimée** (remplacée par `GeoLeaf.Filter`) ; les globals internes `_UIFilterPanel*` passent d'un montage **eager** à des **shims lazy** montés sur `geoleaf:app:ready` (consommateurs permalink / mobile / ui-api inchangés). **Migration** : déplacer le bloc `searchConfig` vers `config/plugins/filter.json` au modèle `fields[]`, déclarer `"filter": "config/plugins/filter.json"` dans `Files.modules`, retirer `searchConfig` + `ui.showFilterPanel`.
- **Filtre — recherche textuelle insensible aux accents et à l'ordre des mots** _(non-breaking, amélioration)_ : le champ texte du panneau Filtrer (capacité in-core `filter`, `kind:"text"`) normalise désormais les accents et la casse (NFD + retrait des diacritiques) et découpe la requête en mots — un champ correspond si **tous** les termes y figurent, dans n'importe quel ordre. `recif` trouve « Récif », `gilles récif` trouve « Le Récif — Saint-Gilles ». **Sur-ensemble strict** du comportement antérieur (toute correspondance existante reste valide), sans dépendance ni nouveau paramètre. Couvre les besoins de recherche courants sans moteur full-text externe (voir §Removed — `GeoLeaf.Search`).

### Fixed

- **Rafraîchissement OGC API Features (`autoRefresh`)** : une couche OGC configurée en `autoRefresh` se met désormais à jour au déplacement de la carte (`moveend`). L'appel de mise à jour de source visait une méthode d'adaptateur inexistante (no-op silencieux) et le résultat du fetch était jeté ; les nouvelles features sont désormais appliquées.
- **POI cliquable après attribution d'un id serveur** : après `GeoLeaf.POI.updatePoiId(oldId, newId)` (flux `@geoleaf-plugins/addpoi` — id temporaire → id permanent), le clic sur le marqueur retrouve désormais le POI. L'index de résolution au clic (invalidé sur la seule longueur de la liste) est désormais invalidé au renommage.
- **Légende — couleur de repli alignée sur la carte** : une règle de style sans couleur explicite affiche désormais le même gris (`#cccccc`) en légende **et** sur la carte (auparavant bleu Leaflet `#3388ff` en légende, gris sur la carte).
- **Légende (LayerManager) — enregistrement de couche robuste** : l'enregistrement d'une couche dans le LayerManager ne dépend plus d'une détection de type géométrique héritée de Leaflet (source d'un plantage latent) ; le type est dérivé du `geometryType` mis en cache.
- **Fuites de minuteurs** : le sondage périodique de la barre d'outils mobile (`setInterval` 2 s) est désormais nettoyé au cycle de vie (plus de fuite au recréer) ; le détecteur hors-ligne ne démarre plus de minuteur de sondage quand aucune `pingUrl` n'est configurée (les événements `online`/`offline` du navigateur suffisent).
- **Changement de fond de carte : plus de double-déclenchement des événements d'interaction** : après un changement de basemap (`map.setStyle`), les couches ré-injectées ne dupliquent plus leurs écouteurs délégués. Un clic ou un survol sur une feature (POI, GeoJSON, cluster, tracé) n'émet plus `geoleaf:feature:click` / `geoleaf:feature:hover` / `geoleaf:poi:click` **en double** — les écouteurs délégués sont désormais détachés avant la reconstruction du style (et à la destruction de la carte). Aucun impact d'API.
- **`GeoLeaf.Notifications.*` désormais monté sur le global** : le namespace complet de notifications (`GeoLeaf.Notifications.{notify,success,error,warning,info,dismiss,clearAll,getStatus}`) — **documenté** (`NOTIFICATIONS_API.md`) et **typé** (`index.d.ts` → `GeoLeafAPIRoot.Notifications: NotificationsAPI`, non-optionnel) — n'était en réalité **jamais assigné** sur `globalThis.GeoLeaf` (seul `GeoLeaf.UI.Notifications` l'était). Un `GeoLeaf.Notifications.success(...)` en CDN, tel que documenté, plantait (`Cannot read properties of undefined`). La façade est désormais montée au boot, alignant runtime / doc / types. `GeoLeaf.notify()` (raccourci) et l'export ESM `import { Notifications }` sont inchangés. Corrige au passage un exemple `show({message,type})` (signature erronée) dans le README `@geoleaf-plugins/websocket` → `show(message, type)`.

### Removed

- **`GeoLeaf._UIDomUtils.attachAccordionBehavior()` et `GeoLeaf.UI._attachAccordionBehavior()` retirées** _(breaking, API interne `_`sans consommateur)_ : ces deux méthodes attachaient un comportement d'accordéon (bascule`gl-is-open`au clic sur un`.gl-accordion**header`) à un conteneur. Elles n'avaient **aucun appelant** dans le produit depuis le retrait du constructeur de panneau de filtre `ui/filter-panel/**`(S13), leur unique client. Seule la première était documentée, avec un exemple, dans`GeoLeaf_UI_Components_README.md` — retiré. ⚠️ Malgré son nom, **`GeoLeaf.UI.\_attachAccordionBehavior()`n'était pas un alias de la première** : elle déléguait à`\_UIEventDelegation.attachAccordionEvents()`, qui **reste en place**. **Migration\*\* : aucune pour les accordéons du produit — la légende construit le sien (`GeoLeaf.Legend`) et le panneau latéral utilise un `<details>`natif, sans JavaScript. Un intégrateur qui appelait`GeoLeaf.\_UIDomUtils.attachAccordionBehavior(container)`sur son propre balisage pose désormais son écouteur lui-même :`container.addEventListener("click", (e) => e.target.closest(".gl-accordion\*\*header")?.closest(".gl-accordion")?.classList.toggle("gl-is-open"))`.
- **Globals `_UIFilterPanel*` retirés (`_UIFilterPanelApplier` / `_UIFilterPanelStateReader` / `_UIFilterPanelAccordion` / `_UIFilterPanelProximity`)** _(breaking, API interne `_`transitoire)_ : ces shims runtime (installés par`capabilities/filter/compat.ts`, transitoires depuis S5) exposaient le panneau de filtre à permalink / la toolbar mobile / le control-builder desktop. Tous leurs consommateurs sont désormais branchés sur le contrat public **`GeoLeaf.Filter`** ; `compat.ts`et le quatuor`_UIFilterPanel*`sont **supprimés**. **Migration** :`GeoLeaf.\_UIFilterPanelProximity.*`→`GeoLeaf.Filter.proximity.\*`;`\_UIFilterPanelApplier.applyFiltersNow(...)`→`GeoLeaf.Filter.applyNow()`/`.reset()`. _(Le global legacy singulier `_UIFilterPanel` — panneau pré-S5 — n'est pas concerné.)\_
- **`GeoLeaf.Taxonomy.resolveLabel()` / `resolveLayerLabel()` retirées** _(breaking, API interne sans consommateur)_ : ces deux méthodes de la façade taxonomy (label lisible d'une valeur de catégorie / d'un champ de badge de couche) n'avaient **aucun consommateur** — prévues pour un rendu de badge `feature-info` jamais câblé. Retirées de `GeoLeaf.Taxonomy` (elles embarquaient inutilement dans le bundle). **Migration** : lire la catégorie directement via `GeoLeaf.Taxonomy.getCategories(ref)[value]?.label`.
- **`GeoLeaf.Helpers.resolvePoiColors()` — champ `colorRoute` retiré du retour `PoiColors`** _(breaking mineur, champ mort)_ : la fonction retournait `{ colorFill, colorStroke, colorRoute }` où `colorRoute` était calculé **à l'identique de `colorStroke`** et **jamais lu** (résidu du module `route` dissous en S11). Le retour est désormais `{ colorFill, colorStroke }`. **Migration** : utiliser `colorStroke` (valeur strictement identique).
- **Taxonomy legacy retirée — `GeoLeaf.Config.getIconsConfig()` + le fichier `config/core/taxonomy.json`** _(breaking — profils + API interne ; Lot 2, achève S10 F5)_ : l'ancienne taxonomie « plate » du core est **entièrement supprimée** ; la capacité **`modules.taxonomy`** (fichier `config/plugins/taxonomy.json`) est désormais la **source unique** des icônes/catégories. Sont retirés : **`GeoLeaf.Config.getIconsConfig()`** (+ `ProfileManager.getIconsConfig`), le fichier **`config/core/taxonomy.json`** et son manifeste **`Files.taxonomyFile`** (chargés au boot via `profile-loader`), le champ interne **`GeoLeafConfig.categories`** (+ sa validation `_validateCategoriesSection` + l'interface `CategoryItem`), et l'API interne morte **`GeoLeaf.UI._populateSelectOptionsFromTaxonomy`** (0 appelant). Le sprite d'icônes POI et la porte `showOnMap` de la légende lisent désormais **`modules.taxonomy.icons`** via `GeoLeaf.Taxonomy.getIcons()`. **Migration** : supprimer le fichier `config/core/taxonomy.json` et la clé `Files.taxonomyFile` du `profile.json` — les icônes/catégories vivent déjà dans `config/plugins/taxonomy.json` (`modules.taxonomy.icons` + `modules.taxonomy.taxonomies`) ; remplacer tout appel `GeoLeaf.Config.getIconsConfig()` par `GeoLeaf.Taxonomy.getIcons()`. Rendu **byte-identique** (mêmes données, même URL de sprite).
- **Événement DOM `geoleaf:style:rebuild` retiré** _(breaking)_ : cet événement, émis après un `map.setStyle()` pour que les modules ré-injectent leurs couches, n'a plus lieu d'être — le switch de fond préserve désormais les couches GeoLeaf nativement via `transformStyle` (voir §Changed). L'événement est retiré du contrat (`GeoLeafEventMap`) et ses 3 écouteurs internes (GeoJSON, POI, taxonomy) supprimés, avec les fonctions de reconstruction associées (`_rebuildGeoJSONLayers`, `_rebuildPoiClusterSource`, sweep taxonomy sur rebuild). Aucun plugin distribué ne l'écoutait. **Migration** : un intégrateur qui écoutait `geoleaf:style:rebuild` pour re-styler après un changement de fond n'en a plus besoin (les couches et leur paint survivent) ; pour réagir à l'ajout d'une couche, utiliser `geoleaf:layer:added`. La méthode adaptateur optionnelle `resetForStyleChange()` est remplacée par `buildStyleChangeTransform()` + `reregisterStyleImages()`.
- **`GeoLeaf._loadModule("poiRenderers")` / `"poiRenderers"` retiré de `LazyModuleName`** _(breaking, API interne peu documentée)_ : le chunk lazy `poi-renderers` (rendu attributaire POI legacy — field/media/component renderers, section orchestrator, lightbox, UI behaviors) est supprimé, pas déplacé — cette capacité est désormais entièrement fournie par `@geoleaf-plugins/feature-info`. `GeoLeaf._loadModule("poi")` continue de fonctionner (charge `poiCore` + `poiExtras`, sans `poiRenderers`). Un appel direct à `GeoLeaf._loadModule("poiRenderers")` échoue désormais silencieusement (branche `default` du switch, `console.warn`).
- **Binders popup-tooltip GeoJSON retirés du core** _(breaking)_ : `bindMapLibrePopup`, `bindMapLibreTooltip`, `_GeoJSONPopupTooltip`, `setupPopupTooltipDeps` et les 4 fichiers source (`popup-tooltip.ts`, `popup-tooltip-core.ts`, `popup-tooltip-layer.ts`, `popup-tooltip-maplibre.ts`) ne font plus partie de `@geoleaf/core`. Le rendu tooltip/popup/side-panel sur couches GeoJSON et vector-tiles est désormais assuré par le plugin MIT **`@geoleaf-plugins/feature-info`**. **Migration** : installer `@geoleaf-plugins/feature-info` et charger son script après `geoleaf.esm.js`. Les couches GeoJSON émettent désormais `geoleaf:feature:click` / `geoleaf:feature:hover` à la place. **Impact POI** : le comportement des popups POI est **inchangé** (voie `geoleaf:poi:click` séparée, dissolution POI planifiée S9).

- **`GeoLeaf.Geocoding` retiré du core** _(breaking)_ : la recherche d'adresse (géocodage — fournisseurs Addok/BAN, Nominatim, Photon, endpoint HTTPS personnalisé) n'est plus intégrée à `@geoleaf/core`. Elle est désormais fournie par le plugin **MIT `@geoleaf-plugins/geocoding`** (npmjs.org public). Sont retirés du bundle core : l'export ESM nommé `Geocoding`, la façade `GeoLeaf.Geocoding` (`isEnabled` / `search` / `selectResult` / `open` / `destroy`), l'événement `geoleaf:geocoding:result` et le contrôle de recherche `.gl-geocoding-ctrl`. **Migration** : `npm install @geoleaf-plugins/geocoding`, puis charger son script **après** `geoleaf.esm.js` (et avant `GeoLeaf.boot()`).
- **`GeoLeaf.Table` retiré du core** _(breaking)_ : le tableau de données (panneau tabulaire — sélecteur de couche, tri, sélection ↔ surbrillance carte, zoom, export GeoJSON/CSV/KML/GPX/Excel) n'est plus intégré à `@geoleaf/core`. Il est désormais fourni par le plugin **MIT `@geoleaf-plugins/table`** (npmjs.org public). Sont retirés du bundle core : l'export ESM nommé `Table`, la façade `GeoLeaf.Table` (`show`/`hide`/`toggle`/`setLayer`/`sortByField`/`setSelection`/`zoomToSelection`/`exportSelection`/`exportLayer`…), les événements `geoleaf:table:*`, l'onglet « Tableau » du panneau desktop et le writer OOXML d'export Excel. **Migration** : `npm install @geoleaf-plugins/table`, puis charger son script **après** `geoleaf.esm.js` (et avant `GeoLeaf.boot()`).
- **`GeoLeaf.Popup` retiré du core** _(breaking)_ : la façade `GeoLeaf.Popup.registerActionHandler()` / `unregisterActionHandler()` (registre de handlers à contexte riche pour les boutons d'action de popup) est supprimée, ainsi que le module `modules/built-in/popup/action-registry.ts` et son listener `modules/built-in/popup/popup-actions.ts`. Ce registre n'était plus invoqué depuis que le rendu popup est passé à `@geoleaf-plugins/feature-info` (S2b), qui ne dispatche que l'événement `geoleaf:popup:action` — c'était devenu un no-op silencieux. **Migration** : remplacer tout appel à `GeoLeaf.Popup.registerActionHandler(actionId, handler)` par `GeoLeaf.events.on("geoleaf:popup:action", (e) => { if (e.detail.actionId === actionId) handler(e.detail); })`. Le contexte riche (référence DOM du bouton, `setBusy()`, `close()`) n'est plus disponible — seul le payload JSON (`actionId`, `layerId`, `featureId`, `properties`, `lngLat?`) l'est.
- **`GeoLeaf.GeoJSON.updateLayerZIndex()` retiré** _(breaking, API interne peu documentée)_ : cette méthode n'avait aucun appelant dans le produit et échouait systématiquement sur MapLibre (implémentation historique Leaflet — `state.map.getPane()` n'existe pas sur l'adapter MapLibre). L'ordre d'affichage des couches est géré nativement par l'adapter registry.
- **Rendu POI routé via le seam générique + `GeoLeaf.POI.openSidePanelWithLayout()` retiré** _(breaking)_ : le clic sur un marqueur POI émet désormais **`geoleaf:feature:click`** (le même seam que les couches GeoJSON/VT) au lieu d'un chemin de rendu POI-spécifique ; `@geoleaf-plugins/feature-info` auto-résout le layout depuis `layers.<id>.capabilities.feature-info`. Le pont de traduction interne (`poi/feature-info-bridge.ts`) et le délégué popup POI (`poi/popup.ts`) sont supprimés. L'API `GeoLeaf.POI.openSidePanelWithLayout(poi, customLayout)` et le paramètre `customLayout` de `GeoLeaf.POI.showPoiDetails()` sont retirés (aucun appelant — le layout provient désormais de la config `capabilities.feature-info`). **Migration** : configurer le rendu POI sous `layers.<id>.capabilities.feature-info`, comme les couches GeoJSON.
- **`GeoLeaf.POI` retiré du core — dissolution du sous-système POI (S9)** _(breaking)_ : le namespace public **`GeoLeaf.POI`** et l'export ESM nommé **`POI`** sont **supprimés**. Une POI est désormais une **couche point GeoJSON générique** (`GeoLeaf.Layers`), stylée par `taxonomy`, clusterisée par `cluster`, rendue au clic par `feature-info` — toutes capacités in-core. Sont retirés du bundle : le pipeline de rendu POI monolithique (`built-in/poi/**`, agrégat `poi-source`), la résolution d'icône `resolveCategoryDisplay` (remplacée par `GeoLeaf.Taxonomy.resolvePoiIcon` câblé sur le résolveur d'icône point générique), et toutes les méthodes de données (`getAllPois` / `getPoiById` / `getDisplayedPoisCount` / `displayPois` / `reload` / `addPoi` / `add` / `setFilteredDisplay` / `updatePoiSyncStatus` / `updatePoiId` / `getLayer` / `loadAndMergeStoredPois`…). Le **filtre** et la **recherche** lisent désormais la source unique `GeoLeaf.Layers` (le search reconstruit son index à la demande depuis les couches — les POI créés au runtime redeviennent cherchables). **Migration** : lire/muter les données de point via `GeoLeaf.Layers.getFeatures(layerId)` / `addFeature` / `mergeFeatures` / `setData` ; le stylage et le rendu au clic se configurent par couche (`layers.<id>.capabilities.{taxonomy,cluster,feature-info}`). Pour la **création interactive** de POI (plugin addpoi), voir la migration `GeoLeaf.POI.*` → `GeoLeaf.AddPOI.*` ci-dessous.

- **`GeoLeaf.Themes` retiré du core (façade de thème par-couche morte)** _(breaking)_ : la façade `GeoLeaf.Themes` (`applyTheme` / `loadTheme` / `toggleTheme` / `getAvailableThemes` / `initializeLayerTheme` / `getCurrentTheme` / `clearRememberedThemes` / `invalidateCache` / `init`) et l'export ESM nommé `Themes` sont supprimés. Vestige de l'ère Leaflet : un système de « thème par couche » chargé depuis `data/profiles/<layer>/themes/index.json` qui ne produisait **aucun effet sur la carte MapLibre** (le manager mémorisait l'id de thème dans une `Map` interne, sans appel à l'adapter ni au style). **Aucun remplacement** — le vrai moteur de thème (composition/application, événement `geoleaf:theme:applied`) reste **interne et inchangé** (`ThemeApplierCore`), piloté par la configuration de profil et le sélecteur de thème UI (`GeoLeaf.UI`, clair/sombre). **Migration** : retirer tout appel à `GeoLeaf.Themes.*` — le thème visuel se pilote par la configuration de profil + le sélecteur UI.
- **`GeoLeaf.Search` retiré du core — moteur de recherche full-text (`flexsearch`) purgé** _(breaking, moteur dormant)_ : la façade `GeoLeaf.Search` (`isReady` / `query` / `build` / `getEngine` / `clear`), l'export ESM nommé `Search`, le `SearchRegistry` (moteur d'index `flexsearch`) et le chunk lazy `search` sont **supprimés**, ainsi que la **dépendance npm `flexsearch`** (retirée de `@geoleaf/core`). Ce moteur était **dormant** : aucun code du core ni aucun profil ne l'activait (`profile.search.engine === "flexsearch"` jamais posé, `loadModule("search")` jamais appelé, l'index ne se construisait pas). La recherche textuelle réelle de l'interface (champ « Rechercher un POI… » du panneau Filtrer) est assurée par la **capacité in-core `filter`** (recherche par sous-chaîne), **inchangée** et désormais **insensible aux accents et à l'ordre des mots** (voir §Changed). Config retirée au passage : le bloc de couche `search` (`{ enabled, indexingFields }`), le flag `ui.showSearch`, la clé racine `searchConfig.engine`. Le retrait sort `flexsearch` de la **clôture eager** du boot (l'export nommé l'y ancrait, contrairement à la croyance « lazy ») : **boot −8 KB gz**. **Migration** : aucune action pour l'UI (le filtre couvre la recherche) ; un intégrateur appelant `GeoLeaf.Search.query()` par script doit implémenter sa propre recherche (ou indexer côté serveur) — le core n'expose plus de moteur full-text.
- **`GeoLeaf.GeoJSON.addData` / `.loadUrl` / `.clear` / `.getLayer` retirées** _(breaking, méthodes mortes)_ : ces 4 méthodes héritées de Leaflet étaient **inertes en mode MapLibre** — l'état `geoJsonLayer` / `layerGroup` qu'elles manipulaient n'est jamais assigné (toujours `null`) : `addData` loggait une erreur puis ne dessinait rien, `loadUrl` faisait un `fetch` réseau puis **jetait le résultat**, `clear` / `getLayer` étaient des no-op. Le module GeoJSON reste **entièrement fonctionnel** : chargement par profil (`GeoLeaf.GeoJSON.loadFromActiveProfile()` + configuration `layers`), mise à jour temps réel par `updateLayerData(layerId, data)`, lecture par `getLayerById` / `getLayerData` / `getLayerConfig` / `getAllLayers`, filtrage par `filterFeatures` / `clearFeatureFilter`. **Migration** : remplacer `addData` / `loadUrl` ad hoc par la configuration de couche du profil ou `updateLayerData()` ; `getLayer()` → `getLayerById(id)`.
- **`GeoLeaf.Route.loadGPX` / `.loadGeoJSON` retirées** _(breaking, méthodes mortes)_ : ces deux méthodes de chargement d'itinéraire ad hoc étaient **cassées en mode MapLibre** — elles empruntaient un chemin interne (`_applyRoute` → `RouteLayerManager.applyRoute({ layerGroup })`) dont le `layerGroup` n'est jamais assigné ; `loadGPX` faisait un `fetch` + parsing `DOMParser` puis ne dessinait **rien**. Le chargement d'itinéraires reste assuré par le chemin de configuration vivant `GeoLeaf.Route.loadFromConfig(routes)` (via `adapter.addGeoJSONLayer`), **distinct** de ces méthodes. **Migration** : déclarer les itinéraires dans la configuration du profil (chargés par `loadFromConfig`) plutôt que d'appeler `loadGPX` / `loadGeoJSON`.
- **`GeoLeaf.Utils` — quartet mort retiré (`AnimationHelper`, `EventHelpers`, `FileValidator`, `LazyLoader`) + raccourcis top-level** _(breaking, surface publique sans lecteur)_ : `GeoLeaf.Utils.AnimationHelper` / `.EventHelpers` / `.FileValidator` / `.LazyLoader`, le top-level `GeoLeaf.FileValidator`, et les raccourcis `GeoLeaf.animate` / `.fadeIn` / `.fadeOut` / `.loadModule` / `.enableLazyImages` / `.dispatchEvent` / `.dispatchMapEvent` sont supprimés (0 lecteur hors tests). ⚠️ **À ne pas confondre** : le chargeur de modules secondaires **`GeoLeaf._loadModule(name)`** (avec underscore) est **inchangé et vivant**. Le reste de `GeoLeaf.Utils` (`FetchHelper`, `MapHelpers`, `DOMSecurity`, `PerformanceProfiler`, `TimerManager`, `debounce`, `throttle`, `getDistance`, `ObjectUtils`, `ScaleUtils`, …) est **inchangé**. La validation de fichiers côté client reste disponible dans les plugins qui l'utilisent (`@geoleaf-plugins/addpoi`, `@geoleaf/field-renderer` embarquent leur propre validateur). **Migration** : remplacer `GeoLeaf.animate` / `fadeIn` / `fadeOut` par des transitions CSS ; `GeoLeaf.dispatchEvent` par `GeoLeaf.events` ou `document.dispatchEvent` ; pas de remplacement core pour `GeoLeaf.Utils.FileValidator`.
- **`GeoLeaf.Filters.filterPoiList` et les 6 fonctions statistiques retirées (`getUniqueCategories`, `getUniqueSubCategories`, `getUniqueTags`, `countByCategory`, `countBySubCategory`, `getRatingStats`)** _(breaking, roadmap nettoyage Sprint 3)_ : 0 consommateur interne. `GeoLeaf.Filters.filterRouteList` est **inchangé**. **Migration** : pour le filtrage POI, utiliser la capacité **`GeoLeaf.Filter`** (singulier) — `getActiveFilter()` / `applyFilter(state)` / `hasActiveFilters()` — qui pilote le panneau de filtre in-core actif.
- **`GeoLeaf.Config.getActiveProfilePoi()` retirée** _(breaking, méthode morte)_ : renvoyait toujours `[]` (POI dissous du profil depuis S9). `ProfileManager._activeProfileData.{poi,routes}` retirés en interne (le type `ProfileDataPayload` qui type encore `profiles[]` est conservé).
- **Paramètre `poi` du permalink retiré (`gl_poi` en mode verbose)** _(breaking mineur)_ : ce champ faisait un aller-retour URL→état→URL sans jamais influencer le comportement de l'application (vestige de l'ère POI, dissoute). Les autres champs (`lat`/`lng`/`zoom`/`layers`/`filter`/`categories`/`tags`/`rating`/`theme`) sont inchangés.

### ⚠️ Breaking Changes (seuils d'échelle des couches : `zoomConfig` → `scaleConfig`)

- **Bloc `zoomConfig` de `layers/{couche}/styles/{style}.json` retiré, remplacé par `scaleConfig`** : `zoomConfig.minZoom`/`maxZoom` deviennent **`scaleConfig.minScale`/`maxScale`**. **Ce n'est pas qu'un renommage : c'est la correction d'un piège.** L'ancien nom annonçait des niveaux de zoom MapLibre (0-24) alors que le moteur a toujours lu des **dénominateurs d'échelle** (le `X` de `1:X`) — écrire `minZoom: 6` masquait donc la couche à tous les zooms, en silence. Le nouveau nom dit l'unité qui a toujours été celle du moteur.
    - **Aucun shim** : le bloc `zoomConfig` est **rejeté à la validation** (schéma `additionalProperties: false` + validateur runtime), avec un message qui nomme le remplaçant. Un profil non migré échoue bruyamment au lieu de perdre silencieusement sa contrainte. L'alias `minZoom`/`maxZoom` **à l'intérieur** de `scaleConfig` est rejeté lui aussi — c'est cet alias qui laissait passer un niveau de zoom.
    - **Nouveau garde-fou** : toute borne dans `(0 ; 24]` est refusée — un tel dénominateur est inatteignable à n'importe quel zoom, donc toujours un niveau de zoom saisi par erreur. `0` et `null` restent valides (« contrainte désactivée »).
    - **Migration** — vos valeurs étaient déjà des dénominateurs (cas normal) : renommer les clés, valeurs inchangées. `{ "zoomConfig": { "minZoom": 500000, "maxZoom": 10000 } }` → `{ "scaleConfig": { "minScale": 500000, "maxScale": 10000 } }`.
    - **Migration** — vos valeurs étaient des niveaux de zoom (vos couches étaient donc invisibles) : convertir avec `1:X = 591 658 734 × cos(latitude) / 2^zoom`, à la latitude de votre zone. Ex. à ~4°N : zoom 6 → `9222148`, zoom 18 → `2252`. Repères : zoom 5 ≈ 1:18 444 296 · zoom 10 ≈ 1:576 384 · zoom 13 ≈ 1:72 048 · zoom 20 ≈ 1:563.
    - **Rappel de sens** (contre-intuitif) : `minScale` est le **plus grand** des deux nombres — il borne la vue la plus _large_, et un dénominateur croît quand on dézoome. `{ "minScale": 9222148, "maxScale": 2252 }` = « visible de 1:9 222 148 à 1:2 252 ».
    - `labelScale.minScale`/`maxScale` (échelle des labels) est **inchangé** : même unité, même garde-fou, mais il vise les labels et non la couche.

### ⚠️ Breaking Changes (géocodage → plugin)

- **Clé de configuration `geocodingConfig` (racine de profil) retirée** : la configuration du géocodage migre vers le bloc **`modules.geocoding`**, déclaré dans `config/plugins/geocoding.json` et référencé par `Files.modules.geocoding`. `GeoLeaf.Config.get("geocodingConfig")` retourne désormais `undefined`. **Aucun shim de compatibilité** — un profil conservant `geocodingConfig` à la racine ne charge plus la configuration géocodage. **Migration** : déplacer le bloc `geocodingConfig` vers `config/plugins/geocoding.json` (clés inchangées : `enabled`, `provider`, `debounceMs`, `minChars`, `resultLimit`, `position`, `placeholder`, `flyToZoom`, `bbox`, `countrycodes`) et le déclarer dans `Files.modules.geocoding`. Détails et exemples : README de [`@geoleaf-plugins/geocoding`](https://www.npmjs.com/package/@geoleaf-plugins/geocoding).

### ⚠️ Breaking Changes (table → plugin)

- **Clés de configuration `tableConfig` (racine de profil) et `ui.showTable` retirées** : la configuration **globale** du tableau migre vers le bloc **`modules.table`**, déclaré dans `config/plugins/table.json` et référencé par `Files.modules.table`. `GeoLeaf.Config.get("tableConfig")` retourne désormais `undefined` ; `ui.showTable` est remplacé par `modules.table.showButton`. **Aucun shim de compatibilité** — un profil conservant `tableConfig`/`ui.showTable` à la racine ne charge plus la configuration table. **Migration** : déplacer le bloc vers `config/plugins/table.json` (clés : `enabled`, `showButton`, `defaultVisible`, `pageSize`, `maxRowsPerLayer`, `enableExportButton`, `virtualScrolling`, `defaultHeight`, `minHeight`, `maxHeight`, `resizable`) et le déclarer dans `Files.modules.table`. **Le binding par couche `layer.config.table.*`** (colonnes, tri, titre) **reste inchangé sur la couche** (`layer-config.schema.json` non modifié). Détails et exemples : README de [`@geoleaf-plugins/table`](https://www.npmjs.com/package/@geoleaf-plugins/table).

### ⚠️ Breaking Changes (dissolution POI → couches génériques)

- **Clé de configuration `poiConfig` (features.json) retirée** : le sous-système POI étant dissous, le bloc global `poiConfig` (`{ enabled }`) n'a plus d'objet — il est retiré des 9 profils, du schéma `features.schema.json` (features) et du schéma de profil. `GeoLeaf.Config` ne lit plus `poiConfig` ni le tableau `poi[]` (POI inline). **Aucun shim** — `features.schema.json` étant `additionalProperties:false`, un profil conservant `poiConfig` **échoue à la validation**. **Migration** : retirer le bloc `poiConfig` du `features.json`. Les couches de points se déclarent dans `layers[]` comme toute couche GeoJSON ; le clustering est déjà sous `modules.cluster` (depuis S3).
- **API plugin `@geoleaf-plugins/addpoi` : `GeoLeaf.POI.*` → `GeoLeaf.AddPOI.*`** _(breaking, plugin)_ : `GeoLeaf.POI` étant retiré du core, le namespace public de création de POI du plugin addpoi migre vers **`GeoLeaf.AddPOI`**. `GeoLeaf.POI.AddForm.*` → `GeoLeaf.AddPOI.AddForm.*` ; `GeoLeaf.POI.PlacementMode.*` → `GeoLeaf.AddPOI.PlacementMode.*` (idem `ImageUpload`). **Migration** : remplacer le préfixe `GeoLeaf.POI.` par `GeoLeaf.AddPOI.` dans le code d'intégration. Les POI créés sont désormais écrits sur la **couche hôte** éditable (`gl-src-<layerId>`) via `GeoLeaf.Layers`, aux côtés des features statiques (correction du split-brain).

### ⚠️ Breaking Changes (rendu attributaire par couche → `capabilities.feature-info`)

- **Clés `popup`, `tooltip`, `sidepanelConfig` (blocs) et `tooltipMode` (alias racine) de `{id}_config.json` retirées** : la configuration du rendu tooltip/popup/side-panel d'une couche migre vers le bloc **`capabilities.feature-info`** (propriété opaque du plugin `@geoleaf-plugins/feature-info` ; clés `titleField`, `tooltip`, `popup`, `sidepanel`). Le schéma de couche (`additionalProperties: false` à la racine) **rejette** désormais ces clés. **Aucun shim** — un profil conservant `popup`/`tooltip`/`sidepanelConfig`/`tooltipMode` à la racine de `{id}_config.json` échoue à la validation AJV. **Migration** : déplacer les champs sous `capabilities.feature-info` — `tooltip.fields` → `capabilities.feature-info.tooltip`, `popup.fields` → `.popup`, `sidepanelConfig.detailLayout` → `.sidepanel`, plus un `titleField` (chemin pointé du titre). Détails et exemples : README de [`@geoleaf-plugins/feature-info`](https://www.npmjs.com/package/@geoleaf-plugins/feature-info).
- **Badges taxonomy POI** _(régression temporaire)_ : sans le pont de traduction supprimé, un champ `badge` lié à la taxonomie (`categoryId`/`subCategoryId`) affiche l'identifiant brut au lieu du label. La résolution label/icône/sprite par la taxonomie relèvera d'une **configuration de rendu taxonomy dédiée** (à venir) — hors du bloc `capabilities.feature-info`.

### Security

- **CSP `style-src` stricte — `'unsafe-inline'` retiré** : tous les styles inline du rendu (badges/tableaux de popup, marqueurs POI, légende, attribut `style` du sprite SVG, contrôles de la démo) sont désormais posés via le **CSSOM** (`element.style.setProperty`) ou des **classes CSS**, jamais via un attribut `style`/`<style>` inline. La directive `style-src` du template de déploiement ne contient **plus** `'unsafe-inline'`. Un test e2e gardien (`18-security`) valide **0 violation `style-src`** au boot et au rendu d'un POI hostile. Voir le guide d'intégration sécurité pour la CSP recommandée.
- **Durcissement XSS au rendu des POI** : les sinks `href`/`src` des sections POI `link`/`image` valident désormais l'URL via `GeoLeaf.Security.validateUrl()` — une URL à protocole non autorisé (`javascript:`, `vbscript:`, `data:text/html`…) **n'est plus rendue** (l'élément est omis). Aucun changement pour les URL `http(s)`/`data:image` légitimes (l'attribut est normalisé en URL absolue).
- **`GeoLeaf.Security.sanitizeSvgContent()`** : retire désormais les éléments d'animation **SMIL** (`<animate>`, `<set>`, `<animateTransform>`, `<animateMotion>`, `<animateColor>`, `<mpath>`) du SVG non fiable — ils peuvent muter des attributs à l'exécution (ex. `<set attributeName="href" to="javascript:…">`).
- **Anti prototype-pollution** : `Config.merge()`/`set()` filtrent les clés `__proto__`/`constructor`/`prototype`.
- **Sprite de profil** : l'URL `taxonomy.icons.spriteUrl` est validée (`validateUrl`) avant le `fetch`.
- **Intégrité CDN (démo)** : MapLibre GL JS est chargé depuis unpkg avec un attribut `integrity` (SRI sha384) dans le template de déploiement.
- **Anti-clickjacking** : recommandation d'en-têtes serveur (`X-Frame-Options: DENY` + `frame-ancestors 'self'`) ajoutée. Voir le nouveau **Guide de sécurité intégrateur**. _(Le `style-src` de la CSP de référence ne requiert désormais **plus** `'unsafe-inline'` — voir l'entrée « CSP `style-src` stricte » ci-dessus.)_
- **Suppression de la dépendance `xlsx` (SheetJS)** : l'export Excel utilise désormais un writer OOXML minimal interne (write-only, sans dépendance tierce), éliminant 2 CVE (prototype pollution CVE-2023-30533 + ReDoS) embarquées dans le chunk d'export. Aucun changement d'API (`Excel` reste un format d'export du tableau).
- **Dépendances** : versions patchées épinglées (`dompurify`, `markdown-it`, `protocol-buffers-schema`) ; les vulnérabilités résiduelles ne concernent que l'outillage de développement (non livré au runtime).

### Removed

- **`GeoLeaf.Security.sanitizePoiProperties()` supprimée** _(breaking)_ : ce helper n'était câblé sur aucun chemin de production — le texte des POI est échappé **aux sinks de rendu** (popup `setSafeHTML`, sidepanel `normalizePoi`) et les URL validées via `validateUrl()`. Il entretenait un faux signal de couverture (testé mais jamais appelé). Pour assainir des données externes avant un rendu **hors** GeoLeaf, utiliser `escapeHtml()` (texte) + `validateUrl()` (URL), ou `sanitizeHTML(el, html)` pour injecter du HTML.
- **Fallbacks de format legacy supprimés** _(breaking — clean-slate v3.0.0)_ : le runtime n'accepte plus que la forme canonique des clés suivantes :
    - **`sizePx` (taille de point) → utiliser `radius`** : l'alias n'est plus normalisé en `radius` dans les styles flat. _(Sans rapport : `label.buffer.sizePx` — l'épaisseur du halo de label — reste valide et inchangée.)_
    - **`vectorTiles.url` → utiliser `vectorTiles.tilesUrl`** : `tilesUrl` est la clé canonique (déjà imposée par le schéma de profil) ; l'alias d'entrée `url` n'est plus reconnu.
    - **`layerScale` (visibilité par échelle) → utiliser `scaleConfig`** : l'alias legacy et son avertissement de dépréciation sont retirés. La forme canonique est **`scaleConfig.minScale`/`maxScale`** — voir la section « Breaking Changes (seuils d'échelle des couches) » ci-dessus, qui en donne l'unité et la conversion. _(`labelScale` reste pris en charge — non concerné.)_
    - **`pointStyle` (override de style de marqueur, niveau couche) supprimé** : bloc legacy sans rendu MapLibre, non utilisé par les profils ; utiliser le format `style` flat (`radius`, `fillColor`…).
    - **`data.useLegacyProfileData` supprimé** : le chargement de profil « plat » legacy (`poi.json`/`routes.json`/`mapping.json` séparés) n'existe plus ; seul le format de profil modulaire (`config/core/*` + `Files`) est chargé.
    - **Plugin AddPOI** : la dérivation de géométrie depuis le champ legacy `latlng: [lat, lng]` est retirée — les POI doivent porter une `geometry` GeoJSON.
- **`GeoLeaf.Utils.EventHelpers.debounce` / `.throttle` supprimées** _(breaking mineur — clean-slate v3.0.0)_ : ces deux méthodes étaient des doublons jamais appelés du namespace `EventHelpers` (dédié au dispatch/écoute d'événements DOM). Utiliser les fonctions canoniques **`GeoLeaf.Utils.debounce`** / **`GeoLeaf.Utils.throttle`** (inchangées). ⚠️ Défauts légèrement différents : `debounce` 250 ms (au lieu de 300), `throttle` 100 ms (au lieu de 300) — préciser le délai à l'appel si nécessaire.

### ⚠️ Breaking Changes (layout profil v2)

- **Nouvelle arborescence de profil** : les fichiers de section vivent désormais dans `config/core/` (`taxonomy.json`, `themes.json`, `layers.json`, `basemaps.json`, `ui.json` + nouveau `features.json`) et la configuration de chaque plugin dans `config/plugins/<moduleId>.json`. `profile.json` ne contient plus que l'identité (`id`, `label`, `description`, `version`), la section `map` et le manifeste `Files`. Les chemins étant déclarés dans `Files`, un profil existant reste lisible **s'il met à jour son manifeste** ; en revanche les fallbacks top-level `taxonomyFile`/`themesFile` (hors `Files`) sont **supprimés**. **Migration** : déplacer les 5 fichiers de section vers `config/core/`, extraire `clusteringConfig`/`geocodingConfig`/`performance`/`poiConfig` de `profile.json` vers `config/core/features.json` (référencé par `Files.featuresFile`), extraire les blocs plugins (`storage`, `poiAddConfig`, `editorConfig`…) vers `config/plugins/<moduleId>.json` (référencés par `Files.modules`).

### Added

- **`GeoLeaf.Helpers.applyCssText(el, css)`** (+ export ESM nommé `applyCssText`) : pose une déclaration CSS sur un élément **propriété-par-propriété via le CSSOM** (`style.setProperty`), de façon **CSP-safe** (non soumis à `style-src`, contrairement à `el.style.cssText = …`). Helper destiné aux styles dynamiques code-owned. Également `applyDeferredStyles(root)` (applique les attributs `data-gl-style` d'un sous-arbre après insertion). Utilisés par le core et les plugins pour fonctionner sous une CSP `style-src` stricte (sans `'unsafe-inline'`).
- **`Files.featuresFile`** : nouveau fichier de section pour les features core transverses (`clusteringConfig`, `geocodingConfig`, `performance`, `poiConfig`, `mapOptions`), fusionné à la racine du profil consolidé comme `uiFile`/`basemapsFile`.
- **`Files.modules`** : dictionnaire `{ moduleId: cheminFichier }` — un fichier de configuration par plugin, fusionné dans `modules.<id>` (Plugin Contract v1, contenu opaque pour le core). Un bloc `modules.<id>` inline dans `profile.json` prime sur le fichier (deepMerge ; les tableaux sont remplacés, pas fusionnés).
- **`profile-bundle.json` étendu** : le bundle généré au build embarque désormais les sections `features` et `modules` ; le boot en déploiement reste à 3 requêtes (config racine + profile.json + bundle).
- **Mode debug = cascade** : quand `debug: true` est actif dans `geoleaf.config.json`, le loader ignore `bundleFile` et charge la cascade de fichiers — permet d'éditer à chaud un profil déployé sans régénérer le bundle.

### Fixed

- **`Core.destroy(mapId)` — teardown réel du cycle de vie** : à la fermeture de la **dernière** carte, l'état métier partagé (POI, GeoJSON, LayerManager, profil actif) est désormais nettoyé via un seam de cycle de vie interne. Un `Core.init()` ultérieur (remontage React, navigation SPA, changement de profil) repart d'un état propre — **plus de marqueurs/couches dupliqués, de profil fantôme ni de fuite d'adaptateur**. La signature publique est inchangée. Validé en navigateur (`e2e/10-lifecycle.spec.js`).
- **Légende** : la taxonomie est lue depuis le profil actif déjà chargé au lieu d'être re-téléchargée via un chemin codé en dur (`profiles/{id}/taxonomy.json`) — supprime un fetch redondant et un 404 latent avec le layout v2 (fallback fetch conservé pour les profils legacy).
- **Sélecteur de thèmes** : même correction — les thèmes sont lus depuis le profil actif au lieu d'un re-fetch de `profiles/{id}/themes.json` chemin codé en dur.

- **Boutons d'action en popup** : nouveau type de renderer `type: "action"` dans `popup.fields[]` (couches GeoJSON) et `popup.detailPopup[]` (marqueurs POI). Un bouton configurable dans le popup peut déclencher n'importe quelle action côté hôte — ouvrir une fiche backend (Odoo…), appeler une API, émettre un événement — **sans coupler le core à un backend**. Champs : `actionId` (requis, opaque), `labelKey`/`label`, `variant` (`primary`/`secondary`/`danger`), `order`, `href` (ouvert par le core via `validateUrl` si aucun handler), `confirm`/`confirmKey`, `requiresPlugin` (bouton désactivé si le plugin est absent), `payloadFields` (whitelist des propriétés du payload). Périmètre v1 : popup uniquement.
- **`GeoLeaf.Popup`** : nouvelle façade publique exposant `registerActionHandler(actionId | "*", fn)` et `unregisterActionHandler(actionId)`. Le handler `fn(ctx)` reçoit un contexte riche (`{ actionId, feature?, poi?, layerId, featureId, properties, lngLat?, buttonEl, popup, setBusy, close }`) et peut retourner une `Promise` — le bouton passe alors en état « busy » jusqu'à résolution. Précédence au clic : handler exact → handler joker `"*"` → ouverture du `href` intégré. La protection CSRF est de la responsabilité du handler (`GeoLeaf.Security.CSRFToken.addTokenToHeaders()`).
- **`geoleaf:popup:action`** : nouvel événement émis sur `document` à chaque clic sur un bouton d'action de popup (émis dans tous les cas, qu'un handler soit enregistré ou non). Payload : `{ actionId, layerId, featureId, properties, lngLat? }` — `properties` borné par `payloadFields` (défaut : `id`/`name`/`title`/`label`), fonctions et références DOM supprimées.
- **Configuration par module — `modules.<id>`** : la configuration des plugins se déclare dans un bloc `modules.<id>` du profil (ex. `modules.storage`, `modules.print`). Le contenu de chaque bloc appartient au plugin — le core le traite comme opaque. **C'est désormais l'unique forme supportée** (le repli sur les clés racine legacy a été retiré en clôture S14, voir Removed).
- **`GeoLeaf.Config.getModuleConfig(moduleId, key?, defaultValue?)`** : accesseur lisant `modules.<moduleId>.<key>`. Équivalent dot-notation : `GeoLeaf.Config.get("modules.<id>.<clé>")`.
- **`style.paint` (styles de couche) désormais fusionné** : un bloc `style.paint` (propriétés MapLibre natives — `fill-color`, `circle-radius`, `line-dasharray`…) déclaré dans un fichier de style est maintenant **fusionné dans le paint de la couche**, comme `expressionPaint` (qui reste prioritaire en dernier). Auparavant `style.paint` était silencieusement ignoré (seul `expressionPaint` était appliqué) — les profils qui le déclaraient voient désormais leur rendu appliqué.
- **Contrat `mapping.json` — multi-source unique** : `mapping.json` (normalisation de données brutes d'une source externe vers le format POI) est désormais **toujours** un objet de blocs nommés par source `{ "<sourceId>": { mapping, … } }` (une seule source = un seul bloc ; plus de forme top-level `{ mapping }`). Chaque `mapping` est **plat** (`{ champNormalisé : "champSource" }`, chemins pointés autorisés : `location.lat`, `attributes.kind`). Schéma : `mapping.schema.json`.
- **Normalisation de source externe au chargement d'une couche** : déclarer `Files.mappingFile` dans le manifeste du profil, puis sur une **couche GeoJSON** pointer un bloc source via `data.mapping: "<sourceId>"` (+ `data.itemsPath` optionnel, ex. `"results"`, pour extraire le tableau d'une réponse imbriquée type API GBIF). Au chargement, les données brutes sont normalisées (mapping.json → format POI) puis rendues en features GeoJSON **Points**. Les `id` numériques (ex. `key` GBIF) sont coercés en chaîne. Le profil de démo `guyane-biodiversite` illustre le cas avec la couche `observations_gbif` (API GBIF).
- **Nouveaux paramètres UI contractualisés** : `ui.showSearch`, `ui.showShareButton` (défaut `true`) et `ui.interactiveShapes` (défaut `false`) sont désormais déclarés dans le schéma `ui` — auparavant lus par le code mais inconfigurables.
- **`data.vectorTiles.scheme`** (`"xyz"` | `"tms"`) : schéma de grille de tuiles vectorielles désormais configurable (ex. `"tms"` pour l'IGN Géoplateforme).
- **Source `data.ogcApi`** : bloc de configuration OGC API Features formellement déclaré (`url` requis, + `collectionId`/`bbox`/`maxFeatures`/`limit`/`autoRefresh`/`autoRefreshDebounce`/`headers`).

### Removed

- **⚠️ Breaking — clés racine de configuration plugin retirées (clôture S14)** : `storage`, `poiAddConfig`, `printConfig`, `measureConfig` et `editorConfig` au niveau racine du profil **ne sont plus reconnues**. Le miroir bidirectionnel et le repli de dépréciation introduits en S0 ont été supprimés : `modules.storage`, `modules.addpoi`, `modules.print`, `modules.measure`, `modules.editor` sont **la seule forme valide** (Plugin Contract v1, INV-CONFIG, désormais figé). Les interfaces correspondantes ont été retirées de l'API de types `GeoLeafConfig`. **Migration** : déclarer chaque config plugin sous `modules.<id>` (déjà le cas pour tous les profils livrés depuis le layout v2) et lire via `GeoLeaf.Config.getModuleConfig(id, key, default)` ou `Config.get("modules.<id>.<clé>")`.
- **⚠️ Breaking — alias de style `lineColor`/`lineOpacity`/`lineWidth` retirés** : ces clés legacy n'avaient **aucun effet** (le convertisseur ne lit que `color`/`opacity`/`weight`). Elles sont retirées de `style.schema.json` (désormais **rejetées** à la validation de profil). **Migration** : `lineColor`→`color`, `lineOpacity`→`opacity`, `lineWidth`→`weight`.
- **⚠️ Breaking — forme top-level de `mapping.json` retirée** : un `mapping.json` portant `mapping` à la racine n'est plus valide ; l'envelopper sous un bloc source nommé (voir « Contrat `mapping.json` » et « Normalisation de source externe » dans Added).
- **⚠️ Breaking — `GeoLeaf.UI.ScaleControl` retiré** : ce contrôle d'échelle était un **doublon** (piloté par `ui.scaleType`, non auto-initialisé) de la barre d'échelle active. Utiliser le contrôle standard, piloté par **`scaleConfig`** (`scaleGraphic`/`scaleNumeric`/…) et initialisé automatiquement au boot. Le paramètre `ui.scaleType` est supprimé (remplacé par `scaleConfig`).

### ⚠️ Breaking Changes (multi-instance)

- **`Core` n'est plus un singleton** : `Core.init({ mapId })` crée une instance par `mapId` au lieu de recycler une instance unique. `init()` exige désormais `options.mapId` (retourne `null` + log d'erreur sinon). `Core.getMap(mapId?)` accepte un `mapId` optionnel — **sans argument, retourne la première instance active** (rétro-compatible). La légende et le thème restent **globaux** et s'appliquent à la **première** instance (périmètre ciblé). `GeoLeaf.removeMap(id)` est **déprécié** et aliasé sur `Core.destroy(id)` (émet un avertissement). **Migration** : apps **mono-carte** → aucun changement ; apps **multi-cartes** → `const a = GeoLeaf.Core.init({ mapId: 'id-unique', center, zoom }); /* au démontage du composant */ GeoLeaf.Core.destroy('id-unique');`.

### Added (multi-instance)

- **`Core.destroy(mapId)`** : détruit proprement une instance keyed — appelle `MaplibreAdapter.destroy()` (`map.remove()`, purge markers/controls/registry) puis libère le slot du registre. Retourne `true` si une instance existait, `false` sinon. À appeler au démontage côté consommateur (ex. unmount React).
- **`Core.hasMap(mapId)` / `Core.listMaps()`** : introspection du registre d'instances (debug, devtools, tests).
- **Support multi-instance** : N cartes MapLibre coexistantes sur une même page, chacune avec son cycle de vie indépendant (mount/unmount).

### Changed

- **Géocodage UI** : `geocodingConfig.position` par défaut est désormais `"top-left"` (auparavant `"top-right"`). La pill géocodage adopte le visuel de la barre de recherche POI partagée (`.gl-pill-search`) avec icône loupe SVG sur le bouton submit. Les valeurs explicites de `position` dans les profils restent honorées sans changement. **Migration intégrateurs** : aucune action requise ; pour conserver l'ancien comportement, déclarer `geocodingConfig.position: "top-right"` dans le profil JSON.
- **Recherche POI** : le filtre `searchConfig.filters[].type: "search"` est désormais rendu dans une section dédiée en tête du panneau filtre (était précédemment masqué). L'input est positionné dans `[data-gl-filter-id="searchText"]` — selecteur inchangé pour `state-reader`. Le filtrage temps réel se déclenche à chaque keystroke.
- **Mobile (≤ 768 px)** : le bouton « search » de la pill toolbar ouvre désormais la pill géocodage flottante (recherche d'adresse) au lieu de l'ancienne barre POI. La recherche POI sur mobile est accessible via l'onglet/sheet FILTRE qui contient la pill `searchText` dans son header.

### Removed

- **`.gl-search-bar*` (CSS)** + module `mobile-toolbar-searchbar.ts` (POI floating search bar) + variables CSS `--gl-search-bar-height` / `--gl-search-bar-gap` : remplacés par le composant `.gl-pill-search` partagé entre la pill géocodage et la pill recherche POI dans le panneau filtre. Les intégrateurs qui surchargeaient ces classes doivent migrer vers `.gl-pill-search`, `.gl-pill-search__input`, `.gl-pill-search__submit`, `.gl-pill-search__clear`.

### Added

- **`@geoleaf-plugins/measure` v1.0.0** : plugin MIT de mesure cartographique (distance, surface, cercle, annotations tooltip DOM géoréférencées, track GPS) — publié sur npmjs.org. Façade publique : `GeoLeaf.Measure.activate()`, `deactivate()`, `clearAll()`, `exportGeoJSON()`, `importGeoJSON()`, `getPrintableAnnotations()`, `setMenuPosition()`, `getMenuHeight()`. Configurable via `measureConfig` dans le profil GeoLeaf.
- **`@geoleaf-plugins/print` v1.1.0** : case « Annotations » conditionnelle dans le modal d'impression — visible uniquement si `@geoleaf-plugins/measure` est chargé ; les annotations tooltip sont composées dans l'export canvas à leurs coordonnées géographiques via `GeoLeaf.Measure.getPrintableAnnotations()`. Nouveau champ `printConfig.includeAnnotations` (boolean, défaut `true`). i18n 6 langues.
- **Variables CSS `--gl-color-tooltip-bg` / `--gl-color-tooltip-text`** dans `geoleaf-theme.css` (`:root`, `.gl-theme-light`, `.gl-theme-dark`) — les tooltips de la barre pill et des boutons de sous-menu plugin-measure respectent désormais le thème courant au lieu de couleurs codées en dur.
- **`GeoLeaf.Share`** (A.7 — Partage de vue) : nouvelle façade publique exposant `openShareDialog()`, `closeShareDialog()`, `isOpen()` et `getShareUrl()`. Affiche une modale accessible avec le lien permalink courant (`window.location.href`), un bouton « Copier » (`navigator.clipboard.writeText` + fallback `execCommand`) et un bouton « Afficher le QR code » qui **lazy-load** la librairie `qrcode-generator` au premier clic uniquement (chunk séparé ~12 KB gzip, zéro impact bundle initial).
- **`ui.showShareButton`** (boolean, défaut `true`) dans `IUIConfig` : contrôle l'affichage des boutons « Partager » (mobile pill bar + desktop tab strip).
- **Bouton « Partager » mobile** injecté dans la barre pill via le registry (`mobileIcon`) — comportement cohérent avec le bouton print.
- **Bouton « Partager » desktop** inséré dans la tab strip entre le séparateur et le theme toggle.
- **`@geoleaf-plugins/print` v1.0.0** : plugin MIT d'impression cartographique (export PDF/JPG A4/A3 300 DPI, parcours interactif échelle × format papier, re-rendu off-screen, composition canvas 2D, légende inline, repli serveur optionnel) — publié sur npmjs.org.
- **`GeoLeaf.I18n.registerDict(namespace, dictsByLang)`** : API core permettant aux plugins d'enregistrer leurs propres dictionnaires i18n (Sprint 2 plugin-print).
- **`preserveDrawingBuffer` auto-détecté** dans `maplibre-adapter.ts` lors de l'enregistrement du plugin print — aucune configuration manuelle requise (Sprint 2 plugin-print).
- **`ui.showPrint`** dans `UIConfig` + **`printConfig`** dans `GeoLeafConfig` : intégration de la configuration du plugin print dans le profil GeoLeaf (Sprint 7 plugin-print).

### Fixed

- **`gl_shown` permalink** : ouvrir un lien partagé contenant `gl_shown=<layerId>` pour une couche hors du thème actif affiche désormais correctement la couche. Auparavant la restauration était un no-op silencieux car `VisibilityManager.setVisibility()` ignorait les couches absentes de `GeoJSONShared.state.layers`. Nouveau helper `restoreShownLayer` (`modules/built-in/permalink/permalink-layers.ts`) qui lazy-load la couche via `ThemeApplierCore._loadLayerFromProfile()` avant d'appliquer l'override utilisateur.

### ⚠️ Breaking Changes (cleanup campaign B6)

- **`LeafletLayerLike` → `LayerLike`** (Sprint B6 — cleanup campaign) : le type public `LeafletLayerLike` a été renommé en `LayerLike` dans `@geoleaf/core`. Ce renommage est un hard breaking change sans alias de dépréciation. **Migration** : remplacer tout `import { LeafletLayerLike } from '@geoleaf/core'` par `import { LayerLike } from '@geoleaf/core'`.

### Changed

- **Interne — Cache UI sorti du core** : le module `CacheSection` (dead code, jamais rendu en production) et les assets CSS associés (`geoleaf-cache.css`, `cache-modal.css`) ont été retirés de `@geoleaf/core`. Les clés i18n `ui.cache.*` / `toast.cache.*` / `aria.cache.*` / `format.cache.*` ont également été retirées du core. Ces éléments vivent désormais exclusivement dans `@geoleaf-plugins/storage` (CSS bundlée inline via `rollup-plugin-postcss`, auto-injection au chargement du plugin). **Aucun impact user-facing** : le flag `ui.showCacheButton` reste fonctionnel (le plugin le lit directement depuis `cfg.ui`) et le bouton cache s'affiche toujours quand `@geoleaf-plugins/storage` est chargé. Typage : le champ `showCacheButton` ne figure plus explicitement dans `UIConfig` — il reste accepté via le passthrough `[key: string]: unknown`.
- **Export interne `GeoLeaf._LayerManagerCacheSection`** : retiré (référence privée préfixée `_`, jamais documentée publiquement).

### Added

- **Export table multi-formats (CSV, KML, GPX, Excel)** : la table GeoLeaf supporte désormais 5 formats d'export — GeoJSON (existant), CSV, KML, GPX et Excel (.xlsx via SheetJS, chargé en lazy). L'interface passe d'un unique bouton "Exporter" à deux **split-buttons dropdown** : "Exporter la sélection" (actif uniquement si sélection) et "Exporter la couche" (toujours actif si couche chargée). Chaque dropdown liste les formats configurés.

- **`Table.exportSelection(format?, options?)`** : méthode existante étendue. Accepte désormais un `ExportFormat` (`'geojson' | 'csv' | 'kml' | 'gpx' | 'excel'`) et un objet `ExportOptions` optionnel. Défaut : `'geojson'` (rétrocompatibilité).

- **`Table.exportLayer(format?, options?)`** : nouvelle méthode publique. Exporte **toutes** les features de la couche active (sans limite `maxRowsPerLayer`) dans le format demandé. Émet `table:exportLayer` avec `{ layerId, format, count }`.

- **`TableConfig`** dans `geoleaf.config.json` ou `profile.json` : interface TypeScript formalisée avec les nouvelles clés `exportFormats`, `csvSeparator`, `csvIncludeGeometry`. Voir section dédiée dans `PLUGIN_CONFIGURATION_GUIDE.md`.

- **`table:exportLayer`** : nouvel événement émis sur `document` après export de la couche entière. Payload : `{ layerId: string, format: ExportFormat, count: number }`.

- **`UIConfig.showCredentialButton`** : nouveau champ optionnel `boolean` dans `UIConfig` (typage seul). Permet au plugin `@geoleaf/connector` ≥ 1.1.0 de lire l'activation du bouton credential depuis le profil `ui.json`. Aucun code core ne consomme ce champ (conformité `no-plugin-in-core`). À partir de `@geoleaf/connector` 1.2.1, ce flag suffit à monter le bouton sans appel `GeoLeaf.Connector.configure()` préalable (auto-bootstrap UI-only côté plugin, déclenché par `geoleaf:profile:loaded` / `geoleaf:map:ready` ; lu via `GeoLeaf.Config.getActiveProfile()`).

- **`@geoleaf-plugins/realtime-layer` — `data.realtime.fallbackUrl`** : nouveau champ optionnel du schéma `data.realtime`. Snapshot CDN local servi automatiquement par `PollingSource` quand l'URL primaire renvoie HTTP non-2xx ou échoue (erreur réseau). Le snapshot est émis une seule fois par panne ; la source continue d'interroger le primaire et revient à lui dès son premier succès. Polling uniquement.
- **`@geoleaf-plugins/cog`** : nouveau plugin de rendu Cloud Optimized GeoTIFF (COG). Lecture native via `geotiff@^3.0.5` avec sélection d'overview automatique selon le viewport, rendu multi-bandes (1/3/4 canaux, nodata transparent, LUT colorMap), injection comme source `image` MapLibre GL JS. API : `GeoLeaf.COG.addLayer(url, map, opts?)`, `GeoLeaf.COG.removeLayer(map, id)`, `GeoLeaf.COG.getInfo(url, opts?)`. Bundle séparé du core, publié sur npmjs.
- **`@geoleaf-plugins/flatgeobuf`** : nouveau plugin MIT de chargement FlatGeobuf. Streaming via async iterator (`flatgeobuf` v4.4.0), filtrage spatial bbox via R-tree index + HTTP Range requests, auto-refresh debounced sur viewport. API : `GeoLeaf.FlatGeobuf.load(url)`, `loadBbox(url, bbox)`, `loadAsLayer(url, options?)`, `loadBboxAsLayer(url, bbox, options?)`, `loadLayerFromConfig(config)` (config déclarative JSON). Bundle séparé du core (~91 KB raw / 20 KB gzip). Premiers exemples en profil : `france-rail/zones_desserte` (bbox + auto-refresh), `tourism/eco_regions_fgb` (fichier local ; gain taille −51% vs GeoJSON source).
- **`@geoleaf-plugins/file-import`** : nouveau plugin MIT d'import de fichiers géospatiaux. Formats supportés : GPX, KML, KMZ, CSV (lat/lng ou WKT), TopoJSON. API : `GeoLeaf.FileImport.convert(file)`, `importAsLayer(file, options?)`, `getSupportedFormats()`, `registerConverter(ext, converter)`. Bundle séparé du core (~276 KB raw).
- **`Geocoding`** : 31ème export nommé ESM. Module de recherche d'adresse lazy-loadé (`_loadModule("geocoding")`), API `GeoLeaf.Geocoding`. Quatre fournisseurs intégrés : `addok`, `nominatim`, `photon`, URL personnalisée.
- **`geoleaf:geocoding:result`** : nouvel événement émis lors de la sélection d'un résultat de géocodage — payload `{ label, lat, lng, bounds? }`.
- **`GeocodingConfig`** dans `ui.json` ou `geoleaf.config.json` : paramètres `enabled`, `provider`, `position`, `placeholder`, `minChars`, `resultLimit`, `debounceMs`, `flyToZoom`.
- **Terrain 3D** : support du relief 3D sur basemaps raster (`type: "tile"`) et vectoriels (`type: "maplibre"`). Configuration via `basemaps.{id}.terrain` (`enabled`, `demUrl`, `demEncoding`, `demMaxZoom`, `exaggeration`, `default3D`, `pitch`, `bearing`). Activation automatique sans toggle UI — `default3D: true` active le terrain au switch vers le basemap, `false` le désactive. Source DEM validée en production : AWS Terrarium (~30m).
- **`map.maxPitch`** dans `profile.json` : plafond d'inclinaison caméra configurable. GeoLeaf lève la limite MapLibre GL JS par défaut (60°) à **80°**. Valeur par défaut : `80`. Configurable via `profile.json > map.maxPitch`.
- **Fill-Extrusion** : support des polygones 3D via le type de layer MapLibre GL JS `fill-extrusion`. Configurer `geometry: "fill-extrusion"` dans le fichier config de couche, puis définir `fillExtrusionColor`, `fillExtrusionOpacity`, `fillExtrusionHeight` et `fillExtrusionBase` dans le fichier style. `fillExtrusionHeight` accepte une valeur fixe (mètres) ou un nom de champ feature (ex. `"hauteur"`). La validation est assurée par `style-validator-extrusion.ts` : erreur si `fillExtrusionHeight` manquant, warning si le champ n'est pas trouvé dans les propriétés du premier feature.
- **`GeoLeaf.Utils.wktToGeoJSON(wkt)`** : convertit une chaîne WKT en objet géométrie GeoJSON. Supporte les 7 types standardisés (`Point`, `LineString`, `Polygon`, `MultiPoint`, `MultiLineString`, `MultiPolygon`, `GeometryCollection`) en 2D et 3D/Z. Supporte le préfixe SRID (`SRID=4326;…`) et les qualificateurs `Z`/`M`/`ZM`. Retourne `null` sans exception si l'entrée est invalide.
- **OGC API Features** : support natif du chargement de couches GeoJSON depuis un endpoint OGC API Features. Configurer `data.ogcApi` dans la définition de couche : `url`, `collectionId`, `bbox`, `maxFeatures`, `limit`, `autoRefresh`, `autoRefreshDebounce`, `headers`. Pagination automatique via liens `next`, garde-fou `maxFeatures`, annulation via `AbortController`, conversion automatique des géométries WKT. Mode `autoRefresh: true` : re-fetch sur `moveend` avec bbox viewport courant.
- **`.topojson` et `.fgb`** ajoutés à la validation `FileValidator` (préparation plugins Sprint 3/4).
- **Basemap `type: "image"`** : nouveau type de fond de carte pour images géoréférencées statiques (format natif MapLibre `image`). Configuration via `basemaps.{id}.imageSource` (`url`, `coordinates`, `opacity`). L'image est positionnée selon 4 coins `[lng, lat]` ; sans `coordinates`, les limites monde sont utilisées par défaut.
- **Basemap `type: "hillshade"`** : ombrage du relief via couche MapLibre `hillshade`. Configuration via `basemaps.{id}.hillshade` (`demUrl`, `demEncoding`, `demMaxZoom`, `shadowColor`, `highlightColor`, `accentColor`, `exaggeration`, `illuminationDirection`, `illuminationAnchor`). Réutilise automatiquement la source DEM `terrain-dem` si elle est déjà présente avec la même URL (compatible avec `type: "tile"` terrain 3D).
- **Basemap `type: "wmts"`** : support des serveurs WMTS OGC via résolution dynamique du `GetCapabilities`. Configuration via `basemaps.{id}.wmts` (`getCapabilitiesUrl`, `layer`, `tileMatrixSet`, `format`). Parsing XML namespace-safe, cache in-memory des URL résolues, annulation via `AbortController`.
- **Basemap `type: "wms"`** : support des serveurs WMS OGC (flux raster). Configuration via `basemaps.{id}.wms` (`url`, `layers`, `version`, `crs`, `format`, `tileSize`, `transparent`, `styles`). Construit l'URL template avec placeholder `{bbox-epsg-3857}` compatible MapLibre GL JS.

### Changed

- **Extraction GPX du core** : la conversion GPX→GeoJSON (méthode `DataConverter.convertGpxToGeoJSON()` + helpers privés) a été retirée de `@geoleaf/core` et migrée vers `@geoleaf-plugins/file-import`. Le pipeline route (`route-utils.ts::parseGPX()`) et la normalisation (`normalizer.ts::normalizeFromGPX()`) ne sont pas affectés. Interface `DataConverterLike` mise à jour (retrait de `convertGpxToGeoJSON()`). Le loader `single-layer.ts` n'a plus de branche `isGpx` — simplification du flux de chargement.

### Docs

- **Guide complet Geocoding** : `CONFIGURATION_GUIDE.md §12` enrichi avec un guide de choix de provider (Addok = collectivités France, Nominatim = usage général mondial), tableau comparatif (couverture, quota, latence, attribution), politique d'usage Nominatim (1 req/s, User-Agent auto, Accept-Language auto), schéma du provider custom (champs lus par le parseur interne), API programmatique (`GeoLeaf.Geocoding.search/selectResult/destroy`) et note sécurité. Nouvelle recette `COOKBOOK §11` (4 variantes : Addok minimal, Nominatim mondial, événement custom, recherche sans UI), nouvelle section `USER_GUIDE §7.6` (navigation clavier, `flyTo` vs `fitBounds`), 6 entrées `FAQ` (clé API, choix de provider, 429 Nominatim, filtrage par zone, événement résultat, provider custom). Complément `API_REFERENCE` : fallback silencieux sur Addok si non-HTTPS, comportement `destroy()`.

### Fixed

- **`@geoleaf-plugins/realtime-layer` — lecture `data.realtime`** : `RealtimeManager.bootFromProfile()` et `start()` ne trouvaient pas la config RT lorsque celle-ci était imbriquée dans le bloc `data` du JSON de couche (schéma canonique des profils). Le plugin ne lisait que `config.realtime` à la racine. Le lookup recherche désormais d'abord `config.data.realtime`, puis `config.realtime` en secours.
- **Fill-extrusion plates au chargement** : les couches `fill-extrusion` s'affichaient à plat (hauteur 0) au chargement initial et après changement de style. Cause : l'objet style complet `{ id, label, style: {…} }` était passé directement aux fonctions de rendu au lieu du paint plat — `toFillExtrusionPaint()` ne trouvait pas les clés `fillExtrusionHeight` etc. à la racine. Corrigé dans `theme-applier/visibility.ts` et `vector-tiles.ts`.
- **Style actif perdu après changement de basemap** : les couches GeoJSON (dont fill-extrusion) revenaient systématiquement au style par défaut après chaque switch de basemap. Cause : `_rebuildGeoJSONLayers()` lisait `.defaultStyle` sur un paint plat, toujours `undefined`. Corrigé par la lecture `currentStyle.style ?? currentStyle`.
- **Sous-couche `line` parasite sur les couches fill-extrusion** : une sous-couche `line` était générée par-dessus les volumes 3D, produisant un rendu parasite. Corrigé par un guard `geometry !== "fill-extrusion"` dans `maplibre-helpers.ts`.
- **Couches vector tiles invisibles après switch de basemap** : les couches VT n'étaient pas rechargées après un changement de basemap (elles étaient ignorées dans `_rebuildGeoJSONLayers` car `features: []`). Corrigé par une branche dédiée `isVectorTile === true` déclenchant `loadVectorTileLayer()`.

---

## Versions antérieures

Le changelog des versions antérieures à la 3.0.0 n'est pas repris ici. Les notes de version
de la 2.0.0 — la première publication npm, qui a porté le passage de Leaflet à MapLibre GL JS
— restent disponibles : [Patchnote V2.0.0](releases/PATCHNOTE_V2.0.0).

Chaque changement cassant porte sa propre note **« Migration »** dans la section de la version
concernée ci-dessus.
