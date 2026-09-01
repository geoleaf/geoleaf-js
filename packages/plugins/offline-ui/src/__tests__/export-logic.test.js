/**
 * Unit tests — `ui/cache-button/export-logic.ts`, real coverage.
 *
 * File measured at 54%: the modal's EXPORT/SYNC logic (Export tab). Drivable
 * without a map — the POI queue comes from
 * `StorageContract.DB.getPendingSyncQueue()`, export goes through
 * `URL.createObjectURL`/`navigator.clipboard`, notifications and `confirmDialog`
 * are mocked. We exercise `initializeExportContent` (counts > 0 and = 0),
 * `getPendingPOIs` (filters + error), the JSON export, clipboard copy and the
 * local purge.
 *
 * ⚠️ `initializeCacheContent`'s real creation of the `CacheControl` is NOT
 * reachable: `../../cache/cache-control.js` is stubbed (empty-module) by the
 * cross-plugin alias, so `CacheControl` is `undefined` — only its guards are
 * covered.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { ExportLogic } from "../ui/cache-button/export-logic.js";
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

function setConfig() {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Config = { get: (_k, fb) => fb };
    // POI seam absent → SyncManager.mount renders "unavailable" without error
    globalThis.GeoLeaf.Sync = { getHandler: () => undefined };
}

let notif;
function installNotifications() {
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    globalThis.GeoLeaf._UINotifications = notif;
}

// 🛑 THE HARNESS FOLLOWS ITS SUBJECT, WHICH MOVED. It used to feed `sync_queue`
// with `add_poi`/`update_poi` envelopes; nobody writes those any more, and the
// panel reads the outbox via `listPendingEdits()` and purges the cache via
// `purgeCachedFeatures()`. The tests are thus not deleted — they are re-pointed
// at the real stores.
function installStorage({ available = true, pending = [], cached = 0, purge } = {}) {
    const listPendingEdits = vi.fn(async () => pending);
    const purgeCachedFeatures = vi.fn(async () => purge ?? { removed: cached, preserved: 0 });
    const getBackups = vi.fn(async () => []);
    const getStats = vi.fn(async () => ({
        features: { count: cached },
        outbox: { count: pending.length },
    }));
    _installGeoLeafStorage({
        isAvailable: () => available,
        getStats,
        DB: { listPendingEdits, purgeCachedFeatures, getBackups },
    });
    return { listPendingEdits, purgeCachedFeatures, getStats };
}

/** A capture still owed to the server, in the shape `listPendingEdits()` returns. */
function edit(localId, overrides = {}) {
    return {
        entryId: `e-${localId}`,
        kind: "create",
        layerId: "sites",
        localId,
        state: "pending",
        createdAt: 1,
        feature: {
            type: "Feature",
            geometry: { type: "Point", coordinates: [1, 2] },
            properties: { name: localId },
        },
        ...overrides,
    };
}

function modalBody() {
    const body = document.createElement("div");
    body.id = "gl-cache-modal-body";
    document.body.appendChild(body);
    return body;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    setConfig();
    installNotifications();
    installStorage();
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
    document.getElementById("gl-cache-modal-body")?.remove();
    document.querySelectorAll(".gl-cache-sync").forEach((n) => n.remove());
    vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════
// initializeExportContent
// ════════════════════════════════════════════════════════════════════════════════════

describe("initializeExportContent", () => {
    test("sans corps de modal → ne fait rien", () => {
        expect(() => ExportLogic.initializeExportContent()).not.toThrow();
    });

    test("POI en attente > 0 → stats + boutons d'action", async () => {
        const body = modalBody();
        installStorage({ available: true, pending: [edit("a"), edit("b")] });

        ExportLogic.initializeExportContent();
        await flush();

        expect(body.querySelector(".gl-cache-export")).toBeTruthy();
        expect(body.querySelector(".gl-cache-export__stats-count").textContent).toBe("2");
        expect(body.querySelectorAll(".gl-cache-export__actions button").length).toBe(3);
        // the sync section (SyncManager) is mounted
        expect(body.querySelector(".gl-cache-sync")).toBeTruthy();
    });

    test("aucun POI → état vide", async () => {
        const body = modalBody();
        installStorage({ available: false }); // moteur non prêt → getPendingPOIs = []

        ExportLogic.initializeExportContent();
        await flush();

        expect(body.querySelector(".gl-cache-export__empty")).toBeTruthy();
        expect(body.querySelector(".gl-cache-export__stats-count").textContent).toBe("0");
    });

    test("le bouton « télécharger JSON » déclenche l'export", async () => {
        const body = modalBody();
        installStorage({ available: true, pending: [edit("a")] });
        ExportLogic.initializeExportContent();
        await flush();

        body.querySelector(".gl-cache-export__btn--primary").click();
        expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
        expect(notif.success).toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// getPendingPOIs
// ════════════════════════════════════════════════════════════════════════════════════

describe("getPendingPOIs", () => {
    test("moteur non prêt → liste vide", async () => {
        installStorage({ available: false });
        expect(await ExportLogic.getPendingPOIs()).toEqual([]);
    });

    test("mappe les attributs de l'entité et son enveloppe de synchronisation", async () => {
        // ⚠️ FILTERING CHANGED OWNER, and this test's title used to say so. It
        // verified "filters by type and status" — two exclusions the plugin did
        // itself on `sync_queue`. The core now returns only what is really owed
        // (`listPendingEdits`), so there is nothing left to exclude here: what
        // remains to prove is the PROJECTION, and that is what the test now
        // says.
        installStorage({
            available: true,
            pending: [edit("a"), edit("b", { kind: "update", state: "failed" })],
        });
        const pois = await ExportLogic.getPendingPOIs();
        expect(pois.map((p) => p.name)).toEqual(["a", "b"]);
        expect(pois[0]._syncOperation).toBe("create");
        expect(pois[0]._syncQueueId).toBe("e-a");
        // A failure stays OWED: `failed` is not terminal, and a safety-net export
        // dropping the failures would miss its target.
        expect(pois[1]._syncStatus).toBe("failed");
    });

    test("listPendingEdits qui jette → liste vide", async () => {
        _installGeoLeafStorage({
            isAvailable: () => true,
            DB: {
                listPendingEdits: vi.fn(async () => {
                    throw new Error("DB");
                }),
            },
        });
        expect(await ExportLogic.getPendingPOIs()).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// exportPOIsAsJSON / copyPOIsToClipboard
// ════════════════════════════════════════════════════════════════════════════════════

describe("exportPOIsAsJSON", () => {
    test("succès → crée un blob, clique le lien, notifie", () => {
        ExportLogic.exportPOIsAsJSON([{ id: 1 }]);
        expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
        expect(notif.success).toHaveBeenCalled();
    });

    test("échec (createObjectURL jette) → notifie l'erreur", () => {
        globalThis.URL.createObjectURL = vi.fn(() => {
            throw new Error("blob KO");
        });
        ExportLogic.exportPOIsAsJSON([{ id: 1 }]);
        expect(notif.error).toHaveBeenCalled();
    });
});

describe("copyPOIsToClipboard", () => {
    test("succès → écrit dans le presse-papier, notifie", async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        await ExportLogic.copyPOIsToClipboard([{ id: 1 }]);
        expect(writeText).toHaveBeenCalled();
        expect(notif.success).toHaveBeenCalled();
    });

    test("échec (writeText rejette) → notifie l'erreur", async () => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: vi.fn(async () => {
                    throw new Error("denied");
                }),
            },
        });
        await ExportLogic.copyPOIsToClipboard([{ id: 1 }]);
        expect(notif.error).toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// clearLocalPOIs
// ════════════════════════════════════════════════════════════════════════════════════

describe("clearLocalPOIs", () => {
    test("confirmé → purge le CACHE et notifie le décompte", async () => {
        const body = modalBody();
        const store = installStorage({
            available: true,
            pending: [edit("terrain")],
            cached: 3,
            purge: { removed: 3, preserved: 1 },
        });
        confirmDialog.mockResolvedValueOnce(true);

        await ExportLogic.clearLocalPOIs();
        await flush();

        expect(store.purgeCachedFeatures).toHaveBeenCalledTimes(1);
        expect(notif.success).toHaveBeenCalledWith(expect.stringContaining("3"), 3000);
        body.remove();
    });

    test("🛑 la confirmation ANNONCE ce qui part et ce qui reste", async () => {
        // It is the retained option, and its motive: "a displayed tally is a
        // testable assertion, a silent filter re-deletes itself at the next
        // refactor". Here it is, tested — without which the promise would only
        // hold until the next pass.
        //
        // ⚠️ `GeoLeaf.I18n` MUST BE MOUNTED, and the first draft did not. Without
        // an i18n facade, `tLabel()` returns the KEY (`i18n-seam.ts`: a key that
        // echoes is a missing key), so the string carried no `{cached}` to
        // substitute and the test asserted on an empty template. It would have
        // been green with a deleted `.replace()`. We mount the real label from
        // the French catalogue.
        globalThis.GeoLeaf.I18n = {
            getLabel: (key) =>
                key === "storage.confirm.clearPois.detail"
                    ? "{cached} entité(s) en cache seront supprimées ; {pending} saisie(s) en attente seront CONSERVÉES."
                    : key,
        };
        installStorage({ available: true, pending: [edit("a"), edit("b")], cached: 7 });
        confirmDialog.mockResolvedValueOnce(false);

        await ExportLogic.clearLocalPOIs();

        const message = confirmDialog.mock.calls.at(-1)[0].message;
        expect(message).toContain("7 entité(s) en cache seront supprimées");
        expect(message).toContain("2 saisie(s) en attente seront CONSERVÉES");
        // No template must survive substitution: a `{cached}` displayed as-is is
        // the visible symptom of a tally that was not computed.
        expect(message).not.toContain("{cached}");
        expect(message).not.toContain("{pending}");
        delete globalThis.GeoLeaf.I18n;
    });

    test("annulé → ne purge rien", async () => {
        const store = installStorage();
        confirmDialog.mockResolvedValueOnce(false);
        await ExportLogic.clearLocalPOIs();
        expect(store.purgeCachedFeatures).not.toHaveBeenCalled();
    });

    test("erreur pendant la purge → notifie", async () => {
        confirmDialog.mockResolvedValueOnce(true);
        _installGeoLeafStorage({
            isAvailable: () => true,
            getStats: vi.fn(async () => ({ features: { count: 1 }, outbox: { count: 0 } })),
            DB: {
                purgeCachedFeatures: vi.fn(async () => {
                    throw new Error("verrou");
                }),
            },
        });
        await ExportLogic.clearLocalPOIs();
        expect(notif.error).toHaveBeenCalled();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// initializeCacheContent — guards only (CacheControl stubbed cross-plugin)
// ════════════════════════════════════════════════════════════════════════════════════

describe("initializeCacheContent", () => {
    test("sans corps de modal → ne fait rien", () => {
        expect(() => ExportLogic.initializeCacheContent()).not.toThrow();
    });

    test("CacheControl indisponible (stub) → pose un placeholder", () => {
        const body = modalBody();
        ExportLogic.initializeCacheContent();
        expect(body.querySelector(".gl-cache-modal__placeholder")).toBeTruthy();
    });
});
