/**
 * A feature whose `selected` feature-state is set must be SEEN — on a point, a line and a
 * polygon outline, at creation AND after a re-style.
 *
 * `LayerFeatureState.selected` has been part of the public contract ("Selection halo") for
 * as long as `GeoLeaf.Layers.setFeatureState` has existed, and no shipped paint read it: the
 * only expression that did (`DEFAULT_UNCLUSTERED_PAINT`) belongs to a cluster renderer
 * nothing calls. `GeoLeaf.Layers.focus` sets it — a focus the user cannot see would be a
 * recentring, not a selection.
 *
 * Two paths build a paint, and both must carry it: `_addPointSubLayers` /
 * `_addLineSubLayers` at creation, and `applyLayerStyle` on every re-style (a theme switch,
 * `setLayerStyle`), which rebuilds the paint from scratch. The pending-sync badge was lost
 * exactly this way once — present at creation, gone at the first theme change.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", () => ({
    dispatchGeoLeafEvent: vi.fn(),
}));

import { MaplibreAdapter } from "../../src/adapters/maplibre/maplibre-adapter.js";

/** A layer definition as `addLayer` receives it, as far as these tests read it. */
interface LayerDef {
    id: string;
    paint?: Record<string, unknown>;
}

/** The map double: only `setPaintProperty` is read back; the rest just has to exist. */
interface MockMap {
    setPaintProperty: Mock;
    [member: string]: unknown;
}

const g = globalThis as unknown as { maplibregl?: unknown };

let map: MockMap;
let layers: Record<string, LayerDef>;

/** Whether an expression tests the `selected` feature-state anywhere inside it. */
function readsSelected(expr: unknown): boolean {
    return JSON.stringify(expr ?? null).includes('["feature-state","selected"]');
}

/** Whether an expression still carries the pending-sync badge. */
function readsSyncBadge(expr: unknown): boolean {
    return JSON.stringify(expr ?? null).includes('["feature-state","syncStatus"]');
}

/** The last value `setPaintProperty` wrote for a sub-layer's property. */
function lastPaint(subLayerId: string, prop: string): unknown {
    const calls = map.setPaintProperty.mock.calls.filter(
        (c: unknown[]) => c[0] === subLayerId && c[1] === prop
    );
    return calls.at(-1)?.[2];
}

beforeEach(() => {
    const sources: Record<string, Record<string, unknown>> = {};
    layers = {};
    map = {
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        getContainer: vi.fn(() => document.createElement("div")),
        getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
        addSource: vi.fn((id: string, cfg: Record<string, unknown>) => {
            sources[id] = { id, ...cfg, setData: vi.fn(), updateData: vi.fn() };
        }),
        getSource: vi.fn((id: string) => sources[id] || null),
        removeSource: vi.fn(),
        addLayer: vi.fn((def: LayerDef) => {
            layers[def.id] = def;
        }),
        getLayer: vi.fn((id: string) => layers[id] || null),
        removeLayer: vi.fn(),
        setLayoutProperty: vi.fn(),
        setPaintProperty: vi.fn(),
        setFilter: vi.fn(),
        setLayerZoomRange: vi.fn(),
        addImage: vi.fn(),
        hasImage: vi.fn(() => false),
        loaded: vi.fn(() => true),
        isStyleLoaded: vi.fn(() => true),
    };
    // A class, given to `vi.fn` itself: the adapter calls `new`.
    g.maplibregl = {
        Map: vi.fn(
            class {
                constructor() {
                    return map;
                }
            }
        ),
    };
});

afterEach(() => {
    delete g.maplibregl;
});

/** An adapter with one point, one line and one polygon layer on it. */
function adapterWithLayers(): MaplibreAdapter {
    const adapter = new MaplibreAdapter();
    adapter.init({ container: "map", center: { lat: 0, lng: 0 }, zoom: 10 });
    const fc = (geometry: { type: string; coordinates: unknown }) => ({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry, properties: { id: "f1" } }],
    });
    adapter.addGeoJSONLayer("pts", fc({ type: "Point", coordinates: [0, 0] }));
    adapter.addGeoJSONLayer(
        "lines",
        fc({
            type: "LineString",
            coordinates: [
                [0, 0],
                [1, 1],
            ],
        })
    );
    adapter.addGeoJSONLayer(
        "zones",
        fc({
            type: "Polygon",
            coordinates: [
                [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 0],
                ],
            ],
        })
    );
    return adapter;
}

describe("at creation", () => {
    it("a point shows its selection on the circle stroke, badge kept inside", () => {
        adapterWithLayers();
        const paint = layers["gl-pts-circle"]?.paint;
        expect(readsSelected(paint?.["circle-stroke-color"])).toBe(true);
        expect(readsSelected(paint?.["circle-stroke-width"])).toBe(true);
        expect(readsSyncBadge(paint?.["circle-stroke-color"])).toBe(true);
    });

    it("a line and a polygon outline show it on their stroke", () => {
        adapterWithLayers();
        for (const id of ["gl-lines-line", "gl-zones-line"]) {
            expect(readsSelected(layers[id]?.paint?.["line-color"])).toBe(true);
            expect(readsSelected(layers[id]?.paint?.["line-width"])).toBe(true);
        }
    });
});

describe("after a re-style, which rebuilds the paint", () => {
    it("the point still shows it, and so do the line and the outline", () => {
        const adapter = adapterWithLayers();
        adapter.setLayerStyle("pts", { fillColor: "#ff0000", color: "#000000" });
        adapter.setLayerStyle("lines", { color: "#00ff00", weight: 3 });
        adapter.setLayerStyle("zones", { color: "#0000ff", fillColor: "#0000ff" });
        expect(readsSelected(lastPaint("gl-pts-circle", "circle-stroke-color"))).toBe(true);
        expect(readsSyncBadge(lastPaint("gl-pts-circle", "circle-stroke-color"))).toBe(true);
        expect(readsSelected(lastPaint("gl-lines-line", "line-color"))).toBe(true);
        expect(readsSelected(lastPaint("gl-lines-line", "line-width"))).toBe(true);
        expect(readsSelected(lastPaint("gl-zones-line", "line-color"))).toBe(true);
    });
});
