/**
 * Host reconciliation writes the LAYER STORE, not only the map source.
 *
 * The core keeps, per layer, the collection its source was last fed (`GeoLeaf.Layers`), and
 * everything that reads a layer reads that store: the layer search, `getFeatureById`, the
 * filter when it re-feeds a layer, the table. Saving a moved geometry or a deletion used to
 * rewrite the MapLibre source directly — `Core.getMap().updateLayerData` — and leave the
 * store as it was. The map showed the edit; the search then recentred on the OLD position,
 * and found a deleted feature again.
 *
 * A second defect rode on the same path: it rewrote the source from what the source HELD,
 * and while a filter is active the source holds a subset. Saving an edit then froze that
 * subset as the layer's whole data.
 *
 * The store is written through its unit mutations (`mergeFeatures`, `removeFeature`), which
 * feed the source themselves. A feature the store does not hold (a vector-tile layer keeps
 * none) is only shown back: the direct path that stayed for it was removed on 27/09/2026 — it
 * looked for a source name the core never uses, and would have re-frozen a filtered subset.
 *
 * 🛑 A CREATION reaches the store too (`addHostFeature`), under the identity its write
 * returned. It used not to: nothing could find, move or delete it until the next load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    addHostFeature,
    commitHostGeometry,
    hideHostFeature,
    removeHostFeature,
    resetHostReconcile,
    showHostFeature,
    type HostReconcileDeps,
} from "../selection/host-reconcile.js";

type F = { type: "Feature"; id?: string; geometry: unknown; properties: Record<string, unknown> };

const _g = globalThis as any;

/** A minimal layer store with the semantics the core's `GeoLeaf.Layers` has. */
function mountStore(layers: Record<string, F[]>) {
    const idOf = (f: F) => String(f.properties?.id ?? f.id);
    const api = {
        hasLayer: vi.fn((layerId: string) => layerId in layers),
        getFeatureById: vi.fn(
            (layerId: string, id: string) => layers[layerId]?.find((f) => idOf(f) === id) ?? null
        ),
        mergeFeatures: vi.fn((layerId: string, incoming: F[]) => {
            const list = layers[layerId] ?? [];
            for (const f of incoming) {
                const at = list.findIndex((g) => idOf(g) === idOf(f));
                if (at >= 0) list[at] = f;
                else list.push(f);
            }
        }),
        removeFeature: vi.fn((layerId: string, id: string) => {
            const list = layers[layerId] ?? [];
            const at = list.findIndex((f) => idOf(f) === id);
            if (at < 0) return false;
            list.splice(at, 1);
            return true;
        }),
    };
    _g.GeoLeaf = { Layers: api };
    return api;
}

/** The map-side collaborators; the native source holds `sourceFc`. */
function makeDeps(sourceFc: unknown): HostReconcileDeps & {
    setLayerFilter: ReturnType<typeof vi.fn>;
    updateLayerData: ReturnType<typeof vi.fn>;
} {
    const setLayerFilter = vi.fn();
    const updateLayerData = vi.fn();
    // A source that answers under any name, and an `updateLayerData` on the facade: a rewrite
    // through the map would be SEEN.
    const facade = { setLayerFilter, updateLayerData };
    const deps = {
        facade,
        nativeMap: { getSource: vi.fn(() => ({ serialize: () => ({ data: sourceFc }) })) },
    };
    return { ...deps, setLayerFilter, updateLayerData };
}

const pt = (id: string, x: number): F => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [x, 0] },
    properties: { id, name: id },
});

beforeEach(() => resetHostReconcile());
afterEach(() => {
    delete _g.GeoLeaf;
});

describe("a saved geometry reaches the store", () => {
    it("the store holds the NEW geometry, properties kept, and the filter is cleared", () => {
        const layers = { L: [pt("f1", 0), pt("f2", 1)] };
        mountStore(layers);
        const deps = makeDeps({ type: "FeatureCollection", features: [...layers.L] });

        commitHostGeometry(deps, "L", "f1", { type: "Point", coordinates: [9, 9] });

        const f1 = layers.L.find((f) => f.properties.id === "f1");
        expect(f1?.geometry).toEqual({ type: "Point", coordinates: [9, 9] });
        expect(f1?.properties.name).toBe("f1");
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
    });

    it("does not freeze a filtered subset: the source's partial content is never written back", () => {
        const layers = { L: [pt("f1", 0), pt("f2", 1)] };
        mountStore(layers);
        // A filter is active: the SOURCE holds f1 only, the store holds both.
        const deps = makeDeps({ type: "FeatureCollection", features: [pt("f1", 0)] });

        commitHostGeometry(deps, "L", "f1", { type: "Point", coordinates: [9, 9] });

        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(layers.L.map((f) => f.properties.id)).toEqual(["f1", "f2"]);
    });
});

describe("a deletion reaches the store", () => {
    it("the store no longer holds the feature, and the filter is cleared", () => {
        const layers = { L: [pt("f1", 0), pt("f2", 1)] };
        mountStore(layers);
        const deps = makeDeps({ type: "FeatureCollection", features: [...layers.L] });

        removeHostFeature(deps, "L", "f1");

        expect(layers.L.map((f) => f.properties.id)).toEqual(["f2"]);
        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
    });
});

describe("where the store cannot answer, nothing is rewritten at the source", () => {
    it("🛑 a layer the store does not hold is shown back, its source untouched", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mountStore({});
        const deps = makeDeps({ type: "FeatureCollection", features: [pt("f1", 0)] });
        commitHostGeometry(deps, "VT", "f1", { type: "Point", coordinates: [9, 9] });
        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("VT", null);
        warn.mockRestore();
    });

    it("a vector-tile layer says the tiles carry the edit once fetched again — not a warning", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        mountStore({});
        _g.GeoLeaf.GeoJSON = { getLayerById: () => ({ isVectorTile: true }) };
        removeHostFeature(makeDeps(null), "VT", "f1");
        expect(info).toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        info.mockRestore();
        warn.mockRestore();
    });
});

// 🛑 Hiding an edited original through the core's `hideFeatures` (3.12.0), never through the
// layer's filter: written directly, the hide REPLACED the panel's filter — selecting a feature
// under an active filter put every filtered-out feature back, and releasing it cleared the
// filter outright (`e2e/69`). An older core has no `hideFeatures`: the direct filter stays.
describe("the edited original is hidden without touching the layer's filter", () => {
    it("🛑 hide and show go through `GeoLeaf.Layers.hideFeatures` when the core has it", () => {
        const api = mountStore({ L: [pt("f1", 0)] });
        const hideFeatures = vi.fn();
        Object.assign(api, { hideFeatures });
        const deps = makeDeps(null);

        hideHostFeature(deps, "L", "f1");
        showHostFeature(deps, "L");

        expect(hideFeatures.mock.calls).toEqual([
            ["L", ["f1"]],
            ["L", null],
        ]);
        expect(deps.setLayerFilter).not.toHaveBeenCalled();
    });

    it("an older core without it: the layer's filter, as before", () => {
        mountStore({ L: [pt("f1", 0)] });
        const deps = makeDeps(null);
        hideHostFeature(deps, "L", "f1");
        showHostFeature(deps, "L");
        expect(deps.setLayerFilter).toHaveBeenCalledTimes(2);
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
    });
});

describe("🛑 a CREATED feature enters its layer's store", () => {
    const SAVED = {
        id: "loc:abc",
        geometry: { type: "Point", coordinates: [5, 5] },
        properties: { name: "Nouveau" },
    };

    it("under its identity, in `id` AND `properties.id` — what the map and the lookups read", () => {
        const layers: Record<string, F[]> = { L: [pt("f1", 0)] };
        const api = mountStore(layers);

        expect(addHostFeature("L", SAVED)).toBe(true);

        expect(api.mergeFeatures).toHaveBeenCalledTimes(1);
        const held = api.getFeatureById("L", "loc:abc");
        expect(held).toEqual({
            type: "Feature",
            id: "loc:abc",
            geometry: SAVED.geometry,
            properties: { name: "Nouveau", id: "loc:abc" },
        });
        expect(layers.L).toHaveLength(2);
    });

    it("idempotent: hosting the same identity twice keeps ONE feature", () => {
        const layers: Record<string, F[]> = { L: [] };
        mountStore(layers);

        addHostFeature("L", SAVED);
        addHostFeature("L", SAVED);

        expect(layers.L).toHaveLength(1);
    });

    it("refused without an identity — a backend answering a creation without one", () => {
        const api = mountStore({ L: [] });
        expect(addHostFeature("L", { ...SAVED, id: "" })).toBe(false);
        expect(api.mergeFeatures).not.toHaveBeenCalled();
    });

    it("refused on a layer the store does not hold — a merge there would REPLACE its source", () => {
        const api = mountStore({ L: [] });
        expect(addHostFeature("other", SAVED)).toBe(false);
        expect(api.mergeFeatures).not.toHaveBeenCalled();
    });

    it("refused on a vector-tile layer — its store holds no feature, by construction", () => {
        const api = mountStore({ L: [] });
        _g.GeoLeaf.GeoJSON = { getLayerById: vi.fn(() => ({ isVectorTile: true })) };
        expect(addHostFeature("L", SAVED)).toBe(false);
        expect(api.mergeFeatures).not.toHaveBeenCalled();
    });

    it("a GeoJSON layer that DECLARES tiles but did not load as tiles is hosted", () => {
        // The profile's `vectorTiles` block with `enabled: false` — only the runtime flag says.
        mountStore({ L: [] });
        _g.GeoLeaf.GeoJSON = { getLayerById: vi.fn(() => ({ isVectorTile: false })) };
        expect(addHostFeature("L", SAVED)).toBe(true);
    });

    it("refused without a store — a core without the seam", () => {
        _g.GeoLeaf = {};
        expect(addHostFeature("L", SAVED)).toBe(false);
    });
});
