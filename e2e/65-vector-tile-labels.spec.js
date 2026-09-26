// @ts-check
/**
 * 65 — A VECTOR-TILE LAYER DRAWS THE LABELS IT DECLARES
 *
 * 🛑 THE DEFECT, MEASURED ON 26/09/2026 on the shipped bundle, with a vector-tile layer armed over
 * it. The label layer was added on the layer's `vector` source without a `source-layer`. MapLibre
 * refuses such a layer, and says so as an `error` EVENT on the map, never a throw: the label toggle
 * read "on", the renderer logged the layer as created, and nothing was drawn. And a vector-tile
 * layer created through `Layers.create()` never armed its declared labels at all — the GeoJSON
 * loader arms them as it loads a layer, the vector-tile branch did not.
 *
 * No shipped profile arms a vector-tile layer, so this spec arms one: `provinces` of `tourism`,
 * served as MVT tiles cut here from the layer's own GeoJSON. Asserted where the user sees it: the
 * symbols MapLibre renders on the label layer. Seen red on the bundle built before the fix, on
 * both paths.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GeoJSONVT } from "@maplibre/geojson-vt";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

const LAYER = "provinces";
/** The label field of the layer's shipped style — every feature carries it. */
const FIELD = "NAM";
/** Tiles are served under this path segment, on the page's own origin. */
const TILE_SEGMENT = "__e2e_vt__";
const WAIT_MS = 20_000;

const features = JSON.parse(
    readFileSync(
        fileURLToPath(
            new URL(`../profiles/tourism/layers/${LAYER}/data/${LAYER}.geojson`, import.meta.url)
        ),
        "utf8"
    )
);
const tileIndex = new GeoJSONVT(features, { maxZoom: 14, indexMaxZoom: 5 });

/**
 * Serves every `{z}/{x}/{y}.pbf` under the tile segment, cut from the layer's GeoJSON.
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
        const body = Buffer.from(fromGeojsonVt({ [LAYER]: tile }, { version: 2, extent: 4096 }));
        return route.fulfill({ status: 200, contentType: "application/x-protobuf", body });
    });
}

/**
 * The vector-tile block that arms a layer, pointing at the tiles served above.
 * @param {string} origin
 */
function vectorTilesBlock(origin) {
    return {
        enabled: true,
        tilesUrl: `${origin}/${TILE_SEGMENT}/{z}/{x}/{y}.pbf`,
        layerName: LAYER,
        minZoom: 0,
        maxNativeZoom: 14,
        maxZoom: 18,
    };
}

/**
 * How many symbols MapLibre renders on the layer's label layer, and the source-layer it reads.
 * @param {import('@playwright/test').Page} page
 * @param {string} layerId
 */
function renderedLabels(page, layerId) {
    return page.evaluate((id) => {
        const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
        const labelLayer = map.getLayer(`gl-${id}-label-text`);
        if (!labelLayer) return { sourceLayer: null, count: 0 };
        return {
            sourceLayer: labelLayer.sourceLayer ?? null,
            count: map.queryRenderedFeatures({ layers: [labelLayer.id] }).length,
        };
    }, layerId);
}

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    await serveVectorTiles(context);
});

test("[vector-tiles] une couche en tuiles armée par le profil dessine ses étiquettes", async ({
    page,
}) => {
    await page.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        const style = bundle.layerStyleDocuments?.[LAYER]?.defaut;
        if (!cfg || style?.label?.field !== FIELD)
            throw new Error(
                `\`${LAYER}\` n'est plus une couche étiquetée sur \`${FIELD}\` : la spec ne mord plus`
            );
        cfg.data.vectorTiles = vectorTilesBlock(new URL(route.request().url()).origin);
        // Shown at load, so the assertion needs no click on the toggle.
        style.label.visibleByDefault = true;
        await route.fulfill({ json: bundle });
    });
    await page.goto("/");
    await page.waitForFunction(
        (id) => /** @type {any} */ (window).GeoLeaf?.GeoJSON?.getLayerById?.(id)?.isVectorTile,
        LAYER,
        { timeout: WAIT_MS }
    );
    await awaitSettledCamera(page);

    await expect
        .poll(async () => (await renderedLabels(page, LAYER)).count, {
            timeout: WAIT_MS,
            message: "les étiquettes de la couche en tuiles sont dessinées",
        })
        .toBeGreaterThan(0);
    expect((await renderedLabels(page, LAYER)).sourceLayer).toBe(LAYER);
});

test("[vector-tiles] une couche en tuiles créée par `Layers.create()` arme les étiquettes qu'elle déclare", async ({
    page,
}) => {
    const ID = "e2e_vt_labels";
    await page.goto("/");
    await page.waitForFunction(() => /** @type {any} */ (window).GeoLeaf?.Layers?.create, null, {
        timeout: WAIT_MS,
    });
    await awaitSettledCamera(page);

    await page.evaluate(
        async ([id, vectorTiles, field]) => {
            await /** @type {any} */ (window).GeoLeaf.Layers.create({
                id,
                label: "E2E — tuiles étiquetées",
                geometry: "polygon",
                data: { vectorTiles },
                labels: { enabled: true, visibleByDefault: true, field },
            });
        },
        [ID, vectorTilesBlock(new URL(page.url()).origin), FIELD]
    );

    await expect
        .poll(async () => (await renderedLabels(page, ID)).count, {
            timeout: WAIT_MS,
            message: "les étiquettes déclarées par la définition sont dessinées",
        })
        .toBeGreaterThan(0);
    expect((await renderedLabels(page, ID)).sourceLayer).toBe(LAYER);
});
