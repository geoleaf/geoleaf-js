/*!
 * Tests — tâche 5.1-b : le handler `"poi"` du seam `Sync`
 *
 * 🛑 LA GARDE CENTRALE EST CELLE DE LA COLLISION. `SyncHandlerContract.registerHandler` fait
 * `_handlers.set(id, handler)` — il **remplace en silence**. Le mock de seam ci-dessous
 * REPRODUIT cette sémantique (une `Map`, un vrai écrasement) au lieu d'une `vi.fn()` nue :
 * un mock plus permissif que la surface aurait validé l'enregistrement inconditionnel, qui
 * est précisément le défaut que cette tâche évite.
 *
 * ⚠️ `listPendingEdits` et `pushOutbox` sont montés comme des MÉTHODES sur leur objet, et les
 * doubles vérifient leur récepteur (B-128) : un appel détaché doit échouer ici comme il
 * échoue dans le navigateur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- le seam Sync, avec la sémantique d'écrasement du core ---------------------
const _handlers = new Map<string, unknown>();
const _sync = {
    registerHandler: vi.fn((id: string, h: unknown) => {
        _handlers.set(id, h);
    }),
    getHandler: vi.fn((id: string) => _handlers.get(id)),
};

// --- la base, avec un `listPendingEdits` qui EXIGE son récepteur ---------------
let _pendingRows: Array<{ kind: string }> = [];
let _dbPresent = true;
const _db = {
    _marker: "real-db",
    listPendingEdits(this: unknown) {
        if ((this as { _marker?: string })?._marker !== "real-db") {
            throw new TypeError("Cannot read properties of undefined (reading '_marker')");
        }
        return Promise.resolve(_pendingRows);
    },
};

let _drainResult: { attempted: number; pushed: number; failed: number; conflicts: number } | null =
    null;
const _drain = vi.fn(() => Promise.resolve(_drainResult));

vi.mock("@geoleaf/host-runtime", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../persistence/storage-seam.js", () => ({
    storageDb: () => (_dbPresent ? _db : null),
}));
vi.mock("../persistence/editor-sync-replay.js", () => ({
    drainOutbox: () => _drain(),
}));

const { EditorSyncHandler, registerSyncHandler, SYNC_HANDLER_ID } = await import(
    "../persistence/sync-handler.js"
);

function installSeam(present = true) {
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = present ? { Sync: _sync } : {};
}

beforeEach(() => {
    _handlers.clear();
    _sync.registerHandler.mockClear();
    _sync.getHandler.mockClear();
    _pendingRows = [];
    _dbPresent = true;
    _drainResult = null;
    _drain.mockClear();
    installSeam(true);
});

// --- l'enregistrement et la collision ------------------------------------------

describe("registerSyncHandler — l'enregistrement, désormais INCONDITIONNEL", () => {
    it('enregistre sous "poi" quand la place est libre', () => {
        expect(registerSyncHandler()).toBe(true);
        expect(_handlers.get(SYNC_HANDLER_ID)).toBe(EditorSyncHandler);
    });

    it("🛑 NE CÈDE PLUS une place occupée — il la prend", () => {
        // 5.1-f : `editor` cédait tant qu'`addpoi` vivait, et la reprise vivait dans le pont.
        // Le pont est parti avec le paquet, donc il n'existe plus aucun repreneur : céder
        // laisserait `offline-ui` branché sur un handler tiers, ou sur rien — en silence.
        _handlers.set("poi", { _owner: "un-tiers" });

        expect(registerSyncHandler()).toBe(true);
        expect(_handlers.get("poi")).toBe(EditorSyncHandler);
        expect(_sync.registerHandler).toHaveBeenCalledWith("poi", EditorSyncHandler);
    });

    it("🛑 le résultat NE DÉPEND PAS de l'ordre de chargement", () => {
        registerSyncHandler();
        registerSyncHandler();
        expect(_handlers.get("poi")).toBe(EditorSyncHandler);

        _handlers.clear();
        _handlers.set("poi", { _owner: "un-tiers" });
        registerSyncHandler();
        expect(_handlers.get("poi")).toBe(EditorSyncHandler);
    });

    it("ne jette pas quand GeoLeaf.Sync est absent, et le dit", () => {
        installSeam(false);
        expect(() => registerSyncHandler()).not.toThrow();
        expect(registerSyncHandler()).toBe(false);
    });
});

// --- getSyncSummary -------------------------------------------------------------

describe("getSyncSummary — le décompte qui pilote le bouton d'offline-ui", () => {
    it("ventile par vocabulaire d'opération", async () => {
        _pendingRows = [
            { kind: "create" },
            { kind: "create" },
            { kind: "update" },
            { kind: "delete" },
        ];
        await expect(EditorSyncHandler.getSyncSummary()).resolves.toEqual({
            total: 4,
            add: 2,
            update: 1,
            delete: 1,
        });
    });

    it("🛑 un `kind` inconnu compte dans total sans être ventilé", async () => {
        // Mieux vaut un total juste et une ventilation incomplète que l'inverse : le bouton
        // s'active sur `total`, et le sous-compter laisserait une saisie invisible.
        _pendingRows = [{ kind: "create" }, { kind: "chose-inconnue" }];
        const s = await EditorSyncHandler.getSyncSummary();
        expect(s.total).toBe(2);
        expect(s.add + s.update + s.delete).toBe(1);
    });

    it("rend des zéros quand le moteur de stockage est absent", async () => {
        _dbPresent = false;
        await expect(EditorSyncHandler.getSyncSummary()).resolves.toEqual({
            total: 0,
            add: 0,
            update: 0,
            delete: 0,
        });
    });

    it("🛑 appelle listPendingEdits AVEC SON RÉCEPTEUR (B-128)", async () => {
        // Le double jette si `this` n'est pas la base — exactement ce que fait la façade du
        // core, et ce qu'aucun typecheck n'attrape puisque le plugin redéclare la surface.
        _pendingRows = [{ kind: "update" }];
        await expect(EditorSyncHandler.getSyncSummary()).resolves.toMatchObject({ total: 1 });
    });
});

// --- processSyncQueue -----------------------------------------------------------

describe("processSyncQueue — le rejeu du bouton", () => {
    it("traduit le décompte du drain dans la forme qu'offline-ui lit", async () => {
        _drainResult = { attempted: 5, pushed: 4, failed: 1, conflicts: 0 };
        await expect(EditorSyncHandler.processSyncQueue()).resolves.toEqual({
            success: false,
            total: 5,
            synced: 4,
            failed: 1,
            skipped: 0,
        });
    });

    it("success est vrai quand rien n'a échoué", async () => {
        _drainResult = { attempted: 3, pushed: 3, failed: 0, conflicts: 0 };
        await expect(EditorSyncHandler.processSyncQueue()).resolves.toMatchObject({
            success: true,
            synced: 3,
        });
    });

    it("🛑 JETTE quand le drain n'a pas eu lieu — il ne rend pas un succès à zéro", async () => {
        // `null` = hors réseau, drain déjà en cours, ou moteur absent. Le rendre comme
        // `{synced: 0, success: true}` ferait annoncer « à jour » à l'UI sur un rejeu qui
        // n'a jamais été tenté.
        _drainResult = null;
        await expect(EditorSyncHandler.processSyncQueue()).rejects.toThrow();
    });

    it("passe par le drain PARTAGÉ, pas par un second chemin", async () => {
        _drainResult = { attempted: 1, pushed: 1, failed: 0, conflicts: 0 };
        await EditorSyncHandler.processSyncQueue();
        expect(_drain).toHaveBeenCalledTimes(1);
    });

    it("🛑 NE NOTIFIE PAS et n'émet pas d'événement poi:* — offline-ui possède le message", async () => {
        const notify = vi.fn();
        (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
            Sync: _sync,
            UI: { notify: { success: notify, warning: notify, info: notify } },
        };
        const seen: string[] = [];
        const listener = (e: Event) => seen.push(e.type);
        document.addEventListener("geoleaf:poi:sync-completed", listener);

        _drainResult = { attempted: 2, pushed: 2, failed: 0, conflicts: 0 };
        await EditorSyncHandler.processSyncQueue();

        document.removeEventListener("geoleaf:poi:sync-completed", listener);
        expect(notify).not.toHaveBeenCalled();
        expect(seen).toEqual([]);
    });
});

// --- la forme attendue par le contrat du core -----------------------------------

describe("La surface que le seam expose", () => {
    it("porte exactement les deux méthodes qu'offline-ui consomme", () => {
        expect(typeof EditorSyncHandler.getSyncSummary).toBe("function");
        expect(typeof EditorSyncHandler.processSyncQueue).toBe("function");
    });

    it("l'identifiant est bien celui que lit offline-ui", () => {
        expect(SYNC_HANDLER_ID).toBe("poi");
    });
});
