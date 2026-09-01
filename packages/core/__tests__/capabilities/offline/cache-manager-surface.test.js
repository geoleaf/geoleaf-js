/**
 * Unit tests — `CacheManager`'s public surface.
 *
 * `cache-manager.ts` is the offline cache's orchestrator. It measured at
 * **10%** (15/150 lines): the only existing test covers the configuration
 * gate and two `_enforceCacheQuota` no-ops. Everything else — fallback
 * estimation, storage delegations, browser quota, manifest reading — was
 * exercised by nothing.
 *
 * ⚠️ The two mocked dependencies use the **complete by construction** pattern
 * (`...(await importActual())`), not a factory enumerating only what is
 * overridden: a mock omitting an export breaks the day a graph module imports it.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/capabilities/offline/cache/storage.js", async (importActual) => ({
    ...(await importActual()),
    CacheStorage: {
        getManifest: vi.fn(),
        clearCache: vi.fn(),
        saveLayerSelection: vi.fn(),
        loadLayerSelection: vi.fn(),
    },
}));

vi.mock("../../../src/capabilities/offline/cache/downloader.js", async (importActual) => ({
    ...(await importActual()),
    Downloader: {
        init: vi.fn(),
        cancelDownload: vi.fn(),
        isDownloading: vi.fn(() => false),
    },
}));

const { CacheManager } = await import("../../../src/capabilities/offline/cache/cache-manager.js");
const { CacheStorage } = await import("../../../src/capabilities/offline/cache/storage.js");
const { Downloader } = await import("../../../src/capabilities/offline/cache/downloader.js");

const KB = 1024;

beforeEach(() => {
    vi.clearAllMocks();
});

describe("CacheManager._fallbackEstimation — le barème de repli, type par type", () => {
    test("un tableau vide ne coûte rien et ne compte rien", () => {
        const out = CacheManager._fallbackEstimation([]);
        expect(out.totalSize).toBe(0);
        expect(out.resourceCounts.total).toBe(0);
    });

    test.each([
        ["config", 100 * KB],
        ["profile", 100 * KB],
        ["icon", 500 * KB],
        ["layer", 500 * KB],
        ["data", 500 * KB],
        ["tile", 15 * KB],
    ])("un type « %s » est estimé à %i octets", (type, expected) => {
        expect(CacheManager._fallbackEstimation([{ type }]).totalSize).toBe(expected);
    });

    test("un type inconnu retombe sur le forfait de 10 Ko — il n'est pas ignoré", () => {
        expect(CacheManager._fallbackEstimation([{ type: "quelque-chose" }]).totalSize).toBe(
            10 * KB
        );
        expect(CacheManager._fallbackEstimation([{}]).totalSize).toBe(10 * KB);
    });

    test("les tailles s'additionnent et le compte suit le nombre d'entrées", () => {
        const out = CacheManager._fallbackEstimation([
            { type: "config" },
            { type: "icon" },
            { type: "tile" },
        ]);
        expect(out.totalSize).toBe(100 * KB + 500 * KB + 15 * KB);
        expect(out.resourceCounts.total).toBe(3);
    });

    test("`totalSizeFormatted` est bien le formatage de `totalSize`, pas un autre chiffre", () => {
        const out = CacheManager._fallbackEstimation([{ type: "layer" }]);
        expect(out.totalSizeFormatted).toBe(CacheManager._formatBytes(out.totalSize));
        expect(typeof out.totalSizeFormatted).toBe("string");
        expect(out.totalSizeFormatted.length).toBeGreaterThan(0);
    });
});

describe("CacheManager — délégations au téléchargeur", () => {
    test("cancelDownload transmet au Downloader", () => {
        CacheManager.cancelDownload();
        expect(Downloader.cancelDownload).toHaveBeenCalledTimes(1);
    });

    test("isDownloading rend la réponse du Downloader, pas une valeur locale", () => {
        Downloader.isDownloading.mockReturnValue(true);
        expect(CacheManager.isDownloading()).toBe(true);
        Downloader.isDownloading.mockReturnValue(false);
        expect(CacheManager.isDownloading()).toBe(false);
    });
});

describe("CacheManager.clearProfile / clearCache", () => {
    test("clearProfile rend le compte de suppressions du stockage", async () => {
        CacheStorage.clearCache.mockResolvedValue(7);
        await expect(CacheManager.clearProfile("p1")).resolves.toBe(7);
        expect(CacheStorage.clearCache).toHaveBeenCalledWith("p1");
    });

    test("clearCache est un alias de clearProfile — même délégation", async () => {
        CacheStorage.clearCache.mockResolvedValue(3);
        await expect(CacheManager.clearCache("p2")).resolves.toBe(3);
        expect(CacheStorage.clearCache).toHaveBeenCalledWith("p2");
    });

    test("une erreur du stockage est PROPAGÉE, pas avalée", async () => {
        CacheStorage.clearCache.mockRejectedValue(new Error("idb down"));
        await expect(CacheManager.clearProfile("p3")).rejects.toThrow("idb down");
    });
});

describe("CacheManager.isProfileCached", () => {
    test("faux quand il n'y a pas de manifeste", async () => {
        CacheStorage.getManifest.mockResolvedValue(null);
        await expect(CacheManager.isProfileCached("p")).resolves.toBe(false);
    });

    test("faux quand le manifeste existe mais ne compte aucune ressource", async () => {
        CacheStorage.getManifest.mockResolvedValue({ resourcesCount: 0 });
        await expect(CacheManager.isProfileCached("p")).resolves.toBe(false);
    });

    test("vrai dès qu'au moins une ressource est comptée", async () => {
        CacheStorage.getManifest.mockResolvedValue({ resourcesCount: 1 });
        await expect(CacheManager.isProfileCached("p")).resolves.toBe(true);
    });

    test("une erreur vaut « non caché » — la fonction ne jette pas", async () => {
        CacheStorage.getManifest.mockRejectedValue(new Error("boom"));
        await expect(CacheManager.isProfileCached("p")).resolves.toBe(false);
    });
});

describe("CacheManager.getStorageQuota", () => {
    const realStorage = globalThis.navigator?.storage;

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, "storage", {
            value: realStorage,
            configurable: true,
            writable: true,
        });
    });

    /** Installe (ou retire) `navigator.storage.estimate`. */
    function withEstimate(estimate) {
        Object.defineProperty(globalThis.navigator, "storage", {
            value: estimate ? { estimate } : undefined,
            configurable: true,
            writable: true,
        });
    }

    test("sans API `estimate`, rend des zéros au lieu de jeter", async () => {
        withEstimate(null);
        await expect(CacheManager.getStorageQuota()).resolves.toEqual({
            usage: 0,
            quota: 0,
            percentage: 0,
        });
    });

    test("calcule le pourcentage et le disponible", async () => {
        withEstimate(vi.fn().mockResolvedValue({ usage: 250, quota: 1000 }));
        await expect(CacheManager.getStorageQuota()).resolves.toEqual({
            usage: 250,
            quota: 1000,
            percentage: 25,
            available: 750,
        });
    });

    test("un quota nul ne provoque pas de division par zéro", async () => {
        withEstimate(vi.fn().mockResolvedValue({ usage: 0, quota: 0 }));
        const out = await CacheManager.getStorageQuota();
        expect(out.percentage).toBe(0);
    });

    test("une estimation qui échoue retombe sur des zéros", async () => {
        withEstimate(vi.fn().mockRejectedValue(new Error("nope")));
        await expect(CacheManager.getStorageQuota()).resolves.toEqual({
            usage: 0,
            quota: 0,
            percentage: 0,
        });
    });
});

describe("CacheManager.getCacheStatus", () => {
    test("sans manifeste : non caché, tout à zéro", async () => {
        CacheStorage.getManifest.mockResolvedValue(null);
        await expect(CacheManager.getCacheStatus("p")).resolves.toEqual({
            cached: false,
            size: 0,
            resourcesCount: 0,
            resources: [],
            cachedAt: null,
        });
    });

    test("un manifeste à `resources` est rendu tel quel", async () => {
        CacheStorage.getManifest.mockResolvedValue({
            totalSize: 42,
            resources: [{ url: "a" }, { url: "b" }],
            cachedAt: 111,
            version: "v2",
        });
        const out = await CacheManager.getCacheStatus("p");
        expect(out).toMatchObject({
            cached: true,
            size: 42,
            resourcesCount: 2,
            cachedAt: 111,
            version: "v2",
        });
    });

    test("un manifeste hérité à `cached: string[]` est normalisé en objets `{url}`", async () => {
        CacheStorage.getManifest.mockResolvedValue({ cached: ["x", "y", "z"] });
        const out = await CacheManager.getCacheStatus("p");
        expect(out.resources).toEqual([{ url: "x" }, { url: "y" }, { url: "z" }]);
        expect(out.resourcesCount).toBe(3);
    });

    test("une erreur est capturée et son message ressort dans `error`", async () => {
        CacheStorage.getManifest.mockRejectedValue(new Error("lecture impossible"));
        const out = await CacheManager.getCacheStatus("p");
        expect(out.cached).toBe(false);
        expect(out.error).toBe("lecture impossible");
    });
});

describe("CacheManager — sélection de couches", () => {
    test("saveLayerSelection délègue au stockage", async () => {
        CacheStorage.saveLayerSelection.mockResolvedValue(undefined);
        await CacheManager.saveLayerSelection("p", { a: true });
        expect(CacheStorage.saveLayerSelection).toHaveBeenCalledWith("p", { a: true });
    });

    test("un échec d'écriture est PROPAGÉ — perdre une sélection en silence serait pire", async () => {
        CacheStorage.saveLayerSelection.mockRejectedValue(new Error("écriture refusée"));
        await expect(CacheManager.saveLayerSelection("p", {})).rejects.toThrow("écriture refusée");
    });

    test("loadLayerSelection rend la sélection stockée", async () => {
        CacheStorage.loadLayerSelection.mockResolvedValue({ b: false });
        await expect(CacheManager.loadLayerSelection("p")).resolves.toEqual({ b: false });
    });

    test("un échec de LECTURE vaut null — asymétrie volontaire avec l'écriture", async () => {
        CacheStorage.loadLayerSelection.mockRejectedValue(new Error("lecture refusée"));
        await expect(CacheManager.loadLayerSelection("p")).resolves.toBeNull();
    });
});
