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
const { resolveLayerBinding, resolveEndpointConfig } =
    await import("../../../src/capabilities/route/resolver.ts");
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
/**
 * A minimal route layer: one line, two vertices.
 *
 * ⚠️ Hoisted to the module — it lived inside `describe("applyToLayer")`, hence
 * invisible to the neighbouring block. Rewriting a second one would have set
 * two identical fixtures nothing holds together: the day one gains a vertex,
 * the other proves something else without saying so.
 */
const oneLine = () => [
    line("r1", [
        [0, 0],
        [2, 2],
    ]),
];

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
    it("styles the end and via roles through data-driven rules, not more layers", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        // ⚠️ ONE layer is the invariant this test defends (RT-08), and it still holds.
        expect(added).toHaveLength(1);
        const { style } = added[0];
        // Base style = start; `role == "end"` and `role == "via"` override it.
        expect(style.fillColor).toBe(CONFIG.layers.routes.start.fillColor);
        // ⚠️ The rule list grew from one to two when the `via` role was added, and the
        // assertion stays EXHAUSTIVE on purpose: it is what would catch a third rule appearing by
        // accident, or a role being styled by a second sub-layer instead. Relaxing it to
        // `arrayContaining` would have made the change invisible — which is the opposite of what
        // this test is for.
        expect(style.styleRules).toEqual([
            {
                when: { field: "role", operator: "==", value: "end" },
                style: expect.objectContaining({
                    fillColor: CONFIG.layers.routes.end.fillColor,
                }),
            },
            {
                when: { field: "role", operator: "==", value: "via" },
                style: expect.objectContaining({ fillColor: expect.any(String) }),
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

// ─────────────────────────────────────────────────────────────────────────────
// The `via` role, additive. Added BELOW the existing tests, which pass
// unchanged: the operational definition of "additive" here.
// ─────────────────────────────────────────────────────────────────────────────

/** An already-roled point, as a routing plugin publishes it. */
function roledPoint(role, index, coords = [1, 2]) {
    return {
        type: "Feature",
        id: `waypoint-${index}`,
        geometry: { type: "Point", coordinates: coords },
        properties: { role, index, step: index + 1, name: `Étape ${index + 1}` },
    };
}

describe("les marqueurs ont DEUX sources, et jamais les deux à la fois", () => {
    afterEach(() => vi.clearAllMocks());

    it("une couche de LIGNES SEULES se comporte exactement comme avant", () => {
        // 🛑 The assertion that defines "additive". It bears on the OUTPUT, not the intention.
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue(oneLine());
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added).toHaveLength(1);
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
    });

    it("une couche portant des points rôlés les utilise TELS QUELS, sans rien dériver", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([
            ...oneLine(),
            roledPoint("origin", 0),
            roledPoint("via", 1),
            roledPoint("destination", 2),
        ]);
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added).toHaveLength(1);
        // 🛑 THREE markers, not five. Deriving ON TOP of the published points
        // would yield two stacked markers at each end: indistinguishable to
        // the eye, doubled on click, and impossible to explain from the data.
        expect(added[0].data.features).toHaveLength(3);
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual([
            "start",
            "via",
            "end",
        ]);
    });

    it("traduit le vocabulaire d'itinéraire vers celui du marqueur, et une seule fois", () => {
        // A plugin publishes `origin`/`destination` — a route's words; the
        // capability has styled `start`/`end` since V1, and its
        // `role == "end"` rule keeps biting thanks to this translation.
        // Renaming either side would have been a breaking change for a synonym.
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([roledPoint("origin", 0), roledPoint("destination", 1)]);
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
    });

    it("conserve les propriétés publiées — `step` et `index` survivent", () => {
        // What an eventual label layer will read. Discarding them here would
        // make the numbering unrecoverable without re-publishing.
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([roledPoint("via", 3)]);
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added[0].data.features[0].properties).toMatchObject({ index: 3, step: 4 });
    });

    it("ignore un point sans rôle, et un rôle inconnu", () => {
        // A mixed layer is not a route layer. Taking any point for a marker
        // would turn any data into waypoints.
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([
            ...oneLine(),
            { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} },
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { role: "pique-nique" },
            },
        ]);
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        // No recognised roled point ⇒ we fall back to derivation, like a line layer.
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
    });

    it("écarte le rôle inconnu SANS écarter le rôle connu qui l'accompagne", () => {
        // ⚠️ The previous test, alone, is VACUOUS: `["start","end"]` is also
        // what code that never looks at the points would yield. It cannot
        // tell "unknowns are discarded" from "points are not read". This one
        // can, because a known role must survive in the same pass.
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([
            ...oneLine(),
            roledPoint("origin", 0),
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [9, 9] },
                properties: { role: "pique-nique" },
            },
            roledPoint("destination", 1),
        ]);
        applyToLayer(adapter, CONFIG, "routes", ["LineString"]);
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
        // And these are the PUBLISHED points, not derived ones: derivation
        // would take the line's ends, at [0,0] and [2,2].
        expect(added[0].data.features.map((f) => f.geometry.coordinates)).toEqual([
            [1, 2],
            [1, 2],
        ]);
    });

    it("respecte `showVia: false` sans toucher aux deux autres", () => {
        const { adapter, added } = makeAdapter();
        layersGetFeatures.mockReturnValue([
            roledPoint("origin", 0),
            roledPoint("via", 1),
            roledPoint("destination", 2),
        ]);
        applyToLayer(adapter, { enabled: true, layers: { routes: { showVia: false } } }, "routes", [
            "LineString",
        ]);
        expect(added[0].data.features.map((f) => f.properties.role)).toEqual(["start", "end"]);
    });

    it("résout un style `via` par défaut, plus discret que les extrémités", () => {
        // A stop reading as loud as the destination turns a route into a set
        // of equal points, when its whole shape is that one of them is where you are going.
        const cfg = resolveEndpointConfig({});
        expect(cfg.showVia).toBe(true);
        expect(cfg.viaStyle.radius).toBeLessThan(cfg.startStyle.radius);
    });
});
