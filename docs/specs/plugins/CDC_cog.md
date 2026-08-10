---
type: spec-plugin
title: cog — l'affichage direct de Cloud Optimized GeoTIFF sur la carte
plugin_id: cog
package: "@geoleaf-plugins/cog"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# cog — l'affichage direct de Cloud Optimized GeoTIFF sur la carte

**Type :** plugin publié · **Paquet :** `@geoleaf-plugins/cog` ·
**Code :** `packages/plugins/cog/` · **Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa
>    place. Les versions se lisent par `npm run versions:check`, jamais en prose.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Première fiche de plugin du dépôt : elle fixe la forme.** Un plugin n'a ni gate de
> capacité, ni `configSchema`, ni installeur de preset. Ce qui tient sa place, c'est le
> **manifeste d'enregistrement** — la section gatée ci-dessous — et le contrat gelé
> [`PLUGIN_ARCHITECTURE_SPEC.md`](../contrats/PLUGIN_ARCHITECTURE_SPEC.md).

---

## Périmètre

### Ce que le plugin fait

Il affiche un fichier **Cloud Optimized GeoTIFF** sur une carte MapLibre à partir de sa seule URL.
Il lit les en-têtes TIFF par requêtes HTTP partielles, choisit l'aperçu adapté à la largeur de la
fenêtre, décode les pixels, les peint sur un canevas et injecte le résultat comme **source image**
géoréférencée plus une **couche raster**.

Sans lui, afficher ce format demande un serveur de tuiles intermédiaire — latence, coût
d'infrastructure et complexité opérationnelle en plus.

### Ce qu'il ne fait pas

- **Il ne diffuse pas tuile par tuile.** Il charge **un aperçu entier** en une requête. Sur un
  fichier volumineux dont les aperçus sont mal préparés, la garde de volume se déclenche — et c'est
  le comportement voulu.
- **Il ne reprojette pas.** L'emprise est extraite, les pixels ne sont pas reprojetés : un fichier
  en projection non géographique apparaîtra déformé sur une carte en Web Mercator. Le fichier doit
  être servi en EPSG:4326 ou 3857.
- **Il ne re-rend pas au zoom.** La couche est une image **statique** : zoomer après le chargement
  pixelise. Un rendu tuilé dynamique demande une solution serveur.
- **Il ne gère pas un TIFF non géoréférencé** : sans clés géographiques ni échelle de pixel, il n'y
  a pas d'emprise exploitable.
- **Il ne lit aucune configuration de profil** et **n'ajoute aucun bouton**. Voir §Configuration.
- **Il ne touche pas au pipeline GeoJSON** du core : c'est un canal d'ingestion raster
  indépendant, sur son propre namespace.

---

## Manifeste d'enregistrement

Ce que `src/entry.ts` déclare réellement. **Table gatée** par
`packages/core/__tests__/guards/doc-plugin-manifest.guard.test.js`, qui la compare à `entry.ts` et
à `package.json` — un `label` retouché ou une dépendance ajoutée sans passer ici fait rougir
`ci:local`.

| Champ        | Valeur                                               |
| ------------ | ---------------------------------------------------- |
| `name`       | `cog`                                                |
| `label`      | `Cloud Optimized GeoTIFF (satellite/aerial imagery)` |
| `requires`   | `[]`                                                 |
| `optional`   | `[]`                                                 |
| `namespace`  | `GeoLeaf.COG`                                        |
| `paquet npm` | `@geoleaf-plugins/cog`                               |

La `version` du manifeste n'est **pas** dans cette table, délibérément : `entry.ts` porte le jeton
de build `__GEOLEAF_VERSION__`, remplacé par la version du paquet à la construction. Le contrat le
**figé** ainsi (PC-11), précisément parce que les exemples historiques utilisaient la version du
**core** — le registre rapportait alors une fausse version. Recopier un numéro ici recréerait le
même défaut d'un cran plus loin.

### La forme de `entry.ts`, et ce que `cog` en utilise

Le squelette figé du contrat (§4) a **trois** étapes : i18n, montage du namespace,
auto-enregistrement. `cog` n'en exerce que **deux** :

| Étape du squelette       | `cog` ?                                                       |
| ------------------------ | ------------------------------------------------------------- |
| 1 — dictionnaires i18n   | ❌ aucun libellé à traduire : pas d'interface                 |
| 2 — montage du namespace | ✅ `GeoLeaf.COG = buildPublicApi()`                           |
| 3 — auto-enregistrement  | ✅ avec `healthCheck` vérifiant que le namespace est un objet |

⚠️ **La recette du §2.4 de la roadmap annonce « 6 étapes numérotées ».** C'est la forme des
plugins **d'interface** (voir `geocoding`, qui les a toutes : i18n, montage, cycle de vie,
enregistrement, créneau de barre d'outils avec sa `profileKey`, écouteur d'action). `cog` prouve le
minimum : un plugin peut n'avoir ni interface, ni cycle de vie, ni configuration.

L'enregistrement est **immédiat**, pas paresseux : le contrat autorise
`plugins.registerLazy(...)`, `cog` ne l'utilise pas.

---

## Fonctionnalités

| ID    | Fonctionnalité                         | Entrée                                         | Sortie observable                                                                                                                       | Code                                                                       |
| ----- | -------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| CG-01 | Lecture des métadonnées seule          | `getInfo(url)`                                 | Emprise, dimensions, nombre de bandes, valeur de transparence, nombre d'aperçus, code EPSG — **aucun pixel chargé**                     | `cog-loader.ts` → `getCogInfo`                                             |
| CG-02 | Validation de l'URL                    | URL relative, ou protocole autre que `http(s)` | `TypeError` explicite, **avant** toute requête                                                                                          | `cog-loader.ts` → `validateCogUrl`                                         |
| CG-03 | Extraction du code EPSG, deux chemins  | Fichier ouvert                                 | Code projeté préféré au code géographique ; **repli** sur l'ancienne disposition brute ; `null` si indéterminable — **ne jette jamais** | `cog-loader.ts`                                                            |
| CG-04 | Choix automatique de l'aperçu          | `overview: "auto"` (le défaut)                 | L'aperçu le plus adapté à la largeur de fenêtre courante ; `512` en environnement sans fenêtre                                          | `cog-api.ts` → `resolveViewportWidth` ; `cog-loader.ts` → `selectOverview` |
| CG-05 | Aperçu forcé                           | `overview: <n>`                                | L'index demandé, **borné** au nombre d'images du fichier                                                                                | `cog-loader.ts` → `loadViewportRasters`                                    |
| CG-06 | **Garde de volume**                    | Estimation dépassant `maxBytes`                | `RangeError` nommant les deux valeurs **et** la sortie de secours (aperçu plus haut, ou limite relevée)                                 | `cog-loader.ts` → `loadViewportRasters`                                    |
| CG-07 | Décodage monobande en niveaux de gris  | Fichier à une bande                            | Canal unique répliqué sur les trois composantes                                                                                         | `cog-renderer.ts` → `rastersToCanvas`                                      |
| CG-08 | Décodage RVB et RVBA                   | Fichier à trois ou quatre bandes               | Composantes reprises telles quelles, alpha à l'opaque ou repris du fichier                                                              | `cog-renderer.ts`                                                          |
| CG-09 | Sélection de bandes (fausses couleurs) | `bands: [4, 3, 2]` (indices **à partir de 1**) | Les bandes choisies sont mappées sur rouge, vert, bleu                                                                                  | `cog-renderer.ts` → résolution des indices                                 |
| CG-10 | Palette pour une bande unique          | `colorMap` de 256 entrées                      | La valeur normalisée sert d'index dans la palette ; **repli** en niveaux de gris si l'entrée manque                                     | `cog-renderer.ts` → `writePixelsToImageData`                               |
| CG-11 | Transparence des pixels sans donnée    | Valeur du fichier, ou `nodata` explicite       | Ces pixels restent **entièrement transparents** — jamais peints                                                                         | `cog-renderer.ts`                                                          |
| CG-12 | Normalisation des valeurs              | Bandes en entier 16 bits ou flottant           | Ramenées sur l'intervalle 8 bits par min/max mesuré sur la bande                                                                        | `cog-renderer.ts`                                                          |
| CG-13 | Canevas hors écran quand disponible    | Environnement moderne                          | Décodage sur `OffscreenCanvas` ; **repli** sur un canevas de document sinon                                                             | `cog-renderer.ts`                                                          |
| CG-14 | Injection dans MapLibre                | Canevas prêt                                   | Une **source image** plus une **couche raster**, à l'emprise du fichier, à l'opacité demandée                                           | `cog-renderer.ts` → `injectImageSource`                                    |
| CG-15 | Identifiant de couche                  | `id` absent                                    | Identifiant unique dérivé de l'horodatage et d'un compteur interne                                                                      | `cog-api.ts` → `generateLayerId`                                           |
| CG-16 | Mise à jour à chaud                    | `handle.update({ opacity: 0.5 })`              | La couche est retirée puis re-rendue — **sans re-télécharger les en-têtes**, les métadonnées sont mémorisées                            | `cog-api.ts` → `addLayer`                                                  |
| CG-17 | Retrait                                | `handle.remove()` ou `removeLayer(map, id)`    | Couche **et** source retirées                                                                                                           | `cog-renderer.ts` → `removeImageSource`                                    |
| CG-18 | Annulation                             | `signal` d'un contrôleur d'abandon             | Les requêtes en vol sont interrompues                                                                                                   | `cog-loader.ts` → `openCog`                                                |

Les tests qui couvrent ces lignes : `packages/plugins/cog/src/__tests__/` — emplacement imposé par
le contrat (PC-09).

---

## Configuration

**Le plugin n'a aucune configuration de profil.** Aucun bloc `modules.cog`, aucune lecture de
`GeoLeaf.Config`, aucun gate. Vérifiable : `grep -rn "Config" packages/plugins/cog/src/` ne rend
rien.

Ce n'est pas un manque — c'est la conséquence de sa nature. Le contrat (§5) prévoit qu'un plugin
qui a une configuration la place sous `modules.<id>`, mais rien n'oblige un plugin **impératif** à
en avoir : `cog` n'agit que lorsque l'intégrateur l'appelle, avec les options passées à l'appel.
Il n'y a donc rien à décider avant que la carte existe.

Toutes ses options sont des **options d'appel**, documentées dans le contrat exposé ci-dessous.

⚠️ **Conséquence pratique** : rien ne peut « désactiver » ce plugin par configuration. Ne pas le
charger est le seul moyen de ne pas l'avoir — ce qui est cohérent avec un plugin publié séparément.

---

## Contrat exposé

### API publique — `GeoLeaf.COG`

Montée par `entry.ts`, construite par `public-api.ts`, qui est une **pure ré-exportation** de
`cog-api.ts` (INV-FACADE — la façade ne porte aucune logique, et elle a été vidée pour cela : elle
tenait auparavant le compteur de couches, la sonde de fenêtre et tout le pipeline).

| Membre                      | Rend / fait                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| `addLayer(url, map, opts?)` | Charge, décode, injecte. Rend une **poignée** — c'est le seul chemin d'entrée |
| `removeLayer(map, layerId)` | Retire couche et source par identifiant                                       |
| `getInfo(url, opts?)`       | Métadonnées seules, aucun pixel                                               |

La poignée rendue porte `id`, `remove()` et `update(opts)`.

### Options d'appel

| Option     | Effet                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `id`       | Identifiant de couche et de source ; auto-généré s'il est absent                       |
| `opacity`  | Opacité de la couche raster                                                            |
| `overview` | `"auto"` (défaut) ou un index d'aperçu — `0` étant la pleine résolution                |
| `bands`    | Trois indices pour du RVB, un seul pour une bande unique — **numérotés à partir de 1** |
| `colorMap` | Palette de 256 entrées RVBA, appliquée **seulement** en bande unique                   |
| `nodata`   | Force la valeur de transparence, par-dessus celle du fichier                           |
| `signal`   | Signal d'abandon                                                                       |
| `maxBytes` | Plafond de la garde de volume (CG-06)                                                  |

Les types correspondants sont **ré-exportés depuis `entry.ts`** — `CogInfo`, `CogLayerHandle`,
`CogLayerOptions`, `CogLoadOptions`, `CogRasterData` —, donc utilisables par un consommateur typé
sans importer un chemin interne.

### Événements et i18n

**Aucun** événement émis, **aucun** écouté, **aucun** dictionnaire i18n. Le plugin n'a pas
d'interface : il n'a rien à annoncer ni à traduire.

⚠️ Un événement le concerne malgré tout, mais il ne vient pas de lui : le core émet
`geoleaf:plugin:loaded` **après** l'appel d'enregistrement, et la liste des plugins chargés se lit
par `GeoLeaf.plugins.getLoadedPlugins()`.

---

## Décisions de conception

| Décision                                                                | Pourquoi                                                                                                                                                                        | Alternative écartée                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Plugin séparé, pas une capacité in-core**                             | Il porte une dépendance de décodage TIFF que 100 % des bundles paieraient pour un format que peu de déploiements servent. Un plugin publié se charge quand on en a besoin       | Une capacité in-core — le poids serait dans toutes les entrées                  |
| **Une image statique, pas un rendu tuilé**                              | Le tuilage dynamique demande un service serveur ; l'intérêt du COG est justement de s'en passer. L'image statique couvre le cas « fond de référence » sans infrastructure       | Réimplémenter un tuileur côté navigateur                                        |
| **Garde de volume plutôt qu'un chargement paresseux du fichier entier** | Un aperçu mal préparé peut représenter un volume qui épuiserait la mémoire de l'onglet. Échouer avec un message qui **nomme la sortie de secours** vaut mieux qu'un onglet figé | Charger sans plafond                                                            |
| **Estimation pessimiste du volume** (4 octets par échantillon)          | La taille réelle dépend du type de données du fichier ; surestimer fait échouer tôt plutôt que pendant le décodage                                                              | Lire le type puis estimer — un aller-retour de plus pour un plafond de sécurité |
| **Choix d'aperçu sur la largeur de fenêtre**                            | Décoder plus de pixels que l'écran n'en affiche est du travail perdu, et c'est le principal levier de coût de ce plugin                                                         | Toujours la pleine résolution                                                   |
| **Métadonnées mémorisées pour la mise à jour**                          | Changer une opacité ou une palette ne change pas le fichier : re-télécharger ses en-têtes serait un aller-retour réseau gratuit                                                 | Re-lire à chaque mise à jour                                                    |
| **Deux chemins d'extraction du code EPSG**                              | La bibliothèque de lecture a changé de représentation entre deux versions majeures ; l'ancien chemin sert encore les doublures de test. Aucun des deux ne jette                 | N'en garder qu'un — casserait soit les fichiers réels, soit les tests           |
| **Canevas hors écran quand il existe**                                  | Décoder un gros raster sur le canevas du document bloque le fil principal. Le repli reste correct, simplement moins fluide                                                      | Exiger le canevas hors écran — exclurait des navigateurs encore en service      |
| **Indices de bandes numérotés à partir de 1**                           | C'est la convention du domaine géospatial (GDAL, QGIS) ; l'intégrateur lit son fichier avec ces outils                                                                          | Compter à partir de 0, comme le tableau interne                                 |
| **Pixels sans donnée laissés transparents**                             | Le tampon de pixels est créé à zéro : ne rien écrire **est** la transparence. C'est plus sûr que de peindre puis d'effacer                                                      | Peindre une couleur de fond                                                     |
| **La façade a été vidée de sa logique**                                 | `public-api.ts` **était** l'implémentation, ce que le contrat interdit (INV-FACADE) : une façade doit pouvoir être lue en dix secondes pour savoir ce qui est public            | Laisser le pipeline dans la façade                                              |
| **Enregistrement immédiat, pas paresseux**                              | Le plugin n'a pas d'action de barre d'outils à attendre ; son API doit être là dès son chargement                                                                               | `registerLazy` — n'aurait rien à déclencher                                     |

---

## Dépendances et frontières

### Conformité au contrat gelé

Le plugin est vérifié par `scripts/verify-plugin-contract.cjs`, câblé **en mode bloquant** dans
`ci:local` **et** dans `.husky/pre-commit` (`--fail`).

⚠️ **Deux « 13 » se ressemblent et ne désignent pas la même chose.** Le §2.4 de la roadmap écrit
« PC-01…PC-13, 13/13 conformes » ; mesuré, ce sont **deux faits distincts** qui coïncident :

| Ce qu'on croit lire | Ce que la gate mesure                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 13 contrôles        | **Il n'y a pas de PC-06** — les contrôles sont PC-01…PC-05 et PC-07…PC-13, plus PC-04-WIDE |
| 13 conformes        | **13 plugins** conformes — c'est le nombre de plugins publiés                              |

Les contrôles qui portent sur cette fiche : PC-01 (`entry.ts` existe), PC-02 et PC-03
(l'enregistrement et la complétude de son manifeste), PC-11 (le jeton de version), PC-05
(`package.json`), PC-12 (nom et format du bundle produit), PC-08 (taille de fichier), PC-09
(emplacement des tests). PC-13 et PC-07 ne le concernent pas : **il n'a ni CSS ni écriture de HTML**.

### Dépendances

| Dépendance                   | Nature                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@geoleaf/core`              | Dépendance d'espace de travail — le plugin se charge **après** le core et **avant** `GeoLeaf.boot()`  |
| Bibliothèque de lecture TIFF | La seule dépendance de production tierce — c'est elle qui justifie le plugin séparé                   |
| `@geoleaf/host-runtime`      | ⚠️ Déclarée en **dépendance de développement** ici, et utilisée **en type seulement** dans `entry.ts` |

⚠️ **`cog` ne consomme `host-runtime` qu'au niveau des types** (`GeoLeafHost`), là où les plugins
plus récents en importent la fonction d'accès (`getGeoLeaf()`) et écrivent
`globalThis as { GeoLeaf?: … }` à la main comme le fait ce plugin. Les deux formes coexistent : ce
n'est pas une non-conformité — aucun contrôle du contrat ne l'exige — mais c'est un écart de
génération, et la forme récente est celle de `geocoding`.

**Aucune dépendance sur MapLibre** : le plugin reçoit la carte en argument et n'en consomme qu'une
vue **structurelle** locale (`types.ts` → `MapLike` : six méthodes). PC-10 ne s'applique donc pas —
il n'y a rien à déclarer en dépendance de pair.

### Frontières

- **Aucun accès au namespace au-delà du montage.** Le plugin écrit `GeoLeaf.COG` et
  s'enregistre ; il ne lit ni la configuration, ni l'état des couches, ni aucun seam.
- **Aucune CSS**, aucune écriture de HTML : rien à assainir, rien à purger.
- **Aucun couplage à un autre plugin** — `requires` et `optional` sont vides, et c'est vrai au sens
  fort : il n'y a aucune lecture d'un namespace de plugin.
- La couche produite est une couche MapLibre ordinaire : elle **hérite** de l'opacité, de l'ordre
  et de la visibilité comme n'importe quelle autre. Le plugin n'a pas à les gérer.

---

## Écarts au CDC source

Le CDC `CDC_plugin-cog.md` (v1.2.0, 16/06/2026) a été **consommé** en écrivant cette fiche, puis
retiré du dossier de tri — trace au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                                                                                  | Ce que dit le dépôt                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| « le plugin est **lazy-loadé** »                                                                                               | **Faux** : `entry.ts` appelle `plugins.register`, pas `registerLazy`. L'enregistrement est immédiat |
| « même modèle que **`plugin-storage`** »                                                                                       | Ce paquet s'appelle **`offline-ui`** depuis la restructuration                                      |
| « `geotiff.js` ajoute **~30 KB gzip** », « moins de 5 % en ont besoin »                                                        | Chiffres mesurables ou estimés recopiés en prose — non repris, par la règle 1                       |
| « **Node.js ≥ 18** »                                                                                                           | Le dépôt exige **≥ 22** (`CLAUDE.md`, `.nvmrc`)                                                     |
| ✅ Les **limites** du §1.14 (pas de streaming, pas de reprojection, image statique, TIFF non géoréférencé, canevas hors écran) | **Toutes exactes**, et reprises au §Périmètre — c'est la partie la plus utile du CDC                |
| ✅ Le tableau des contraintes techniques du §2.15                                                                              | Exact hormis la version de Node ci-dessus                                                           |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : le positionnement (le COG est un
standard de l'industrie géospatiale lisible par morceaux via HTTP, ce qui le rend utilisable sur le
web même pour de très gros fichiers), l'audience visée, ce que voit l'utilisateur final — dont la
pixelisation au zoom, qui est la conséquence directe de l'image statique —, et les alternatives
écartées de la table §Décisions.
