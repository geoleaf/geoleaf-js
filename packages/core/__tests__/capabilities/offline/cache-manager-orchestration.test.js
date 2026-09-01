/**
 * Unit tests — `capabilities/offline/cache/cache-manager.ts`, the orchestration flow (offline).
 *
 * The existing tests cover the SURFACE (init, gate, getCacheStatus, quota).
 * The hole: the `cacheProfile` flow (enumeration → download → manifest →
 * eviction), `estimateProfileSize` and `_fallbackEstimation`. The delegates
 * are mocked (CacheStorage, ResourceEnumerator, Downloader, CacheMetrics,
 * evictToQuota) — pure orchestrator, no real IndexedDB required.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const enumerateAll = vi.fn();
const downloaderCacheProfile = vi.fn();
const loadProfileConfig = vi.fn();
const saveManifest = vi.fn();
const evictToQuota = vi.fn();
const metricsEstimate = vi.fn();

vi.mock("../../../src/capabilities/offline/cache/resource-enumerator.js", () => ({
    ResourceEnumerator: { enumerateAll },
}));
vi.mock("../../../src/capabilities/offline/cache/downloader.js", () => ({
    Downloader: {
        init: vi.fn(),
        cacheProfile: downloaderCacheProfile,
        cancelDownload: vi.fn(),
        isDownloading: vi.fn(() => false),
    },
}));
vi.mock("../../../src/capabilities/offline/cache/storage.js", () => ({
    CacheStorage: { loadProfileConfig, saveManifest, getManifest: vi.fn() },
}));
vi.mock("../../../src/capabilities/offline/cache/metrics.js", () => ({
    CacheMetrics: { estimateProfileSize: metricsEstimate },
}));
vi.mock("../../../src/capabilities/offline/db/eviction.js", () => ({ evictToQuota }));

let CacheManager;

beforeEach(async () => {
    globalThis.GeoLeaf = {
        ...(globalThis.GeoLeaf ?? {}),
        Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    ({ CacheManager } = await import("../../../src/capabilities/offline/cache/cache-manager.js"));
    // The IndexedDB mock (setup.js redirect) provides a non-stub `_db` by
    // default, so `_enforceCacheQuota` enters its eviction branch with no extra setup.
    CacheManager._config = {
        enableProfileCache: true,
        maxCacheBytes: 250 * 1024 * 1024,
    };
    CacheManager._cachingProfiles.clear();
    vi.clearAllMocks();
});

afterEach(() => vi.restoreAllMocks());

// ── the quota pre-check MOVED HERE ──────────────────────────────────────────────────────
//
// 🛑 THESE TESTS COME FROM `__tests__/storage/storage-facade.test.js`, AND
// THEY ARE NO LONGER THERE. There they exercised
// `Storage.downloadProfileForOffline()` — a DEAD function (zero callers in
// the whole repo) which yet carried the download's ONLY quota pre-check,
// while `cacheProfile()`, the live path, had none. Deleting the shell without
// moving the guard first would have removed a protection believing it removed
// dead code.
//
// The behaviour MOVES, so its tests move with it. Discarding them would have
// left the new guard untested, and leaving them there would have made an
// orphan test.
describe("cacheProfile — le pré-contrôle de quota (déplacé de la façade, 3.13)", () => {
    beforeEach(() => {
        loadProfileConfig.mockResolvedValue({ id: "t" });
        enumerateAll.mockResolvedValue([{ url: "a", type: "config" }]);
        downloaderCacheProfile.mockResolvedValue({ ok: true });
        saveManifest.mockResolvedValue(undefined);
        evictToQuota.mockResolvedValue({ evicted: 0 });
    });

    test("refuse quand l'estimation dépasse le disponible, en CHIFFRANT le manque", async () => {
        vi.spyOn(CacheManager, "estimateProfileSize").mockResolvedValue({
            totalSize: 5 * 1024 * 1024,
            totalSizeFormatted: "5 MB",
        });
        vi.spyOn(CacheManager, "getStorageQuota").mockResolvedValue({
            usage: 0,
            quota: 2 * 1024 * 1024,
            percentage: 0,
            available: 1 * 1024 * 1024,
        });

        await expect(CacheManager.cacheProfile("t")).rejects.toThrow(/Not enough storage/);
        // The guard must bite BEFORE the download: refusing after the fact protects nothing.
        expect(downloaderCacheProfile).not.toHaveBeenCalled();
    });

    test("laisse passer quand le quota suffit", async () => {
        vi.spyOn(CacheManager, "estimateProfileSize").mockResolvedValue({
            totalSize: 1 * 1024 * 1024,
            totalSizeFormatted: "1 MB",
        });
        vi.spyOn(CacheManager, "getStorageQuota").mockResolvedValue({
            usage: 0,
            quota: 10 * 1024 * 1024,
            percentage: 0,
            available: 9 * 1024 * 1024,
        });

        await expect(CacheManager.cacheProfile("t")).resolves.toEqual({ ok: true });
        expect(downloaderCacheProfile).toHaveBeenCalledTimes(1);
    });

    test("un navigateur MUET sur le quota ne fait pas refuser", async () => {
        // `navigator.storage.estimate` absent → `getStorageQuota` returns
        // `available: undefined`. Refusing on that would treat "I don't know"
        // as "it's full", and break the download on any browser not exposing the API.
        vi.spyOn(CacheManager, "estimateProfileSize").mockResolvedValue({
            totalSize: 500 * 1024 * 1024,
            totalSizeFormatted: "500 MB",
        });
        vi.spyOn(CacheManager, "getStorageQuota").mockResolvedValue({
            usage: 0,
            quota: 0,
            percentage: 0,
        });

        await expect(CacheManager.cacheProfile("t")).resolves.toEqual({ ok: true });
    });

    test("le refus libère le verrou de profil — un second essai n'est pas « Already caching »", async () => {
        vi.spyOn(CacheManager, "estimateProfileSize").mockResolvedValue({
            totalSize: 5 * 1024 * 1024,
            totalSizeFormatted: "5 MB",
        });
        vi.spyOn(CacheManager, "getStorageQuota").mockResolvedValue({
            usage: 0,
            quota: 2 * 1024 * 1024,
            percentage: 0,
            available: 1 * 1024 * 1024,
        });

        await expect(CacheManager.cacheProfile("t")).rejects.toThrow(/Not enough storage/);
        const second = await CacheManager.cacheProfile("t").catch((e) => e);

        expect(String(second.message)).toMatch(/Not enough storage/);
    });
});

describe("cancelDownload — l'annulation se DIT (C2, clôture S3c)", () => {
    // 🛑 IT WAS NOT A DEAD LISTENER, IT WAS A MISSING EMITTER. Measured at a
    // sprint closure: `geoleaf:cache:cancelled` had 2 listeners and 0
    // emitters. An earlier preflight had noted the same figure and concluded
    // "the interface listens for nothing" — true on the measure, wrong on the
    // move: `offline-ui`'s listener resets the bar and re-enables the button.
    // Without an emitter, cancelling left the panel stuck on "Stopping…".
    test("émet `geoleaf:cache:cancelled` en plus d'abandonner le téléchargement", () => {
        const seen = [];
        const onCancel = (e) => seen.push(e.type);
        document.addEventListener("geoleaf:cache:cancelled", onCancel);

        CacheManager.cancelDownload();

        document.removeEventListener("geoleaf:cache:cancelled", onCancel);
        expect(seen).toEqual(["geoleaf:cache:cancelled"]);
    });
});

describe("cacheProfile — flux nominal", () => {
    test("énumère, télécharge, sauve le manifeste, applique le quota", async () => {
        loadProfileConfig.mockResolvedValue({ id: "t" });
        enumerateAll.mockResolvedValue([{ url: "a" }, { url: "b" }]);
        downloaderCacheProfile.mockResolvedValue({
            cached: ["a", "b"],
            totalSize: 100,
            duration: 5,
        });
        evictToQuota.mockResolvedValue({ evicted: 0, freedBytes: 0 });

        const result = await CacheManager.cacheProfile("t", { selection: null });

        expect(enumerateAll).toHaveBeenCalled();
        expect(downloaderCacheProfile).toHaveBeenCalled();
        expect(saveManifest).toHaveBeenCalledWith("t", expect.objectContaining({ totalSize: 100 }));
        expect(result.cached).toEqual(["a", "b"]);
        // the profile is removed from the in-progress set (finally)
        expect(CacheManager._cachingProfiles.has("t")).toBe(false);
    });

    test("éviction avec records → émet geoleaf:cache:evicted", async () => {
        loadProfileConfig.mockResolvedValue({ id: "t" });
        enumerateAll.mockResolvedValue([]);
        downloaderCacheProfile.mockResolvedValue({ cached: [], totalSize: 0 });
        evictToQuota.mockResolvedValue({ evicted: 3, freedBytes: 999 });
        const evt = vi.fn();
        document.addEventListener("geoleaf:cache:evicted", evt, { once: true });

        await CacheManager.cacheProfile("t");
        expect(evt).toHaveBeenCalled();
    });
});

describe("cacheProfile — erreurs et gardes", () => {
    test("cache profil désactivé → sort avec une erreur", async () => {
        CacheManager._config.enableProfileCache = false;
        expect(await CacheManager.cacheProfile("t")).toEqual({ error: "Profile cache disabled" });
    });

    test("déjà en cours → erreur 'Already caching'", async () => {
        CacheManager._cachingProfiles.add("t");
        expect(await CacheManager.cacheProfile("t")).toMatchObject({ error: "Already caching" });
    });

    test("config de profil introuvable → jette", async () => {
        loadProfileConfig.mockResolvedValue(null);
        await expect(CacheManager.cacheProfile("t")).rejects.toThrow(/not found/);
    });

    test("erreur de quota du downloader → erreur enrichie isQuotaError", async () => {
        loadProfileConfig.mockResolvedValue({ id: "t" });
        enumerateAll.mockResolvedValue([]);
        const qErr = new Error("QuotaExceededError: disk full");
        downloaderCacheProfile.mockRejectedValue(qErr);

        await expect(CacheManager.cacheProfile("t")).rejects.toMatchObject({
            isQuotaError: true,
            message: "Storage quota exceeded",
        });
    });
});

describe("estimateProfileSize", () => {
    test("délègue à CacheMetrics quand disponible", async () => {
        loadProfileConfig.mockResolvedValue({ id: "t" });
        enumerateAll.mockResolvedValue([{ url: "a" }]);
        metricsEstimate.mockResolvedValue({ totalSize: 512, totalSizeFormatted: "512 Bytes" });

        const est = await CacheManager.estimateProfileSize("t");
        expect(est.totalSize).toBe(512);
    });

    test("profil introuvable → taille 0", async () => {
        loadProfileConfig.mockResolvedValue(null);
        expect(await CacheManager.estimateProfileSize("t")).toMatchObject({ totalSize: 0 });
    });
});

describe("_fallbackEstimation", () => {
    test("somme les tailles par type de ressource", () => {
        const est = CacheManager._fallbackEstimation([
            { type: "config" },
            { type: "icon" },
            { type: "layer" },
            { type: "tile" },
            { type: "autre" },
        ]);
        // 100K + 500K + 500K + 15K + 10K
        expect(est.totalSize).toBe((100 + 500 + 500 + 15 + 10) * 1024);
        expect(est.resourceCounts.total).toBe(5);
    });
});
