/**
 * Guard — the layer permission is applied ALSO on the CONNECTED path,
 * and a permission refusal is not retryable.
 *
 * ## What these cases would assert BADLY if they only observed the error
 *
 * 🛑 **The central case asserts on the ABSENCE OF A NETWORK CALL, not on the
 * error's type.** A guard that only verifies a `PersistenceError("forbidden")`
 * is thrown stays green if the `DELETE` already left before it was thrown —
 * the entity would be deleted server-side AND the user would see a refusal.
 * It is the false green of observing `caches.open` instead of the effective
 * write, seen before: measuring "a decision was made", not "nothing was
 * written".
 *
 * ## Why `mode: "online"` and not just `"auto"`
 *
 * `createPersistenceAdapter` returns the **bare** REST adapter in
 * `mode: "online"` — without going through `createAutoAdapter`. A guard
 * exercising only the auto mode would leave open the most exposed mode, the
 * one that carried the hole.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPersistenceAdapter } from "../persistence/adapter-factory.js";
import { PersistenceError } from "../persistence/adapter-interface.js";
import type { EditorConfig } from "../types.js";
import type { EditorFeature } from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [2.35, 48.85] },
    properties: {},
};

const API = { baseUrl: "https://api.test", timeoutMs: 5000 };

let fetchMock: ReturnType<typeof vi.fn>;
let applyEdit: ReturnType<typeof vi.fn>;
let mayEdit: ReturnType<typeof vi.fn>;

/** The reference profile: everything granted but `delete`, like `_reference/reference-points`. */
function grantAllButDelete(_layerId: string, kind: string): boolean {
    return kind !== "delete";
}

beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}"),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    applyEdit = vi.fn().mockResolvedValue({ entryId: "op-1", refused: null });
    mayEdit = vi.fn(grantAllButDelete);
    (globalThis as any).GeoLeaf ??= {};
    (globalThis as any).GeoLeaf.Storage = { applyEdit, mayEdit };
    (globalThis as any).GeoLeaf.Config = { getActiveProfile: vi.fn(() => ({ id: "p" })) };
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).GeoLeaf.Storage;
    vi.restoreAllMocks();
});

function cfg(mode: "online" | "offline" | "auto", dialect?: "rest" | "collection"): EditorConfig {
    return { api: API, persistence: { mode, dialect } };
}

describe("la permission vaut EN LIGNE, pas seulement hors ligne", () => {
    it("mode online : un delete refusé n'atteint JAMAIS le réseau", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));

        await expect(adapter.delete("f1", "reference-points")).rejects.toThrow(PersistenceError);

        // 🛑 The assertion that matters: nothing left. Checking only the
        // error's type would let an already-emitted DELETE pass.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(mayEdit).toHaveBeenCalledWith("reference-points", "delete");
    });

    it("mode online : un update ACCORDÉ passe bien au réseau (la garde n'est pas un mur)", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));

        await adapter.update(FEATURE, "reference-points");

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("dialecte collection : gaté lui aussi, alors qu'il court-circuite le routage", async () => {
        const adapter = createPersistenceAdapter(cfg("auto", "collection"));

        await expect(adapter.delete("f1", "reference-points")).rejects.toThrow(PersistenceError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("mode auto : refusé avant le choix du chemin — ni réseau, ni mise en file", async () => {
        const adapter = createPersistenceAdapter(cfg("auto"));

        await expect(adapter.delete("f1", "reference-points")).rejects.toThrow(PersistenceError);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(applyEdit).not.toHaveBeenCalled();
    });

    it("mode offline : la file non plus n'est pas écrite", async () => {
        const adapter = createPersistenceAdapter(cfg("offline"));

        await expect(adapter.delete("f1", "reference-points")).rejects.toThrow(PersistenceError);
        expect(applyEdit).not.toHaveBeenCalled();
    });
});

describe("un refus de permission n'est pas réessayable", () => {
    it("le refus porte `forbidden`, jamais `network`", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));

        const err = await adapter.delete("f1", "reference-points").catch((e: unknown) => e);

        expect(err).toBeInstanceOf(PersistenceError);
        expect((err as PersistenceError).kind).toBe("forbidden");
        // ⚠️ The half that matters: `auto-adapter._isTransportError` only
        // recognises `network`/`timeout`. Typed `network`, this refusal would
        // be requeued indefinitely.
        expect((err as PersistenceError).kind).not.toBe("network");
    });

    it("un refus REMONTÉ PAR LE CORE est requalifié, pas laissé en `network`", async () => {
        // The layer is granted on the predicate side, but the core refuses at
        // write time — the second guard level, the one `applyEdit` holds on
        // its own account.
        mayEdit.mockReturnValue(true);
        applyEdit.mockResolvedValue({ entryId: null, refused: "deleteNotPermitted" });
        const adapter = createPersistenceAdapter(cfg("offline"));

        const err = await adapter.delete("f1", "L").catch((e: unknown) => e);

        expect((err as PersistenceError).kind).toBe("forbidden");
    });

    it("un refus qui N'EST PAS une permission garde son type transport", async () => {
        mayEdit.mockReturnValue(true);
        applyEdit.mockResolvedValue({ entryId: null, refused: "engineUnavailable" });
        const adapter = createPersistenceAdapter(cfg("offline"));

        const err = await adapter.delete("f1", "L").catch((e: unknown) => e);

        // The absent engine IS an outage, and it must stay retryable.
        expect((err as PersistenceError).kind).toBe("network");
    });
});

describe("refus de permission — ce que l'UTILISATEUR lit", () => {
    /**
     * ⚠️ **THIS CASE WAS WRITTEN VACUOUS, AND THE MUTATION CAUGHT IT.** Its
     * first draft mocked `GeoLeaf.UI.Notifications.show` and asserted in the
     * NEGATIVE (`expect(shown).not.toMatch(/Erreur serveur/)`). But `_notify`
     * (`internal.ts`) goes through `GeoLeaf.UI.notify[kind]` — a whole
     * other channel. The mock received nothing, the observed string was empty,
     * and a negative assertion on emptiness **always** passes. Removing the
     * `_notifyError` fix left the case GREEN.
     *
     * Hence this shape: observe the real channel, assert POSITIVELY on the
     * exact label, and a check first verifies a notification did happen —
     * without which we would fall into the same trap through another door.
     */
    it("un refus de permission nomme la couche, pas une panne serveur réessayable", async () => {
        const notifyError = vi.fn();
        (globalThis as any).GeoLeaf.UI = { notify: { error: notifyError } };
        // `submitFeature` only does `save`/`update` — never `delete`. So we
        // need a layer refusing the UPDATE, otherwise nothing is refused and
        // the case would be moot. (Which the anti-vacuity check below flagged
        // at writing time.)
        mayEdit.mockReturnValue(false);
        const { submitFeature } = await import("../persistence/submit.js");
        const { _getLabel } = await import("../internal.js");
        const adapter = createPersistenceAdapter(cfg("online"));

        await submitFeature(
            {
                adapter,
                strategy: "lastWriteWins",
                commitHost: vi.fn(),
                reloadFeature: vi.fn(),
                dispatchSaved: vi.fn(),
            } as never,
            { feature: FEATURE, layerId: "reference-points", isUpdate: true }
        ).catch(() => {
            /* the rejection is expected — the LABEL is what we exercise */
        });

        // Anti-vacuity check: without a notification, all that follows would be moot.
        expect(notifyError).toHaveBeenCalledOnce();
        expect(notifyError).toHaveBeenCalledWith(_getLabel("editor.error.editionNotPermitted"));
        expect(notifyError).not.toHaveBeenCalledWith(_getLabel("editor.error.server"));
    });
});

describe("8.7 — absent vaut REFUSÉ, y compris pour le prédicat lui-même", () => {
    it("façade sans `mayEdit` : on refuse au lieu de supposer l'autorisation", async () => {
        (globalThis as any).GeoLeaf.Storage = { applyEdit }; // le double incomplet d'avant 8.7
        const adapter = createPersistenceAdapter(cfg("online"));

        const err = await adapter.delete("f1", "L").catch((e: unknown) => e);

        expect((err as PersistenceError).kind).toBe("forbidden");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("façade absente : idem", async () => {
        delete (globalThis as any).GeoLeaf.Storage;
        const adapter = createPersistenceAdapter(cfg("online"));

        await expect(adapter.save(FEATURE, "L")).rejects.toThrow(PersistenceError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
