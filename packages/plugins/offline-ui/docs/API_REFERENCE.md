# @geoleaf-plugins/offline-ui — API Reference

**Package:** `@geoleaf-plugins/offline-ui`  
**Namespace:** none — see below

---

## This plugin has no API of its own

`@geoleaf-plugins/offline-ui` mounts **no namespace** and exports no function. It is an
interface: loading it registers a toolbar button, a window and six dictionaries, and nothing is
called on it afterwards.

`GeoLeaf.Storage`, which earlier versions of this page documented as the plugin's namespace, is a
facade of **`@geoleaf/core`**. It exists without this plugin, and its reference is the core's:

- [the core's API reference](../../../core/docs/API_REFERENCE.md) — what erases what, the log;
- [the offline write cycle](../../../core/docs/OFFLINE_WRITE_CYCLE.md) — the write queue, the
  entries set aside and their exits, the pre-departure check.

What follows is the **list of what the window calls**, so that an integrator who wants the same
information in an interface of their own knows where it comes from. The signatures are the
core's; they are not repeated here, where they would drift.

---

## What the window reads

| The window shows                           | It reads                                                      |
| ------------------------------------------ | ------------------------------------------------------------- |
| Whether the engine is ready                | `GeoLeaf.Storage.isAvailable()`, `whenReady()`                |
| A profile's cache: state, size             | `GeoLeaf.Storage.CacheManager.getCacheStatus(profileId)`      |
| The browser's quota                        | `GeoLeaf.Storage.CacheManager.getStorageQuota()`              |
| The layers and basemaps chosen last time   | `GeoLeaf.Storage.Cache.Storage.loadLayerSelection(profileId)` |
| Whether a basemap can be prepared at all   | `GeoLeaf.Storage.prefetchVerdict(url)` (core ≥ 3.15.0)        |
| Network, captures owed, captures set aside | `GeoLeaf.Storage.getSyncStatus()`                             |
| The captures set aside, with their motive  | `GeoLeaf.Storage.DB.listPendingEdits()`                       |
| Which motives a retry can lift             | `GeoLeaf.Storage.requeueableReasons()`                        |
| "Can I leave?"                             | `GeoLeaf.Storage.preflight()` (core ≥ 3.10.0)                 |
| The tallies of the Export tab              | `GeoLeaf.Storage.getStats()`                                  |
| The application's journal                  | `GeoLeaf.Log.exportDiagnostic()`                              |
| Whether an update of the application waits | `GeoLeaf.PWA.isUpdateWaiting()` (core ≥ 3.15.0)               |

## What the window does

| The gesture                            | It calls                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| Save the selection of layers           | `GeoLeaf.Storage.Cache.Storage.saveLayerSelection(profileId, sel)` |
| Download the profile                   | `GeoLeaf.Storage.CacheManager.cacheProfile(profileId, options)`    |
| Stop a download                        | `GeoLeaf.Storage.CacheManager.cancelDownload()`                    |
| Delete a profile's cache               | `GeoLeaf.Storage.CacheManager.clearCache(profileId)`               |
| Retry the captures of one motive       | `GeoLeaf.Storage.requeueAll(motive)`                               |
| Discard a capture set aside, confirmed | `GeoLeaf.Storage.discardQuarantined(entryId, localId)`             |

⚠️ **A discard takes the entry's `localId` as it was LISTED.** That is the core's rule, not a
detail of this window: a capture cannot be destroyed by something that never enumerated it.

⚠️ **Deleting a cache does not delete field work.** `clearCache(profileId)` removes what can be
downloaded again. The captures still owed to the server are in the write queue, which no gesture
of the cache tab touches.

---

## Events the window follows

All are dispatched on `document` by the core.

| Event                               | The window then                                          |
| ----------------------------------- | -------------------------------------------------------- |
| `geoleaf:cache:progress`            | Moves the progress bar                                   |
| `geoleaf:offline:pull-progress`     | Says which layer's entities are being pulled             |
| `geoleaf:cache:completed`           | Refreshes the cache state                                |
| `geoleaf:cache:cancelled`           | Shows the download as stopped, and hands the button back |
| `geoleaf:cache:cleared`             | Refreshes the cache state and the "Can I leave?" block   |
| `geoleaf:offline:outbox-queued`     | Re-reads the write queue                                 |
| `geoleaf:offline:outbox-drained`    | Re-reads the write queue                                 |
| `geoleaf:offline:quarantine-exited` | Re-reads the captures set aside                          |
| `geoleaf:storage:quota-exceeded`    | Raises a notice — whether the window is open or not      |

It also listens to the browser's own `online` and `offline` events, not to `geoleaf:online` /
`geoleaf:offline`: those come from the core's connectivity detector, which a profile may switch
off (see [offline-detector.md](offline-detector.md)).

Outside the window, the « A new version is ready » banner follows three more:

| Event                       | The banner then                                                        |
| --------------------------- | ---------------------------------------------------------------------- |
| `geoleaf:sw:update-waiting` | Appears — again, even after « Later »: it is another update            |
| `geoleaf:app:ready`         | Appears if an update still waits and « Later » was not answered        |
| `geoleaf:sw:updated`        | Leaves, unless the update was applied from another tab and still waits |

Its **Reload** button calls `GeoLeaf.PWA.applyUpdate()`; the core reloads the page.

---

## Published types

The package's entry re-exports types only: `StorageContractShape` and its members — the view
this plugin takes of the core's `GeoLeaf.Storage` facade. They describe what the plugin READS of
the core, not an API it offers.

---

## See also

- [OVERVIEW.md](OVERVIEW.md) — What the plugin is, and is not
- [CONFIGURATION.md](CONFIGURATION.md) — Profile keys
- [EXAMPLES.md](EXAMPLES.md) — Practical recipes
