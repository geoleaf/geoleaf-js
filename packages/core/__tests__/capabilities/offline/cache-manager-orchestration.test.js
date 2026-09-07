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

// ⚠️ `pull/layer-pull.js` and NOT `cache/pull-declared-layers.js`: the module under test
// here is the WIRING, and mocking the wrapper would leave its selection predicate — the
// half that decides which layers are pulled — exercised by nothing.
const pullLayer = vi.fn();
vi.mock("../../../src/capabilities/offline/pull/layer-pull.js", () => ({ pullLayer }));

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

// ── R9, task 2.3 — the button finally pulls the ENTITIES ────────────────────────────────
//
// 🛑 WHAT THIS DESCRIBE HOLDS IS A CONNECTION, not a behaviour. `pullLayer` was complete,
// tested against a real IndexedDB, and called by NOTHING in the application: the download
// filled the `layers` store and left `features` empty, so a profile declaring
// `offline.source` shipped a progress bar to 100 % and no entities. Every assertion above
// stayed green throughout. Only a test of the wiring can see it.
describe("cacheProfile — le rapatriement des entités déclarées (R9)", () => {
    const layers = [
        { id: "sites_rosario", offline: { enabled: true, source: { url: "https://b.test/ogc" } } },
        { id: "villes_principales", offline: { enabled: true } },
        { id: "fond_statique" },
    ];

    beforeEach(() => {
        loadProfileConfig.mockResolvedValue({ id: "tourism" });
        enumerateAll.mockResolvedValue([{ url: "a", type: "config" }]);
        downloaderCacheProfile.mockResolvedValue({ ok: true });
        saveManifest.mockResolvedValue(undefined);
        evictToQuota.mockResolvedValue({ evicted: 0 });
        vi.spyOn(CacheManager, "estimateProfileSize").mockResolvedValue({
            totalSize: 1,
            totalSizeFormatted: "1 B",
        });
        vi.spyOn(CacheManager, "getStorageQuota").mockResolvedValue({
            usage: 0,
            quota: 10,
            percentage: 0,
            available: 9,
        });
        globalThis.GeoLeaf = {
            ...(globalThis.GeoLeaf ?? {}),
            Config: {
                getActiveProfile: () => ({ layers }),
                get: (key, dflt) => (key === "data.activeProfile" ? "tourism" : dflt),
            },
        };
        pullLayer.mockResolvedValue({
            layerId: "sites_rosario",
            fetched: 12,
            written: 12,
            preserved: 0,
            skipped: 0,
            capped: false,
            aborted: false,
            refused: null,
        });
    });

    test("rapatrie la couche qui déclare une SOURCE, et elle seule", async () => {
        const result = await CacheManager.cacheProfile("tourism");

        // ⚠️ `offline.source` and not `offline.enabled`: `villes_principales` declares the
        // second without the first, and pulling it would only ever produce a
        // `refused: "noSource"` on a profile that is not misconfigured.
        expect(pullLayer).toHaveBeenCalledTimes(1);
        expect(pullLayer).toHaveBeenCalledWith("sites_rosario", {});
        expect(result.pulledLayers).toEqual([
            {
                layerId: "sites_rosario",
                written: 12,
                capped: false,
                aborted: false,
                refused: null,
            },
        ]);
    });

    test("APRÈS les ressources — un rapatriement sans sa configuration ne rend rien", async () => {
        const order = [];
        downloaderCacheProfile.mockImplementation(async () => {
            order.push("resources");
            return { ok: true };
        });
        pullLayer.mockImplementation(async () => {
            order.push("pull");
            return { written: 0, capped: false, aborted: false, refused: null };
        });
        saveManifest.mockImplementation(async () => {
            order.push("manifest");
        });

        await CacheManager.cacheProfile("tourism");

        expect(order).toEqual(["resources", "pull", "manifest"]);
    });

    test("la sélection de l'utilisateur est une LISTE BLANCHE, comme pour les ressources", async () => {
        await CacheManager.cacheProfile("tourism", {
            selection: { layers: ["villes_principales"] },
        });
        expect(pullLayer).not.toHaveBeenCalled();

        await CacheManager.cacheProfile("tourism", { selection: { layers: ["sites_rosario"] } });
        expect(pullLayer).toHaveBeenCalledTimes(1);
    });

    test("une source injoignable NE FAIT PAS échouer le téléchargement", async () => {
        // 🛑 Losing tens of megabytes of tiles because one OGC endpoint answered 503 is a
        // worse outcome than the partial state it would be protecting from. The refusal
        // is reported, never raised.
        pullLayer.mockResolvedValue({
            written: 0,
            capped: false,
            aborted: false,
            refused: "sourceUnreachable",
        });

        const result = await CacheManager.cacheProfile("tourism");

        expect(result.error).toBeUndefined();
        expect(result.pulledLayers[0].refused).toBe("sourceUnreachable");
        expect(saveManifest).toHaveBeenCalledTimes(1);
    });

    test("un profil qui n'est PAS le profil actif ne rapatrie rien", async () => {
        // `pullLayer` resolves its layers through the ACTIVE profile, while `cacheProfile`
        // takes an id. Pulling here would write the active profile's entities under
        // another profile's name — right-looking marker, wrong store.
        const result = await CacheManager.cacheProfile("autre_profil");

        expect(pullLayer).not.toHaveBeenCalled();
        expect(result.pulledLayers).toBeUndefined();
    });

    test("un profil sans aucune source ne pose PAS de compte vide", async () => {
        globalThis.GeoLeaf.Config.getActiveProfile = () => ({ layers: [{ id: "fond_statique" }] });

        const result = await CacheManager.cacheProfile("tourism");

        // Absent, not `[]`: "this profile pulls no entities" and "the pull ran and wrote
        // nothing" are opposite situations, and one field must not say both.
        expect("pulledLayers" in result).toBe(false);
    });
});
