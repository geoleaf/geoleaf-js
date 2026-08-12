# Architecture — GeoLeaf-JS

> Référence arborescence, modules, points d'entrée et conventions structurelles.  
> Source unique — ne pas dupliquer ailleurs.

> 📄 **Arborescence exhaustive et qualifiée** : [`ARBORESCENCE_QUALIFIEE.md`](ARBORESCENCE_QUALIFIEE.md) — **tous les répertoires et fichiers source** du dépôt (`.ts`, `.css`, `scripts/`) — le décompte est imprimé par `npm run docs:tree`, il n'est pas recopié ici — chacun portant quatre qualifications : le nom est-il bon, l'emplacement pertinent, l'existence justifiée, et que fait l'élément. Vue interactive : [`ref/ARBORESCENCE_QUALIFIEE.html`](ARBORESCENCE_QUALIFIEE.html) (repli, filtres par verdict, recherche). **Fichiers générés** (`npm run docs:tree`) depuis les verdicts versionnés de `scripts/docs-tree-verdicts/`, vérifiés à chaque `ci:local` : ils ne peuvent pas diverger de l'arbre en silence. Le présent document reste la lecture _narrative_ de l'architecture ; celui-là est l'inventaire **et** l'audit structurel.

---

## Arborescence du monorepo

> **La frontière lib / app (T2, 25/07/2026).** Ce dépôt produit **deux choses de nature différente**, et l'arborescence le dit désormais : des **librairies npm** (18 packages, `dist/` compilé, publiées) et **une application web déployable** (`apps/geoleaf-app/`, `private`, jamais publiée). Jusqu'au T2 la seconde n'avait pas de workspace — ses sources logeaient dans `packages/core/`, ce qui couplait la librairie à la page : supprimer `index.html` cassait `test:bundle`, `verify:purgecss`, `build:deploy` et, par cascade, les 36 specs E2E. _Une librairie ne doit pas savoir qu'une page existe._
>
> Le sens de la dépendance est **strictement unidirectionnel** : l'app consomme les `dist/` des packages, aucun package ne référence l'app. `build-deploy.cjs` est le seul assembleur — il lit `apps/geoleaf-app/` (résolu **via `packages.cjs`**), les 18 `dist/` et `profiles/`, et produit les 3 variantes de `deploy/`. Contrat de l'app gardé par `scripts/verify-app-template.cjs`.

```
GeoLeaf-JS/                          ← monorepo racine
├── apps/
│   └── geoleaf-app/                 ← ⭐ T2 : L'APPLICATION déployable (`@geoleaf/app`, private)
│       │                              Source UNIQUE et irremplaçable des variantes de `deploy/` —
│       │                              aucun autre fichier du dépôt ne porte ce balisage.
│       │                              ⚠️ « 3 variantes » ici jusqu'au 09/08/2026 : il y en a 4,
│       │                              dont 2 livrées. `ls deploy/` rend le compte, pas ce cadre.
│       ├── index.html               ← page livrée : CSP, PWA, MapLibre CDN+SRI, <script> des plugins
│       ├── init.js                  ← bootstrap : 4 registerLazy + connector dev + GeoLeaf.boot()
│       ├── manifest.json            ← template PWA, fusionné avec profiles/geoleaf.config.json (pwa.*)
│       ├── connector.local.example.js ← gabarit ; `connector.local.js` (JWT dev) est git-ignoré
│       │                              ⚠️ et n'est copié QUE dans `deploy-local`, non livrée — un
│       │                              livrable n'a ni le fichier ni la balise qui le charge.
│       │                              Git-ignoré ne couvrait QUE le canal git ; `deploy/` en est
│       │                              un autre, et le jeton y a vécu jusqu'au 09/08/2026
│       │                              (verify-deploy-no-secrets.cjs, APP-11).
│       └── src/assets/icons/        ← 6 PNG PWA. ⚠️ La forme `src/assets/` est VOULUE : `index.html`
│                                      y référence ses chemins et build-deploy.cjs les réécrit en
│                                      `icons/`. L'aplatir rendrait cette réécriture muette.
├── packages/
│   ├── core/                        ← @geoleaf/core (MIT, npm public)
│   │   ├── src/                     ← TypeScript strict (ESM-only)
│   │   │   ├── bundle-esm-entry.ts  ← LE point d'entrée livré (kernel + les 17 capacités)
│   │   │   ├── kernel-exports.ts    ← ré-exports KERNEL (S4) — aucune façade de capacité, jamais
│   │   │   ├── global.d.ts          ← déclarations ambient canoniques (GeoLeafGlobal + maplibregl type-only)
│   │   │   ├── adapters/maplibre/   ← couche d'abstraction MapLibre GL JS ; `maplibre-vector-tiles.ts` = construction couches vector-tiles (délégué par `IMapAdapter.addVectorTileLayer`, socle B.1) ; `maplibre-cluster-builders.ts` = sous-couches cluster GeoJSON (socle B.2) ; `maplibre-cluster.ts` = constantes cluster partagées ; `maplibre-markers.ts` = cycle de vie des marqueurs DOM (extrait de l'adapter pour tenir le plafond fichier 700 l.). **Frontière capacité→adaptateur verrouillée ESLint** (`capabilities/** ⊄ adapters/maplibre/**`) : le sprite-loader DOM a migré en neutre (`utils/loaders/profile-sprite-loader.ts`)
│   │   │   ├── app/                 ← boot.ts (liaison au manifeste livré, ~6 l.) + boot-install.ts (installBoot(preset) : latch perf, 8 modules kernel, façade GeoLeaf.boot — S4) + boot-core.ts (bootWithPreset — la séquence, paramétrée — S3) ; init-deferred-ui/-reveal/-feature-modules ; app-types ; module-registry ; helpers. ⚠️ `init.ts` **retiré de cette ligne au S5.1** : la façade `initApp()` a été supprimée à la roadmap nettoyage S3/A-1, et les tests le disent déjà (`__tests__/config/_helpers/config-harness.js:13`)
│   │   │   │   └── boot-modules/    ← les 6 wrappers kernel `ICoreModule` (config, core-map, geojson, shared, theme-engine, ui) ; les 13 wrappers de capacité en sont sortis au R.10. ⚠️ **`core-map-lifecycle.ts` (R.42, 25/07/2026)** porte le runtime de `core-map.module.ts`, ramené de 207 à 46 l. : `init()` déléguait 7 responsabilités en ~148 l. sous `eslint-disable complexity, max-lines-per-function` — le seul disable des 19 wrappers, désormais **supprimé**. Extraction **graph-preserving** (`id`/`dependencies` inchangés). ⚠️ Le plan visait `kernel/map/` : impossible, ESLint 6ter (a) interdit `kernel/** → app/` et le lifecycle dépend de 8 symboles d'`app-types.ts`
│   │   │   │                          (T2 : `assets/icons/` a disparu d'ici — la ligne le décrivait
│   │   │   │                           comme « icônes SVG intégrées au bundle », DOUBLEMENT faux :
│   │   │   │                           6 PNG, aucun SVG, et 0 référence dans `src/`. C'étaient les
│   │   │   │                           assets PWA de l'app, partis avec elle)
│   │   │   ├── capabilities/<id>/   ← 21 capacités in-core MIT ; install.ts = ancrage unique (S2) ; vector-tiles ajoutée S5 ; profile-switcher / language-switcher / theme-palette ajoutées par `roadmap_feature-selecteurs-ui` (S1→S3, 25/07/2026)
│   │   │   │   └── feature-info/    ← **CAPACITÉS S2** : le sous-dossier homonyme `feature-info/feature-info/` est éclaté. Les 3 surfaces (`sidepanel`, `popup`, `tooltip`) → `surfaces/` ; `resolve.ts` et `convert.ts`, qui sont des helpers purs et non des surfaces, remontent à la racine de la capacité. Stratification : helpers racine ← `render/` ← `surfaces/` (auparavant `render/` importait « vers le haut »)
│   │   │   │   └── css/             ← ⭐ S6 : le CSS de la capacité, importé par SON install.ts → tree-shake avec elle
│   │   │   ├── presets/             ← contrat CapabilityInstaller + manifeste FULL + apply-preset
│   │   │   ├── contracts/           ← interfaces partagées inter-modules (type-only, gate check-contracts-pure). **API S3 : 6 des 15 sont PUBLICS** — `core-module`, `capability`, `config`, `map-adapter`, `layer-data`, `event-bus`, exposés en sous-chemins `types`-seuls (`@geoleaf/core/contracts/<fichier>.js`) et ré-exportés depuis l'entrée. Type-only ⇒ `dist/esm/contracts/` n'existe pas : une condition `import` sortirait rouge à SUBPATH-RESOLVE. Les 9 autres restent internes (on ajoute un sous-chemin quand on veut, on n'en retire jamais) ; **CAPACITÉS S3** : `map-adapter.contract.ts` scindé — les types de valeur → `map-adapter.types.ts`, le contrat les ré-exporte en `export type *` (jamais `export *`) et reste la surface d'import unique
│   │   │   ├── css/                 ← ⭐ S6 : KERNEL UNIQUEMENT. geoleaf-main.css déclare @layer + n'importe que du kernel
│   │   │   ├── css.d.ts             ← `declare module "*.css"` — le CSS est un nœud du graphe JS (S6)
│   │   │   ├── lang/                ← fichiers de traduction i18n
│   │   │   ├── modules/
│   │   │   │   ├── built-in/        ← toujours chargés
│   │   │   │   │   ├── api/ basemaps/ config/ events/   ← `api/` porte `capability-registry.ts` (déplacé d'`app/` au S14 : il y produisait les 2 seules arêtes inverses `modules/` → `app/`, et il généralise `PluginRegistry.registerLazy`, son voisin de palier)
│   │   │   │   │   ├── geojson/ layer-manager/ map/   ← pwa relocalisé en capabilities/pwa/ ; permalink → capabilities/permalink/ (S13)
│   │   │   │   │   ├── security/    ← ⚠️ XSS/CSRF — ne jamais contourner la sanitisation
│   │   │   │   │   ├── shared/      ← état partagé (geojson-state, …)
│   │   │   │   │   ├── storage/     ← wrapper localStorage legacy (≠ plugin Storage MIT — UI offline)
│   │   │   │   │   ├── themes/
│   │   │   │   │   └── ui/          ← filtre relocalisé en capabilities/filter/ (S5) ; dom-utils retiré (S8, BREAKING)
│   │   │   │   │       ├── components.ts    ← agrégat _UIComponents = legend-symbols + widgets (S8)
│   │   │   │   │       ├── ui-slot-builder.ts / toolbar-dispatch.ts / roving-tabindex.ts
│   │   │   │   │       │                     ↑ partagés desktop↔mobile — en RACINE car ESLint
│   │   │   │   │       │                       no-restricted-imports interdit l'import croisé (archi B.4)
│   │   │   │   │       ├── desktop/ ← desktop-panel + registry + theme + tabs-seam
│   │   │   │   │       └── mobile/  ← mobile-toolbar + pill/sheet/proximity/state
│   │   │   │   └── utils/           ← transversaux — **11** sous-dossiers : constants/ controls/ errors/ general/ geo/ i18n/ loaders/ log/ notify/ **performance/** validators/. `performance/` est le 11ᵉ, **créé au STRUCT S6** (26/07/2026) en appliquant le critère de sortie de `general/` : profileur, baseline persistée, export DevTools et métriques de démarrage. Au même sprint, `general/` passe de **22 f. / 3 844 LOC (55 % de `utils/`) à 14 f. / 2 351 LOC (34 %)** — `dom-security.ts` vers `kernel/security/` (le seul verdict **bloquant** du core), `wkt-parser.ts` vers `geo/`, `error-logger.ts` vers `log/`, `platform.ts` vers `capabilities/pwa/`. **Charte d'appartenance (critère d'entrée / critère de sortie de chacun) : `travail/cdc/CDC_technique.md` §Charte de `utils/`** — la justification était jusqu'au 24/07 *procédurale* (« statués tous justifiés au KERNEL S11 ») et non architecturale (backlog résiduel R.13). `helpers/` **fusionné dans `general/` au S14** — c'était une collision de *basename* (`dom-helpers.ts` en 2 exemplaires) et non une duplication : aucun export commun, et `helpers/` importait déjà `general/`. `modules/shared/` **supprimé au S14** : il ne portait plus qu'un ré-export legacy vers `built-in/shared/`, le vrai emplacement)
│   │   │   │       ├── controls/    ← comportements UI partagés entre surfaces : `collapsible-toggle.ts`, `propagation-blocker.ts`, et **`focus-trap.ts` (CAPACITÉS S2)** — cyclage `Tab`/`Shift+Tab`, consommé par les 4 surfaces modales (side-panel, lightbox, modale de partage, sheet mobile) qui en portaient chacune une copie divergente. ⚠️ Son filtre `offsetParent !== null` est **intestable** (sous happy-dom `offsetParent` vaut `undefined`) : transposé verbatim, à ne pas « améliorer »
│   │   │   │       └── general/     ← `utils-namespace.ts` (**composition unique de `GeoLeaf.Utils`, S14** — consommée par `globals.core.ts` pour le montage global ET par `kernel-exports.ts` pour l'export ESM, afin que les deux portent la même forme ; `utils-api.ts` et la façade `geoleaf.utils.ts`, morts depuis le retrait des builds UMD en v2.0.0, ont été supprimés) + `helpers-namespace.ts` (façade `GeoLeaf.Helpers` — ex-`helpers.ts`, renommé au STRUCT S6 : l'homonymie avec `app/helpers.ts` que le S14 avait laissée intacte) + `utils-base.ts` (ex-`general-utils.ts`, renommé au même sprint — le nom cumulait `general` et `utils`) + dom/object-utils + geoleaf-global.ts (getGeoLeaf/ensureGeoLeaf) + type-guards.ts (FeatureProperties) + di-accessors.ts (`getLog`, extrait de `utils-base` — alors `general-utils` — au KERNEL S10 : 20 modules cessent de tirer la façade `geoleaf.core.js` pour un logger). ⚠️ `event-bus.ts` **supprimé au S10** (pub/sub mémoire derrière `GeoLeaf.Bus`, écrit au boot et jamais relu) — le bus vivant est `built-in/events/event-bus.ts`, ne pas les confondre
│   │   │   ├── globals.*.ts         ← orchestrateurs de chargement KERNEL (B1→B11) — setup*Kernel (S2)
│   │   │   └── geoleaf.*.ts         ← 27 façades publiques (namespace GeoLeaf.*)
│   │   ├── examples/minimal/        ← entrée d'exemple (S4) : la recette, buildée depuis ../../src/ — prouve que le GRAPHE SOURCE tree-shake (npm run size:example)
│   │   ├── examples/consumer/       ← ⭐ S6 : la MÊME recette, mais par les vrais sous-chemins npm (@geoleaf/core/*) — prouve que le PAQUET PUBLIÉ tient (npm run size:consumer). Sortie examples/dist/, jamais publiée. Trois fixtures, toutes compilées par `typecheck:consumer` à travers la carte `exports` SANS `paths` : `entry.ts` (bundlé, mesuré), `published-types.ts` (types des 14 autres paquets, type-only) et **`extension-contract.ts`** (API S3 — un module tiers implémente `ICoreModule` depuis `@geoleaf/core`, et l'union lifecycle/slot-UI est asservie ici : vu rouge en la réduisant)
│   │   ├── rollup.consumer.mjs      ← ⭐ S6 : config du témoin (SÉPARÉE : elle lit dist/esm/, que rollup.config.mjs écrit → `rollup -c -w` bouclerait)
│   │   ├── dist/                    ← artefacts build (ne pas modifier)
│   │   ├── docs/                    ← documentation publique (ex-docs/ racine, déplacé ici)
│   │   └── __tests__/               ← tests Vitest par domaine
│   │       └── guards/              ← test-gardes : invariants qu'un test ordinaire ne voit pas
│   │                                  `extracted-features.guard.test.js` (tokens de features retirées, absents de src/)
│   │                                  `doc-profile-examples.guard.test.js` (S5 : les exemples `Files` des docs
│   │                                  NORMATIVES valident contre profiles/schemas/profile.schema.json — AJV)
│   ├── plugins/                     ← ⭐ ARCHI S10.1 — les 13 plugins, regroupés
│   │   ├── offline-ui/           ← @geoleaf-plugins/offline-ui (ESM pur, MIT, npmjs.org public)
│   │   │   ├── src/cache/layer-selector/config-cache.ts  ← [PLUGINS S7] mémoïsation des 2 N+1 de la modale. ⚠️ DEUX mémos à durées de vie
│   │   │   │                                différentes : config de couche = vie de la page (immuable) ; manifeste de cache = PAR PASSE
│   │   │   │                                (beginCacheStatusPass en tête de populate/refreshCacheIcons) — l'élargir fige les ✓ d'avant téléchargement
│   │   │   ├── src/cache/layer-selector/cache-match.ts   ← [PLUGINS S7] matching couche/fond ↔ manifeste. Rien ne relie une ressource cachée au
│   │   │   │                                fond qui l'a produite (raster : préfixe statique après buildTileUrl ; vectoriel : origine du STYLE)
│   │   │   ├── src/cache/layer-selector/cache-cell.ts    ← [PLUGINS S7] glyphe ✓/✗ du tableau, 3 sites d'appel — module séparé exprès :
│   │   │   │                                ses 2 consommateurs montent des méthodes sur LS par Object.assign, l'import croisé lierait l'ordre de chargement
│   │   │   ├── src/css/cache-sync.css      ← [PLUGINS S7] styles du panneau sync, écrits de zéro (aucune des 19 classes n'existait) ;
│   │   │   │                                fichier séparé car le bloc portait cache-control.css à 751 L, au-dessus du cap PC-08 de 700
│   │   │   └── src/sync/sync-manager.ts    ← [PLUGINS S7] `mount(parentEl, {onSynced})` est le SEUL point d'entrée du panneau « Données saisies »
│   │   │                                    (opérations en attente, sync, sauvegardes + Restaurer). Monté dans l'onglet EXPORT, de façon SYNCHRONE :
│   │   │                                    dans le callback de getPendingPOIs() il ne rendait rien (whenReady() ne se règle pas moteur offline absent).
│   │   │                                    ⚠️ le chemin CacheControl ne connaît plus la sync — il la construisait puis export-logic la supprimait
│   │   ├── addpoi/               ← @geoleaf-plugins/addpoi (ESM pur, MIT, npmjs.org public depuis le 19/07/2026)
│   │   │   │                              ← S4 : sync via pattern adapter (src/persistence/ + sync-handler-backup.ts) — cf. CDC §10
│   │   ├── plugin-file-import/          ← @geoleaf-plugins/file-import (ESM pur)
│   │   ├── plugin-flatgeobuf/           ← @geoleaf-plugins/flatgeobuf (ESM pur)
│   │   ├── plugin-geocoding/            ← @geoleaf-plugins/geocoding (ESM pur, MIT, npmjs.org public) — recherche d'adresse extraite du core
│   │   ├── plugin-table/                ← @geoleaf-plugins/table (ESM pur, MIT, npmjs.org public) — tableau de données extrait du core
│   │   ├── plugin-print/                ← @geoleaf-plugins/print (ESM pur, MIT, npmjs.org public)
│   │   │   ├── src/modal-dom.ts           ← arbre DOM du modal d'aperçu + références typées, aucune logique (PLUGINS S6)
│   │   │   ├── src/modal-compose.ts       ← géométrie pure du modal (PLUGINS S6) : buildComposeArgs (source unique aperçu+export), mapViewport (surensemble de la zone composée → le recadrage tient l'échelle)
│   │   │   └── src/print-api.ts          ← [PLUGINS B.12] pipeline capture→composition→export sorti de public-api.ts.
│   │   │                                ⚠️ 230 L qui étaient coverage-EXCLUDED avec la façade, donc à 0 % sans que ça se voie —
│   │   │                                dans le paquet même où le S6 a trouvé l'échelle fausse à 17 %. Désormais 100 % lignes,
│   │   │                                et l'invariant du S6 (zones rendues == zones composées) est épinglé par un test
│   │   ├── plugin-measure/              ← @geoleaf-plugins/measure (ESM pur, MIT, npmjs.org public)
│   │   │   ├── src/recap-box.ts           ← box récapitulative sous le menu (n° | Coord X;Y | longueur + total) — CÂBLÉE au PLUGINS S5, le module existait sans appelant depuis le S2
│   │   │   ├── src/tools/tool-shared.ts   ← primitives d'outils (PLUGINS S5) : containerCoord, startCursorGuard (resolver de curseur — le polygone le change en snap), createDragTool (rect + circle)
│   │   │   └── src/measure-api.ts        ← [PLUGINS B.12] cycle de vie du plugin (bootstrap paresseux, dispatch des 6 outils,
│   │   │                                restauration au boot) sorti de public-api.ts. 177 L également invisibles jusque-là
│   │   ├── plugin-cog/                  ← @geoleaf-plugins/cog (ESM pur, MIT, npmjs.org public depuis le 19/07/2026)
│   │   │                              ← [PLUGINS B.12] INV-FACADE : src/public-api.ts ne fait QUE déléguer ; l'implémentation est dans src/cog-api.ts (gate check-facade-purity.cjs, moitié plugin — voir ADR-12)
│   │   ├── plugin-editor/               ← @geoleaf-plugins/editor (ESM pur, MIT, npmjs.org public depuis le 19/07/2026)
│   │   │   │                              ← dépend de @geoleaf/field-renderer (bundlé inline — pas d'external Rollup)
│   │   │   │                              ← src/persistence/ : adapters rest/collection + http-helpers.ts (wrapper de domaine fin sur les primitives HTTP de @geoleaf/host-runtime — cf. CDC §2.1)
│   │   │   ├── src/persistence/storage-seam.ts  ← [PLUGINS S4] seam unique vers globalThis.GeoLeaf.Storage (storageDb / profileId),
│   │   │   │                                mutualisé entre storage-queue-adapter et editor-sync-replay. ⚠️ liaison tardive VOLONTAIRE :
│   │   │   │                                l'éditeur doit tourner sans @geoleaf-plugins/offline-ui — ne pas convertir en import statique
│   │   │   ├── src/editor-api.ts          ← [PLUGINS B.12] wrapper de bascule du menu (placement au premier ouvert) + hook de teardown,
│   │   │   │                                sortis de public-api.ts
│   │   │   │                              ← PLUGINS S4 : le bloc .gl-form-* de src/css/geoleaf-editor.css est parti (11 doublons supprimés,
│   │   │   │                                10 orphelins rapatriés dans field-renderer/src/css/form-modal-base.css)
│   │   ├── plugin-flatgeobuf/           ← @geoleaf-plugins/flatgeobuf
│   │   │                              ← [PLUGINS B.12] INV-FACADE : src/public-api.ts ne fait QUE déléguer ; l'implémentation est dans src/fgb-api.ts (gate check-facade-purity.cjs, moitié plugin — voir ADR-12)
│   │   ├── plugin-file-import/          ← @geoleaf-plugins/file-import
│   │   │                              ← [PLUGINS B.12] INV-FACADE : src/public-api.ts ne fait QUE déléguer ; l'implémentation est dans src/import-api.ts (gate check-facade-purity.cjs, moitié plugin — voir ADR-12)
│   │   ├── plugin-connector/            ← @geoleaf-plugins/connector (ESM pur ; auth/fetch via @geoleaf/host-runtime jsonHeaders/bearer)
│   │   ├── plugin-realtime-layer/       ← @geoleaf-plugins/realtime-layer (ESM pur)
│   │   ├── plugin-websocket/            ← @geoleaf-plugins/websocket (archivé/legacy)
│   │   │   └── src/ws-lifecycle.ts        ← [PLUGINS B.12] collaborateurs + singletons de module + séquence init/destroy,
│   │   │                                sortis de public-api.ts. Les singletons sont REMPLACÉS à l'init (pas mutés) :
│   │   │                                c'est ce qui rend un seul buildPublicApi() valide à travers les cycles
│   │
│   ├── libs/                        ← ⭐ ARCHI S10.1 — bibliothèques internes : aucune n'appelle register(), aucune n'est un plugin
│   │   ├── field-renderer/              ← @geoleaf/field-renderer v1.0.0 (ESM pur, MIT, npmjs.org public)
│   │   │   │                              ← lib pure DOM : 23 composants FieldConfig, modal responsive, focus-trap, bridge, validators
│   │   │   │                              ← consommateurs : editor, addpoi, offline-ui (bundlé inline)
│   │   │   ├── src/builtins.ts            ← [PLUGINS B.9] registerBuiltinComponents() — enregistre les 23 composants en UN appel.
│   │   │   │                                ComponentRegistry est un SINGLETON DE MODULE : les listes tenues à la main par chaque
│   │   │   │                                hôte (editor 23, addpoi 10) faisaient dépendre 13 types de la présence de l'éditeur,
│   │   │   │                                avec repli SILENCIEUX sur `text`. Typé ComponentDefinition<unknown>[] : c'est
│   │   │   │                                l'annotation qui lève l'inférence en union (le blocage du S4), sans cast
│   │   │   ├── src/types/field-base.ts         ← [PLUGINS S2] scaffolding partagé : _fieldWrap / _formLabel / _errorSlot / _readonlyPair /
│   │   │   │                                _linkSidepanel + factories _renderSimpleField (7 types) et _renderOptionGroup (checkbox↔radio)
│   │   │   ├── src/types/field-media.ts        ← [PLUGINS S2] upload/lightbox partagés gallery↔image : ACCEPTED_MIME, _openLightbox,
│   │   │   │                                _uploadFile, _validateFile, _safeImageSrc (durcit img.src côté formulaire, allowance blob: locale)
│   │   │   │                              ← PLUGINS S2 : _el() adopté sur les 23 types (278 createElement → 0)
│   │   │   │                              ← primitives HTTP neutres : jsonHeaders / bearer / fetchWithTimeout / parseJsonBody / HttpFetchError
│   │   │   │                              ← consommateurs : plugin-editor + plugin-connector — bundlé inline, déclaré en devDependency (jamais dependency)
│   │   ├── host-runtime/              ← @geoleaf/host-runtime v1.0.0 (ESM pur, MIT, private:true — NON publié, roadmap typage-plugins S0 ; élargi PLUGINS S1, puis STRUCT S1–S2)
│   │   │   ├── src/host.ts                ← accès typé au namespace : getGeoLeaf / ensureGeoLeaf / coreConfigGet + types GeoLeafHost, PluginRegisterOptions
│   │   │   ├── src/notify-seam.ts         ← getUINotifications() — seam runtime vers GeoLeaf._UINotifications (résolution au call time, aucun import statique du core)
│   │   │   ├── src/http.ts                ← jsonHeaders / bearer / fetchWithTimeout / parseJsonBody / HttpFetchError — absorbé de @geoleaf/http-helpers (STRUCT S1)
│   │   │   ├── src/log-seam.ts            ← Log{debug,info,warn,error} — accesseur vers GeoLeaf.Log (STRUCT S2 F1 : 3 copies byte-identiques, hash 033aeed2cd5d)
│   │   │   ├── src/i18n-seam.ts           ← tLabel(key, fallback?) / getActiveLang() (STRUCT S2 F2 : 4 copies, 3 contrats incompatibles réconciliés en un sur-ensemble strict)
│   │   │   │                              ← ⚠️ nommé tLabel et non `t` : 6 `const t =` sans rapport dans la zone plugins le rendraient indiscernable d'un fork pour PSF-01
│   │   │   ├── src/core-utils-seam.ts     ← getNestedValue / createSVGIcon / clearElementFast (STRUCT S2 F3)
│   │   │   │                              ← ⚠️ SEUL module du paquet qui ne soit pas un accesseur : de vraies implémentations, donc de vrais JUMEAUX du core
│   │   │   │                                 (mesurés byte-identiques : 2510699d7a / a397088b6f) — d'où le seam `core-utils` dans verify-seam-drift
│   │   │   ├── src/map-seam.ts            ← getNativeMap<T>() générique + warnNoCore(scope, fn) (STRUCT S2 F4 : 3 corps identiques, seul le cast différait)
│   │   │   ├── src/dom-seam.ts            ← createEl(tag, className?, attrs?) / applyStyleText (STRUCT S2 F4 : 4 copies de _el, 2 d'applyCssText)
│   │   │   │                              ← ⚠️ noms SANS underscore délibérément : field-renderer DÉFINIT _el/_getLabel/applyCssText et EST scanné par PSF-01
│   │   │   ├── src/download.ts            ← downloadBlob() — navigator.share sur iOS, <a download> ailleurs (STRUCT S2 F5, venu de plugin-print par git mv)
│   │   │   ├── src/css.d.ts               ← declare module "*.css" (TS2882) — exigé par l'import d'effet de bord de ui/tooltip.ts
│   │   │   ├── src/css/tooltip.css        ← présentation partagée du tooltip, clé sur .gl-tooltip (STRUCT S2 F8 : 19 déclarations identiques editor/measure)
│   │   │   │                              ← ⚠️ bannière /*! COURTE : cssnano préserve ces commentaires, ils partent dans chaque bundle (mesuré ~0,7 KB gz de prose)
│   │   │   ├── src/ui/css-adopt.ts        ← adoptStylesheet() — injection CSP-safe par constructable stylesheet
│   │   │   ├── src/ui/drag.ts             ← wireDrag() souris + géométrie partagée (readDragOffset / applyDragOffset), paramétrée par préfixe de var CSS
│   │   │   ├── src/ui/touch-drag.ts       ← wireTouchDrag() — SEUL fichier exclu de couverture (événements tactiles hors happy-dom), motif reporté de editor+measure
│   │   │   ├── src/ui/tooltip.ts          ← wireTooltips / showTooltip / hideTooltip — tooltips positionnés en JS (les menus flottants clippent leur overflow)
│   │   │   ├── src/ui/menu-position.ts    ← positionMenuNear() — ancrage d'un sous-menu flottant sur la barre pill (centrage + clamps carte), paramétré par menuHeight + setPosition
│   │   │   │                              ← PLUGINS S5 : editor et measure calculaient le MÊME placement (le premier extrait au S4, le second encore en façade) — consolidé avant divergence
│   │   │   │                              ← PLUGINS S1 : 12 copies forkées rapatriées ici, adoption 3 → 9 paquets
│   │   │   │                              ← remplace les `globalThis as any` des plugins — bundlé inline, déclaré en devDependency (jamais dependency)
│   │   │   │                              ← ⚠️ contrat de bundle : n'importe AUCUNE valeur de @geoleaf/core, pas même un type. Le core, lui, n'importe pas ce paquet
│   │   │   │                                 (ce serait inverser la dépendance : c'est le shim plugin du namespace que le core assemble — cf. capabilities/offline/config-seam.ts)
│   │
│   ├── build-config/                ← @geoleaf/build-config (private) — tsconfig de base, fabrique rollup, base vitest (ARCHI S9), budget de workers de test (worker-budget.mjs, B.48)
│   └── _plugin-template/            ← scaffold de create-plugin.cjs — HORS workspaces (`!packages/_*`)
│
├── docs-dist/                       ← artefact du build VitePress (T4.4 — sorti de packages/, où le glob `packages/*` le captait
│                                       sans qu'il porte de manifeste : `packages.cjs` ne faisait que le tolérer). Gitignoré, jamais commité.
│                                       Produit par packages/core/docs/.vitepress/config.ts#outDir, lu par scripts/deploy-docs.cjs
│                                       ⚠️ CANAL UNIQUE (4.8, option (c)) : la doc publique se publie À LA MAIN, par `npm run docs:deploy`.
│                                       Aucun workflow GitHub ne la déclenche. Depuis T5.1 la cible externe vient de
│                                       GEOLEAF_DOCS_SITE_ROOT — obligatoire, sans défaut : absente, le script sort en 1 sans rien écrire
├── e2e/                             ← tests Playwright (01-core, 02-storage, 03-storage-poi)
├── profiles/                        ← profils métier JSON (source unique — ne pas toucher)
│   ├── geoleaf.config.json          ← config racine (profil actif, debug, branding, PWA)
│   ├── schemas/                     ← schémas JSON AJV (npm run validate:profiles)
│   └── {profile-id}/                ← layout v2 (2026-06-11, S1 plugin-architecture)
│       ├── profile.json             ← identité + map + manifeste Files UNIQUEMENT
│       ├── config/core/             ← taxonomy / themes / layers / basemaps / ui / features
│       ├── config/plugins/          ← {module-id}.json par plugin (bloc modules.<id>)
│       ├── layers/{layer-id}/       ← config + styles/ + data/ par couche
│       ├── icons/                   ← sprites SVG du profil
│       └── data/                    ← données partagées (snapshots, fgb…)
├── deploy/                          ← variantes déploiement générées (ne pas modifier manuellement)
├── scripts/                         ← build, CI, smoke-test, sync, audit, data-prep (check-fgb-index.mjs + FGB_DATA_PREP.md) — hors périmètre runtime
│   ├── run-tests.cjs                ← lanceur des tests unitaires — borne l'essaimage (B.48) ; `npm test` et `npm run test:coverage:all`
│   ├── lib/test-scope.cjs           ← les 2 périmètres de test dérivés + l'invariant `ci:local ⊇ ci.yml`, vérifié à chaque run (B.48)
│   ├── lib/ts-decl-read.cjs         ← API S4.2 — les 2 lecteurs d'AST TypeScript partagés (membres nommés d'une interface, `export const` de littéraux de chaîne). Extraits de `verify-host-contract-sync.cjs` le jour où NAMESPACE-TYPING en a eu besoin des deux : deux copies d'un lecteur dérivent, et la dérive reste invisible tant que les deux gates sortent vertes. ⚠️ **Refuse de conclure sur une clause `extends`** — ces lecteurs n'itèrent que `node.members`, un membre hérité leur serait invisible et desserrerait la gate sans un mot
│   ├── lib/knip-hints-reporter.mjs  ← reporter knip émettant les `configurationHints` sur stderr — le reporter `json` ne les émet PAS, la gate les jetait
│   ├── check-dead-code.cjs          ← gate dead-code (wrapper knip) — **baseline de 1 signal** + config morte bloquante. Périmètre depuis le 26/07/2026 : fichiers morts, dépendances, imports non déclarés. **PAS les exports/types du core** (`ignoreIssues` dans `knip.js`) — ils y valaient 157 des 158 signaux, et leur triage un par un avait donné 116 faux positifs de baril pour 0 actionnable
│   ├── verify-test-load-mode.cjs    ← garde-fou COUVERTURE S1 — baseline des `require()` de source, ne peut que descendre
│   ├── verify-coverage-attribution.cjs ← COUVERTURE S1 — la seule gate qui vérifie l'APPAREIL de mesure (témoin 4 fonctions, 2 providers)
│   ├── audit-test-load-conversion.cjs ← COUVERTURE S2 — instrument des sprints 2 à 5 : `--triage` (classement A/B/C par AST), `--snapshot`, `--compare` (bulletin de lot). HORS `ci:local` par choix (2 passes de couverture)
│   ├── lib/hygiene-patterns.cjs     ← T5.7 — les 3 tables de motifs de `verify-repo-hygiene` + leurs témoins. Extraites parce que la sonde ne pouvait pas les interroger : ce gate s'exécute à l'import
│   ├── verify-ci-scripts-tracked.cjs ← T5.8 — tout script invoqué par `ci:local` (directs + `npm run` transitifs + requires locaux) est suivi par git. Le PENDANT de `verify-repo-hygiene` : celle-ci refuse l'indéclaré, celle-là refuse le non-tracé — l'état où `ci:local` est vert ici et mort sur un clone frais
│   ├── check-event-map-coverage.cjs ← API S3.4 — tout nom `geoleaf:*` relevé dans les sources est typé dans `GeoLeafEventMap`/`GeoLeafRawEventMap`. Cliquet EM-01/EM-02 (baseline de 53, ne peut que rétrécir). Clés lues sur l'AST du contrat, littéraux lus sur l'AST des sources — une gate par arguments de `dispatchEvent` serait aveugle aux 4 helpers qui reçoivent le nom en paramètre (23 littéraux, dont les 12 `ws:*`). Exclut les 18 marques `performance.mark` (ce ne sont pas des événements) et `geoleaf:table:*`, seul nom CALCULÉ du dépôt
│   ├── verify-host-contract-sync.cjs ← API S3.5 — `GeoLeafHost` ⊆ `GeoLeafGlobal` ⊆ oracle post-boot (HOST-01/02/03). Les deux descriptions du namespace ne peuvent PAS être reliées par le compilateur (host-runtime n'importe rien du core, pas même un type) : elles ont dérivé sans témoin. HOST-01 est le défaut `POI` mécanisé. Compare les NOMS ; les FORMES sont asservies par `typecheck:consumer` (`examples/consumer/extension-contract.ts`) et, pour les 11 méthodes de premier niveau, par `contracts/top-level-api.contract.ts` (API S4.2)
│   └── check-namespace-typing-coverage.cjs ← API S4.2 — l'invariant INVERSE de HOST-SYNC : toute clé du namespace est DÉCLARÉE dans `GeoLeafGlobal`, sinon elle tombe dans la traîne `[key: string]: unknown` et le compilateur ne vérifie plus son affectation. HOST-04 (clé neuve non typée) · HOST-05 (la baseline ne peut que rétrécir, 62 → 17) · **HOST-06 (une déclaration VIDE ne compte pas comme un typage)**. ⚠️ Sans HOST-06 la gate serait décorative : déclarer 62 membres `unknown` soldait la baseline, affichait 100 %, et ne faisait vérifier aucune affectation de plus — même défaut que `verify-core-standalone`, restée verte parce que sa regex ne matchait plus rien après un renommage. Elle a trouvé son premier défaut le jour de son câblage (`UI?: Record<string, unknown>`, compté « typé »). ⚠️ NE MESURE PAS un pourcentage : un pourcentage MONTE quand on retire une clé non typée
├── turbo.json                       ← orchestration Turborepo
├── knip.js                          ← détection dead code — SEULE config knip du dépôt (clés dérivées de `package.json#workspaces` via `packages.cjs` ; garde-fou : toute autre config knip, racine ou par paquet, fait échouer le run)
└── playwright.config.js             ← config E2E (deploy variants 8766-8768)
```

---

## Points d'entrée ESM

| Entrée                                    | Description                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `packages/core/src/bundle-esm-entry.ts`   | **LE bundle livré** — kernel + les 17 capacités (`dist/geoleaf.esm.js`)                   |
| `packages/core/src/kernel-exports.ts`     | Ré-exports **kernel** (`export *` depuis l'entrée) — **aucune façade de capacité**        |
| `packages/core/examples/minimal/entry.ts` | Exemple **non publié** — la recette d'un bundle allégé (9 capacités), gate `size:example` |

> **GeoLeaf livre UN bundle, avec tout.** Le build `lite` figé (10 fichiers `-lite` + `liteGlobalsAlias`) a été **supprimé en S4** : il n'était jamais servi et dupliquait une entrée/boot/globals à la main. Un intégrateur qui veut moins n'en fait pas une variante maintenue par nous — il écrit sa propre entrée d'une vingtaine de lignes (cf. `examples/minimal/entry.ts`), et les capacités qu'il n'a pas listées **sortent du bundle** par tree-shaking.

**Namespace public :** `GeoLeaf.*` via les fichiers `geoleaf.*.ts`

---

## ~~SHIM LEGACY~~ — section retirée (S5.1, 25/07/2026)

> **Il n'y a plus de shim legacy dans `packages/core/src/`.** Cette section listait
> **8 répertoires top-level** — `baselayers/`, `filters/`, `helpers/`, `validators/`, `themes/`,
> `core/`, `ui/`, `storage/` — et concluait que « l'implémentation réelle se trouve exclusivement
> dans `src/modules/` ». **Aucun des huit n'existe, et `src/modules/` non plus** : vérifié fichier
> par fichier le 25/07/2026. La racine réelle est décrite par l'arborescence en tête de document.
>
> ⚠️ **Le mode d'échec vaut d'être nommé, parce qu'il est propre aux sections d'avertissement.**
> Elle disait « ne pas modifier directement » : une consigne de prudence sur des répertoires
> disparus ne produit aucune erreur visible — elle ne protège rien et ne rougit jamais. Elle
> pouvait donc survivre indéfiniment à ce qu'elle décrivait, contrairement à un chemin de code
> qui casse à la compilation. C'est la même classe que « toute garde doit être VUE rougir »,
> appliquée à la documentation.
>
> **Conservé ici plutôt que supprimé sans trace** : le wrapper `storage/` était explicitement
> distingué du plugin Storage MIT, et cette distinction-là reste utile — le plugin (UI offline)
> et le moteur IndexedDB in-core (`modules.offline`) sont deux choses, ne pas les confondre.

---

## Séquence boot — globals.\*.ts (B1→B11)

Les fichiers `globals.*.ts` sont les orchestrateurs de chargement. L'ordre B1→B11 est critique
et documenté au §6 du CDC technique. **Ne jamais modifier sans vérifier la séquence complète.**
L'invariant et son enforcement sont formalisés en **ADR-08** (les 14 ADR sont dans `specs/CDC_kernel.md` §Décisions de conception ; la distinction module/plugin est l'**ADR-09**). ⚠️ _Le renvoi précédent pointait `guides/core/architecture/ADR_REGISTRY.md`, **archivé le 27/07/2026** : c'était un index dont la cible n'existait plus et qui listait 10 ADR sur 14._

**Setup ré-appelable (chantier boot-di-lifecycle).** Chaque `globals.*.ts` extrait son corps
impératif en une fonction `setupX()` enregistrée via `app/module-setup.ts`
(`setModuleSetup` / `runModuleSetup` — garde anti double-init `_done` — / `resetModuleSetup`),
hors namespace `GeoLeaf`. Posture **« top-level + guard »** : `setupX()` tourne une fois **à
l'import** (préserve la séquence B1→B11 et le golden master byte-identique) ; le `ICoreModule.init()`
correspondant le ré-invoque via le `ModuleRegistry` (tri topologique) en **no-op guardé**. Cette
posture est **nécessaire** : `boot.ts` appelle `GeoLeaf.loadConfig()` (qui consomme l'APIController)
**avant** `registry.init()`, donc les modules fondation doivent être prêts dès l'import. Une bascule
« registry = seul driver » (retrait du run top-level) a été tentée puis **revertée** — elle cassait
le boot du bundle. Voir ADR-04 (CDC technique).

**Cycle de vie create → destroy → recreate.** `kernel/shared/lifecycle.ts` (seam IoC, hors
namespace, zéro import) tient un registre de teardown : chaque store (`GeoJSONShared`,
`LMShared`, `ProfileManager`) s'auto-enregistre son `reset()`. `Core.destroy(mapId)` les exécute à la
fermeture de la **dernière** carte → un `Core.init()` ultérieur repart propre (ni doublon ni fuite).
Oracle : `__tests__/app/lifecycle-create-destroy-recreate.test.js` + `e2e/10-lifecycle.spec.js`.

---

## Façades publiques — geoleaf.\*.ts

Les **27** fichiers `geoleaf.*.ts` exposent l'API publique `GeoLeaf.*` (dont `geoleaf.taxonomy.ts` + `geoleaf.featureinfo.ts`, ajoutés à la reclassification SR0).  
**Règle :** ces fichiers exposent l'API — ils délèguent, ils ne portent pas de logique métier.

### Les 3 patrons de façade

Une façade `geoleaf.*.ts` conforme suit **l'un** de ces trois patrons (aucun autre) :

- **A — re-export pur** : `export { X } from "…"`. Aucune logique ni effet de bord ; le symbole est construit et monté ailleurs (`globals.*.ts`, ou le `registerGlobals` du `capabilities/<id>/install.ts`). Le plus courant (**14 façades** : `baselayers`, `core`, `events`, `filters`, `helpers`, `introspection`, `layer-manager`, `legend`, `permalink`, `pwa`, `share`, `storage`, `ui`, `validators`). ⚠️ Cette énumération annonçait « ~13 » et omettait `storage`, pourtant déclaré conforme A au paragraphe suivant — recomptée au S13.1, où `events` et `introspection` ont rejoint le patron. ⚠️ **Recomptée de 16 à 14 au S5.1 de l'API publique (25/07/2026)** : elle nommait encore `constants` (façade morte, supprimée au S1.3) et `utils` (supprimée au S14, et le paragraphe « Portée du gate » ci-dessous le disait déjà) — **deux fichiers que cette liste énumérait alors qu'un autre paragraphe de la même section les déclarait supprimés.**
- **B — `buildPublicApi()` + install** : `export const X = buildPublicApi()` ; l'objet d'API est monté par le `registerGlobals(gl){ gl.X = X }` du `capabilities/<id>/install.ts`, sous la boucle preset de boot (~11 façades : `branding`, `cluster`, `coordinates`, `featureinfo`, `filter`, `geolocation`, `labels`, `layers`, `scale`, `taxonomy`, `theme-toggle`). L'appel de fabrique est la seule « logique » tolérée.
- **C — self-mount à l'import** : la façade construit un délégué mince puis l'écrit sur le global à l'évaluation (`const _gl = ensureGeoLeaf(); _gl.X = X`), pour qu'un plugin puisse s'enregistrer **avant** la fin du boot. Cas canonique : `geoleaf.sync.ts`. Sous-variante « side-effect import anti-tree-shaking » (un `import "…"` qui force le `Object.assign(GeoLeaf, …)` d'un module built-in à survivre au tree-shaking Rollup) : `geoleaf.api.ts`.

**✅ Les 27 façades sont conformes, et un gate le maintient** — `27 façades geoleaf.*.ts conformes`, sortie du gate au 25/07/2026. **Le chiffre à citer est celui que le gate imprime, jamais un compte recopié** : c'est en le recopiant que « 29 » a survécu à deux suppressions. `scripts/check-facade-purity.cjs` (S13.1) parse chaque `geoleaf.*.ts` et refuse toute logique : flot de contrôle, accès DOM/global, ou appel dont la cible n'est pas un symbole **importé**. Vert au câblage ⇒ **ni baseline ni allowlist** — la grammaire encode les trois patrons ci-dessus, pas une liste de fichiers bénis.

C'est cette formulation, plutôt que « pas d'objet littéral à méthodes », qui sépare `geoleaf.sync.ts` (conforme, patron C) de l'ancien `geoleaf.events.ts` : les deux étaient un objet exporté à trois méthodes, structurellement identiques. Ils divergeaient sur trois signaux indépendants — `Sync.registerHandler` est **un** statement transférant vers un contrat importé, tandis que `Events.on` en avait deux, plus un `if`, plus `document`.

**Portée du gate : il s'arrête à la façade et ne suit pas les imports.** `geoleaf.storage.ts` ré-exporte un module qui exécute `StorageContract.init()` au top-level. (L'exemple canonique était `geoleaf.utils.ts`, dont le montage global se cachait un cran plus bas dans `utils/general/utils-api.ts` — les deux fichiers ont été **supprimés au S14**, morts depuis le retrait des builds UMD en v2.0.0.) Les deux sont conformes **ici** : le contrat est « la façade est mince », pas « tout ce qu'elle importe est pur ». Suivre les imports flaguerait la conformation storage du S3 elle-même — le gate contredirait l'architecture qu'il défend.

**Historique des conformations** : `geoleaf.config.ts` supprimé au S2 (mort **et** self-registration impure) ; `geoleaf.storage.ts` au S3 (~430 L d'orchestration → `built-in/storage/facade.ts`) ; `geoleaf.events.ts` et `geoleaf.introspection.ts` au S13.1 (→ `built-in/events/facade.ts` et `built-in/introspection/facade.ts`). Les deux premières avaient été trouvées par un humain relisant le répertoire, ce qui n'est pas un procédé reproductible — d'où le gate.

Toute modification d'API publique → mettre à jour `packages/core/docs/CHANGELOG.md`.

---

## Presets de build — `src/presets/` (S2→S3, 14/07/2026)

**Ancrage par capacité.** Chaque capacité in-core expose désormais **un** `capabilities/<id>/install.ts` — le **seul** point à importer pour l'embarquer. Il implémente le contrat `CapabilityInstaller` (`presets/preset.contract.ts`) et regroupe les 3 couches d'ancrage statique qui étaient dispersées : la **déclaration** (`ICapabilityDeclaration`, gate + introspection), les **écritures `GeoLeaf.*`** (`registerGlobals`, ex-`globals.{ui,api}.ts`) et la **fabrique du module** (`createModule?`). Les variations légitimes sont des **champs optionnels**, jamais des chemins de code : `createModule?` absent = capacité _pull-based_/hook (cluster, taxonomy, pwa, offline) · `moduleGate?` = le module est gaté sur une **sous-clé** (share sous permalink) · le `loader` dynamique reste porté par la **déclaration** (offline). Il n'y a **délibérément aucun champ de surcharge de gate** : une capacité dont la clé vit dans une ressource de profil doit déclarer son gate **opt-out**, pas se faire greffer un défaut de preset (leçon taxonomy v3 — `forceConfig` supprimé).

**Séquence de boot paramétrée (S3).** `app/boot-core.ts#bootWithPreset(preset, ctx)` porte la **séquence** (`loadConfig` → Pass 1 → gate → Pass 2 → ressources profil → `beforeBoot` → `registry.init`), généralisée sur un `PresetManifest` : c'est le point d'entrée runtime que chaque entrée de preset appellera (S4). Elle reçoit ses collaborateurs par un `BootContext` (`{ GeoLeaf, app, registry }`) au lieu de les lire sur les globals — d'où sa testabilité directe (`__tests__/app/boot-core.test.js`, sans monter la chaîne B1→B11).

`app/boot.ts` ne garde que le **module-eval** : latch perf `?perf=1`, les **6** modules kernel, `GeoLeaf._registry` / `GeoLeaf.registry`, la façade `GeoLeaf.boot()` — et lie `_app.startApp` à `bootWithPreset(TOURISME_FULL, …)`. Il ne contient plus **aucun** bloc `register`/gate par capacité : une **boucle unique en 2 passes** (`presets/apply-preset.ts`) parcourt le manifeste actif (`presets/manifest.full.ts`, 17 installers) — Pass 1 déclaration + façades (**non gatée**), Pass 2 modules gatés. La sémantique du gate est unique (`evaluateGate`, `app/capability-registry.ts`). `globals.{ui,api,geojson}.ts` sont **100 % kernel** (`setupUIKernel` / `setupAPIKernel` / `setupGeoJSONKernel` — les ids de registre restent `"ui"`/`"api"`/`"geojson"`).

> ⚠️ Le gate de la Pass 2 lit la config **pré-merge** (les ressources de profil se chargent après) — d'où la posture **opt-out** des capacités optionnelles. Ne pas déplacer la Pass 2 sous `loadActiveProfileResources()` : les gates opt-out verraient alors les `false` profil-level et dé-enregistreraient des modules gatés tardivement, dans leur lifecycle.

### S4 (14/07/2026) — le core devient réellement tree-shakeable, et on le PROUVE

**Recadrage : aucun preset n'est livré.** Le plan initial prévoyait 3 bundles (`lean`/`standard`/`tourisme-full`) et un mécanisme de presets maison. Abandonné : GeoLeaf est OSS, tout est MIT, il livre **un seul bundle contenant tout**. Un DSL de presets aurait été de la sur-ingénierie. Ce qui restait à faire — et qui était le vrai sujet — c'est que le code **n'était pas dégraçable** : trois ancrages l'en empêchaient.

1. **`shared.module` importait `PwaLifecycle` + `OfflineLifecycle` en statique.** Un module **kernel** cloué à deux capacités optionnelles → pwa et offline étaient dans la clôture eager de **tout** bundle, quel que soit son manifeste. C'était **le** blocage. Dépendance inversée : `CapabilityInstaller.sharedLifecycle?` (nouveau champ du contrat) — `SharedModule` reçoit les installers de l'entrée et appelle qui s'est contribué. Ordre **#7 pwa → #8 offline** = ordre du manifeste, timing post-merge inchangé, registry toujours à 22 modules.
2. **`src/lazy/{legend,labels,themes}.ts` = une 2ᵉ racine de composition, aveugle au manifeste.** Leur contenu était déjà eager (via `install.ts`) : c'étaient des coquilles qui ne chargeaient **rien de neuf**, mais que `core-map.module.ts` allait chercher **à chaque boot**. Une entrée omettant `labels` aurait vu `npm run size` (qui ne suit que les imports statiques) afficher un gain **fantôme** pendant que le navigateur téléchargeait quand même `chunk-labels`. **Supprimées.** `LazyModuleName` ne garde que les 2 chunks kernel.
3. **L'entrée mélangeait kernel et capacités.** Séparé : `kernel-exports.ts` (kernel, ré-exporté par `export *`) + les 6 façades de capacité listées dans l'entrée qui les embarque.

**`installBoot(preset)`** (`app/boot-install.ts`) porte désormais le module-eval (latch perf, 8 modules kernel, `_registry`, façade `GeoLeaf.boot()`), paramétré par un manifeste. `app/boot.ts` se réduit à `installBoot(FULL)` — 6 lignes. Renommages : `TOURISME_FULL` → `FULL`, `PresetId` n'est plus une union fermée.

**La preuve, mesurée (pas supposée).** `examples/minimal/entry.ts` (9 capacités sur 17) est construite à **chaque build** et `npm run size:example` lit les **sourcemaps** de sa clôture eager :

|                                 | bundle livré (17 cap.)     | exemple (9 cap.)           |
| ------------------------------- | -------------------------- | -------------------------- |
| boot                            | **181,3 KB gz** / 8 chunks | **156,5 KB gz** / 6 chunks |
| fichiers source dans la clôture | 376                        | **285**                    |

**24,8 KB gz (−13,7 %) et 91 fichiers en moins.** Les 8 capacités exclues (`filter` 27 fichiers, `theme-selector` 9, `labels` 8, `route` 7, `branding` 6, `pwa` 6, `theme-toggle` 6, `offline` 3) sont à **zéro fichier** dans le bundle. Le registre runtime n'est **pas** l'oracle : une capacité peut en être absente (gate off) tout en étant dans le fichier, téléchargée à chaque chargement — c'est exactement le gain fantôme que S4 a fermé.

> **3 capacités sont du kernel de fait** et ne pourront jamais être exclues : `toast-renderer` (`globals.ui.ts` importe son singleton `_UINotifications`), `geolocation` (`mobile-toolbar.ts` → `GeoLocationState`), `cluster` (le loader geojson → `getClusteringStrategy`). Assumé, documenté, non corrigé.

> **✅ Résolu en S6 — le CSS suit le code.** Le diagnostic « monolithique » était faux : le CSS
> n'était **jamais importé depuis le TS** (0 `import "….css"` dans `src/**/*.ts`), il était produit
> par un pipeline PostCSS **entièrement parallèle au graphe de modules**. Aucun découpage de
> dossiers n'y aurait rien changé.
>
> Désormais : **`src/css/` = kernel uniquement**, et le CSS d'une capacité vit à côté de son
> installeur (`capabilities/<id>/css/`) et **entre dans le bundle par le graphe JS** —
> `install.ts` fait `import "./css/<id>.css"`. Une entrée qui ne liste pas `filter` n'embarque ni son
> JS, ni le CSS de sa barre de proximité. **Mesuré : 23,2 KB gz (33 feuilles) → 18,7 KB gz
> (27 feuilles), −19,3 %**, prouvé par la **sourcemap CSS** (oracle symétrique de celui du JS).
>
> **La cascade est figée par `@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities, gl.overrides`,
> et ce n'est pas cosmétique** : `rollup-plugin-postcss` concatène dans l'ordre de parcours du
> **graphe**, pas dans l'ordre d'auteur — sans `@layer`, faire entrer le CSS dans le graphe aurait
> détruit **en silence** une cascade réglée à la main. `gl.overrides` est vide : c'est le point
> d'override offert à l'intégrateur.
>
> ⚠️ **Corollaire (S12)** : un `@import` **imbriqué** dans une feuille déjà importée doit porter son
> propre `layer()`, sinon il hérite du layer de son parent. `geoleaf-geojson.css` ré-importait
> `geoleaf-theme.css` sans `layer()` : les tokens atterrissaient en `gl.kernel` — **qui surclasse
> `gl.tokens`** — et le thème était inliné **deux fois** (12 blocs `@layer gl.kernel` pour 11
> imports). Corrigé ; un **budget CSS** (`check-bundle-size.cjs`, warn 21 / fail 24 KB gz) garde
> désormais la régression, le CSS n'étant mesuré par aucun autre gate (`verify:purgecss` est vacue :
> sa safelist `/^gl-/` exempte 783 des 812 classes).
>
> **Contrat de style des boutons de fond de carte (S12)** : le hook canonique est
> **`[data-gl-baselayer]`** (`geoleaf-baselayers.css`) — le même que celui interrogé par
> `basemaps/ui.ts` (`querySelectorAll` / `closest`) et asserté par les tests. La classe
> `.gl-baselayer-btn`, second hook redondant posé sur le même bouton et dont les règles perdaient
> la cascade, a été supprimée du CSS **et** du TS. Ne pas réintroduire de hook de style parallèle
> au hook de comportement.
>
> **Deux stratégies, une par canal** : le bundle CDN **extrait** vers `dist/geoleaf-main.min.css`
> (même chemin, même nom → `exports["./style.css"]`, `build-deploy.cjs` et le SW **inchangés**) ;
> `dist/esm/` **injecte** via `adoptedStyleSheets` (CSP-safe), car des `import "./x.css"` dans
> `dist/esm/**.js` casseraient `import "@geoleaf/core"` sous Node/SSR.
>
> Au passage : **~150 lignes de CSS mort** supprimées (`.geoleaf-ctrl-zoom` / `-fullscreen`, vestiges
> Leaflet, posées par **aucun** artefact JS livré — `verify:purgecss` ne pouvait pas les voir, sa
> safelist whiteliste `/^geoleaf/` en bloc), et **184 lignes de CSS de capacité** ré-attribuées depuis
> 7 fichiers kernel. **Le kernel ne nomme plus aucune capacité.**

### S5 (14/07/2026) — le gate devient un mur, VectorTiles sort, la machinerie lazy meurt

**1. `npm run size:example` est un gate DUR.** En S4 il mesurait et rapportait ; il sort désormais **1** dès qu'un fichier d'une capacité exclue réapparaît dans la clôture eager de l'exemple. Câblé en **CI** (`ci.yml`, après le build), dans **`ci-local.cjs`** et dans **`build-deploy.cjs`** — jamais en pre-commit (le hook ne builde pas). Deux fragilités traitées en même temps, sans quoi le gate aurait menti ou cassé pour rien :

- **Les listes ne sont plus écrites à la main.** `EXCLUDED`/`EMBARKED` étaient deux tableaux codés en dur : le premier ajout de capacité les aurait désynchronisés en silence. Elles sont **parsées du code qui les décide** — l'univers depuis `presets/manifest.full.ts`, les embarquées depuis `examples/minimal/entry.ts`, les exclues par différence. ⚠️ L'univers vient du **manifeste**, pas du listing de `src/capabilities/` : un répertoire ne fait pas autorité sur ce qui est livré. La preuve historique était `capabilities/layers/public-api.ts`, du **kernel mal rangé** (importé par `api/geoleaf.layers.ts`), que le listing aurait classé « exclu » → faux rouge permanent. **ARCHI S12.3 l'a déplacé en `kernel/geojson/layers-public-api.ts`** : le répertoire ne contient plus que les 18 capacités déclarées, ce piège-là a disparu — la règle tient parce que le prochain fichier mal rangé le réarmerait en silence (constaté au CAPACITÉS S11).
- **`turbo.json` : `outputs` inclut désormais `examples/dist/**`.** Sans ça, un cache HIT restaurait `dist/` mais pas l'artefact de l'exemple → gate rouge **par intermittence**. (`inputs`cible`examples/minimal/**`, pas `examples/**`, pour ne pas faire manger à Turbo sa propre sortie.)

**Vérifié en injectant la régression** : un `import "../capabilities/labels/install.js"` ajouté dans `globals.geojson.ts` (kernel) fait sortir le gate en **exit 1** avec `labels — 4 fichier(s)`. Un gate vert qu'on n'a pas vu mordre ne prouve rien.

**2. VectorTiles → 18ᵉ capacité** (`capabilities/vector-tiles/`, 744 l. **au relevé du S5** ; 527 au 08/08/2026, socle B.1 ayant sorti le bâti MapLibre). C'était la **dernière arête kernel→capacité** après S4 : `globals.geojson.ts` l'importait statiquement, ce qui clouait le MVT dans la clôture eager de **tout** bundle — y compris celui d'un intégrateur qui ne servira jamais une tuile. Patron `cluster` : pas de `createModule` (capacité de _politique_, pull-based), **pas de gate** (le contrat l'autorise — l'activation est **par couche**, `data.vectorTiles.tilesUrl`, famille de config B5 déjà inventoriée ; inventer `modules.vectorTiles.enabled` aurait ajouté un paramètre public qui ne garde rien). L'arête coupée devient un **lecteur de service-locator** (`getVectorTiles: () => _gl._VectorTiles`), exactement comme `getLabels`/`getTaxonomy`/`getDataConverter` juste à côté. Les 2 consommateurs avaient **déjà** leur repli (`if (VT && …)`) — et c'est déjà le chemin que prend **tout profil livré** (voir ci-dessous). Registry inchangé à **22 modules** ; Pass 1 passe à **18 déclarations**.

> ⚠️ **Les 4 fichiers devaient physiquement descendre sous `capabilities/vector-tiles/`.** Le gate filtre les sourcemaps sur `capabilities/<id>/` : laissés dans `kernel/geojson/`, ils seraient restés **invisibles au gate**, et l'assertion d'exclusion aurait passé **à vide** — pire qu'un gate absent.

> 🟠 **MVT est dormant, pas mort.** Aucun profil livré ne l'active : les 6 couches `tourism` déclarent `vectorTiles.enabled: true` **sans `tilesUrl`**, et `shouldUseVectorTiles()` exige une URL absolue → elles retombent toutes en GeoJSON (aucun `.pbf` ni dossier `tiles/` dans le dépôt). Cause probable : le guide de configuration documentait les 7 clés décoratives et **omettait `tilesUrl`**, la seule qui arme la fonctionnalité — corrigé en S5 (params #66b/#66c). Les tuiles vectorielles IGN qu'affichent 5 profils sont des **fonds de carte** (`basemaps.json` → `style: …/vectorTiles/styles/PLAN.IGN/…`), rendus nativement par MapLibre via _baselayers_ : ce chemin **n'utilise pas** `capabilities/vector-tiles/`.

**3. La machinerie lazy est SUPPRIMÉE** (BREAKING). `src/lazy/`, `app/lazy-module-loader.ts`, `GeoLeaf._loadModule`, `GeoLeaf._loadAllSecondaryModules`, `_app._ensureModule`, la règle 1 des `manualChunks`, `scripts/check-lazy-orphans.cjs`, les entrées `knip` et `sideEffects`. Les 2 derniers `lazy/*` (layer-manager, basemap-selector) étaient les **mêmes coquilles** que celles supprimées en S4 : leurs 7 imports sont tous déjà eager (`globals.ui.ts:37-41` + `kernel-exports.ts`), et **Rollup le disait à voix haute** — `(!) Generated empty chunks: "lazy/basemap-selector" and "lazy/layer-manager"`. Le boot déclenchait donc un `import()` d'un fichier **vide** à chaque chargement de page (`core-map.module` #6), que `ui.module` **attendait** (#15), pour 2 marks perf et un log mensonger. 0 appelant de production. Golden-master **non touché** (ces clés étaient assignées dans `bundle-esm-entry.ts`, que le test ne require pas).

> ⚠️ **Effet de bord sur la détection de code mort** : `check-lazy-orphans.cjs` était, d'après l'audit, le **seul filet fiable** contre le code mort de `packages/core` (knip y est aveugle). Il disparaît — mais il ne couvrait que `src/lazy/*`, qui n'existe plus : **aucune couverture perdue**.
>
> **Mise à jour — l'« angle mort de knip sur le reste du core » a changé deux fois de nature.** (1) Ce n'était pas un angle mort de knip mais un défaut de packaging : le sous-chemin `"./dist/*"` du `exports` du core promouvait tout `src/**` au rang de point d'entrée, et un point d'entrée n'est jamais « unused ». Retiré à l'API S2.4, knip a immédiatement signalé 159 symboles. (2) Ces 159 ont été triés un par un (API S2.4c) : **0 actionnable**, 116 faux positifs de baril. La catégorie exports/types est donc **délibérément coupée** sur `packages/core/src/**` depuis le 26/07/2026 (`ignoreIssues` dans `knip.js`). L'angle mort n'est plus subi, il est choisi et motivé — et `check-orphan-exports.cjs` en est le seul titulaire, avec une méthode par token qui voit ce qu'un graphe d'imports ne peut pas voir.

**4. Deux gates qui mentaient, corrigés.** `BUNDLE_WARN_GZ_KB = 85` / `BUNDLE_FAIL_GZ_KB = 100` (seuils sur `geoleaf.esm.js` **seul**) : depuis `kernel-exports.ts` l'entrée est un **shim de 0,5 KB gz** — le seuil était inatteignable par toute régression. Supprimés (la taille de l'entrée reste **affichée**, comme information). Même maladie, même remède pour `smoke-test.cjs`, qui assertait `esmText.length > 100_000` et était donc **rouge depuis S4** sans que personne ne le voie : il mesure désormais la **clôture** (entrée + chunks statiques), pas l'entrée.

**Payloads mesurés (S5)** — le bundle livré **ne maigrit pas**, ce n'est pas l'objectif :

|      | bundle livré (18 cap.)     | exemple (9 cap.)           |
| ---- | -------------------------- | -------------------------- |
| boot | **181,0 KB gz** / 8 chunks | **153,9 KB gz** / 6 chunks |

**−27,1 KB gz (−15,0 %)**, contre −13,7 % en S4 : le delta est le MVT qui sort vraiment. Plancher du gate : **12 %** (marge de 3 points — c'est un plancher anti-effondrement, pas un cliquet sur les octets).

---

## Capacités in-core — `src/capabilities/<id>/`

Introduites par SR0 (04/07/2026) : les **capacités first-party** rapatriées depuis d'anciens plugins externes vivent sous `packages/core/src/capabilities/<id>/` (auto-contenues : logique + CSS + tests portés). Lien **typé compile-time** (déclaration `ICapabilityDeclaration` enregistrée au boot, gate `modules.<id>`), livrées **inline** dans `geoleaf.esm.js`. Chaque capacité expose : **`install.ts` (S2 — l'ancrage canonique, cf. §Presets)** · `<id>-capability.ts` (déclaration + gate) · un wrapper **`capabilities/<id>/module.ts`** (`ICoreModule`, patron `labels`) **si elle a un cycle de vie** (facultatif) — ⚠️ **relocalisé depuis `app/boot-modules/` au backlog R.10 (24/07/2026)** : la capacité est désormais réellement auto-contenue, et l'exception ESLint qui autorisait 13 `install.ts` à importer `app/` est tombée **par construction**. Seuls les **6 wrappers kernel** (`config`, `core-map`, `geojson`, `shared`, `theme-engine`, `ui`) restent sous `app/boot-modules/`, et aucune capacité ne les importe · une façade `api/geoleaf.<id>.ts` (montée par le `registerGlobals` de l'installer, **plus** par `globals.api.ts` depuis S2). Capacités : `capabilities/taxonomy/`, `capabilities/feature-info/` (patron complet avec `ICoreModule`), et `capabilities/cluster/` (S3, 05/07/2026 — **variante pull-based sans `ICoreModule`** : capacité de _politique_ (clustering natif MapLibre) interrogée à la demande par les pipelines GeoJSON/POI ; aucun listener à câbler, le gate `modules.cluster.enabled` **opt-out** est appliqué par le lecteur de config ; façade `GeoLeaf.Cluster`), et **`capabilities/labels/`** (S4, 05/07/2026 — migrée de `modules/optional/labels` ; étiquettes en couches `symbol` MapLibre natives ; `LabelsLifecycle` + bouton 🏷️ injecté via le seam `geoleaf:layer-item:controls` ; gate `modules.labels` opt-out ; façade `GeoLeaf.Labels` montée dans `globals.ui` split car exclue du build Lite), et **`capabilities/filter/`** (S5, 06/07/2026 — **refonte** du filtre POI/Route-centrique en filtre attributaire générique géométrie-agnostique ; `FilterModule`/`FilterLifecycle` montent le panneau sur `geoleaf:app:ready` ; sous-dossiers `engine/` (prédicat JS, 6 kinds — le volet « expression MapLibre native » a été **purgé en S5/N-4** : jamais appelé, gain nul sur 6 profils/9 car `text` est JS-only et présent 9/9, et pas de garde cluster ; `apply.ts` reste le **writer unique** du filtre de couche), `panel/` (rendu mapping-driven + `panel/proximity/`), `filters/` (moteur POI/Route legacy relocalisé depuis `built-in/filters`, alias Lite `route-filter`) ; **découplé** de POI/Route (zéro import statique, seams runtime + `GeoJSONCore`) ; seam **transitoire** `taxonomy-source.ts` (source catégories core vivante, à retirer S10) ; gate `modules.filter` opt-out ; façade `GeoLeaf.Filter` (contrat de sérialisation `getActiveFilter`/`applyFilter` ajouté S13 ; shims `_UIFilterPanel*` + `compat.ts` **supprimés** S13, tous consommateurs sur le contrat)), et **`capabilities/toast-renderer/`** (S7, 09/07/2026 — renderer DOM des notifications (« toasts ») relocalisé de `built-in/ui/notifications` + `app/init-notifications` (supprimés) ; `ToastRendererLifecycle`/`ToastRendererModule` (deps `["geojson"]`, **pas** `["ui"]` — deadlock `UIModule`) créent le container, enregistrent le renderer auprès de la **primitive kernel `notify()`** (`registerRenderer`), montent le loading toast persistant + les listeners profil/thème ; sous-dossier `renderer/` (`NotificationSystem`), `css/notifications.css`, `types.ts` (ex-`notification.contract`), `public-api.ts` (façade `Notifications`, export ESM) ; la **primitive `notify()` reste au kernel** (ancre B2 `GeoLeaf.notify`) ; gate `modules.toast-renderer` opt-out ; surfaces `_UINotifications`/`NotificationSystem`/`ui.notify` re-montées dans `globals.ui[.lite]` ; consommateurs kernel/plugins (`control-geolocation`, storage, addpoi) via seam runtime `globalThis.GeoLeaf._UINotifications`), et **`capabilities/theme-selector/`** (S8 F2, 09/07/2026 — sélecteur de thème UI (6 fichiers `theme-selector*.ts`) relocalisé de `built-in/themes/` ; `ThemeSelectorLifecycle`/`ThemeSelectorModule` (deps `["geojson"]`) montent la barre de thèmes sur `geoleaf:app:ready` (garde d'acceptation : profil actif + conteneurs présents) ; le **moteur** (`theme-applier/*`, `theme-loader`, `theme-cache`, `geoleaf:theme:applied`) **reste kernel** (Design B), l'**application du thème par défaut** au boot passant par un nouveau **`ThemeEngineModule`** (`app/boot-modules/theme-engine.module.ts`, kernel **inconditionnel**, deps `["geojson","ui"]` — doit s'exécuter après `setupReveal` #23 sinon reveal/permalink manqués ; `init()` `await` l'apply) ; accès moteur par **import direct** typé (pas les seams `_ThemeApplier`/`_ThemeLoader`, montés en copie superficielle divergente) ; `populate` LayerManager **reste kernel** dans `initGeoJSON` ; gate `modules.theme-selector.enabled` **opt-out** via `CapabilityRegistry` (S8 F3, 10/07/2026 — descripteur `theme-selector-capability.ts` + `register`/`isEnabled` en **Full ET Lite**, adaptateur `_capConfig` extrait en helper partagé `toCapConfig` dans `app/capability-registry.ts` ; migration cassante de `ui.showThemeSelector` → `config/plugins/theme-selector.json`) ; façade `GeoLeaf.ThemeSelector` **préservée**, montée dans `globals.ui[.lite]` ; tests co-localisés sous `__tests__/capabilities/theme-selector/` — S8 F4, 10/07/2026 — dont `theme-selector-capability.test.js` verrouillant le gate opt-out), et **`capabilities/legend/`** (S10, 10/07/2026 — légende cartographique multi-couches relocalisée de `modules/optional/legend/` (F0) ; `LegendLifecycle` (deps `["geojson"]`) monte le contrôle sur `geoleaf:app:ready` + charge les légendes des couches du thème actif, `Legend._reset()` teardown complet (F1) ; **F2** migration cassante `ui.showLegend`+`legendConfig` → `modules.legend` (descripteur `legend-capability.ts` gate **opt-out** `enableWhenAbsent:true` Full+Lite via `CapabilityRegistry` ; reader `config.ts` `getLegendConfig` — **accesseur unique depuis CAPACITÉS B.29**, l'alias booléen `isLegendEnabled()` a été résorbé, legend était la seule capacité à en exporter un second) + **réveil config option B** (`title`/`position`/`collapsedByDefault` désormais réellement lus → rendu changé) + event **`geoleaf:legend:ready`** ; façade `GeoLeaf.Legend` **préservée** ; P2 différée = bascule `taxonomy` + retrait `TaxonomyManager` ; **CAPACITÉS B.28/B.36 (21/07/2026)** — `public-api.ts` n'était pas une façade (546 l. d'état, timers, `fetch()`, DOM) et `lifecycle.ts` en importait `Legend`, seule capacité dont le cycle de vie dépendait de son API publique : runtime extrait en **`legend.ts`**, overlay « busy » extrait en **`legend-overlay.ts`**, `public-api.ts` réduit au ré-export (patron `labels`/`geolocation`), `lifecycle.ts` importe désormais l'implémentation ; nouveau **`constants.ts`** (`LEGEND_TAXONOMY_REF`) qui source-unique le `"poi-cat"` codé en dur ×2 et documente la limitation B.36d — la légende ignore encore `modules.taxonomy.layers.*.use`), et **`capabilities/permalink/share/`** (S12 → S13 F7, **sous-fonction de permalink** — modal de partage (copie du permalink + QR code lazy `qrcode-generator`) relocalisée de `kernel/share/` puis `capabilities/share/` ; `ShareLifecycle`/`ShareModule` (deps `[]`) s'abonnent aux seams kernel `geoleaf:toolbar:action` (ouverture modal) et **`geoleaf:desktop-panel:tabs-ready`** (injection du bouton desktop via le seam `desktop-tabs-seam.ts` — **le kernel n'importe plus la capacité**, patron labels `geoleaf:layer-item:controls` + catch-up) ; fichiers `share-modal`/`share-link`/`share-qr`/`share-button-desktop` + `config.ts`/`public-api.ts`/`types.ts`/`lifecycle.ts` ; gate `modules.permalink.share.enabled` **opt-out** (S13 F7 — plus de `SHARE_CAPABILITY` top-level, sous-clé `PERMALINK_CAPABILITY.configSchema.share` ; gate boot direct `_capConfig.get(…) !== false`) — migration cassante de `ui.showShareButton` puis `modules.share` ; façade `GeoLeaf.Share` **préservée**, montée dans `globals.ui` split car exclue du build Lite ; QR `qrcode-generator` conservé en `import()` lazy), et **`capabilities/permalink/`** (S13, 12/07/2026 — sync état↔URL / deep-linking relocalisé de `kernel/permalink/` ; **modèle `cluster` sans `ICoreModule`**, piloté par 2 hooks boot (`core-map.module` lecture pré-carte + `init-reveal` apply/sync) ; `permalink-capability.ts` gate **opt-out** `modules.permalink` — migration cassante de `ui.permalink` ; **découplé du DOM filter** via le contrat `GeoLeaf.Filter.getActiveFilter`/`applyFilter` — scraping DOM + ghost-injection supprimés, `permalink-restore` réduit à la visibilité couches ; façade `GeoLeaf.Permalink` **préservée** ; **F7 : `share` absorbé en sous-fonction** (`capabilities/permalink/share/`, gate `modules.permalink.share.enabled`)). (⚠️ Ce paragraphe opposait ces capacités à `modules/optional/*`, « patron-pilote historique — route/search y migreront ultérieurement ». **La migration est terminée et le répertoire n'existe plus** : `search` retiré au S6, `legend` au S10, `route` au S11 — `067fd172`, 11/07/2026, qui a emporté `modules/optional/` avec lui. Il n'y a plus qu'une seule façon de porter une capacité. Voir [ADR-06 révisé](../specs/CDC_kernel.md) — backlog résiduel R.12.)

---

### Les 4 arêtes capacité → kernel (CAPACITÉS S10, 21/07/2026)

Quatre capacités **consomment** une primitive du kernel au lieu de la réimplémenter. Chaque bascule
a été faite par un sprint différent, et jusqu'au S10 **aucune n'était tenue par quoi que ce soit** :

| Capacité                                     | Consomme                                                                            | Posée par  |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `scale/scale-control.ts`                     | `scaleAtZoom` / `zoomAtScale` (`utils/general/scale-utils.ts` — immobile)           | S6         |
| `legend/legend-generator.ts`                 | `resolveCategoryKey` + `resolveCategoryEntry` (`capabilities/taxonomy/resolver.ts`) | S4 / B.36a |
| `vector-tiles/`                              | la résolution de paint reste dans `adapters/maplibre/maplibre-vector-tiles.ts`      | socle B.1  |
| `filter/panel/proximity/proximity-circle.ts` | `EARTH_RADIUS_M` (`utils/geo/haversine.ts`)                                         | S10        |

**Pourquoi les gates existants n'y suffisaient pas.** `check-orphan-exports` et knip cherchent un
export **sans consommateur**. Or `scaleAtZoom` (`scale-utils.ts:95,190`) et `resolveCategoryKey`
(`resolver.ts:133,137`) ont aussi des appelants **internes à leur propre module** : une capacité qui
re-forkerait la formule à côté les laisserait parfaitement verts. La duplication n'aurait pas non
plus été vue par `jscpd` — un re-fork réécrit, il ne copie pas.

**Ce qui les tient désormais**, dans cet ordre de force :

1. **`packages/core/__tests__/capabilities/kernel-reuse.test.js`** — le vrai garde-fou. Chaque test
   calcule son attendu **avec** la primitive du kernel, jamais avec une valeur en dur : toute dérive
   numérique rougit, quelle que soit la façon dont elle est écrite. Vérifié par mutation (re-fork
   injecté dans `_calculateScale` et dans `_circlePolygon` → 3 tests rouges).
2. **`no-restricted-syntax`** (`eslint.config.mjs`, bloc 6ter quater) — ne couvre que le copier-coller
   littéral des deux constantes physiques, mais le signale **à l'écriture**, avec le nom du symbole à
   importer.
3. **`no-restricted-imports`** (bloc 6ter ter, socle B.1) — l'arête vector-tiles, qui est une
   frontière d'import et se gate donc directement.

⚠️ **Le re-fork n'est pas une hypothèse.** `plugin-print` portait **quatre** copies de la constante
Web Mercator (`modal-renderer.ts`, devenu `modal-open.ts` au STRUCT S4, et `offscreen-render.ts`) sous sa forme **arrondie**
`156543.04` — précisément celle dont le core s'est débarrassé au S6. ✅ **Ramené à une seule au
PLUGINS S6** (23/07/2026) : `METERS_PER_PIXEL_AT_ZOOM_0` et `R_EARTH` sont exportés depuis
`page-format.ts`, les deux littéraux du modal ont disparu avec l'extraction de `calcZoom()`, et
`offscreen-render` importe au lieu de redéclarer. **La divergence de valeur avec le core reste
entière** — c'est toujours `156543.04` arrondi, dans un paquet séparé : seule la duplication
_intra-paquet_ est soldée. `plugin-editor`
(`drawing/geo-compute.ts:7,16`) porte de son côté son propre `EARTH_R` **et** sa propre
`haversineDistance` ; ici la valeur est la bonne (`6_371_000`), donc aucune dérive numérique
aujourd'hui — mais rien ne l'y tient. Le bloc 6ter quater est scopé au **core** : l'étendre aux
plugins ferait rougir 5 sites hors périmètre CAPACITÉS, et suppose d'abord de trancher comment un
plugin consomme une primitive du core (frontière `verify-plugin-core-boundary.cjs`) → roadmap PLUGINS.

**Complément (PLUGINS S9) — les copies délibérées sont gatées.** Puisque `verify-plugin-core-boundary.cjs` **interdit** au plugin d'importer les sources du core, il subsiste par nécessité des **seams** : des fichiers copiés de part et d'autre de la frontière (`pill-search`, `storage-contract`, `field-renderer/sanitize`). `scripts/verify-seam-drift.cjs` (câblé `ci:local`) épingle un hash normalisé de chaque moitié et force une re-confrontation dès qu'un côté change — sans quoi une copie que personne ne relit dérive en silence (le mode d'échec de `coreConfigGet` au S1). Registre des paires dans le script ; détail au `CDC_technique` (« Registre des seams cross-frontière »).

**Complément (PLUGINS S11) — les utilitaires consolidés sont gatés contre le re-fork.** Symétrique du précédent : `verify-seam-drift.cjs` surveille les copies cross-frontière qu'on **ne peut pas** supprimer — **6 seams / 15 fichiers depuis STRUCT S2 (F9)**, contre 3 / 6 avant, avec un **plancher dérivé** (`FLOOR`) qui ferme sa seule panne muette : son message de succès ne comptait que les seams, jamais les fichiers, donc un `files[]` amputé passait sans un mot (le seam `storage-contract`, retiré au S4.4, avait fait passer le compteur de 4 à 3 sans témoin). Les 3 seams ajoutés comblent un trou **préexistant** : PSF exempte les DEUX côtés d'une paire core ↔ host-runtime, donc rien ne confrontait `getGeoLeaf` / `ensureGeoLeaf` / `coreConfigGet` — la fonction même dont la dérive a motivé la création de PSF ; `scripts/verify-plugin-shared-fork.cjs` (câblé `ci:local`, `ci.yml` et `.husky/pre-commit`) interdit celles qu'on **vient** de supprimer. Il refuse toute **re-définition** locale d'un symbole canonique de `@geoleaf/host-runtime` (`coreConfigGet`, `adoptStylesheet`, `wireTouchDrag`, `getUINotifications`…). ⚠️ Il ne détecte donc **pas** la même chose que `verify-plugin-core-boundary.cjs` : celui-ci matche des specifiers d'**import**, alors qu'un fork est une **re-déclaration** — la clé est le mot-clé (`function`/`const`) précédant un nom canonique, ce qui laisse passer import, ré-export et usage. La liste des symboles est **dérivée** des exports de `host-runtime/src/index.ts` (jamais recopiée), avec une garde d'ancres qui **jette** si le parse s'effondre — une liste vide rendrait la gate verte en ne cherchant rien. **PSF-01** refuse toute re-définition hors baseline ; **PSF-02** force la baseline à rétrécir — ✅ **elle est VIDE depuis STRUCT S2 (F7)** : son unique entrée (`plugin-addpoi` `getGeoLeaf`) a été payée, le plugin importe l'accesseur partagé et ne garde qu'un narrow local renommé `coreHost`. Les ancres passent de 4 à **10** au même sprint — une par famille canonisée, pour que le garde-fou grandisse avec la surface qu'il garde. Le **core est hors périmètre** : il possède `getGeoLeaf`/`ensureGeoLeaf`/`coreConfigGet` de son côté, et host-runtime les **miroite** sans pouvoir les importer (contrat de bundle) — ses homonymes sont des pairs, pas des forks.

⚠️ **Ne pas unifier `general-utils.getDistance`** (`R = 6371` **kilomètres**) avec
`EARTH_RADIUS_M` : la divergence est délibérée et documentée sur la fonction — elle est publiée comme
`GeoLeaf.Utils.getDistance`, et ce sont les **unités** qui diffèrent, pas seulement la valeur. Le
piège s'est déjà refermé une fois (`route-filter`, KERNEL S11).

---

### `capabilities/taxonomy/` — v3, le symbole du point (14/07/2026)

Refonte du **périmètre**. La capacité possède désormais le **symbole du point** — icône, couleur d'icône, pastille — et la **couleur des badges pill** de feature-info. La couleur de la **géométrie** (fill polygone, stroke ligne, couleur métier des points) **et la taille du point** appartiennent au `styleRules` de chaque couche.

- **Purement pull-based** : plus aucun `ICoreModule`, plus aucun lifecycle, plus aucun listener (elle rejoint `cluster` et **`vector-tiles`** dans cette famille — ⚠️ **corrigé au S10** : cette phrase citait `permalink`, qui déclare en réalité un `createModule` — celui de sa sous-feature `share/` — et omettait `vector-tiles`, le vrai troisième membre. La même erreur figurait dans `preset.contract.ts` et le tableau §P2-14 du CDC ; les trois sont repris, et la famille est désormais figée par `__tests__/capabilities/scaffold-taxonomy.test.js`, qui la **dérive** des installeurs au lieu de la lister). Elle fournit des expressions et des ids à qui les demande.
- **Le « peintre » est supprimé** — `apply.ts`, `expression-builder.ts`, `lifecycle.ts`, `app/boot-modules/taxonomy.module.ts`. Il peignait `fill-color`/`line-color` par catégorie et **n'a jamais tourné** : gate opt-in évalué **avant** le merge du profil qui porte sa clé (`boot.ts:219` vs `:230`). Le gate est désormais **opt-out et total** (`enabled: false` coupe icônes, pastille, pills, légende, filtre).
- **Nouveaux fichiers** : `tint.ts` (teinte → clé → id d'image), `marker-paint.ts` (expression de pastille), `badge.ts` (couleurs de pill), et côté adapter `adapters/maplibre/maplibre-taxonomy-paint.ts` (le seam, lu en duck-typing — un import statique fermerait un **cycle**, `public-api.ts` important déjà `maplibre-poi-icons.js`).
- **⚠️ Deux espaces d'ids d'icônes.** `resolvePoiIcon` alimente l'**atlas MapLibre** (`icon-image`) : son `symbolId` porte un suffixe `--<teinte>` quand une couleur est déclarée. `resolveTitleIcon` alimente le **DOM** (`<use href="#…">` sur le `<symbol>` du sprite injecté) : il doit rester **brut**. Les confondre fait disparaître les icônes de la carte sans qu'aucun test ne rougisse — d'où `__tests__/capabilities/taxonomy/id-spaces.test.js`.
- **Composition du paint** : taxonomy réécrit **la seule branche par défaut** du `["case", …]` produit par `styleRulesToPaint`. Cascade : `styleRules > sous-catégorie > catégorie > défaut de la couche`. Appliqué aux **deux** chemins — création (`maplibre-helpers._addPointSubLayers`) **et** re-stylage (`maplibre-style-applier`, oublié à l'origine : un changement de thème effaçait aussi le badge de synchro offline).
- **Supprimé hors capacité** : `utils/helpers/style-resolver.ts` (API publique orpheline, 0 appelant, hardcodait `properties.categoryId`) · `CapabilityInstaller.forceConfig` + `PresetDefinition.baseConfig` (0 consommateur ; le gate opt-out rend l'overlay inutile).
- **Pipeline de style GeoJSON — purge KERNEL S6 (18/07/2026).** `kernel/geojson/style-utils.ts` **supprimé** (son unique export `normalizeStyle` n'avait aucun consommateur prod : écrit sur le global `_StyleUtils`, jamais lu) et `style-resolver.ts` réduit **347 → 134 L**. En sortent `buildLayerOptions` (Leaflet-era, sans appelant prod) et `buildMapLibreStyleSpec` — ce dernier était **inerte** : il lisait `GeoLeaf._MaplibreStyleConverter`, un global qu'aucun code de production n'a jamais posé, et retournait donc toujours trois objets paint vides. Le vrai chemin paint passe par `adapters/maplibre/maplibre-style-converter.ts`, que l'adaptateur importe en direct. **Reste** dans `style-resolver.ts` l'évaluation, engine-agnostique, des `styleRules` (`evaluateStyleRules` / `evaluateCondition` / `getNestedValue`), exposée via `GeoLeaf._StyleRules` et consommée par le module Themes. Surface globale `_StyleUtils` retirée des 2 golden-masters (membre `_`-interne, absent des typings publiés → non-breaking).

---

### `capabilities/offline/` — la frontière avec `offline-ui` (CAPACITÉS S1, 19/07/2026)

Le moteur offline vit in-core derrière un `import()` dynamique, mais l'**UI** reste dans `offline-ui`.

> ⚠️ **Annotation du 27/07/2026 — la moitié de cette phrase décrivait un mécanisme SUPPRIMÉ.** Elle disait que l'UI « atteint deux modules du core en deep import via l'alias `@core-offline/*` ». **Cet alias n'existe plus** : `coreSourceRedirectPlugin` a été retiré à l'API publique S4.4c, et `offline-ui` n'a plus **aucun** import `@core*` — les singletons passent par `globalThis.GeoLeaf`, `resolveProfileLayers` par le sous-chemin publié, et `estimateVectorZone` a été déplacée dans le plugin. Le `modulesRoot` de cet alias pointait d'ailleurs `packages/core/src/modules`, disparu depuis longtemps : sa branche « core » ne résolvait déjà plus rien. Vérifié : `packages/plugins/offline-ui/rollup.config.mjs:18-32`. Ce qui suit reste vrai — ce sont les invariants qui ont **permis** ce découplage. Ce n'est pas un import ordinaire : **rollup copie la source résolue dans le bundle du plugin**. Ce qu'un tel module importe, le plugin l'embarque.

- **`cache/tile-math.ts` (nouveau, 129 L) — à garder SANS AUCUN IMPORT.** C'est un invariant, pas une préférence. Il porte la math XYZ pure (`latLngToTile`, comptage de tuiles, `estimateVectorZone`) que l'UI utilise pour estimer un téléchargement. Il remplace un import de `cache/calculator.ts` — 465 lignes pour 2 méthodes, qui entraînaient le logger du core dans le bundle de storage. `calculator.ts` y **délègue** au lieu de dupliquer, en passant `defaults.webMercatorMaxLat` en argument explicite pour que sa mutabilité reste effective.
- **`kernel/config/profile-layers.ts` — Log-free par injection.** Ses deux avertissements passent par un `onWarn` fourni par l'appelant (le core passe son `Log`, le plugin le sien), au lieu d'importer le logger. Même raison, même contrainte. L'avalement des erreurs à `[]` reste délibéré.
- **Ce que ça a valu** : `offline-ui` 270,45 → 253,63 KiB, 3 → 0 marqueur de logger. ARCHI S7 avait établi qu'il n'y a **aucun palier intermédiaire** — les marqueurs ne tombent qu'au retrait de la **dernière** attache. Traiter un seul des deux modules n'aurait rien donné.
- **Gate** : `bundle.test.js` des plugins `offline-ui` et `addpoi` échoue si `setQuietMode` / `getLevelName` / `showSummary` réapparaissent dans l'artefact livré. Vérifié par mutation.
- **`if (Log)` : jamais.** `Log` est un `Proxy` (`utils/log/logger.ts`), donc toujours truthy — la garde ne protège rien, pas même en test, où l'override passe par le trap `get`. 75 occurrences retirées de ce sous-arbre.

---

### `capabilities/theme-selector` + `theme-toggle` — les deux axes du thème (CAPACITÉS S5, 20/07/2026)

Il n'y a pas « trois moteurs de thème » concurrents mais **deux axes orthogonaux**, chacun avec un moteur kernel + une capacité UI, plus une **façade publique délégante**. `theme-selector` et `theme-toggle` sont deux capacités **distinctes et légitimes** (arbitrage rendu S8 / kernel S9), pas une redondance.

- **Axe A — chrome clair/sombre.** Moteur canonique **`_UITheme`** (`kernel/ui/theme.ts`) : écrit la classe `body` `gl-theme-light|dark` (+ le conteneur `#geoleaf-map` pour le plein écran), persiste en `localStorage`, émet **`geoleaf:ui-theme-changed`**. UI = capacité **`theme-toggle`** (bouton sur la carte, opt-in défaut OFF) : pilote le moteur en direct via `_UITheme.toggleTheme()`/`getCurrentTheme()` (`theme-toggle.ts:82,75`) et **ne possède que le bouton**. Façade publique = **`kernel/map/theme.ts`** (`GeoLeaf.Core.setTheme/getTheme`) : **délègue** à `_UITheme.applyTheme`/`getCurrentTheme` quand `GeoLeaf.UI` est présent (`theme.ts:82-85,104-105`), avec un **fallback** body-class (`theme.ts:33-41,52-56`) seulement si l'UI est absente. ⚠️ **Ce n'est pas un 2ᵉ moteur** : kernel S9 (`roadmap_optimisation-kernel.md`, ✅ archivée) a supprimé son état interne `_theme` et l'a rendu délégant ; il est **conservé comme API publique typée** — ne pas le « retirer ».

- **Axe B — multi-thème (couches de carte).** Moteur **`kernel/themes/`** (`ThemeLoader` + `ThemeApplierCore`, kernel « Design B ») : applique des **couches de carte** depuis la config profil et émet **`geoleaf:theme:applied`**. UI = capacité **`theme-selector`** (barre de boutons principaux + dropdown secondaire) : consomme le moteur par **import direct** `ThemeApplierCore.applyTheme(theme)` (`theme-selector.ts:178`), gate opt-out. Le **thème par défaut** est appliqué au boot par `ThemeEngineModule` (kernel inconditionnel) ; le sélecteur ne fait que **refléter** l'état actif à l'init (plus d'apply depuis S8/F2, `theme-selector.ts:98-101`).

- **Invariant de frontière.** Les deux axes **ne s'appellent jamais** et n'ont **aucun writer DOM concurrent** : `theme-selector` n'écrit jamais la classe `gl-theme-light|dark`, `theme-toggle` ne touche jamais les couches ; événements disjoints (`geoleaf:ui-theme-changed` vs `geoleaf:theme:applied`). Corollaire portage : l'axe A est purement DOM/CSS (engine-agnostique), l'axe B dépend de l'adaptateur de carte (un moteur non-MapLibre réimplémenterait `built-in/themes/`).

---

## Typage & conventions de types

Le core est typé `strict` **sans `any`** (roadmap `typage-strict` clôturée 25/06/2026 — `count:any` core 2569 → 1 irréductible documenté). Deux conventions structurent les types :

- **`global.d.ts`** — déclarations ambient canoniques (unique source du namespace `GeoLeafGlobal` + `maplibregl` type-only). Membres typés là où stables, queue `[key: string]: unknown` pour le reste (jamais `any`).
- **Hubs `<module>-types.ts`** — un fichier de types runtime par domaine (vues structurelles : état, adaptateur, entrées de couche). Ex. `geojson/core-types.ts`, `capabilities/filter/filters/filter-types.ts`, `geojson/loader/loader-types.ts`, les hubs `optional/*/<module>-types.ts`, `adapters/maplibre/maplibre-adapter-types.ts`. Les modules feuilles ne **`import type`** jamais depuis `ui/` (cycle).

**Enforcement** — double cliquet ESLint sur tout `packages/core/src/**` (voir CDC technique §P2-26) : `no-explicit-any: error` (constante `ANY_HARDENED`) + `no-unsafe-*: error` (type-aware, `parserOptions.projectService`). Un dossier n'est ajouté au cliquet qu'une fois nettoyé et vert — sens unique, jamais retiré.

## Versioning

Le versioning est **indépendant par package publié**. Chaque `packages/*/package.json` est sa **propre source de vérité** ; la version est injectée au build via le token `__GEOLEAF_VERSION__` (`@rollup/plugin-replace` lit `pkg.version`) puis exposée au runtime (`globals/globals.core.ts` → `GeoLeaf._version`). Il n'y a **aucun alignement** monorepo ↔ packages, par conception : `@geoleaf/core` (public) suit son propre SemVer (3.x = breaking post-v2), les plugins le leur.

La version de la **racine du monorepo** (`package.json` racine, `2.0.0`) est un **identifiant d'orchestration** : la racine est `private:true`, **jamais publiée**, et sa version n'est **pas significative** (elle ne pilote rien — ni build, ni runtime, ni publication). Ne pas chercher à l'aligner sur `core`.

Garde-fou : `npm run versions:check` (`scripts/check-versions.cjs`, étape CI) vérifie semver valide sur chaque package, résolution des dépendances internes, et qu'un package interne `private` (non publié, ex. `@geoleaf/host-runtime`) n'est **jamais** déclaré en `dependencies`/`peerDependencies` d'un consommateur (uniquement `devDependencies` — il est bundlé inline ; sinon `npm install` du consommateur publié casserait).
