/**
 * Garde 8.7 — la permission de couche est appliquée AUSSI sur le chemin CONNECTÉ (B-138),
 * et un refus de permission n'est pas réessayable (B-139).
 *
 * ## Ce que ces cas asserteraient MAL s'ils n'observaient que l'erreur
 *
 * 🛑 **Le cas central assère sur l'ABSENCE D'APPEL AU RÉSEAU, pas sur le type de l'erreur.**
 * Une garde qui vérifie seulement qu'une `PersistenceError("forbidden")` est levée reste verte
 * si le `DELETE` est déjà parti avant qu'elle ne soit levée — l'entité serait supprimée côté
 * serveur ET l'utilisateur verrait un refus. C'est le faux vert n° ④ de la session précédente
 * (observer `caches.open` au lieu de l'écriture effective) : on mesurait « une décision a été
 * prise », pas « rien n'a été écrit ».
 *
 * ## Pourquoi `mode: "online"` et pas seulement `"auto"`
 *
 * `createPersistenceAdapter` rend l'adaptateur REST **nu** en `mode: "online"` — sans passer
 * par `createAutoAdapter`. Une garde qui n'éprouverait que le mode automatique laisserait
 * ouvert le mode le plus exposé, celui qui portait le trou.
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

/** Le profil de référence : tout accordé sauf `delete`, comme `_reference/reference-points`. */
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

describe("8.7 / B-138 — la permission vaut EN LIGNE, pas seulement hors ligne", () => {
    it("mode online : un delete refusé n'atteint JAMAIS le réseau", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));

        await expect(adapter.delete("f1", "reference-points")).rejects.toThrow(PersistenceError);

        // 🛑 L'assertion qui compte : rien n'est parti. Vérifier seulement le type de l'erreur
        // laisserait passer un DELETE déjà émis.
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

describe("8.7 / B-139 — un refus de permission n'est pas réessayable", () => {
    it("le refus porte `forbidden`, jamais `network`", async () => {
        const adapter = createPersistenceAdapter(cfg("online"));

        const err = await adapter.delete("f1", "reference-points").catch((e: unknown) => e);

        expect(err).toBeInstanceOf(PersistenceError);
        expect((err as PersistenceError).kind).toBe("forbidden");
        // ⚠️ La moitié qui compte : `auto-adapter._isTransportError` ne reconnaît que
        // `network`/`timeout`. Typé `network`, ce refus serait remis en file indéfiniment.
        expect((err as PersistenceError).kind).not.toBe("network");
    });

    it("un refus REMONTÉ PAR LE CORE est requalifié, pas laissé en `network`", async () => {
        // La couche est accordée côté prédicat, mais le core refuse à l'écriture — le second
        // niveau de garde, celui qu'`applyEdit` tient pour son propre compte.
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

        // Le moteur absent EST une panne, et elle doit rester réessayable.
        expect((err as PersistenceError).kind).toBe("network");
    });
});

describe("8.7 / B-139 — ce que l'UTILISATEUR lit", () => {
    /**
     * ⚠️ **CE CAS A ÉTÉ ÉCRIT VACUEUX, ET LA MUTATION L'A ATTRAPÉ.** Sa première rédaction
     * moquait `GeoLeaf.UI.Notifications.show` et assertait en NÉGATIF
     * (`expect(shown).not.toMatch(/Erreur serveur/)`). Or `_notify` (`internal.ts:53`) passe
     * par `GeoLeaf.UI.notify[kind]` — un tout autre canal. Le mock ne recevait rien, la chaîne
     * observée était vide, et une assertion négative sur du vide passe **toujours**. Retirer
     * le correctif de `_notifyError` laissait le cas VERT.
     *
     * D'où cette forme : on observe le vrai canal, on assère en POSITIF sur le libellé exact,
     * et un contrôle vérifie d'abord qu'une notification a bien eu lieu — sans quoi on
     * retomberait dans le même piège par une autre porte.
     */
    it("un refus de permission nomme la couche, pas une panne serveur réessayable", async () => {
        const notifyError = vi.fn();
        (globalThis as any).GeoLeaf.UI = { notify: { error: notifyError } };
        // `submitFeature` ne fait que `save`/`update` — jamais `delete`. Il faut donc une
        // couche qui refuse la MISE À JOUR, sinon rien n'est refusé et le cas serait sans
        // objet. (C'est ce que le contrôle anti-vacuité ci-dessous a signalé à la rédaction.)
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
            /* le rejet est attendu — c'est le LIBELLÉ qu'on éprouve */
        });

        // Contrôle anti-vacuité : sans notification, tout ce qui suit serait sans objet.
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
