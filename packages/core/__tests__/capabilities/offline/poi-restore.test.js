/**
 * Unit tests — poi-restore (S9 D5).
 *
 * Storage pushes offline ENTITIES onto their host layers via GeoLeaf.Layers. Le lecteur
 * d'outbox, le lecteur du magasin `features` et le seam de couche sont injectés.
 *
 * 🛑 TÂCHE 4.7 — UN DE CES TESTS ASSERTAIT LE DÉFAUT. « filters POI kinds and ignores
 * editor.* entries » EXIGEAIT que les entrées de l'éditeur soient écartées : c'est le bug
 * lui-même — une géométrie tracée hors réseau n'était jamais réaffichée. Il est INVERSÉ ici.
 * Un test qui garde un défaut en place coûte plus cher que pas de test du tout : il le rend
 * intentionnel aux yeux du lecteur suivant.
 */

import { restorePendingPois } from "../../../src/capabilities/offline/poi-restore/poi-restore.js";
import { registerPoiRestore } from "../../../src/capabilities/offline/poi-restore/poi-restore-boot.js";

describe("poi-restore", () => {
    /** Fake GeoLeaf.Layers with an in-memory per-layer store (asserts dedup). */
    function makeFakeLayers(present = ["candelabres"]) {
        const presentSet = new Set(present);
        const store = new Map(); // layerId -> Map<id, feature>
        const calls = { merge: [], remove: [] };
        return {
            calls,
            store,
            present: presentSet,
            hasLayer: (id) => presentSet.has(id),
            mergeFeatures: (layerId, feats) => {
                calls.merge.push([layerId, feats]);
                let m = store.get(layerId);
                if (!m) {
                    m = new Map();
                    store.set(layerId, m);
                }
                for (const f of feats) m.set(String(f.id ?? f.properties?.id), f);
            },
            removeFeature: (layerId, id) => {
                calls.remove.push([layerId, id]);
                const m = store.get(layerId);
                return m ? m.delete(String(id)) : false;
            },
        };
    }

    /** Constructeur d'entrée d'outbox (forme d'`OutboxEntry`, telle que 4.4 l'écrit). */
    function rec(overrides = {}) {
        return {
            id: "op_1",
            kind: "create",
            layerId: "candelabres",
            localId: "user-poi-1",
            state: "pending",
            createdAt: 1,
            ...overrides,
        };
    }

    /** Magasin permissif : toute entité demandée existe et porte son `localId` en id. */
    const anyFeature = (_layerId, localId) =>
        Promise.resolve({
            feature: { type: "Feature", geometry: null, properties: {}, id: localId },
        });

    test("restaure les entités de TOUT producteur — plus de filtre par vocabulaire", async () => {
        // 🛑 L'INVERSE DE CE QUE CE TEST EXIGEAIT AVANT 4.7 : il vérifiait que les entrées de
        // l'éditeur soient écartées comme « foreign ». C'était le défaut.
        const layers = makeFakeLayers();
        const entries = [
            rec({ id: "s1", kind: "create", localId: "a" }),
            rec({ id: "s2", kind: "update", localId: "b" }),
            rec({ id: "s3", kind: "create", localId: "trace-editeur" }),
        ];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(result.merged).toBe(3);
        const ids = layers.calls.merge.flatMap(([, fs]) => fs.map((f) => f.id)).sort();
        expect(ids).toEqual(["a", "b", "trace-editeur"]);
    });

    test("ignores entries already synced", async () => {
        const layers = makeFakeLayers();
        const entries = [rec({ id: "s1", state: "synced", localId: "a" })];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(result.merged).toBe(0);
        expect(layers.calls.merge).toHaveLength(0);
    });

    test("drops and logs entries with a null host layer (never merges to null)", async () => {
        const layers = makeFakeLayers();
        const dropped = [];
        // No entry-level layerId and no poiData._layerConfig → null host layer.
        const entries = [
            {
                id: "s1",
                kind: "create",
                state: "pending",
                createdAt: 1,
                localId: "a",
            },
        ];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            logDropped: (msg, e) => dropped.push([msg, e]),
        });
        expect(result.skipped).toBe(1);
        expect(result.merged).toBe(0);
        expect(dropped).toHaveLength(1);
        expect(dropped[0][0]).toContain("layerId");
        expect(layers.calls.merge).toHaveLength(0);
    });

    test("une entrée `quarantined` RESTE à l'écran", async () => {
        // Le contrat dit qu'une entrée mise de côté « reste visible » ; la faire disparaître de
        // la carte serait la perte contre laquelle elle a été mise de côté.
        const layers = makeFakeLayers();
        const result = await restorePendingPois({
            getEntries: async () => [rec({ state: "quarantined" })],
            layers,
            readFeature: anyFeature,
        });
        expect(result.merged).toBe(1);
    });

    test("groups by layer and batches one mergeFeatures call per layer", async () => {
        const layers = makeFakeLayers(["layerA", "layerB"]);
        const entries = [
            rec({ id: "s1", layerId: "layerA", localId: "a1" }),
            rec({ id: "s2", layerId: "layerA", localId: "a2" }),
            rec({ id: "s3", layerId: "layerB", localId: "b1" }),
        ];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(result.merged).toBe(3);
        const byLayer = Object.fromEntries(layers.calls.merge.map(([l, fs]) => [l, fs.length]));
        expect(byLayer).toEqual({ layerA: 2, layerB: 1 });
        expect(layers.calls.merge).toHaveLength(2); // one batched call per layer
    });

    test("dedups by id and is idempotent across replays", async () => {
        const layers = makeFakeLayers(["candelabres"]);
        const entries = [
            rec({ id: "s1", createdAt: 1, localId: "dup" }),
            rec({ id: "s2", createdAt: 2, localId: "dup" }),
        ];
        await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(layers.store.get("candelabres").size).toBe(1);
        expect(layers.store.get("candelabres").has("dup")).toBe(true);
    });

    test("applies delete_poi via removeFeature", async () => {
        const layers = makeFakeLayers(["candelabres"]);
        layers.mergeFeatures("candelabres", [
            {
                type: "Feature",
                id: "x",
                properties: { id: "x" },
                geometry: { type: "Point", coordinates: [0, 0] },
            },
        ]);
        const entries = [rec({ id: "s1", kind: "delete", localId: "x" })];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(result.deleted).toBe(1);
        expect(layers.store.get("candelabres").has("x")).toBe(false);
    });

    test("collapses ops per id to the net op (last-write-wins by timestamp)", async () => {
        const layers = makeFakeLayers(["candelabres"]);
        // add then delete (delete has the later timestamp) → net = deleted.
        const entries = [
            rec({ id: "s1", kind: "create", createdAt: 1, localId: "z" }),
            rec({ id: "s2", kind: "delete", createdAt: 2, localId: "z" }),
        ];
        const result = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(result.deleted).toBe(1);
        expect(result.merged).toBe(0);
    });

    test("bakes _syncStatus 'pending' onto restored features (badge parity)", async () => {
        const layers = makeFakeLayers(["candelabres"]);
        const entries = [rec({ id: "s1", localId: "a" })];
        await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        const feature = layers.calls.merge[0][1][0];
        expect(feature.properties._syncStatus).toBe("pending");
    });

    test("defers layers not yet present, then catches them up on replay", async () => {
        const layers = makeFakeLayers([]); // no host layer present yet
        const entries = [rec({ id: "s1", layerId: "later", localId: "a" })];
        const r1 = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(r1.merged).toBe(0);
        expect(r1.deferredLayers).toContain("later");
        layers.present.add("later"); // host layer appears
        const r2 = await restorePendingPois({
            getEntries: async () => entries,
            layers,
            readFeature: anyFeature,
        });
        expect(r2.merged).toBe(1);
    });

    test("returns an empty result when the layer seam is absent", async () => {
        const saved = globalThis.GeoLeaf;
        delete globalThis.GeoLeaf;
        try {
            const result = await restorePendingPois({ getEntries: async () => [rec()] });
            expect(result).toEqual({ merged: 0, deleted: 0, skipped: 0, deferredLayers: [] });
        } finally {
            if (saved !== undefined) globalThis.GeoLeaf = saved;
        }
    });

    test("returns an empty result when the queue read rejects", async () => {
        const layers = makeFakeLayers();
        const result = await restorePendingPois({
            getEntries: async () => {
                throw new Error("DB error");
            },
            layers,
        });
        expect(result.merged).toBe(0);
        expect(result.deleted).toBe(0);
    });

    test("une entrée dont l'entité a disparu du magasin est comptée `skipped`", async () => {
        // La charge vient du magasin depuis 4.7 : une entrée qui nomme une entité absente ne
        // peut rien restaurer. Elle est ÉCARTÉE et comptée — jamais avalée en silence.
        const layers = makeFakeLayers(["candelabres"]);
        const result = await restorePendingPois({
            getEntries: async () => [rec({ id: "s1", localId: "fantome" })],
            layers,
            readFeature: () => Promise.resolve(null),
        });
        expect(result.merged).toBe(0);
        expect(result.skipped).toBe(1);
    });

    test("registerPoiRestore wires the boot listeners once and detaches on cleanup", async () => {
        let calls = 0;
        const layers = makeFakeLayers();
        const cleanup = registerPoiRestore({
            getEntries: async () => {
                calls++;
                return [];
            },
            layers,
        });
        document.dispatchEvent(new CustomEvent("geoleaf:layers:initial-loaded"));
        await new Promise((r) => setTimeout(r, 0));
        expect(calls).toBeGreaterThanOrEqual(1);

        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        await new Promise((r) => setTimeout(r, 0));
        expect(calls).toBeGreaterThanOrEqual(2);

        cleanup();
        const before = calls;
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        await new Promise((r) => setTimeout(r, 0));
        expect(calls).toBe(before); // no restore after detach
    });
});
