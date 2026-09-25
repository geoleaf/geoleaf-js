/**
 * Unit tests — `GeoLeaf.Layers.focus`: bring one feature into view and select it.
 *
 * The gesture a search result, a list row or a work order's "next" all end with. It frames
 * the feature — flies to a point, fits a line or a polygon — and sets its `selected`
 * feature-state, which the adapter paints (`maplibre-selection-paint.ts`).
 *
 * 🛑 ONE SELECTION AT A TIME. A focus that forgot the previous one would leave every feature
 * the user ever looked at highlighted, and the map would end up saying nothing. The previous
 * selection is therefore cleared first — on its own layer, which is not necessarily this one.
 * It is remembered per map adapter: a map recreated by `Core.destroy()` / `init()` starts
 * with none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi } from "../../src/contracts/layer-data.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

let api: LayerDataApi;
let adapter: {
    flyTo: ReturnType<typeof vi.fn>;
    fitBounds: ReturnType<typeof vi.fn>;
    setFeatureState: ReturnType<typeof vi.fn>;
    updateLayerData: ReturnType<typeof vi.fn>;
    applyDataDiff: ReturnType<typeof vi.fn>;
};

/** Seeds a layer through the production write path. */
function seed(layerId: string, features: GeoJSON.Feature[]) {
    GeoJSONShared.state.layers.set(layerId, { id: layerId, config: {} as never });
    api.setData(layerId, features);
}

const POINT = {
    type: "Feature" as const,
    id: "p1",
    geometry: { type: "Point" as const, coordinates: [5.5, 45.25] },
    properties: { id: "p1" },
};

const POLYGON = {
    type: "Feature" as const,
    geometry: {
        type: "Polygon" as const,
        coordinates: [
            [
                [1, 2],
                [3, 2],
                [3, 6],
                [1, 2],
            ],
        ],
    },
    properties: { id: "z1" },
};

beforeEach(() => {
    GeoJSONShared.reset();
    adapter = {
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        setFeatureState: vi.fn(),
        updateLayerData: vi.fn(),
        applyDataDiff: vi.fn(() => true),
    };
    GeoJSONShared.state.adapter = adapter as never;
    api = buildLayersPublicApi();
    seed("pts", [POINT]);
    seed("zones", [POLYGON]);
});

afterEach(() => {
    // No selection to clear by hand: it is remembered per adapter, and each test mounts a
    // fresh one — as a recreated map would.
    GeoJSONShared.reset();
    vi.restoreAllMocks();
});

describe("framing", () => {
    it("flies to a point", () => {
        expect(api.focus("pts", "p1")).toBe(true);
        expect(adapter.flyTo).toHaveBeenCalledWith({ lat: 45.25, lng: 5.5 }, 17);
        expect(adapter.fitBounds).not.toHaveBeenCalled();
    });

    it("honours an explicit zoom", () => {
        api.focus("pts", "p1", { zoom: 14 });
        expect(adapter.flyTo).toHaveBeenCalledWith({ lat: 45.25, lng: 5.5 }, 14);
    });

    it("fits a polygon's bounds", () => {
        expect(api.focus("zones", "z1")).toBe(true);
        expect(adapter.fitBounds).toHaveBeenCalledWith(
            { north: 6, south: 2, east: 3, west: 1 },
            expect.objectContaining({ animate: true })
        );
        expect(adapter.flyTo).not.toHaveBeenCalled();
    });

    it("answers false, and moves nothing, for a feature the layer does not hold", () => {
        expect(api.focus("pts", "absent")).toBe(false);
        expect(api.focus("no-such-layer", "p1")).toBe(false);
        expect(adapter.flyTo).not.toHaveBeenCalled();
        expect(adapter.fitBounds).not.toHaveBeenCalled();
        expect(adapter.setFeatureState).not.toHaveBeenCalled();
    });
});

describe("selection", () => {
    it("selects the feature it framed", () => {
        api.focus("pts", "p1");
        expect(adapter.setFeatureState).toHaveBeenCalledWith("pts", "p1", { selected: true });
    });

    it("clears the previous selection first — on its own layer", () => {
        api.focus("pts", "p1");
        adapter.setFeatureState.mockClear();
        api.focus("zones", "z1");
        expect(adapter.setFeatureState.mock.calls).toEqual([
            ["pts", "p1", { selected: false }],
            ["zones", "z1", { selected: true }],
        ]);
    });

    it("frames a feature with no id, and selects nothing it could not address", () => {
        seed("anon", [
            {
                type: "Feature",
                id: "top-only",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { name: "sans properties.id" },
            },
        ]);
        expect(api.focus("anon", "top-only")).toBe(true);
        expect(adapter.flyTo).toHaveBeenCalled();
        expect(adapter.setFeatureState).not.toHaveBeenCalledWith(
            "anon",
            expect.anything(),
            expect.anything()
        );
    });
});
