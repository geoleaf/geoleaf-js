---
type: spec-capacite
title: route — la décoration des extrémités d'un itinéraire
capability_id: route
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 5535694b
date: 27 juillet 2026
---

# route — la décoration des extrémités d'un itinéraire

**Type :** capacité in-core (**de surcouche**) · **Code :** `packages/core/src/capabilities/route/` ·
**Vérifié contre :** `5535694b` (27/07/2026)

> **Deux règles, héritées de [`CDC_kernel.md`](../CDC_kernel.md).**
>
> 1. **Aucun chiffre mesurable n'est recopié ici** — la commande qui l'imprime est citée à sa place.
> 2. **Aucune duplication d'un généré** — l'inventaire par fichier est dans
>    [`ARBORESCENCE_QUALIFIEE.md`](../../reference/ARBORESCENCE_QUALIFIEE.md), générée et gatée.

> ⚠️ **Cette capacité n'a ni `public-api.ts` ni façade ESM, et son `registerGlobals` est vide** —
> une quatrième forme, après le patron canonique, la capacité de politique et l'atypique
> [`vector-tiles`](vector-tiles.md). Le contrat exige la méthode, pas une écriture : la façade
> impérative `GeoLeaf.Route` a été **dissoute**, et c'est une décision, pas un manque. Voir
> §Contrat exposé.

---

## Périmètre

### Ce que la capacité fait

Sur une couche de **polylignes désignée**, elle dérive automatiquement un **marqueur de départ** et
un **marqueur d'arrivée** stylables, et les rend dans une sous-couche de points dédiée. C'est la
seule valeur que n'apportent ni le moteur GeoJSON — qui rend le tracé — ni le plugin
`file-import` — qui lit les GPX / KML.

### Ce qu'elle ne fait pas

- **Elle ne rend pas le tracé.** La ligne est rendue par le moteur GeoJSON, avec le style de couche
  ordinaire. Cette capacité ne fait qu'y **ajouter** des extrémités : aucun pipeline de rendu
  parallèle.
- **Elle ne possède aucune donnée.** Elle lit les entités de la couche par un seam générique et en
  dérive des points ; rien n'est stocké.
- **Elle ne décore pas tout.** Une couche doit être **désignée nommément** dans
  `modules.route.layers`, sinon rien ne se passe — même capacité activée.
- **Elle ne lit aucun fichier.** GPX, KML, KMZ relèvent de `@geoleaf-plugins/file-import`.
- **Elle n'agrège pas un itinéraire multi-segments** et ne pose pas d'étapes intermédiaires : les
  extrémités sont dérivées **par entité**.
- **Ses extrémités ne sont pas interactives** : ni popup ni infobulle. Le seam d'interaction du
  moteur GeoJSON existe et pourrait être réutilisé, mais ce n'est pas fait.

---

## Fonctionnalités

| ID    | Fonctionnalité                                   | Entrée                                                         | Sortie observable                                                                                                       | Code                                                          |
| ----- | ------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| RT-01 | Décoration à l'ajout d'une couche                | `geoleaf:layer:added` sur une couche **désignée** et **ligne** | Une sous-couche `gl-route-<id>-endpoints` ajoutée par l'adaptateur                                                      | `lifecycle.ts` → `onLayerAdded` ; `apply.ts` → `applyToLayer` |
| RT-02 | **Report en micro-tâche**                        | idem                                                           | La dérivation attend que les entités soient dans le seam — l'événement part **pendant** la construction de la couche    | `lifecycle.ts` → `queueMicrotask`                             |
| RT-03 | Balayage des couches déjà présentes              | `geoleaf:map:ready`                                            | Toute couche déjà enregistrée, désignée et ligne, reçoit ses extrémités                                                 | `lifecycle.ts` → `sweep`                                      |
| RT-04 | Extrémités d'une `LineString`                    | Entité ligne                                                   | Départ = **premier** sommet, arrivée = **dernier**                                                                      | `endpoint-deriver.ts` → `firstLastPositions`                  |
| RT-05 | Extrémités d'une `MultiLineString`               | Entité multi-segments                                          | Départ = premier point du **premier segment non vide**, arrivée = dernier point du **dernier segment non vide**         | `endpoint-deriver.ts` → `firstLastPositions`                  |
| RT-06 | Entités non-lignes ignorées                      | Points, polygones dans la même couche                          | Elles ne contribuent à rien, sans erreur                                                                                | `endpoint-deriver.ts` → `deriveEndpoints`                     |
| RT-07 | Identifiant d'itinéraire reporté                 | Entité portant `id` ou `properties.id`                         | Chaque point dérivé porte `properties.routeId` (et `properties.role`)                                                   | `endpoint-deriver.ts` → `featureRouteId`                      |
| RT-08 | **Une seule sous-couche pour les deux rôles**    | Couche décorée                                                 | Une source, une sous-couche ; départ et arrivée distingués par `properties.role`                                        | `apply.ts` → `endpointsLayerId`, `toEndpointStyleOptions`     |
| RT-09 | Styles distincts par règle pilotée par la donnée | Styles de départ et d'arrivée différents                       | Le style de départ est la base, celui d'arrivée une règle `role == "end"` — **rayon compris**, pas seulement la couleur | `apply.ts` → `toEndpointStyleOptions`                         |
| RT-10 | Masquage d'une extrémité                         | `showStart: false` ou `showEnd: false`                         | L'autre extrémité seule, **toujours dans une sous-couche unique**                                                       | `apply.ts` → `applyToLayer`                                   |
| RT-11 | Rafraîchissement idempotent                      | Nouvelle application sur la même couche                        | La sous-couche précédente est retirée **avant** d'être reconstruite                                                     | `apply.ts` → `clearEndpoints`                                 |
| RT-12 | Aucune sous-couche vide                          | Aucune extrémité dérivée (couche sans ligne exploitable)       | Rien n'est ajouté                                                                                                       | `apply.ts` → `applyToLayer`                                   |
| RT-13 | Couche non désignée ⇒ inerte                     | Couche ligne absente de `layers`                               | Aucune extrémité — la polyligne s'affiche seule                                                                         | `resolver.ts` → `resolveLayerBinding`                         |
| RT-14 | Styles par défaut                                | Désignation sans surcharge                                     | Départ bleu, arrivée orange, les deux affichées                                                                         | `resolver.ts` → `resolveEndpointConfig`                       |
| RT-15 | Dégradation quand la capacité est désactivée     | `modules.route.enabled` absent ou `false`                      | Les écouteurs sont posés mais **ne font rien** — aucune extrémité, aucune erreur                                        | `lifecycle.ts`                                                |
| RT-16 | Démontage complet                                | `RouteModule.destroy()` / `_reset()`                           | Écouteurs détachés **et** sous-couches d'extrémités retirées de **toutes** les couches enregistrées                     | `lifecycle.ts` → `_reset`                                     |
| RT-17 | Déclaration introspectable                       | —                                                              | `getAllCapabilities()` la liste, `getCapabilitySchema("route")` rend son schéma sans `loader`                           | `route-capability.ts`                                         |

Les tests qui couvrent ces lignes : `packages/core/__tests__/capabilities/route/` — dont un test qui
vérifie explicitement que le style d'arrivée passe par **une règle de données et non une seconde
couche**, et un autre que le report en micro-tâche est bien attendu.

---

## Configuration

Bloc `modules.route` d'un profil. Conformité de cette table au code gardée par
`__tests__/guards/doc-capability-config.guard.test.js`.

| Paramètre | Type      | Défaut  | Où c'est lu                                                                                                 |
| --------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `enabled` | `boolean` | `false` | `config.ts` → `getRouteConfig()` ; gate réel appliqué **tardivement** par `lifecycle.ts`                    |
| `layers`  | `object`  | `{}`    | `resolver.ts` → `resolveLayerBinding()`. **Sous-arbre opaque** : les clés sont les ids de couches du profil |

### ⚠️ `layers` — divergence connue entre le défaut annoncé et le défaut appliqué

Le schéma **annonce** `{}`, mais `getRouteConfig()` ne matérialise **que** `enabled` : la clé
`layers` est absente de l'objet rendu. C'est une divergence **connue et mise en quarantaine** —
elle figure dans `KNOWN_DEFAULT_DRIFT` de
`__tests__/capabilities/config-schema-defaults.test.js`, dont l'en-tête explique pourquoi elle est
tolérée : le repli est **observationnellement équivalent** aujourd'hui (`config.layers?.[id] ?? null`,
donc absent ≡ `{}`), mais il est réappliqué à chaque site de lecture au lieu d'être matérialisé une
fois.

La gate documentaire **lit cette quarantaine** dans le fichier qui la possède plutôt que d'en
tenir une copie : le jour où l'entrée en sort, la fiche est immédiatement re-vérifiée contre le
défaut appliqué.

### Sans `layers`, la capacité est inerte même activée

`enabled: true` **seul** ne décore rien : `resolveLayerBinding` rend `null` pour toute couche, donc
aucune extrémité n'est jamais dessinée. C'est écrit dans la description du schéma, et c'est le
piège de configuration principal de cette capacité.

Forme d'une désignation, par identifiant de couche :

| Clé         | Type      | Défaut | Rôle                                                                                               |
| ----------- | --------- | ------ | -------------------------------------------------------------------------------------------------- |
| `start`     | objet     | —      | Surcharge du style du marqueur de départ (`radius`, `color`, `fillColor`, `fillOpacity`, `weight`) |
| `end`       | objet     | —      | Idem pour l'arrivée                                                                                |
| `showStart` | `boolean` | `true` | Afficher le marqueur de départ                                                                     |
| `showEnd`   | `boolean` | `true` | Afficher le marqueur d'arrivée                                                                     |

Les styles par défaut sont dans `resolver.ts` (départ bleu, arrivée orange) et ne sont **pas** dans
le `configSchema` : ce sont des défauts de **rendu**, pas des paramètres de configuration.

### Le double gate, et pourquoi l'inversion est ici obligatoire

C'est la capacité où ce mécanisme est le plus contre-intuitif, et le code l'explique longuement sur
place :

| Étage                                            | Valeur                         | Ce qu'il décide                            |
| ------------------------------------------------ | ------------------------------ | ------------------------------------------ |
| Gate de déclaration (`route-capability.ts`)      | `enableWhenAbsent: **true**`   | L'enregistrement du module, **pré-fusion** |
| Gate tardif (`lifecycle.ts`, à chaque événement) | `config.enabled` sur la fusion | Si quoi que ce soit est décoré             |

⚠️ **Un gate opt-in au boot rendrait la capacité définitivement inerte.** Le gate de boot tourne
sur la configuration **pré-fusion**, avant le chargement des ressources du profil actif : à ce
moment `modules.route.enabled` vaut `undefined`. Un gate opt-in lirait cette valeur, n'enregistrerait
**jamais** le module, et la capacité serait silencieusement morte. C'est un piège de séquencement
documenté, partagé avec `legend`, `filter` et `theme-selector` — et le CDC source note qu'il a été
**découvert au smoke runtime**, pas à la lecture.

Le comportement visible reste donc **opt-in** : pas de désignation, ou `enabled` absent ⇒ aucune
extrémité.

---

## Contrat exposé

### Aucune surface publique — et c'est une décision

`registerGlobals()` est **vide**. Le contrat d'installeur exige la méthode, pas une écriture.

La façade impérative `GeoLeaf.Route` — `loadFromConfig`, `show`, `hide`, `clear`,
`filterVisibility` — a été **dissoute** : la capacité est pilotée **entièrement** par la
configuration `modules.route.*` et par ses écouteurs. Le dynamique passe désormais par le seam
générique `GeoLeaf.Layers.setData(layerId, …)` : la capacité **re-dérive** ses extrémités, de façon
idempotente.

Il n'y a donc **ni `public-api.ts`, ni `src/api/geoleaf.route.ts`**, et `GeoLeaf.Route` est sorti de
l'oracle des clés de façade attendues.

⚠️ **Une seconde chose que cet installeur portait a disparu**, et le CDC source la donnait comme
conservée : la contribution du filtre d'itinéraire. L'installeur poussait `filterRouteList` dans un
seam de `capabilities/filter/` à l'import, pour que `GeoLeaf.Filters.filterRouteList()` fonctionne
dès qu'un preset embarquait `route`. Toute la chaîne est partie avec `GeoLeaf.Filters`, son **seul**
appelant atteignable — voir §Écarts au CDC.

### Ce que la capacité consomme

| Surface                                    | Usage                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `Core.getMap()` (façade `geoleaf.core.ts`) | Obtenir l'adaptateur actif — chemin canonique, jamais un accès direct |
| `Layers.getFeatures(layerId)` (façade)     | Lire les entités de la couche : **la différence clé avec `taxonomy`** |
| `adapter.addGeoJSONLayer` / `removeLayer`  | Rendre et retirer la sous-couche d'extrémités                         |
| `adapter.getLayerRegistry()`               | Énumérer les couches lors du balayage et du démontage                 |

⚠️ **C'est ce qui distingue `route` de `taxonomy`**, dont elle reprend par ailleurs le patron :
`taxonomy` n'applique que du style, `route` a besoin des **coordonnées** pour calculer les
extrémités — d'où la lecture des entités par le seam générique.

### Événements

| Événement             | Sens       | Rôle                                                                        |
| --------------------- | ---------- | --------------------------------------------------------------------------- |
| `geoleaf:layer:added` | **écouté** | Une couche vient d'être construite : `{ layerId, sourceId, geometryTypes }` |
| `geoleaf:map:ready`   | **écouté** | Déclenche le balayage unique des couches déjà présentes                     |

La capacité **n'émet aucun événement**.

⚠️ **Le report en micro-tâche de RT-02 n'est pas une précaution de style.**
`geoleaf:layer:added` est émis par l'adaptateur **pendant** la construction de la couche, donc
**avant** que le chargeur n'ait écrit les entités dans le seam `Layers`. La dérivation lit ces
entités : sans le report, elle lirait une couche vide. Le report a un second effet, voulu — une
couche chargée **après** le boot (changement de thème, activation manuelle) obtient aussi ses
extrémités, et pas seulement celles que le balayage attrape.

---

## Décisions de conception

| Décision                                                       | Pourquoi                                                                                                                                                                              | Alternative écartée                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Capacité de surcouche, sans données propres**                | La ligne est déjà rendue par le moteur GeoJSON. N'ajouter que les extrémités évite un second pipeline de rendu — le défaut exact de l'ancien module `route` et de l'ancien POI        | Un pipeline `routes[]` de premier niveau — c'est la dette que cette capacité a dissoute |
| **Piloté par les événements, sur le patron `taxonomy`**        | Une couche peut apparaître au boot ou bien après ; deux écouteurs couvrent les deux cas sans câblage impératif                                                                        | Une initialisation impérative au boot — elle raterait tout ajout ultérieur              |
| **Gate de boot opt-out, gate réel tardif**                     | Le gate de boot lit une configuration **pré-fusion** où la clé n'existe pas encore : un opt-in n'enregistrerait jamais le module et la capacité serait morte en silence               | Un gate opt-in au boot — le défaut a existé, il a été trouvé au smoke runtime           |
| **Désignation par couche**                                     | Sans elle, toute couche ligne recevrait des marqueurs — sur une couche « réseau » cela produirait une explosion de marqueurs illisible                                                | Décorer toute couche ligne                                                              |
| **Une seule sous-couche, deux rôles distingués par la donnée** | Deux sous-couches signifiaient deux sources MapLibre par itinéraire là où une suffit. Le fusionnement est possible parce que la dérivation étiquette déjà chaque point avec son rôle  | Deux couches `-start` / `-end` — c'est l'état d'avant, et il doublait les sources       |
| **Règles pilotées par la donnée, pas seulement une couleur**   | La composition de style rend un rendu complet par règle, **rayon compris** : départ et arrivée peuvent différer en taille, pas seulement en teinte                                    | Ne faire varier que la couleur                                                          |
| **Report en micro-tâche de la dérivation**                     | L'événement part **avant** que les entités ne soient dans le seam : sans report, la dérivation lit une couche vide                                                                    | Dériver dans l'écouteur                                                                 |
| **Rafraîchissement idempotent (retirer puis ajouter)**         | La même couche peut être décorée plusieurs fois (nouvelle donnée, balayage après ajout). Sans retrait préalable, les sous-couches s'accumuleraient                                    | Mettre à jour en place                                                                  |
| **Aucune sous-couche vide**                                    | Une source sans entité coûte pour rien et brouille l'inspection de la carte                                                                                                           | Ajouter systématiquement                                                                |
| **Façade impérative dissoute**                                 | Cinq méthodes de pilotage doublaient ce que la configuration et le seam générique de données font déjà. Une rupture assumée, sans coût réel : aucun profil ne suivait l'ancien modèle | Conserver `GeoLeaf.Route`                                                               |
| **Extrémités par entité en V1**                                | Agréger un itinéraire multi-segments et poser des étapes intermédiaires est un autre problème, avec son propre modèle. Le faire à moitié aurait figé une forme                        | Agréger tout de suite                                                                   |
| **Extrémités non interactives**                                | Rien ne demande de popup sur un marqueur de départ ; le seam d'interaction du moteur GeoJSON est disponible si le besoin apparaît                                                     | Brancher les interactions par défaut                                                    |
| **Adaptateur atteint par `Core.getMap()`**                     | C'est le chemin canonique ; le capturer à l'`init()` échouerait au balayage si la carte est recréée                                                                                   | Mémoriser l'adaptateur reçu par le module                                               |
| Pas de `loader`                                                | Inline : la capacité est légère, et c'est le gate tardif qui décide                                                                                                                   | Un `import()` paresseux                                                                 |

---

## Dépendances et frontières

### Dépendance de cycle de vie

`module.ts` → `RouteModule` : `id = "route"`, `dependencies = ["geojson"]` — la source de
`geoleaf:layer:added`, et **pas** `ui`. Les écouteurs sont posés pendant l'initialisation
**synchrone** des modules, donc avant que le chargement asynchrone de la carte n'émette
`geoleaf:map:ready` : le balayage initial est capté.

Sa position dans `presets/manifest.full.ts` **n'est pas libre** : `route` est enregistrée **avant**
`filter`, parce que l'ancien boot enregistrait le module d'itinéraire en premier et que le tri
topologique départage à égalité de dépendances sur l'ordre d'enregistrement. Le manifeste documente
cette contrainte sur place.

### Frontière `capabilities/` → `kernel/` (règle ESLint R.8)

Un seul accès kernel : `kernel/config/config-primitives.js`, **exception** nommée par la règle. Le
reste de ce que la capacité consomme passe par les **façades publiques** du core
(`api/geoleaf.core.js`, `api/geoleaf.layers.js`) — pas par des imports profonds.

⚠️ **Passer par les façades est ici un choix, pas une contrainte de la règle** : ce sont les
surfaces publiques et stables, et le seam `Layers` est précisément celui qui a remplacé les accès
directs aux données lors de la dissolution de l'ancien POI.

### Contrats et types

`contracts/map-adapter.contract.js` et `contracts/core-module.contract.js` pour les signatures.
Comme [`branding`](branding.md) et [`coordinates`](coordinates.md), la capacité se donne une vue
**structurelle** locale de l'adaptateur (`types.ts` → `RouteMapAdapter` : `addGeoJSONLayer`,
`removeLayer`, `getLayerRegistry`), délibérément permissive et resserrée à la frontière. Elle ne
touche jamais MapLibre directement.

### Aucune feuille de style

Les extrémités sont rendues **par l'adaptateur**, avec des styles issus de la configuration : il n'y
a pas de DOM propre à cette capacité, donc pas de CSS.

**Aucune référence à un plugin** — règle `no-plugin-in-core`, vérifiée par
`scripts/verify-core-standalone.cjs`. En particulier, la lecture des fichiers GPX / KML reste chez
`@geoleaf-plugins/file-import`, sans lien de code.

---

## Écarts au CDC source

Le CDC `CDC_capacite-route.md` a été **consommé** en écrivant cette fiche, puis retiré du dossier de
tri — trace au §Journal des décisions de
`roadmap_documentation-v3.md`.

| Énoncé du CDC                                                                                     | Ce que dit le code                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Décision 6 — « **`GeoLeaf.Filters.filterRouteList` conservé** », API publique découplée du module | **Partie.** Toute la chaîne (installeur → seam de filtre → baril) est tombée avec `GeoLeaf.Filters`, son seul appelant atteignable. L'installeur ne porte plus que son module — ce que sa propre documentation annonçait déjà |
| « la capacité est **exclue du build Lite** »                                                      | **Il n'y a plus de build Lite** : `CLAUDE.md` et `CDC_kernel.md` l'énoncent. Une entrée qui veut moins de capacités écrit son propre manifeste                                                                                |
| Deux sous-couches `-start` / `-end` implicites dans le modèle                                     | **Une seule** sous-couche `gl-route-<id>-endpoints`, les deux rôles distingués par `properties.role` — fusion faite depuis, motif écrit dans `apply.ts`                                                                       |
| Décision 5 — retrait de la façade `GeoLeaf.Route`                                                 | ✅ **Exact** : `registerGlobals` est vide, il n'y a ni `public-api.ts` ni façade ESM                                                                                                                                          |
| Décision 2 — gate de boot opt-out obligatoire                                                     | ✅ **Exact**, et le CDC note lui-même que le piège a été découvert au smoke runtime                                                                                                                                           |
| Décision 4 — extrémités par entité, `MultiLineString` premier/dernier segment                     | ✅ **Exact**, y compris le détail « premier segment **non vide** »                                                                                                                                                            |
| Le report en **micro-tâche** de la dérivation                                                     | **Absent du CDC** : ajouté depuis, et c'est ce qui rend la capacité correcte à l'ajout d'une couche. Documenté dans `lifecycle.ts`                                                                                            |

Ce qui a été **retenu** du CDC et ne se lit pas dans le code : les cas d'usage (couche déjà chargée
au boot, couche ajoutée dynamiquement, mise à jour de données par un backend d'itinéraire, couche
non désignée), la dette dissoute — l'ancien module `route` portait un **second modèle de données
parallèle**, largement mort, avec une configuration non opaque —, et les alternatives écartées de la
table §Décisions.
