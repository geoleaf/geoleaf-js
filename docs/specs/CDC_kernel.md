---
type: spec-kernel
title: kernel — @geoleaf/core
package: "@geoleaf/core"
statut: gelé — se met à jour en même temps que le code qu'il décrit
verifie_contre: 70cf3d31
date: 1er septembre 2026
---

# kernel — le substrat que tout le reste suppose

**Type :** kernel · **Code :** `packages/core/src/` · **Vérifié contre :** `70cf3d31` (01/09/2026)

> **Ce document ne recopie aucun chiffre mesurable.** Quand une quantité compte, la commande
> qui l'imprime est citée à sa place. Ce n'est pas une précaution de style : la version
> précédente de cette fiche annonçait « 18 capacités » à quatre endroits (il y en a 21),
> « 369+ fichiers TypeScript » (518), et deux comptes d'exports ESM contradictoires à
> 700 lignes d'écart. Sur les 452 chemins qu'elle citait, **287 ne résolvaient plus**.
>
> **Ce document ne recopie pas non plus ce qu'un générateur produit.** L'arborescence, les
> signatures d'API et la référence des paramètres de profil ont chacune leur source dérivée ;
> les sections concernées **renvoient**, elles ne dupliquent pas. C'est la frontière que la
> refonte documentaire V3 pose entre `specs/` et le dérivé — la recréer ici annulerait le
> travail qui la supprime ailleurs.

---

## Périmètre

`@geoleaf/core` est une bibliothèque TypeScript de cartographie interactive construite sur
MapLibre GL JS. Elle est pilotée par des **profils JSON** : un intégrateur décrit ses couches,
ses styles, ses thèmes et son UI en données, sans écrire de code cartographique.

Le **kernel**, au sens de cette fiche, est le sous-ensemble de `packages/core/src/` qui est
**toujours dans le graphe** : le retirer casse le boot. Il se distingue des **capacités
in-core** (`capabilities/<id>/`), qui sont gatées, auto-contenues et tree-shakeables, et des
**plugins** (`packages/plugins/<nom>/`), qui sont des paquets séparés enregistrés au runtime.

### Ce que le kernel fait

- Assemble le namespace global `GeoLeaf.*` et la surface d'exports ESM.
- Charge, valide, fusionne et expose la configuration issue des profils.
- Abstrait le moteur cartographique derrière `IMapAdapter` et en fournit l'implémentation
  MapLibre.
- Charge et rend les couches GeoJSON, les fonds de carte, les styles et les thèmes.
- Construit la coquille UI (panneau desktop, barre d'outils mobile, gestionnaire de couches).
- Porte le bus d'événements, la surface de sécurité (échappement, sanitisation, validation
  d'URL), le stockage bas niveau et l'introspection.
- Ordonne le cycle de vie des modules runtime par tri topologique.

### Ce que le kernel ne fait pas

- **Il ne connaît aucun plugin.** `packages/core/src/` ne référence jamais
  `@geoleaf-plugins/*` — voir §Dépendances et frontières, règle `no-plugin-in-core`.
- **Il n'embarque pas de backend.** Aucun appel serveur propriétaire, aucun schéma métier.
- **Il ne déclare, ne valide et ne défaute pas la configuration d'un plugin** : le contenu
  d'un bloc `modules.<id>` lui est opaque (INV-CONFIG / INV-FRONT).
- **Il n'est pas l'application.** Le HTML, le `init.js`, le manifeste PWA et les icônes
  livrées appartiennent à `apps/geoleaf-app/`, source unique de **toutes** les variantes de
  déploiement, et jamais publiée sur npm. ⚠️ Cette ligne disait « des **trois** variantes »
  jusqu'au 11/08/2026 : `ls deploy/` en rend **quatre**, dont **deux seulement sont livrables**
  (`deploy-core`, `deploy-full`) — voir [`contrats/APP_SHELL.md`](contrats/APP_SHELL.md), qui
  porte la table. Le compte ne se recopie pas ici.
- **Il ne porte plus de build « Lite »** ni de chargement paresseux par répertoire : le
  répertoire `src/lazy/` n'existe pas. Une entrée qui veut moins de capacités écrit son
  propre manifeste (voir `packages/core/examples/minimal/entry.ts`), et ce qu'elle n'importe
  pas se tree-shake — CSS compris : **toute capacité qui porte une feuille de style la tire
  depuis son propre `install.ts`**, et plusieurs n'en portent aucune. La liste se relève, elle
  ne se recopie pas : `grep -l '\.css' packages/core/src/capabilities/*/install.ts`.

---

## Fonctionnalités

Une ligne par sous-système du kernel. Le détail par fichier — chemin, LOC, exports réels,
en-tête de module — est **généré** : [`docs/reference/ARBORESCENCE_QUALIFIEE.md`](../reference/ARBORESCENCE_QUALIFIEE.md)
(`npm run docs:tree`, gaté par `docs:tree:check`).

| ID   | Fonctionnalité                                                               | Entrée                                                        | Sortie observable                                                                                                                                                                                                                                                                                     | Code                                                      |
| ---- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| K-01 | Assemblage du namespace global et des façades                                | import du bundle                                              | `window.GeoLeaf.*` peuplé, `GeoLeaf.boot()` disponible                                                                                                                                                                                                                                                | `globals/`, `api/geoleaf.*.ts`                            |
| K-02 | Chargement et fusion de la configuration                                     | `geoleaf.config.json` + `profile.json` + compagnons           | `GeoLeaf.Config.get(...)`, config consolidée                                                                                                                                                                                                                                                          | `kernel/config/`                                          |
| K-03 | Abstraction du moteur cartographique                                         | appels métier engine-agnostic                                 | carte MapLibre pilotée sans référence `maplibregl.*` hors adapter                                                                                                                                                                                                                                     | `contracts/map-adapter.contract.ts`, `adapters/maplibre/` |
| K-04 | Carte, conteneur, thème de carte, **cycle de vie du registre**               | config `map` du profil                                        | carte montée, `geoleaf:map:ready` ; registre à clé (`init`/`destroy`/`hasMap`/`listMaps`) et **déplacement d'une carte vivante** (`isAttached`/`reattach`, cf. **ADR-15**) — un seul registre, celui de `Core` : `GeoLeaf.getMap`/`getAllMaps` y délèguent depuis la 3.1.0                            | `kernel/map/`                                             |
| K-05 | Fonds de carte (raster, vectoriel, WMS/WMTS, hillshade, image géoréférencée) | `config/core/basemaps.json`                                   | sélecteur de fonds, `geoleaf:basemap:change`                                                                                                                                                                                                                                                          | `kernel/basemaps/`                                        |
| K-06 | Couches GeoJSON — chargement, conversion, styles conditionnels, labels       | `config/core/layers.json` + `layers/<id>/`                    | couches rendues, `geoleaf:layer:added`. 🛑 **Un geste = UN événement** : un clic sur une entité émet exactement un `geoleaf:feature:click`, quelle que soit la géométrie et quel que soit le nombre de sous-couches qui la rendent — le clic et le survol partagent la même précédence de sélection   | `kernel/geojson/`                                         |
| K-07 | Moteur de thèmes (presets de visibilité)                                     | `config/core/themes.json`                                     | thème appliqué, `geoleaf:theme:applied`                                                                                                                                                                                                                                                               | `kernel/themes/`                                          |
| K-08 | Coquille UI — panneau desktop, barre mobile, composants partagés             | `config/core/ui.json`                                         | DOM de la coquille, `geoleaf:toolbar:action`                                                                                                                                                                                                                                                          | `kernel/ui/`                                              |
| K-09 | Gestionnaire de couches (arbre, bascules, sélecteur de fond)                 | registre de couches + thèmes                                  | panneau, `geoleaf:layer:toggle`, `geoleaf:layer-manager:panel`                                                                                                                                                                                                                                        | `kernel/layer-manager/`                                   |
| K-10 | Bus d'événements assaini                                                     | `dispatchGeoLeafEvent(...)`                                   | `CustomEvent` sérialisable sur `document`                                                                                                                                                                                                                                                             | `kernel/events/`, `contracts/event-bus.contract.ts`       |
| K-11 | Sécurité — échappement, sanitisation, validation d'URL, DOM sûr              | chaînes et URL non fiables                                    | HTML sûr, URL rejetées                                                                                                                                                                                                                                                                                | `kernel/security/`                                        |
| K-12 | Registre d'API, registre de plugins, registre de capacités                   | `PluginRegistry.register(...)`, manifeste de preset           | `GeoLeaf.<Plugin>.*`, gates de capacités, et `GeoLeaf.Capabilities.onUnavailable(cb)` — le canal par lequel l'**absence** d'une capacité devient un fait, rejoué aux abonnés tardifs et idempotent par id (`kernel/api/unavailable-capabilities.ts`)                                                  | `kernel/api/`                                             |
| K-13 | Stockage bas niveau et enregistrement du Service Worker                      | config PWA / offline                                          | SW enregistré, `geoleaf:sw:updated`, `geoleaf:cache:evicted`                                                                                                                                                                                                                                          | `kernel/storage/`                                         |
| K-14 | Introspection en lecture seule                                               | —                                                             | `GeoLeaf.Introspection.*` pour les outils tiers — dont `getCapabilityStatus()` (socle-init 9.4), qui répond « qu'est-ce qui est allumé, et pourquoi » : `getAllCapabilities()` rend ce qui est **déclaré**, `getActiveModules()` ce qui **tourne**, celle-ci le **verdict de config**, relu à l'appel | `kernel/introspection/`                                   |
| K-15 | Contrats de seam inter-modules                                               | implémentation d'un contrat                                   | dépendance inversée sans arête directe                                                                                                                                                                                                                                                                | `kernel/shared/`                                          |
| K-16 | Ordonnancement du runtime par tri topologique (Kahn)                         | `ICoreModule.dependencies`                                    | ordre d'`init()` déterministe                                                                                                                                                                                                                                                                         | `app/module-registry.ts`                                  |
| K-17 | Séquence de boot paramétrée par manifeste                                    | `PresetManifest`                                              | `geoleaf:app:ready`                                                                                                                                                                                                                                                                                   | `app/boot*.ts`, `presets/`                                |
| K-18 | i18n du core                                                                 | `?lang=` → `localStorage['gl-lang']` → `ui.language` → `"fr"` | libellés traduits, `GeoLeaf.I18n.getActiveLang()`                                                                                                                                                                                                                                                     | `lang/`, `utils/i18n/`                                    |

**Poids relatif des sous-systèmes** (fichiers `.ts` et lignes) — se remesure en une commande,
donc n'est pas recopié ici :

```bash
for d in packages/core/src/kernel/*/; do
  printf '%-42s %3s fichiers %7s lignes\n' "$d" \
    "$(find "$d" -name '*.ts' | wc -l)" \
    "$(find "$d" -name '*.ts' -exec cat {} + | wc -l)"
done
```

⚠️ **La commande précédente n'imprimait QUE le nombre de fichiers**, là où la phrase au-dessus
d'elle annonçait « fichiers et lignes ». Une commande citée à la place d'un chiffre ne dispense
pas de vérifier qu'elle rend bien ce qu'on lui prête : ici, la moitié de la mesure manquait, et
rien ne pouvait le dire puisque la sortie est plausible.
⚠️ **Et le balayage `*.ts` a un angle mort qu'il faut connaître avant de comparer les colonnes** :
`kernel/storage/` porte `sw-core.js`, le plus gros fichier du sous-système — un `.js`, parce que
le service worker est copié tel quel. Un classement par `.ts` le range donc bien en dessous de son
poids réel.

### K-06 — le style porté par le bundle, promu en contrat

Promu le 20/08/2026, cible **3.1.0**. L'engagement existait déjà dans le code depuis le même
jour ; ce qui change est qu'il cesse d'être **révocable par un refactor**.

**Style présent dans le bundle ⟹ AUCUNE requête HTTP de style.** Quand `profile-bundle.json`
porte le document d'un style sous `layerStyleDocuments[layerId][styleId]`, le chargement de ce
style résout depuis lui et **n'émet aucun `fetch`**. L'ordre de résolution est fixé :
**cache mémoire → magasin de documents (sans fetch) → HTTP, et seulement là.**

🛑 **Réintroduire une requête sur ce chemin est une rupture** (`major`), pas une optimisation
qu'on annule. C'est le même engagement que K-07 ① pour les thèmes, sur le même motif : il
dispense un intégrateur de faire coïncider sa disposition d'assets avec la convention de chemin
du chargeur.

⚠️ **Le repli HTTP reste OBLIGATOIRE, et le contrat ne porte pas dessus.** Il dit « présent dans
le bundle », jamais « jamais de requête » : `debug: true` ignore délibérément le bundle et prend
la cascade. Un contrat qui interdirait la requête tout court casserait ce mode.

⚠️ **Deux sites, et un troisième serait hors garde.** `loadAndValidateStyle`
(`utils/loaders/style-loader-core.ts`) et `loadLayerLegend` (`capabilities/legend/legend.ts`)
consultent tous deux le magasin. Le second garde son `fetch` et son `AbortSignal` : la
convergence vers le premier perdrait le signal et la garde micro-tâche, dont le prix serait une
écriture DOM après démontage. **Un troisième site de chargement ajouté plus tard devrait
consulter le magasin lui aussi, et rien ne le lui rappellerait** — voir les limites ci-dessous.

**Vérificateurs** — et ils sont STRUCTURELS, pas comportementaux :

- `packages/core/__tests__/loaders/style-document-store.test.ts` — l'ordre des trois branches,
  et l'égalité **structurelle** des deux enveloppes. C'est cette seconde assertion qui compte :
  rendre le document brut satisferait tout consommateur qui ne lit que `styleData`, et casserait
  le générateur de légende, qui lit `styleData.id`.
- `packages/core/__tests__/config/bundle-style-documents.test.ts` — le compilateur porte le
  document de **chaque** couche, instances de `layerTemplates` comprises, sur un compte **dérivé
  des sources** et jamais écrit en dur.

🛑 **Ce que ces vérificateurs NE gardent PAS, et il faut le savoir avant de s'y fier.** K-07 tient
parce qu'un membre de **façade publique** le porte (`EXPECTED_FACADE_MEMBERS.Config`) : un golden
master voit ce membre bouger. `StyleLoader` n'a **aucune façade publique** — il n'est ni dans
`kernel-exports.ts` ni dans `globals.*.ts` —, donc aucun équivalent n'existe. Les deux tests
ci-dessus gardent les chemins **qu'ils appellent** ; ils ne verraient pas un quatrième site de
chargement apparaître ailleurs.

⚠️ **Un compteur de requêtes en E2E aurait fermé ce trou, et il est délibérément ÉCARTÉ.** La
suite navigateur est mesurée instable sous charge (trois passes du 20/08, trois specs rouges
différents, tous verts en isolation) et n'est jouée que deux fois par run : une assertion qui
rougit au hasard et ne tourne presque jamais produit du bruit, pas une garde. Le trou est donc
**connu, nommé et non couvert** — ce qui vaut mieux qu'un vert qui ne prouve rien.

📌 **Deux chemins frères existent et ne sont PAS contractuels** : `boot({config})` et
`data.profileBundle` suppriment eux aussi des requêtes, par le même mécanisme. Ils ont été
livrés le même jour et n'ont pas été promus — les promouvoir se décide, et ne s'infère pas
d'ici.

---

### K-06 — chaque sous-couche ne peint que SA géométrie

Posé le 27/08/2026. Une couche GeoJSON déclarée devient plusieurs couches MapLibre — `fill`
(ou `fill-extrusion`), `casing`, `line`, `circle`, `symbol` — sur **une seule source**. Elles portent désormais chacune
un filtre `geometry-type` (`geometryGuard()`, `adapters/maplibre/maplibre-primitives.ts`).

🛑 **Le motif : MapLibre ne contrôle AUCUN type de géométrie au remplissage de ses buckets.**
`FillBucket` triangule les anneaux qu'on lui donne — une `LineString` comprise, qu'il **referme**
en polygone plein — et `CircleBucket` parcourt tous les points de tous les anneaux, donc une ligne
y contribue **un cercle par sommet**. Une source portant plus d'une famille de géométrie peignait
donc chacune de ses entités dans **toutes** ses sous-couches. Constaté sur la couche d'itinéraire
calculé : un tracé correct, un polygone noir qui le referme, et une centaine de nœuds là où il n'y
avait que trois étapes.

⚠️ **La garde doit survivre à tout filtre reposé, et deux chemins la remplaçaient.**
`adapter.setLayerFilter()` — la couture unique qu'empruntent le filtre GPU par ids, la capacité
`filter` et le plugin `editor` — écrasait le filtre de chaque sous-couche ; le rustinage
`point_count` du chemin cluster faisait de même. Les deux composent maintenant
(`withGeometryGuard()`). **Vider un filtre restaure la garde, jamais `null`** : sinon le défaut
rouvrirait exactement pendant qu'aucun filtre n'est actif.

✅ **Et c'est la garde qui rend CORRECT le repli « je ne sais pas ».** Une couche dont les données
d'amorce sont **vides** — celle de l'itinéraire l'est délibérément, elle est écrite à l'exécution —
ne dit rien de sa géométrie, donc les trois familles de sous-couches sont construites. Le jeu de
sous-couches est décidé **une seule fois, à la création** : `updateLayerData()` ne fait que
`source.setData()` et ne le rejoue jamais. Le sur-rendu est donc la seule option sûre, et il ne
coûte plus rien puisque chaque sous-couche est confinée.

📌 **Corollaire sur la déclaration de géométrie du profil : elle AJOUTE, elle ne restreint pas.**
`geometryType` est un genre **sémantique**, une chaîne minuscule unique que lisent aussi la
légende, le menu de l'éditeur et l'applicateur de thèmes — et le genre d'une couche peut être plus
étroit que son contenu (un itinéraire calculé est une `polyline` qui porte aussi ses étapes).
**Seules les DONNÉES peuvent dire « inconnu »** : le repli aux trois familles est indexé sur un
scan vide, jamais sur l'absence de déclaration. ⚠️ Ce chemin n'acceptait que le vocabulaire
GeoJSON alors que le schéma de profil n'autorise que le minuscule — **0 configuration de couche
sur 25 l'atteignait**. Les deux vocabulaires se rejoignent maintenant en un seul endroit,
`geometryKindToGeoJSONTypes()` dans `kernel/config/layer-geometry.ts`.

⚠️ **Hors périmètre, et pour un motif** : les couches de tuiles vectorielles et le chemin POI
clusterisé ne portent pas de garde — une source-layer vectorielle est homogène par construction,
et le second a son propre `applyPoiFilter`.

---

### K-07 — deux engagements du moteur de thèmes, promus en contrat

Promus le 13/08/2026, cible **3.1.0**. Les deux existaient déjà dans le code ; ce qui change est
qu'ils cessent d'être **révocables par un refactor**, parce qu'un consommateur aval s'y appuie.

**① `themes` déclaré dans le profil ⟹ AUCUNE requête HTTP.** Quand le profil actif porte déjà
un objet `themes` — ce que produit le chargeur de profils modulaires —,
`ThemeLoader.loadThemesConfig(profileId)` résout depuis lui et **n'émet aucun `fetch`**.

C'est ce qui dispense un intégrateur d'intercepter `window.fetch` pour servir `themes.json`, et
de faire coïncider sa disposition d'assets avec la convention de chemin du chargeur.
🛑 **Réintroduire une requête sur ce chemin est une rupture** (`major`), pas une optimisation
qu'on annule. L'ordre des branches est fixé : cache → chargement déjà en vol → profil actif
(**sans fetch**) → `themes.json` par HTTP, et seulement là.

**② `GeoLeaf.Config.clearThemesCache(profileId?)` est la porte publique de ce cache.** Elle vide
un profil, ou tous si l'argument est omis, **et les promesses de chargement en vol avec** — sans
quoi un chargement démarré avant l'appel repeuplerait le cache derrière lui.

⚠️ Elle est montée depuis `globals/globals.ui.ts` et non depuis `globals/globals.config.ts`, sur
une contrainte mesurée : `kernel/themes/**` importe déjà `kernel/config/**` (trois sites dans
`theme-applier/*`), donc câbler l'arête inverse **fermerait un cycle** de répertoires.
⚠️ Ne pas confondre avec `GeoLeaf.ThemeCache`, homonyme piégeux : celui-là est le cache
IndexedDB des **données de couche**.

Vérificateurs : `EXPECTED_FACADE_MEMBERS.Config` (`scripts/lib/namespace-surface.mjs`, golden
master vu rouge puis vert à la pose) et `GeoLeafGlobal.Config` dans `packages/core/src/global.d.ts`.

---

## Séquence de boot

⚠️ **L'ordre est porteur, et il est encodé par l'ordre des imports ESM** — pas par une
convention écrite ailleurs. Ne jamais réordonner `globals/globals.ts` sans repasser les quatre
filets listés en fin de section.

### Phase A — les façades, à l'**import du bundle**

`bundle-esm-entry.ts` importe `globals/globals.ts` en side-effect. Celui-ci tire d'abord le CSS
du kernel, puis six sous-fichiers dans un ordre que la résolution ESM rend déterministe :

```
globals.core     B1+B2   log, errors, constantes, sécurité, utils   (DOIT être premier)
globals.config   B3+B4   helpers, validateurs, renderers, data, loaders, map, config
globals.geojson  B5      geojson, route
globals.ui       B6+B7+B9 labels, legend, layer-manager, thèmes, ui
globals.storage  B8      _OfflineDetector, façade Storage, écoute d'éviction   ← APRÈS l'UI, cf. ADR-05
globals.api      B11     façades geoleaf.*.js + api/ + PluginRegistry   (DOIT être dernier)
```

Chaque `globals.*.ts` appelle son `setupX()` **directement, en fin de fichier**. Il n'y a plus
ni registre d'indirection (`app/module-setup.ts`) ni garde `_done` : les setups kernel ont une
signature vide — ni adapter, ni config — donc **rien à ordonnancer**.

**Pourquoi la phase A ne peut pas passer par le registry.** Le boot appelle `loadConfig()`
**avant** `registry.init()`, et les plugins ESM appellent `GeoLeaf.I18n.registerDict()` à leur
propre top-level, avant tout. Les façades sont un **prérequis** du registry, pas son produit.
⇒ « registry = seul driver du boot » est **impossible**, pas seulement risqué (ADR-08).

⚠️ **Il n'y a pas de `globals.poi.ts`** — le module POI est dissous. Six fichiers `globals.*`
en tout ; toute rédaction mentionnant un B10 POI décrit un état révolu.

### Module-eval — `installBoot(preset)`

`app/boot.ts` ne fait qu'appeler `installBoot(FULL)`. Tout ce qui doit se produire à
l'évaluation du bundle vit dans `app/boot-install.ts` :

- le verrou `?perf=1` (avant la toute première marque de perf) ;
- l'enregistrement des **6 modules noyau** — `CoreMapModule`, `ConfigModule`, `SharedModule`,
  `GeoJSONModule`, `UIModule`, `ThemeEngineModule` ;
- les ancres `GeoLeaf._registry` / `GeoLeaf.registry` ;
- `_app.startApp`, lié à `bootWithPreset` avec **le manifeste de cette entrée** ;
- la façade publique `GeoLeaf.boot()`.

⚠️ **6 modules, pas 8.** `SecurityModule` et `APIModule` ont été retirés : leurs
`init()`/`destroy()` étaient vides, leurs sous-systèmes sont des **façades pures** posées en
phase A. Ils ne portaient qu'un nœud de graphe.

⚠️ `installBoot()` s'appelle **exactement une fois** par bundle.

### Phase B — le runtime, `bootWithPreset(preset)`

Séquence, dans `app/boot-core.ts` :

```
loadConfig()                       → config de base (pré-fusion)
Pass 1  registerPresetDeclarations (déclarations + façades des capacités, NON gatées)
Pass 2  registerPresetModules      (TOUS les modules de cycle de vie, chacun EMBALLÉ dans sa gate)
loadActiveProfileResources()       → config effective (profil fusionné)
hook beforeBoot                    (gate d'authentification ; jeter interrompt le boot)
registry.init(adapter, effectiveCfg)
```

⚠️ **La Pass 2 ne lit plus AUCUNE config**, et c'est un renversement, pas une nuance. Elle
recevait `toCapConfig(baseCfg)` — une vue PRÉ-fusion —, si bien qu'un profil écrivant
`modules.<id>.enabled: true` était arbitré par une config où la clé n'existait pas encore
(`enableWhenAbsent ?? false`) : **la surface de configuration que le produit documente ne
pouvait pas allumer ce qu'elle décrit**. La pass n'a pas bougé, une condition en a été
retirée — tous les modules sont enregistrés, chacun enveloppé par `gatedModule()`
(`packages/core/src/presets/apply-preset.ts`), qui évalue la gate **dans son `init()`**, donc
sur `effectiveCfg`. ⚠️ Le motif qui imposait la posture **opt-out** aux capacités
optionnelles est donc TOMBÉ ; la posture, elle, est restée (`enableWhenAbsent: true` dans
les déclarations) — la re-décider est un arbitrage, pas une conséquence.

**Ne pas déplacer la Pass 2 sous `loadActiveProfileResources()`** pour autant, et
`boot-core.ts` porte l'interdit : un module dé-enregistré à la Pass 2 est un module que le tri
topologique ne voit jamais, donc une capacité gatée tardivement disparaîtrait au lieu de
rester inerte. C'est la zone qu'un sprint antérieur a dû reverter.

**Résolution du profil à booter**, en trois rangs (`_resolveSelectedProfile`) :
`sessionStorage['gl-selected-profile']` (**one-shot**, lu puis retiré) → `localStorage['gl-profile']`
(durable, la persistance de la capacité `profile-switcher`) → `null`, qui laisse
`data.activeProfile` s'appliquer. Les deux stores sont écrits par l'utilisateur : chacun est
gardé par le même format (`/^[a-zA-Z0-9_-]{1,50}$/`), un id de profil atteignant un `fetch`.

**Résolution de la SOURCE de configuration**, en trois rangs elle aussi
(`_resolveConfigSource`). ⚠️ **À ne pas confondre avec la précédente** : celle-là répond
« QUEL profil », celle-ci « OÙ est la configuration » — le code porte la note parce que la
confusion s'est déjà produite une fois. Rang 1, un objet remis **en mémoire**
(`GeoLeaf.boot({ config })`) : la boot l'applique tel quel et **n'émet aucune requête** pour
lui. Rang 2, une URL explicite (`configUrl`). Rang 3, **INCHANGÉ**, le chemin déduit de la
page hôte (`_app.getProfilesBasePath()` + `geoleaf.config.json`) — `getProfilesBasePath`
cesse d'être le mécanisme et devient le défaut. Si `config` et `configUrl` arrivent ensemble,
`config` gagne et l'option perdante est **nommée** dans un avertissement : une option
silencieusement ignorée est exactement le défaut que ce chemin existe pour retirer.

Motif du rang 1, et il n'a rien de spécifique à un intégrateur : une application hôte dont le
routeur répond son propre document HTML en **HTTP 200** sur le chemin déduit rend du HTML là
où du JSON est attendu, et rien sur le fil ne signale l'anomalie. Le témoin est
`e2e/vn-config-shell-200.spec.js`.

⚠️ **`registry.init()` est SÉQUENTIEL et AWAITÉ, et `GeoJSONModule` y attend le réseau.**
`app/module-registry.ts` boucle sur l'ordre topologique avec un `await` par module ; or
`GeoJSONModule.init()` **attend** la phase 1 du chargement des couches
(`await loadFromActiveProfile()` — les couches du thème par défaut, par lots de
`PHASE1_BATCH_SIZE`, sans délai entre lots). **Tout module placé après `geojson` dans le tri ne
peut donc pas se monter avant que ces couches aient résolu**, et une couche déclarant
`data.mapping` charge **sur le fil principal, sans timeout** (le worker détruirait l'enveloppe
que le mapping doit lire).

⚠️ **Cette phrase a dit « par lots de 3, 200 ms entre lots » jusqu'au 07/08/2026** — les deux
nombres sont tombés depuis (lots de 6, délai désarmé), et le second coûtait **400 ms** sur ce
chemin, pas 200 : le thème par défaut du profil actif porte **8** couches, donc le minuteur
partait deux fois. Les valeurs vivent en un seul endroit (`loader/profile.ts`, `PHASE1_BATCH_SIZE`
et `PHASE1_BATCH_DELAY_MS`) et **ne se recopient pas ici** — c'est précisément en les recopiant
que cette ligne s'est périmée. ⚠️ Il existe un **second** plafond sur le même chemin, juste après
(`themes/theme-applier/core.ts`, `perfConfig.themeBatchSize || 6`) : les deux se règlent ensemble.

C'est un piège d'ordonnancement, pas une lenteur : déclarer `dependencies = ["geojson"]` pour la
seule raison d'être trié **après** quelque chose place la capacité derrière une attente réseau
non bornée. `toast-renderer` le faisait, et le symptôme était qu'**aucune notification n'était
rendue pendant tout le chargement initial** — la fenêtre même où surviennent les erreurs de
chargement (28/07/2026 ; `dependencies` ramenée à `["config"]`). **La très large majorité
des capacités à module portent encore cette déclaration** — ⚠️ la leur retirer demande de
vérifier d'abord que leur `init()` ne lit réellement aucun état GeoJSON, ce que rien n'atteste
aujourd'hui. Le gisement se dérive, il ne se recopie pas :

```bash
grep -rn 'readonly dependencies' packages/core/src/capabilities/
```

> 🛑 **Relecture du 11/08/2026 — cette phrase nommait TROIS capacités (`labels`, `feature-info`,
> `filter`) ; elles sont QUATORZE.** C'est le mode d'échec n° 1 du pré-vol — le gisement
> sous-estimé —, ici d'un facteur **4,7**, et sur la ligne de registre elle-même : qui
> aurait chiffré ce travail sur cette phrase l'aurait sous-évalué d'autant. Seules
> `toast-renderer` (`["config"]`) et `permalink` (`[]`) ne la portent pas. ⚠️ Ne pas raccrocher un
> compte ici : c'est en en écrivant un que la phrase s'est périmée.

### Le filet qui garde cette séquence — quatre tiers, aucun redondant

| Tier          | Fichier                                                     | Ce qu'il attrape                                                          |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Artefact      | `packages/core/__tests__/bundle-boot-contract.test.js`      | surface d'**import**, santé de l'APIController, canari plugin, DCE Rollup |
| Getter réel   | `packages/core/__tests__/api/api-controller-getter.test.js` | `managers: 0` — l'oracle littéral de la panne S4                          |
| Golden master | `packages/core/__tests__/app/boot-golden-master.test.js`    | surface **post-boot**, avec un `registry.init()` réel                     |
| Navigateur    | `scripts/probe-boot-contract.mjs`                           | le **rendu**, l'**ordre réel** des marqueurs, et la **ré-entrance**       |

⚠️ **Chaque tier a son angle mort.** Une régression de ré-entrance dans `_getAPIController()`
est passée verte sur les trois premiers tiers et n'a été vue que par la sonde navigateur ;
inversement, deux pannes historiques n'avaient pas besoin d'un navigateur — un test de 4 ms les
attrapait pendant que la suite complète restait verte. Le critère n'est pas « faut-il un
navigateur » mais **« le test lit-il l'objet réel, ou un mock de l'objet ? »**.

---

## Les 13 sous-systèmes de `kernel/`

Chaque répertoire répond à une question : _qu'est-ce qui traverse ma frontière, et par où ?_
La règle ESLint **R.8** interdit à `capabilities/**` d'importer profondément sous `kernel/**` :
seuls les **barils** (`index.ts`), les **hubs de types** (`*-types.ts`), les **seams** (`*-seam.ts`)
et `config-primitives.ts` — le médiateur historique, nommément exempté par la règle — sont
atteignables. Un sous-système sans `index.ts` est un sous-système **entièrement interne**.

| Sous-système     | Rôle                                                                                 | Route médiée                                   | Ce qui passe la frontière                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/`           | contrôleur d'API, registre de plugins, registre de capacités, boot-info              | `index.ts`                                     | `APIController`, `PluginRegistry`, `CapabilityRegistry`, `BootInfo`, et — depuis le 24/08/2026 — `Capabilities`, le bus par lequel une capacité absente le dit. La liste exacte se lit (`grep -nE '^export' packages/core/src/kernel/api/index.ts`), elle ne se recopie pas. ⚠️ `GeoLeafAPI` **n'est pas** au baril. 🛑 Le motif écrit ici était « assembleur à état, avec des dépendances d'ordre de chargement » : **c'était vrai jusqu'au 08/08/2026**, et socle-init 7.7 a retiré l'assemblage — le module ne fait plus que ré-exporter le namespace vivant. Il reste hors baril parce qu'il porte un **effet de bord d'import** (`_g.GeoLeaf = _g.GeoLeaf \|\| {}`) et non un symbole pur, ce que le baril ne doit pas dissimuler |
| `basemaps/`      | fonds de carte, providers, hillshade, source image                                   | — (interne)                                    | via la façade `GeoLeaf.Baselayers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `config/`        | chargement, fusion, accès à la config ; `geoleaf-config/module-config.ts`            | `index.ts` **restreint**                       | ⚠️ `Config` n'est **pas** ré-exporté au baril — la route recommandée reste `./config-primitives.js`, le médiateur nommément exempté par R.8 — le nombre d'arêtes qui y passent se mesure (`grep -rl config-primitives packages/core/src/capabilities/`), il ne se recopie pas. Deux portes vers la même pièce donneraient deux réponses à la même question                                                                                                                                                                                                                                                                                                                                                                             |
| `events/`        | bus d'événements                                                                     | `index.ts`                                     | `dispatchGeoLeafEvent` uniquement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `geojson/`       | chargement, conversion, styles, labels — **l'arête la plus chargée** de la frontière | `index.ts`                                     | `GeoJSONCore`. ⚠️ Les **types ne sont pas** ré-exportés : les hubs (`core-types.ts`, `loader/loader-types.ts`) restent importables directement, router un import type-only par un baril runtime tirerait l'implémentation dans le graphe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `introspection/` | surface lecture seule pour les outils tiers                                          | — (interne)                                    | via `GeoLeaf.Introspection`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `layer-manager/` | arbre de couches, bascules, sélecteur de fond                                        | seams `panel-seam.ts`, `item-controls-seam.ts` | contributions de capacités, sans arête directe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `map/`           | conteneur, thème de carte, façade                                                    | — (interne)                                    | via `GeoLeaf.Core`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `security/`      | échappement, validateurs, sanitiseurs, DOM sûr                                       | `index.ts`                                     | `escapeHtml`, `escapeAttribute`, `createSafeElement`, sanitiseurs, validateurs d'URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `shared/`        | contrats de seam et état partagé inter-modules                                       | `index.ts` — **baril de médiation**            | `StorageContract` et l'état que lisent les capacités. ⚠️ **L'élargir est le geste que R.8 DÉSIGNE**, pas un contournement — mais il est explicite et doit être motivé sur place                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `storage/`       | stockage bas niveau, enregistrement du Service Worker                                | `index.ts` **étroit**                          | `SWRegister` seul — c'est tout ce que `capabilities/pwa/` consomme. ⚠️ `sw-core.js` vit ici mais **n'est ni importé ni bundlé** : il est copié tel quel dans chaque variante, donc tout littéral qu'il partage avec le core est écrit **deux fois** et doit porter sa garde de source (`DATA_ORIGINS_KEY`, `TILE_BUDGET_KEY`, le plafond de tuiles)                                                                                                                                                                                                                                                                                                                                                                                    |
| `themes/`        | moteur de thèmes : chargeur, applicateur, événement `geoleaf:theme:applied`          | `index.ts`                                     | `ThemeLoader` + ses types. ⚠️ **Le moteur est kernel, le sélecteur est une capacité** (`capabilities/theme-selector/`) — ce baril est la couture entre les deux                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ui/`            | primitives UI, panneau desktop, barre mobile                                         | `index.ts` **délibérément étroit**             | `_UIComponents`, `createPillSearchInput`. Le plus gros sous-arbre du kernel, et presque tout y est interne — **l'élargir est une décision, pas une formalité**. ⚠️ `desktop/desktop-tabs-seam.ts` n'est pas ré-exporté : un seam est déjà une frontière médiée                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

⚠️ **`kernel/shared/` est le point d'attention permanent.** Toujours identifier ses consumers
avant de le modifier : c'est par lui que passent `storage-contract`, `geojson-state`,
`layer-configs-state`, `lifecycle` et `sync-handler-contract`.

**Les seams du dépôt**, tous emplacements confondus — c'est la convention pour une dépendance
inversée :

```bash
find packages/core/src -name '*seam*.ts'
```

---

## Configuration

### Ce qui appartient à cette fiche, et ce qui ne lui appartient pas

| Sujet                                             | Où il fait autorité                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure d'un dossier profil, invariants `PRF-*` | [`docs/specs/contrats/PROFILE_CONTRACT_SPEC.md`](contrats/PROFILE_CONTRACT_SPEC.md) (**gelé sous RFC**)                                                                               |
| Comment valider un profil, erreurs et remèdes     | [`docs/reference/GUIDE_VALIDATION_PROFILS.md`](../reference/GUIDE_VALIDATION_PROFILS.md)                                                                                              |
| Inventaire exhaustif des paramètres, par famille  | [`docs/reference/inventaire_config_parametres.md`](../reference/inventaire_config_parametres.md) (gate bidirectionnelle) et son rendu `reference_parametres_config.html` (**généré**) |
| Ce qui suit ci-dessous                            | le **mécanisme** de chargement et de fusion, propre au kernel                                                                                                                         |

### Le manifeste `Files`

`profile.json` porte l'identité, `map`, le manifeste `Files` — et, le schéma le déclare aussi, un
bloc `modules` **inline** à la racine. Le manifeste `Files`, lui, est **fermé**
(`additionalProperties: false` dans `profiles/schemas/profile.schema.json`) ; ses clés se lisent au
schéma, jamais ici :

```bash
node -e "const s=require('./profiles/schemas/profile.schema.json'); console.log(Object.keys(s.properties.Files.properties).join(' '))"
```

⚠️ **Le `modules` racine n'est pas un vestige, et le taire coûte une surprise dans le sens le plus
cher.** `mergeModuleBags` (`kernel/config/profile-loader-helpers.ts`) assemble d'abord le bag issu
des fichiers `Files.modules`, puis passe le bloc inline par-dessus, entrée par entrée —
`ConfigStore.deepMerge` quand les deux sont des objets, remplacement sec sinon. **C'est l'inline qui
gagne**, pas le fichier. Aucun profil du dépôt ne l'exerce et aucun exemple normatif ne le montre :
la forme est vivante et n'est illustrée nulle part, ce qui est exactement la façon dont on la
redécouvre en production.

```json
{
    "Files": {
        "themesFile": "config/core/themes.json",
        "layersFile": "config/core/layers.json",
        "basemapsFile": "config/core/basemaps.json",
        "uiFile": "config/core/ui.json",
        "featuresFile": "config/core/features.json",
        "modules": {
            "offline": "config/plugins/offline.json",
            "table": "config/plugins/table.json",
            "taxonomy": "config/plugins/taxonomy.json",
            "legend": "config/plugins/legend.json",
            "filter": "config/plugins/filter.json"
        }
    }
}
```

> 🛑 **Relecture du 11/08/2026 — cet exemple déclarait `"addpoi": "config/plugins/addpoi.json"`,
> et il est COPIABLE-COLLABLE.** Le plugin a fusionné dans `editor` : `addpoi` n'existe
> plus, et **aucun profil du dépôt ne déclare ce module**. Remplacé par `table`, qui existe et dont
> les trois profils portent la configuration. ⚠️ **Le garde de cette section est resté VERT tout du
> long**, et c'est la leçon : `doc-profile-examples.guard.test.js` valide le bloc contre
> `profile.schema.json`, or `Files.modules` accepte **n'importe quelle clé** — il contrôle la
> FORME, jamais l'existence de ce qui est nommé. C'est exactement la ligne « la véracité de la
> phrase : rien, et rien ne le pourra » du protocole documentaire.

⚠️ **La taxonomie n'a pas d'entrée dédiée** — c'est un **module** : `Files.modules.taxonomy`,
et les icônes sont son `icons.spriteUrl`. Un profil déclarant l'ancienne clé racine est
**rejeté** par `npm run validate:profiles`.

⚠️ **Ce qu'un lecteur ne doit PAS attendre du profil enrichi.** `_buildEnrichedProfile` pose
exactement `basePath`, `_profileId`, `themes`, `mapping`, `layers`, plus le spread du profil de
base — **ni `taxonomy`, ni `icons`**. Les lire depuis `getActiveProfile()` renvoie `undefined`,
**en silence** : c'était la cause de deux bugs distincts (listes de catégories AddPOI, sprite
jamais mis en cache). Passer par la capacité (`GeoLeaf.Taxonomy.getLayerCategories`) ou par le
seam offline (`CacheStorage.loadProfileConfig`, qui hydrate `icons` depuis
`Files.modules.taxonomy`).

⚠️ **L'exemple ci-dessus est gardé.** `packages/core/__tests__/guards/doc-profile-examples.guard.test.js`
extrait tout bloc `Files` de cette fiche et le valide contre `profile.schema.json`. Un bloc qui
parle de `Files` sans parser fait **échouer** le test au lieu d'être sauté : un skip silencieux
se lit « tout va bien » alors que l'exemple le plus normatif du fichier n'a jamais été vérifié.

### Ordre de chargement

1. `geoleaf.config.json` → `data.activeProfile`.
2. `profile.json`, choisi selon le profil résolu (voir §Séquence de boot).
3. Si `profile.bundleFile` est déclaré → **un seul fetch** de `profile-bundle.json`, pré-fusionné
   par `scripts/lib/bundle-profiles.cjs`. ⚠️ Ce fichier **n'existe pas dans `profiles/`** : il
   est produit **dans le déployé** par `build-deploy.cjs`, qui patche au passage le
   `profile.json` copié pour y ajouter `"bundleFile"`. En `debug: true`, le bundle est ignoré
   et la cascade est chargée — édition à chaud sans rebuild.
4. Sinon, cascade : les fichiers `config/core/*` + les fichiers `Files.modules`, en parallèle,
   puis les configs de couches.
5. Documents de style : **à la demande**, au premier chargement de la couche
   (`LayerConfigManager.loadDefaultStyle`, appelé depuis `geojson/loader/single-layer.ts`). ⚠️ **Les
   configs de couche, elles, ne sont PAS paresseuses** — l'étape 4 les charge dans la même passe
   (`_loadLayerConfigs`), et cette ligne les annonçait à la demande tout en les ayant déjà données à
   l'étape précédente. En chemin bundle, les styles ne le sont pas davantage : `seedStyleDocuments`
   les amorce **avant** la fusion, parce qu'une couche peut réclamer le sien dès que le thème
   s'applique — l'amorçage ne doit pas courir après le premier rendu.
6. Données GeoJSON : selon la configuration de la couche.

### `modules.<id>` — la configuration d'un plugin est opaque au core

`modules.<id>.*` est la **seule** forme supportée. Le miroir bidirectionnel et le repli de
dépréciation posés à l'origine ont été retirés, en même temps que les interfaces de clés racine
dépréciées. `module-config.ts` n'expose plus que deux mécanismes :

- **`resolveModuleConfig()`** (porté par `Config.getModuleConfig`) — lit le bloc `modules.<id>` ;
  si le bloc existe il fait foi **en bloc**, sinon la valeur par défaut est rendue. **Aucun
  repli** sur une clé racine.
- **`mergeModulesBag()`** — fusionne **entrée par entrée** le bag `modules` d'un profil dans la
  config consolidée. Un remplacement en bloc perdrait les entrées déclarées par la config de
  boot pour d'autres plugins.

```javascript
GeoLeaf.Config.getModuleConfig("offline", "cache.enableProfileCache", true);
GeoLeaf.Config.get("modules.offline.cache.enableProfileCache"); // forme dot-notation équivalente
```

🛑 **`poiConfig` et `clusteringConfig` n'existent plus — cette ligne les donnait pour des features
core vivantes.** `poiConfig` est tombé avec la dissolution du sous-système POI (une POI est
désormais une couche point générique) ; `clusteringConfig` a été purgé le 25/07/2026 comme
**triplement mort** — aucune donnée ne la portait, aucun code ne la lisait, et le consommateur que
l'inventaire lui attribuait n'existait plus. ⚠️ Les occurrences qui subsistent dans
`capabilities/cluster/strategy.ts` sont une **variable locale homonyme** : `_resolveClusteringConfig`
lit `def.clustering`, l'override par couche. La configuration de clustering vit sous
`modules.cluster` (`profiles/_reference/config/plugins/cluster.json`), donc bien **dans**
`modules.*`, et non hors.
`features.schema.json` étant `additionalProperties: false`, un profil qui déclare l'une ou l'autre
est **rejeté** par `npm run validate:profiles`. Ce que `config/core/features.json` accepte encore se
lit au schéma, jamais ici :

```bash
node -e "const s=require('./profiles/schemas/features.schema.json'); console.log(Object.keys(s.properties).join(' '))"
```

### `layerManagerConfig.sections[]` — la config est AUTORITÉ, quel que soit l'ordre

Les sections du panneau COUCHES se déclarent en deux endroits qui doivent s'appairer : chaque
couche porte un `layerManagerId` (`layers.json`), et `ui.json` porte le `layerManagerConfig`
qui donne à chaque `id` son `label`, son `order` et son `collapsedByDefault`.

🛑 **L'invariant, et il n'est pas déductible du code appelé isolément** : une couche s'enregistre
**AVANT** que la configuration ne soit lue. `_registerGeoJsonLayer` crée donc la section manquante
avec des valeurs de remplissage — libellé i18n générique, `order: 10`, **pas** de
`collapsedByDefault` — et c'est `_applyLayerManagerConfig`, appelé plus tard depuis
`LayerManager.init()`, qui **écrase** ces trois champs. `items` n'est jamais touché.

**Ne pas rendre cette fusion « non destructive ».** Elle l'a été jusqu'au 14/08/2026 : sa garde
`else if (… && !existingSection.label)` était fausse par construction sur une section déjà remplie,
et `order` / `collapsedByDefault` n'étaient recopiés par aucune branche. Conséquence : tous les
titres configurés, tout l'ordre et **tous les accordéons** étaient perdus en silence.

⚠️ **Le mode de rendu tient au seul `typeof section.collapsedByDefault === "boolean"`**
(`render-sections.ts`). Une section sans ce drapeau n'est pas « un accordéon déplié » : c'est un
titre plat, sans flèche ni handler. `false` et `undefined` ne sont donc **pas** équivalents ici.

📌 Une section absente du `layerManagerConfig` conserve ses valeurs de remplissage — c'est le
repli, pas une erreur. Et le panneau COUCHES (`.gl-layer-manager`, kernel) n'est **pas** la
capacité `legend` (`.gl-map-legend`, un accordéon par couche visible) : les deux sont voisins dans
les onglets du panneau droit, et les confondre a déjà coûté une attribution de bug erronée.

### Le registre de panes — héberger un panneau que le kernel ne nomme pas

Les deux hôtes de panneau du cœur — le **panneau latéral droit** (≥ 1440 px) et le **sheet
mobile** (en dessous) — acceptent des panes déclarés de l'extérieur, par
`kernel/ui/panel-panes.ts`, exposé en `GeoLeaf.UI.registerPanelPane` / `openPane` / `closePane`.

| Membre                | Rôle                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `registerPanelPane()` | déclare `{ id, labelKey, selector, order?, onOpen? }` ; idempotent par `id`                  |
| `openPane(id)`        | montre le pane sur **l'hôte vivant**, quel qu'il soit ; **diffère** si aucun ne l'est encore |
| `closePane()`         | referme sur tous les hôtes vivants                                                           |
| `registerPaneHost()`  | côté cœur — une surface qui sait afficher un pane                                            |

L'hôte **déplace** le nœud désigné par `selector` — un seul nœud, un seul jeu d'écouteurs — et le
remet où il était à la fermeture. C'est exactement le geste déjà appliqué à `.gl-map-legend` et
`.gl-layer-manager`.

🛑 **`openPane` rend `false` sans avoir échoué, et c'est le cas NORMAL au boot.** Les deux hôtes se
construisent pendant le boot — le sheet par `initMobileToolbar`, le panneau par `initDesktopPanel` —
donc un plugin qui finit de charger avant eux ne trouve aucun hôte vivant. Le registre ne rend alors
pas la main : il réessaie à chaque frame, **borné** (`PENDING_OPEN_FRAMES`, `panel-panes.ts`), avec
une seule demande en attente à la fois, la dernière gagnant — deux clics rapides sur deux panes ne
doivent pas courir l'un sur l'autre. Sans ce report, le pane restait `display:none` **indéfiniment**,
mesuré encore caché quatre secondes après le clic. ⚠️ Ne pas câbler de message d'erreur sur le
`false` : il ne distingue pas « aucun hôte encore vivant » de « pane inconnu ». Et ne pas dé-borner
le report : un pane qui s'ouvre dix secondes après le clic tombe sur un utilisateur déjà parti,
ce qui est pire que de ne pas s'ouvrir.

🛑 **Les trois panes natifs — `filters`, `layers`, `legend` — n'y sont PAS**, délibérément. Ils
sont configurés différemment de chaque côté (le desktop lit `showFilters`/`showLayers`/
`showLegend` et trois titres, le sheet lit `getDefaultSheetTitles()`), et fondre deux formes dans
un registre unique aurait demandé de réécrire les deux hôtes pour prouver une symétrie dont aucun
n'a besoin. Les hôtes **concatènent** : leurs natifs, puis les panes déclarés. Les deux ensembles
sont disjoints par construction — il n'y a donc pas deux sources de vérité pour un même pane.

⚠️ **`priority` est explicite sur un hôte, et ne se déduit PAS de l'ordre d'enregistrement.** Un
hôte s'enregistre à l'import de son module, et `globals.ui.ts` importe la barre mobile **avant**
le panneau desktop. Au-dessus de 1440 px les deux sont vivants — la pill n'est masquée que par
CSS — de sorte que l'ordre décide si l'utilisateur reçoit un panneau ancré ou un sheet plein
écran par-dessus sa carte. Mesuré à 1600 px avant que le champ existe : `openPane` répondait
`true`, `getOpenPanel()` répondait `null`, et le sheet s'était ouvert. Le desktop est à `0`, le
sheet à `10`.

⚠️ **`onOpen` est ce qui rend le registre utilisable.** Un propriétaire construit son panneau à la
première demande — bâtir du DOM que personne n'a réclamé est du gaspillage —, or le clic sur
l'onglet va au **cœur**, jamais au propriétaire. Sans ce crochet l'onglet s'activait sur un pane
vide ; mesuré dans un navigateur, pas déduit. Il doit être idempotent : il part à chaque ouverture.

📌 **Le cœur ne nomme aucun plugin** — c'est le plugin qui s'enregistre, donc
`verify-core-standalone.cjs` reste vert. `plugins/table` avait déjà buté sur l'absence de ce
registre et posait `id = "gl-rp-pane-table"` sur un panneau à lui, uniquement pour satisfaire un
`aria-controls` qui pointait vers un pane inexistant.

### Le mode immersif — retirer le chrome sans nommer qui le demande

`kernel/ui/immersive.ts` → `setImmersive(on, { fullscreen })` et `isImmersive()`, montés sur
`GeoLeaf.UI`. Livré le 27/08/2026. **Même geste que le registre de panes ci-dessus** : le kernel
offre un mécanisme, et n'apprend jamais qui s'en sert — donc `verify-core-standalone.cjs` reste
vert et `no-plugin-in-core` tient.

Le mode pose `gl-immersive` sur `<body>` ; `css/geoleaf-ui-base.css` y masque le chrome que **le
kernel possède** : les deux conteneurs de thèmes, le panneau de droite, la barre de proximité, et
le point d'entrée du filtre par son **rôle** (`[data-gl-role="filter-toggle"]`).

⚠️ **Pas par `#gl-filter-toggle`** : cet id n'est créé nulle part dans le cœur, il est écrit en
dur dans la page hôte, et le cœur ne fait que le lire. Une règle du cœur sur un id qu'il ne
possède pas est morte, en silence, chez tout intégrateur qui nomme son bouton autrement.

🛑 **Le `!important` de ces règles tient à l'INVERSION DES COUCHES, pas à la spécificité.**
`geoleaf-ui-base.css` entre en `layer(gl.kernel)` et le CSS des capacités en `gl.capabilities`,
déclarées dans cet ordre. Pour les déclarations **normales**, la couche la plus tardive gagne —
`gl.capabilities` battrait le kernel. Pour les `!important`, **l'ordre s'inverse** et le kernel
l'emporte. Or `theme-selector.css` porte `display: block !important` sous 768 px : sans
`!important`, le masquage échouerait **en mobile seulement**. 📌 Conséquence assumée — ces règles
battent aussi `gl.overrides`, le point d'entrée de l'intégrateur, qui ne peut les reprendre que
depuis une feuille **hors couche**. Acceptable pour un mode ; pas pour un style.

🛑 **Le plein écran vise `document.documentElement`, jamais `.gl-main`.** Le bouton de la barre
pilule, lui, vise `.gl-main` — c'est un autre geste (« que la carte remplisse l'écran ») et il
n'est pas recâblé. La différence n'est pas cosmétique : **un élément hors du sous-arbre plein
écran n'est pas mal placé, il n'est PAS rendu.** Le conteneur de notifications est ajouté à
`document.body`, comme le panneau POI, le panneau d'itinéraire, la modale de partage et les
bannières PWA. Un plein écran sur `.gl-main` **éteindrait les toasts** — au moment précis où un
guidage se met à signaler une perte de GPS ou un recalcul impossible.

⚠️ **La revendication du plein écran est SUIVIE**, parce que le DOM ne la porte pas :
`document.fullscreenElement` dit que la page l'est, jamais qui l'a demandé. Deux appelants peuvent
désormais le faire — ce module et le bouton de la barre —, donc on ne sort que si l'on est entré.
Un `Échap` de l'utilisateur relâche la revendication **sans** annuler le mode : quitter le plein
écran ne met pas fin à ce qui a demandé le mode, et rendre le chrome en pleine session serait une
seconde surprise par-dessus la première.

### Profils présents dans le dépôt

Le dépôt livre **`tourism`** et **`reunion-eclairage`**, deux profils de démonstration, plus
**`_reference`**, qui n'est pas une démonstration mais l'échantillon exhaustif contre lequel se
lisent les formes de configuration — `build-deploy.cjs` l'écarte du déployé comme tout répertoire
préfixé `_`. Un profil métier ne s'ajoute pas ici : il se fabrique en suivant
[`docs/specs/contrats/PROFILE_CONTRACT_SPEC.md`](contrats/PROFILE_CONTRACT_SPEC.md).

📌 **Deux profils livrés est une propriété, pas un hasard**, et deux mécanismes en dépendent :
le **sélecteur de profil** ne se laisse éprouver qu'à partir de deux (`e2e/24-profile-switcher`),
et `reunion-eclairage/ign-plan-3d` est le **seul fond vectoriel** du dépôt, donc le seul qui
puisse être servi hors ligne ([`docs/specs/capacites/offline.md`](capacites/offline.md) §Arbitrage du stockage). Descendre à un
profil livré éteint les deux, silencieusement pour le premier.

⚠️ **Aucun compte n'est écrit dans cette section, et c'est délibéré.** Elle a annoncé « deux
profils métier » du 27/07/2026 au 10/08/2026, en les nommant ; `reunion-eclairage` est ensuite
parti au passage public — comme profil **client** — puis **revenu le 10/08/2026**,
neutralisé de toute mention de son exploitant et requalifié en profil de démonstration. Un compte
en dur ne se serait vu vieillir ni à l'aller ni au retour. Le compte fait foi à la commande :

```bash
npm run validate:profiles
```

---

## Contrat exposé

### Ce que cette section fait, et ne fait pas

Elle **ne recopie aucune signature**. Les signatures sont dérivées du TSDoc par TypeDoc
(`npm run docs:api -w packages/core`) ; les recopier ici recréerait exactement le doublon que
la refonte documentaire supprime. Ce qui suit est ce que TypeDoc ne sait pas dire : **où les
choses se montent, et par quel canal**.

### Les trois canaux, et leur asymétrie

| Canal                            | Ce qui y vit                                                                                                                                                                        | Monté par                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Exports ESM nommés**           | ce que `bundle-esm-entry.ts` ré-exporte, l'essentiel via `kernel-exports.ts`                                                                                                        | le bundler, à l'import                                                            |
| **Namespace global `GeoLeaf.*`** | la surface CDN, typée dans `src/global.d.ts`                                                                                                                                        | phase A pour le kernel, `registerGlobals(gl)` des `install.ts` pour les capacités |
| **Sous-chemins `types`-seuls**   | les contrats d'extension (`@geoleaf/core/contracts/*.contract.js`) — le compte se dérive de la map `exports`, il ne se recopie pas : il disait **6** pour **8** jusqu'au 11/08/2026 | la map `exports` du `package.json`                                                |

⚠️ **Les deux premiers canaux ne se recouvrent pas.** Certains namespaces runtime ne sont pas
des exports ESM, et certains exports ESM ne sont pas montés sur le global. Un document qui
présente l'un comme la liste de l'autre est faux par construction — c'est ce qui a fait diverger
`API_REFERENCE.md` de la sortie TypeDoc. Les listes se mesurent :

```bash
grep -nE "^export" packages/core/src/bundle-esm-entry.ts packages/core/src/kernel-exports.ts
ls packages/core/src/api/geoleaf.*.ts
```

⚠️ **Le kernel ne peut pas suivre le `registerGlobals()` des capacités.** Celui-ci tourne à
l'appel de `boot()` (Pass 1) ; la phase A du kernel doit tourner à l'**import du bundle**, car
les plugins ESM appellent `GeoLeaf.I18n.registerDict()` à leur propre top-level, avant.
**Asymétrie légitime** : le kernel est le **substrat**, pas une capacité —
`contracts/preset.contract.ts` le dit déjà (_« The kernel is implicit — never listed here »_).

### Contrats

`packages/core/src/contracts/` porte les interfaces partagées. Ce sont des **surfaces de types
pures** : ni export de valeur, ni import non-type, ni instruction top-level — gaté par
`scripts/check-contracts-pure.cjs`, en pre-commit comme en `ci:local`. Leur liste et leur
nombre se dérivent de la map `exports` du `package.json`, ils ne se recopient pas — c'est
précisément ici que « **6** pour **8** » a survécu à sa propre correction, posée vingt-cinq
lignes plus haut le 11/08/2026 et jamais propagée jusqu'à ce paragraphe :

```bash
node -p "Object.keys(require('./packages/core/package.json').exports).filter(k => k.includes('contracts'))"
```

On en ajoute quand on veut ; **on n'en retire jamais**.

⚠️ **`ICoreModule` est l'union `ILifecycleModule | IUISlotModule`.** Il déclarait
`dependencies`/`init`/`destroy` comme obligatoires alors que `ModuleRegistry.register()` accepte
depuis toujours `{id, ui}` — le contrat publié tel quel aurait rejeté huit sites d'appel réels.
TypeScript refusant `implements` sur une union, les classes de cycle de vie déclarent
`implements ILifecycleModule`.

### Événements

Deux cartes, et la distinction est porteuse :

- **`GeoLeafEventMap`** — les événements typés du bus assaini. Ils survivent au
  `JSON.parse(JSON.stringify())` que le bus applique.
- **`GeoLeafRawEventMap`** — **trois** clés y vivent, et volontairement : `geoleaf:toolbar:action`
  (`element: HTMLElement`), `geoleaf:layer-manager:panel` (trois nœuds) et, depuis le 14/08/2026,
  `geoleaf:popup:action` (`button`, plus `setBusy()` et `close()`). Aucune ne survit à la
  sérialisation. Les placer dans la première carte aurait rendu `dispatchGeoLeafEvent` type-légal
  et **runtime-faux**.
  ⚠️ Cette ligne disait « `geoleaf:toolbar:action` y vit **seul** » jusqu'au 14/08/2026, et elle
  était **déjà fausse à deux clés** avant qu'une fusion n'en ajoute une troisième — le critère
  d'admission n'est d'ailleurs pas « le payload n'est pas clonable » mais « **au moins un champ**
  ne l'est pas », `popup:action` en portant cinq qui le sont.

`Events.on/off/once` accepte les deux cartes ; **l'émission par `dispatchGeoLeafEvent` reste
sérialisable, celle des clés brutes se fait en `CustomEvent` nu.** Le reliquat non
typé est **borné et décroissant**, tenu par la baseline
`scripts/.baselines/event-map-coverage.json` et la gate `check-event-map-coverage.cjs`. Les
comptes des deux côtés se lisent là :

```bash
grep -oE '"geoleaf:[A-Za-z0-9:_-]+"' packages/core/src/contracts/event-bus.contract.ts | sort -u
node -p "require('./scripts/.baselines/event-map-coverage.json').count"
```

### Typage du namespace

`src/global.d.ts` porte le contrat du namespace global. La couverture de typage est gatée par
`scripts/check-namespace-typing-coverage.cjs` (HOST-04/05/06) et la synchronisation
`GeoLeafHost ⊆ GeoLeafGlobal ⊆ oracle post-boot` par `scripts/verify-host-contract-sync.cjs`.

⚠️ **Les membres sont référencés un par un, jamais par `extends`.** Les lecteurs d'AST
n'itèrent que `node.members` : des membres hérités disparaîtraient de la vue de **toutes** les
gates du namespace. `scripts/lib/ts-decl-read.cjs` refuse désormais de conclure sur une clause
`extends`.

⚠️ **Deux trous distincts, que cette ligne confondait sous « absents de `global.d.ts` ».**
`Table` et `Geocoding` y sont **déclarés** — dans le bloc des namespaces de plugin posé le jour
même où la traîne `[key: string]: unknown` est tombée — mais déclarés `?: unknown` : visibles
des gates, sans contenu dérivable. `Popup`, lui, n'y figure pas du tout, alors que
`GeoLeaf.Popup.registerActionHandler` est nommé dans `contracts/event-bus.contract.ts` : c'est
le seul des trois qu'aucun lecteur d'AST ne peut même énumérer. Le gisement des membres restés
`unknown` se mesure, il ne se recopie pas :

```bash
grep -nE '\?: unknown;' packages/core/src/global.d.ts
```

### Typage publié

Ce que npm sert comme typage est le `dist/types/` **produit par le build**, atteignable par une
condition `types` dans la map `exports`. **Aucun `.d.ts` maintenu à la main ne fait partie du
contrat public** (ADR-14). Mécanisé par `scripts/verify-published-types.cjs` et
`packages/core/examples/consumer/published-types.ts`, qui résout les paquets typés **à la
compilation**, comme le ferait un intégrateur.

---

## Décisions de conception

Les ADR sont numérotés historiquement ; l'ordre n'est pas chronologique et les numéros ne se
réattribuent pas. Les décisions périmées sont **annotées, jamais supprimées** — un ADR qu'on
efface laisse un code inexpliqué.

| #          | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pourquoi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Alternative écartée                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADR-01** | Toutes les opérations cartographiques passent par `IMapAdapter` ; hors `adapters/maplibre/**`, aucun import **de valeur** de `maplibre-gl` — `import type` reste ouvert partout, et le global `maplibregl` injecté est la voie explicitement laissée. `capabilities/**` n'a droit ni à l'un ni à l'autre : lui importer `adapters/maplibre/*` est interdit à part. Les deux blocs `no-restricted-imports` d'`eslint.config.mjs` portent la règle et son motif | testabilité (l'adapter se mocke) et remplacement du moteur sans toucher au métier                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | appeler MapLibre directement — coût nul à court terme, couplage total à long terme                                                                                                                                                                                       |
| **ADR-02** | `packages/core/src/` ne référence aucun plugin (`no-plugin-in-core`)                                                                                                                                                                                                                                                                                                                                                                                          | frontière d'**architecture** : le core reste autonome et tree-shakeable, et son graphe ne dépend d'aucun paquet optionnel. La règle ne s'appuie sur aucune propriété des plugins autre que le fait qu'ils sont des plugins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | laisser le core connaître ses plugins — couplage total, tree-shaking perdu, et une capacité qu'on croit optionnelle devient obligatoire                                                                                                                                  |
| **ADR-03** | ESM seul, plus d'UMD depuis la v2.0.0                                                                                                                                                                                                                                                                                                                                                                                                                         | ⚠️ **révisé — la décision tient, sa justification était fausse pendant trois ans.** Le motif écrit était « MapLibre GL JS ≥5 est ESM-only » : c'était **faux de la v5**, qui déclarait `main: dist/maplibre-gl.js` sans `module` ni `exports` — un script classique (constaté le 08/08/2026). La prémisse est **redevenue vraie le jour même** avec MapLibre 6, réellement ESM-only et qui ne publie plus aucun bundle UMD. Une décision juste pour une mauvaise raison est exactement ce que ces annotations existent pour tracer                                                                                                                                                                                                                                                                                    | garder UMD pour les intégrations `<script>` classiques                                                                                                                                                                                                                   |
| **ADR-04** | Le runtime est ordonné par tri topologique (Kahn) sur `ICoreModule.dependencies`                                                                                                                                                                                                                                                                                                                                                                              | l'ordre de déclaration ne détermine pas l'ordre d'exécution ; le graphe, si                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ordre manuel dans `boot.ts` — la source des bugs d'initialisation que l'ADR a fermés                                                                                                                                                                                     |
| **ADR-05** | `globals.storage.ts` (B8) est importé **après** `globals.ui.ts` (B9), contre la numérotation                                                                                                                                                                                                                                                                                                                                                                  | le bouton cache s'accroche à un DOM qui doit exister                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | respecter l'ordre numérique — provoque un crash                                                                                                                                                                                                                          |
| **ADR-06** | Deux **natures** de code, pas deux sous-répertoires : **kernel** (`kernel/<domaine>`, toujours dans le graphe, aucune gate) et **capacité in-core** (`capabilities/<id>/`, gate `modules.<id>` — quand il y en a une, et le régime se déclare)                                                                                                                                                                                                                | ⚠️ **révisé** — l'ADR décrivait `modules/built-in/` vs `modules/optional/`, un répertoire **supprimé** ; il est resté faux treize jours dans le document lu en référence à chaque session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | garder la dichotomie `built-in`/`optional`. Le tree-shaking a survécu mais a **changé de mécanisme** : ce n'est plus un répertoire que le build saute, c'est l'installer qui **possède son CSS** et le tire lui-même — le sauter retire le code _et_ la feuille de style |
| **ADR-07** | Les boutons d'action en popup ne laissent qu'un **canal événementiel** (`geoleaf:popup:action`)                                                                                                                                                                                                                                                                                                                                                               | le rendu popup est passé à `@geoleaf-plugins/feature-info` ; plus rien n'invoquait le registre de handlers, devenu un no-op silencieux                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | garder `GeoLeaf.Popup.registerActionHandler`/`runAction`/`bindPopupActions` — retirés                                                                                                                                                                                    |
| **ADR-08** | Deux phases, **une seule manière chacune** : les façades à l'import (phase A), le runtime au registry (phase B)                                                                                                                                                                                                                                                                                                                                               | ⚠️ **révisé** — le texte d'origine interdisait un changement qu'un sprint antérieur avait **déjà livré**, et attribuait la panne S4 à `loadConfig()` alors que le déclencheur réel était un **log de debug** lisant `_APIController`, dont l'accesseur **construit** le contrôleur à l'évaluation du bundle. Le backlog a recopié la mauvaise cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | « registry = seul driver du boot » — **impossible**, pas seulement risqué : les façades sont un prérequis du registry                                                                                                                                                    |
| **ADR-09** | Un **module** est interne (cycle de vie, graphe de dépendances, bundlé) ; un **plugin** est externe (enregistré au runtime, bundle séparé, métadonnées `requires`/`optional`)                                                                                                                                                                                                                                                                                 | les modules **participent** à l'ordre d'init, les plugins **non** — enregistrement plat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | un mécanisme d'extension unique : il aurait fait entrer des extensions optionnelles dans le graphe critique                                                                                                                                                              |
| **ADR-10** | `domCreate()` est la fabrique DOM canonique du core                                                                                                                                                                                                                                                                                                                                                                                                           | type de retour précis (`HTMLElementTagNameMap[K]`) et paramètre `parent` positionnel. ⚠️ **Les chiffres de la rédaction initiale n'étaient reproductibles ni à HEAD ni au commit qui l'a rendue**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `createElement`/`$create`. ⚠️ La bascule **n'est pas mécanique** : les sites `$create` utilisent des props que `domCreate` ne traite pas du tout (`className`, `textContent`, `attributes`, `id`, `dataset`, handlers). Elle suppose d'**étendre** `domCreate` d'abord   |
| **ADR-11** | Le core **n'importe pas** `@geoleaf/host-runtime` ; la dépendance est à sens unique (plugin → host-runtime)                                                                                                                                                                                                                                                                                                                                                   | ce paquet lit `globalThis.GeoLeaf`, un namespace que **ce core assemble lui-même** — l'importer, c'est se relire à travers son propre shim client. Et le core a déjà `getGeoLeaf()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | migrer les copies de `coreConfigGet` vers `host-runtime` y compris côté core, comme la roadmap le demandait à la lettre. La duplication a bien été supprimée, mais **en intra-core**                                                                                     |
| **ADR-12** | `public-api.ts` **expose**, il n'implémente pas — deux patrons conformes (ré-export pur, fabrique `buildPublicApi`)                                                                                                                                                                                                                                                                                                                                           | mécanisé par `scripts/check-facade-purity.cjs`, **sans baseline**. ⚠️ **Enseignement principal** : cinq paquets excluaient leur façade de la couverture ; y loger l'implémentation la rendait **invisible**, et la conformation l'a fait apparaître à 0 %                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | réutiliser telle quelle la grammaire du core, qui rejette toute fonction locale — elle flaggerait `buildPublicApi` lui-même                                                                                                                                              |
| **ADR-13** | Dans `@geoleaf/field-renderer`, le vocabulaire de **rendu** appartient à la lib, celui de **formulaire** (`form.*`) à l'hôte                                                                                                                                                                                                                                                                                                                                  | router les dictionnaires de rendu créerait une dépendance de la lib envers ses hôtes ; un troisième hôte rendrait des jours vides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | router les 3 dictionnaires vers les catalogues hôtes                                                                                                                                                                                                                     |
| **ADR-15** | `Core.reattach()` déplace le **conteneur de carte**, et **rien d'autre** — les panneaux de la coquille ne suivent pas                                                                                                                                                                                                                                                                                                                                         | deux contraintes, l'une du moteur et l'autre d'architecture. ① MapLibre **mémorise l'élément passé à la construction** : déplacer les enfants du conteneur au lieu du conteneur lui-même laisserait `map.getContainer()` pointer l'ancien nœud, et toute mesure ultérieure fausse — c'est exactement le contournement que l'aval avait dû écrire faute de poignée sur la carte. ② `#gl-right-panel` et ses voisins vivent dans `glMain`, hors du conteneur : les faire suivre rendrait l'API **dépendante du DOM de la coquille**, le couplage même qu'elle sert à supprimer. Le remontage est donc du ressort de l'hôte, par trois exports déjà publics (`UI.destroyDesktopPanel()` → `initDesktopPanel()` → `activateDesktopPanel()`), et le TSDoc le dit — sans cette phrase l'intégrateur reproduit le patch aval | faire suivre les panneaux — couplage de l'API au DOM de la coquille ; ou déplacer les enfants du conteneur — bug de `getContainer()` importé tel quel                                                                                                                    |
| **ADR-14** | Le contrat de typage publié est **généré**, jamais écrit à la main                                                                                                                                                                                                                                                                                                                                                                                            | un `index.d.ts` racine de 847 lignes a été traité comme le contrat public par quatre sprints — il n'était le `types` d'aucun paquet et **n'était compilé par rien**, donc il avait dérivé librement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | maintenir un `.d.ts` de façade à la main                                                                                                                                                                                                                                 |

⚠️ **Une croyance testée et infirmée, consignée parce qu'elle circule** : « la condition `types`
doit être la première, sinon elle n'est jamais lue ». **Faux sur cette chaîne d'outils** —
mesuré. Ce qui protège de `TS7016`, c'est la **présence** de la condition, pas sa position. La
convention « `types` en premier » est conservée pour l'uniformité, et le gate le dit.

---

## Dépendances et frontières

### Où va une fonctionnalité neuve — kernel, capacité ou plugin

Les trois frontières ci-dessous disent ce qu'un côté a le droit d'importer. Celle-ci dit de
**quel côté on atterrit**, et elle se tranche avant d'écrire la première ligne. Doctrine issue
de la session d'idéation du 04/07/2026, versée ici le 01/08/2026 depuis
`rapport_decisions-architecture.md` — elle n'avait aucun domicile dans `specs/`, et un
classement qui ne vit que dans un rapport daté se refait de mémoire au sprint suivant.

**Deux axes, pas un.** On les confond souvent, et c'est ce qui produit les mauvais classements :

- **Le lien au noyau** — `import` de contrats publics + enregistrement au registry typé
  (refactor-safe, tree-shakeable, composable au build) = **capacité**. Accès runtime par le seam
  `globalThis.GeoLeaf.*`, zéro couplage compile-time = **plugin**.
- **Le moment de livraison** — inline dans le boot, chunk dynamique `import()`, ou script
  externe / lazy. ⚠️ C'est un axe **indépendant** du premier : une capacité peut être un chunk.

| Couche                     | Lien              | Livraison                          | Contenu                                                                                                    |
| -------------------------- | ----------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Kernel**                 | —                 | inline, toujours                   | moteur géométrique, adapter MapLibre, registries, config, sécurité, event-bus, moteur de thème, `notify()` |
| **Capacité** (first-party) | typé compile-time | inline _ou_ chunk selon l'ubiquité | les enrichissements quasi-universels ou légers                                                             |
| **Plugin** (tiers-capable) | seam runtime      | script externe _ou_ lazy           | optionnel, lourd en dépendances, écrit par un tiers, ou adossé à un backend                                |

**La grille, dans l'ordre — la première réponse « oui » tranche :**

1. Couplé aux internals (rendu, sécurité, boot) ? → **kernel**
2. Un tiers pourrait l'écrire sans aide ? → **plugin**
3. Grosse dépendance (flexsearch, GDAL, flatgeobuf, qrcode) ? → **plugin**, ou capacité-**chunk**
   pour isoler la dépendance
4. Utilisé par ~tout le monde ? → **capacité inline**
5. Commun mais pas universel, moyennement lourd ? → **capacité chunk dynamique**

⚠️ **Aucun mécanisme nouveau n'est à inventer pour l'axe 2** : `ICapabilityDeclaration`
(`packages/core/src/contracts/capability.contract.ts`) exprime déjà les deux régimes par son
champ `loader?` — absent = embarqué et gaté au runtime par `isEnabled()`, présent = chunk.

⚠️ **Le point contre-intuitif, celui qui fait rater la question 4.** Pour du code **toujours**
embarqué, le plus performant n'est pas un lazy plus malin — c'est de **ne pas découper** : en
inline, avec un gate booléen. Le chunk ne gagne des octets que si le code est
**conditionnellement** livré. Traiter une capacité quasi-universelle en `<script>` externe eager
cumule les inconvénients : même payload, requête HTTP en plus, couplage par le seam, et le piège
de câblage déjà touché deux fois.

⚠️ Cette phrase a porté « (inline + gate booléen) » et Prettier l'a **cassée** : au reflow, le `+`
est tombé en début de ligne, a été lu comme une puce et normalisé en `-`, laissant une
parenthèse jamais refermée et un bullet parasite au milieu du paragraphe. Ne pas remettre de `+`
en tête de ligne dans ce document — la formulation ci-dessus n'en offre plus l'occasion.

**Le principe qui gouverne le contenu du kernel** : natif dessous, déclaratif dessus. Ne pas
exposer MapLibre brut (sinon l'intégrateur utiliserait MapLibre directement, et il n'y a plus de
produit) ; ne pas réimplémenter le moteur (rendu, cluster, sources, popup, events sont GPU et
plus rapides que tout portage). Le kernel est un **traducteur mince** : profil JSON → sources,
couches et expressions natives, plus ce que le natif n'a pas — rendu d'attributs, tooltip et
sidepanel, no-code, orchestration.

### La frontière `capabilities/` → `kernel/` (règle R.8)

`capabilities/**` ne peut pas importer profondément sous `kernel/**`. Trois routes seulement :
le **baril** du sous-système, un **hub de types** `*-types.ts`, ou un **seam**. Élargir un
baril est le geste que la règle désigne — il est explicite, et se motive sur place.

### La frontière core → plugins (`no-plugin-in-core`)

Gate `scripts/verify-core-standalone.cjs`, bloquant en CI (push **et** pull request), en
pre-commit et dans `ci:local`. Il couvre la direction core → plugins et, symétriquement,
`connector` → plugins.

⚠️ **C'est une frontière d'architecture.** Elle garantit que le core reste autonome et
tree-shakeable, et ne dépend d'aucune propriété des plugins autre que le fait qu'ils sont des
plugins.

**Conséquences de forme** : les fonctionnalités de plugin sont injectées dans le namespace au
runtime via le `PluginRegistry`, jamais par import statique ; un plugin ne peut pas voir sa
configuration déclarée, validée ou défautée par le core — invariant `INV-FRONT` du Plugin
Contract v1, dont le domicile est [`docs/specs/contrats/PLUGIN_ARCHITECTURE_SPEC.md`](contrats/PLUGIN_ARCHITECTURE_SPEC.md).

### La frontière lib / app

`apps/geoleaf-app/` est l'**application déployable** et la source unique et irremplaçable des
variantes de `deploy/` : `index.html`, `init.js`, `manifest.json`,
`connector.local.example.js`, `src/assets/icons/`. Le workspace est `private: true` et n'a
délibérément ni `files[]`, ni script `test`/`build`, ni `vitest.config.ts`. Contrat gardé par
`scripts/verify-app-template.cjs`.

⚠️ **Cette ligne a écrit « des trois variantes LIVRÉES » — deux erreurs dans trois mots.** Deux
variantes sont livrées (`deploy-core`, `deploy-full`) ; `deploy-coverage` et `deploy-local` ne le
sont pas. Le décompte se lit avec `ls deploy/`, il ne se recopie pas. **`deploy-local`** est la
variante de poste (`npm run build:deploy:local`) : elle seule reçoit `connector.local.js`, porteur
d'un jeton, et elle seule conserve la balise qui le charge — un livrable n'a **ni le fichier, ni la
moindre référence à lui**. Invariants tenus par `scripts/verify-deploy-no-secrets.cjs` (DNS-02) et
`APP-11`, détaillés dans `specs/plugins/CDC_connector.md`.

⚠️ Plusieurs de ses invariants protègent des formes **mono-ligne** que `build-deploy.cjs` patche
par regex `/gm` sans flag `/s` : **ne jamais laisser Prettier reformater `index.html`**, et ne
pas ajouter `apps/**/*.html` à `lint-staged`. Lesquels ne se recopient pas — ils se lisent à la
source, qui les nomme :

```bash
grep -nE 'on ONE$|on ONE line|UNE seule ligne' scripts/verify-app-template.cjs
```

### Les chemins de package ne se codent jamais en dur

Un chemin `packages/<nom>` écrit en dur ne casse pas au déplacement : il **cesse silencieusement
de matcher**, et la gate concernée sort verte en n'ayant rien scanné. Passer par
`scripts/lib/packages.cjs`, qui **jette** ; `scripts/probe-gate-visibility.cjs` surveille cette
classe de défaut.

### Dépendances externes

MapLibre GL JS ≥6.0 est une **peer dependency externe**, hors bundle. ⚠️ Depuis la v6, le
moteur est **ESM-only** : il ne publie plus de bundle UMD, n'expose plus le global `maplibregl`
— reposé par le shim `vendor/maplibre-gl/global.mjs` — et se présente en **graphe de trois
modules**, dont deux ne sont nommés dans aucun markup (d'où la clôture de `scripts/lib/boot-assets.cjs`,
qui les fait entrer au pré-cache du service worker).

Le budget du kernel est la **clôture transitive des imports statiques** depuis l'entrée, pas
l'entrée seule. ⚠️ **Ne pas appeler `geoleaf.esm.js` « un shim »** — c'est l'entrée _granulaire_
(`dist/esm/`) qui en est un ; sur l'entrée plate, l'étiquette a accompagné un chiffre faux d'un
facteur ~150 sans qu'aucune gate ne le voie. Échec de build au-delà de 300 KB gz, alerte au-delà
de 270 KB gz :

```bash
npm run size
```

---

## Annexe — Glossaire

| Terme                  | Définition                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profil**             | ensemble de fichiers JSON définissant un contexte métier complet                                                                                                                                                                                                                                                                                                                                                                                    |
| **Façade**             | fichier qui expose un domaine sur `GeoLeaf.*` sans l'implémenter — `api/geoleaf.*.ts` côté kernel, `capabilities/<id>/public-api.ts` côté capacité. Les deux familles se comptent : `ls packages/core/src/api/geoleaf.*.ts packages/core/src/capabilities/*/public-api.ts`                                                                                                                                                                          |
| **Globals**            | fichiers `globals/globals.*.ts` qui peuplent `window.GeoLeaf.*` en side-effect, à l'import                                                                                                                                                                                                                                                                                                                                                          |
| **Phase A / phase B**  | les façades à l'import du bundle / le runtime au `ModuleRegistry`                                                                                                                                                                                                                                                                                                                                                                                   |
| **Capacité in-core**   | `capabilities/<id>/` — logique, déclaration `<id>-capability.ts` et installer, plus un `css/` et une façade `public-api.ts` quand la capacité en a. ⚠️ Elle n'est PAS auto-contenue sur ses tests : aucun n'y vit, ils sont sous `packages/core/__tests__/capabilities/`. Et le défaut du gate `modules.<id>` n'est pas uniforme — opt-out, opt-in ou aucun gate global : `grep -rn -A3 'gate: {' packages/core/src/capabilities/*/*-capability.ts` |
| **Installer**          | `capabilities/<id>/install.ts` — le point d'ancrage unique d'une capacité dans un manifeste de preset                                                                                                                                                                                                                                                                                                                                               |
| **Preset / manifeste** | la liste des installers qu'une entrée de bundle embarque (`presets/manifest.full.ts` pour le bundle livré)                                                                                                                                                                                                                                                                                                                                          |
| **Seam**               | contrat d'inversion de dépendance : un consommateur pousse sa contribution au lieu d'être importé                                                                                                                                                                                                                                                                                                                                                   |
| **Baril de médiation** | `index.ts` d'un sous-système kernel — la porte principale que R.8 laisse aux capacités, mais **pas la seule** : la règle laisse aussi passer les hubs de types (`*-types.js`), les seams (`*-seam.js`) et `config-primitives.js`. Le message de la règle les énumère : `grep -n "must not reach deep into kernel" eslint.config.mjs`                                                                                                                |
| **ICoreModule**        | union `ILifecycleModule \| IUISlotModule` — un module de cycle de vie ou un slot UI                                                                                                                                                                                                                                                                                                                                                                 |
| **IMapAdapter**        | interface d'abstraction du moteur cartographique, engine-agnostic                                                                                                                                                                                                                                                                                                                                                                                   |
| **StyleRules**         | tableau de règles conditionnelles attribut → style, déclaré en JSON                                                                                                                                                                                                                                                                                                                                                                                 |
| **Terrarium**          | encodage DEM terrain (AWS/Mapzen) : altitude encodée en RGB                                                                                                                                                                                                                                                                                                                                                                                         |
| **FlatGeobuf**         | format binaire géospatial à index R-tree, streaming par bbox                                                                                                                                                                                                                                                                                                                                                                                        |
| ~~**ESM Lite**~~       | **terme mort** — le build réduit figé n'existe plus. Conservé pour que le mot, présent dans d'anciens enregistrements, soit reconnu comme périmé                                                                                                                                                                                                                                                                                                    |
| ~~**Lazy chunk**~~     | **terme mort au sens du kernel** — `src/lazy/` n'existe pas. Seuls des `import()` ponctuels subsistent                                                                                                                                                                                                                                                                                                                                              |

---

## Annexe — Historique des révisions

| Version   | Date               | Auteur        | Modifications                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4.3.1** | 1er septembre 2026 | Claude Opus 5 | **Re-vérification d'UN commit, et c'est le piège structurel de toute clôture.** `SPECS-FRESH` a rougi à distance sur cette fiche alors qu'un `ci:local` **110/110** venait de la déclarer à jour : le commit de clôture lui-même touchait `packages/core/src/global.d.ts`, donc le sujet de cette fiche. ⚠️ **Un verdict de fin de lot mesure l'état d'AVANT sa propre clôture** — la consigne d'atelier §Conduite de roadmap le pose déjà (« relancer APRÈS le commit de clôture »), et c'est la deuxième fois que ce dépôt le paie. Ici le local ne pouvait PAS le voir : il a été lancé avant que le commit existe. ✅ **Le commit en question ne change qu'un COMMENTAIRE** de `global.d.ts` — retrait de `Cluster` d'une liste de capacités « sans type public nommé », alors que la déclaration trois lignes plus bas importe `ClusterPublicApi` depuis sa création. Aucune déclaration, aucun type, aucun comportement ne bouge ; le §Contrat exposé et le §Dépendances et frontières décrivent la couverture de typage et le contrat du namespace, tous deux intacts. `Vérifié contre` est donc avancé sur une re-lecture réelle, pas sur une présomption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **4.3.0** | 1er septembre 2026 | Claude Opus 5 | **BALAYAGE COMPLET — le document était à 219 commits de son sujet, et `Vérifié contre` est avancé pour la première fois depuis la 4.0.0.** Les sept tranches ont été re-vérifiées phrase à phrase contre le code, chaque assertion re-mesurée : **286 tenaient encore**, **32 étaient fausses**. Le motif dominant n'est pas la péremption brutale mais **l'énoncé plus large que sa preuve** — une formule absolue que le détail infirme, là où le mécanisme décrit reste juste. ⚠️ **46 corrections ont été proposées, 14 REJETÉES après contre-épreuve**, et les motifs de rejet valent d'être connus car ils se reproduiront : ① un **témoignage daté** réécrit comme s'il décrivait le présent — « la version PRÉCÉDENTE annonçait 18 capacités (il y en a 21) » n'est pas une assertion au présent, c'est la valeur vraie au moment du récit ; ② une mesure qui **reproduit sans falsifier** — `packages/core/src/` nomme bien `@geoleaf-plugins/*` en 43 endroits, mais `SYNC-01` exempte délibérément les lignes de commentaire et le typage de `GeoLeafGlobal` EXIGE de nommer les namespaces ; ③ des chemins jugés morts parce qu'**ancrés à la racine du dépôt** alors que la prose de ce document les cite relatifs à `docs/`. 🛑 **Le geste qui n'a pas été fait, et c'est le principal** : `Vérifié contre` n'a pas été avancé AVANT la relecture. La gate `SPECS-FRESH` le dit d'elle-même — « une fiche à zéro est structurellement fraîche, jamais vraie ; on peut bumper le champ sans relire une ligne » —, donc l'avancer sans balayage est précisément le geste qui la désarme.                                                                                                                                                                            |
| **4.2.0** | 14 août 2026       | Claude Opus 5 | **ADR-15 posé, et K-04 gagne le cycle de vie du registre.** ① **ADR-15** — `Core.reattach()` déplace le **conteneur** et rien d'autre : le moteur mémorise l'élément de construction (déplacer les enfants importerait le bug de `getContainer()` que l'aval avait dû écrire), et les panneaux vivant dans `glMain`, les faire suivre coupleraient l'API au DOM de la coquille. La décision ne vivait que dans le TSDoc de la façade ; **une décision d'architecture avec alternative écartée appartient au §Décisions**, sinon elle se refait de mémoire à la prochaine cible — c'est le motif qui a déjà fait verser la doctrine de placement en 4.1.0. ② **K-04** nomme désormais le cycle de vie du registre (`init`/`destroy`/`hasMap`/`listMaps`, plus `isAttached`/`reattach`) et le fait qu'il n'y en a **qu'un** : `GeoLeaf.getMap`/`getAllMaps` y délèguent depuis la 3.1.0. Avant, ces raccourcis lisaient un miroir que personne n'alimentait et rendaient `null` pour toute carte vivante. ③ ⚠️ **`Vérifié contre` n'est PAS avancé** : ces deux gestes sont vérifiés contre `c5164edd`, le document dans son ensemble ne l'est pas. Avancer la ligne ferait passer une vérification ponctuelle pour un balayage complet — exactement la classe d'énoncé que le bandeau ci-dessus interdit. ④ Aucune signature recopiée : le §Contrat exposé continue de renvoyer à TypeDoc.                                                                                                                                                                                                                                                                                                                                                                                       |
| **4.1.0** | 1er août 2026      | Claude Opus 5 | **§Dépendances et frontières reçoit la doctrine de placement** — « Où va une fonctionnalité neuve : kernel, capacité ou plugin ». Les deux axes (lien au noyau · moment de livraison), la table des 3 couches, la grille ordonnée à 5 questions et le principe natif-dessous/déclaratif-dessus, versés depuis `rapport_decisions-architecture.md` (session d'idéation du 04/07/2026) à l'archivage de la zone `travail/`. ⚠️ **Motif du versement** : aucun fichier de `specs/` ne portait ce classement, et `/feature` ne couvre pas le placement — la seule frontière que les trois sections suivantes ne disaient pas était celle qui décide **de quel côté** on atterrit. Les trois autres frontières sont inchangées                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **4.0.0** | 27 juillet 2026    | Claude Opus 5 | **Réécriture complète contre le code, refonte documentaire V3 §2.3 + §2.4.** Le document précédent (`CDC_technique.md`, 2 572 lignes) citait **452 chemins dont 287 ne résolvaient plus**, annonçait « 18 capacités » ×4 (réel **21**), « 11 plugins » / « 9 plugins » (réel **13**), « 369+ fichiers TypeScript » (réel **518**), « 8 profils » (réel **2** + `_reference`), et **deux comptes d'exports ESM contradictoires** à 700 lignes d'écart. Il portait aussi trois versions incompatibles de lui-même — frontmatter `v3.34.0`, bandeau `v3.23.0`, corps « version 2.1.5 » — alors que `packages/core/package.json` vaut **3.0.0**. Réécrit au squelette `specs/` : Périmètre / Fonctionnalités / Séquence de boot / 13 sous-systèmes / Configuration / Contrat exposé / Décisions / Frontières. **Trois sections deviennent des renvois** au lieu d'être recopiées : l'arborescence des sources (→ `reference/ARBORESCENCE_QUALIFIEE.md`, généré et gaté), la liste des signatures d'API (→ TypeDoc) et la structure d'un profil (→ `specs/contrats/PROFILE_CONTRACT_SPEC.md` + `reference/GUIDE_VALIDATION_PROFILS.md`) — c'est la frontière `specs/` ↔ dérivé, et la recréer ici annulerait le travail qui la supprime ailleurs. **Les 14 ADR sont conservés**, condensés en table décision / pourquoi / alternative écartée, avec leurs révisions et leurs corrections de prémisse — un ADR périmé s'annote, il ne s'efface pas. Péremptions balayées : `src/modules/**` et `modules/optional/` (n'existent plus), `plugin-storage` → `offline-ui` (10 sites), `GeoLeaf-Core` décrit comme dépôt public, `src/lazy/` (19 mentions d'un répertoire absent). L'exemple `Files` est repris du profil `reunion-eclairage` réel et validé contre `profile.schema.json`. |

<details>
<summary>Historique antérieur — <code>CDC_technique.md</code>, v2.1.0 (22/04/2026) → v3.33.1 (26/07/2026)</summary>

L'historique détaillé des révisions antérieures est conservé dans le document archivé
`CDC_technique_v2.3.0.md` et dans les journaux de session
(`JOURNAL-2026-07.md`). Il n'est pas recopié ici : il documentait
l'évolution d'un texte qui a été remplacé, pas l'évolution du code.

Les décisions qu'il portait et qui restent vivantes ont été versées aux ADR ci-dessus. Les
quatre mécanismes supprimés qu'il décrivait sont bien morts dans le code, mais ⚠️ **un seul
est consigné dans la table des décisions** : le registre de handlers de popup, écarté par
ADR-07. Les autres ont un domicile différent, et il faut le nommer pour qu'on ne les cherche
pas au mauvais endroit — `app/module-setup.ts` et la posture « top-level + guard » au
§Séquence de boot, le build « Lite » au §Ce que le kernel ne fait pas puis à l'entrée
`ESM Lite` du glossaire. 🛑 Le miroir `applyModulesCompat`, lui, **n'en a aucun** : il n'est
nommé nulle part ailleurs dans ce document (`grep -n applyModulesCompat docs/specs/CDC_kernel.md`
ne rend que cette ligne). Un mécanisme écarté sans domicile écrit se refait de mémoire —
c'est exactement le motif qui a fait verser ADR-15 en 4.2.0.

</details>

---

_GeoLeaf Platform — Mattieu Pottier_
