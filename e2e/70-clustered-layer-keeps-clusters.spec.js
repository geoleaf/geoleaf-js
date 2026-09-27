// @ts-check
/**
 * 70 — HIDING A POINT OF A CLUSTERED LAYER KEEPS ITS CLUSTERS
 *
 * 🛑 THE DEFECT, traced on 27/09/2026 by the adversarial pass before the 3.12.0 publication.
 * A clustered layer's sub-layers are BUILT with the predicates that tell a cluster from a point:
 * the unclustered circle draws what has no `point_count`, the bubbles and their count what has
 * one. `setLayerFilter` substituted the caller's filter for them: once `hideFeatures` (or the
 * editor, hiding the feature it edits) wrote a filter, the circle drew every cluster centroid as
 * a point and the bubbles drew every point as a cluster — and clearing it removed the predicates
 * for good.
 *
 * The layer is `sites_de_conservation_wdpa`, clustered (radius 80) and loaded at boot, served here as twenty points packed in one
 * cluster and three points far apart, each with a unique `properties.id`. What is read is what
 * the engine RENDERS (`queryRenderedFeatures`), not the filter expressions: a centroid among the
 * points, or a point among the bubbles, is the defect. Seen red by mutation of the served bundle
 * (the composition turned back into a substitution).
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

const LAYER = "sites_de_conservation_wdpa";
const WAIT_MS = 20_000;
const SINGLES = [
    [-64, -32],
    [-60, -36],
    [-56, -32],
];

/** Twenty points within 0.01° of (-60, -32) — one cluster — and three points 4° away. */
function points() {
    const packed = Array.from({ length: 20 }, (_, i) =>
        point(`h-packed-${i}`, [-60 + (i % 5) * 0.002, -32 + Math.floor(i / 5) * 0.002])
    );
    const singles = SINGLES.map((at, i) => point(`h-single-${i}`, at));
    return { type: "FeatureCollection", features: [...packed, ...singles] };
}

function point(id, coordinates) {
    return {
        type: "Feature",
        properties: { id, name: id },
        geometry: { type: "Point", coordinates },
    };
}

/**
 * Serves the points. Routes on the CONTEXT: the GeoJSON loader fetches from a Web Worker.
 *
 * @param {import("@playwright/test").BrowserContext} context
 */
async function armLayer(context) {
    await context.route(`**/${LAYER}/data/${LAYER}.geojson**`, (route) =>
        route.fulfill({ contentType: "application/geo+json", body: JSON.stringify(points()) })
    );
}

/** Boots, shows the layer, and frames the four groups once the boot's camera work is over. */
async function boot(page) {
    await page.goto("/");
    await page.waitForFunction(
        (id) => {
            try {
                return /** @type {any} */ (window).GeoLeaf.Layers.getFeatureCount(id) === 23;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: WAIT_MS }
    );
    await awaitSettledCamera(page);
    await page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        G.Layers.setVisibility(id, true, "user");
        G.Core.getMap()
            .getNativeMap()
            .fitBounds(
                [
                    [-65, -37],
                    [-55, -31],
                ],
                { animate: false, padding: 40 }
            );
    }, LAYER);
}

/**
 * What the engine draws on the unclustered circle and on the bubbles, deduplicated across tiles:
 * how many of each, and how many of each are of the OTHER kind.
 */
function rendered(page) {
    return page.evaluate((id) => {
        const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
        const map = adapter.getNativeMap();
        const subs = adapter.getLayerRegistry().getSubLayerIds(id);
        const circle = subs.find((s) => s.endsWith("-circle"));
        const bubbles = subs.find((s) => s.endsWith("-clusters"));
        const key = (f) => String(f.properties?.id ?? `cluster:${f.properties?.cluster_id}`);
        const distinct = (layer) => [
            ...new Map(
                map.queryRenderedFeatures({ layers: [layer] }).map((f) => [key(f), f])
            ).values(),
        ];
        const onCircle = distinct(circle);
        const onBubbles = distinct(bubbles);
        return {
            points: onCircle.length,
            centroidsAmongPoints: onCircle.filter((f) => f.properties?.point_count != null).length,
            bubbles: onBubbles.length,
            pointsAmongBubbles: onBubbles.filter((f) => f.properties?.point_count == null).length,
        };
    }, LAYER);
}

/** Every sub-layer's filter, by id. */
function filters(page) {
    return page.evaluate((id) => {
        const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
        const map = adapter.getNativeMap();
        return Object.fromEntries(
            adapter
                .getLayerRegistry()
                .getSubLayerIds(id)
                .map((s) => [s, map.getFilter(s) ?? null])
        );
    }, LAYER);
}

test("🛑 hiding a point of a clustered layer keeps its clusters, and releasing gives them back", async ({
    page,
    context,
}) => {
    await serveBasemapTilesLocally(context);
    await armLayer(context);
    await boot(page);

    const drawn = { points: 3, centroidsAmongPoints: 0, bubbles: 1, pointsAmongBubbles: 0 };
    await expect
        .poll(() => rendered(page), {
            timeout: WAIT_MS,
            message: "le premier rendu n'est pas une bulle et trois points isolés",
        })
        .toEqual(drawn);
    const built = await filters(page);

    await page.evaluate((id) => {
        /** @type {any} */ (window).GeoLeaf.Layers.hideFeatures(id, ["h-single-0"]);
    }, LAYER);
    await expect
        .poll(() => rendered(page), {
            timeout: WAIT_MS,
            message: "masquer un point a fait dessiner une grappe en point, ou un point en bulle",
        })
        .toEqual({ ...drawn, points: 2 });

    await page.evaluate((id) => {
        /** @type {any} */ (window).GeoLeaf.Layers.hideFeatures(id, null);
    }, LAYER);
    expect(await filters(page), "relâcher n'a pas rendu leurs filtres aux sous-couches").toEqual(
        built
    );
    await expect
        .poll(() => rendered(page), {
            timeout: WAIT_MS,
            message: "le rendu d'origine ne revient pas",
        })
        .toEqual(drawn);
});
