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
import { readSyncStatus } from "./write/sync-status.js";
import { applyEdit, canHoldWrites } from "./write/local-edit-api.js";
import { pushOutbox } from "./write/push-engine.js";
import { requeueQuarantined, requeueAll, discardQuarantined } from "./write/quarantine-api.js";
import { armOutboxDrain, disarmOutboxDrain, requestDrain } from "./write/outbox-drain-triggers.js";
import { mountSyncBanner, unmountSyncBanner } from "./ui/sync-banner.js";

/** Storage façade surface this entry writes to (mounted on `GeoLeaf.Storage` at boot). */
interface StorageFacadeLike {
    wireModules(modules: {
        db?: unknown;
        cacheManager?: unknown;
        cache?: unknown;
        pull?: unknown;
        report?: unknown;
        edit?: unknown;
        ui?: unknown;
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
        //
        // `readSyncStatus` travels with it because it is the same KIND of thing — a read
        // over the stores, published once so no surface has to re-derive it. Two of them
        // needed it: the core's own strip and `offline-ui`'s modal, and the second cannot
        // import the first (deep imports of `@geoleaf/core` are bundled as copies, with a
        // `StorageContract` singleton that stays empty).
        report: { buildSyncReport, readSyncStatus },
        // The optimistic write, sole writer of the `outbox`.
        // ⚠️ `mayEdit` is NOT injected here, and that is measured: the permission is
        // read from the PROFILE, not IndexedDB, and `editor` declares `requires: []`
        // — so it runs without this engine in `persistence.mode: "online"`. Passing
        // the predicate through this bag would have made it unreachable exactly where
        // the edit-authorisation hole was. It lives in the boot graph:
        // `kernel/shared/edition-permissions.ts`.
        // The permanent sync strip. In the DEFERRED chunk like everything here: it reads
        // the outbox, so it belongs where the outbox does — and it must not enter the
        // boot closure the capability's `loader` exists to keep it out of.
        ui: { mountSyncBanner, unmountSyncBanner },
        // ⚠️ The three trigger members travel in the same bag as the drain they fire,
        // and for the same reason: they import `push-engine.js`, hence they belong to
        // the DEFERRED chunk. The facade only holds their handles.
        edit: {
            applyEdit,
            pushOutbox,
            requeueQuarantined,
            requeueAll,
            discardQuarantined,
            armOutboxDrain,
            disarmOutboxDrain,
            requestDrain,
            canHoldWrites,
        },
    });
    // D5 (POI dissolution, inverse merge): push queued offline POIs onto their host
    // GeoJSON layer via `GeoLeaf.Layers` instead of the core pulling them.
    registerPoiRestore();
}
