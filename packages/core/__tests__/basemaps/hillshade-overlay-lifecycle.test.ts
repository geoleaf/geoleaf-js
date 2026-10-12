/**
 * The hillshade OVERLAY of a basemap: where it lands in the style, and what becomes of it when
 * the basemap changes.
 *
 * A `hillshade` block was read on a basemap of `type: "hillshade"` only. With
 * `hillshade.overlay: true` any basemap keeps being what it is and gets the relief shading on
 * top: right above its layer when it is an image, inside its style when it is vector.
 *
 * What these cases prove is an ORDER and a LIFECYCLE, so the kernel is real — registry,
 * strategies, hillshade, terrain — and only the engine's style half is faked
 * (`createStyleEngine`): it places a layer where `beforeId` says, refuses a missing anchor,
 * refuses to remove a source a layer still reads, and emits nothing on an empty diff. The shared
 * mock does none of that, and reads a misplaced overlay like a well-placed one.
 *
 * The real engine is judged by `e2e/82-hillshade-overlay.spec.js`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const Log = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log }));

const resolveWmtsTilesUrl = vi.hoisted(() => vi.fn());
const buildWmsUrl = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/basemaps/wmts-resolver.js", () => ({ buildWmsUrl, resolveWmtsTilesUrl }));

import {
    _baseLayers,
    _resetStateForTesting,
    refreshBasemap,
    registerBaseLayer,
    resetBasemapRegistry,
    setBaseLayer,
    setMap,
} from "../../src/kernel/basemaps/registry.ts";
import { _resetTerrainStateForTesting } from "../../src/kernel/basemaps/terrain.ts";
import {
    createStyleEngine,
    type LayerSpec,
    type StyleEngine,
    type StyleJSON,
} from "../_helpers/style-engine.ts";

const BASEMAP_SOURCE = "__geoleaf_basemap__";
const BASEMAP_LAYER = "__geoleaf_basemap_layer__";
const OVERLAY_SOURCE = "__geoleaf_hillshade_overlay__";
const OVERLAY_LAYER = "__geoleaf_hillshade_overlay_layer__";
const DEM = "https://dem.example.com/{z}/{x}/{y}.png";
const TILES_A = "https://a.example.com/{z}/{x}/{y}.png";
const TILES_B = "https://b.example.com/{z}/{x}/{y}.png";
const WMTS_TILES = "https://wmts.example.com/plan/{z}/{x}/{y}.png";

const SHADING = { overlay: true, demUrl: DEM, exaggeration: 0.45, shadowColor: "#4a3f35" };
const TERRAIN = { enabled: true, demUrl: DEM, default3D: true, pitch: 60 };

/** A basemap style with land, water, roads and two label layers — in that order. */
function vectorStyle(name = "plan"): StyleJSON {
    return {
        version: 8,
        name,
        sources: { base: { type: "vector", url: `https://tiles.test/${name}.json` } },
        layers: [
            { id: "land", type: "fill", source: "base" },
            { id: "water", type: "fill", source: "base" },
            { id: "road", type: "line", source: "base" },
            { id: "place", type: "symbol", source: "base" },
            { id: "poi", type: "symbol", source: "base" },
        ],
    };
}

/** The same, without any label layer. */
function unlabelledStyle(): StyleJSON {
    const style = vectorStyle("nu");
    style.layers = style.layers.filter((layer) => layer.type !== "symbol");
    return style;
}

const g = globalThis as unknown as { GeoLeaf?: { Core?: unknown } };
let previousCore: unknown;
let engine: StyleEngine;
let changes: string[];
const onChange = (event: Event): void => {
    changes.push((event as CustomEvent<{ key: string }>).detail.key);
};

function register(id: string, definition: Record<string, unknown>): void {
    registerBaseLayer(id, { id, label: id, ...definition } as never);
}
const vector = (style: unknown, extra: Record<string, unknown> = {}) => ({
    type: "maplibre",
    style,
    ...extra,
});
const tiles = (url: string, extra: Record<string, unknown> = {}) => ({ url, ...extra });

/** The overlay layer as the live style holds it, or `undefined`. */
const overlay = (): LayerSpec | undefined =>
    engine.style().layers.find((layer) => layer.id === OVERLAY_LAYER);

/** Calls made to a spied engine method with the overlay's layer or source id. */
function overlayCalls(method: "addSource" | "removeSource" | "addLayer" | "removeLayer"): number {
    const spy = engine[method] as unknown as { mock: { calls: unknown[][] } };
    return spy.mock.calls.filter(([first]) => {
        const id = typeof first === "string" ? first : (first as LayerSpec).id;
        return id === OVERLAY_LAYER || id === OVERLAY_SOURCE;
    }).length;
}

/**
 * Stands for the adapter: its transform appends, AFTER the incoming style's layers, the layers
 * named in `carried` that the previous style held — what the real one does for the layers
 * GeoLeaf and its plugins own.
 */
function installAdapter(carried: string[]): void {
    const transform = (previous: StyleJSON | undefined, incoming: StyleJSON): StyleJSON => {
        const kept = (previous?.layers ?? []).filter((layer) => carried.includes(layer.id));
        const sources = { ...incoming.sources };
        for (const layer of kept) {
            const source = layer.source ? previous?.sources[layer.source] : undefined;
            if (layer.source && source) sources[layer.source] = source;
        }
        return { ...incoming, sources, layers: [...incoming.layers, ...kept] };
    };
    g.GeoLeaf = {
        ...(g.GeoLeaf ?? {}),
        Core: {
            getAdapter: () => ({
                buildStyleChangeTransform: () => transform,
                reregisterStyleImages: vi.fn(),
            }),
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    buildWmsUrl.mockReturnValue(null);
    previousCore = g.GeoLeaf?.Core;
    g.GeoLeaf = { ...(g.GeoLeaf ?? {}), Core: null };
    engine = createStyleEngine();
    setMap(engine as never);
    changes = [];
    document.addEventListener("geoleaf:basemap:change", onChange);
});

afterEach(() => {
    document.removeEventListener("geoleaf:basemap:change", onChange);
    for (const key of Object.keys(_baseLayers)) delete _baseLayers[key];
    _resetStateForTesting();
    _resetTerrainStateForTesting();
    setMap(null);
    g.GeoLeaf = { ...(g.GeoLeaf ?? {}), Core: previousCore };
});

describe("surcouche d'ombrage — activation explicite", () => {
    it("sans `overlay`, un fond vectoriel portant `hillshade` reste sans surcouche", () => {
        register("plan", vector(vectorStyle(), { hillshade: { demUrl: DEM, exaggeration: 0.45 } }));

        setBaseLayer("plan");

        expect(engine.order()).toEqual(["land", "water", "road", "place", "poi"]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("sans `overlay`, un fond en tuiles portant `hillshade` reste sans surcouche", () => {
        register("tuiles", tiles(TILES_A, { hillshade: { demUrl: DEM } }));

        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER]);
    });

    it('`type: "hillshade"` se comporte comme avant, `overlay` ou non', () => {
        register("relief", { type: "hillshade", hillshade: { ...SHADING } });

        setBaseLayer("relief");

        // One layer, in the basemap slot, on the basemap source: the shading IS the basemap.
        expect(engine.order()).toEqual([BASEMAP_LAYER]);
        expect(engine.style().layers[0]).toMatchObject({
            type: "hillshade",
            source: BASEMAP_SOURCE,
        });
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });
});

describe("surcouche d'ombrage — position sur un fond vectoriel", () => {
    it("avant la couche que `beforeLayer` nomme", () => {
        register(
            "plan",
            vector(vectorStyle(), { hillshade: { ...SHADING, beforeLayer: "water" } })
        );

        setBaseLayer("plan");

        expect(engine.order()).toEqual(["land", OVERLAY_LAYER, "water", "road", "place", "poi"]);
    });

    it("sans `beforeLayer` : avant la première couche `symbol` du style", () => {
        register("plan", vector(vectorStyle(), { hillshade: { ...SHADING } }));

        setBaseLayer("plan");

        expect(engine.order()).toEqual(["land", "water", "road", OVERLAY_LAYER, "place", "poi"]);
    });

    it("`beforeLayer` inconnu : averti, replié, et aucune source orpheline", () => {
        register("plan", vector(vectorStyle(), { hillshade: { ...SHADING, beforeLayer: "nope" } }));

        setBaseLayer("plan");

        expect(engine.order()).toEqual(["land", "water", "road", OVERLAY_LAYER, "place", "poi"]);
        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('"nope"'));
        // The engine was never asked for a layer before a missing anchor.
        expect(engine.refusals()).toEqual([]);
        expect(overlay()?.source).toBe(OVERLAY_SOURCE);
    });

    it("style sans `symbol` : au-dessus du style, sous toute couche emportée", () => {
        // The editor's marker layer is a `symbol` too. Carried over the incoming style, it reads
        // in the live style exactly like a label layer of the basemap.
        installAdapter(["td-point-marker", "gl-data"]);
        engine.addSource("td-src", { type: "geojson", data: null });
        engine.addLayer({ id: "gl-data", type: "circle", source: "td-src" });
        engine.addLayer({ id: "td-point-marker", type: "symbol", source: "td-src" });
        register("nu", vector(unlabelledStyle(), { hillshade: { ...SHADING } }));

        setBaseLayer("nu");

        expect(engine.order()).toEqual([
            "land",
            "water",
            "road",
            OVERLAY_LAYER,
            "gl-data",
            "td-point-marker",
        ]);
    });

    it("style avec `symbol` et couches emportées : toujours la `symbol` du STYLE", () => {
        installAdapter(["td-point-marker"]);
        engine.addSource("td-src", { type: "geojson", data: null });
        engine.addLayer({ id: "td-point-marker", type: "symbol", source: "td-src" });
        register("plan", vector(vectorStyle(), { hillshade: { ...SHADING } }));

        setBaseLayer("plan");

        expect(engine.order()).toEqual([
            "land",
            "water",
            "road",
            OVERLAY_LAYER,
            "place",
            "poi",
            "td-point-marker",
        ]);
    });
});

describe("surcouche d'ombrage — position sur un fond en image", () => {
    it("juste au-dessus de la couche du fond, sous les données", () => {
        // The boot order: the data layers land before the basemap does.
        engine.addSource("gl-src-data", { type: "geojson", data: null });
        engine.addLayer({ id: "gl-data", type: "circle", source: "gl-src-data" });
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));

        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER, "gl-data"]);
    });

    it("au sommet quand le fond est la seule couche", () => {
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));

        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
    });

    it("`beforeLayer` n'y est pas lu", () => {
        engine.addSource("gl-src-data", { type: "geojson", data: null });
        engine.addLayer({ id: "gl-data", type: "circle", source: "gl-src-data" });
        engine.addLayer({ id: "gl-top", type: "circle", source: "gl-src-data" });
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING, beforeLayer: "gl-top" } }));

        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER, "gl-data", "gl-top"]);
        expect(Log.warn).not.toHaveBeenCalled();
    });

    it("sur un fond WMS", () => {
        buildWmsUrl.mockReturnValue("https://wms.example.com/ows?BBOX={bbox-epsg-3857}");
        register("wms", {
            type: "wms",
            wms: { url: "https://wms.example.com/ows", layers: "plan" },
            hillshade: { ...SHADING },
        });

        setBaseLayer("wms");

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
    });
});

describe("surcouche d'ombrage — ce qu'elle dessine", () => {
    it("les réglages de `HillshadeConfig` s'appliquent tels quels, sur une source à elle", () => {
        register(
            "plan",
            vector(vectorStyle(), {
                hillshade: {
                    overlay: true,
                    demUrl: DEM,
                    demEncoding: "mapbox",
                    demMaxZoom: 12,
                    exaggeration: 0.45,
                    shadowColor: "#4a3f35",
                    highlightColor: "#ffffff",
                    accentColor: "#6b5d4f",
                    illuminationDirection: 315,
                    illuminationAnchor: "map",
                },
            })
        );

        setBaseLayer("plan");

        expect(overlay()).toMatchObject({
            type: "hillshade",
            source: OVERLAY_SOURCE,
            paint: {
                "hillshade-exaggeration": 0.45,
                "hillshade-shadow-color": "#4a3f35",
                "hillshade-highlight-color": "#ffffff",
                "hillshade-accent-color": "#6b5d4f",
                "hillshade-illumination-direction": 315,
                "hillshade-illumination-anchor": "map",
            },
        });
        expect(engine.style().sources[OVERLAY_SOURCE]).toEqual({
            type: "raster-dem",
            tiles: [DEM],
            encoding: "mapbox",
            tileSize: 256,
            maxzoom: 12,
        });
    });

    it("avec `terrain` sur le même fond, les deux coexistent sur deux sources", () => {
        register("plan", vector(vectorStyle(), { terrain: TERRAIN, hillshade: { ...SHADING } }));

        setBaseLayer("plan");

        expect(engine.getTerrain()).toEqual({ source: "terrain-dem", exaggeration: 1.5 });
        expect(overlay()?.source).toBe(OVERLAY_SOURCE);
        expect(Object.keys(engine.style().sources).sort()).toEqual(
            ["base", OVERLAY_SOURCE, "terrain-dem"].sort()
        );
    });

    it.each([
        ["sans `demUrl`", { overlay: true }],
        ["avec un `demUrl` qui n'est pas http(s)", { overlay: true, demUrl: "ftp://dem/{z}" }],
    ])("%s : une erreur, aucune surcouche, et le fond s'active", (_label, hillshade) => {
        register("plan", vector(vectorStyle(), { hillshade }));
        // Said at registration, not at first use.
        expect(Log.error).toHaveBeenCalledTimes(1);

        setBaseLayer("plan");

        expect(engine.order()).toEqual(["land", "water", "road", "place", "poi"]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
        expect(changes).toEqual(["plan"]);
    });

    it("une surcouche que le moteur refuse ne retient ni le relief ni l'événement", () => {
        const addSource = engine.addSource.getMockImplementation();
        engine.addSource.mockImplementation((id: string, spec: Record<string, unknown>) => {
            if (id === OVERLAY_SOURCE) throw new Error("refus du moteur");
            return addSource?.(id, spec) as never;
        });
        register("plan", vector(vectorStyle(), { terrain: TERRAIN, hillshade: { ...SHADING } }));

        setBaseLayer("plan");

        expect(Log.error).toHaveBeenCalledWith(
            expect.stringContaining("Cannot apply the hillshade overlay"),
            expect.any(Error)
        );
        expect(engine.getTerrain()).not.toBeNull();
        expect(changes).toEqual(["plan"]);
    });
});

describe("surcouche d'ombrage — cycle de vie", () => {
    it("reposée après un changement de style, à la place que le style neuf lui donne", () => {
        const other = vectorStyle("autre");
        other.layers = [
            { id: "sea", type: "fill", source: "base" },
            { id: "name", type: "symbol", source: "base" },
        ];
        register(
            "plan",
            vector(vectorStyle(), { hillshade: { ...SHADING, beforeLayer: "water" } })
        );
        register("autre", vector(other, { hillshade: { ...SHADING } }));
        setBaseLayer("plan");

        setBaseLayer("autre");

        expect(engine.order()).toEqual(["sea", OVERLAY_LAYER, "name"]);
        expect(engine.refusals()).toEqual([]);
    });

    it("retirée au passage vers un fond vectoriel qui n'en déclare pas", () => {
        const other = vectorStyle("autre");
        other.layers = [{ id: "sea", type: "fill", source: "base" }];
        register("plan", vector(vectorStyle(), { hillshade: { ...SHADING } }));
        register("autre", vector(other));
        setBaseLayer("plan");

        setBaseLayer("autre");

        expect(engine.order()).toEqual(["sea"]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("retirée au passage d'un fond vectoriel à un fond en tuiles qui n'en déclare pas", () => {
        register("plan", vector(vectorStyle(), { hillshade: { ...SHADING } }));
        register("tuiles", tiles(TILES_A));
        setBaseLayer("plan");

        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("retirée entre deux fonds en tuiles, par mutation des tuiles comme par reconstruction", () => {
        register("a", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("b", tiles(TILES_B));
        register("c", tiles(TILES_A, { attribution: "© C", hillshade: { ...SHADING } }));
        register("d", tiles(TILES_B, { attribution: "© D" }));

        // Same source spec but the tiles: the live source is mutated, nothing is rebuilt.
        setBaseLayer("a");
        setBaseLayer("b");
        expect(engine.order()).toEqual([BASEMAP_LAYER]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();

        // A different credit: the source is destroyed and rebuilt.
        setBaseLayer("c");
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
        setBaseLayer("d");
        expect(engine.order()).toEqual([BASEMAP_LAYER]);
        expect(engine.refusals()).toEqual([]);
    });

    it("même surcouche d'un fond à l'autre : rien n'est retiré ni reposé", () => {
        engine.addSource("gl-src-data", { type: "geojson", data: null });
        engine.addLayer({ id: "gl-data", type: "circle", source: "gl-src-data" });
        register("a", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("b", tiles(TILES_B, { hillshade: { ...SHADING } }));
        register("c", tiles(TILES_A, { attribution: "© C", hillshade: { ...SHADING } }));
        setBaseLayer("a");
        expect(overlayCalls("addSource")).toBe(1);

        setBaseLayer("b"); // tiles mutated in place
        setBaseLayer("c"); // source rebuilt

        // The DEM tiles the overlay holds are not thrown away for a basemap that changes under it.
        expect(overlayCalls("addSource")).toBe(1);
        expect(overlayCalls("addLayer")).toBe(1);
        expect(overlayCalls("removeSource")).toBe(0);
        expect(overlayCalls("removeLayer")).toBe(0);
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER, "gl-data"]);
    });

    it("surcouche différente d'un fond à l'autre : remplacée une fois, source comprise", () => {
        register("a", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("b", tiles(TILES_B, { hillshade: { ...SHADING, exaggeration: 0.8 } }));
        setBaseLayer("a");

        setBaseLayer("b");

        expect(overlay()?.paint).toMatchObject({ "hillshade-exaggeration": 0.8 });
        expect(overlayCalls("removeLayer")).toBe(1);
        expect(overlayCalls("removeSource")).toBe(1);
        expect(overlayCalls("addSource")).toBe(2);
        // Layer first, then source: the engine refuses to remove a source a layer still reads.
        expect(engine.refusals()).toEqual([]);
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
    });

    it("deux fonds vectoriels au même style, un seul avec la surcouche", () => {
        installAdapter([]);
        register("plan", vector(vectorStyle()));
        register("plan-ombre", vector(vectorStyle(), { hillshade: { ...SHADING } }));
        setBaseLayer("plan");

        // No style arrives on this switch: the landmarks are those read when it did.
        setBaseLayer("plan-ombre");
        expect(engine.order()).toEqual(["land", "water", "road", OVERLAY_LAYER, "place", "poi"]);
        expect(engine.setStyle).toHaveBeenCalledTimes(1);

        setBaseLayer("plan");
        expect(engine.order()).toEqual(["land", "water", "road", "place", "poi"]);
        expect(changes).toEqual(["plan", "plan-ombre", "plan"]);
    });

    it("deux fonds vectoriels au même style qui ne diffèrent que par `beforeLayer`", () => {
        installAdapter([]);
        register("haut", vector(vectorStyle(), { hillshade: { ...SHADING } }));
        register("bas", vector(vectorStyle(), { hillshade: { ...SHADING, beforeLayer: "water" } }));
        setBaseLayer("haut");

        setBaseLayer("bas");

        expect(engine.order()).toEqual(["land", OVERLAY_LAYER, "water", "road", "place", "poi"]);
    });

    it("fond WMTS : absente pendant la résolution, présente ensuite", async () => {
        let land!: (url: string | null) => void;
        resolveWmtsTilesUrl.mockReturnValueOnce(
            new Promise<string | null>((resolve) => {
                land = resolve;
            })
        );
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("wmts", {
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml", layer: "plan" },
            hillshade: { ...SHADING },
        });
        setBaseLayer("tuiles");
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);

        setBaseLayer("wmts");
        // The slot is empty: a shading left there would be drawn over nothing.
        expect(engine.order()).toEqual([]);

        land(WMTS_TILES);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
        expect(engine.style().sources[BASEMAP_SOURCE]?.tiles).toEqual([WMTS_TILES]);
    });

    it("fond WMTS dont la résolution échoue : aucune surcouche", async () => {
        resolveWmtsTilesUrl.mockResolvedValueOnce(null);
        register("wmts", {
            type: "wmts",
            wmts: { getCapabilitiesUrl: "https://wmts.example.com/caps.xml", layer: "plan" },
            hillshade: { ...SHADING },
        });

        setBaseLayer("wmts");
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(engine.order()).toEqual([]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("un fond qui ne se pose pas ne garde pas la surcouche du précédent", () => {
        // `buildWmsUrl` renders nothing: the WMS basemap logs its error and leaves the slot empty.
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("wms", { type: "wms", wms: {}, hillshade: { ...SHADING } });
        setBaseLayer("tuiles");

        setBaseLayer("wms");

        expect(engine.order()).toEqual([]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("un fond dont la pose lève ne garde pas la surcouche du précédent", () => {
        register("a", tiles(TILES_A, { hillshade: { ...SHADING } }));
        register("b", tiles(TILES_B, { attribution: "© B", hillshade: { ...SHADING } }));
        setBaseLayer("a");
        const addSource = engine.addSource.getMockImplementation();
        engine.addSource.mockImplementation((id: string, spec: Record<string, unknown>) => {
            if (id === BASEMAP_SOURCE) throw new Error("refus du moteur");
            return addSource?.(id, spec) as never;
        });

        setBaseLayer("b");

        expect(engine.order()).toEqual([]);
        expect(engine.style().sources[OVERLAY_SOURCE]).toBeUndefined();
    });

    it("même style sans `symbol` : les repères lus à son arrivée servent encore", () => {
        // The switch brings no style to read the landmarks from, and the live style now holds
        // a carried `symbol` layer the basemap never had — above a data layer, so that taking
        // it for the style's first label layer would put the shading over the data.
        installAdapter(["gl-data", "td-point-marker"]);
        engine.addSource("td-src", { type: "geojson", data: null });
        engine.addLayer({ id: "gl-data", type: "circle", source: "td-src" });
        engine.addLayer({ id: "td-point-marker", type: "symbol", source: "td-src" });
        register("nu", vector(unlabelledStyle()));
        register("nu-ombre", vector(unlabelledStyle(), { hillshade: { ...SHADING } }));
        setBaseLayer("nu");

        setBaseLayer("nu-ombre");

        expect(engine.order()).toEqual([
            "land",
            "water",
            "road",
            OVERLAY_LAYER,
            "gl-data",
            "td-point-marker",
        ]);
    });

    it("`refreshBasemap` repose la surcouche avec le fond", () => {
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));
        setBaseLayer("tuiles");
        // The loss `refreshBasemap` exists for: the style was emptied under the active basemap.
        engine.removeLayer(OVERLAY_LAYER);
        engine.removeSource(OVERLAY_SOURCE);
        engine.removeLayer(BASEMAP_LAYER);
        engine.removeSource(BASEMAP_SOURCE);

        refreshBasemap();

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
    });

    it("après un démontage, une carte neuve reçoit sa surcouche", () => {
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));
        setBaseLayer("tuiles");
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);

        // Nothing about the overlay is remembered outside the map that carried it.
        resetBasemapRegistry();
        engine = createStyleEngine();
        setMap(engine as never);
        register("tuiles", tiles(TILES_A, { hillshade: { ...SHADING } }));
        setBaseLayer("tuiles");

        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
    });
});

describe("surcouche d'ombrage — `onlyWithTerrain` : elle suit le relief", () => {
    const FOLLOWS = { ...SHADING, onlyWithTerrain: true };
    /** A terrain that follows the tilt: absent while the map is flat. */
    const TILT = { enabled: true, demUrl: DEM, activation: "pitch" };
    const visibility = (): unknown => overlay()?.layout?.visibility;

    type Spy = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
    /** Order number of the last call of `name` made for the `terrain` event, or -1. */
    const lastForTerrain = (name: "on" | "off"): number => {
        const spied = engine[name] as unknown as Spy;
        const at = spied.mock.calls.map(([type]) => type).lastIndexOf("terrain");
        return at < 0 ? -1 : (spied.mock.invocationCallOrder[at] as number);
    };

    it("carte à plat, relief qui suit l'inclinaison : posée, et masquée", () => {
        register("fond", tiles(TILES_A, { terrain: TILT, hillshade: FOLLOWS }));

        setBaseLayer("fond");

        // There, under its own id and on its own source — and hidden: a hidden layer reads
        // nothing, so its source requests no elevation tile.
        expect(engine.order()).toEqual([BASEMAP_LAYER, OVERLAY_LAYER]);
        expect(visibility(), "la surcouche est visible sur une carte sans relief").toBe("none");
    });

    it("le relief posé la montre, le relief retiré la masque", () => {
        register("fond", tiles(TILES_A, { terrain: TILT, hillshade: FOLLOWS }));
        setBaseLayer("fond");

        engine.rest(45);
        expect(
            engine.getTerrain(),
            "le relief n'est pas posé : le test ne prouve rien"
        ).not.toBeNull();
        expect(visibility(), "le relief est posé, la surcouche est restée masquée").toBe("visible");

        engine.rest(0);
        expect(visibility(), "le relief est parti, la surcouche est restée visible").toBe("none");
    });

    // The basemap's terrain is settled AFTER its overlay, on every path: the overlay cannot read
    // it when it is added, it has to be told.
    it("relief `default3D` : montrée dès la sélection, le relief étant posé après elle", () => {
        register("fond", tiles(TILES_A, { terrain: TERRAIN, hillshade: FOLLOWS }));

        setBaseLayer("fond");

        expect(visibility()).toBe("visible");
    });

    it("sans la clé : toujours dessinée, et le relief ne la touche pas", () => {
        register("fond", tiles(TILES_A, { terrain: TILT, hillshade: { ...SHADING } }));
        setBaseLayer("fond");
        expect(visibility(), "une surcouche qui ne suit rien est masquée").toBeUndefined();

        engine.rest(45);
        engine.rest(0);

        expect(visibility()).toBeUndefined();
        expect(engine.setLayoutProperty).not.toHaveBeenCalled();
        expect(lastForTerrain("on"), "une surcouche qui ne suit rien écoute le relief").toBe(-1);
    });

    // An overlay that follows the terrain and one that does not share the `terrain` event when
    // both were on the map in turn: the second must not inherit the first one's behaviour.
    it("sans la clé, après un fond qui la portait : le relief ne la masque pas", () => {
        register("suit", tiles(TILES_A, { terrain: TILT, hillshade: FOLLOWS }));
        register("fixe", tiles(TILES_B, { terrain: TILT, hillshade: { ...SHADING } }));
        setBaseLayer("suit");
        expect(visibility()).toBe("none");

        setBaseLayer("fixe");
        engine.rest(45);
        engine.rest(0);

        expect(visibility(), "la surcouche sans la clé a été masquée avec le relief").not.toBe(
            "none"
        );
    });

    it("la clé entre dans la signature : d'un fond à l'autre, la surcouche est reposée", () => {
        register("a", tiles(TILES_A, { terrain: TILT, hillshade: { ...SHADING } }));
        register("b", tiles(TILES_B, { terrain: TILT, hillshade: FOLLOWS }));
        setBaseLayer("a");
        expect(visibility()).toBeUndefined();

        setBaseLayer("b");

        expect(overlayCalls("addLayer"), "la surcouche du fond précédent a été gardée").toBe(2);
        expect(visibility()).toBe("none");
    });

    it("même surcouche d'un fond à l'autre : gardée, et remise d'accord avec le relief", () => {
        register("relief", tiles(TILES_A, { terrain: TERRAIN, hillshade: FOLLOWS }));
        register("incline", tiles(TILES_B, { terrain: TILT, hillshade: FOLLOWS }));
        setBaseLayer("relief");
        expect(visibility()).toBe("visible");

        // The relief of the basemap left goes; the one that follows the tilt is not on, flat.
        setBaseLayer("incline");

        expect(overlayCalls("addLayer"), "une surcouche identique a été reposée").toBe(1);
        expect(visibility()).toBe("none");
    });

    it("l'écouteur du relief part avec la surcouche", () => {
        register("fond", tiles(TILES_A, { terrain: TILT, hillshade: FOLLOWS }));
        register("plat", tiles(TILES_B));
        setBaseLayer("fond");
        expect(lastForTerrain("on"), "la surcouche n'écoute pas le relief").toBeGreaterThan(-1);

        setBaseLayer("plat");

        expect(overlay()).toBeUndefined();
        expect(lastForTerrain("off"), "l'écouteur est resté après la surcouche").toBeGreaterThan(
            lastForTerrain("on")
        );
    });

    // A style the engine rebuilds takes the overlay away AND resets the terrain, before the
    // kernel has put anything back: the listener is still there, the layer is not.
    it("style reconstruit par le moteur : l'événement du relief ne s'écrit pas sur une couche partie", () => {
        register("fond", tiles(TILES_A, { terrain: TILT, hillshade: FOLLOWS }));
        setBaseLayer("fond");
        engine.rest(45);
        expect(visibility()).toBe("visible");

        engine.startRebuild();
        engine.landRebuild();

        expect(overlay(), "le style reconstruit porte encore la surcouche").toBeUndefined();
        expect(engine.refusals(), "le moteur a refusé une écriture").toEqual([]);
    });

    it("sans relief déclaré : dit à l'enregistrement — la surcouche ne se montrerait jamais", () => {
        register("fond", tiles(TILES_A, { hillshade: FOLLOWS }));

        expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("never show"));
    });
});
