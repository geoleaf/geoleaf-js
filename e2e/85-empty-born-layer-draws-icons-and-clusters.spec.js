// @ts-check
/**
 * 85 — A POINT LAYER BORN EMPTY DRAWS ITS ICONS AND ITS CLUSTERS ONCE FILLED
 *
 * Two things about a point layer were decided once, at creation, FROM ITS FIRST BATCH — so a
 * layer created with no feature and filled afterwards (`GeoLeaf.GeoJSON.updateLayerData`) never
 * got them:
 *
 * - **its icons.** The icon sub-layer draws the features that carry a `symbolId`, which the
 *   loader injects at the first load, and the sprite's images are registered when the layer is
 *   added — on a collection that holds an icon. A later write went to the source as it was:
 *   no `symbolId`, no image, a bare disc where the icon should be.
 * - **its clusters.** A source is built clustered or not, for good, and the strategy answered
 *   "no" to a collection with no point in it — which an empty one is.
 *
 * A host worked around both by creating the layer with a first feature. This spec is that
 * workaround removed: the layer the profile binds to its taxonomy is created EMPTY, then
 * filled, and what the engine draws is read.
 *
 * 🛑 THE CONTROL IS THE FIRST TEST, AND IT IS NOT DECORATION. The same layer created WITH its
 * batch must show the icon and the bubble: without it, a red on the born-empty leg could mean
 * the fixture never could (a taxonomy that resolves nothing, points too far apart to cluster).
 *
 * Target: `deploy-full`, profile `tourism` — its `modules.taxonomy` binds `hebergements` by id
 * and its `modules.cluster` clusters; the layer belongs to a theme the boot does not load, so
 * its id is free. Seen RED on the deployed build that preceded the fix: no `symbolId` on the
 * written features, no `-clusters` sub-layer.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { bootMapUntilIdle } from "./helpers/boot.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

/** The layer id the profile's taxonomy is bound to. */
const LAYER = "hebergements";
const WAIT_MS = 20_000;

/**
 * Where the points sit, in pixels from the middle of the canvas: three within a few pixels
 * of one another — one bubble — and one alone, far from them, which keeps its icon.
 */
const TOGETHER_PX = [
    [0, 0],
    [4, 3],
    [-3, 4],
];
const ALONE_PX = [260, -120];

/**
 * Boots, lays the four points out on the camera the profile boots on, and creates the layer —
 * with them, or EMPTY and filled afterwards.
 * @param {import('@playwright/test').Page} page
 * @param {{ bornEmpty: boolean }} opts
 */
async function bootWithLayer(page, { bornEmpty }) {
    await bootMapUntilIdle(page);
    await awaitSettledCamera(page);
    await page.evaluate(async ([id, together, alone, empty]) => {
        const w = /** @type {any} */ (window);
        const G = w.GeoLeaf;
        const map = G.Core.getMap().getNativeMap();
        const canvas = map.getCanvas();
        const mid = [canvas.clientWidth / 2, canvas.clientHeight / 2];
        const point = (px, n) => ({
            type: "Feature",
            id: `p${n}`,
            // What the profile's taxonomy reads to resolve an icon.
            properties: { id: `p${n}`, categoryId: "HEBERGEMENT", subcategoryId: "HOTEL" },
            geometry: {
                type: "Point",
                coordinates: map.unproject([mid[0] + px[0], mid[1] + px[1]]).toArray(),
            },
        });
        const batch = {
            type: "FeatureCollection",
            features: [...together, alone].map(point),
        };
        await G.Layers.create({
            id,
            label: "E2E — hébergements",
            geometry: "point",
            showIconsOnMap: true,
            clustering: { enabled: true },
            inlineData: empty ? { type: "FeatureCollection", features: [] } : batch,
        });
        if (empty) G.GeoJSON.updateLayerData(id, batch);
    }, /** @type {[string, number[][], number[], boolean]} */ ([LAYER, TOGETHER_PX, ALONE_PX, bornEmpty]));
}

/** What the engine and the store hold for the layer, in one reading. */
function reading(page) {
    return page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const adapter = G.Core.getMap();
        const map = adapter.getNativeMap();
        const subs = adapter.getLayerRegistry().getSubLayerIds(id);
        const drawn = (suffix) => {
            const sub = subs.find((s) => s.endsWith(suffix));
            return sub ? map.queryRenderedFeatures({ layers: [sub] }).length : null;
        };
        const symbolIds = [
            ...new Set(G.Layers.getFeatures(id).map((f) => f.properties?.symbolId ?? null)),
        ];
        return {
            // Every stored feature names an icon, and the engine holds its image.
            everyFeatureNamesAnIcon: symbolIds.length > 0 && !symbolIds.includes(null),
            everyIconHasItsImage: symbolIds.every((s) => s !== null && map.hasImage(s)),
            iconsDrawn: drawn("-symbol"),
            bubblesDrawn: drawn("-clusters"),
        };
    }, LAYER);
}

/** The point left alone draws its icon; the three others draw one bubble. */
const EXPECTED = {
    everyFeatureNamesAnIcon: true,
    everyIconHasItsImage: true,
    iconsDrawn: 1,
    bubblesDrawn: 1,
};

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
});

test("[geojson] témoin — la couche créée AVEC ses points dessine une icône et une grappe", async ({
    page,
}) => {
    await bootWithLayer(page, { bornEmpty: false });
    await expect.poll(() => reading(page), { timeout: WAIT_MS }).toEqual(EXPECTED);
});

test("[geojson] la même couche née VIDE puis remplie dessine la même icône et la même grappe", async ({
    page,
}) => {
    await bootWithLayer(page, { bornEmpty: true });
    await expect.poll(() => reading(page), { timeout: WAIT_MS }).toEqual(EXPECTED);
});
