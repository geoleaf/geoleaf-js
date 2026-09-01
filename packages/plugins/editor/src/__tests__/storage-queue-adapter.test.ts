/**
 * `createStorageQueueAdapter` — AFTER the migration to the core's write point.
 *
 * 🛑 THIS FILE ASSERTED THE v3 ENVELOPE: `type: "editor.save"`, a payload under
 * `payload`, a `profileId`. All three vanished with the second vocabulary.
 * What is exercised now is the TRANSLATION — the adapter only knows
 * `create`/`update`/`delete`, and it refuses nothing: the guards (editability
 * invariant, geometry) live in the core, the only place reading the layer
 * declaration. Refusing an already-made capture would lose it.
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
        // ⚠️ No entity: the store keeps the one it has. It is the only place
        // the `serverId` lives, and the push needs it to know WHAT to delete.
        expect(call.feature).toBeUndefined();
    });

    it("🛑 appelle `applyEdit` AVEC SON RÉCEPTEUR — le détacher casse la façade", async () => {
        // 🛑 WHAT THE OTHER MOCKS CANNOT SEE. They set `applyEdit` as a bare
        // `vi.fn()`: a function without `this` works detached as well as
        // attached, so they come out green on both forms. The core's facade,
        // though, reads `this._modules` to reach the engine — a detached call
        // throws `TypeError: Cannot read properties of undefined (reading '_modules')` there.
        //
        // Measured on the deployed build: the offline save closed its modal,
        // wrote NOTHING, and the rejection left as an `unhandledrejection` —
        // hence no notification. A field capture lost in silence.
        //
        // This mock REPRODUCES the constraint instead of ignoring it: it
        // throws when `this` is not the facade. The only shape that can turn false.
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
        // A non-modifiable layer refuses the edit (the editability invariant).
        // Swallowing that refusal would make a lost capture indistinguishable
        // from a recorded one.
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
