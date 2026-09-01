/*!
 * GeoLeaf Core (offline capability) — dynamic engine composition root
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Composition root for the offline data engine (S14 Phase B — B3).
 *
 * This is the **only** module that statically imports the engine (IndexedDB / cache /
 * download / sync / poi-restore, ~7.4 kLOC). It is reached exclusively via the
 * `OFFLINE_CAPABILITY.loader` dynamic `import()`, so the engine loads on demand and
 * stays OUT of the boot closure — `check-bundle-size.cjs` follows only static
 * `import`/`export … from`, never `import()`, so the engine is mechanically off-budget.
 *
 * On evaluation it assembles the engine modules and wires them into the in-core
 * `GeoLeaf.Storage` façade (self-mounted at boot), then registers the offline POI
 * restore. `OfflineLifecycle` awaits this loader before calling `Storage.init(...)`.
 */

// ── Engine modules (side-effect registration into the DB / cache registries) ──
import "./db/storage-helper.js";
import { IndexedDB } from "./db/indexeddb.js";
import "./db/layers.js";
import "./db/eviction.js";
import "./db/preferences.js";
import "./db/images.js";
import { CacheStorage } from "./cache/storage.js";
import "./cache/calculator.js";
import "./cache/metrics.js";
import "./cache/resource-enumerator.js";
import "./cache/progress-tracker.js";
import "./cache/retry-handler.js";
import "./cache/fetch-manager.js";
import "./cache/downloader.js";
import { CacheManager } from "./cache/cache-manager.js";
import { registerPoiRestore } from "./poi-restore/poi-restore-boot.js";
import { pullLayer } from "./pull/layer-pull.js";
import { buildSyncReport } from "./report/sync-report.js";
import { applyEdit } from "./write/local-edit-api.js";
import { pushOutbox } from "./write/push-engine.js";
import { requeueQuarantined, discardQuarantined } from "./write/quarantine-api.js";

/** Storage façade surface this entry writes to (mounted on `GeoLeaf.Storage` at boot). */
interface StorageFacadeLike {
    wireModules(modules: {
        db?: unknown;
        cacheManager?: unknown;
        cache?: unknown;
        pull?: unknown;
        report?: unknown;
        edit?: unknown;
    }): void;
}

const _g = (typeof globalThis !== "undefined" ? globalThis : {}) as {
    GeoLeaf?: { Storage?: StorageFacadeLike };
};

// Inject the assembled engine into the in-core façade. The UI `LayerSelector` is NOT
// wired here — it lives in the residual storage plugin (UI) and is consumed there
// directly, not through the façade's `cache` bag.
if (_g.GeoLeaf?.Storage) {
    _g.GeoLeaf.Storage.wireModules({
        db: IndexedDB,
        cacheManager: CacheManager,
        cache: { Storage: CacheStorage },
        // The bounded pull, first writer of the `features` store. Injected here and
        // not imported by the facade: the facade lives in the boot graph, the pull in
        // the deferred chunk.
        pull: { pullLayer },
        // The per-layer report. Same motive as `pull`: it reads the profile AND both
        // stores, so it belongs to the deferred chunk, not the boot graph.
        report: { buildSyncReport },
        // The optimistic write, sole writer of the `outbox`.
        // ⚠️ `mayEdit` is NOT injected here, and that is measured: the permission is
        // read from the PROFILE, not IndexedDB, and `editor` declares `requires: []`
        // — so it runs without this engine in `persistence.mode: "online"`. Passing
        // the predicate through this bag would have made it unreachable exactly where
        // the edit-authorisation hole was. It lives in the boot graph:
        // `kernel/shared/edition-permissions.ts`.
        edit: { applyEdit, pushOutbox, requeueQuarantined, discardQuarantined },
    });
    // D5 (POI dissolution, inverse merge): push queued offline POIs onto their host
    // GeoJSON layer via `GeoLeaf.Layers` instead of the core pulling them.
    registerPoiRestore();
}
