/**
 * Unit tests — `sync/sync-manager.ts`, couverture réelle (chantier R.31).
 *
 * Fichier mesuré à 37 % : la SECTION DE SYNCHRO POI (statut des opérations en attente,
 * liste des sauvegardes, boutons synchroniser/restaurer). Aucune carte requise — le
 * gestionnaire POI est lu sur le seam `GeoLeaf.Sync.getHandler("poi")`, les sauvegardes
 * sur `StorageContract.DB.getBackups()`, les notifications et `confirmDialog` sont mockés.
 * On bâtit la section (`buildSection` + `init`) pour disposer des vraies références DOM,
 * puis on exerce chaque méthode et ses branches.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { SyncManager } from "../sync/sync-manager.js";
import { confirmDialog } from "@geoleaf/host-runtime";

// API publique S4.4 — les tests plantent `GeoLeaf.Storage` comme le fait la PRODUCTION.
// Ils pilotaient `StorageContract.init()`, c'est-à-dire une SECONDE instance du singleton
// que le bundle embarquait et que rien n'initialisait : ils validaient un canal mort.
function _installGeoLeafStorage(api) {
    globalThis.GeoLeaf = globalThis.GeoLeaf ?? {};
    // Le helper reproduit ce que `StorageContract.init()` fournissait, parce que la façade
    // du core le fournit aussi : `isPluginLoaded()` = « un moteur s'est enregistré », et
    // `isAvailable()` = « et sa base est ouverte ». L'adaptateur du plugin DÉLÈGUE ces deux
    // méthodes — il ne les recalcule pas —, donc un objet planté qui ne les porte pas
    // rendrait `false` là où le test attend `true`. Un appelant qui les fournit garde la main.
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

/** Bâtit la section et câble les références internes, sans lancer updateStatus. */
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
        // ⚠️ Sept jusqu'à la tâche 4.11 : `syncBackupsEl` part avec la chaîne de sauvegarde,
        // dont le magasin n'avait plus d'écrivain depuis 4.4b — le panneau affichait « aucune
        // sauvegarde » par construction.
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
        // rendu initial : statut « à jour » posé
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
        // le placeholder de chargement initial reste
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
        // ⚠️ Ce bloc contenait « enchaîne statut puis sauvegardes (backups dans le finally) ».
        // Le `finally` existait parce que quatre sorties du rendu de statut laissaient le
        // libellé « Sauvegardes : chargement… » à l'écran pour de bon. La liste est retirée
        // (4.11), donc il n'a plus de second emplacement à sauver — et le laisser aurait été
        // une garde sans objet.
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
        // bouton réactivé dans le finally
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
