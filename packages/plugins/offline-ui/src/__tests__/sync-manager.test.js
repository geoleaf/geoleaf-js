/**
 * Unit tests — `sync/sync-manager.ts`, real coverage.
 *
 * File measured at 37%: the POI SYNC SECTION (pending-operations status, backup
 * list, sync/restore buttons). No map required — the POI handler is read on the
 * `GeoLeaf.Sync.getHandler("poi")` seam, backups on
 * `StorageContract.DB.getBackups()`, notifications and `confirmDialog` are
 * mocked. We build the section (`buildSection` + `init`) to hold the real DOM
 * references, then exercise each method and its branches.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { SyncManager } from "../sync/sync-manager.js";
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

// ── Seam gestionnaire POI (GeoLeaf.Sync.getHandler) ─────────────────────────────────
function installHandler(handler) {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Sync = { getHandler: (id) => (id === "poi" ? handler : undefined) };
}
function removeHandler() {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Sync = { getHandler: () => undefined };
}
function makeHandler({
    summary = { total: 0, add: 0, update: 0, delete: 0 },
    syncResult = { synced: 3, failed: 0, skipped: 0 },
} = {}) {
    return {
        getSyncSummary: vi.fn(async () => summary),
        processSyncQueue: vi.fn(async () => syncResult),
        restoreBackup: vi.fn(async () => {}),
    };
}

// ── Notifications ───────────────────────────────────────────────────────────────────
let notif;
function installNotifications() {
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    globalThis.GeoLeaf._UINotifications = notif;
}

// ── Sauvegardes via StorageContract.DB ──────────────────────────────────────────────
function installBackups({ available = true, backups = [], hasGetBackups = true } = {}) {
    const getBackups = vi.fn(async () => backups);
    _installGeoLeafStorage({
        isAvailable: () => available,
        DB: hasGetBackups ? { getBackups } : {},
    });
    return { getBackups };
}

/** Builds the section and wires the internal references, without running updateStatus. */
function setup() {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const els = SyncManager.buildSection(parent);
    SyncManager._onSynced = null;
    SyncManager.init({ _syncToggleBtn: els.syncToggleBtn }, els.syncContent);
    return { parent, els };
}

beforeEach(() => {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    installNotifications();
    confirmDialog.mockReset();
    confirmDialog.mockResolvedValue(true);
    installBackups({ available: false }); // défaut neutre
});

afterEach(() => {
    document.querySelectorAll(".gl-cache-sync").forEach((n) => n.parentElement?.remove());
    vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════════════
// buildSection / mount / init / handleToggle
// ════════════════════════════════════════════════════════════════════════════════════

describe("buildSection", () => {
    test("bâtit la section complète et rend les 6 références", () => {
        // ⚠️ Seven previously: `syncBackupsEl` leaves with the backup chain,
        // whose store had no writer left — the panel displayed "no backup" by
        // construction.
        const parent = document.createElement("div");
        const els = SyncManager.buildSection(parent);
        expect(parent.querySelector(".gl-cache-sync")).toBeTruthy();
        expect(els.syncStatusEl.id).toBe("gl-cache-sync-status");
        expect(els.syncBtn.id).toBe("gl-cache-sync-btn");
        expect(els.syncBtn.disabled).toBe(true);
        expect(els.syncBackupsEl).toBeUndefined();
    });
});

describe("mount", () => {
    test("appende la section, câble les boutons et lance le rendu initial", async () => {
        installHandler(makeHandler({ summary: { total: 0, add: 0, update: 0, delete: 0 } }));
        installBackups({ available: true, backups: [] });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const onSynced = vi.fn();

        SyncManager.mount(parent, { onSynced });
        await new Promise((r) => setTimeout(r, 0));

        expect(parent.querySelector(".gl-cache-sync")).toBeTruthy();
        expect(SyncManager._onSynced).toBe(onSynced);
        // initial render: "up to date" status set
        expect(parent.querySelector(".gl-cache-sync__placeholder")).toBeTruthy();
        parent.remove();
    });
});

describe("handleToggle", () => {
    test("replie puis déploie le contenu et bascule le chevron", () => {
        const { els } = setup();
        expect(els.syncContent.style.display).toBe("block");

        SyncManager.handleToggle();
        expect(els.syncContent.style.display).toBe("none");
        expect(els.syncToggleBtn.textContent).toBe("▲");

        SyncManager.handleToggle();
        expect(els.syncContent.style.display).toBe("block");
        expect(els.syncToggleBtn.textContent).toBe("▼");
    });

    test("sans contenu monté, ne jette pas", () => {
        SyncManager._syncContent = null;
        expect(() => SyncManager.handleToggle()).not.toThrow();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// _renderSyncStatus
// ════════════════════════════════════════════════════════════════════════════════════

describe("_renderSyncStatus", () => {
    test("sans gestionnaire POI → indisponible", async () => {
        removeHandler();
        const { els } = setup();
        await SyncManager._renderSyncStatus();
        expect(els.syncStatusEl.textContent).toContain("unavailable");
    });

    test("file vide (total 0) → « à jour », bouton désactivé", async () => {
        installHandler(makeHandler({ summary: { total: 0, add: 0, update: 0, delete: 0 } }));
        const { els } = setup();
        await SyncManager._renderSyncStatus();
        expect(els.syncStatusEl.textContent).toContain("upToDate");
        expect(els.syncBtn.disabled).toBe(true);
    });

    test("opérations en attente → récapitulatif, message d'alerte, bouton activé", async () => {
        installHandler(makeHandler({ summary: { total: 6, add: 2, update: 3, delete: 1 } }));
        const { els } = setup();
        await SyncManager._renderSyncStatus();

        const list = els.syncStatusEl.querySelector(".gl-cache-sync__summary-list");
        expect(list.querySelectorAll("li").length).toBe(3); // add + update + delete
        expect(els.syncMessageEl.style.display).toBe("block");
        expect(els.syncBtn.disabled).toBe(false);
    });

    test("récapitulatif partiel (add seul) → une seule ligne", async () => {
        installHandler(makeHandler({ summary: { total: 2, add: 2, update: 0, delete: 0 } }));
        const { els } = setup();
        await SyncManager._renderSyncStatus();
        expect(els.syncStatusEl.querySelectorAll("li").length).toBe(1);
    });

    test("summary absent → sort sans rien peindre", async () => {
        installHandler({ getSyncSummary: vi.fn(async () => null) });
        const { els } = setup();
        await SyncManager._renderSyncStatus();
        // the initial loading placeholder stays
        expect(els.syncStatusEl.textContent).toContain("loading");
    });

    test("getSyncSummary qui jette → placeholder d'erreur", async () => {
        installHandler({
            getSyncSummary: vi.fn(async () => {
                throw new Error("boom");
            }),
        });
        const { els } = setup();
        await SyncManager._renderSyncStatus();
        expect(els.syncStatusEl.querySelector(".gl-cache-sync__placeholder--error")).toBeTruthy();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// updateBackupsList
// ════════════════════════════════════════════════════════════════════════════════════

describe("updateStatus", () => {
    test("délègue au rendu du statut — il n'y a plus qu'un emplacement", async () => {
        // ⚠️ This block contained "chains status then backups (backups in the
        // finally)". The `finally` existed because four status-render exits left
        // the "Backups: loading…" label on screen for good. The list is removed,
        // so it has no second slot left to save — and keeping it would have been
        // an objectless guard.
        installHandler(makeHandler({ summary: { total: 0, add: 0, update: 0, delete: 0 } }));
        const parent = document.createElement("div");
        SyncManager.mount(parent);

        await SyncManager.updateStatus();

        expect(parent.querySelector("#gl-cache-sync-status").textContent).toContain("✅");
        expect(parent.querySelector("#gl-cache-sync-backups")).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// handleSync
// ════════════════════════════════════════════════════════════════════════════════════

describe("handleSync", () => {
    afterEach(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    });

    test("sans gestionnaire → notifie l'indisponibilité", async () => {
        removeHandler();
        setup();
        await SyncManager.handleSync();
        expect(notif.error).toHaveBeenCalled();
    });

    test("hors ligne → avertit", async () => {
        installHandler(makeHandler({ summary: { total: 5, add: 5, update: 0, delete: 0 } }));
        Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
        setup();
        await SyncManager.handleSync();
        expect(notif.warning).toHaveBeenCalled();
    });

    test("file vide → informe", async () => {
        installHandler(makeHandler({ summary: { total: 0, add: 0, update: 0, delete: 0 } }));
        setup();
        await SyncManager.handleSync();
        expect(notif.info).toHaveBeenCalled();
    });

    test("confirmation refusée → ne synchronise pas", async () => {
        const handler = makeHandler({ summary: { total: 3, add: 3, update: 0, delete: 0 } });
        installHandler(handler);
        confirmDialog.mockResolvedValueOnce(false);
        setup();
        await SyncManager.handleSync();
        expect(handler.processSyncQueue).not.toHaveBeenCalled();
    });

    test("succès sans échec → notifie succès, met à jour, émet l'événement, rappelle onSynced", async () => {
        const handler = makeHandler({
            summary: { total: 3, add: 3, update: 0, delete: 0 },
            syncResult: { synced: 3, failed: 0, skipped: 0 },
        });
        installHandler(handler);
        installBackups({ available: true, backups: [] });
        const onSynced = vi.fn();
        const evt = vi.fn();
        document.addEventListener("geoleaf:poi:synced", evt, { once: true });
        const { els } = setup();
        SyncManager._onSynced = onSynced;

        await SyncManager.handleSync();

        expect(handler.processSyncQueue).toHaveBeenCalled();
        expect(notif.success).toHaveBeenCalled();
        expect(evt).toHaveBeenCalled();
        expect(onSynced).toHaveBeenCalled();
        // button re-enabled in the finally
        expect(els.syncBtn.disabled).toBe(false);
    });

    test("synchro avec échecs → avertissement détaillé", async () => {
        installHandler(
            makeHandler({
                summary: { total: 4, add: 4, update: 0, delete: 0 },
                syncResult: { synced: 2, failed: 2, skipped: 0 },
            })
        );
        installBackups({ available: true, backups: [] });
        setup();
        await SyncManager.handleSync();
        expect(notif.warning).toHaveBeenCalled();
    });

    test("processSyncQueue qui jette → notifie l'erreur, réactive le bouton", async () => {
        const handler = makeHandler({ summary: { total: 3, add: 3, update: 0, delete: 0 } });
        handler.processSyncQueue = vi.fn(async () => {
            throw new Error("500");
        });
        installHandler(handler);
        const { els } = setup();
        await SyncManager.handleSync();
        expect(notif.error).toHaveBeenCalledWith(expect.stringContaining("500"), 5000);
        expect(els.syncBtn.disabled).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// handleRestore
// ════════════════════════════════════════════════════════════════════════════════════
