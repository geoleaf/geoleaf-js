/**
 * Unit tests — capabilities/offline/lifecycle.ts (S14 Phase B — B3).
 *
 * OfflineLifecycle is a pure, dependency-injected function: `shared.module` passes the
 * live `GeoLeaf.Storage` / `GeoLeaf._OfflineDetector` as deps. B3 behaviour:
 *   - `modules.offline.enabled` ∧ `modules.pwa.enabled` → `CapabilityRegistry.ensureLoaded`
 *     (dynamic import of the engine chunk → the engine-entry wires Storage) THEN `Storage.init`;
 *   - otherwise (offline off / no pwa) → core-mode connectivity badge only.
 *
 * `ensureLoaded` is spied so these stay pure unit tests (no real engine chunk import).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { OfflineLifecycle } = await import("../../../src/capabilities/offline/lifecycle.ts");
const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { StorageContract } = await import("../../../src/kernel/shared/storage-contract.ts");

/** Flush the fire-and-forget `ensureLoaded().then(...)` microtask chain. */
async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

/** Resolves `true` if `p` settles within `ms`, `false` if still pending. */
function settledWithin(p, ms = 20) {
    return Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
}

describe("OfflineLifecycle.init — engine gate (modules.offline.enabled ∧ modules.pwa.enabled)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("ensureLoaded('offline') then Storage.init with the profile-cache default", async () => {
        const ensure = vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const init = vi.fn().mockResolvedValue(true);
        OfflineLifecycle.init(
            { storage: { init } },
            { enabled: true, pwaEnabled: true, offlineDetectorEnabled: false }
        );
        expect(ensure).toHaveBeenCalledWith("offline");
        await flush();
        expect(init).toHaveBeenCalledTimes(1);
        const arg = init.mock.calls[0][0];
        // This used to assert `indexedDB: { name: "geoleaf-db", version: 2 }` — the
        // assertion PINNED the bug: the hardcoded 2 overwrote `StorageDB._dbVersion`
        // (`facade.ts:188`) and would have blocked the v3 migration. See the dedicated
        // test below.
        // ⚠️ `enableTileCache` N'EST PLUS ICI (3.13), et c'est le sujet : le cycle de vie
        // le recopiait en défaut alors que rien dans le core ne le lisait. Son unique
        // lecteur est désormais `ResourceEnumerator._tilesRequested()`, qui interroge la
        // config directement. Le laisser ici en aurait fait une seconde vérité — la forme
        // exacte de la recopie qui a produit la cause racine n° 2.
        expect(arg.cache).toEqual({ enableProfileCache: true });
        expect(arg.enableOfflineDetector).toBe(false);
    });

    it("a cache override reaches Storage.init untouched (spread, not replace)", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const init = vi.fn().mockResolvedValue(true);
        OfflineLifecycle.init(
            { storage: { init } },
            { enabled: true, pwaEnabled: true, cache: { enableProfileCache: false } }
        );
        await flush();
        expect(init.mock.calls[0][0].cache).toEqual({ enableProfileCache: false });
    });

    it("passes enableOfflineDetector through from the pwa toggle", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const init = vi.fn().mockResolvedValue(true);
        OfflineLifecycle.init(
            { storage: { init } },
            { enabled: true, pwaEnabled: true, offlineDetectorEnabled: true }
        );
        await flush();
        expect(init.mock.calls[0][0].enableOfflineDetector).toBe(true);
    });

    it("does NOT init the core-mode detector when the engine is loaded", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const detectorInit = vi.fn();
        OfflineLifecycle.init(
            {
                storage: { init: vi.fn().mockResolvedValue(true) },
                offlineDetector: { init: detectorInit },
            },
            { enabled: true, pwaEnabled: true, offlineDetectorEnabled: true }
        );
        await flush();
        expect(detectorInit).not.toHaveBeenCalled();
    });

    // CAPACITÉS S1 — this pins a schema-versioning trap, not a formatting preference.
    // `Storage.init()` overwrites `StorageDB._dbName`/`._dbVersion` with whatever it is
    // given (`facade.ts:187-188`). This call used to pass `{ name: "geoleaf-db",
    // version: 2 }`, so the hardcoded 2 outranked the schema's own declaration — when
    // `indexedDB.ts` went to v3 for the `uploaded` key migration (B.6), the upgrade would
    // never have run in production, while the unit tests stayed green because they open
    // the database directly. The module must remain the single source of truth.
    it("does not pin an IndexedDB name/version — the schema owns them", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const init = vi.fn().mockResolvedValue(true);
        OfflineLifecycle.init(
            { storage: { init }, offlineDetector: { init: vi.fn() } },
            { enabled: true, pwaEnabled: true, offlineDetectorEnabled: false }
        );
        await flush();
        expect(init).toHaveBeenCalledTimes(1);
        expect(init.mock.calls[0][0]).not.toHaveProperty("indexedDB");
    });

    it("a rejected Storage.init is swallowed (does not throw)", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const init = vi.fn().mockRejectedValue(new Error("boom"));
        expect(() =>
            OfflineLifecycle.init({ storage: { init } }, { enabled: true, pwaEnabled: true })
        ).not.toThrow();
        await new Promise((r) => setTimeout(r, 10));
        expect(init).toHaveBeenCalled();
    });
});

describe("OfflineLifecycle.init — engine OFF (core mode: badge only)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("offline disabled → connectivity badge when the detector is enabled", () => {
        const detectorInit = vi.fn();
        OfflineLifecycle.init(
            { storage: { init: vi.fn() }, offlineDetector: { init: detectorInit } },
            { enabled: false, pwaEnabled: true, offlineDetectorEnabled: true }
        );
        expect(detectorInit).toHaveBeenCalledWith(expect.objectContaining({ showBadge: true }));
    });

    it("pwa disabled → engine NOT loaded (dependency guard); badge if detector enabled", () => {
        const ensure = vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        const storageInit = vi.fn();
        const detectorInit = vi.fn();
        OfflineLifecycle.init(
            { storage: { init: storageInit }, offlineDetector: { init: detectorInit } },
            { enabled: true, pwaEnabled: false, offlineDetectorEnabled: true }
        );
        expect(ensure).not.toHaveBeenCalled();
        expect(storageInit).not.toHaveBeenCalled();
        expect(detectorInit).toHaveBeenCalled();
    });

    it("does nothing when disabled and the detector is off", () => {
        const detectorInit = vi.fn();
        OfflineLifecycle.init(
            { storage: undefined, offlineDetector: { init: detectorInit } },
            { enabled: false, pwaEnabled: false, offlineDetectorEnabled: false }
        );
        expect(detectorInit).not.toHaveBeenCalled();
    });
});

describe("OfflineLifecycle — whenReady signalling (B5)", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        StorageContract._resetReady();
    });

    it("resolves StorageContract.whenReady() after the engine initialises", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        OfflineLifecycle.init(
            { storage: { init: vi.fn().mockResolvedValue(true) } },
            { enabled: true, pwaEnabled: true }
        );
        expect(await settledWithin(StorageContract.whenReady())).toBe(true);
    });

    it("leaves whenReady pending when offline is disabled (UI defers)", async () => {
        OfflineLifecycle.init({ storage: { init: vi.fn() } }, { enabled: false, pwaEnabled: true });
        expect(await settledWithin(StorageContract.whenReady())).toBe(false);
    });

    it("leaves whenReady pending when the pwa dependency is off", async () => {
        vi.spyOn(CapabilityRegistry, "ensureLoaded").mockResolvedValue(undefined);
        OfflineLifecycle.init(
            { storage: { init: vi.fn().mockResolvedValue(true) } },
            { enabled: true, pwaEnabled: false }
        );
        expect(await settledWithin(StorageContract.whenReady())).toBe(false);
    });

    it("_reset() re-arms whenReady to pending", async () => {
        StorageContract._markReady();
        expect(await settledWithin(StorageContract.whenReady())).toBe(true);
        OfflineLifecycle._reset();
        expect(await settledWithin(StorageContract.whenReady())).toBe(false);
    });
});
