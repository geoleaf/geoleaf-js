// @ts-check
// A basemap asked while the style updates does not wake up INSIDE the engine's update, and the
// engine raises nothing — measured on the delivered bundle, in the real MapLibre.
//
// 🛑 THE DEFECT. `setBaseLayer` defers an activation while `isStyleLoaded()` is false and re-tests
// it on `styledata`, `sourcedata` and `idle`. MapLibre 6.7.0 emits one of those FROM INSIDE
// `Style.update`: when a source's `used` flag flips — its layers hidden for a frame, then shown —
// it fires a `sourcedata` of type `visibility` while looping over its tile managers. The
// deferred activation woke there, replaced the style, and so removed tile managers; the loop
// resumed on one that was gone: `TypeError: Cannot read properties of undefined (reading 'used')`
// out of `Map._render`, uncaught. The gesture is ordinary — a theme that shows layers, then a
// basemap picked at once.
//
// ⚠️ WHY A FIXTURE, AND NOT THE PROFILE'S OWN VECTOR BASEMAP. The activation only wakes inside the
// loop if the style already reads loaded at that frame. Third-party vector tiles still loading
// make it read « not loaded », and the wake-up then happens later, outside the update: measured
// on `deploy-full` / `tourism` with `liberty`, 2 times out of 3. The fixture's single source is
// local GeoJSON and the raster tiles are answered locally, so nothing third-party decides the
// verdict.
//
// ⚠️ THE DEFERRAL IS WITNESSED, not assumed: the request must find `isStyleLoaded()` false, or the
// switch went down the immediate path and this spec proves nothing.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const VECTOR_KEY = "e2e-update-vector";
const STYLE_PATH = "/__e2e__/update-vector-style.json";
const STYLE_NAME = "e2e-update-fixture";
const ROUNDS = 3;
const WAIT_MS = 30_000;

/** A background and one empty local fill: no tiles, no glyphs, no sprite. */
const FIXTURE_STYLE = {
    version: 8,
    name: STYLE_NAME,
    sources: {
        "e2e-base": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-background", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-base-fill", type: "fill", source: "e2e-base" },
    ],
};

/**
 * Waits until the map holds `key` as its active basemap with a loaded style.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 */
function waitActive(page, key) {
    return page.waitForFunction(
        (k) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            return (
                G.Baselayers.getActiveKey() === k &&
                G.Core.getMap().getNativeMap().isStyleLoaded() === true
            );
        },
        key,
        { timeout: WAIT_MS }
    );
}

test("un fond demandé pendant la mise à jour du style ne se réveille pas dans le moteur", async ({
    page,
    context,
}) => {
    test.setTimeout(120_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err).split("\n")[0] ?? ""));
    await serveBasemapTilesLocally(context);
    await context.route(`**${STYLE_PATH}*`, (route) => route.fulfill({ json: FIXTURE_STYLE }));
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);

    // The boot basemap is itself deferred until the style loads: wait for it to land.
    await page.waitForFunction(
        () => !!(/** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()),
        null,
        { timeout: WAIT_MS }
    );
    const rasterKey = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()
    );
    await page.evaluate(
        ({ key, url }) =>
            /** @type {any} */ (window).GeoLeaf.Baselayers.registerBaseLayer(key, {
                type: "maplibre",
                label: "E2E vector",
                style: location.origin + url,
            }),
        { key: VECTOR_KEY, url: STYLE_PATH }
    );

    for (let round = 1; round <= ROUNDS; round++) {
        await page.evaluate(
            (key) => /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key),
            VECTOR_KEY
        );
        await waitActive(page, VECTOR_KEY);

        // Every data layer hidden, and one frame rendered so that their sources read unused.
        const hidden = await page.evaluate(() => {
            const G = /** @type {any} */ (window).GeoLeaf;
            const native = G.Core.getMap().getNativeMap();
            const ids = [
                ...new Set(
                    native
                        .getStyle()
                        .layers.map((/** @type {any} */ l) => l.source)
                        .filter((/** @type {any} */ s) => typeof s === "string")
                        .filter((/** @type {string} */ s) => s.startsWith("gl-src-"))
                        .map((/** @type {string} */ s) => s.slice("gl-src-".length))
                ),
            ];
            for (const id of ids) G.GeoJSON.hideLayer(id);
            /** @type {any} */ (window).__e2eHidden = ids;
            return ids.length;
        });
        expect(hidden, "aucune couche de données à masquer").toBeGreaterThan(0);
        await page.waitForFunction(() => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return native.isStyleLoaded() === true && !native.isMoving();
        });
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );

        // Shown again at once, and another basemap asked in the same task.
        const deferred = await page.evaluate((key) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            const native = G.Core.getMap().getNativeMap();
            for (const id of /** @type {any} */ (window).__e2eHidden) G.GeoJSON.showLayer(id);
            const loadedAtRequest = native.isStyleLoaded();
            G.Baselayers.setBaseLayer(key);
            return loadedAtRequest === false;
        }, rasterKey);
        expect(deferred, `tour ${round} : la demande n'est pas passée par le report`).toBe(true);

        await waitActive(page, rasterKey);
        await page.waitForTimeout(500);
        expect(pageErrors, `tour ${round} : le moteur a levé pendant sa mise à jour`).toEqual([]);
    }
});
