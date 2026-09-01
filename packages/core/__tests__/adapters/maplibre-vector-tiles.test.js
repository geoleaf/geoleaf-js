/**
 * Unit tests for adapters/maplibre/maplibre-vector-tiles — the engine-side vector-tile
 * builder that the `vector-tiles` capability delegates to (socle B.1). Covers the source
 * assembly (scheme), geometry → sub-layer mapping, registry registration, and the paint
 * update path — the logic that moved out of the VT capability.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    buildVectorTileLayer,
    updateVectorTileLayerStyle,
} from "../../src/adapters/maplibre/maplibre-vector-tiles.js";

function makeMap() {
    const layers = new Set();
    return {
        addSource: vi.fn(),
        getSource: vi.fn(() => undefined),
        getLayer: vi.fn((id) => (layers.has(id) ? { id } : undefined)),
        addLayer: vi.fn((spec) => layers.add(spec.id)),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        setPaintProperty: vi.fn(),
    };
}

describe("adapters/maplibre-vector-tiles — buildVectorTileLayer (socle B.1)", () => {
    let map;
    let registry;
    let ensureSentinel;

    beforeEach(() => {
        map = makeMap();
        registry = { register: vi.fn() };
        ensureSentinel = vi.fn();
    });

    const spec = (over = {}) => ({
        tileUrl: "https://x/{z}/{x}/{y}.pbf",
        sourceLayer: "poi",
        geometryType: "point",
        zIndex: 0,
        source: {},
        style: {},
        ...over,
    });

    it("adds a native vector source with scheme:'tms' when configured", () => {
        buildVectorTileLayer(
            map,
            registry,
            ensureSentinel,
            "rp",
            spec({ source: { scheme: "tms" } })
        );
        expect(map.addSource).toHaveBeenCalledTimes(1);
        expect(map.addSource.mock.calls[0][1]).toMatchObject({ type: "vector", scheme: "tms" });
    });

    it("omits scheme when not 'tms' (MapLibre xyz default)", () => {
        buildVectorTileLayer(map, registry, ensureSentinel, "rp", spec({ source: {} }));
        expect(map.addSource.mock.calls[0][1].scheme).toBeUndefined();
    });

    it("point geometry → circle sub-layer, registered, ids returned", () => {
        const ids = buildVectorTileLayer(map, registry, ensureSentinel, "rp", spec());
        expect(ensureSentinel).toHaveBeenCalled();
        expect(map.addLayer).toHaveBeenCalledTimes(1);
        expect(map.addLayer.mock.calls[0][0]).toMatchObject({
            type: "circle",
            "source-layer": "poi",
        });
        expect(ids).toEqual(["gl-rp-circle"]);
        expect(registry.register).toHaveBeenCalledWith("rp", ["circle"], 0, {
            isVectorTile: true,
            sourceLayer: "poi",
        });
    });

    it("polygon geometry → fill + line sub-layers", () => {
        const ids = buildVectorTileLayer(
            map,
            registry,
            ensureSentinel,
            "rp",
            spec({ geometryType: "polygon" })
        );
        const types = map.addLayer.mock.calls.map((c) => c[0].type);
        expect(types).toContain("fill");
        expect(types).toContain("line");
        expect(ids.length).toBeGreaterThanOrEqual(2);
    });

    it("fill-extrusion geometry → a single extrusion sub-layer carrying extrusion paint", () => {
        const ids = buildVectorTileLayer(
            map,
            registry,
            ensureSentinel,
            "rp",
            spec({
                geometryType: "fill-extrusion",
                style: {
                    defaultStyle: {
                        fillColor: "#f00",
                        fillExtrusionColor: "#0f0",
                        fillExtrusionHeight: 12,
                    },
                },
            })
        );
        expect(ids).toEqual(["gl-rp-fill-extrusion"]);
        const [layerSpec] = map.addLayer.mock.calls[0];
        expect(layerSpec.type).toBe("fill-extrusion");
        // The build path resolves paint through the same suffix dispatch as the
        // update path, so it inherits the same anchoring requirement.
        expect(Object.keys(layerSpec.paint)).toContain("fill-extrusion-color");
        expect(Object.keys(layerSpec.paint)).not.toContain("fill-color");
    });

    it("casing sub-layer is created before the line, and only when casing is enabled", () => {
        const withCasing = spec({
            geometryType: "linestring",
            style: { defaultStyle: { color: "#000", weight: 2, casing: { enabled: true } } },
        });
        const ids = buildVectorTileLayer(map, registry, ensureSentinel, "rp", withCasing);
        expect(ids).toEqual(["gl-rp-casing", "gl-rp-line"]);

        const map2 = makeMap();
        const ids2 = buildVectorTileLayer(
            map2,
            { register: vi.fn() },
            vi.fn(),
            "rp",
            spec({
                geometryType: "linestring",
                style: { defaultStyle: { color: "#000", casing: { enabled: false } } },
            })
        );
        expect(ids2).toEqual(["gl-rp-line"]);
    });
});

describe("adapters/maplibre-vector-tiles — updateVectorTileLayerStyle", () => {
    it("sets paint properties on existing sub-layers", () => {
        const map = makeMap();
        map.getLayer = vi.fn(() => ({ id: "x" })); // all sub-layers exist
        updateVectorTileLayerStyle(map, "rp", ["gl-rp-fill"], {
            defaultStyle: { fillColor: "#f00" },
        });
        expect(map.setPaintProperty).toHaveBeenCalled();
    });

    it("skips sub-layers that don't exist on the map", () => {
        const map = makeMap();
        map.getLayer = vi.fn(() => undefined);
        updateVectorTileLayerStyle(map, "rp", ["gl-rp-fill"], { defaultStyle: {} });
        expect(map.setPaintProperty).not.toHaveBeenCalled();
    });

    // ── Sub-layer id → paint dispatch, per id suffix (backlog B.17) ──────────────
    //
    // The dispatch keys off the sub-layer id SUFFIX. `gl-rp-fill-extrusion` and
    // `gl-rp-fill` are distinguishable only because the match is ANCHORED at the end:
    // a substring match ("-fill" is contained in "-fill-extrusion") routes the
    // extrusion sub-layer to the fill branch and paints it with `fill-*` properties
    // MapLibre silently ignores on a fill-extrusion layer — no throw, no visual
    // extrusion. These tests pin the anchoring so a refactor of the dispatch cannot
    // reintroduce it.

    /** Collects the paint property NAMES written for a single sub-layer update. */
    function paintPropsFor(subId, style) {
        const map = makeMap();
        map.getLayer = vi.fn(() => ({ id: subId }));
        updateVectorTileLayerStyle(map, "rp", [subId], style);
        return map.setPaintProperty.mock.calls.map((c) => c[1]);
    }

    it("routes -fill-extrusion to the extrusion paint, never to the fill paint", () => {
        const props = paintPropsFor("gl-rp-fill-extrusion", {
            defaultStyle: {
                fillColor: "#f00",
                fillExtrusionColor: "#0f0",
                fillExtrusionHeight: 12,
            },
        });
        expect(props).toContain("fill-extrusion-color");
        expect(props).toContain("fill-extrusion-height");
        // The decisive assertion: "-fill" must NOT match "gl-rp-fill-extrusion".
        expect(props).not.toContain("fill-color");
        expect(props).not.toContain("fill-outline-color");
    });

    it("routes -fill to the fill paint, never to the extrusion paint", () => {
        const props = paintPropsFor("gl-rp-fill", {
            defaultStyle: { fillColor: "#f00", fillExtrusionColor: "#0f0" },
        });
        expect(props).toContain("fill-color");
        expect(props.some((p) => p.startsWith("fill-extrusion-"))).toBe(false);
    });

    it("skips a -casing sub-layer whose casing is disabled (no paint written)", () => {
        const props = paintPropsFor("gl-rp-casing", {
            defaultStyle: { color: "#000", casing: { enabled: false, color: "#fff" } },
        });
        expect(props).toEqual([]);
    });

    it("paints a -casing sub-layer from the casing config when enabled", () => {
        const props = paintPropsFor("gl-rp-casing", {
            defaultStyle: { weight: 2, casing: { enabled: true, color: "#fff", widthPx: 3 } },
        });
        expect(props).toContain("line-color");
        expect(props).toContain("line-width");
    });

    it("routes -circle and -line to their own paints", () => {
        expect(paintPropsFor("gl-rp-circle", { defaultStyle: { radius: 7 } })).toContain(
            "circle-radius"
        );
        expect(paintPropsFor("gl-rp-line", { defaultStyle: { weight: 4 } })).toContain(
            "line-width"
        );
    });

    it("ignores a sub-layer id with an unknown suffix", () => {
        expect(paintPropsFor("gl-rp-symbol", { defaultStyle: { fillColor: "#f00" } })).toEqual([]);
    });
});

// ── Stale sub-layer cleanup (CAPACITÉS B.44) ────────────────────────────────────
//
// `_removeStaleVtSource` runs at the top of every rebuild (rapid basemap switching,
// theme change) and must drop the sub-layers the PREVIOUS cycle created. Its id list
// was written by hand and drifted from the builder's: it purged `gl-<id>-line-casing`
// while `_addVtSubLayer(ctx, "casing", "line")` produces `gl-<id>-casing` via
// `toSubLayerId` (LAYER_PREFIX + layerId + "-" + TYPE, not the MapLibre type). The
// casing sub-layer therefore survived every rebuild, and `removeSource` then ran with
// a layer still referencing the source.
describe("adapters/maplibre-vector-tiles — stale sub-layer cleanup (B.44)", () => {
    let map;
    let registry;
    let ensureSentinel;

    /** A map whose style already holds the sub-layers of a previous cycle. */
    function mapWithExisting(existingIds) {
        const layers = new Set(existingIds);
        return {
            addSource: vi.fn(),
            // A source left over is what makes the cleanup path run at all.
            getSource: vi.fn(() => ({ type: "vector" })),
            getLayer: vi.fn((id) => (layers.has(id) ? { id } : undefined)),
            addLayer: vi.fn((spec) => layers.add(spec.id)),
            removeLayer: vi.fn((id) => layers.delete(id)),
            removeSource: vi.fn(),
            setPaintProperty: vi.fn(),
        };
    }

    beforeEach(() => {
        registry = { register: vi.fn() };
        ensureSentinel = vi.fn();
    });

    const lineSpec = () => ({
        tileUrl: "https://x/{z}/{x}/{y}.pbf",
        sourceLayer: "roads",
        geometryType: "line",
        zIndex: 0,
        source: {},
        style: { casing: { enabled: true, color: "#000", weight: 6 } },
    });

    it("removes the casing sub-layer the builder actually created", () => {
        map = mapWithExisting(["gl-rp-casing", "gl-rp-line"]);

        buildVectorTileLayer(map, registry, ensureSentinel, "rp", lineSpec());

        const removed = map.removeLayer.mock.calls.map(([id]) => id);
        expect(removed).toContain("gl-rp-casing");
    });

    it("never purges an id the builder cannot produce", () => {
        // `gl-<id>-line-casing` and `gl-<id>-symbol` were both in the hand-written list;
        // neither is a shape `toSubLayerId` can emit for a vector-tile sub-layer.
        map = mapWithExisting(["gl-rp-line-casing", "gl-rp-symbol"]);

        buildVectorTileLayer(map, registry, ensureSentinel, "rp", lineSpec());

        const removed = map.removeLayer.mock.calls.map(([id]) => id);
        expect(removed).not.toContain("gl-rp-line-casing");
        expect(removed).not.toContain("gl-rp-symbol");
    });

    it("leaves no sub-layer of the previous cycle behind before dropping the source", () => {
        const previous = ["gl-rp-casing", "gl-rp-line", "gl-rp-fill", "gl-rp-circle"];
        map = mapWithExisting(previous);

        buildVectorTileLayer(map, registry, ensureSentinel, "rp", lineSpec());

        const removed = map.removeLayer.mock.calls.map(([id]) => id);
        for (const id of previous) expect(removed).toContain(id);
    });

    // The guard that makes the drift structural rather than a matter of vigilance:
    // whatever the builders create for ANY geometry type, the next rebuild must remove.
    // Derived by running the builders, not by reading their source — so a new sub-layer
    // type added without extending the cleanup fails here without a test to write.
    it.each(["point", "line", "polygon", "fill-extrusion"])(
        "removes on rebuild every sub-layer it created for geometryType=%s",
        (geometryType) => {
            const style = {
                casing: { enabled: true, color: "#000", weight: 6 },
                // `fillExtrusionHeight`/`Color` are mandatory for the fill-extrusion
                // geometry (maplibre-extrusion-validator.ts) and are read off the
                // FLATTENED style, i.e. from `defaultStyle` — not from a sibling key.
                defaultStyle: {
                    fillColor: "#f00",
                    radius: 5,
                    weight: 2,
                    fillExtrusionHeight: 12,
                    fillExtrusionColor: "#abc",
                },
            };
            const build = (m) =>
                buildVectorTileLayer(m, registry, ensureSentinel, "rp", {
                    tileUrl: "https://x/{z}/{x}/{y}.pbf",
                    sourceLayer: "s",
                    geometryType,
                    zIndex: 0,
                    source: {},
                    style,
                });

            // Cycle 1 — no stale source, so nothing is purged; collect what gets created.
            const first = makeMap();
            const created = build(first);
            expect(created.length).toBeGreaterThan(0);

            // Cycle 2 — the style already holds cycle 1's sub-layers and its source.
            const second = mapWithExisting(created);
            build(second);

            const removed = second.removeLayer.mock.calls.map(([id]) => id);
            for (const id of created) expect(removed).toContain(id);
        }
    );
});
