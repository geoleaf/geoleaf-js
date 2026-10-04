// @ts-check
/**
 * 72 — A « MIXED » VECTOR-TILE LAYER DRAWS EACH GEOMETRY ON THE SUB-LAYER MADE FOR IT
 *
 * A vector-tile layer declared `geometry: "mixed"` builds a fill, a line and a circle sub-layer
 * over the SAME source-layer. The engine does not check the geometry type when it fills a bucket:
 * left unfiltered, the circle sub-layer draws a circle on every vertex of every line and polygon.
 * Each sub-layer therefore carries a geometry guard, set when it is built
 * (`packages/core/src/adapters/maplibre/maplibre-vector-tiles.ts`).
 *
 * 🛑 WHAT A REAL TILE ESTABLISHES, AND THE UNIT TEST COULD NOT. The guard was proven on a map
 * double, which evaluates no expression. Two things were left open: that the defect exists as
 * described, and that `["geometry-type"]` answers, on a vector tile, the names the guard lists.
 * A tile knows three geometry types, not six — a MultiPolygon travels as a polygon with several
 * rings — so a guard written against the wrong names would EMPTY a sub-layer instead of confining
 * it. Hence the fixture: the six GeoJSON kinds in ONE source-layer, and every sub-layer asserted
 * non-empty as well as confined.
 *
 * The tiles are cut here, off-network, from an inline GeoJSON. No shipped profile declares a mixed
 * layer, so the layer is created through `GeoLeaf.Layers.create()`: the mechanism is the subject,
 * not a profile. What is read is what the engine RENDERS (`queryRenderedFeatures`), per sub-layer.
 *
 * Seen RED by mutation of the SERVED bundle (the confinement switched off; bytes restored,
 * `sha256sum -c`, the precompressed variants set aside so nginx serves the mutation).
 *
 * THE SAME TILES CARRY A SECOND SUBJECT: the names a layer may give its geometry. The layer schema
 * admits `polyline` and `multiline` beside `line`, and the builder once kept its own lists, which
 * held neither — a layer declared with one of them built no sub-layer and said nothing. The last
 * test creates one layer per name and reads what each one draws. Seen RED on the deployed build
 * that preceded the fix: no sub-layer in the registry for either name.
 */

import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

const ID = "e2e_vt_mixed";
/** The one source-layer every feature lives in. */
const SOURCE_LAYER = "mixed";
/** Tiles are served under this path segment, on the page's own origin. */
const TILE_SEGMENT = "__e2e_vt_mixed__";
const WAIT_MS = 20_000;

/** The names the layer schema gives a line layer, beside `line`. */
const LINE_KINDS = ["polyline", "multiline"];

/** The middle vertex of the `line` feature, and the middle of its first segment. */
const LINE_VERTEX = [-62, -34.5];
const LINE_MIDDLE = [-62.5, -34.25];

/** One feature per GeoJSON geometry kind, each named by `properties.kind`. */
const FEATURES = {
    type: "FeatureCollection",
    features: [
        feature("point", "Point", [-62, -33]),
        feature("multipoint", "MultiPoint", [
            [-61, -33],
            [-60.5, -33],
        ]),
        feature("line", "LineString", [[-63, -34], LINE_VERTEX, [-61, -34]]),
        feature("multiline", "MultiLineString", [
            [
                [-60, -34],
                [-59.5, -34.5],
            ],
            [
                [-59, -34],
                [-58.5, -34.5],
            ],
        ]),
        feature("polygon", "Polygon", [square(-63, -36.5, 1)]),
        feature("multipolygon", "MultiPolygon", [
            [square(-61, -36.5, 1)],
            [square(-59.5, -36.5, 1)],
        ]),
    ],
};

/** What each sub-layer may draw: lines also draw the polygons' outlines. */
const CONFINED = {
    fill: ["multipolygon", "polygon"],
    line: ["line", "multiline", "multipolygon", "polygon"],
    circle: ["multipoint", "point"],
};

function feature(kind, type, coordinates) {
    return { type: "Feature", properties: { kind }, geometry: { type, coordinates } };
}

/** A closed square ring, from its south-west corner. */
function square(west, south, side) {
    return [
        [west, south],
        [west + side, south],
        [west + side, south + side],
        [west, south + side],
        [west, south],
    ];
}

const tileIndex = new GeoJSONVT(FEATURES, { maxZoom: 14, indexMaxZoom: 5 });

/**
 * Serves every `{z}/{x}/{y}.pbf` under the tile segment, cut from the fixture.
 * @param {import('@playwright/test').BrowserContext} context
 */
async function serveVectorTiles(context) {
    await context.route(`**/${TILE_SEGMENT}/**`, async (route) => {
        const [z, x, y] = new URL(route.request().url()).pathname
            .replace(/\.pbf$/, "")
            .split("/")
            .slice(-3)
            .map((n) => Number.parseInt(n, 10));
        const tile = tileIndex.getTile(z, x, y);
        if (!tile) return route.fulfill({ status: 204, body: "" });
        const body = Buffer.from(
            fromGeojsonVt({ [SOURCE_LAYER]: tile }, { version: 2, extent: 4096 })
        );
        return route.fulfill({ status: 200, contentType: "application/x-protobuf", body });
    });
}

/**
 * Boots, creates one layer per entry over the served tiles, and frames the six features.
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, geometry: string }[]} layers
 */
async function bootWithLayers(page, layers) {
    await page.goto("/");
    await page.waitForFunction(() => /** @type {any} */ (window).GeoLeaf?.Layers?.create, null, {
        timeout: WAIT_MS,
    });
    await awaitSettledCamera(page);
    await page.evaluate(
        async ([defs, tilesUrl, layerName]) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            for (const { id, geometry } of defs) {
                await G.Layers.create({
                    id,
                    label: `E2E — tuiles ${geometry}`,
                    geometry,
                    data: {
                        vectorTiles: {
                            enabled: true,
                            tilesUrl,
                            layerName,
                            minZoom: 0,
                            maxNativeZoom: 14,
                            maxZoom: 18,
                        },
                    },
                });
            }
            G.Core.getMap()
                .getNativeMap()
                .fitBounds(
                    [
                        [-64, -37],
                        [-58, -32.5],
                    ],
                    { animate: false, padding: 40 }
                );
        },
        /** @type {[{ id: string, geometry: string }[], string, string]} */ ([
            layers,
            `${new URL(page.url()).origin}/${TILE_SEGMENT}/{z}/{x}/{y}.pbf`,
            SOURCE_LAYER,
        ])
    );
}

/** Boots with the one mixed layer the first two tests read. */
function bootWithMixedLayer(page) {
    return bootWithLayers(page, [{ id: ID, geometry: "mixed" }]);
}

/**
 * The kinds the engine draws on each sub-layer, deduplicated across tiles and sorted, keyed by
 * the sub-layer's type (`fill`, `line`, `circle`…).
 */
function rendered(page, layerId = ID) {
    return page.evaluate((id) => {
        const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
        const map = adapter.getNativeMap();
        const subs = adapter.getLayerRegistry().getSubLayerIds(id);
        return Object.fromEntries(
            subs.map((sub) => [
                sub.slice(`gl-${id}-`.length),
                [
                    ...new Set(
                        map.queryRenderedFeatures({ layers: [sub] }).map((f) => f.properties?.kind)
                    ),
                ].sort(),
            ])
        );
    }, layerId);
}

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    await serveVectorTiles(context);
});

test("[vector-tiles] une couche « mixed » dessine chaque géométrie sur la sous-couche faite pour elle", async ({
    page,
}) => {
    await bootWithMixedLayer(page);

    // Polled as a whole: the three sub-layers fill as the tiles land, in no given order. An empty
    // sub-layer never equals its list, so a guard that matched nothing fails here too.
    await expect
        .poll(() => rendered(page), {
            timeout: WAIT_MS,
            message: "chaque sous-couche dessine ses géométries, et elles seules",
        })
        .toEqual(CONFINED);
});

test("[vector-tiles] sans sa garde, la sous-couche des points dessine un cercle par sommet", async ({
    page,
}) => {
    // 🛑 THIS TEST STATES THE MOTIVE, NOT THE PRODUCT. It takes the guard off the live map and
    // reads what the engine does then. Should it turn red, the engine has started checking the
    // geometry itself — and the guard's reason is what needs re-reading, not this spec.
    await bootWithMixedLayer(page);
    await expect.poll(() => rendered(page), { timeout: WAIT_MS }).toEqual(CONFINED);

    await page.evaluate((id) => {
        /** @type {any} */ (window).GeoLeaf.Core.getMap()
            .getNativeMap()
            .setFilter(`gl-${id}-circle`, null);
    }, ID);

    await expect
        .poll(async () => (await rendered(page)).circle, {
            timeout: WAIT_MS,
            message: "sans filtre, la sous-couche des points reçoit les lignes et les polygones",
        })
        .toEqual(["line", "multiline", "multipoint", "multipolygon", "point", "polygon"]);

    // One circle per VERTEX: the line is hit on its middle vertex, not along its segment.
    const hits = await page.evaluate(
        ([id, vertex, middle]) => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const at = (lngLat) => {
                const p = map.project(lngLat);
                return map
                    .queryRenderedFeatures(
                        [
                            [p.x - 2, p.y - 2],
                            [p.x + 2, p.y + 2],
                        ],
                        { layers: [`gl-${id}-circle`] }
                    )
                    .map((f) => f.properties?.kind);
            };
            return { vertex: at(vertex), middle: at(middle) };
        },
        [ID, LINE_VERTEX, LINE_MIDDLE]
    );
    expect(hits.vertex, "un cercle est dessiné sur le sommet de la ligne").toContain("line");
    expect(hits.middle, "aucun cercle n'est dessiné le long du segment").toEqual([]);
});

test("[vector-tiles] une couche déclarée « polyline » ou « multiline » dessine ses lignes", async ({
    page,
}) => {
    const layers = LINE_KINDS.map((geometry) => ({ id: `e2e_vt_${geometry}`, geometry }));
    await bootWithLayers(page, layers);

    for (const { id, geometry } of layers) {
        await expect
            .poll(async () => Object.keys(await rendered(page, id)), {
                timeout: WAIT_MS,
                message: `« ${geometry} » bâtit une sous-couche de lignes, et elle seule`,
            })
            .toEqual(["line"]);
        // The layer is not `mixed`, so its sub-layer is not confined: over this fixture it also
        // draws the outlines of the polygons. The lines are the subject — both encodings of them.
        await expect
            .poll(async () => (await rendered(page, id)).line, {
                timeout: WAIT_MS,
                message: `« ${geometry} » dessine les lignes de la tuile`,
            })
            .toEqual(expect.arrayContaining(["line", "multiline"]));
    }
});
