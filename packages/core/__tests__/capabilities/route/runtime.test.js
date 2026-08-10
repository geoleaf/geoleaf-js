/**
 * Unit tests — capabilities/route config + resolver + endpoint-deriver + apply +
 * lifecycle (S11). The route capability decorates a bound polyline layer with
 * start / end endpoint markers derived from its line features. The line itself is
 * rendered by the GeoJSON engine; the capability only adds the endpoints.
 *
 * The runtime seams (`Config.get`, `Core.getMap`, `Layers.getFeatures`) are typed
 * imports of the core singletons — mocked here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const { configGet, coreGetMap, layersGetFeatures } = vi.hoisted(() => ({
    configGet: vi.fn(),
    coreGetMap: vi.fn(),
    layersGetFeatures: vi.fn(),
}));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: (...a) => coreGetMap(...a) },
}));
vi.mock("../../../src/api/geoleaf.layers.js", () => ({
    Layers: { getFeatures: (...a) => layersGetFeatures(...a) },
}));

const { getRouteConfig } = await import("../../../src/capabilities/route/config.ts");
const { resolveLayerBinding, resolveEndpointConfig } = await import(
    "../../../src/capabilities/route/resolver.ts"
);
const { deriveEndpoints } = await import("../../../src/capabilities/route/endpoint-deriver.ts");
const { applyToLayer, endpointsLayerId } = await import("../../../src/capabilities/route/apply.ts");
const { RouteLifecycle } = await import("../../../src/capabilities/route/lifecycle.ts");

const CONFIG = {
    enabled: true,
    layers: {
        routes: { start: { fillColor: "#111111" }, end: { fillColor: "#222222" } },
        oneway: { showEnd: false },
    },
};

/** A LineString feature. */
function line(id, coords) {
    return {
        type: "Feature",
        id,
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
    };
}

/** A recording mock adapter (addGeoJSONLayer + removeLayer). */
function makeAdapter() {
    const added = [];
    const removed = [];
    return {
        adapter: {
            addGeoJSONLayer: (id, data, style) => added.push({ id, data, style }),
            removeLayer: (id) => removed.push(id),
        },
        added,
        removed,
    };
}

afterEach(() => {
    RouteLifecycle._reset();
    configGet.mockReset();
    coreGetMap.mockReset();
    layersGetFeatures.mockReset();
});

describe("getRouteConfig", () => {
    it("returns disabled defaults when config is absent", () => {
        configGet.mockImplementation((_k, d) => d);
        expect(getRouteConfig()).toEqual({ enabled: false });
    });
    it("merges modules.route over defaults", () => {
        configGet.mockImplementation((k, d) => (k === "modules.route" ? CONFIG : d));
        expect(getRouteConfig().enabled).toBe(true);
        expect(getRouteConfig().layers?.routes).toBeDefined();
    });
});

describe("resolveLayerBinding / resolveEndpointConfig", () => {
    it("returns null for an unbound layer", () => {
        expect(resolveLayerBinding(CONFIG, "unbound")).toBeNull();
    });
    it("returns the binding for a bound layer", () => {
        expect(resolveLayerBinding(CONFIG, "routes")).toEqual(CONFIG.layers.routes);
    });
    it("applies defaults — both endpoints shown, blue start / orange end", () => {
        const cfg = resolveEndpointConfig({});
        expect(cfg.showStart).toBe(true);
        expect(cfg.showEnd).toBe(true);
        expect(cfg.startStyle.fillColor).toBe("#2b7cff");
        expect(cfg.endStyle.fillColor).toBe("#ff7b32");
    });
    it("honours per-binding overrides", () => {
        const cfg = resolveEndpointConfig({ showEnd: false, start: { fillColor: "#123456" } });
        expect(cfg.showEnd).toBe(false);
        expect(cfg.startStyle.fillColor).toBe("#123456");
    });
});

describe("deriveEndpoints", () => {
    it("derives the first vertex as start", () => {
        const fc = deriveEndpoints(
            [
                line("r1", [
                    [0, 0],
                    [1, 1],
                    [2, 2],
                ]),
            ],
            "start"
        );
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [0, 0] });
        expect(fc.features[0].properties.role).toBe("start");
        expect(fc.features[0].properties.routeId).toBe("r1");
    });
    it("derives the last vertex as end", () => {
        const fc = deriveEndpoints(
            [
                line("r1", [
                    [0, 0],
                    [2, 2],
                ]),
            ],
            "end"
        );
        expect(fc.features[0].geometry.coordinates).toEqual([2, 2]);
    });
    it("handles MultiLineString (first of first seg / last of last seg)", () => {
        const multi = {
            type: "Feature",
            id: "m",
            geometry: {
                type: "MultiLineString",
                coordinates: [
                    [
                        [0, 0],
                        [1, 1],
                    ],
                    [
                        [5, 5],
                        [9, 9],
                    ],
                ],
            },
            properties: {},
        };
        expect(deriveEndpoints([multi], "start").features[0].geometry.coordinates).toEqual([0, 0]);
        expect(deriveEndpoints([multi], "end").features[0].geometry.coordinates).toEqual([9, 9]);
    });
    it("skips non-line features", () => {
        const pt = {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {},
        };
        expect(deriveEndpoints([pt], "start").features).toHaveLength(0);
    });
});

describe("applyToLayer", () => {
    const oneLine = () => [
        line("r1", [
            [0, 0],
            [2, 2],
        ]),
    ];

    // R.38 — start and end share ONE layer, and therefore one MapLibre source. The
    // two kinds are told apart by `properties.role` and styled by a data-driven rule.
    it("adds a single endpoints layer carrying both roles for a bound line layer", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added).toHaveLength(1);
        expect(added[0].id).toBe(endpointsLayerId("routes"));
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
    });
    it("styles the end role through a data-driven rule, not a second layer", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        const { style } = added[0];
        // Base style = start; `role == "end"` overrides it.
        expect(style.fillColor).toBe(CONFIG.layers.routes.start.fillColor);
        expect(style.styleRules).toEqual([
            {
                when: { field: "role", operator: "==", value: "end" },
                style: expect.objectContaining({
                    fillColor: CONFIG.layers.routes.end.fillColor,
                }),
            },
        ]);
    });
    it("respects showEnd: false (start only, still one layer)", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "oneway", ["LineString"]);
        expect(added).toHaveLength(1);
        expect(added[0].id).toBe(endpointsLayerId("oneway"));
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start"]);
    });
    it("is a no-op for unbound layers", () => {
        const { adapter, added } = makeAdapter();
        applyToLayer(adapter, CONFIG, "unbound", ["LineString"]);
        expect(added).toHaveLength(0);
    });
    it("is a no-op for non-line layers", () => {
        const { adapter, added } = makeAdapter();
        applyToLayer(adapter, CONFIG, "routes", ["Point"]);
        expect(added).toHaveLength(0);
    });
    it("clears previous endpoints before re-adding (idempotent)", () => {
        const { adapter, removed } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(removed).toContain(endpointsLayerId("routes"));
    });
});

describe("RouteLifecycle", () => {
    function installAdapter(layerIds, geom) {
        configGet.mockImplementation((k, d) => (k === "modules.route" ? CONFIG : d));
        const added = [];
        coreGetMap.mockReturnValue({
            addGeoJSONLayer: (id, data, style) => added.push({ id, data, style }),
            removeLayer: () => {},
            getLayerRegistry: () => ({
                getAllLayerIds: () => layerIds,
                getGeometryTypes: (id) => (geom[id] ? new Set(geom[id]) : undefined),
            }),
        });
        return added;
    }

    it("decorates a bound line layer on geoleaf:layer:added (deferred to a microtask)", async () => {
        layersGetFeatures.mockReturnValue([
            line("r1", [
                [0, 0],
                [2, 2],
            ]),
        ]);
        const added = installAdapter([], {});
        RouteLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:layer:added", {
                detail: {
                    layerId: "routes",
                    sourceId: "gl-src-routes",
                    geometryTypes: ["LineString"],
                },
            })
        );
        // Deferred: `geoleaf:layer:added` is dispatched before the loader writes the
        // layer's features into the `Layers` seam, so endpoints are derived on the
        // next microtask — nothing yet synchronously, present after the flush. This
        // is what makes a layer loaded AFTER boot (theme switch / manual enable) get
        // its endpoints, not only the boot layers caught by the map:ready sweep.
        expect(added).toHaveLength(0);
        await Promise.resolve();
        expect(added.map((a) => a.id)).toContain(endpointsLayerId("routes"));
    });

    it("sweeps existing layers on geoleaf:map:ready", () => {
        layersGetFeatures.mockReturnValue([
            line("r1", [
                [0, 0],
                [2, 2],
            ]),
        ]);
        const added = installAdapter(["routes"], { routes: ["LineString"] });
        RouteLifecycle.init();
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        expect(added.map((a) => a.id)).toContain(endpointsLayerId("routes"));
    });

    it("is inert when the capability is disabled (graceful degradation)", () => {
        layersGetFeatures.mockReturnValue([
            line("r1", [
                [0, 0],
                [2, 2],
            ]),
        ]);
        configGet.mockImplementation(() => ({ enabled: false }));
        const added = [];
        coreGetMap.mockReturnValue({
            addGeoJSONLayer: (id) => added.push(id),
            getLayerRegistry: () => null,
        });
        RouteLifecycle.init();
        document.dispatchEvent(
            new CustomEvent("geoleaf:layer:added", {
                detail: { layerId: "routes", sourceId: "s", geometryTypes: ["LineString"] },
            })
        );
        expect(added).toHaveLength(0);
    });
});
