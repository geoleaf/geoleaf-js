---
type: spec-capacite
title: vector-tiles — les couches métier en tuiles vectorielles MVT
capability_id: vector-tiles
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# vector-tiles — les couches métier en tuiles vectorielles MVT

**Type :** capacité in-core (**de politique**) · **Code :** `packages/core/src/capabilities/vector-tiles/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Trois règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.
> 3. **Un chemin cité sans racine se lit depuis le répertoire annoncé par « Code : » ci-dessus**,
>    ou depuis son `src/`, et à défaut depuis `packages/core/src/`. Un chemin qui commence par
>    `packages/`, `scripts/`, `profiles/`, `docs/`, `apps/` ou `e2e/` est relatif à la **racine du
>    dépôt**. Les cas qui échappent aux deux sont racinés sur place.

> ⚠️ **Cette capacité ne suit pas le patron des autres.** Elle n'a **ni `config.ts`, ni
> `lifecycle.ts`, ni `module.ts`, ni `public-api.ts`, ni façade ESM, ni `gate`, ni `configSchema`**.
> Aucune de ces absences n'est un oubli : chacune a un motif, écrit dans le code et repris ici. La
> section §Le patron absent les rassemble — c'est la section à lire en premier si l'on vient d'une
> autre fiche.

---

## Périmètre

### Ce que la capacité fait

Elle rend une **couche métier** en **tuiles vectorielles MVT** (Mapbox Vector Tile) au lieu de la
charger en GeoJSON : quand une définition de couche porte une URL de tuiles **absolue**, le
chargeur GeoJSON lui passe la main, et elle installe une source MapLibre native de type `vector`
plus ses sous-couches de rendu.

C'est ce qui rend affichable un jeu de plusieurs dizaines de milliers d'entités : le navigateur ne
récupère que les tuiles dans le champ de vue, au niveau de généralisation du zoom courant.

### Ce qu'elle ne fait pas

- ⚠️ **Elle ne rend pas les FONDS de carte vectoriels.** Plusieurs profils pointent leur
  `basemaps.json` vers un style MapLibre (par exemple une couche IGN dont l'URL contient
  `vectorTiles`) : ces fonds sont rendus nativement par MapLibre à travers le module
  _baselayers_ et **ne touchent jamais ce code**. C'est la confusion la plus probable sur cette
  capacité.
- **Elle ne construit rien côté MapLibre.** Depuis le socle B.1, la construction moteur vit dans
  `adapters/maplibre/maplibre-vector-tiles.ts` ; la capacité résout et délègue à
  `IMapAdapter.addVectorTileLayer` / `updateVectorTileLayerStyle`.
- **Elle ne s'active pas globalement.** Il n'y a pas de `modules.vectorTiles.enabled` — voir
  §Configuration.
- **Elle ne génère pas les tuiles.** Produire les `.pbf` est une tâche de préparation de données,
  hors du core.
- **Elle n'est pas obligatoire.** Ses deux consommateurs retombent sur le chemin GeoJSON en son
  absence, sans configuration particulière.

---

## Le patron absent, et le motif de chaque absence

| Fichier du patron         | Présent ? | Motif                                                                                                                                                                                                                               |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install.ts`              | ✅        | Ancre unique — l'importer est la seule chose qu'un preset fait pour embarquer la capacité                                                                                                                                           |
| `<id>-capability.ts`      | ✅        | La déclaration, sans `gate` ni `configSchema`                                                                                                                                                                                       |
| `config.ts`               | ❌        | La configuration est **par couche** (`data.vectorTiles`), pas app-globale : il n'y a pas de bloc `modules.*` à lire. Motif inscrit dans `__tests__/capabilities/scaffold-taxonomy.test.js` → `NO_CONFIG_ACCESSOR`                   |
| `module.ts`               | ❌        | Capacité **de politique** (_pull-based_), comme `cluster` : elle ne possède aucun cycle de vie `ICoreModule` et ne branche aucun écouteur. Le chargeur l'interroge à la demande                                                     |
| `lifecycle.ts`            | ❌        | Corollaire : rien à monter, rien à démonter                                                                                                                                                                                         |
| `public-api.ts`           | ❌        | Sa surface est **interne** : le seam `GeoLeaf._VectorTiles`, pas une API d'intégrateur                                                                                                                                              |
| Façade `api/geoleaf.*.ts` | ❌        | Corollaire du précédent, et `bundle-esm-entry.ts` le dit sur place                                                                                                                                                                  |
| `gate`                    | ❌        | Le contrat l'autorise (`contracts/capability.contract.ts` : _« No `gate` → always enabled »_). Inventer `modules.vectorTiles.enabled` ajouterait un paramètre public qui ne garde rien que la configuration de couche ne garde déjà |
| `configSchema`            | ❌        | Ses clés devraient correspondre à des champs sous un chemin de configuration de capacité, et cette capacité n'en a aucun. La source de vérité est le schéma **de couche**                                                           |

### Pourquoi c'est une capacité, alors

Avant le S5, elle était importée **statiquement** par `globals/globals.geojson.ts` — un module
kernel — ce qui l'épinglait dans la clôture eager de **tous** les bundles, y compris celui d'un
consommateur qui ne servira jamais une tuile. La reclasser en capacité a coupé cette arête ; le
socle B.1 a ensuite sorti la construction MapLibre vers l'adaptateur, réduisant encore
l'orchestrateur.

Elle est atteinte par exactement **deux** sites, qui retombaient **déjà** sur un autre chemin en
son absence — ce n'est pas un repli ajouté pour l'occasion, c'est le trajet que prend tout profil
livré aujourd'hui.

---

## Fonctionnalités

| ID    | Fonctionnalité                                | Entrée                                                               | Sortie observable                                                                                                                | Code                                                           |
| ----- | --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| VT-01 | Décision « cette couche passe en MVT »        | Définition de couche portant `data.vectorTiles.tilesUrl` **absolue** | `shouldUseVectorTiles(def)` rend `true` ; le chargeur sort par cette branche avant OGC API et avant le GeoJSON                   | `vector-tiles.ts` → `shouldUseVectorTiles`                     |
| VT-02 | Refus d'une URL relative                      | `tilesUrl` relative, ou `enabled: false`, ou pas de bloc             | `false` — la couche suit le chemin GeoJSON, **par choix** : un chemin relatif est dérivé et les `.pbf` peuvent ne pas exister    | `vector-tiles.ts` → `shouldUseVectorTiles`                     |
| VT-03 | Lecture du bloc aux deux emplacements         | `def.vectorTiles` **ou** `def.data.vectorTiles`                      | Le premier trouvé gagne (racine avant `data`)                                                                                    | `vector-tiles.ts` → `_getVTConfig`                             |
| VT-04 | Résolution du gabarit d'URL                   | Bloc de configuration résolu                                         | L'URL absolue est renvoyée telle quelle ; sinon un chemin `…/{z}/{x}/{y}.pbf` est dérivé du profil (voir VT-11)                  | `vector-tiles.ts` → `_resolveTileUrl`                          |
| VT-05 | Chargement du style par défaut                | `def.styles.default` déclaré                                         | Style chargé via `_GeoJSONLayerConfig.loadDefaultStyle` ; un échec est **journalisé et absorbé**, la couche se charge quand même | `vector-tiles.ts` → `_loadVtStyle`                             |
| VT-06 | Installation de la source et des sous-couches | Spécification résolue                                                | L'adaptateur crée **une** source `vector` et jusqu'à **trois** couches de rendu (remplissage / ligne / cercle)                   | `vector-tiles.ts` → `_buildVtSpec` puis `addVectorTileLayer`   |
| VT-07 | Liaison des interactions                      | `interactive` différent de `false`                                   | Infobulles et popups branchées par le lieur GeoJSON partagé, sur les sous-couches créées                                         | `vector-tiles.ts` → `bindFeatureInteractionEvents`             |
| VT-08 | Enregistrement dans l'état partagé            | Couche chargée                                                       | Une entrée portant `isVectorTile: true` dans `GeoJSONShared.state.layers`                                                        | `vector-tiles-layer-data.ts` → `buildVtLayerData`              |
| VT-09 | Recalcul de visibilité par zoom               | Couche chargée                                                       | `_GeoJSONLayerManager.updateLayerVisibilityByZoom()` est appelé s'il est monté                                                   | `vector-tiles.ts` → `loadVectorTileLayer`                      |
| VT-10 | Restylage à chaud                             | `setLayerStyle` sur une couche MVT                                   | Le style est appliqué aux sous-couches via `updateVectorTileLayerStyle` ; **inerte** si la couche n'est pas MVT                  | `vector-tiles.ts` → `updateLayerStyle`                         |
| VT-11 | Repli « répertoire de tuiles »                | Aucune URL absolue                                                   | Chemin dérivé `<basePath>/<profil>/<répertoire de couche>/<tilesDirectory>/{z}/{x}/{y}.pbf` — **inatteignable en production**    | `vector-tiles.ts` → `_resolveTileUrl`, voir §Décisions         |
| VT-12 | Échecs francs                                 | Pas de bloc, URL irrésolue, adaptateur sans support MVT              | Une exception explicite, préfixée `[VectorTiles]` — la couche échoue, pas la carte                                               | `vector-tiles.ts` → `loadVectorTileLayer`, `_resolveVtAdapter` |
| VT-13 | Seam additif et idempotent                    | `registerGlobals(gl)` appelé une ou plusieurs fois                   | `GeoLeaf._VectorTiles` posé, sans écraser le reste du namespace                                                                  | `install.ts`                                                   |

Les tests qui couvrent ces lignes sont **répartis**, contrairement aux autres capacités :
`__tests__/capabilities/vector-tiles/install.test.js` pour l'installeur (dont les assertions
« aucun gate », « aucun `createModule` », « aucun `sharedLifecycle` » — les absences sont
_testées_, pas seulement documentées), puis `__tests__/geojson/vector-tiles.test.js` et
`__tests__/config/s13-layer-data.test.js` pour la résolution et l'assemblage.

---

## Configuration

### Il n'y a pas de bloc de capacité

Cette capacité **ne déclare aucun paramètre sous `modules.*`**. Son activation est décidée
**couche par couche**, ce qui est la forme honnête : `shouldUseVectorTiles()` lit
`data.vectorTiles` de la définition de couche, une famille de configuration existante et
inventoriée (famille B5 de
[`inventaire_config_parametres.md`](../../reference/inventaire_config_parametres.md)).

C'est cette absence que la gate documentaire enregistre nommément —
`__tests__/guards/doc-capability-config.guard.test.js` → `NO_CAPABILITY_CONFIG`.

### La vraie source de vérité — `profiles/schemas/layer-config.schema.json`

Bloc `data.vectorTiles` d'une définition de couche. Le schéma est en
`additionalProperties: false` : ce qui n'y figure pas est **rejeté** par
`node scripts/validate-profiles.cjs`.

| Clé              | Type               | Rôle                                                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `enabled`        | `boolean`          | `false` désarme la couche — elle repasse en GeoJSON                                        |
| `tilesUrl`       | `string`           | Gabarit `{z}/{x}/{y}` ou fichier `.pmtiles`. **Doit être absolu** pour que VT-01 déclenche |
| `tilesDirectory` | `string`           | Répertoire de tuiles pour le chemin dérivé (VT-11), défaut `"tiles"` dans le code          |
| `layerName`      | `string`           | Nom de la _source-layer_ dans le MVT ; repli sur l'`id` de la couche                       |
| `minZoom`        | `number`           | Zoom minimal — porté à la fois sur la source et sur les sous-couches                       |
| `maxZoom`        | `number`           | Zoom maximal des sous-couches                                                              |
| `maxNativeZoom`  | `number`           | Zoom natif maximal servi par la source (`maxzoom` MapLibre)                                |
| `interactive`    | `boolean`          | `false` : ni popup ni infobulle branchée                                                   |
| `scheme`         | `"xyz"` \| `"tms"` | Grille de tuiles — `"tms"` (y vers le haut, par exemple la Géoplateforme IGN)              |

### ⚠️ Deux clés que le code lit et que le schéma refuse

Mesuré sur `profiles/schemas/layer-config.schema.json` au SHA de vérification :

| Clé lue par le code                        | Statut dans le schéma                                                       | Conséquence                                                                                                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.vectorTiles.bounds` (`number[]`)     | **Absente**, et le bloc est `additionalProperties: false`                   | `_buildVtSpec` la transmet à l'adaptateur, mais un profil qui la déclare est **rejeté** par le validateur : le chemin est inatteignable depuis un profil valide |
| `vectorTiles` **à la racine** d'une couche | **Absente** de la racine du schéma, elle-même `additionalProperties: false` | `_getVTConfig` la cherche en premier, mais aucun profil valide ne peut la porter                                                                                |

Ce n'est **pas** couvert par `scripts/check-config-coverage.cjs` : cette gate est bidirectionnelle entre
les **schémas** et l'**inventaire**, pas entre le **code** et les schémas. Écart consigné ici et
versé au registre de dette technique du dépôt de travail. Il n'est **pas** corrigé
dans cette passe : trancher demande de décider si l'on élargit le schéma (les deux formes
deviennent utilisables) ou si l'on resserre le code (les deux lectures tombent), et c'est une
décision de contrat de profil.

---

## Contrat exposé

### Aucune API publique, un seam interne

`install.ts` → `registerGlobals(gl)` pose `gl._VectorTiles = VectorTiles`. Le préfixe `_` est la
convention du dépôt pour une surface **interne** : pas de façade ESM, pas d'entrée dans la surface
d'intégrateur. `bundle-esm-entry.ts` l'énonce sur place.

Typage publié : `src/global.d.ts`, entrée `_VectorTiles?`. Son en-tête consigne un défaut réparé au
passage — **deux** modules kernel écrivaient chacun leur propre type structurel étroit, et les deux
étaient **disjoints**. Ne pas citer de numéro de ligne pour ce fichier.

`_VectorTiles` figure aussi dans le catalogue de modules (`kernel/api/module-catalog.ts`), qui est
ce que l'introspection énumère.

### Les deux consommateurs, et leur repli

| Site                                    | Lecture                                                                                                 | Repli en l'absence de la capacité                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `kernel/geojson/loader/single-layer.ts` | Par le localisateur de service `_loaderDeps.getVectorTiles()` (câblé dans `globals/globals.geojson.ts`) | Sortie ignorée → OGC API, worker, ou GeoJSON simple                                        |
| `kernel/geojson/layers/style.ts`        | Directement sur `GeoLeaf._VectorTiles`                                                                  | `adapter.setLayerStyle` — et **doublement sûr** : seule cette capacité pose `isVectorTile` |

La lecture est **paresseuse** dans les deux cas : le seam est relu à l'appel, donc l'ordre d'écriture
par rapport à l'initialisation du noyau GeoJSON est indifférent.

### Événements

**Aucun** émis, **aucun** écouté directement. Les interactions d'entité (popup, infobulle) sont
branchées par le lieur GeoJSON partagé, qui appartient au kernel : les événements observés sur une
couche MVT sont donc ceux du chemin GeoJSON, pas des événements propres à cette capacité.

---

## Décisions de conception

| Décision                                                              | Pourquoi                                                                                                                                                                                                                                                                  | Alternative écartée                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Capacité de politique**, sans `ICoreModule`                         | Elle est interrogée à la demande par le chargeur ; rien à initialiser, rien à détruire, aucun écouteur. Le registre de modules reste inchangé (un test l'affirme)                                                                                                         | Un module de cycle de vie — aurait ajouté un nœud au tri topologique pour du code qui n'a pas d'état de montage                                                          |
| **Aucun `gate`**                                                      | Le contrat autorise l'absence de gate (« toujours activée »), et l'activation réelle se décide par couche. Un `modules.vectorTiles.enabled` serait un paramètre public qui ne garde rien de plus                                                                          | Un gate global — ferait croire à un interrupteur qui ne commande pas ce qu'il semble commander                                                                           |
| **Déclenchement sur URL ABSOLUE seulement**                           | Un chemin relatif est **dérivé** de la structure du profil : les `.pbf` correspondants peuvent ne pas exister. Exiger l'absolu, c'est exiger un engagement explicite de l'auteur du profil                                                                                | Déclencher dès que `enabled: true` — c'est précisément ce qui a produit six couches d'un profil annonçant des tuiles inexistantes, **désarmées depuis dans les profils** |
| **Le repli « répertoire de tuiles » (VT-11) est conservé, pas purgé** | Il est couvert par de nombreuses assertions dans deux fichiers de test, dont plusieurs visent le chemin dérivé lui-même ; et il redevient vivant dès qu'on relâche la garde d'URL absolue — ce que « armer » les tuiles d'un profil voudrait dire                         | Le supprimer comme code mort (R.33) — aurait effacé un comportement testé pour corriger ce qui était en réalité un problème de données                                   |
| **Aucun import de `adapters/maplibre/`**                              | La frontière moteur est à sens unique : un moteur autre que MapLibre ne doit demander de toucher que l'adaptateur, pas les capacités. Une règle ESLint l'interdit à tout `capabilities/**`                                                                                | Construire les couches ici — c'était l'état avant le socle B.1                                                                                                           |
| **`getNativeMap()` + lieur partagé** pour les interactions            | Passer par l'interface et par un utilitaire kernel n'est **pas** un import moteur : le patron est exactement celui du chargeur GeoJSON, ce qui garde un seul comportement d'interaction pour les deux chemins                                                             | Réimplémenter la liaison ici — deux comportements à maintenir en phase                                                                                                   |
| **Échec du style absorbé, échec de l'adaptateur fatal**               | Un style par défaut manquant dégrade l'apparence ; un adaptateur sans support MVT rendrait une couche silencieusement vide. Le premier se journalise, le second lève                                                                                                      | Traiter les deux pareil                                                                                                                                                  |
| **Surface interne (`_VectorTiles`), pas d'API publique**              | Un intégrateur n'a rien à piloter : il déclare `data.vectorTiles` sur sa couche et le chargeur fait le reste. Publier une surface créerait un second chemin d'activation                                                                                                  | `GeoLeaf.VectorTiles` avec une façade                                                                                                                                    |
| **Découpage en trois fichiers**                                       | `types.ts` et `vector-tiles-layer-data.ts` ont d'abord été extraits pour tenir la limite de taille de fichier ; depuis le socle B.1 l'orchestrateur est largement en dessous, et la séparation tient sur son propre mérite — une frontière de types, et un assembleur pur | Refusionner — reperdrait un assembleur sans effet de bord, aisément testable                                                                                             |

---

## Dépendances et frontières

### Aucune dépendance de cycle de vie

Pas de `module.ts`, donc aucune arête dans le tri topologique. Sa position dans
`presets/manifest.full.ts` est **libre** — le manifeste le dit sur place : elle ne possède ni module
ni icône de barre d'outils mobile, donc l'appendre à la fin laisse tous les index d'enregistrement
antérieurs intacts, ce qui compte parce que l'ordre d'insertion est observable par introspection.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

| Import                                              | Statut vis-à-vis de R.8                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `kernel/geojson/index.js`                           | **Baril** — conforme                             |
| `kernel/geojson/core-types.js` (type seul)          | **Hub de types** — exception nommée par la règle |
| `kernel/geojson/loader/loader-types.js` (type seul) | **Hub de types** — exception nommée par la règle |

`bindFeatureInteractionEvents` et `GeoJSONShared` sont donc consommés **par le baril**, pas en
import profond. Si un symbole manque sur le baril, l'élargir est le geste que la règle désigne.

### Frontière moteur

`contracts/map-adapter.contract.ts` — `VectorTileLayerSpec`, et les méthodes
`addVectorTileLayer` / `updateVectorTileLayerStyle` / `getNativeMap`. **Aucun import de
`adapters/maplibre/`** : une règle ESLint l'interdit à tout `capabilities/**`, et cette capacité est
celle qui a motivé le déplacement de la construction moteur vers l'adaptateur (socle B.1).

### Accès au namespace global

La capacité lit `GeoLeaf.Config`, `GeoLeaf.Core`, `GeoLeaf._GeoJSONLayerConfig` et
`GeoLeaf._GeoJSONLayerManager` via `getGeoLeaf()`, en accès **défensif** et **typé structurellement**
(`types.ts` → `LayerConfigModuleLike`, `LayerManagerModuleLike`). Deux de ces membres reposent
encore sur la traîne `unknown` du namespace — gisement suivi par
`scripts/check-namespace-typing-coverage.cjs` et le backlog **B-13** ; le typage progresse par
membre, et **ne s'élargit jamais en arrière vers `any`**.

**Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`.
