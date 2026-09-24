/**
 * The boot of a map whose DEFAULT basemap is vector keeps the layers created while that basemap's
 * style downloads.
 *
 * Replays the integrator's report through the real kernel: `Core.init` builds the real MapLibre
 * adapter; `Baselayers.init` — the boot's own call — defers the default basemap while the style is
 * not loaded; the deferral wakes on `sourcedata` and calls `setStyle(url, …)`; a layer is created
 * by the public `GeoLeaf.Layers.create({ inlineData })` while the style downloads; then the style
 * arrives. Its arrival erased the layer's source and sub-layers, while the adapter still reported
 * the layer present — so every later `updateLayerData` wrote into a source that was gone.
 *
 * Only the engine is faked, and only its style half — see `createStyleEngine`. It models what
 * MapLibre 6.7.0 does on its diff path (`ui/map.ts:2662-2790`, `style/style.ts:846-880`): a style
 * given by URL stays PENDING until delivered; at delivery `transformStyle` runs with the live style
 * as `previous`; the net effect of the diff is that the style becomes what the transform returned;
 * `style.load` follows. It is not the engine: nothing renders here, and "painted" means present in
 * the style, `visibility: visible`, above the basemap's layers. The real engine is judged by
 * `e2e/57-vector-basemap-boot-keeps-layers.spec.js`.
 *
 * The cases marked 🔴 were seen red on the code that read ownership when the transform was built.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The REAL globals chain, as the golden master loads it: `Core`, `GeoJSON`, `Layers` and
// `Baselayers` are the facades the boot uses, wired to each other.
import "../../src/globals/globals.js";

const { _baseLayers, _resetStateForTesting, setMap } =
    await import("../../src/kernel/basemaps/registry.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

/** A style layer as the fake engine stores it. */
interface LayerSpec {
    id: string;
    type: string;
    source?: string;
    layout?: Record<string, unknown>;
    [key: string]: unknown;
}

/** A style as `getStyle()` returns it. */
interface StyleJSON {
    version: number;
    name?: string;
    sources: Record<string, Record<string, unknown>>;
    layers: LayerSpec[];
    [key: string]: unknown;
}

interface SetStyleOptions {
    diff?: boolean;
    transformStyle?: (previous: StyleJSON | undefined, next: StyleJSON) => StyleJSON;
}

/** The facades this file drives, as far as it drives them. */
interface GeoLeafUnderTest {
    Core: {
        init(options: Record<string, unknown>): unknown;
        destroy(mapId: string): boolean;
    };
    GeoJSON: {
        init(options: Record<string, unknown>): unknown;
        updateLayerData(layerId: string, data: unknown): void;
    };
    Layers: { create(def: Record<string, unknown>): Promise<unknown> };
    Baselayers: {
        init(options: Record<string, unknown>): unknown;
        registerBaseLayer(key: string, definition: Record<string, unknown>): void;
        setBaseLayer(key: string, options?: Record<string, unknown>): void;
        getActiveKey(): string | null;
    };
}

const g = globalThis as unknown as {
    GeoLeaf: GeoLeafUnderTest;
    maplibregl: { Map: unknown; __createMockMap: () => Record<string, unknown> };
};
const GeoLeaf = g.GeoLeaf;
const originalMapCtor = g.maplibregl.Map;

const MAP_ID = "gl-vector-boot-map";
const STYLE_URL = "https://tiles.test/styles/vector.json";
const OTHER_STYLE_URL = "https://tiles.test/styles/other.json";
const CREDIT = "© Fond vectoriel";
const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";
const SENTINEL = "gl-sentinel-poi";

/** The incoming basemap: one source without a credit, one with its own. */
function vectorStyle(name: string): StyleJSON {
    return {
        version: 8,
        name,
        sources: {
            base: { type: "vector", url: "https://tiles.test/base.json" },
            credited: {
                type: "vector",
                url: "https://tiles.test/credited.json",
                attribution: "© Fournisseur",
            },
        },
        layers: [
            { id: "water", type: "fill", source: "base" },
            { id: "roads", type: "line", source: "credited" },
        ],
    };
}

/** A point collection with no feature `id`, so that a data update takes the plain `setData` path. */
function points(lng: number): Record<string, unknown> {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                geometry: { type: "Point", coordinates: [lng, 48.85] },
                properties: { name: "p" },
            },
        ],
    };
}

type Engine = ReturnType<typeof createStyleEngine>;

/**
 * A MapLibre map whose STYLE half behaves as the engine's diff path does; the rest of the surface
 * the kernel touches (events, controls, camera, images) comes from the shared mock.
 */
function createStyleEngine() {
    const map = g.maplibregl.__createMockMap() as Record<string, unknown> & {
        fire: (event: string, data?: unknown) => unknown;
    };
    let style: StyleJSON = { version: 8, sources: {}, layers: [] };
    let loaded = false;
    let pending: { url: string; options: SetStyleOptions | undefined } | null = null;

    const clone = <T>(value: T): T => structuredClone(value);
    const findLayer = (id: string): LayerSpec | undefined => style.layers.find((l) => l.id === id);

    /** `Style.setState`, net effect: the transform runs NOW, on the style as it stands NOW. */
    function apply(json: StyleJSON, options: SetStyleOptions | undefined): void {
        const previous = clone(style);
        const next = options?.transformStyle
            ? options.transformStyle(previous, clone(json))
            : clone(json);
        style = clone(next);
        map.fire("styledata", { dataType: "style" });
        map.fire("style.load");
    }

    Object.assign(map, {
        isStyleLoaded: vi.fn(() => loaded),
        loaded: vi.fn(() => loaded),
        getStyle: vi.fn(() => clone(style)),
        addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
            if (style.sources[id]) throw new Error(`There is already a source with ID "${id}".`);
            style.sources[id] = clone(spec);
            return map;
        }),
        getSource: vi.fn((id: string) => {
            if (!style.sources[id]) return undefined;
            return {
                ...clone(style.sources[id]),
                setData: (data: unknown) => {
                    const live = style.sources[id];
                    if (live) live.data = clone(data);
                },
            };
        }),
        removeSource: vi.fn((id: string) => {
            delete style.sources[id];
            return map;
        }),
        addLayer: vi.fn((spec: LayerSpec, beforeId?: string) => {
            if (findLayer(spec.id)) {
                map.fire("error", { error: new Error(`Layer "${spec.id}" already exists.`) });
                return map;
            }
            if (beforeId === undefined) {
                style.layers.push(clone(spec));
                return map;
            }
            const at = style.layers.findIndex((l) => l.id === beforeId);
            // MapLibre refuses a missing `beforeId` with an error event, and adds nothing.
            if (at < 0) {
                map.fire("error", { error: new Error(`No layer "${beforeId}".`) });
                return map;
            }
            style.layers.splice(at, 0, clone(spec));
            return map;
        }),
        getLayer: vi.fn((id: string) => findLayer(id)),
        removeLayer: vi.fn((id: string) => {
            style.layers = style.layers.filter((l) => l.id !== id);
            return map;
        }),
        setLayoutProperty: vi.fn((id: string, name: string, value: unknown) => {
            const layer = findLayer(id);
            if (layer) layer.layout = { ...(layer.layout ?? {}), [name]: value };
            return map;
        }),
        setFilter: vi.fn((id: string, filter: unknown) => {
            const layer = findLayer(id);
            if (layer) layer.filter = filter ?? undefined;
            return map;
        }),
        setStyle: vi.fn((target: StyleJSON | string, options?: SetStyleOptions) => {
            if (typeof target === "string") pending = { url: target, options };
            // An inline style needs no download: MapLibre diffs it synchronously (map.ts:2773).
            else apply(target, options);
            return map;
        }),
    });

    return Object.assign(map, {
        /** Flips `isStyleLoaded()`, as the sources in flight settle. */
        setLoaded(value: boolean): void {
            loaded = value;
        },
        /** The URL `setStyle` is downloading, or `null`. */
        pendingUrl(): string | null {
            return pending?.url ?? null;
        },
        /** The download completes: MapLibre runs the transform and applies what it returned. */
        deliver(json: StyleJSON): void {
            const request = pending;
            if (!request) throw new Error("aucun style en attente de téléchargement");
            pending = null;
            apply(json, request.options);
        },
        /** The live style, as `getStyle()` serializes it. */
        style(): StyleJSON {
            return clone(style);
        },
    });
}

let engine: Engine;

beforeEach(() => {
    engine = createStyleEngine();
    // A class, given to `vi.fn` itself: the adapter calls `new maplibregl.Map(…)`.
    g.maplibregl.Map = vi.fn(
        class {
            constructor() {
                return engine;
            }
        }
    );
    const container = document.createElement("div");
    container.id = MAP_ID;
    document.body.appendChild(container);
});

afterEach(() => {
    GeoLeaf.Core.destroy(MAP_ID);
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
    _resetStateForTesting();
    setMap(null);
    GeoJSONShared.reset();
    g.maplibregl.Map = originalMapCtor;
});

/**
 * The boot, as far as this defect goes: the map, the GeoJSON module, then the basemaps with the
 * profile's default — while the style is NOT loaded yet, so the activation is deferred.
 */
function bootWithDefault(definition: Record<string, unknown>): void {
    const adapter = GeoLeaf.Core.init({ mapId: MAP_ID, center: [48.85, 2.35], zoom: 12 });
    expect(adapter, "la carte ne s'est pas construite").toBeTruthy();
    GeoLeaf.GeoJSON.init({ map: adapter });
    GeoLeaf.Baselayers.init({ map: adapter, baselayers: { plan: definition }, activeKey: "plan" });
}

/** The deferred activation wakes: the sources settle, `sourcedata` carries the flip. */
function settleSources(): void {
    engine.setLoaded(true);
    engine.fire("sourcedata", { dataType: "source" });
}

/**
 * Creates `id` through the public seam and checks it landed in the LIVE style.
 *
 * @returns Its source as the live style held it before the basemap's style arrived.
 */
async function createLayerNow(id: string): Promise<Record<string, unknown>> {
    const created = await GeoLeaf.Layers.create({ id, label: id, inlineData: points(2.35) });
    expect(created, `Layers.create("${id}") n'a rien chargé`).toBeTruthy();
    const source = engine.style().sources[`gl-src-${id}`];
    expect(source, "la couche n'a pas atteint la carte").toBeDefined();
    return source ?? {};
}

/** Ids of the layers of `style`, in paint order. */
const layerIds = (style: StyleJSON): string[] => style.layers.map((l) => l.id);

/** Asserts `id` is in the style, painted above every layer listed in `below`. */
function expectPaintedAbove(style: StyleJSON, id: string, below: string[]): void {
    const ids = layerIds(style);
    const source = style.sources[`gl-src-${id}`];
    expect(source, `gl-src-${id} a été effacée à l'arrivée du style`).toBeDefined();
    const own = style.layers.filter((l) => l.source === `gl-src-${id}`);
    expect(own.length, `aucune sous-couche de ${id} dans le style`).toBeGreaterThan(0);
    for (const layer of own) {
        expect(layer.layout?.visibility ?? "visible").toBe("visible");
        for (const basemapLayer of below) {
            expect(ids.indexOf(layer.id)).toBeGreaterThan(ids.indexOf(basemapLayer));
        }
    }
}

describe("boot sur un fond vectoriel par défaut — les couches créées pendant le téléchargement du style", () => {
    it.each([
        ["sans crédit déclaré", {}],
        ["avec un crédit déclaré", { attribution: CREDIT }],
    ])(
        "🔴 %s : la couche créée par Layers.create survit à l'arrivée du style",
        async (_label, credit) => {
            engine.setLoaded(false);
            bootWithDefault({ type: "maplibre", style: STYLE_URL, ...credit });
            // Deferred: `isStyleLoaded()` was false when the default basemap was requested.
            expect(engine.setStyle).not.toHaveBeenCalled();

            settleSources();
            expect(engine.pendingUrl(), "le fond par défaut n'a pas été demandé").toBe(STYLE_URL);

            // The integrator's layer lands while the style downloads.
            const created = await createLayerNow("late");
            engine.deliver(vectorStyle("vector"));

            const after = engine.style();
            expect(after.name).toBe("vector");
            expectPaintedAbove(after, "late", ["water", "roads"]);
            expect(after.sources["gl-src-late"]).toEqual(created);
            // The z-anchor every later layer inserts before: the adapter believes it exists.
            expect(layerIds(after)).toContain(SENTINEL);

            // What the report saw last: an update after the boot must reach the live source.
            GeoLeaf.GeoJSON.updateLayerData("late", points(2.4));
            expect(engine.style().sources["gl-src-late"]?.data).toEqual(points(2.4));
        }
    );

    it("le crédit déclaré reste posé sur les sources du fond qui n'en portent aucun, jamais sur une source GeoLeaf", async () => {
        engine.setLoaded(false);
        bootWithDefault({ type: "maplibre", style: STYLE_URL, attribution: CREDIT });
        settleSources();
        await createLayerNow("late");
        engine.deliver(vectorStyle("vector"));

        const sources = engine.style().sources;
        expect(sources.base?.attribution).toBe(CREDIT);
        expect(sources.credited?.attribution).toBe("© Fournisseur");
        expect(sources["gl-src-late"]?.attribution).toBeUndefined();
    });

    it("basculer ensuite vers un autre fond vectoriel garde toutes les couches, dans leur ordre", async () => {
        engine.setLoaded(false);
        bootWithDefault({ type: "maplibre", style: STYLE_URL });
        settleSources();
        engine.deliver(vectorStyle("vector"));
        // The layer exists BEFORE the switch begins: the user's own switch, which the fix must
        // leave exactly as it was — this case is green on either side of it.
        await createLayerNow("late");
        const geoleafBefore = layerIds(engine.style()).filter((id) => id.startsWith("gl-"));

        GeoLeaf.Baselayers.registerBaseLayer("autre", { type: "maplibre", style: OTHER_STYLE_URL });
        GeoLeaf.Baselayers.setBaseLayer("autre");
        expect(engine.pendingUrl()).toBe(OTHER_STYLE_URL);
        engine.deliver(vectorStyle("other"));

        const after = engine.style();
        expect(after.name).toBe("other");
        expect(layerIds(after).filter((id) => id.startsWith("gl-"))).toEqual(geoleafBefore);
        expectPaintedAbove(after, "late", ["water", "roads"]);
    });

    it("un fond RASTER par défaut ne remplace jamais le style : aucun setStyle, la couche reste", async () => {
        engine.setLoaded(false);
        bootWithDefault({ type: "tile", url: "https://tiles.test/raster/{z}/{x}/{y}.png" });
        expect(engine.setStyle).not.toHaveBeenCalled();

        await createLayerNow("late");
        settleSources();

        const after = engine.style();
        expect(engine.setStyle).not.toHaveBeenCalled();
        expect(after.sources[BASEMAP_SOURCE_ID]).toBeDefined();
        expect(after.sources["gl-src-late"]).toBeDefined();
        // The raster basemap goes UNDER the data layers.
        const ids = layerIds(after);
        const basemapLayer = after.layers.find((l) => l.source === BASEMAP_SOURCE_ID);
        expect(basemapLayer).toBeDefined();
        for (const layer of after.layers.filter((l) => l.source === "gl-src-late")) {
            expect(ids.indexOf(layer.id)).toBeGreaterThan(ids.indexOf(basemapLayer?.id ?? ""));
        }
    });
});
