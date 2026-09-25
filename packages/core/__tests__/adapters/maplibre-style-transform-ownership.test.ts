/**
 * The basemap-switch transform reads what GeoLeaf owns when MapLibre RUNS it — not when the
 * basemap registry builds it.
 *
 * For a style given by URL, `map.setStyle(url, { transformStyle })` downloads the style first and
 * runs the callback only once it has arrived, with the LIVE style as `previous` (MapLibre 6.7.0,
 * `Style.setState`, `style/style.ts:846-850`). A layer created during the download is therefore in
 * `previous`. The adapter used to copy its ownership sets when the transform was built, so that
 * layer was missing from them, and the incoming style erased it — while the layer registry still
 * reported it. With nothing owned yet and no credit declared, the adapter even returned `null`:
 * a plain `setStyle`, which diffs the style just the same.
 *
 * The cases marked 🔴 were seen red on the code that copied the sets at build time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/kernel/events/event-bus.js", () => ({ dispatchGeoLeafEvent: vi.fn() }));

const { MaplibreAdapter } = await import("../../src/adapters/maplibre/maplibre-adapter.js");
const { SENTINEL_POI } = await import("../../src/adapters/maplibre/maplibre-layer-registry.js");

/** The structural view of a style these tests build and read. */
interface StyleLike {
    version: number;
    sources: Record<string, Record<string, unknown>>;
    layers: { id: string; type: string; source?: string }[];
}

type Transform = (previous: StyleLike | undefined, next: StyleLike) => StyleLike;

/** The shared MapLibre mock's map, as far as these tests read its state. */
interface MockMap {
    __sources: Record<string, Record<string, unknown>>;
    __layers: Record<string, { id: string; type: string; source?: string }>;
}

const g = globalThis as unknown as {
    maplibregl: { Map: unknown; __createMockMap: () => MockMap };
};
const originalMap = g.maplibregl.Map;
let mockMap: MockMap;

beforeEach(() => {
    mockMap = g.maplibregl.__createMockMap();
    // A class, given to `vi.fn` itself: the adapter calls `new`.
    g.maplibregl.Map = vi.fn(
        class {
            constructor() {
                return mockMap;
            }
        }
    );
});

afterEach(() => {
    g.maplibregl.Map = originalMap;
});

/** The incoming basemap style: one source, one layer. */
function incomingStyle(): StyleLike {
    return {
        version: 8,
        sources: { base: { type: "vector", url: "https://tiles.test/base.json" } },
        layers: [{ id: "water", type: "fill", source: "base" }],
    };
}

/** A GeoJSON source and one circle layer, as the live style carries them. */
function liveStyleWith(layerId: string): StyleLike {
    return {
        version: 8,
        sources: {
            [`gl-src-${layerId}`]: {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] },
            },
        },
        layers: [{ id: `gl-${layerId}-circle`, type: "circle", source: `gl-src-${layerId}` }],
    };
}

/**
 * The live style as the shared mock holds it, serialized the way `Style.serialize()` would hand
 * it over — plain specs, without the handle methods the mock adds to its sources.
 */
function serializeMock(map: MockMap): StyleLike {
    const sources = Object.fromEntries(
        Object.entries(map.__sources).map(([id, spec]) => [
            id,
            Object.fromEntries(
                Object.entries(spec).filter(
                    ([key, value]) => key !== "id" && typeof value !== "function"
                )
            ),
        ])
    );
    return { version: 8, sources, layers: Object.values(map.__layers) };
}

function asTransform(value: unknown): Transform {
    expect(value, "l'adaptateur n'a rendu aucune transformation").toBeTypeOf("function");
    return value as Transform;
}

const POINTS = {
    type: "FeatureCollection",
    features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: {} },
    ],
};

describe("transformation de style — ce que GeoLeaf possède se lit quand MapLibre l'exécute", () => {
    it("🔴 une couche enregistrée APRÈS la construction est portée dans le style entrant", () => {
        const adapter = new MaplibreAdapter();
        const transform = asTransform(adapter.buildStyleChangeTransform({ attribution: "© Fond" }));
        // The layer lands while the style downloads — after the transform was built.
        adapter.getLayerRegistry().register("late", ["circle"], 0);

        const out = transform(liveStyleWith("late"), incomingStyle());

        expect(out.sources["gl-src-late"]).toEqual(liveStyleWith("late").sources["gl-src-late"]);
        expect(out.layers.map((l) => l.id)).toEqual(["water", "gl-late-circle"]);
    });

    it("🔴 sans crédit ni couche au moment de l'appel, une transformation est rendue quand même", () => {
        const adapter = new MaplibreAdapter();
        // Nothing owned, nothing to credit: an empty registry at CALL time proves nothing for a
        // style still downloading — returning `null` here handed MapLibre a plain `setStyle`.
        const transform = asTransform(adapter.buildStyleChangeTransform());
        adapter.getLayerRegistry().register("late", ["circle"], 0);

        const out = transform(liveStyleWith("late"), incomingStyle());

        expect(out.layers.map((l) => l.id)).toEqual(["water", "gl-late-circle"]);
        expect(out.sources["gl-src-late"]).toBeDefined();
    });

    it("🔴 la sentinelle et la couche créées par addGeoJSONLayer après la construction sont portées", () => {
        const adapter = new MaplibreAdapter();
        adapter.init({ container: document.createElement("div") } as never);
        // A declared credit, so that a transform exists either way: what is judged here is
        // what it CARRIES, not whether it was built.
        const transform = asTransform(adapter.buildStyleChangeTransform({ attribution: "© Fond" }));
        adapter.addGeoJSONLayer("late", POINTS);

        const out = transform(serializeMock(mockMap), incomingStyle());
        const ids = out.layers.map((l) => l.id);

        // The sentinel is the z-anchor every later layer inserts before: losing it while the
        // adapter still believes it exists breaks the next `addLayer(spec, SENTINEL_POI)`.
        expect(ids).toContain(SENTINEL_POI);
        expect(ids).toContain("gl-late-circle");
        expect(ids[0]).toBe("water");
        expect(out.sources["gl-src-late"]).toMatchObject({ type: "geojson", data: POINTS });
    });

    it("🔴 un groupe de grappes créé après la construction est porté", async () => {
        const adapter = new MaplibreAdapter();
        adapter.init({ container: document.createElement("div") } as never);
        const transform = asTransform(adapter.buildStyleChangeTransform({ attribution: "© Fond" }));
        await adapter.createClusterGroup("poi");

        const live = serializeMock(mockMap);
        const clusterSources = Object.keys(live.sources);
        expect(clusterSources, "le groupe n'a créé aucune source").toHaveLength(1);

        const out = transform(live, incomingStyle());

        expect(Object.keys(out.sources)).toEqual(expect.arrayContaining(clusterSources));
        expect(out.layers.map((l) => l.id)).toEqual(["water", ...live.layers.map((l) => l.id)]);
    });

    it("une couche possédée AVANT la construction reste portée — le basculement explicite ne change pas", () => {
        const adapter = new MaplibreAdapter();
        adapter.getLayerRegistry().register("early", ["circle"], 0);
        const transform = asTransform(adapter.buildStyleChangeTransform());

        const out = transform(liveStyleWith("early"), incomingStyle());

        expect(out.layers.map((l) => l.id)).toEqual(["water", "gl-early-circle"]);
        expect(out.sources["gl-src-early"]).toBeDefined();
    });
});

/**
 * A live style holding, on top of the basemap, what code OUTSIDE the adapter placed on the engine:
 * a plugin's source and two layers reading it, and a layer nobody declared.
 */
function liveStyleWithForeign(): StyleLike {
    return {
        version: 8,
        sources: {
            "gl-measure-lines": { type: "geojson", data: POINTS },
            "plugin-unread": { type: "geojson", data: POINTS },
        },
        layers: [
            { id: "old-basemap", type: "background" },
            { id: "gl-measure-lines-layer", type: "line", source: "gl-measure-lines" },
            { id: "gl-measure-vertices-layer", type: "circle", source: "gl-measure-lines" },
            { id: "host-own", type: "background" },
        ],
    };
}

const MEASURE_IDS = {
    layerIds: ["gl-measure-lines-layer", "gl-measure-vertices-layer"],
    sourceIds: ["gl-measure-lines"],
};

describe("transformation de style — ce que le code HORS de l'adaptateur a déclaré", () => {
    it("🔴 les couches déclarées et leurs sources sont portées, dans leur ordre, au-dessus du fond entrant", () => {
        const adapter = new MaplibreAdapter();
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);
        const transform = asTransform(adapter.buildStyleChangeTransform());
        const live = liveStyleWithForeign();

        const out = transform(live, incomingStyle());

        expect(out.layers.map((l) => l.id)).toEqual([
            "water",
            "gl-measure-lines-layer",
            "gl-measure-vertices-layer",
        ]);
        expect(out.sources["gl-measure-lines"]).toEqual(live.sources["gl-measure-lines"]);
        // Declared, never deduced: a layer nobody declared is not GeoLeaf's to carry.
        expect(Object.keys(out.sources)).not.toContain("plugin-unread");
    });

    it("🔴 une déclaration faite PENDANT le téléchargement du style est lue à son arrivée", () => {
        const adapter = new MaplibreAdapter();
        const transform = asTransform(adapter.buildStyleChangeTransform());
        // The plugin declares after the switch began — the transform reads when it RUNS.
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);

        const out = transform(liveStyleWithForeign(), incomingStyle());

        expect(out.layers.map((l) => l.id)).toContain("gl-measure-lines-layer");
        expect(out.sources["gl-measure-lines"]).toBeDefined();
    });

    it("🔴 redéclarer sous la même clé remplace les ids, sans les cumuler", () => {
        const adapter = new MaplibreAdapter();
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);
        adapter.declareOwnedStyleIds("measure", { layerIds: ["gl-measure-vertices-layer"] });
        const transform = asTransform(adapter.buildStyleChangeTransform());

        const out = transform(liveStyleWithForeign(), incomingStyle());

        expect(out.layers.map((l) => l.id)).toEqual(["water", "gl-measure-vertices-layer"]);
    });

    it("🔴 `null` retire la déclaration : ses ids ne sont plus portés", () => {
        const adapter = new MaplibreAdapter();
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);
        adapter.declareOwnedStyleIds("cog:e2e", { layerIds: ["host-own"] });
        adapter.declareOwnedStyleIds("measure", null);
        const transform = asTransform(adapter.buildStyleChangeTransform());

        const out = transform(liveStyleWithForeign(), incomingStyle());

        // The other declarer is untouched: withdrawing is per key.
        expect(out.layers.map((l) => l.id)).toEqual(["water", "host-own"]);
        expect(out.sources["gl-measure-lines"]).toBeUndefined();
    });

    it("🔴 un id déclaré qui n'est plus dans le style au moment de la bascule est ignoré", () => {
        const adapter = new MaplibreAdapter();
        adapter.declareOwnedStyleIds("cog:gone", { layerIds: ["gone"], sourceIds: ["gone"] });
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);
        const transform = asTransform(adapter.buildStyleChangeTransform());

        const out = transform(liveStyleWithForeign(), incomingStyle());

        expect(out.layers.map((l) => l.id)).not.toContain("gone");
        expect(Object.keys(out.sources)).not.toContain("gone");
    });

    it("🔴 destroy() oublie les déclarations de la carte détruite", () => {
        const adapter = new MaplibreAdapter();
        adapter.init({ container: document.createElement("div") } as never);
        adapter.declareOwnedStyleIds("measure", MEASURE_IDS);
        adapter.destroy();
        adapter.init({ container: document.createElement("div") } as never);
        const transform = asTransform(adapter.buildStyleChangeTransform());

        const out = transform(liveStyleWithForeign(), incomingStyle());

        expect(out.layers.map((l) => l.id)).toEqual(["water"]);
    });
});
