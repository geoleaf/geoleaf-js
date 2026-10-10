---
title: "PWA — Configuration and deployment"
---

# PWA — Configuration and deployment

::: info

**Usage here, contract elsewhere.** This page explains **how to use the feature**. The contract — scope, configuration, exposed API, boundaries — lives in [`pwa.md`](https://github.com/geoleaf/geoleaf-js/blob/main/docs/specs/capacites/pwa.md). Where the two disagree, the specification wins.

:::

GeoLeaf supports installation as a **progressive web app (PWA)** on Android and iOS, with no application-specific development. This page documents the configuration, the deployment prerequisites, and the per-platform behaviour.

---

## Deployment prerequisites

| Requirement                                     | Needed for                                            |
| ----------------------------------------------- | ----------------------------------------------------- |
| **HTTPS**                                       | Lighthouse PWA, Service Worker, `beforeinstallprompt` |
| **Active Service Worker**                       | Offline support, Lighthouse PWA                       |
| **Valid `manifest.json`**                       | Installability, Lighthouse PWA                        |
| **192 and 512 px icons** (including `maskable`) | Lighthouse PWA score of 100                           |
| **`<link rel="manifest">`** in the HTML         | Browser detection                                     |
| **`theme-color` meta tag**                      | Browser chrome colour                                 |

> The Service Worker (`sw-core.js`) and the manifest (`manifest.json`) are included automatically in the variants built by `build-deploy.cjs`.

---

## Generating the icons

The PWA icons must be generated from the source logo before the first deployment:

```bash
node scripts/generate-pwa-icons.cjs
```

This produces 4 files in `apps/geoleaf-app/src/assets/icons/`:

| File                    | Size    | Purpose                           |
| ----------------------- | ------- | --------------------------------- |
| `icon-192.png`          | 192×192 | Standard — Android, Windows       |
| `icon-512.png`          | 512×512 | Standard — splash screen          |
| `icon-192-maskable.png` | 192×192 | Maskable — Android adaptive icons |
| `icon-512-maskable.png` | 512×512 | Maskable — maskable splash screen |

> Prerequisite: `sharp` installed in `packages/core` (`npm install --prefix packages/core`).

---

## Configuring the PWA branding

The manifest is generated at build time by `build-deploy.cjs`, by merging:

1. The source template `apps/geoleaf-app/manifest.json`
2. The `pwa` section of `profiles/geoleaf.config.json`

The `pwa.*` fields of the configuration override the template values:

```json
// profiles/geoleaf.config.json
{
    "pwa": {
        "name": "Mon Application",
        "short_name": "MonApp",
        "description": "Ma description",
        "theme_color": "#2d6a4f",
        "background_color": "#ffffff",
        "installPrompt": {
            "enabled": false
        }
    }
}
```

---

## Enabling the install prompt

The prompt is **disabled by default** (`enabled: false`). To enable it:

```json
// profiles/geoleaf.config.json
{
    "pwa": {
        "installPrompt": {
            "enabled": true
        }
    }
}
```

`GeoLeaf.PWA.init()` is called automatically once the configuration has loaded (in `app/boot.ts`).

### When the capability is disabled

With `modules.pwa.enabled` absent or not `true`, GeoLeaf **unregisters its own service worker** at
boot — otherwise a worker registered during an earlier visit would keep controlling the page
indefinitely, and switching the capability off would have no observable effect.

🛑 **Only `sw-core.js` is unregistered.** If you embed GeoLeaf inside a host application that
registers its own service worker — for offline support, for an app install — that worker is left
untouched, at boot and at teardown alike. The match is made on the last path segment of each
registration's `scriptURL`, so a worker of yours named `vendor-sw-core.js` is not mistaken for ours.

### Per-platform behaviour

| Platform                    | Behaviour                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Android / Chrome / Edge** | Captures `beforeinstallprompt` → shows a custom banner with an install button                                                        |
| **iOS Safari**              | `beforeinstallprompt` does not exist → shows a manual banner explaining how to add the app to the home screen through the Share menu |
| **Other browsers**          | No `beforeinstallprompt` → no banner                                                                                                 |

#### Android banner

- Appears only once the browser considers the app installable (HTTPS + Service Worker + valid manifest)
- Dismissal is persisted in `localStorage['gl_pwa_install_dismissed']`
- Hides itself after installation (`appinstalled` event)

#### iOS banner

- Detects `/(iPhone|iPad|iPod)/i` in `navigator.userAgent`
- Not shown when the app already runs in standalone mode (`navigator.standalone === true`)
- Appears 1.5 seconds after load, so it does not hide the initial content
- Dismissal is persisted in `localStorage['gl_pwa_ios_dismissed']`

---

## Programmatic use (ESM)

```typescript
import { PWA } from "@geoleaf/core";

// Manual initialisation (normally called by boot.ts)
PWA.init({
    installPrompt: { enabled: true },
});
```

Through the global namespace (CDN/ESM):

```javascript
GeoLeaf.PWA.init({ installPrompt: { enabled: true } });
```

---

## When a new version is deployed

A deployment changes the service worker, and the browser installs the new one in the
background. **It does not take over a page that is in use.** The new version waits — its
caches are ready, the page keeps running on the version it booted with — until the user
accepts it.

| Moment                                         | What happens                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| First visit                                    | The worker takes the page at once: there is nothing to protect                |
| A new version is found, the page is in use     | It installs, then waits. `geoleaf:sw:update-waiting` is emitted on `document` |
| The user accepts — `GeoLeaf.PWA.applyUpdate()` | The new worker takes over, and **the page reloads** onto the new version      |
| Nobody accepts                                 | The new version takes over once every tab of the application has been closed  |

Why it waits: activating a new worker purges the previous version's caches. Done under a page
that is still running that version, it removes the lazy chunks the page has not loaded yet — a
user offline, in the middle of a capture, then opens a panel that no longer exists anywhere.

### Who asks the user

- **With `@geoleaf-plugins/offline-ui`** — nothing to write. The plugin shows a banner,
  « A new version is ready », with **Reload** and **Later**.
- **Without it** — the new version waits silently until every tab is closed. Offer the gesture
  yourself:

```javascript
function offerReload() {
    myReloadButton.hidden = false;
}

// The event is emitted once per waiting version, possibly before your listener exists:
// read the state as well.
document.addEventListener("geoleaf:sw:update-waiting", offerReload);
if (GeoLeaf.PWA.isUpdateWaiting()) offerReload();

myReloadButton.addEventListener("click", () => {
    // Returns false when nothing was waiting; otherwise the page reloads.
    GeoLeaf.PWA.applyUpdate();
});
```

::: warning

`applyUpdate()` reloads the page: call it from a user gesture. What the page holds in memory —
a form being filled — is lost with it. Captures already queued by the offline write cycle are
not: they are in IndexedDB.

The reload is not instantaneous. The browser lets the new worker take over once the previous one
has finished the requests it is serving — a slow tile server can hold it for a while — and the
page reloads then, once. Disable your button after the click rather than expecting an immediate
effect.

:::

With several tabs open, one worker serves them all: accepting the update in one tab activates
it for every tab. The tab where the gesture was made reloads; the others do not reload by
themselves — `isUpdateWaiting()` stays `true` there, and `applyUpdate()` reloads them.

`geoleaf:sw:updated` is a different fact: a worker **activated**. It also fires at a first
install.

---

## Testing locally

The Service Worker and the manifest are **not** active when the sources are served directly: they only exist in the built variants. A deployment must therefore be regenerated, **in four steps — the first one is not optional**:

```bash
npx turbo run build && npm run build:deploy && node scripts/build-deploy-coverage.cjs && npm run build:deploy:local
```

Then point a browser at the vhost that serves `deploy/` (a server is already running; do not start a second one). The Service Worker requires **HTTPS**, or `localhost` for testing.

::: warning

Running `npm run build:deploy` on its own rebuilds only part of what it copies, so it produces a **stale** deployment while still exiting 0. Any test run against that output measures the previous bundle.

:::

---

## Lighthouse validation

To reach a PWA score of 90 or more (ideally 100):

```bash
npx lighthouse https://your-domain.com --preset=pwa --output=html --output-path=./lighthouse-report.html
```

Checklist:

- [ ] HTTPS active on the server
- [ ] `manifest.json` present at the root, with `name`, 192+512 `icons`, `start_url` and `display` filled in
- [ ] Icons with `purpose: maskable` (produced by `generate-pwa-icons.cjs`)
- [ ] `<link rel="manifest">` in the HTML
- [ ] `theme-color` meta tag present
- [ ] Service Worker registered, `fetch` event handler active
- [ ] `start_url` answers HTTP 200 (including offline)

---

## File layout

```
apps/geoleaf-app/               ← the deployable APPLICATION, source of the deploy/ variants
├── manifest.json               ← Source template (merged by build-deploy.cjs)
├── init.js                     ← SW registration (navigator.serviceWorker.register)
└── src/assets/icons/
    ├── icon-192.png            ← Generated by generate-pwa-icons.cjs
    ├── icon-192-maskable.png
    ├── icon-512.png
    └── icon-512-maskable.png

packages/core/src/
├── api/geoleaf.pwa.ts          ← Public facade (GeoLeaf.PWA)
├── kernel/storage/sw-core.js   ← Lite Service Worker (static cache + profiles)
└── capabilities/pwa/
    ├── pwa-capability.ts       ← Capability declaration (gate, configSchema)
    ├── pwa-manager.ts          ← Orchestrator + PWAConfig interface
    ├── install-prompt.ts       ← Android banner
    ├── ios-banner.ts           ← iOS instructions banner
    ├── platform.ts             ← Platform detection
    ├── lifecycle.ts · install.ts · public-api.ts

scripts/
└── generate-pwa-icons.cjs      ← Icon generator (sharp)
```

---

## `PWAConfig` interface reference

See {@link PWAConfig} for the complete field documentation.
