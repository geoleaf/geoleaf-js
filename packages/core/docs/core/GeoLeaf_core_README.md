---
title: "GeoLeaf.Core — Documentation du module Core"
---

# GeoLeaf.Core — Documentation du module Core

**Version** : 3.0.0
**Plateforme** : GeoLeaf Platform V3 (MapLibre GL JS ^6.0.0)
**Fichier (monorepo)** : `packages/core/src/modules/built-in/map/`
**Derniere mise a jour** : Mars 2026

---

Le module **GeoLeaf.Core** constitue le noyau de la librairie **GeoLeaf**.

Il gere :

- l'initialisation de la carte **MapLibre GL JS** ;
- la conservation d'une instance unique de carte via `IMapAdapter` (abstraction moteur) ;
- la gestion et la synchronisation du **theme UI** (clair / sombre) avec les autres modules.

Les autres modules (Baselayers, UI, POI, GeoJSON, Route, Legend, Config, etc.) s'appuient **tous** sur la carte creee par `GeoLeaf.Core`.

> Note sur l'architecture : GeoLeaf.Core n'expose jamais directement `maplibregl.Map`. Il retourne un `IMapAdapter` (interface `MaplibreAdapter`) qui abstrait toutes les operations cartographiques. Cela garantit l'independance vis-a-vis du moteur de rendu.

---

## 1. Role fonctionnel du Core

GeoLeaf.Core a trois responsabilites principales :

1. Creer et initialiser une carte MapLibre GL JS dans un conteneur DOM via `MaplibreAdapter`.
2. Exposer l'instance de carte aux autres modules via `GeoLeaf.Core.getMap()` (retourne un `IMapAdapter`).
3. Centraliser le **theme UI courant** (`"light"` / `"dark"`) et offrir une API simple pour le lire et le modifier.

> Important : GeoLeaf.Core ne gere **pas** :
>
> - les couches de fond (basemaps) ;
> - les POI / GeoJSON / itineraires ;
> - les controles UI avances.
>
> Ces responsabilites sont confiees aux autres modules GeoLeaf.

---

## 2. API publique de GeoLeaf.Core

L'objet `Core` exporte les methodes suivantes :

| Methode                | Role                                        |
| ---------------------- | ------------------------------------------- |
| `Core.init(options)`   | Initialise la carte MapLibre GL JS          |
| `Core.getMap()`        | Retourne l'instance `IMapAdapter` active    |
| `Core.getAdapter()`    | Alias de `getMap()` (usage interne modules) |
| `Core.setTheme(theme)` | Change le theme UI apres initialisation     |
| `Core.getTheme()`      | Retourne le theme UI courant                |

---

### 2.1 `GeoLeaf.Core.init(options)`

Fonction principale d'initialisation.
Resout le conteneur DOM, cree un `MaplibreAdapter`, applique le theme UI et initialise la legende.

```js
const adapter = GeoLeaf.Core.init(options);
```

**Parametres :**

- `options.mapId` — **obligatoire** — `id` de l'element DOM conteneur de la carte.
- `options.center` — initial center sous forme de tableau `[lat, lng]`.
- `options.zoom` — niveau de zoom initial.
- `options.theme` — theme UI (`"light"` par defaut).
- `options.mapOptions` — options supplementaires du moteur (voir §3.5).

**Retour :**

- L'instance `IMapAdapter` si l'initialisation reussit.
- `null` en cas d'erreur (conteneur introuvable, exception du moteur, etc.).

> En mode boot automatique (`GeoLeaf.boot()`), `Core.init()` est appele internement par `app/init.ts` via `GeoLeaf.init()`. Il n'est pas necessaire de l'appeler manuellement.

#### Exemple direct (mode standalone)

```js
// Direct usage — bypasses the boot system
const adapter = GeoLeaf.Core.init({
    mapId: "geoleaf-map",
    center: [45.76, 4.84], // Lyon, FR — [lat, lng]
    zoom: 13,
    theme: "light",
});

if (!adapter) {
    console.error("[App] Map initialization failed — check mapId and DOM.");
}
```

---

### 2.2 `GeoLeaf.Core.getMap()`

Retourne l'instance `IMapAdapter` deja initialisee, ou `null` si aucune carte n'existe.

```js
const adapter = GeoLeaf.Core.getMap();

if (adapter) {
    // Navigate to a new position
    adapter.setView({ lat: 48.85, lng: 2.35 }, 14); // Paris
    console.log("Current zoom:", adapter.getZoom());
}
```

**Usage recommande :**

- dans les autres modules GeoLeaf (POI, GeoJSON, Route, Legend, etc.) ;
- dans du code externe qui souhaite manipuler la carte sans la reinitialiser.

---

### 2.3 `GeoLeaf.Core.getAdapter()`

Alias strict de `getMap()`. Utilise en interne par les modules POI, Route et GeoJSON pour indiquer explicitement qu'ils consomment l'adaptateur.

```js
const adapter = GeoLeaf.Core.getAdapter();
```

---

### 2.4 `GeoLeaf.Core.setTheme(theme)`

Permet de changer le theme UI apres l'initialisation.

```js
GeoLeaf.Core.setTheme("dark");
```

**Parametre :**

- `theme` : `"light"` ou `"dark"`.

**Comportement :**

- Si `GeoLeaf.UI` est present, delegue au moteur de theme canonique : classes CSS
  `gl-theme-light` / `gl-theme-dark` sur `document.body` **et** sur le conteneur
  `#geoleaf-map` (support plein ecran), persistance dans `localStorage`
  (`geoleaf_theme`), synchronisation de l'etat `aria-pressed` du bouton de theme,
  et emission de l'evenement `geoleaf:ui-theme-changed`.
- Sinon (UI non chargee), applique les classes `gl-theme-*` sur `document.body`.

En cas de valeur invalide :

- GeoLeaf.Core logue un avertissement : `[GeoLeaf.Core] setTheme() ignored an invalid theme: {valeur}`.
- Le theme courant n'est pas modifie.

`GeoLeaf.Core.setTheme()`, `GeoLeaf.setTheme()` et `GeoLeaf.UI.applyTheme()`
aboutissent donc au meme moteur : ils sont interchangeables.

---

### 2.5 `GeoLeaf.Core.getTheme()`

Retourne le theme UI courant.

```js
const currentTheme = GeoLeaf.Core.getTheme(); // "light" | "dark"
```

Lit a travers le moteur de theme canonique quand `GeoLeaf.UI` est present : la
valeur reflete donc aussi les changements faits par le bouton de theme, par
`GeoLeaf.setTheme()` ou par la sequence de boot. Sans `GeoLeaf.UI`, la valeur est
deduite de la classe presente sur `document.body` (defaut `"light"`).

**Usage typique :** synchroniser un composant externe avec l'etat visuel de GeoLeaf.

---

## 3. Detail des options Core

### 3.1 `mapId` (obligatoire)

- **Type** : `string`
- **Obligatoire** : **oui**
- **Description** : identifiant (`id`) de l'element DOM dans lequel la carte doit etre creee.

Exemple HTML :

```html
<div id="geoleaf-map"></div>
```

**Validations :**

- `mapId` doit etre une chaine non vide.
- Un element DOM avec cet `id` doit exister au moment de l'appel.

En cas de probleme (`mapId` manquant ou DOM introuvable) :

- `Core.init()` leve une exception interceptee internement.
- Logue une erreur : `[GeoLeaf.Core] ERROR: The required 'mapId' option is missing.`
- Retourne `null`.

---

### 3.2 `center` (recommande)

- **Type** : `[number, number]` — tableau `[latitude, longitude]`
- **Convention** : latitude en premier (ordre GeoLeaf), longitude en second.
- **Description** : centre initial de la carte.

Exemple :

```js
center: [45.76, 4.84]; // Lyon, FR
```

En pratique, lors du boot automatique, le centre est calcule depuis les bornes `map.bounds` du profil actif. Il n'est pas necessaire de le specifier manuellement dans ce mode.

---

### 3.3 `zoom` (recommande)

- **Type** : `number`
- **Valeur par defaut** : `CONSTANTS.DEFAULT_ZOOM` (defini dans `modules/utils/constants/`)
- **Description** : niveau de zoom initial de la carte.

**Intervalles recommandes :**

- plage pratique : `2` a `18` pour la plupart des fonds de carte ;
- certains fonds montent a `19` ou `20` selon le fournisseur.

---

### 3.4 `theme` (optionnel)

- **Type** : `"light"` | `"dark"`
- **Valeur par defaut** : `"light"`
- **Description** : theme UI courant. S'applique a l'interface (header, boutons, panneaux, legende) et **jamais** aux tuiles.

```js
theme: "dark";
```

**Comportement :**

- Si `theme` vaut `"light"` ou `"dark"` : enregistre et applique le theme.
- Si `theme` est absent : utilise `"light"` par defaut.
- Si `theme` a une valeur inconnue : logue un avertissement, ne modifie pas le theme courant.

> Rappel : le choix des tuiles (Street / Topo / Satellite) est gere par `GeoLeaf.Baselayers` et ne depend pas du theme UI.

---

### 3.5 `mapOptions` (optionnel)

Options supplementaires transmises au moteur MapLibre GL JS via l'adaptateur.

| Cle         | Type            | Description                                  |
| ----------- | --------------- | -------------------------------------------- |
| `minZoom`   | `number`        | Zoom minimum autorise                        |
| `maxZoom`   | `number`        | Zoom maximum autorise                        |
| `maxBounds` | `GeoLeafBounds` | Restreint le panning a une zone geographique |

`GeoLeafBounds` est un objet `{ north, south, east, west }` (tous en degres decimaux).

Exemple avec contrainte de position :

```js
GeoLeaf.Core.init({
    mapId: "geoleaf-map",
    center: [45.76, 4.84],
    zoom: 12,
    mapOptions: {
        minZoom: 8,
        maxZoom: 18,
        maxBounds: { north: 46.5, south: 45.0, east: 5.5, west: 4.0 },
    },
});
```

---

## 4. L'interface IMapAdapter

`GeoLeaf.Core.getMap()` retourne un objet `IMapAdapter`, pas une instance `maplibregl.Map` directe. Cette abstraction isole les modules du moteur de rendu.

### 4.1 Navigation et vue

```js
const adapter = GeoLeaf.Core.getMap();

// Set view (center + zoom)
adapter.setView({ lat: 48.85, lng: 2.35 }, 14);

// Animate to position
adapter.flyTo({ lat: 45.76, lng: 4.84 }, 13);

// Pan without zoom change
adapter.panTo({ lat: 43.3, lng: 5.37 });

// Fit bounds
adapter.fitBounds(
    { north: 46.5, south: 45.0, east: 5.5, west: 4.0 },
    { padding: { x: 50, y: 50 }, animate: false }
);

// Read state
const center = adapter.getCenter(); // { lat, lng }
const zoom = adapter.getZoom(); // number
const bounds = adapter.getBounds(); // { north, south, east, west }
```

### 4.2 Evenements

```js
const adapter = GeoLeaf.Core.getMap();

const onMoveEnd = (e) => {
    console.log("Map moved, new center:", adapter.getCenter());
};

adapter.on("moveend", onMoveEnd);
adapter.once("load", () => console.log("Map loaded"));
adapter.off("moveend", onMoveEnd);
```

Evenements disponibles via `IMapAdapter` :
`"click"`, `"dblclick"`, `"contextmenu"`, `"moveend"`, `"movestart"`, `"zoomend"`, `"zoomstart"`, `"load"`, `"unload"`, `"resize"`.

### 4.3 Coordonnees — convention d'ordre

GeoLeaf utilise toujours `{ lat, lng }` (latitude en premier).
MapLibre GL JS utilise `[lng, lat]` (ordre GeoJSON, longitude en premier).
La conversion est geree internement par `MaplibreAdapter` — les consommateurs n'ont jamais a s'en preoccuper.

```js
// GeoLeaf convention throughout the public API
const center: GeoLeafLatLng = { lat: 45.764, lng: 4.835 };
```

---

## 5. Boot System v2

### 5.1 Vue d'ensemble

Depuis la v2.0.0, l'initialisation de GeoLeaf est entierement orchestree par le **boot system** situe dans `packages/core/src/app/`. Ce systeme gere le chargement sequentiel via un `ModuleRegistry` a tri topologique.

**Fichiers du boot system :**

| Fichier                      | Role                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| `src/app/app-namespace.ts`   | Logging, detection de chemin, verification plugins, helpers notification    |
| `src/app/boot.ts`            | Expose `GeoLeaf.boot()`, charge la config, enregistre les modules           |
| `src/app/init.ts`            | Orchestre la creation de la carte, UI, POI, Route, GeoJSON, legende         |
| `src/app/module-registry.ts` | `ModuleRegistry` — gestion du cycle de vie des modules avec tri topologique |
| `src/app/init-features.ts`   | Initialisation granulaire des modules secondaires                           |

### 5.2 Flux de demarrage complet

```
1. Chargement du bundle
   <script type="module" src="geoleaf.esm.js">  → Bundle ESM (CDN ou bundler)
   <script type="module" src="geoleaf-offline-ui.plugin.js"> → Plugin optionnel (avant GeoLeaf.boot())
   <script type="module" src="geoleaf-offline-ui.plugin.js">  → Plugin optionnel (avant GeoLeaf.boot())

2. Appel GeoLeaf.boot()
   └─ Verifie document.readyState
   └─ Appelle _app.startApp()

3. _app.startApp()
   └─ Enregistre les modules dans ModuleRegistry (B1 → B8 core)
   └─ Charge geoleaf.config.json via GeoLeaf.loadConfig()
   └─ Enregistre les modules optionnels selon le profil (Route, Labels, Legend, Table, Search)
   └─ Charge les ressources du profil actif
   └─ Execute ModuleRegistry.init() (ordre topologique) — voir 4.

4. ModuleRegistry.init(cfg) — CoreMapModule → SharedModule → UIModule (parmi les autres)
   └─ CoreMapModule : lit les bornes du profil (map.bounds obligatoire), appelle
      GeoLeaf.init() → GeoLeaf.Core.init() → MaplibreAdapter
   └─ SharedModule : i18n, plugin check, lifecycles app-globales (pwa, offline)
   └─ UIModule : lance le preload des modules secondaires (code splitting ESM),
      initialise UI, Storage, POI, Route, GeoJSON, Legend, LayerManager
   └─ Revele l'application apres evenement geoleaf:theme:applied
   └─ Emet geoleaf:map:ready puis geoleaf:app:ready
```

### 5.3 `GeoLeaf.boot()`

Point d'entree unique recommande pour demarrer GeoLeaf.

```js
// Minimal usage — auto DOMContentLoaded guard
GeoLeaf.boot();

// With performance metrics callback
GeoLeaf.boot({
    onPerformanceMetrics: (metrics) => {
        console.log("Time to map ready:", metrics.timeToMapReadyMs, "ms");
        console.log("Time to app ready:", metrics.timeToAppReadyMs, "ms");
        console.log("Total startup:", metrics.startupTotalMs, "ms");
    },
});
```

`GeoLeaf.boot()` gere automatiquement `DOMContentLoaded` : l'appeler avant ou apres que le DOM soit pret est sans consequence.

**Signature complete :**

```ts
GeoLeaf.boot(options?: {
    onPerformanceMetrics?: (metrics: {
        timeToMapReadyMs: number | null;
        timeToAppReadyMs: number | null;
        startupTotalMs: number | null;
        capturedAt: string;
    }) => void;
}): void
```

### 5.4 Evenements du cycle de vie

Le boot system emet les evenements suivants sur `document` :

| Evenement                | Moment d'emission                                      | Payload `detail`            |
| ------------------------ | ------------------------------------------------------ | --------------------------- |
| `geoleaf:theme:applying` | Debut du chargement d'un theme (couches en cours)      | —                           |
| `geoleaf:theme:applied`  | Fin du chargement d'un theme (toutes couches visibles) | `{ themeName, layerCount }` |
| `geoleaf:profile:loaded` | Profil JSON charge et parse                            | `{ profileId, data }`       |
| `geoleaf:map:ready`      | Carte visible, loader retire, fitBounds effectue       | —                           |
| `geoleaf:app:ready`      | Application completement initialisee                   | `{ version, timestamp }`    |
| `geoleaf:map:move`       | Fin d'un deplacement de carte                          | `{ center, zoom }`          |
| `geoleaf:map:zoom`       | Fin d'un changement de zoom                            | `{ zoom }`                  |

```js
// Listen for app ready
document.addEventListener("geoleaf:app:ready", (event) => {
    console.log("GeoLeaf v" + event.detail.version + " is ready.");
    const adapter = GeoLeaf.Core.getMap();
    // Use the adapter here...
});

// Listen for theme loaded
document.addEventListener("geoleaf:theme:applied", (event) => {
    console.log(event.detail.themeName + " loaded — layers:", event.detail.layerCount);
});
```

### 5.5 ModuleRegistry et sequence d'initialisation

Le `ModuleRegistry` orchestre l'initialisation des modules en resolvant leurs dependances par tri topologique (algorithme de Kahn).

**Modules core enregistres par defaut :**

| ID module  | Classe           | Role                                   |
| ---------- | ---------------- | -------------------------------------- |
| `security` | `SecurityModule` | Sanitisation XSS/CSRF, securite DOM    |
| `core-map` | `CoreMapModule`  | Creation de la carte MapLibre GL JS    |
| `config`   | `ConfigModule`   | Chargement et gestion des profils JSON |
| `shared`   | `SharedModule`   | Etat partage inter-modules             |
| `geojson`  | `GeoJSONModule`  | Couches GeoJSON et styles              |
| `ui`       | `UIModule`       | Interface, controles, filtres          |
| `poi`      | `POIModule`      | Markers, popups, sidepanel POI         |
| `api`      | `APIModule`      | API publique et factory manager        |

**Modules optionnels (enregistres selon le profil) :**

| Condition profil                   | Module enregistre |
| ---------------------------------- | ----------------- |
| `route.enabled !== false`          | `RouteModule`     |
| `labels.enabled !== false`         | `LabelsModule`    |
| `modules.legend.enabled !== false` | `LegendModule`    |

> ℹ️ Le moteur de recherche full-text (`flexsearch`) a été retiré du core en S6 (dormant, 0 consommateur). `SearchModule` n'est plus enregistré et le drapeau `ui.showSearch` a disparu ; la recherche textuelle de l'UI est assurée par la capacité in-core `filter` (champ texte du panneau Filtrer, désormais insensible aux accents et à l'ordre des mots).

> ℹ️ Le tableau de données a été extrait du core vers le plugin MIT `@geoleaf-plugins/table`. `TableModule` n'est plus enregistré par le core ; le drapeau `ui.showTable` a migré vers `modules.table.showButton`. Voir le README du plugin pour la configuration (`modules.table.*`) et la migration.

> ℹ️ La légende est une capacité in-core unifiée sous `modules.legend` (S10/F2). `LegendModule` reste enregistré, mais via le `CapabilityRegistry` (gate `modules.legend.enabled`, opt-out) ; le drapeau `ui.showLegend` et le bloc `legendConfig` ont migré vers `modules.legend.enabled` / `modules.legend.{title,position,collapsedByDefault}` (fichier `config/plugins/legend.json`). Voir le [README Legend](../legend/GeoLeaf_Legend_README.md).

**Enregistrement de module tiers :**

```js
// Third-party module self-registration (public API)
GeoLeaf.registry.register(new MyCustomModule());
```

### 5.6 Guard system (`checkPlugins`)

Au demarrage, `helpers.ts` verifie la coherence des plugins avec la configuration du profil :

- Logue un avertissement si `ui.showAddPoi=true` sans le plugin AddPOI charge.
- Logue un avertissement si `storage` est defini sans le plugin Storage charge.
- Logue un avertissement si `SyncHandler` est charge sans le plugin Storage.

Ces avertissements sont consultatifs — l'application demarre quand meme en mode degrade.

---

## 6. Integration avec la configuration JSON

### 6.1 Profil JSON minimal (geoleaf.config.json)

```json
{
    "map": {
        "target": "geoleaf-map",
        "bounds": [
            [45.5, 4.5],
            [46.0, 5.2]
        ],
        "initialMaxZoom": 13,
        "padding": [50, 50],
        "positionFixed": false
    },
    "ui": {
        "theme": "light",
        "showLegend": true,
        "showLayerManager": true,
        "showFilterPanel": true,
        "showCoordinates": true
    }
}
```

> **Important** : `map.bounds` est **obligatoire** depuis la v2.0.0. Si absent, l'application refuse de demarrer et logue une erreur explicite. Il n'y a pas de carte monde par defaut.

### 6.2 Correspondance champs JSON -> options Core

| Champ JSON                      | Option Core equivalente                  | Obligatoire |
| ------------------------------- | ---------------------------------------- | ----------- |
| `map.target` / `map.id`         | `options.mapId`                          | oui         |
| `map.bounds`                    | calcul du centre + fitBounds             | **oui**     |
| `map.initialMaxZoom`            | `options.zoom`                           | recommande  |
| `map.minZoom`                   | `options.mapOptions.minZoom`             | non         |
| `map.maxZoom`                   | `options.mapOptions.maxZoom`             | non         |
| `map.boundsMargin` (defaut 0.3) | padding `maxBounds`                      | non         |
| `map.positionFixed`             | `options.mapOptions.maxBounds` (calcule) | non         |
| `ui.theme`                      | `options.theme`                          | non         |

### 6.3 Chargement du profil actif

En mode multi-profil, GeoLeaf lit `sessionStorage.getItem("gl-selected-profile")` au demarrage pour charger le bon profil. Uniquement les identifiants alphanumeriques (`/^[a-zA-Z0-9_-]{1,50}$/`) sont acceptes.

```js
// Select a profile before boot
sessionStorage.setItem("gl-selected-profile", "mon-profil");
GeoLeaf.boot();
```

---

## 7. Gestion des erreurs et comportements de fallback

GeoLeaf.Core privilegia un comportement explicite (logs clairs) plutot qu'un echec silencieux.

### 7.1 Resume des cas principaux

| Situation                          | Log emis                                                               | Retour             |
| ---------------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `mapId` manquant                   | `[GeoLeaf.Core] ERROR: The required 'mapId' option is missing.`        | `null`             |
| DOM introuvable pour `mapId`       | `[GeoLeaf.Core] ERROR: No DOM element found for mapId='...'`           | `null`             |
| `map.bounds` absent dans le profil | `[GeoLeaf] Active profile does not define valid map.bounds`            | —                  |
| `theme` valeur inconnue            | `[GeoLeaf.Core] setTheme() → {valeur}`                                 | theme inchange     |
| `Core.init()` deja appele          | `[GeoLeaf.Core] Map already initialized. Recycling existing instance.` | instance existante |
| Exception moteur MapLibre          | `[GeoLeaf.Core] ERROR: {message}`                                      | `null`             |

### 7.2 Callback d'erreur optionnel

```js
// Register an error callback before boot
window.GeoLeaf = window.GeoLeaf || {};
window.GeoLeaf.Core = window.GeoLeaf.Core || {};
window.GeoLeaf.Core.onError = function (err) {
    // Custom error handling (analytics, UI error banner, etc.)
    console.error("[App] Core error:", err.message);
};

GeoLeaf.boot();
```

### 7.3 Bonne pratique post-init

```js
document.addEventListener("geoleaf:app:ready", () => {
    const adapter = GeoLeaf.Core.getMap();

    if (!adapter) {
        console.error("[App] Map not initialized — check configuration and DOM.");
        return;
    }

    // Adapter is ready — safe to use
    console.log("Map ready, zoom:", adapter.getZoom());
});
```

---

## 8. Resume rapide des options Core.init()

| Option                 | Type                  | Obligatoire | Valeur par defaut        | Role                            |
| ---------------------- | --------------------- | ----------- | ------------------------ | ------------------------------- |
| `mapId`                | `string`              | oui         | —                        | ID du conteneur DOM de la carte |
| `center`               | `[number, number]`    | recommande  | calcule depuis `bounds`  | Centre initial `[lat, lng]`     |
| `zoom`                 | `number`              | recommande  | `CONSTANTS.DEFAULT_ZOOM` | Zoom initial                    |
| `theme`                | `"light"` \| `"dark"` | non         | `"light"`                | Theme UI (interface uniquement) |
| `mapOptions.minZoom`   | `number`              | non         | —                        | Zoom minimum autorise           |
| `mapOptions.maxZoom`   | `number`              | non         | —                        | Zoom maximum autorise           |
| `mapOptions.maxBounds` | `GeoLeafBounds`       | non         | —                        | Restreint le panning a une zone |

---

## 9. Bonnes pratiques d'utilisation

1. **Toujours utiliser `GeoLeaf.boot()`** en mode production :
    - c'est le seul point d'entree qui charge la configuration, orchestre les modules et emet `geoleaf:app:ready`.
    - l'appel direct a `GeoLeaf.Core.init()` est reserve aux tests et a l'integration avancee.

2. **Ecouter `geoleaf:app:ready`** plutot que `DOMContentLoaded` pour agir sur la carte :
    - a ce moment, tous les modules sont initialises et la carte est visible.

3. **Utiliser `GeoLeaf.Core.getMap()`** pour recuperer l'adaptateur dans le code applicatif :
    - ne jamais stocker une reference directe a `maplibregl.Map` — l'abstraction `IMapAdapter` garantit la portabilite.

4. **Charger les plugins avant `GeoLeaf.boot()`** :
    - `geoleaf-offline-ui.plugin.js` enrichit le namespace `GeoLeaf.*` avant le demarrage ; les plugins paresseux (`editor`, `table`, `print`, `measure`) le font a leur premier usage.

5. **Centraliser la configuration dans `geoleaf.config.json`** :
    - toutes les options (map, ui, poi, storage, route) dans un seul fichier de profil.
    - evite les divergences entre modules et deploiements.

6. **Surveiller les logs `[GeoLeaf.Core]` en developpement** :
    - activez les logs detailles avec `?debug=true` dans l'URL.
    - ils indiquent precisement quelle option est manquante ou invalide.

7. **Securite popups** : le contenu HTML passe a `adapter.createPopup()` doit etre sanitise par l'appelant via `GeoLeaf.Security.sanitize()` avant passage. L'adaptateur ne sanitise pas le contenu.

---

## 10. Voir aussi

- **Architecture generale** : `docs/ARCHITECTURE_GUIDE.md`
- **Guide developpeur** : `docs/DEVELOPER_GUIDE.md`
- **Flux d'initialisation** : `docs/architecture/INITIALIZATION_FLOW.md`
- **Contrat IMapAdapter** : `packages/core/src/contracts/map-adapter.contract.ts`
- **MaplibreAdapter** : `packages/core/src/adapters/maplibre/maplibre-adapter.ts`
- **ModuleRegistry** : `packages/core/src/app/module-registry.ts`
- **Plugins** : chaque `@geoleaf-plugins/*` embarque sa documentation dans son package npm
