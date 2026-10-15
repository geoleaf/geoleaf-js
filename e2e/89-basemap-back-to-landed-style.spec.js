// @ts-check
// Going back to the vector basemap whose style the map holds, while another one downloads,
// finishes the switch — measured on the delivered bundle, in the real MapLibre.
//
// 🛑 THE DEFECT. A vector basemap A has landed; B is asked by URL and its style is still
// downloading; A is asked again. A's `setStyle` aborts B's download, and A's style, once through
// the transform, equals the live style: MapLibre 6.7.0's `Style.setState` then returns without
// emitting anything — `style.load` never comes, and everything GeoLeaf does on it is skipped. The
// active key read A, but `geoleaf:basemap:change` was never emitted, and what A puts on at landing
// — its relief, its hillshade overlay — stayed off, cut when B was asked.
//
// ⚠️ THE FIXTURES CARRY NO LABELS AND NO FILTERS: either would make the diff non-empty, and the
// switch would then finish for a reason that has nothing to do with the fix. B's style is HELD,
// never answered: its request proves B's `setStyle` ran, and holding it makes the window certain.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { armAppReadyWitness, waitAppReadyWitness } from "./helpers/boot.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const KEY_A = "e2e-landed-a";
const KEY_B = "e2e-landed-b";
const PATH_A = "/__e2e__/landed-a-style.json";
const PATH_B = "/__e2e__/landed-b-style.json";
const NAME_A = "e2e-landed-a";
const WAIT_MS = 30_000;

/** A background and one empty local fill: no tiles, no glyphs, no sprite, no filter. */
const STYLE_A = {
    version: 8,
    name: NAME_A,
    sources: {
        "e2e-a": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
        { id: "e2e-a-background", type: "background", paint: { "background-color": "#e8eef2" } },
        { id: "e2e-a-fill", type: "fill", source: "e2e-a" },
    ],
};

test("revenir au fond dont le style est posé, pendant qu'un autre se télécharge, achève la bascule", async ({
    page,
    context,
}) => {
    test.setTimeout(90_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err).split("\n")[0] ?? ""));
    await serveBasemapTilesLocally(context);
    await context.route(`**${PATH_A}*`, (route) => route.fulfill({ json: STYLE_A }));
    let askedForB = 0;
    // Held for the whole test: B's download never completes.
    await context.route(`**${PATH_B}*`, () => {
        askedForB += 1;
        return new Promise(() => {});
    });
    await armAppReadyWitness(page);
    await page.goto("/");
    await waitAppReadyWitness(page);
    await page.waitForFunction(
        () => !!(/** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey()),
        null,
        { timeout: WAIT_MS }
    );

    // A lands.
    await page.evaluate(
        ({ a, b, pathA, pathB }) => {
            const G = /** @type {any} */ (window).GeoLeaf;
            const w = /** @type {any} */ (window);
            w.__e2eChanges = [];
            document.addEventListener("geoleaf:basemap:change", (e) =>
                w.__e2eChanges.push(/** @type {CustomEvent} */ (e).detail.key)
            );
            G.Baselayers.registerBaseLayer(a, {
                type: "maplibre",
                label: "A",
                style: location.origin + pathA,
            });
            G.Baselayers.registerBaseLayer(b, {
                type: "maplibre",
                label: "B",
                style: location.origin + pathB,
            });
            G.Baselayers.setBaseLayer(a);
        },
        { a: KEY_A, b: KEY_B, pathA: PATH_A, pathB: PATH_B }
    );
    await page.waitForFunction(
        (key) => /** @type {any} */ (window).__e2eChanges.includes(key),
        KEY_A,
        { timeout: WAIT_MS }
    );
    await page.waitForFunction(
        (name) => {
            const native = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            return native.getStyle().name === name && native.isStyleLoaded() === true;
        },
        NAME_A,
        { timeout: WAIT_MS }
    );

    // B asked: its style download starts, and is held.
    await page.evaluate((key) => {
        /** @type {any} */ (window).__e2eChanges = [];
        /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key);
    }, KEY_B);
    await expect.poll(() => askedForB, { timeout: WAIT_MS }).toBeGreaterThan(0);

    // A asked again, while B downloads.
    await page.evaluate(
        (key) => /** @type {any} */ (window).GeoLeaf.Baselayers.setBaseLayer(key),
        KEY_A
    );

    await expect
        .poll(() => page.evaluate(() => /** @type {any} */ (window).__e2eChanges), {
            message: "la bascule de retour vers A ne s'est pas achevée : aucun basemap:change",
            timeout: 10_000,
        })
        .toEqual([KEY_A]);
    expect(
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Baselayers.getActiveKey())
    ).toBe(KEY_A);
    expect(pageErrors).toEqual([]);
});
