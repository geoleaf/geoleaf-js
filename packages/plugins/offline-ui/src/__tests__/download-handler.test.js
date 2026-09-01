/**
 * Unit tests — `cache/download-handler.ts`, real coverage.
 *
 * File measured at 0%: the orchestrator of downloading and cache purging,
 * entirely drivable without a map — `ensureEngineReady`, `coreConfigGet`, the
 * `StorageContract` singleton, notifications (`GeoLeaf._UINotifications`) and
 * `confirmDialog` (field-renderer mock) are all controllable. We exercise the
 * two big flows (`handleDownload`, `handleClear`) and the helpers
 * (`_checkQuota`, `_updateProgressUI`, `_formatDownloadError`,
 * `_loadSelection`). `setTimeout`s are driven with a fake clock.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { DownloadHandler } from "../cache/download-handler.js";
import { StorageContract } from "../shared/storage-contract.js";
import { confirmDialog } from "@geoleaf/host-runtime";

// The tests plant `GeoLeaf.Storage` the way PRODUCTION does. They used to drive
// `StorageContract.init()`, i.e. a SECOND instance of the singleton the bundle
// embedded and nothing initialised: they validated a dead channel.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // The helper reproduces what `StorageContract.init()` provided, because the
    // core's facade provides it too: `isPluginLoaded()` = "an engine registered",
    // and `isAvailable()` = "and its database is open". The plugin's adapter
    // DELEGATES these two methods — it does not recompute them — so a planted
    // object not carrying them would return `false` where the test expects
    // `true`. A caller providing them keeps the hand.
    globalThis.GeoLeaf.Storage =
        api === null || api === undefined
            ? null
            : {
                  isPluginLoaded: () => true,
                  isAvailable: () => !!api.DB,
                  ...api,
              };
    return api;
}

// ── Config (coreConfigGet lit globalThis.GeoLeaf.Config.get) ────────────────────────
function setConfig(overrides = {}) {
    const cfg = {
        "data.activeProfile": "prof-1",
        "modules.offline.enabled": true,
        "modules.pwa.enabled": true,
        ...overrides,
    };
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Config = { get: (k, fb) => (k in cfg ? cfg[k] : fb) };
}

// ── Injected notifications ──────────────────────────────────────────────────────────
let notif;
function installNotifications() {
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    globalThis.GeoLeaf._UINotifications = notif;
    return notif;
}

// ── Injected storage (ensureEngineReady reads StorageContract.isAvailable) ───────────
function installStorage({
    available = true,
    selection = { totalEstimatedSize: 1_048_576 },
    cacheProfileResult = { resourcesCount: 5, totalSize: 2_097_152 },
    onProgressTick = { percentage: 50, current: 1, total: 2 },
} = {}) {
    const cacheProfile = vi.fn(async (_id, opts) => {
        if (onProgressTick) opts?.onProgress?.(onProgressTick);
        return cacheProfileResult;
    });
    const clearCache = vi.fn(async () => 7);
    const refreshCacheIcons = vi.fn(async () => {});
    const loadLayerSelection = vi.fn(async () => selection);

    const storage = {
        isAvailable: () => available,
        CacheManager: { cacheProfile, clearCache },
        Cache: {
            Storage: { loadLayerSelection },
            LayerSelector: { refreshCacheIcons },
        },
    };
    _installGeoLeafStorage(storage);
    return { storage, cacheProfile, clearCache, refreshCacheIcons, loadLayerSelection };
}

// ── The handler's DOM elements ──────────────────────────────────────────────────────
function buildElements() {
    const btn = (label) => {
        const b = document.createElement("button");
        const span = document.createElement("span");
        span.className = "gl-btn__text";
        span.textContent = label;
        b.appendChild(span);
        return b;
    };
    return {
        progressEl: document.createElement("div"),
        progressFill: document.createElement("div"),
        progressText: document.createElement("div"),
        downloadBtn: btn("Télécharger"),
        clearBtn: btn("Vider"),
    };
}

let control;
let elements;

beforeEach(() => {
    setConfig();
    installNotifications();
    control = { _updateStatus: vi.fn(async () => {}) };
    elements = buildElements();
    DownloadHandler.init(control, elements);
    // confirmDialog is a module mock (singleton): reset calls + impl.
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════
// handleDownload
// ════════════════════════════════════════════════════════════════════════════════════

describe("handleDownload", () => {
    test("flux nominal : télécharge, met à jour la barre, notifie, rafraîchit les icônes", async () => {
        const store = installStorage();
        vi.useFakeTimers();

        const p = DownloadHandler.handleDownload();
        await vi.runAllTimersAsync();
        await p;

        expect(store.cacheProfile).toHaveBeenCalledWith("prof-1", expect.any(Object));
        // progressText keeps the resource count (the 3 s cleanup does not touch it)
        expect(elements.progressText.textContent).toContain("5");
        // the deferred cleanup hid the bar
        expect(elements.progressEl.style.display).toBe("none");
        expect(notif.success).toHaveBeenCalled();
        expect(control._updateStatus).toHaveBeenCalled();
        expect(store.refreshCacheIcons).toHaveBeenCalled();
        // the button is re-enabled in the finally
        expect(elements.downloadBtn.disabled).toBe(false);
    });

    test("moteur indisponible → notifie et sort sans télécharger", async () => {
        const store = installStorage({ available: false });
        setConfig({ "modules.offline.enabled": false });

        await DownloadHandler.handleDownload();

        expect(store.cacheProfile).not.toHaveBeenCalled();
        expect(notif.error).toHaveBeenCalled();
    });

    test("sans profil actif → notifie et sort", async () => {
        const store = installStorage();
        setConfig({ "data.activeProfile": "" });

        await DownloadHandler.handleDownload();

        expect(store.cacheProfile).not.toHaveBeenCalled();
        expect(notif.error).toHaveBeenCalled();
    });

    test("quota insuffisant → abandonne avant de télécharger", async () => {
        const store = installStorage({ selection: { totalEstimatedSize: 5_000_000_000 } });
        navigator.storage = {
            estimate: vi.fn(async () => ({ quota: 1_000_000_000, usage: 0 })),
        };

        await DownloadHandler.handleDownload();

        expect(store.cacheProfile).not.toHaveBeenCalled();
        expect(notif.error).toHaveBeenCalled();
        delete navigator.storage;
    });

    test("échec du téléchargement → message d'erreur et bouton réactivé", async () => {
        installStorage();
        StorageContract.CacheManager.cacheProfile = vi.fn(async () => {
            throw new Error("réseau coupé");
        });
        vi.useFakeTimers();

        const p = DownloadHandler.handleDownload();
        await vi.runAllTimersAsync();
        await p;

        expect(elements.progressText.textContent).toContain("réseau coupé");
        expect(notif.error).toHaveBeenCalled();
        expect(elements.downloadBtn.disabled).toBe(false);
    });

    test("résultat sans resourcesCount → repli sur total puis cached.length", async () => {
        const store = installStorage({ cacheProfileResult: { total: 3, totalSize: 0 } });
        vi.useFakeTimers();
        const p = DownloadHandler.handleDownload();
        await vi.runAllTimersAsync();
        await p;
        expect(store.cacheProfile).toHaveBeenCalled();
        expect(elements.progressText.textContent).toContain("3");
    });

    test("chemins alternatifs : résultat vide, contrôle sans _updateStatus, sans LayerSelector, bouton sans libellé", async () => {
        const cacheProfile = vi.fn(async () => ({})); // ni resourcesCount ni total ni cached → 0
        _installGeoLeafStorage({
            isAvailable: () => true,
            CacheManager: { cacheProfile, clearCache: vi.fn() },
            // no Cache.LayerSelector → `if (layerSelector)` false
            Cache: {
                Storage: { loadLayerSelection: vi.fn(async () => ({ totalEstimatedSize: 1 })) },
            },
        });
        const bareBtn = () => document.createElement("button"); // sans .gl-btn__text
        DownloadHandler.init(
            {}, // contrôle sans _updateStatus → `if (this._control && this._control._updateStatus)` faux
            {
                progressEl: document.createElement("div"),
                progressFill: document.createElement("div"),
                progressText: document.createElement("div"),
                downloadBtn: bareBtn(),
                clearBtn: bareBtn(),
            }
        );
        vi.useFakeTimers();
        const p = DownloadHandler.handleDownload();
        await vi.runAllTimersAsync();
        await p;
        expect(cacheProfile).toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// handleClear
// ════════════════════════════════════════════════════════════════════════════════════

describe("handleClear", () => {
    test("flux nominal : confirme, purge, notifie, rafraîchit", async () => {
        const store = installStorage();
        confirmDialog.mockResolvedValueOnce(true);
        vi.useFakeTimers();

        const p = DownloadHandler.handleClear();
        await vi.runAllTimersAsync();
        await p;

        expect(store.clearCache).toHaveBeenCalledWith("prof-1");
        expect(notif.success).toHaveBeenCalled();
        expect(control._updateStatus).toHaveBeenCalled();
        expect(store.refreshCacheIcons).toHaveBeenCalled();
    });

    test("confirmation refusée → ne purge pas", async () => {
        const store = installStorage();
        confirmDialog.mockResolvedValueOnce(false);

        await DownloadHandler.handleClear();

        expect(store.clearCache).not.toHaveBeenCalled();
    });

    test("moteur indisponible → sort sans confirmer", async () => {
        const store = installStorage({ available: false });
        setConfig({ "modules.pwa.enabled": false });

        await DownloadHandler.handleClear();

        expect(confirmDialog).not.toHaveBeenCalled();
        expect(store.clearCache).not.toHaveBeenCalled();
    });

    test("sans profil actif → sort", async () => {
        const store = installStorage();
        setConfig({ "data.activeProfile": "" });

        await DownloadHandler.handleClear();

        expect(store.clearCache).not.toHaveBeenCalled();
    });

    test("échec de la purge → notifie l'erreur", async () => {
        installStorage();
        StorageContract.CacheManager.clearCache = vi.fn(async () => {
            throw new Error("verrou DB");
        });
        confirmDialog.mockResolvedValueOnce(true);
        vi.useFakeTimers();

        const p = DownloadHandler.handleClear();
        await vi.runAllTimersAsync();
        await p;

        expect(notif.error).toHaveBeenCalledWith(expect.stringContaining("verrou DB"), 5000);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// Private helpers
// ════════════════════════════════════════════════════════════════════════════════════

describe("_checkQuota", () => {
    afterEach(() => delete navigator.storage);

    test("pas d'API quota → true (on tente)", async () => {
        delete navigator.storage;
        expect(await DownloadHandler._checkQuota(1_000_000)).toBe(true);
    });

    test("espace suffisant → true", async () => {
        navigator.storage = {
            estimate: vi.fn(async () => ({ quota: 10_000_000, usage: 0 })),
        };
        expect(await DownloadHandler._checkQuota(1_000_000)).toBe(true);
    });

    test("espace insuffisant → false + notifie", async () => {
        navigator.storage = {
            estimate: vi.fn(async () => ({ quota: 1_000, usage: 500 })),
        };
        expect(await DownloadHandler._checkQuota(1_000_000)).toBe(false);
        expect(notif.error).toHaveBeenCalled();
    });

    test("estimate qui jette → true (quota illisible n'est pas un refus)", async () => {
        navigator.storage = {
            estimate: vi.fn(async () => {
                throw new Error("denied");
            }),
        };
        expect(await DownloadHandler._checkQuota(1_000_000)).toBe(true);
    });
});

describe("_updateProgressUI", () => {
    test("avec taille téléchargée → libellé détaillé MB", () => {
        const els = buildElements();
        DownloadHandler.init(control, els);
        DownloadHandler._updateProgressUI({
            percentage: 42,
            current: 2,
            total: 4,
            downloadedSize: 1_048_576,
            estimatedTotalSize: 4_194_304,
        });
        expect(els.progressFill.style.width).toBe("42%");
        expect(els.progressText.textContent).toContain("MB");
        expect(els.progressText.textContent).toContain("42%");
    });

    test("sans taille téléchargée → libellé en ressources", () => {
        const els = buildElements();
        DownloadHandler.init(control, els);
        DownloadHandler._updateProgressUI({ percentage: 10, current: 1, total: 5 });
        expect(els.progressText.textContent).toContain("1/5");
    });

    test("références nulles → gardes false, aucune écriture, pas de crash", () => {
        DownloadHandler.init(control, buildElements());
        DownloadHandler._progressFill = null;
        DownloadHandler._progressText = null;
        expect(() => DownloadHandler._updateProgressUI({ percentage: 0 })).not.toThrow();
    });

    test("progress sans champ percentage → repli sur 0", () => {
        const els = buildElements();
        DownloadHandler.init(control, els);
        DownloadHandler._updateProgressUI({ current: 2, total: 3 });
        expect(els.progressFill.style.width).toBe("0%");
    });
});

describe("_formatDownloadError", () => {
    test("dépassement de pile → message 'trop volumineux'", () => {
        const msg = DownloadHandler._formatDownloadError(
            new Error("Maximum call stack size exceeded")
        );
        expect(msg).toBe("storage.download.err.tooLarge");
    });

    test("mémoire épuisée → message dédié", () => {
        const msg = DownloadHandler._formatDownloadError(new Error("Out of memory"));
        expect(msg).toBe("storage.download.err.outOfMemory");
    });

    test("erreur générique → son message", () => {
        expect(DownloadHandler._formatDownloadError(new Error("boom"))).toBe("boom");
    });

    test("valeur sans message → String(error)", () => {
        expect(DownloadHandler._formatDownloadError("oops")).toBe("oops");
    });
});

describe("_loadSelection", () => {
    test("Storage présent → rend la sélection", async () => {
        const store = installStorage({ selection: { totalEstimatedSize: 42 } });
        const sel = await DownloadHandler._loadSelection("prof-1");
        expect(sel).toEqual({ totalEstimatedSize: 42 });
        expect(store.loadLayerSelection).toHaveBeenCalledWith("prof-1");
    });

    test("Storage absent → null", async () => {
        _installGeoLeafStorage({ isAvailable: () => true, Cache: null, CacheManager: {} });
        expect(await DownloadHandler._loadSelection("prof-1")).toBeNull();
    });

    test("loadLayerSelection qui jette → null", async () => {
        _installGeoLeafStorage({
            isAvailable: () => true,
            Cache: {
                Storage: {
                    loadLayerSelection: vi.fn(async () => {
                        throw new Error("DB");
                    }),
                },
            },
            CacheManager: {},
        });
        expect(await DownloadHandler._loadSelection("prof-1")).toBeNull();
    });
});
