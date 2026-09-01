/*!
 * Tests — the `Sync` seam's `"poi"` handler
 *
 * 🛑 THE CENTRAL GUARD IS THE COLLISION ONE. `SyncHandlerContract.registerHandler`
 * does `_handlers.set(id, handler)` — it **replaces silently**. The seam mock
 * below REPRODUCES that semantics (a `Map`, a real overwrite) instead of a
 * bare `vi.fn()`: a mock more permissive than the surface would have validated
 * unconditional registration, precisely the defect this work avoids.
 *
 * ⚠️ `listPendingEdits` and `pushOutbox` are mounted as METHODS on their
 * object, and the doubles verify their receiver: a detached call must fail
 * here as it fails in the browser.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- the Sync seam, with the core's overwrite semantics ------------------------
const _handlers = new Map<string, unknown>();
const _sync = {
    registerHandler: vi.fn((id: string, h: unknown) => {
        _handlers.set(id, h);
    }),
    getHandler: vi.fn((id: string) => _handlers.get(id)),
};

// --- the database, with a `listPendingEdits` that DEMANDS its receiver --------
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

const { EditorSyncHandler, registerSyncHandler, SYNC_HANDLER_ID } =
    await import("../persistence/sync-handler.js");

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

// --- registration and the collision --------------------------------------------

describe("registerSyncHandler — l'enregistrement, désormais INCONDITIONNEL", () => {
    it('enregistre sous "poi" quand la place est libre', () => {
        expect(registerSyncHandler()).toBe(true);
        expect(_handlers.get(SYNC_HANDLER_ID)).toBe(EditorSyncHandler);
    });

    it("🛑 NE CÈDE PLUS une place occupée — il la prend", () => {
        // `editor` yielded as long as `addpoi` lived, and the takeover lived
        // in the bridge. The bridge left with the package, so no taker exists
        // any more: yielding would leave `offline-ui` wired to a third-party
        // handler, or to nothing — silently.
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
        // Better a correct total and an incomplete breakdown than the
        // opposite: the button activates on `total`, and undercounting it
        // would leave a capture invisible.
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

    it("🛑 appelle listPendingEdits AVEC SON RÉCEPTEUR", async () => {
        // The double throws when `this` is not the database — exactly what the
        // core's facade does, and what no typecheck catches since the plugin
        // redeclares the surface.
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
        // `null` = off-network, drain already running, or engine absent.
        // Returning it as `{synced: 0, success: true}` would make the UI
        // announce "up to date" on a replay that was never attempted.
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

// --- the shape the core's contract expects --------------------------------------

describe("La surface que le seam expose", () => {
    it("porte exactement les deux méthodes qu'offline-ui consomme", () => {
        expect(typeof EditorSyncHandler.getSyncSummary).toBe("function");
        expect(typeof EditorSyncHandler.processSyncQueue).toBe("function");
    });

    it("l'identifiant est bien celui que lit offline-ui", () => {
        expect(SYNC_HANDLER_ID).toBe("poi");
    });
});
