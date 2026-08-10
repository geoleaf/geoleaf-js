/**
 * Unit tests — `ui/cache-button/export-logic.ts`, couverture réelle (chantier R.31).
 *
 * Fichier mesuré à 54 % : la logique d'EXPORT/SYNCHRO du modal (onglet Export). Pilotable
 * sans carte — la file POI vient de `StorageContract.DB.getPendingSyncQueue()`, l'export
 * passe par `URL.createObjectURL`/`navigator.clipboard`, les notifications et `confirmDialog`
 * sont mockés. On exerce `initializeExportContent` (comptes > 0 et = 0), `getPendingPOIs`
 * (filtres + erreur), l'export JSON, la copie presse-papier et la purge locale.
 *
 * ⚠️ `initializeCacheContent`'s création réelle du `CacheControl` n'est PAS atteignable :
 * `../../cache/cache-control.js` est stubé (empty-module) par l'alias cross-plugin, donc
 * `CacheControl` vaut `undefined` — on ne couvre que ses gardes.
 */
import { vi, describe, test, expect, beforeEach, afterEach } from "vitest";

import { ExportLogic } from "../ui/cache-button/export-logic.js";
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

function setConfig() {
    globalThis.GeoLeaf = globalThis.GeoLeaf || {};
    globalThis.GeoLeaf.Config = { get: (_k, fb) => fb };
    // seam POI absent → SyncManager.mount rend « indisponible » sans erreur
    globalThis.GeoLeaf.Sync = { getHandler: () => undefined };
}

let notif;
function installNotifications() {
    notif = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };
    globalThis.GeoLeaf._UINotifications = notif;
}

// 🛑 TÂCHE 4.10 — LE HARNAIS SUIT LE SUJET, QUI A DÉMÉNAGÉ. Il nourrissait `sync_queue`
// avec des enveloppes `add_poi`/`update_poi` ; depuis 4.4b plus personne ne les écrit, et le
// panneau lit l'outbox par `listPendingEdits()` et purge le cache par `purgeCachedFeatures()`.
// Les tests ne sont donc pas supprimés — ils sont re-pointés sur les magasins réels.
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

/** Une saisie encore due au serveur, dans la forme que `listPendingEdits()` rend. */
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
        // la section de synchro (SyncManager) est montée
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
        // ⚠️ LE FILTRAGE A CHANGÉ DE PROPRIÉTAIRE, et le titre de ce test le disait. Il
        // vérifiait « filtre par type et statut » — deux exclusions que le plugin faisait
        // lui-même sur `sync_queue`. Le core ne rend plus que ce qui est réellement dû
        // (`listPendingEdits`), donc il n'y a plus rien à exclure ici : ce qui reste à
        // éprouver est la PROJECTION, et c'est ce que le test dit maintenant.
        installStorage({
            available: true,
            pending: [edit("a"), edit("b", { kind: "update", state: "failed" })],
        });
        const pois = await ExportLogic.getPendingPOIs();
        expect(pois.map((p) => p.name)).toEqual(["a", "b"]);
        expect(pois[0]._syncOperation).toBe("create");
        expect(pois[0]._syncQueueId).toBe("e-a");
        // Un échec reste DÛ : `failed` n'est pas terminal (tâche 3.10), et l'export d'un
        // filet de sécurité qui laisserait tomber les échecs raterait sa cible.
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
        // C'est l'option 2 de B-115, et son motif : « un décompte affiché est une assertion
        // testable, un filtre silencieux se re-supprime au prochain refactor ». Le voici,
        // testé — sans quoi la promesse ne vaudrait que jusqu'au prochain passage.
        //
        // ⚠️ IL FAUT MONTER `GeoLeaf.I18n`, et la 1ʳᵉ rédaction ne le faisait pas. Sans
        // façade i18n, `tLabel()` renvoie la CLÉ (`i18n-seam.ts` : une clé qui s'écho est
        // une clé manquante), donc la chaîne ne portait aucun `{cached}` à substituer et le
        // test assertait sur un gabarit vide. Il aurait été vert avec un `.replace()`
        // supprimé. On monte le vrai libellé du catalogue français.
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
        // Aucun gabarit ne doit survivre à la substitution : un `{cached}` affiché tel quel
        // est le symptôme visible d'un décompte qui n'a pas été calculé.
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
// initializeCacheContent — gardes seulement (CacheControl stubé cross-plugin)
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
