# @geoleaf-plugins/offline-ui — Installation

**Package:** `@geoleaf-plugins/offline-ui`  
**Registry:** [npmjs.org](https://www.npmjs.com/package/@geoleaf-plugins/offline-ui) — public

---

## Prerequisites

1. Node.js ≥ 22
2. `@geoleaf/core` v3 — a **peer dependency**: install it yourself, the plugin never brings a
   second copy of it

No account, no token, no registry configuration: the package is public on npmjs.

---

## Step 1 — Install

```bash
npm install @geoleaf/core @geoleaf-plugins/offline-ui
```

---

## Step 2 — Load the plugin

Load it **after** the core and **before** `GeoLeaf.boot()`.

### ESM (script tag)

```html
<!-- Core first -->
<script type="module" src="geoleaf.esm.js"></script>

<!-- Then the plugin -->
<script
    type="module"
    src="node_modules/@geoleaf-plugins/offline-ui/dist/geoleaf-offline-ui.plugin.js"
></script>
```

### ESM (bundler)

```javascript
import "@geoleaf/core";
import "@geoleaf-plugins/offline-ui";
// The plugin registers its interface on import.
```

---

## Step 3 — Enable the capability in the profile

There is **no call to make**. The offline engine belongs to the core: it is loaded on demand and
initialised while the application boots, when the profile says so —
`modules.offline.enabled: true` **and** `modules.pwa.enabled: true`. The keys, and what each
changes, are in [CONFIGURATION.md](CONFIGURATION.md).

```javascript
GeoLeaf.boot({
    config: { data: { activeProfile: "my-app", profilesBasePath: "./profiles/" } },
});
```

Without those two keys the engine is never loaded: the plugin still registers its interface, and
a download answers that offline storage is not available.

---

## Step 4 — Verify

`GeoLeaf.Storage` is the core's facade. Its members are optional in the types because the facade
is inert until the engine has loaded:

```javascript
const available = GeoLeaf.Storage?.isAvailable?.() ?? false;
console.log("Offline engine ready:", available);

const offline = GeoLeaf.Storage?.isOffline?.() ?? false;
console.log("Currently offline:", offline);
```

To wait for the engine rather than poll it, `GeoLeaf.Storage.whenReady()` resolves once it has
announced itself. ⚠️ It never resolves on a profile that does not enable the capability.

---

## CI/CD setup

Nothing specific to do — `npm install` works out of the box:

```yaml
- name: Install dependencies
  run: npm ci
```

---

## Troubleshooting

| Problem                                  | Cause                                              | What to do                                                                 |
| ---------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| A download says storage is not available | The profile does not enable the capability         | Set `modules.offline.enabled` and `modules.pwa.enabled`                    |
| A basemap row is greyed                  | Its origin is not declared for offline preparation | Declare it in `modules.offline.dataOrigins` — its tooltip names the origin |
| Storage refused or evicted               | A private window, or an origin without persistence | The "Can I leave?" block says which regime the browser granted             |

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — What the plugin is, and is not
- [CONFIGURATION.md](CONFIGURATION.md) — Profile keys
- [API_REFERENCE.md](API_REFERENCE.md) — What the window calls, and the events it follows
- [EXAMPLES.md](EXAMPLES.md) — Practical recipes
