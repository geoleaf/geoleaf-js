/*!
 * GeoLeaf Core (offline capability) — Capability declaration
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Capability declaration for the in-core `offline` capability (S14 Phase B).
 *
 * Bundles the heavy offline data engine (IndexedDB / cache / download / sync /
 * poi-restore, ~9 000 l.) that used to live in `@geoleaf-plugins/offline-ui`. Unlike
 * every other capability, the engine is meant to load on demand via a **dynamic
 * `import()`** (the `loader`, wired in B3 once the engine is in-core) so it stays
 * OUT of the boot closure — the boot budget (`check-bundle-size.cjs` follows only
 * static imports) is unaffected.
 *
 * Depends on the `pwa` capability: the unified service worker (`sw-core.js`) serves
 * tiles from the IndexedDB `layers` store this engine fills.
 *
 * ⚠️ `dependencies` is **introspection metadata only** — `CapabilityRegistry` does
 * NOT enforce it. The `offline → pwa` constraint is guarded manually by
 * `OfflineLifecycle` (`shared.module` #8): it only loads/inits when BOTH
 * `modules.offline.enabled` AND `modules.pwa.enabled` are set (post-merge).
 *
 * Registered by the preset loop (Pass 1) so that
 * `GeoLeaf.Introspection.getAllCapabilities()` / `getCapabilitySchema('offline')` work.
 *
 * Config gate: `modules.offline.enabled`. **Opt-in** (`enableWhenAbsent: false`) — the
 * offline engine is off (no chunk fetched) unless a profile explicitly enables it.
 */
"use strict";

import type { ICapabilityDeclaration } from "../../contracts/capability.contract.js";

/** In-core capability declaration for the offline engine (IndexedDB + cache + download + sync). */
export const OFFLINE_CAPABILITY: ICapabilityDeclaration = {
    id: "offline",
    label: "Offline",
    description:
        "Offline data engine: cache a profile (GeoJSON layers, map tiles, sprites) into IndexedDB and sync POIs created offline. Loaded on demand (dynamic import), off the boot path. Requires the `pwa` capability.",
    gate: { configPath: "modules.offline.enabled", enableWhenAbsent: false },
    dependencies: ["pwa"],
    configSchema: {
        enabled: {
            type: "boolean",
            default: false,
            description:
                "Master gate (opt-in): load the offline engine (dynamic import) and enable download/sync. Requires `modules.pwa.enabled`.",
        },
        dataOrigins: {
            type: "array",
            description:
                "Origins the profile declares, with what each may serve and whether it is " +
                "cacheable. REPLACES routing by guesswork in the Service Worker — hostname " +
                "substrings, path sniffing, a hardcoded provider domain and a blanket `/api/` " +
                "exclusion. An undeclared origin is not routed to any cache.",
            default: [],
        },
        cache: {
            type: "object",
            description:
                "What to cache into IndexedDB when a profile is downloaded for offline use.",
            properties: {
                enableProfileCache: {
                    type: "boolean",
                    default: true,
                    description: "Cache the profile's GeoJSON layers.",
                },
                enableTileCache: {
                    type: "boolean",
                    default: true,
                    description: "Cache the raster/vector map tiles.",
                },
                maxCacheBytes: {
                    type: "number",
                    // 250 MB — the literal is DUPLICATED from the engine's
                    // DEFAULT_MAX_CACHE_BYTES (core/cache-manager.ts) on purpose: this
                    // declaration is registered at boot, and importing the constant would
                    // drag the whole engine (Downloader, IndexedDB…) into the boot closure
                    // the `loader` exists to keep it out of. The constant is file-local and
                    // not exported for the same reason. `config-schema-coverage.test.js`
                    // asserts the two stay equal.
                    default: 250 * 1024 * 1024,
                    minimum: 0,
                    description:
                        "Byte budget for the IndexedDB layer/tile cache. After each profile " +
                        "download the least-recently-cached records are evicted until the " +
                        "store fits (`geoleaf:cache:evicted`). `0` disables eviction.",
                },
                maxTileCacheEntries: {
                    type: "number",
                    // Miroir du repli `TILE_CACHE_MAX_ENTRIES` de `kernel/storage/sw-core.js`.
                    // Le worker est copié tel quel, sans bundler : il ne peut pas importer
                    // cette valeur, il la re-déclare. `config-schema-coverage.test.js` vérifie
                    // que les deux disent le même nombre — c'est la seule chose qui verrait
                    // les deux diverger.
                    default: 2000,
                    minimum: 0,
                    description:
                        "Entry budget for the Service Worker's OPPORTUNISTIC tile cache " +
                        "(Cache API, `geoleaf-data-tiles`) — the tiles picked up simply by " +
                        "panning the map. Past the ceiling the oldest entries are dropped " +
                        "first; under origin storage pressure the trim gets far more " +
                        "aggressive and surfaces as `geoleaf:cache:evicted`. `0` disables it. " +
                        "⚠️ Counted in ENTRIES, not bytes: the Cache API exposes no per-entry " +
                        "size, and `storage.estimate()` measures the whole origin rather than " +
                        "one store. ⚠️ Distinct from `maxCacheBytes`, which caps IndexedDB — " +
                        "the two budgets add up against the SAME origin quota, and browsers " +
                        "evict by origin, so an unbounded tile cache can cost unsynced field " +
                        "captures. Nothing here can evict an explicitly downloaded zone: that " +
                        "lives in IndexedDB, written by the Downloader, never in this store.",
                },
            },
        },
    },
    // B3: the engine is now in-core. The loader dynamically imports the composition root
    // (`offline-engine-entry.ts`), which wires the assembled engine into `GeoLeaf.Storage`
    // and registers the offline POI restore. Reached only via `ensureLoaded("offline")`
    // (from `OfflineLifecycle`, `shared.module` #8) → stays out of the boot closure.
    loader: () => import("./offline-engine-entry.js").then(() => void 0),
};
