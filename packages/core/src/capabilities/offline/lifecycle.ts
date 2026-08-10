/*!
 * GeoLeaf Core (offline capability) — Lifecycle / boot wiring
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Lifecycle for the in-core `offline` capability (S14 Phase B).
 *
 * Called once (post-merge) by `shared.module` #8. When the offline engine is enabled
 * (`modules.offline.enabled`) AND its `pwa` dependency is on (`modules.pwa.enabled`),
 * it loads the engine on demand via `CapabilityRegistry.ensureLoaded("offline")` — a
 * dynamic `import()` of the engine chunk whose composition root wires `GeoLeaf.Storage`
 * — then calls `Storage.init(...)`. Otherwise (offline off) it starts just the
 * connectivity badge, gated on the PWA `offlineDetector` toggle.
 *
 * ⚠️ The `offline → pwa` dependency is NOT auto-enforced by `CapabilityRegistry`
 * (introspection metadata only) — it is guarded explicitly here.
 */
"use strict";

import { Log } from "../../utils/log/index.js";
import { CapabilityRegistry } from "../../kernel/api/index.js";
import { StorageContract } from "../../kernel/shared/index.js";
import { parseDataOrigins, publishDataOrigins } from "./data-origins.js";
import { parseTileCacheBudget, publishTileCacheBudget } from "./tile-budget.js";

/** The storage façade surface `OfflineLifecycle` drives (mounted on `GeoLeaf.Storage`). */
interface StorageFacadeLike {
    /** Truthy once the engine has been wired via `Storage.wireModules`. */
    DB?: unknown;
    init(options: {
        indexedDB?: { name?: string; version?: number };
        cache?: Record<string, unknown>;
        offline?: Record<string, unknown>;
        enableOfflineDetector?: boolean;
    }): Promise<unknown> | unknown;
}

/** Connectivity badge surface (`GeoLeaf._OfflineDetector`). */
interface OfflineDetectorLike {
    init(opts: Record<string, unknown>): void;
    /** Detaches the `window` online/offline listeners, timer and badge. */
    destroy?(): void;
}

/**
 * The detector handed to the last `init()`, kept so `_reset()` can release the two
 * `window` listeners it owns.
 *
 * Module-local rather than read off `GeoLeaf` at teardown time: `OfflineLifecycle` is
 * deliberately a pure dependency-injected object (see `OfflineLifecycleDeps`), and a
 * global accessor here would be the one place breaking that.
 */
let _detector: OfflineDetectorLike | undefined;

/**
 * Runtime deps injected by `shared.module` (read off the live `GeoLeaf` global there).
 * Passed as `unknown` at the boundary and narrowed internally — keeps `OfflineLifecycle`
 * a pure, unit-testable function with no global-accessor coupling.
 */
interface OfflineLifecycleDeps {
    /** The `GeoLeaf.Storage` façade. */
    storage?: unknown;
    /** The `GeoLeaf._OfflineDetector` connectivity badge. */
    offlineDetector?: unknown;
}

/** Config subset `OfflineLifecycle` acts on (passed post-merge by `shared.module`). */
interface OfflineLifecycleConfig {
    /** `modules.offline.enabled` (post-merge) — master opt-in gate for the engine. */
    enabled?: boolean;
    /** `modules.pwa.enabled` — the `offline → pwa` dependency, guarded manually here. */
    pwaEnabled?: boolean;
    /** `modules.offline.cache` — what to cache into IndexedDB on profile download. */
    cache?: Record<string, unknown>;
    /** `modules.pwa.offlineDetector.enabled` — the connectivity badge toggle. */
    offlineDetectorEnabled?: boolean;
    /**
     * `modules.offline.dataOrigins` — the origins the profile declares (tâche 3.9).
     *
     * Typed `unknown` on purpose: it comes straight from a JSON profile, and
     * `parseDataOrigins` is the ONE place allowed to decide what a valid declaration is.
     * Typing it here would duplicate that decision, and the duplicate would drift.
     */
    dataOrigins?: unknown;
}

/** Lifecycle for the offline capability (engine init / core-mode detector). */
export const OfflineLifecycle = {
    init(deps: OfflineLifecycleDeps, cfg: OfflineLifecycleConfig): void {
        const storage = deps.storage as StorageFacadeLike | undefined;

        // Remember the detector BEFORE the branch: in engine mode this function returns
        // early and never touches it (the façade starts it through
        // `enableOfflineDetector`), yet teardown must still be able to release it.
        // Purely synchronous — it does not move the `ensureLoaded`-before-first-await
        // ordering below, which is a pinned invariant.
        _detector = deps.offlineDetector as OfflineDetectorLike | undefined;

        // Offline engine (B3): opt-in gate, guarded by the `pwa` dependency (NOT auto-
        // enforced by CapabilityRegistry). `ensureLoaded` dynamically imports the engine
        // chunk — the engine-entry wires `Storage` — then we initialise it. Fire-and-forget
        // ordered chain (this runs inside the synchronous `shared.module` #8 step).
        if (cfg.enabled === true && cfg.pwaEnabled === true && storage) {
            void CapabilityRegistry.ensureLoaded("offline")
                .then(() => {
                    const result = storage.init({
                        // ⚠️ No `indexedDB` option on purpose. `Storage.init()` overwrites
                        // `StorageDB._dbName` / `._dbVersion` with whatever is passed
                        // (`facade.ts:187-188`), so pinning them here duplicated the
                        // schema's source of truth — and silently outranked it. It read
                        // `version: 2` while `indexedDB.ts` declared 3, which would have
                        // kept the v3 migration from ever running in production even
                        // though its tests passed (they open the database directly).
                        // The module owns its own name and version; let it.
                        cache: {
                            enableProfileCache: true,
                            // ⚠️ `enableTileCache` N'EST PLUS RECOPIÉ ICI (3.13). Il était
                            // écrit à quatre endroits du core et lu à aucun ; son seul
                            // lecteur est désormais `_tilesRequested()` de
                            // `resource-enumerator.ts`, qui interroge la config directement.
                            // Le poser en défaut ici en aurait fait une seconde vérité, et
                            // c'est ce genre de recopie qui a produit la cause racine n° 2.
                            ...(cfg.cache ?? {}),
                        },
                        offline: {},
                        enableOfflineDetector: cfg.offlineDetectorEnabled === true,
                    });
                    const thenable = result as
                        | { then?(ok: () => void): { catch?(err: (e: unknown) => void): void } }
                        | undefined;
                    thenable
                        ?.then?.(() => {
                            // Engine loaded AND IndexedDB open → unblock the deferring UI.
                            StorageContract._markReady();
                            Log.info("[Offline] Storage engine initialized");

                            // 🛑 PUBLIER LES ORIGINES DÉCLARÉES (tâche 3.9), et ICI parce que
                            // c'est le premier instant où la base est ouverte — donc le
                            // premier où le store `preferences` est écrivable.
                            //
                            // Le Service Worker les relit depuis IndexedDB, et pas d'un
                            // message : un message meurt avec le worker, or le navigateur le
                            // redémarre quand il veut — typiquement quand un appareil de
                            // terrain se réveille hors réseau, c'est-à-dire au pire moment.
                            void publishDataOrigins(
                                (storage as { DB?: Parameters<typeof publishDataOrigins>[0] }).DB,
                                parseDataOrigins(cfg.dataOrigins)
                            );

                            // Même canal, même instant, même motif : le plafond du cache de
                            // tuiles OPPORTUNISTE du worker (tâche 1.2). Il ne peut pas non
                            // plus être importé par `sw-core.js`, et il protège d'une perte de
                            // données — un cache non borné peut faire évincer l'origine, donc
                            // `outbox` et `features` avec.
                            void publishTileCacheBudget(
                                (storage as { DB?: Parameters<typeof publishTileCacheBudget>[0] })
                                    .DB,
                                parseTileCacheBudget(cfg.cache?.maxTileCacheEntries)
                            );
                        })
                        ?.catch?.((err: unknown) =>
                            Log.warn("[Offline] Storage init failed:", err)
                        );
                })
                .catch((err: unknown) => Log.warn("[Offline] engine load failed:", err));
            return;
        }

        // Core-only mode (offline disabled / no pwa): connectivity badge only.
        if (cfg.offlineDetectorEnabled === true) {
            _detector?.init({ showBadge: true, badgePosition: "topleft", checkInterval: 30000 });
            Log.info("[Offline] Offline detector initialized (core mode).");
        }
    },

    /**
     * Registry destroy / test seam (`install.ts` → `sharedTeardown`). Re-arms the
     * readiness deferred so a re-boot starts pending, AND tears the connectivity
     * detector down.
     *
     * ⚠️ That second half used to be delegated, in a comment, to `Storage.close()` —
     * which has zero production callers in `core/src`. The two `window` online/offline
     * listeners `OfflineDetector.init` attaches were therefore never released by a
     * teardown, and a torn-down capability kept reacting to connectivity changes. It
     * did not ACCUMULATE (a re-`init()` self-heals, `offline-detector.ts:145-148`); it
     * simply never let go. Pinned by
     * `__tests__/capabilities/offline/lifecycle-detector-teardown.test.js`.
     *
     * Engine teardown proper (closing IndexedDB) remains `Storage.close()`'s business.
     */
    _reset(): void {
        StorageContract._resetReady();
        _detector?.destroy?.();
        _detector = undefined;
    },
};
