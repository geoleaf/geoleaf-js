---
title: "GeoLeaf-JS — Architecture Guide"
---

# GeoLeaf-JS — Architecture Guide

**Package :** `@geoleaf/core`

**S'applique à :** `@geoleaf/core` v3.x
**Target :** Browser (ESM), TypeScript strict

---

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Séquence de boot B1→B11](#séquence-de-boot-b1b11)
3. [Formats de bundle](#formats-de-bundle)
4. [Adaptateur cartographique IMapAdapter](#adaptateur-cartographique-imapadapter)
5. [Modules built-in vs optional](#modules-built-in-vs-optional)
6. [Composer un bundle plus léger](#composer-un-bundle-plus-léger)
7. [Façades publiques (GeoLeaf.\*)](#façades-publiques-geoleaf)
8. [Couche shim — supprimée](#couche-shim--supprimée)
9. [Pattern Plugin Registry](#pattern-plugin-registry)
10. [Module de sécurité](#module-de-sécurité)
11. [État partagé](#état-partagé)
12. [Règle no-plugin-in-core](#règle-no-plugin-in-core)

---

## Vue d'ensemble

GeoLeaf-JS est une **bibliothèque TypeScript de cartographie interactive** construite sur **MapLibre GL JS ^6.0.0**. Elle est structurée en **monorepo** (npm workspaces + Turborepo) avec trois packages :

| Package                       | Licence | Registre           |
| ----------------------------- | ------- | ------------------ |
| `@geoleaf/core`               | MIT     | npmjs.org (public) |
| `@geoleaf-plugins/offline-ui` | MIT     | npmjs.org          |

Le package core expose :

- Un **bundle ESM CDN** (`geoleaf.esm.js`, assigne `window.GeoLeaf.*`) pour usage CDN/navigateur
- Un **bundle ESM** avec 27 exports nommés pour les bundlers (Vite, webpack, etc.)
- Des **sous-chemins `exports` stables** (`@geoleaf/core/kernel`, `@geoleaf/core/capabilities/<id>/install.js`, …) pour composer sa propre entrée et n'embarquer que les capacités voulues — le reste est **tree-shaké**. Voir `COOKBOOK.md`, _Recipe 8_

---

## Séquence de boot B1→B11

La séquence de boot est orchestrée par `src/globals/globals.ts`, qui importe les sous-modules de domaine dans un ordre strict. **Cet ordre est critique — ne jamais le modifier sans comprendre toutes les dépendances aval.**

```
bundle-esm-entry.ts
    │
    └── globals.ts  (orchestrateur — imports dans l'ordre)
            │
            ├── B1+B2  globals.core.ts
            │     ├── B1: Log, Errors, CONSTANTS, Security, CSRFToken
            │     └── B2: Utils (DOMSecurity, ErrorLogger,
            │               EventListenerManager, EventBus,
            │               FetchHelper, MapHelpers,
            │               PerformanceProfiler, TimerManager,
            │               ObjectUtils, ScaleUtils)
            │
            ├── B3+B4  globals.config.ts
            │     ├── B3: Helpers, Validators
            │     └── B4: Renderers, Data, Loaders, Map, Config
            │
            ├── B5     globals.geojson.ts
            │     └── B5: GeoJSON (INTERNE), Route
            │
            ├── B6+B7+B9  globals.ui.ts
            │     ├── B6: Labels
            │     ├── B7: Legend, LayerManager
            │     └── B9: Themes, UI, Controls, Filters
            │
            ├── B8     globals.storage.ts
            │     └── B8: Namespace Storage (peuplé par le plugin à runtime)
            │
            └── B11    globals.api.ts  ← DOIT ÊTRE EN DERNIER
                  └── B11: Toutes les façades publiques (Core, GeoLeafAPI, Table, UI,
                            Filters, Baselayers, Legend, LayerManager, Helpers,
                            Validators, Themes, Labels, Search, Permalink,
                            Events, Notifications, PWA) + PluginRegistry + BootInfo

        ⚠️ Il n'y a plus d'étape B10 : `globals.poi.ts` a disparu avec la dissolution du
        sous-système POI (S9). Une POI est une couche point GeoJSON générique, montée par
        `globals.geojson.ts` puis stylée et rendue par les capacités configurées sur la couche.


    app/app-namespace.ts  (helpers au boot)
    app/init.ts     (orchestrateur d'initialisation)
    app/boot.ts     (boot principal — s'exécute après globals)
```

### ModuleRegistry (Sprint 3+)

En complément des globals, `app/boot.ts` instancie un **ModuleRegistry** qui gère le cycle de vie des modules via un graphe de dépendances :

```
boot.ts
    │
    └── new ModuleRegistry()
            ├── register(new SecurityModule())
            ├── register(new CoreMapModule())
            ├── register(new ConfigModule())
            ├── register(new SharedModule())
            ├── register(new GeoJSONModule())
            ├── register(new UIModule())
                        ├── register(new APIModule())
            │
            │   [après loadConfig() — modules optionnels selon profil]
            ├── register(new RouteModule())       si route.enabled !== false
            ├── register(new LabelsModule())      si labels.enabled !== false
            ├── register(new LegendModule())      si modules.legend.enabled !== false
            └── register(new SearchModule())      si ui.showSearch !== false
```

Le tri topologique (algorithme de Kahn BFS) garantit l'ordre d'initialisation en respectant les dépendances déclarées dans chaque module via `ICoreModule.dependencies`.

### Règles critiques

- `globals.api.ts` (B11) **doit être en dernier** — il lit les façades enregistrées par B1–B10.
- `globals.core.ts` (B1+B2) **doit être en premier** — tous les modules dépendent de `Log` et `Errors`.
- `globals.storage.ts` (B8) configure le namespace `GeoLeaf.Storage` — le plugin le peuple à runtime.
- Ne **jamais** modifier l'ordre de chargement sans lire tous les fichiers consommateurs.

---

## Formats de bundle

### ESM CDN (`bundle-esm-entry.ts` → `geoleaf.esm.js`)

Produit `dist/geoleaf.esm.js` (bundle flat CDN). Assigne `window.GeoLeaf.*` au chargement via les side-effects de `globals.ts`.

**Usage (CDN/navigateur) :**

```html
<script
    type="module"
    src="https://cdn.jsdelivr.net/npm/@geoleaf/core@3.0.0/dist/geoleaf.esm.js"
></script>
<!-- window.GeoLeaf est maintenant disponible -->
```

### ESM (`bundle-esm-entry.ts`)

Produit `dist/geoleaf.esm.js` + ses chunks statiques. Exporte les symboles nommés importables par les consommateurs TypeScript/ESM (la surface kernel de `kernel-exports.ts`, plus les façades des capacités embarquées). Déclenche le même boot side-effect. Les chunks sont un découpage de **build** (`manualChunks`), tous atteints par des imports statiques : ce ne sont pas des chargements différés.

**Usage (bundler/npm) :**

```ts
import { Core, UI, LayerManager } from "@geoleaf/core";
```

---

## Adaptateur cartographique IMapAdapter

GeoLeaf V2 abstrait totalement le moteur cartographique derrière l'interface `IMapAdapter` (définie dans `src/contracts/map-adapter.contract.ts`). Aucun module métier ne doit importer directement depuis `maplibre-gl`.

### Types géographiques

| Type            | Définition                               | Usage                 |
| --------------- | ---------------------------------------- | --------------------- |
| `GeoLeafLatLng` | `{ lat, lng }` (WGS 84)                  | Coordonnée ponctuelle |
| `GeoLeafBounds` | `{ north, south, east, west }`           | Emprise géographique  |
| `GeoLeafPoint`  | `{ x, y }` (pixels, origine haut-gauche) | Projection écran      |

**Convention d'ordre :** GeoLeaf utilise `{ lat, lng }` ; MapLibre GL utilise `[lng, lat]` (ordre GeoJSON). La conversion est exclusivement dans l'adaptateur.

### Surface de l'interface IMapAdapter

```typescript
interface IMapAdapter {
    // Initialisation
    init(options: MapInitOptions): void;
    isReady(): boolean;
    destroy(): void;

    // Vue / Navigation
    setView(center: GeoLeafLatLng, zoom: number): void;
    getCenter(): GeoLeafLatLng;
    getZoom(): number;
    setZoom(zoom: number): void;
    panTo(center: GeoLeafLatLng): void;
    flyTo(center: GeoLeafLatLng, zoom?: number): void;
    fitBounds(bounds: GeoLeafBounds, options?: { padding?: GeoLeafPoint; animate?: boolean }): void;
    getBounds(): GeoLeafBounds;

    // Événements (set normalisé)
    on(event: MapEvent, handler: (e: unknown) => void): void;
    off(event: MapEvent, handler: (e: unknown) => void): void;
    once(event: MapEvent, handler: (e: unknown) => void): void;

    // Couches GeoJSON
    addGeoJSONLayer(id: string, data: unknown, options?: GeoLeafLayerOptions): void;
    removeLayer(id: string): void;
    hasLayer(id: string): boolean;
    showLayer(id: string): void;
    hideLayer(id: string): void;
    updateLayerData(id: string, data: unknown): void;
    setLayerStyle(id: string, style: GeoLeafStyleOptions): void;
    setLayerFilter(id: string, filter: unknown): void;

    // Marqueurs
    createMarker(id: string, position: GeoLeafLatLng, options?: GeoLeafMarkerOptions): void;
    removeMarker(id: string): void;
    updateMarkerPosition(id: string, position: GeoLeafLatLng): void;
    createClusterGroup(id: string, options?: Record<string, unknown>): void;

    // Popups (handles opaques)
    createPopup(content: string | HTMLElement, options?: GeoLeafPopupOptions): unknown;
    openPopup(popup: unknown, position?: GeoLeafLatLng): void;
    closePopup(popup?: unknown): void;

    // Contrôles
    addControl(control: unknown, position: GeoLeafControlPosition): GeoLeafControl;
    removeControl(control: GeoLeafControl): void;

    // Utilitaires
    latLngToPoint(latlng: GeoLeafLatLng): GeoLeafPoint;
    pointToLatLng(point: GeoLeafPoint): GeoLeafLatLng;
    getContainer(): HTMLElement;
}
```

L'implémentation concrète est `MaplibreAdapter` dans `src/adapters/maplibre/`.

---

## Modules built-in vs optional

### Modules built-in (toujours présents)

Chargés dans le bundle ESM (`geoleaf.esm.js`). Aucun import réseau supplémentaire nécessaire.

| Module (`window.GeoLeaf.*`) | Source (`src/`)                   | Description                                     |
| --------------------------- | --------------------------------- | ----------------------------------------------- |
| `Log`                       | `utils/log/`                      | Système de log interne                          |
| `Errors`                    | `utils/errors/`                   | 9 classes d'erreur typées                       |
| `CONSTANTS`                 | `utils/constants/`                | Constantes globales                             |
| `Security`                  | `security/`                       | Sanitisation XSS, CSRF, DOM                     |
| `Utils`                     | `utils/general/`                  | ~15 utilitaires (fetch, animation, lazy, perf…) |
| `Config`                    | `built-in/config/`                | Chargement profil, taxonomie, normalisation     |
| `Core`                      | `geoleaf.core.ts`                 | Création carte MapLibre, couches de base        |
| `Baselayers`                | `geoleaf.baselayers.ts`           | Fonds de plan raster et vecteur                 |
| `Filters`                   | `geoleaf.filters.ts`              | Système de filtres                              |
| `UI`                        | `geoleaf.ui.ts` + `ui/`           | Interface (notifications, filtres, contrôles)   |
| `Helpers`                   | `geoleaf.helpers.ts`              | Helpers publics                                 |
| `Validators`                | `geoleaf.validators.ts`           | Validation de données                           |
| `plugins`                   | `built-in/api/plugin-registry.ts` | `GeoLeaf.plugins.*` — PluginRegistry            |
| `bootInfo`                  | `built-in/api/boot-info.ts`       | Toast de démarrage                              |

### Capacités in-core

Une **capacité** est une fonctionnalité optionnelle du core, livrée dans le bundle et activée par
la config (`modules.<id>.enabled`). Elle n'est **pas** chargée à la demande : elle est là dès que
le bundle l'est. Les capacités vivent sous `src/capabilities/<id>/`, chacune derrière un unique
`install.ts` — leur nombre se compte plutôt que se recopier
(`ls -d packages/core/src/capabilities/*/ | wc -l`), un compteur en prose ayant déjà dérivé ici.

---

## Composer un bundle plus léger

> **BREAKING (v3, S5) — le système de lazy loading a été supprimé.** `GeoLeaf._loadModule()` et
> `GeoLeaf._loadAllSecondaryModules()` **n'existent plus**, et rien ne les remplace : supprimez
> l'appel. Ce qu'ils allaient chercher est déjà là.

Le lazy loading répondait au runtime à une question de **build**. Il ne tenait d'ailleurs plus sa
promesse : les derniers chunks qu'il servait étaient des coquilles de ré-export sur du code déjà
présent dans la clôture eager — Rollup les émettait **vides**, et le navigateur les téléchargeait
quand même à chaque boot.

Un drapeau de config peut **désactiver** une capacité ; il ne peut pas retirer son code du fichier
que le navigateur a téléchargé. Pour ça, il faut choisir **au build** :

```ts
// mon-entree.ts
import "@geoleaf/core/globals"; // peuple window.GeoLeaf.* — tire aussi la feuille du kernel
import "@geoleaf/core/helpers";
import { installBoot } from "@geoleaf/core/boot";
import { LEGEND_INSTALLER } from "@geoleaf/core/capabilities/legend/install.js";
import { CLUSTER_INSTALLER } from "@geoleaf/core/capabilities/cluster/install.js";

installBoot({ id: "mon-app", capabilities: [LEGEND_INSTALLER, CLUSTER_INSTALLER] });

export * from "@geoleaf/core/kernel";
export { Legend } from "@geoleaf/core/facades/legend.js";
```

> **BREAKING (v3, S6)** — ces sous-chemins sont **neufs**, et ceux que cette page affichait avant
> (`@geoleaf/core/src/…`) **n'ont jamais fonctionné** : `src/` n'est pas dans les `files` du paquet,
> donc jamais publié, et `exports` ne l'exposait pas. La recette était invérifiable côté
> consommateur — exactement ce que ce chantier existe pour rendre vrai.

Ce que vous n'avez pas listé est **tree-shaké** — pas différé, **absent**. Et depuis S6, **le CSS
suit le code** : chaque capacité importe sa feuille depuis son `install.ts`, donc le CSS est un
nœud du graphe de modules. Vous laissez `filter` de côté ⇒ ni son JS, ni le CSS de sa barre de
proximité. La cascade est figée par `@layer gl.reset, gl.tokens, gl.kernel, gl.capabilities,
gl.overrides` — elle ne dépend plus de l'ordre de concaténation, et `gl.overrides` vous est
réservée (une règle que vous y posez gagne sans `!important`).

**Comment on le sait.** Deux entrées sont construites et mesurées à **chaque build** :

| entrée                       | ce qu'elle prouve                                                                                                                                       | gate                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `examples/minimal/entry.ts`  | le **graphe source** tree-shake                                                                                                                         | `npm run size:example`  |
| `examples/consumer/entry.ts` | le **paquet publié** aussi — elle importe par les sous-chemins ci-dessus, donc par `exports` → `dist/esm/`, exactement comme le bundler du consommateur | `npm run size:consumer` |

Les deux lisent les **sourcemaps** de la clôture eager réelle (JS **et** CSS). La seconde existe
parce que la première ne voit pas au-delà du dépôt — et en S6 elle a attrapé le fait que
`import { Config } from "@geoleaf/core"` livrait un `Config` **sans `.get()`**.

---

## Façades publiques (GeoLeaf.\*)

L'API publique est exposée à travers **16+ fichiers façade** dans `src/api/`. Chaque façade ré-exporte depuis l'implémentation du module de domaine — **aucune logique métier dans les façades**.

### Namespace global (`window.GeoLeaf.*`)

Après le boot, `window.GeoLeaf` contient :

| Propriété                              | Type   | Description                                           |
| -------------------------------------- | ------ | ----------------------------------------------------- |
| `GeoLeaf.Core`                         | Object | Init carte, thèmes, cycle de vie                      |
| ~~`GeoLeaf.POI`~~                      | —      | ⛔ **N'existe plus** — sous-système dissous au S9     |
| `GeoLeaf.UI`                           | Object | Contrôles, panneaux, filtres UI                       |
| `GeoLeaf.Legend`                       | Object | Panneau légende                                       |
| `GeoLeaf.LayerManager`                 | Object | Gestion couches GeoJSON                               |
| `GeoLeaf.Baselayers`                   | Object | Fonds de plan (raster + vecteur MapLibre)             |
| `GeoLeaf.Helpers`                      | Object | Helpers utilitaires                                   |
| `GeoLeaf.Validators`                   | Object | Validateurs d'entrée                                  |
| `GeoLeaf.Labels`                       | Object | Système de labels                                     |
| `GeoLeaf.Notifications`                | Object | Système de notifications toast                        |
| `GeoLeaf.Permalink`                    | Object | Permalink URL                                         |
| `GeoLeaf.Events`                       | Object | Bus d'événements                                      |
| ~~`GeoLeaf.Search`~~                   | —      | ⛔ **N'existe plus** — moteur purgé avec `flexsearch` |
| `GeoLeaf.PWA`                          | Object | Progressive Web App (install prompt)                  |
| `GeoLeaf.Config`                       | Object | Accès à la configuration (get/set)                    |
| `GeoLeaf.Utils`                        | Object | 28 membres (même forme que l'export ESM `Utils`)      |
| `GeoLeaf.CONSTANTS`                    | Object | Constantes applicatives                               |
| `GeoLeaf.Log`                          | Object | Système de log                                        |
| `GeoLeaf.Errors`                       | Object | 9 classes d'erreur typées                             |
| `GeoLeaf.Security`                     | Object | Helpers XSS/CSRF                                      |
| `GeoLeaf.Storage`                      | Object | Namespace Storage (peuplé par le plugin à runtime)    |
| `GeoLeaf.plugins`                      | Object | Requête/enregistrement plugins (PluginRegistry)       |
| `GeoLeaf.registry`                     | Object | ModuleRegistry public (auto-enregistrement tiers)     |
| ~~`GeoLeaf._loadModule`~~              | —      | ⛔ **N'existe plus** — voir la note ci-dessous        |
| ~~`GeoLeaf._loadAllSecondaryModules`~~ | —      | ⛔ **N'existe plus** — voir la note ci-dessous        |
| `GeoLeaf._version`                     | string | Version courante (ex. `"3.0.0"`)                      |

> 🛑 **Les quatre lignes barrées ci-dessus ont été présentées comme existantes jusqu'au
> 09/08/2026**, dans un tableau qui est la première chose qu'un intégrateur lit — et ce document
> **part dans le tarball npm** (`docs/` est dans `files[]` de `@geoleaf/core`). Deux d'entre elles
> étaient déjà démenties **84 lignes plus haut dans ce même fichier** ; un lecteur qui s'arrêtait
> au tableau concluait faux, un lecteur qui lisait tout se demandait lequel des deux croire.
>
> **La preuve est mécanique, pas déclarative** : chaque ligne de ce tableau se croise avec
> `EXPECTED_FACADE_KEYS ∪ IMPORT_SURFACE` (`scripts/lib/namespace-surface.mjs`) moins
> `CATALOG_EXPECTED_ABSENT` (`kernel/api/module-catalog.ts`) — 92 clés de référence, 26 lignes
> lues, 4 fantômes. `module-catalog.ts` déclare l'absence de `POI` comme **définitive**, avec son
> motif ; c'est la source à citer, pas ce tableau.
>
> ⚠️ Elles sont **barrées et non supprimées** à dessein : un intégrateur qui a lu l'ancienne
> version cherchera ces noms, et une ligne absente ne lui dit rien. `getModule("POI")` rend
> d'ailleurs `null` — et non `undefined` — précisément pour que la question ait une réponse.

> **Note :** `GeoLeaf.GeoJSON` n'est **pas** une façade publique. Les couches GeoJSON sont gérées en interne et accessibles via `GeoLeaf.LayerManager` et les profils JSON. ⚠️ Sa déclaration TypeScript a porté un membre `addData` **qui n'a jamais existé au runtime**, retiré le 09/08/2026 — le remplaçant public est `Layers.setData`.

### Exports nommés ESM (27)

Depuis `bundle-esm-entry.ts` — liste **mesurée sur la source** (AST, 25/07/2026) :

```ts
// Façades kernel — via ./kernel-exports.js
export { Core, GeoLeafAPI, UI, LayerManager, Baselayers, Helpers, Validators, Events };
export { APIController, APIFactoryManager, APIInitializationManager, APIModuleManager };
export { PluginRegistry, BootInfo, showBootInfo };
export { Log, Errors, CONSTANTS, Utils, Config, applyCssText };
export { CapabilityRegistry };

// Façades de capacité — embarquées par cette entrée
export { Legend, Permalink, Share, Notifications, PWA };

export default GeoLeaf; // window.GeoLeaf (passthrough CDN/global)
```

⚠️ **Le bloc qui figurait ici était faux sur presque toute sa longueur**, et pas seulement
d'un export : il annonçait 31 exports, en citait 18 depuis un répertoire `./modules/`
**supprimé**, et 6 des symboles listés n'existent plus — `POI` et `Route` (sous-systèmes
dissous en v3), `Table` et `Themes` (extraits ou retirés), `Search` (moteur mort purgé avec
la dépendance `flexsearch`), `Filters` (supprimé à l'API publique S4.5). Il manquait à
l'inverse `CapabilityRegistry`, `applyCssText` et `Share`. Relevé au S4.5 en corrigeant la
seule ligne `Filters` ; les chemins réels sont `src/api/` et `src/capabilities/*/public-api.ts`.

---

## Couche shim — supprimée

Il n'y a plus de couche de compatibilité ascendante. Les onze répertoires ré-exporteurs de
premier niveau (`src/baselayers/`, `src/poi/`, `src/ui/`, `src/validators/`…) et le
`src/modules/` vers lequel ils redirigeaient **n'existent plus** : l'implémentation vit
directement sous `src/kernel/`, `src/capabilities/`, `src/api/` et `src/utils/`.

⚠️ Un import visant l'un de ces chemins ne résout pas — il n'est pas déprécié, il est **mort**.
L'arborescence à jour est générée : `docs/reference/ARBORESCENCE_QUALIFIEE.md`.

---

## Pattern Plugin Registry

GeoLeaf utilise un pattern d'enregistrement explicite pour maintenir une séparation stricte entre le core MIT et les plugins commerciaux.

### Enregistrement (côté plugin)

```ts
// Dans le point d'entrée du plugin (ex. storage/src/entry.ts)
import { PluginRegistry } from "@geoleaf/core";

PluginRegistry.register("storage", {
    version: "3.0.0",
    requires: ["core"],
    label: "GeoLeaf Storage",
});
```

### Requête (côté consommateur)

```js
GeoLeaf.plugins.isLoaded("storage"); // → true/false
GeoLeaf.plugins.getLoadedPlugins(); // → ["core", "storage"]
GeoLeaf.plugins.canActivate("addpoi"); // → true si dépendances OK
GeoLeaf.plugins.getAvailableModules(); // → tous les modules (chargés + lazy)
GeoLeaf.plugins.getInfo("storage"); // → { name, version, loaded, loadedAt, … }
await GeoLeaf.plugins.load("layerManager"); // → lazy load depuis le registre
```

### Règle no-plugin-in-core

`packages/core/src/` ne doit jamais importer `@geoleaf-plugins/*` — frontière d'**architecture**, pas de licence : le core reste autonome et tree-shakeable quelle que soit la licence des plugins. Vérification via `scripts/verify-core-standalone.cjs`, exécuté en CI (push et pull request), en pre-commit et dans `ci:local`.

---

## Module de sécurité

Toute injection DOM doit passer par `src/kernel/security/`. Ne jamais utiliser `innerHTML` directement dans le code applicatif.

⚠️ **`Security` n'a pas d'export ESM nommé** — vérifié le 30/07/2026 contre la carte `exports`
du paquet : ni l'entrée, ni `./kernel`, ni aucun sous-chemin ne l'expose. La façade est montée
sur le namespace global au boot ; c'est le seul accès.

```ts
// via le namespace global (CDN comme bundler, une fois le core initialisé) :
GeoLeaf.Security.sanitizeHTML(htmlString); // Sanitisation XSS — le membre est `sanitizeHTML`
GeoLeaf.Security.CSRFToken.get(); // Helper token CSRF
```

**Utilitaires clés :**

- `Security.sanitize()` — Sanitisation XSS (supprime le HTML dangereux)
- `DOMSecurity` — Helpers DOM sécurisés
- `CSRFToken` — Gestion du token CSRF
- `src/kernel/security/dom-security.ts` — Opérations DOM sécurisées (déplacé au STRUCT S6 : la surface XSS est réunie dans un seul dossier)

---

## État partagé

`src/kernel/shared/` contient les objets d'état et les seams cross-modules. Avant de modifier un fichier ici, identifier tous les consommateurs — les changements d'état partagé peuvent silencieusement casser plusieurs modules.

Fichiers clés :

- `geojson-state.ts` — Registre des couches GeoJSON chargées
- `layer-visibility-state.ts` — État de visibilité des couches
- `lifecycle.ts` — Seam IoC create → destroy → recreate
- `storage-contract.ts` — Frontière de découplage avec le plugin Storage
- `sync-handler-contract.ts` — Contrat du gestionnaire de synchronisation

> **v3 (KERNEL S14)** — le chemin était auparavant `src/modules/shared/`, un dossier ne
> contenant plus qu'un ré-export legacy ; il a été supprimé. `poi-state.ts`, encore
> listé ici jusqu'en v3, n'existait plus depuis la refonte POI.

---

## Règle no-plugin-in-core

`packages/core/src/` doit avoir **zéro référence** à `@geoleaf-plugins/*`.

**Vérification :**

```bash
node scripts/verify-core-standalone.cjs
```

Ce script s'exécute en CI (push et pull request), en pre-commit et dans `ci:local`. Il ne participe pas au build : il fait échouer la CI et le commit, pas la compilation. Les fonctionnalités des plugins sont injectées dans le namespace `GeoLeaf` à runtime, via le pattern Plugin Registry — c'est ce qui permet au core de les ignorer complètement.

---

**Dernière mise à jour :** mars 2026

**Version GeoLeaf :** 3.0.0 — Platform V3
