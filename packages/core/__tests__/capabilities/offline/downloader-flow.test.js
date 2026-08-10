/**
 * Unit tests — `capabilities/offline/cache/downloader.ts`, le flux de téléchargement (offline).
 *
 * Fichier à 48 % : l'orchestrateur qui télécharge un profil (résolution des déjà-en-cache,
 * estimation, pool de workers, tuiles vs autres, résumé + événement). Délégués mockés
 * (RetryHandler, ProgressTracker, FetchManager, CacheStorage, CacheMetrics) — orchestrateur
 * pur ; RetryHandler.retry exécute le vrai `_downloadResource`, qui stocke via le mock IndexedDB.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

const fetchFn = vi.fn();
const retryFn = vi.fn();
const getCachedUrls = vi.fn();
const getManifest = vi.fn();
const metricsEstimate = vi.fn();
const trackerInit = vi.fn();
const getSummary = vi.fn();
const recordSuccess = vi.fn();
const recordFailure = vi.fn();

vi.mock("../../../src/capabilities/offline/cache/retry-handler.js", () => ({
    RetryHandler: { init: vi.fn(), retry: retryFn },
}));
vi.mock("../../../src/capabilities/offline/cache/progress-tracker.js", () => ({
    ProgressTracker: {
        init: trackerInit,
        getSummary,
        recordSuccess,
        recordFailure,
    },
}));
vi.mock("../../../src/capabilities/offline/cache/fetch-manager.js", () => ({
    FetchManager: { fetch: fetchFn },
}));
vi.mock("../../../src/capabilities/offline/cache/storage.js", () => ({
    CacheStorage: { getCachedUrls, getManifest },
}));
vi.mock("../../../src/capabilities/offline/cache/metrics.js", () => ({
    CacheMetrics: { estimateProfileSize: metricsEstimate },
}));

let Downloader;

beforeEach(async () => {
    globalThis.GeoLeaf = {
        ...(globalThis.GeoLeaf ?? {}),
        Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    ({ Downloader } = await import("../../../src/capabilities/offline/cache/downloader.js"));
    Downloader._config.enableProfileCache = true;
    Downloader._cachingProfiles.clear();
    // resetAllMocks (pas clearAllMocks) : réinitialise aussi les IMPLÉMENTATIONS, sinon un
    // mockImplementation posé dans un test (ex. trackerInit qui jette) fuit vers les suivants.
    vi.resetAllMocks();

    // Défauts sains : RetryHandler.retry exécute le travail ; fetch réussit.
    retryFn.mockImplementation(async (fn) => await fn());
    fetchFn.mockResolvedValue({ skipped: false, size: 100, data: { x: 1 }, metadata: {} });
    getCachedUrls.mockResolvedValue(new Set());
    getManifest.mockResolvedValue(null);
    metricsEstimate.mockResolvedValue({ totalSize: 200 });
    getSummary.mockReturnValue({ successful: 2, failed: 0, successfulDownloads: ["a", "t1"] });
});

afterEach(() => vi.restoreAllMocks());

describe("cacheProfile — flux nominal", () => {
    test("télécharge autres + tuiles, agrège le résumé et émet l'événement", async () => {
        const evt = vi.fn();
        document.addEventListener("geoleaf:cache:completed", evt, { once: true });

        const result = await Downloader.cacheProfile(
            "t",
            {},
            [
                { url: "a", type: "layer" },
                { url: "t1", type: "tile" },
            ],
            {}
        );

        expect(trackerInit).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }));
        // fetch appelé pour chaque ressource (via RetryHandler.retry → _downloadResource)
        expect(fetchFn).toHaveBeenCalledTimes(2);
        expect(recordSuccess).toHaveBeenCalledTimes(2);
        expect(result.cached).toEqual(expect.arrayContaining(["a", "t1"]));
        expect(evt).toHaveBeenCalled();
        expect(Downloader._cachingProfiles.has("t")).toBe(false);
    });

    test("ressources déjà en cache exclues du téléchargement", async () => {
        getCachedUrls.mockResolvedValue(new Set(["a"]));
        await Downloader.cacheProfile("t", {}, [{ url: "a", type: "layer" }], {});
        // « a » est déjà en cache → aucun fetch
        expect(fetchFn).not.toHaveBeenCalled();
    });
});

describe("cacheProfile — gardes et erreurs", () => {
    test("cache profil désactivé → erreur", async () => {
        Downloader._config.enableProfileCache = false;
        expect(await Downloader.cacheProfile("t", {}, [], {})).toEqual({
            error: "Profile cache disabled",
        });
    });

    test("déjà en cours → 'Already caching'", async () => {
        Downloader._cachingProfiles.add("t");
        expect(await Downloader.cacheProfile("t", {}, [], {})).toMatchObject({
            error: "Already caching",
        });
    });

    test("annulation (AbortError sur l'init du tracker) → { cancelled: true }", async () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        trackerInit.mockImplementation(() => {
            throw abort;
        });
        expect(await Downloader.cacheProfile("t", {}, [{ url: "a", type: "layer" }], {})).toEqual({
            cancelled: true,
            profileId: "t",
        });
    });

    test("échec d'une ressource → recordFailure (le worker capture)", async () => {
        retryFn.mockImplementation(() => Promise.reject(new Error("404")));
        await Downloader.cacheProfile("t", {}, [{ url: "a", type: "layer" }], {});
        expect(recordFailure).toHaveBeenCalled();
        expect(recordSuccess).not.toHaveBeenCalled();
    });
});

describe("_downloadResource", () => {
    test("ressource optionnelle absente (skipped) → pas de stockage", async () => {
        fetchFn.mockResolvedValue({ skipped: true });
        await Downloader._downloadResource({ url: "opt", type: "config" }, "t");
        // rien à asserter d'autre : le chemin skipped retourne avant cacheLayer, sans jeter
        expect(fetchFn).toHaveBeenCalled();
    });
});

describe("état du téléchargement", () => {
    test("isDownloading reflète le set de profils en cours", async () => {
        expect(Downloader.isDownloading()).toBe(false);
        Downloader._cachingProfiles.add("t");
        expect(Downloader.isDownloading()).toBe(true);
    });

    test("cancelDownload abandonne le contrôleur courant", () => {
        Downloader._abortController = new AbortController();
        Downloader.cancelDownload();
        expect(Downloader._abortController.signal.aborted).toBe(true);
    });
});
