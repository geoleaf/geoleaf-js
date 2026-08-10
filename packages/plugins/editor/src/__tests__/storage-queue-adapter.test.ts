/**
 * `createStorageQueueAdapter` — APRÈS la migration vers le point d'écriture du core (4.9).
 *
 * 🛑 CE FICHIER ASSERTAIT L'ENVELOPPE v3 : `type: "editor.save"`, une charge sous `payload`,
 * un `profileId`. Les trois ont disparu avec le second vocabulaire. Ce qui est éprouvé
 * désormais, c'est la TRADUCTION — l'adaptateur ne connaît plus que `create`/`update`/`delete`,
 * et il ne refuse rien : les gardes (éditabilité S6, géométrie) vivent dans le core, seul
 * endroit qui lit la déclaration de couche. Refuser une saisie déjà faite serait la perdre.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { createStorageQueueAdapter } from "../persistence/storage-queue-adapter.js";

function mountStorage(report = { entryId: "op-1", refused: null as string | null }) {
    const applyEdit = vi.fn().mockResolvedValue(report);
    (globalThis as Record<string, unknown>).GeoLeaf = { Storage: { applyEdit } };
    return applyEdit;
}

const FEATURE = {
    id: "f1",
    geometry: { type: "Point", coordinates: [1, 2] },
    properties: { title: "T" },
} as never;

describe("createStorageQueueAdapter — écriture par le core", () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("save → `create`, avec l'entité en GeoJSON", async () => {
        const applyEdit = mountStorage();
        await createStorageQueueAdapter().save(FEATURE, "l1");

        expect(applyEdit).toHaveBeenCalledWith(
            expect.objectContaining({
                layerId: "l1",
                kind: "create",
                localId: "f1",
                feature: expect.objectContaining({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [1, 2] },
                }),
            })
        );
    });

    it("update → `update`, portant l'identité de l'entité", async () => {
        const applyEdit = mountStorage();
        await createStorageQueueAdapter().update(FEATURE, "l1");
        expect(applyEdit).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "update", localId: "f1" })
        );
    });

    it("delete → `delete`, sans entité", async () => {
        const applyEdit = mountStorage();
        await createStorageQueueAdapter().delete("f9", "l1");

        const call = applyEdit.mock.calls[0][0];
        expect(call.kind).toBe("delete");
        expect(call.localId).toBe("f9");
        // ⚠️ Pas d'entité : le magasin conserve celle qu'il a. C'est le seul endroit où vit le
        // `serverId`, et le push en a besoin pour savoir QUOI supprimer.
        expect(call.feature).toBeUndefined();
    });

    it("🛑 appelle `applyEdit` AVEC SON RÉCEPTEUR — le détacher casse la façade (B-128)", async () => {
        // 🛑 CE QUE LES AUTRES MOCKS NE PEUVENT PAS VOIR. Ils posent `applyEdit` comme une
        // `vi.fn()` nue : une fonction sans `this` marche aussi bien détachée qu'attachée,
        // donc ils sortent verts sur les deux formes. La façade du core, elle, lit
        // `this._modules` pour joindre le moteur — un appel détaché y jette
        // `TypeError: Cannot read properties of undefined (reading '_modules')`.
        //
        // Mesuré sur le déployé (B-128) : la sauvegarde hors ligne fermait sa modale,
        // n'écrivait RIEN, et le rejet partait en `unhandledrejection` — donc sans
        // notification. Une saisie de terrain perdue en silence.
        //
        // Ce mock REPRODUIT la contrainte au lieu de l'ignorer : il jette si `this` n'est pas
        // la façade. C'est la seule forme qui puisse rendre faux.
        const seen: unknown[] = [];
        const facade = {
            _modules: { edit: true },
            applyEdit(this: unknown, input: unknown) {
                if (!this || !(this as { _modules?: unknown })._modules) {
                    throw new TypeError("Cannot read properties of undefined (reading '_modules')");
                }
                seen.push(input);
                return Promise.resolve({ entryId: "e-recepteur", refused: null });
            },
        };
        (globalThis as Record<string, unknown>).GeoLeaf = { Storage: facade };

        await expect(createStorageQueueAdapter().save(FEATURE, "l1")).resolves.toBeDefined();
        expect(seen).toHaveLength(1);
    });

    it("émet `geoleaf:editor:feature-sync-queued` avec l'identifiant d'entrée", async () => {
        mountStorage({ entryId: "op-42", refused: null });
        const seen = vi.fn();
        document.addEventListener("geoleaf:editor:feature-sync-queued", seen);

        await createStorageQueueAdapter().save(FEATURE, "l1");

        expect(seen).toHaveBeenCalled();
        const detail = (seen.mock.calls[0][0] as CustomEvent).detail as { entryId: string };
        expect(detail.entryId).toBe("op-42");
        document.removeEventListener("geoleaf:editor:feature-sync-queued", seen);
    });

    it("un REFUS du core remonte — il ne se perd pas en silence", async () => {
        // Une couche non modifiable refuse l'édition (invariant S6). Avaler ce refus rendrait
        // une saisie perdue indiscernable d'une saisie enregistrée.
        mountStorage({ entryId: null, refused: "layerNotEditable" });
        await expect(createStorageQueueAdapter().save(FEATURE, "l1")).rejects.toThrow(
            /layerNotEditable/
        );
    });

    it("sans moteur de stockage, l'écriture jette au lieu d'avaler la saisie", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = { Storage: {} };
        await expect(createStorageQueueAdapter().save(FEATURE, "l1")).rejects.toThrow();
    });
});
