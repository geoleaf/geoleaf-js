---
title: "GeoLeaf.Utils — Documentation du module Utils"
---

# GeoLeaf.Utils — Documentation du module Utils

**Product Version** : GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier source** : `packages/core/src/utils/general/utils-namespace.ts`

**Dernière mise à jour** : mars 2026

---

## Vue d'ensemble

Le namespace `GeoLeaf.Utils` regroupe les fonctions utilitaires communes utilisées à travers tous les modules GeoLeaf. Il est assemblé dans `utils-namespace.ts` et expose :

- des fonctions de manipulation de données (deepMerge, resolveField, compareByOrder)
- des helpers HTTP (FetchHelper)
- des utilitaires DOM et sécurité (DOMSecurity)
- des helpers cartographiques (ensureMap, fireMapEvent, getDistance)
- des contrôleurs de flux (debounce, throttle)

L'objet est publié sur `window.GeoLeaf.Utils` (ou `globalThis.GeoLeaf.Utils`) après initialisation.

> **Depuis v3 (KERNEL S14)** — l'export ESM et le global portent la **même forme** :
> `import { Utils } from "@geoleaf/core"` et `window.GeoLeaf.Utils` exposent les mêmes
> membres. Ce sont deux objets distincts (le global doit rester ré-appliquable par le
> cycle de vie des modules), mais leur surface est verrouillée par un test.
>
> `performanceProfiler` est un accesseur **paresseux et non énumérable** : il est
> lisible via `GeoLeaf.Utils.performanceProfiler` mais n'apparaît pas dans
> `Object.keys()`.

---

## Structure des modules

```
packages/core/src/modules/utils/
├── general/
│   ├── utils-base.ts             // Core utility functions (the 12 base helpers)
│   ├── utils-namespace.ts        // Composition — the single GeoLeaf.Utils shape
│   ├── dom-helpers.ts            // DOM factory (domCreate / createElement)
│   ├── helpers-namespace.ts      // GeoLeaf.Helpers facade object
│   ├── object-utils.ts           // Nested-path get/has/set
│   ├── scale-utils.ts            // Map scale computation
│   └── fetch-helper.ts           // HTTP client with retry/timeout
├── geo/
│   └── wkt-parser.ts             // wktToGeoJSON — moved out at STRUCT S6
├── performance/                  // NEW at STRUCT S6
│   ├── performance-profiler.ts
│   ├── runtime-metrics.ts
│   ├── baseline-storage.ts
│   └── devtools-export.ts
├── constants/
│   └── index.ts                  // Frozen constants (CONSTANTS)
└── log/
    └── index.ts                  // Log module
```

---

## API publique

### `validateUrl(url, allowedProtocols?)`

Valide une URL via `GeoLeaf.Security`. Retourne la chaîne normalisée ou `null`.

```ts
const safe = GeoLeaf.Utils.validateUrl("https://example.com/data.json");
// => "https://example.com/data.json" | null
```

---

### `deepMerge(target, source)`

Fusion profonde de deux objets. Protège contre les attaques prototype pollution (`__proto__`, `constructor`, `prototype` ignorés).

```ts
const merged = GeoLeaf.Utils.deepMerge(defaults, overrides);
```

---

### `mergeOptions(defaults, override)`

Fusion superficielle (shallow) avec `Object.assign`. Préférer à `deepMerge` pour les options simples.

```ts
const opts = GeoLeaf.Utils.mergeOptions({ timeout: 5000, retries: 2 }, userOpts);
```

---

### `resolveField(obj, ...paths)`

Résout le premier champ non-vide parmi une liste de chemins pointés.

```ts
const title = GeoLeaf.Utils.resolveField(poi, "title", "label", "name");
// => parcourt obj.title → obj.label → obj.name → "" si aucun
```

Supporte la notation imbriquée : `"attributes.commune"`, `"properties.name"`.

---

### `compareByOrder(a, b, fallback?)`

Comparateur de tri pour les sections de layout. Trie par champ `order` (numérique).

```ts
const sorted = layout.sort(GeoLeaf.Utils.compareByOrder);
```

---

### `debounce(func, wait?, immediate?)`

Retarde l'exécution d'une fonction jusqu'à la fin des appels rapides.

```ts
const onInput = GeoLeaf.Utils.debounce((e) => handleSearch(e), 300);
```

---

### `throttle(func, limit?)`

Limite la fréquence d'exécution d'une fonction.

```ts
const onScroll = GeoLeaf.Utils.throttle(updateUI, 100);
```

---

### `getDistance(lat1, lng1, lat2, lng2)`

Calcule la distance haversine entre deux points géographiques. Retourne la distance en kilomètres.

```ts
const km = GeoLeaf.Utils.getDistance(48.85, 2.35, 43.29, 5.38);
```

---

### `ensureMap(explicitMap?)`

Résout l'instance carte MapLibre GL depuis `GeoLeaf.Core.getMap()` ou depuis un paramètre explicite.

```ts
const map = GeoLeaf.Utils.ensureMap(options.map);
if (map) {
    map.fitBounds(bounds);
}
```

**Retourne `null` si aucune carte n'est disponible** — et, depuis la v3, **également si
l'argument n'en est pas une**. La valeur est vérifiée par duck-typing sur
`getCenter` / `getBounds` / `on` / `off`, présents aussi bien sur un adaptateur GeoLeaf
que sur une `maplibregl.Map` brute. Le test `if (map)` de l'exemple ci-dessus reste donc
la bonne façon de l'appeler.

> Avant la v3, la fonction renvoyait **tel quel** tout argument non vide :
> `ensureMap("foo")` valait `"foo"`. La panne n'apparaissait qu'au premier appel de
> méthode, loin de la cause. Si vous vous appuyiez sur ce comportement pour faire
> transiter autre chose qu'une carte, passez-la directement.

---

### `fireMapEvent(map, eventName, payload?)`

Émet un événement sur l'instance carte MapLibre GL (via `map.fire()`).

```ts
GeoLeaf.Utils.fireMapEvent(map, "geoleaf:layer:loaded", { layerId: "poi" });
```

---

### `DOMSecurity`

Sous-module de sécurité DOM. Expose notamment :

- `DOMSecurity.clearElementFast(el)` — vide un élément sans `innerHTML`
- `DOMSecurity.setSafeHTML(el, html)` — injection HTML sanitisée

```ts
GeoLeaf.Utils.DOMSecurity.clearElementFast(container);
```

---

### `FetchHelper`

Client HTTP unifié avec retry, timeout et parsing automatique. Voir `fetch-helper.ts`.

```ts
const data = await GeoLeaf.Utils.FetchHelper.fetch("/api/data.json", {
    timeout: 10000,
    retries: 2,
});
```

---

### `escapeHtml(str)` — **n'existe pas** (documentation corrigée en v3, KERNEL S14)

> ⚠️ `GeoLeaf.Utils.escapeHtml()` a été documentée ici pendant plusieurs versions alors
> qu'elle **n'a jamais été posée sur le namespace au runtime** : elle n'existait que sur
> l'objet assemblé par `utils-api.ts`, dont l'unique point d'entrée avait disparu avec
> les builds UMD en v2.0.0. Un appel levait donc un `TypeError`.
>
> **Utiliser `GeoLeaf.Security.escapeHtml()`**, qui est monté, testé et documenté.

---

### `wktToGeoJSON(wkt)`

Convertit une géométrie WKT en géométrie GeoJSON.

```ts
const geom = GeoLeaf.Utils.wktToGeoJSON("POINT(2.35 48.85)");
// → { type: "Point", coordinates: [2.35, 48.85] }
```

> Annoncée au CHANGELOG dès v2 mais absente du runtime pour la même raison
> qu'`escapeHtml` ci-dessus — **réellement disponible depuis v3 (KERNEL S14)**.

---

## Exemple complet

```ts
import { Utils } from "@geoleaf/core";

// Resolve the first non-empty field in a POI
const name = Utils.resolveField(poi, "title", "label", "name");

// Merge options with defaults
const opts = Utils.mergeOptions({ zoom: 10, padding: 20 }, userOptions);

// Debounce a search handler
// ⚠️ Cet exemple appelait `GeoLeaf.Search.query(...)` — le moteur full-text (`flexsearch`)
// a été RETIRÉ du core au S6, et le CHANGELOG de ce paquet l'acte lui-même. Corrigé le
// 27/07/2026 : le filtrage se fait par la capacité `filter`.
const onSearch = Utils.debounce((query: string) => {
    GeoLeaf.Filter?.applyFilter({ text: query });
}, 250);

// Compute distance between two coordinates
const distKm = Utils.getDistance(48.85, 2.35, 45.76, 4.83);
```

---

## Modules liés

- `packages/core/src/modules/utils/constants/index.ts` — constantes globales (`CONSTANTS`)
- `packages/core/src/modules/utils/renderers/abstract-renderer.ts` — classe de base pour les renderers
- `packages/core/src/modules/built-in/security/` — sanitisation XSS, validation URL
- `packages/core/src/modules/built-in/config/` — accès à la configuration active

---

**Version** : 3.0.0

**Dernière mise à jour** : mars 2026
