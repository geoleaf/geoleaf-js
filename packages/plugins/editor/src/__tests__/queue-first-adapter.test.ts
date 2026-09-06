/**
 * ONE WRITE PATH — and the replacement for `auto-adapter`.
 *
 * 🛑 THIS FILE SUCCEEDS `auto-adapter.test.ts`, AND ITS SIX CASES WERE TRIAGED RATHER THAN
 * COPIED OVER. Four described the decision rule that was removed — reachability probe,
 * fallback on transport error, ping cache — and they were RIGHT: they faithfully described
 * the mechanism that manufactured the duplicate. A test faithful to a wrong behaviour is
 * indistinguishable from a right one, and it occupies the place. The two that SURVIVE are
 * the invariants, not the mechanics: a definitive refusal never turns into a write
 * somewhere else, and the layer permission guards every exit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQueueFirstAdapter } from "../persistence/queue-first-adapter.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type UpdateOptions,
    type SavedFeature,
} from "../persistence/adapter-interface.js";

const FEATURE: EditorFeature = {
    id: "f1",
    geometry: { type: "Point", coordinates: [1, 2] },
    properties: {},
};

/**
 * A fake backend recording what it was asked.
 *
 * ⚠️ Typed through the interface rather than inferred from the mocks: what the routing must
 * be handed is an `EditorPersistenceAdapter`, and a double that merely LOOKS like one would
 * let the test pass on a shape production never sees.
 */
function spyAdapter(name: string, calls: string[]) {
    const saved: SavedFeature = {
        id: "s1",
        layerId: "L",
        geometry: FEATURE.geometry,
        properties: {},
    };
    const save = vi.fn((_f: EditorFeature, _l: string) => {
        calls.push(`${name}.save`);
        return Promise.resolve(saved);
    });
    const update = vi.fn((_f: EditorFeature, _l: string, _o?: UpdateOptions) => {
        calls.push(`${name}.update`);
        return Promise.resolve(saved);
    });
    const remove = vi.fn((_id: string, _l: string) => {
        calls.push(`${name}.delete`);
        return Promise.resolve();
    });
    const adapter: EditorPersistenceAdapter = {
        save,
        update,
        delete: remove,
        isOnline: () => true,
    };
    return { adapter, save, update, remove };
}

describe("queue-first — la file dès que l'appareil peut porter l'écriture", () => {
    let calls: string[];
    let queue: ReturnType<typeof spyAdapter>;
    let online: ReturnType<typeof spyAdapter>;

    const mountCore = (canQueue: unknown) => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: canQueue === undefined ? {} : { canQueueWrites: () => canQueue },
        };
    };

    beforeEach(() => {
        calls = [];
        queue = spyAdapter("queue", calls);
        online = spyAdapter("online", calls);
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>).GeoLeaf;
    });

    it("🛑 le core peut porter la couche → la FILE, en ligne ou pas", async () => {
        mountCore(true);
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await adapter.save(FEATURE, "L");

        // The old adapter would have chosen the network here: that is exactly the path
        // which put no client identity on the wire.
        expect(calls).toEqual(["queue.save"]);
        expect(online.save).not.toHaveBeenCalled();
    });

    it("le core NE peut PAS porter la couche → le chemin direct, et il est nommé", async () => {
        mountCore(false);
        const warn = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: { canQueueWrites: () => false },
            Log: { warn },
        };
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await adapter.save(FEATURE, "L");

        expect(calls).toEqual(["online.save"]);
        // A layer the device cannot hold sends its captures straight out, so a cut loses
        // them — which is worth saying out loud, once.
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("🛑 « ne peut pas demander » vaut NON — pas « oui »", async () => {
        // An older core, or the `offline` capability simply disabled. Treating the absent
        // predicate as consent would queue into a store that does not exist.
        mountCore(undefined);
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await adapter.save(FEATURE, "L");

        expect(calls).toEqual(["online.save"]);
    });

    it("l'avertissement est dit UNE fois par couche, pas une fois par saisie", async () => {
        const warn = vi.fn();
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: { canQueueWrites: () => false },
            Log: { warn },
        };
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await adapter.save(FEATURE, "L");
        await adapter.save(FEATURE, "L");
        await adapter.delete("f1", "L");

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("la décision est PAR COUCHE, pas par application", async () => {
        (globalThis as Record<string, unknown>).GeoLeaf = {
            Storage: { canQueueWrites: (layerId: string) => layerId === "portable" },
        };
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await adapter.save(FEATURE, "portable");
        await adapter.save(FEATURE, "directe");

        expect(calls).toEqual(["queue.save", "online.save"]);
    });

    // ── The invariant inherited from `auto-adapter`, the only one that had to survive ──
    it("🛑 un refus définitif ne retombe JAMAIS ailleurs — il n'y a plus de repli", async () => {
        mountCore(true);
        queue.save.mockRejectedValueOnce(new PersistenceError("capability", "501"));
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        await expect(adapter.save(FEATURE, "L")).rejects.toThrow();
        // The old adapter fell back on TRANSPORT errors and had to exclude definitive
        // refusals from its list. Here the list no longer exists: no fallback, hence no list
        // to keep correct.
        expect(online.save).not.toHaveBeenCalled();
    });

    it("`isOnline` rapporte le RÉSEAU, pas le routage", async () => {
        mountCore(true);
        Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
        const adapter = createQueueFirstAdapter({ queue: queue.adapter, online: online.adapter });

        // An adapter claiming to be "online" because it can queue would tell the caller the
        // opposite of the truth.
        expect(adapter.isOnline()).toBe(false);
        Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    });
});
