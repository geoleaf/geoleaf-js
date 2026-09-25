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
 * feed the source themselves. The direct path stays for a layer the store does not hold
 * (vector tiles), or a core without the seam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    commitHostGeometry,
    removeHostFeature,
    resetHostReconcile,
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
    return {
        facade: { setLayerFilter, updateLayerData },
        nativeMap: { getSource: vi.fn(() => ({ serialize: () => ({ data: sourceFc }) })) },
        setLayerFilter,
        updateLayerData,
    };
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

describe("the direct path stays where the store cannot answer", () => {
    it("a layer the store does not hold is rewritten at the source, as before", () => {
        mountStore({});
        const deps = makeDeps({ type: "FeatureCollection", features: [pt("f1", 0)] });
        commitHostGeometry(deps, "VT", "f1", { type: "Point", coordinates: [9, 9] });
        expect(deps.updateLayerData).toHaveBeenCalledTimes(1);
    });
});
