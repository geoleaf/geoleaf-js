---
title: "GeoLeaf.Helpers — Helpers module documentation"
---

# GeoLeaf.Helpers — Helpers module documentation

**Applies to**: @geoleaf/core v3.x

**Source**: `src/modules/geoleaf.helpers.ts` → `src/modules/utils/helpers/dom-helpers.ts`

---

## Overview

The **GeoLeaf.Helpers** module provides DOM manipulation, performance and event-handling utilities that improve the performance and maintainability of GeoLeaf.

### Utility categories

- **DOM helpers** — safe DOM manipulation
- **Performance** — debounce, throttle, lazy loading
- **Events** — event handling with cleanup
- **Utilities** — deep clone, retry, wait

> **Note**: `GeoLeaf.Helpers` exposes only the DOM utilities and the style resolvers. General-purpose utilities (debounce, throttle, deepMerge, getDistance, and so on) live in `GeoLeaf.Utils`.

---

## DOM helpers

### `getElementById(id)`

Retrieves an element by ID, safely.

```js
const element = GeoLeaf.Helpers.getElementById("my-map");
// Returns: HTMLElement | null
```

---

### `querySelector(selector, parent?)`

Safe query selector with error handling.

```js
const element = GeoLeaf.Helpers.querySelector(".gl-map-container");
const child = GeoLeaf.Helpers.querySelector(".item", parentElement);
// Returns: Element | null
```

---

### `querySelectorAll(selector, parent?)`

Query all, with automatic conversion to an `Array`.

```js
const elements = GeoLeaf.Helpers.querySelectorAll(".poi-marker");
// Returns: Element[] (always an array, never null)
```

---

### `createElement(tag, options)` — **removed**

::: warning

This method no longer exists. `GeoLeaf.Helpers.createElement()` has been removed: it had no
caller, and its options shape diverged silently from the canonical factory — it read `styles`
where the other one reads `style`, and it let `innerHTML` win over `textContent` (the reverse
precedence). Since both interfaces carried an index signature, no type check would have
flagged a substitution.

**Migration:** use `GeoLeaf.Utils.createElement(tag, props, ...children)`. Rename `styles` →
`style` if a style object was being passed, and do not rely on `innerHTML` winning over
`textContent`.

:::

---

### `addClass(element, ...classes)`

Adds one or more CSS classes.

```js
GeoLeaf.Helpers.addClass(element, "active");
GeoLeaf.Helpers.addClass(element, "primary", "highlighted");
```

---

### `removeClass(element, ...classes)`

Removes one or more CSS classes.

```js
GeoLeaf.Helpers.removeClass(element, "active");
GeoLeaf.Helpers.removeClass(element, "loading", "disabled");
```

---

### `toggleClass(element, className, force?)`

Toggles a CSS class.

```js
const added = GeoLeaf.Helpers.toggleClass(element, "active");
// Returns: true when added, false when removed
```

---

### `hasClass(element, className)`

Checks whether an element carries a class.

```js
const isActive = GeoLeaf.Helpers.hasClass(element, "active");
// Returns: boolean
```

---

### `removeElement(element)`

Removes a node from the DOM.

```js
GeoLeaf.Helpers.removeElement(element);
```

---

### `createFragment(children?)`

Creates a `DocumentFragment` from an array of elements.

```js
const fragment = GeoLeaf.Helpers.createFragment([el1, el2, el3]);
container.appendChild(fragment);
```

---

## Performance helpers

### `lazyLoadImage(img, options?)`

Loads an image only once it becomes visible (Intersection Observer).

```js
const img = document.querySelector(".poi-image");
GeoLeaf.Helpers.lazyLoadImage(img, {
    threshold: 0.1, // load at 10% visibility
});
```

> The image must carry a `data-src` attribute holding the real URL.
> Automatic fallback when `IntersectionObserver` is unavailable.

---

### `lazyExecute(callback, timeout?)`

Runs a function through `requestIdleCallback` (or `setTimeout` as a fallback) while the browser is idle.

```js
GeoLeaf.Helpers.lazyExecute(() => {
    // Non-urgent initialisation
    loadHeavyData();
}, 100);
```

---

### `requestFrame(callback)`

Runs a callback on the next animation frame (`requestAnimationFrame`).

```js
GeoLeaf.Helpers.requestFrame(() => {
    // Animation or optimised DOM update
    element.style.transform = `translateX(${x}px)`;
});
// Returns: number (animation frame ID)
```

---

### `cancelFrame(id)`

Cancels a scheduled animation frame.

```js
const frameId = GeoLeaf.Helpers.requestFrame(callback);
GeoLeaf.Helpers.cancelFrame(frameId);
```

---

### `createAbortController(timeout?)`

Creates an `AbortController` with an optional timeout.

```js
const controller = GeoLeaf.Helpers.createAbortController(5000); // 5s timeout
const response = await fetch("/api/data", { signal: controller.signal });
```

---

## Event helpers

### `addEventListener(element, event, handler, options?)`

Adds an event listener and returns a cleanup function.

```js
const cleanup = GeoLeaf.Helpers.addEventListener(
    button,
    "click",
    (e) => {
        console.log("Click!");
    },
    { once: true }
);

// Clean up manually when needed
cleanup();
```

---

### `addEventListeners(element, events, options?)`

Adds several event listeners in one call and returns a single cleanup function.

```js
const cleanup = GeoLeaf.Helpers.addEventListeners(element, {
    click: () => console.log("click"),
    mouseenter: () => console.log("hover"),
    mouseleave: () => console.log("leave"),
});

// Clean up every listener
cleanup();
```

---

### `delegateEvent(parent, event, selector, handler)`

Event delegation for dynamically created elements.

```js
// Listen to every POI marker, including those added later
GeoLeaf.Helpers.delegateEvent(document.body, "click", ".gl-poi-marker", function (e) {
    console.log("POI clicked:", this.dataset.poiId);
});
```

> Note: the `handler` receives `this` = the element matching `selector`.

---

## Utility helpers

### `deepClone(obj)`

Deep clone of an object (supports arrays, objects, dates, RegExp and circular references).

```js
const original = { name: "POI", coords: [45.5, -73.6], tags: ["a", "b"] };
const clone = GeoLeaf.Helpers.deepClone(original);

clone.tags.push("c");
console.log(original.tags); // ['a', 'b'] — original untouched
console.log(clone.tags); // ['a', 'b', 'c']
```

---

### `isEmpty(value)`

Checks whether a value is empty (`null`, `undefined`, empty string, empty array, empty object).

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

Delay promise (async/await friendly).

```js
async function loadData() {
    console.log("Loading...");
    await GeoLeaf.Helpers.wait(2000);
    console.log("Data loaded after 2s");
}
```

---

### `retryWithBackoff(fn, maxRetries?, delay?)`

Retries a function with an exponential delay on failure.

```js
const data = await GeoLeaf.Helpers.retryWithBackoff(
    async () => {
        const response = await fetch("/api/poi");
        if (!response.ok) throw new Error("Network error");
        return response.json();
    },
    3, // maxRetries (default: 3)
    1000 // initial delay in ms (default: 1000)
);

// Sequence of attempts:
// 1. Failure → wait 1,000 ms
// 2. Failure → wait 2,000 ms (1000 * 2^1)
// 3. Failure → wait 4,000 ms (1000 * 2^2)
// 4. Success, or final error
```

---

### `clearObject(obj)`

Deletes every key of an object in place.

```js
const cache = { key1: "val1", key2: "val2" };
GeoLeaf.Helpers.clearObject(cache);
// cache === {} (same reference, contents cleared)
```

---

## Style utilities — **removed (taxonomy v3)**

::: warning

`getColorsFromLayerStyle()` and `resolvePoiColors()` no longer exist. They were removed by the
**taxonomy v3** rework, which made the taxonomy capability the owner of a point's symbol,
colours included. They are absent from `packages/core/src/`, from the surface manifest and from
the published entry point.

**Where resolution lives now**: in `capabilities/taxonomy/resolver.ts` (`resolvePoiIcon` and
its neighbours), driven by the profile taxonomy rather than by the `styleRules` of the layer.
This is not a rename — both the entry point **and** the source of truth have changed.

:::

---

## Usage examples

### Search optimisation (debounce through GeoLeaf.Utils)

```js
// GeoLeaf.Utils.debounce for generic performance helpers
// BREAKING (v3.1.0) — the GeoLeaf.Filters namespace (plural) is removed entirely.
// The active filter panel exposes search through GeoLeaf.Filter (capability, singular).
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

### Lazy loading of map data

```js
// Load layer data only once the map is visible
GeoLeaf.Helpers.lazyExecute(() => {
    GeoLeaf.Layers.setData("mes-points", features);
}, 100);
```

---

### Building a popup element

```js
const popup = GeoLeaf.Utils.createElement(
    "div",
    {
        className: "gl-popup",
        dataset: { poiId: poi.id },
        ariaLabel: `Details: ${poi.label}`,
    },
    GeoLeaf.Utils.createElement("h3", { textContent: poi.label }),
    GeoLeaf.Utils.createElement("p", { textContent: poi.description })
);
document.body.appendChild(popup);
```

---

## Performance impact

| Technique            | Gain               | Use case          |
| -------------------- | ------------------ | ----------------- |
| **Debounce**         | -80% requests      | Search, resize    |
| **Throttle**         | -90% executions    | Scroll, mousemove |
| **Lazy loading**     | +50% initial speed | Images, data      |
| **requestFrame**     | Stable 60 FPS      | Animations        |
| **Event delegation** | -90% listeners     | Dynamic lists     |

> `debounce` and `throttle` are available in `GeoLeaf.Utils`, not in `GeoLeaf.Helpers`.

---

## Tests

```bash
npm test -- helpers

# Test files
# packages/core/__tests__/helpers/helpers.test.js
```

**Coverage**: 85%+ (90+ passing tests)

---

## See also

- `GeoLeaf.Utils` — general-purpose utilities (debounce, throttle, deepMerge, getDistance, and so on)
- `GeoLeaf.Filter` — uses debounce for search
- `GeoLeaf.Security` — `DOMSecurity.setSafeHTML`, used by `GeoLeaf.Utils.createElement`
