---
title: "GeoLeaf.Helpers — Documentation du module Helpers"
---

# GeoLeaf.Helpers — Documentation du module Helpers

**Product Version** : GeoLeaf Platform V3

**Version** : 3.0.0

**Fichier** : `src/modules/geoleaf.helpers.ts` → `src/modules/utils/helpers/dom-helpers.ts`

**Dernière mise à jour** : Mars 2026

---

## Vue d'ensemble

Le module **GeoLeaf.Helpers** fournit des utilitaires de manipulation DOM, de performance et de gestion des événements pour améliorer les performances et la maintenabilité de GeoLeaf.

### Catégories d'utilitaires

- **DOM Helpers** — manipulation sécurisée du DOM
- **Performance** — debounce, throttle, lazy loading
- **Events** — gestion d'événements avec cleanup
- **Utilities** — deep clone, retry, wait

> **Note** : `GeoLeaf.Helpers` expose uniquement les utilitaires DOM et les résolveurs de style. Les utilitaires généraux (debounce, throttle, deepMerge, getDistance…) se trouvent dans `GeoLeaf.Utils`.

---

## DOM Helpers

### `getElementById(id)`

Récupère un élément par ID de manière sécurisée.

```js
const element = GeoLeaf.Helpers.getElementById("my-map");
// Returns: HTMLElement | null
```

---

### `querySelector(selector, parent?)`

Query selector sécurisé avec gestion d'erreurs.

```js
const element = GeoLeaf.Helpers.querySelector(".gl-map-container");
const child = GeoLeaf.Helpers.querySelector(".item", parentElement);
// Returns: Element | null
```

---

### `querySelectorAll(selector, parent?)`

Query all avec conversion automatique en `Array`.

```js
const elements = GeoLeaf.Helpers.querySelectorAll(".poi-marker");
// Returns: Element[] (toujours un array, jamais null)
```

---

### `createElement(tag, options)` — **retirée (v3, KERNEL S10)**

> ⚠️ **Cette méthode n'existe plus.** `GeoLeaf.Helpers.createElement()` a été retirée :
> elle n'avait aucun appelant, et sa forme d'options divergeait silencieusement de la
> fabrique canonique — elle lisait `styles` là où l'autre lit `style`, et faisait gagner
> `innerHTML` sur `textContent` (précédence inverse). Les deux interfaces portant un
> index signature, aucune vérification de type n'aurait signalé une substitution.
>
> **Migration :** utiliser `GeoLeaf.Utils.createElement(tag, props, ...children)`.
> Attention à renommer `styles` → `style` si vous passiez un objet de styles, et à ne
> pas compter sur `innerHTML` pour gagner sur `textContent`.

---

### `addClass(element, ...classes)`

Ajoute une ou plusieurs classes CSS.

```js
GeoLeaf.Helpers.addClass(element, "active");
GeoLeaf.Helpers.addClass(element, "primary", "highlighted");
```

---

### `removeClass(element, ...classes)`

Supprime une ou plusieurs classes CSS.

```js
GeoLeaf.Helpers.removeClass(element, "active");
GeoLeaf.Helpers.removeClass(element, "loading", "disabled");
```

---

### `toggleClass(element, className, force?)`

Bascule une classe CSS.

```js
const added = GeoLeaf.Helpers.toggleClass(element, "active");
// Returns: true si ajoutée, false si supprimée
```

---

### `hasClass(element, className)`

Vérifie si un élément possède une classe.

```js
const isActive = GeoLeaf.Helpers.hasClass(element, "active");
// Returns: boolean
```

---

### `removeElement(element)`

Retire un nœud du DOM.

```js
GeoLeaf.Helpers.removeElement(element);
```

---

### `createFragment(children?)`

Crée un `DocumentFragment` à partir d'un tableau d'éléments.

```js
const fragment = GeoLeaf.Helpers.createFragment([el1, el2, el3]);
container.appendChild(fragment);
```

---

## Performance Helpers

### `lazyLoadImage(img, options?)`

Charge une image uniquement quand elle devient visible (Intersection Observer).

```js
const img = document.querySelector(".poi-image");
GeoLeaf.Helpers.lazyLoadImage(img, {
    threshold: 0.1, // charger à 10% de visibilité
});
```

> L'image doit avoir un attribut `data-src` avec l'URL réelle.
> Fallback automatique si `IntersectionObserver` n'est pas disponible.

---

### `lazyExecute(callback, timeout?)`

Exécute une fonction via `requestIdleCallback` (ou `setTimeout` en fallback) quand le navigateur est inactif.

```js
GeoLeaf.Helpers.lazyExecute(() => {
    // Initialisation non urgente
    loadHeavyData();
}, 100);
```

---

### `requestFrame(callback)`

Exécute un callback au prochain frame d'animation (`requestAnimationFrame`).

```js
GeoLeaf.Helpers.requestFrame(() => {
    // Animation ou modification DOM optimisée
    element.style.transform = `translateX(${x}px)`;
});
// Returns: number (animation frame ID)
```

---

### `cancelFrame(id)`

Annule un frame d'animation planifié.

```js
const frameId = GeoLeaf.Helpers.requestFrame(callback);
GeoLeaf.Helpers.cancelFrame(frameId);
```

---

### `createAbortController(timeout?)`

Crée un `AbortController` avec timeout optionnel.

```js
const controller = GeoLeaf.Helpers.createAbortController(5000); // timeout 5s
const response = await fetch("/api/data", { signal: controller.signal });
```

---

## Event Helpers

### `addEventListener(element, event, handler, options?)`

Ajoute un event listener et retourne une fonction de nettoyage.

```js
const cleanup = GeoLeaf.Helpers.addEventListener(
    button,
    "click",
    (e) => {
        console.log("Click !");
    },
    { once: true }
);

// Nettoyer manuellement si besoin
cleanup();
```

---

### `addEventListeners(element, events, options?)`

Ajoute plusieurs event listeners en une seule opération, retourne un cleanup global.

```js
const cleanup = GeoLeaf.Helpers.addEventListeners(element, {
    click: () => console.log("click"),
    mouseenter: () => console.log("hover"),
    mouseleave: () => console.log("leave"),
});

// Nettoyer tous les listeners
cleanup();
```

---

### `delegateEvent(parent, event, selector, handler)`

Délégation d'événements pour éléments dynamiques.

```js
// Écouter tous les markers POI, même ceux ajoutés dynamiquement
GeoLeaf.Helpers.delegateEvent(document.body, "click", ".gl-poi-marker", function (e) {
    console.log("POI cliqué:", this.dataset.poiId);
});
```

> Note : le `handler` reçoit `this` = l'élément correspondant au `selector`.

---

## Utility Helpers

### `deepClone(obj)`

Clone profond d'un objet (supporte arrays, objects, dates, RegExp, références circulaires).

```js
const original = { name: "POI", coords: [45.5, -73.6], tags: ["a", "b"] };
const clone = GeoLeaf.Helpers.deepClone(original);

clone.tags.push("c");
console.log(original.tags); // ['a', 'b'] — original non modifié
console.log(clone.tags); // ['a', 'b', 'c']
```

---

### `isEmpty(value)`

Vérifie si une valeur est vide (`null`, `undefined`, string vide, array vide, objet vide).

```js
GeoLeaf.Helpers.isEmpty(""); // true
GeoLeaf.Helpers.isEmpty([]); // true
GeoLeaf.Helpers.isEmpty({}); // true
GeoLeaf.Helpers.isEmpty(null); // true
GeoLeaf.Helpers.isEmpty(undefined); // true
GeoLeaf.Helpers.isEmpty("hello"); // false
```

---

### `wait(ms)`

Promise de délai (async/await friendly).

```js
async function loadData() {
    console.log("Chargement...");
    await GeoLeaf.Helpers.wait(2000);
    console.log("Données chargées après 2s");
}
```

---

### `retryWithBackoff(fn, maxRetries?, delay?)`

Réessaye une fonction avec délai exponentiel en cas d'échec.

```js
const data = await GeoLeaf.Helpers.retryWithBackoff(
    async () => {
        const response = await fetch("/api/poi");
        if (!response.ok) throw new Error("Erreur réseau");
        return response.json();
    },
    3, // maxRetries (défaut : 3)
    1000 // délai initial en ms (défaut : 1000)
);

// Séquence des tentatives :
// 1. Échec → attendre 1 000 ms
// 2. Échec → attendre 2 000 ms (1000 * 2^1)
// 3. Échec → attendre 4 000 ms (1000 * 2^2)
// 4. Succès ou erreur finale
```

---

### `clearObject(obj)`

Supprime toutes les clés d'un objet en place.

```js
const cache = { key1: "val1", key2: "val2" };
GeoLeaf.Helpers.clearObject(cache);
// cache === {} (même référence, contenu vidé)
```

---

## Utilitaires de style — **retirés (taxonomy v3)**

> ⚠️ **`getColorsFromLayerStyle()` et `resolvePoiColors()` n'existent plus.** Cette section les
> documentait avec un `import { … } from "@geoleaf/core"` copiable-collable, alors qu'elles
> avaient été retirées par la refonte **taxonomy v3** (`753d0adb`), qui a fait de la capacité
> taxonomie le propriétaire du symbole d'un point — couleurs comprises. Mesuré le 30/07/2026 :
> **0 occurrence** dans `packages/core/src/`, absentes du manifeste de surface comme de
> l'entrée publiée.
>
> **Où la résolution vit aujourd'hui** : dans `capabilities/taxonomy/resolver.ts`
> (`resolvePoiIcon` et ses voisins), pilotée par la taxonomie du profil et non plus par les
> `styleRules` de la couche. Ce n'est pas un renommage — le point d'entrée **et** la source de
> vérité ont changé.
>
> ⚠️ Ni `validate-docs-examples` ni TSD-06 ne pouvaient signaler ces deux fantômes : elles ne
> reconnaissent que les formes `new X(` et `X.méthode(`, jamais un **spécificateur d'import**.
> Le trou de gate est suivi en **B-78**.

---

## Exemples d'utilisation

### Optimisation de recherche (debounce via GeoLeaf.Utils)

```js
// GeoLeaf.Utils.debounce pour les fonctions de performance generiques
// BREAKING (v3.1.0) — le namespace GeoLeaf.Filters (pluriel) est supprimé en entier.
// Le panneau de filtre actif expose la recherche via GeoLeaf.Filter (capacité, singulier).
const searchInput = document.querySelector("#search");
const debouncedSearch = GeoLeaf.Utils.debounce((query) => {
    GeoLeaf.Filter.applyFilter({
        searchText: query.toLowerCase(),
        hasSearchText: query.length > 0,
    });
}, 300);

searchInput.addEventListener("input", (e) => {
    debouncedSearch(e.target.value);
});
```

---

### Lazy loading de la carte

```js
// Ne charger les données d'une couche que quand la carte est visible
GeoLeaf.Helpers.lazyExecute(() => {
    GeoLeaf.Layers.setData("mes-points", features);
}, 100);
```

---

### Création d'un élément de popup

```js
const popup = GeoLeaf.Utils.createElement(
    "div",
    {
        className: "gl-popup",
        dataset: { poiId: poi.id },
        ariaLabel: `Détails : ${poi.label}`,
    },
    GeoLeaf.Utils.createElement("h3", { textContent: poi.label }),
    GeoLeaf.Utils.createElement("p", { textContent: poi.description })
);
document.body.appendChild(popup);
```

---

## Impact performance

| Technique            | Gain                   | Cas d'usage       |
| -------------------- | ---------------------- | ----------------- |
| **Debounce**         | -80 % requêtes         | Recherche, resize |
| **Throttle**         | -90 % exécutions       | Scroll, mousemove |
| **Lazy loading**     | +50 % vitesse initiale | Images, données   |
| **requestFrame**     | 60 FPS stable          | Animations        |
| **Event delegation** | -90 % listeners        | Listes dynamiques |

> `debounce` et `throttle` sont disponibles dans `GeoLeaf.Utils`, pas dans `GeoLeaf.Helpers`.

---

## Tests

```bash
npm test -- helpers

# Fichiers de tests
# packages/core/__tests__/helpers/helpers.test.js
```

**Couverture** : 85 %+ (90+ tests passants)

---

## Voir aussi

- `GeoLeaf.Utils` — utilitaires généraux (debounce, throttle, deepMerge, getDistance…)
- `GeoLeaf.Filter` — utilise debounce pour la recherche
- `GeoLeaf.Security` — `DOMSecurity.setSafeHTML`, utilisé par `GeoLeaf.Utils.createElement`
