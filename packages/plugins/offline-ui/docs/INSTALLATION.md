# @geoleaf-plugins/offline-ui — Installation

**Package:** `@geoleaf-plugins/offline-ui`  
**Registry:** [npmjs.org](https://www.npmjs.com/package/@geoleaf-plugins/offline-ui) — public

---

## Prerequisites

1. Node.js ≥ 22
2. `@geoleaf/core` ^3.0.0 already installed (peer dependency)

No account, no token, no registry configuration: the package is public on npmjs.

---

## Step 1 — Install

```bash
npm install @geoleaf-plugins/offline-ui
```

---

## Step 2 — Load the plugin

### ESM (script tag)

The plugin must be loaded **after** `@geoleaf/core`:

```html
<!-- Core first -->
<script type="module" src="geoleaf.esm.js"></script>

<!-- Then the plugin -->
<script
    type="module"
    src="node_modules/@geoleaf-plugins/offline-ui/dist/geoleaf-offline-ui.plugin.js"
></script>
```

### ESM

```javascript
import "@geoleaf-plugins/offline-ui";
// The plugin registers itself automatically on import.
```

---

## Step 3 — Initialise

Call `Storage.init()` after GeoLeaf Core has loaded:

```javascript
await GeoLeaf.init({
    map: { target: "map" },
    data: { activeProfile: "my-app", profilesBasePath: "./profiles/" },
});
GeoLeaf.boot();

const ok = await GeoLeaf.Storage.init({
    indexedDB: {
        name: "geoleaf-app",
        version: 1,
    },
    enableOfflineDetector: true,
    enableServiceWorker: false,
});

if (!ok) {
    console.warn("Storage plugin failed to initialise.");
}
```

### Full `StorageInitOptions`

```typescript
interface StorageInitOptions {
    indexedDB?: {
        name?: string; // Database name (default: 'geoleaf-storage')
        version?: number; // Schema version (default: 1)
    };
    cache?: Record<string, unknown>; // CacheManager configuration
    offline?: Record<string, unknown>; // OfflineDetector configuration
    enableOfflineDetector?: boolean; // Enable network monitoring (default: false)
    enableServiceWorker?: boolean; // Register service worker (default: false)
}
```

---

## Step 4 — Verify

```javascript
const available = GeoLeaf.Storage.isAvailable();
console.log("Storage available:", available);

const offline = GeoLeaf.Storage.isOffline();
console.log("Currently offline:", offline);
```

---

## CI/CD setup

Nothing specific to do — `npm install` works out of the box:

```yaml
- name: Install dependencies
  run: npm ci
```

---

## Troubleshooting

| Problem                        | Cause                             | Solution                                  |
| ------------------------------ | --------------------------------- | ----------------------------------------- |
| `Storage.init() returns false` | Sub-system init failure           | Check browser console for detailed errors |
| IndexedDB unavailable          | Private/incognito mode or blocked | Some browsers block IDB in private mode   |

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — Plugin architecture
- [API_REFERENCE.md](API_REFERENCE.md) — Full public API
- [EXAMPLES.md](EXAMPLES.md) — Practical usage recipes
