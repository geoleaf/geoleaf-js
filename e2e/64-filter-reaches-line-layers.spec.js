// @ts-check
/**
 * 64 — THE FILTER REACHES A LINE LAYER
 *
 * 🛑 THE DEFECT, MEASURED ON 26/09/2026 on the shipped bundle. The kernel filter skipped every
 * line layer unless it declared `search.enabled: true`, a key the profile schema no longer
 * accepts: no profile could opt a line layer in, and a text search left every road drawn while
 * it hid the polygons around them. The documented contract says the opposite — a field without
 * `layers` filters every layer, whatever its geometry.
 *
 * Asserted where the user sees it: the features MapLibre renders on the layer's own sub-layers,
 * before, during and after a text search that names one road. Seen red on the bundle built
 * before the fix: the other roads stayed rendered under the search.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

const LAYER = "routes_principales";
/** A road name no other feature of the layer carries, and long enough to render at any zoom. */
const TARGET = "Autovía Juan Manuel Fangio";
const WAIT_MS = 20_000;

/**
 * The distinct `name`s MapLibre currently renders on the layer's own sub-layers.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
function renderedNames(page) {
    return page.evaluate((id) => {
        const adapter = /** @type {any} */ (window).GeoLeaf.Core.getMap();
        const map = adapter.getNativeMap();
        const layers = adapter
            .getLayerRegistry()
            .getSubLayerIds(id)
            .filter((/** @type {string} */ l) => map.getLayer(l));
        const names = new Set(
            map
                .queryRenderedFeatures({ layers })
                .map((/** @type {any} */ f) => String(f.properties?.name ?? ""))
        );
        return [...names].sort();
    }, LAYER);
}

test("[filter] une recherche texte filtre aussi une couche de lignes", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: WAIT_MS });
    await page.waitForFunction(
        (id) => {
            const w = /** @type {any} */ (window);
            try {
                return w.GeoLeaf?.Filter?.isEnabled?.() && w.GeoLeaf.Layers.getFeatureCount(id) > 0;
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: WAIT_MS }
    );

    // Show the layer and frame the target road, with its neighbours around it — once the boot's
    // own camera work is over, or it frames the country again over ours (and the layer's
    // `minZoom` then hides it).
    await awaitSettledCamera(page);
    const framed = await page.evaluate(
        ([id, name]) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            G.Layers.setVisibility(id, true, "user");
            const road = G.Layers.getFeatures(id).find(
                (/** @type {any} */ f) => f.properties?.name === name
            );
            if (!road) return false;
            const coords = road.geometry.type.startsWith("Multi")
                ? road.geometry.coordinates.flat()
                : road.geometry.coordinates;
            const lngs = coords.map((/** @type {number[]} */ c) => c[0]);
            const lats = coords.map((/** @type {number[]} */ c) => c[1]);
            G.Core.getMap()
                .getNativeMap()
                .fitBounds(
                    [
                        [Math.min(...lngs), Math.min(...lats)],
                        [Math.max(...lngs), Math.max(...lats)],
                    ],
                    { animate: false, padding: 40 }
                );
            return true;
        },
        [LAYER, TARGET]
    );
    expect(
        framed,
        `la couche \`${LAYER}\` ne porte plus « ${TARGET} » : la spec ne mord plus`
    ).toBe(true);

    // Control: the target and at least one other road are drawn before any filter.
    await expect
        .poll(() => renderedNames(page), { timeout: WAIT_MS })
        .toEqual(expect.arrayContaining([TARGET]));
    expect((await renderedNames(page)).length, "d'autres routes sont dessinées").toBeGreaterThan(1);

    await page.evaluate((text) => {
        /** @type {any} */ (window).GeoLeaf.Filter.applyFilter({
            fields: [{ id: "searchText", kind: "text", text }],
        });
    }, TARGET);
    await expect
        .poll(() => renderedNames(page), {
            timeout: WAIT_MS,
            message: "sous la recherche, seule la route nommée reste dessinée",
        })
        .toEqual([TARGET]);

    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Filter.reset());
    await expect
        .poll(async () => (await renderedNames(page)).length, {
            timeout: WAIT_MS,
            message: "la recherche levée, les autres routes reviennent",
        })
        .toBeGreaterThan(1);
});
