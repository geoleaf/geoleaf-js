// @ts-check
/**
 * 69 — WHAT READS A LAYER FOLLOWS ITS UNIT MUTATIONS, AND EDITING DOES NOT LIFT ITS FILTER
 *
 * 🛑 THE TWO DEFECTS, traced on 27/09/2026 while settling the editor's creations.
 *
 * ① The layer store (`GeoLeaf.Layers`) changes by unit mutations — a creation, an edit, a
 *   deletion, a restore — and announced none of them. What derives from the store did not
 *   follow: an open table kept its rows until the next filter or visibility change, and an
 *   active filter was not re-applied — on its GPU path a new feature was absent from the id list
 *   of its `match`, so HIDDEN even when it passed.
 * ② Editing a feature hides its original by a layer filter, and the panel's filter, on its GPU
 *   path, IS a layer filter on the same layer: selecting a feature under an active filter put
 *   every filtered-out feature back on the map, and releasing it cleared the filter outright,
 *   while the panel still said a filter was active.
 *
 * The layer is `routes_principales`, served here as ten straight lines carrying a unique
 * `properties.id`, its clustering block removed — the conditions of the filter's GPU path, which
 * the shipped layer does not meet (no id, and a disabled clustering the filter reads as
 * clustering): on the re-feed path, the second defect cannot happen. Each test was seen red on
 * the bundle built before the fix.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { awaitSettledCamera } from "./helpers/camera.js";
import { armEditor } from "./helpers/editor.js";

test.use({ baseURL: baseURL("full") });

const LAYER = "routes_principales";
const COUNT = 10;
const TARGET = "Route E2E 3";
const WAIT_MS = 20_000;

/** Ten parallel lines, 0.05° apart — ids `r-0`…`r-9`, names `Route E2E 0`…`Route E2E 9`. */
function lines() {
    return {
        type: "FeatureCollection",
        features: Array.from({ length: COUNT }, (_, i) => line(`r-${i}`, `Route E2E ${i}`, i)),
    };
}

/** A straight five-vertex line, the `row`-th of the fan. */
function line(id, name, row) {
    const lat = -31.6 - row * 0.05;
    return {
        type: "Feature",
        properties: { id, name },
        geometry: {
            type: "LineString",
            coordinates: [0, 1, 2, 3, 4].map((k) => [-60.4 + k * 0.1, lat]),
        },
    };
}

/**
 * Serves the ten lines, and makes the layer editable and tabled. Routes on the CONTEXT: the
 * GeoJSON loader fetches from a Web Worker.
 *
 * @param {import("@playwright/test").BrowserContext} context
 */
async function armLayer(context) {
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`le bundle ne porte plus de couche \`${LAYER}\``);
        cfg.edition = { create: true, update: true, delete: true };
        cfg.editableGeometryTypes = ["LineString"];
        cfg.interactiveShape = true;
        cfg.table = { enabled: true, columns: [{ field: "properties.name", label: "Nom" }] };
        // The shipped layer declares `clustering: { enabled: false, disableClusteringAtZoom }`,
        // and it is kept as shipped: a clustering switched off is not a clustered layer, so the
        // filter takes the GPU path this spec is about.
        await route.fulfill({ json: bundle });
    });
    await context.route(`**/${LAYER}/data/${LAYER}.geojson**`, (route) =>
        route.fulfill({ contentType: "application/geo+json", body: JSON.stringify(lines()) })
    );
}

/** Boots, shows the layer, and frames the ten lines once the boot's camera work is over. */
async function boot(page) {
    await page.goto("/");
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
    await awaitSettledCamera(page);
    await page.evaluate((id) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        G.Layers.setVisibility(id, true, "user");
        G.Core.getMap()
            .getNativeMap()
            .fitBounds(
                [
                    [-60.5, -32.15],
                    [-59.9, -31.55],
                ],
                { animate: false, padding: 40 }
            );
    }, LAYER);
    await expect
        .poll(async () => (await renderedNames(page)).length, {
            timeout: WAIT_MS,
            message: "les dix lignes ne sont jamais dessinées",
        })
        .toBe(COUNT);
}

/**
 * The distinct `name`s MapLibre renders on the layer's OWN sub-layers — an edit copy lives in
 * the drawing engine's layers, not here.
 * @param {import("@playwright/test").Page} page
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

/** Applies the panel's text search. */
function search(page, text) {
    return page.evaluate((t) => {
        /** @type {any} */ (window).GeoLeaf.Filter.applyFilter({
            fields: [{ id: "searchText", kind: "text", text: t }],
        });
    }, text);
}

/** Adds a feature through the store's unit mutation. */
function addFeature(page, feature) {
    return page.evaluate(
        ([id, f]) => /** @type {any} */ (window).GeoLeaf.Layers.addFeature(id, f),
        /** @type {[string, any]} */ ([LAYER, feature])
    );
}

/**
 * Rewrites the layer's WHOLE collection around `GeoLeaf.Layers` — what a real-time tick, an OGC
 * auto-refresh or a host calling `GeoLeaf.GeoJSON.updateLayerData` does.
 */
function writeWholeCollection(page, features) {
    return page.evaluate(
        ([id, list]) =>
            /** @type {any} */ (window).GeoLeaf.GeoJSON.updateLayerData(id, {
                type: "FeatureCollection",
                features: list,
            }),
        /** @type {[string, any[]]} */ ([LAYER, features])
    );
}

test.beforeEach(async ({ context }) => {
    // The basemap is not this spec's subject: its third-party latency must not decide it.
    await serveBasemapTilesLocally(context);
    await armLayer(context);
});

test("[layers] une entité ajoutée sous un filtre actif est jugée par le filtre", async ({
    page,
}) => {
    await boot(page);
    await search(page, TARGET);
    await expect.poll(() => renderedNames(page), { timeout: WAIT_MS }).toEqual([TARGET]);

    // Passes the search — its name contains the searched text.
    await addFeature(page, line("r-10", `${TARGET} bis`, 10.5));
    // Fails it — must stay hidden whatever path the filter takes.
    await addFeature(page, line("r-11", "Autre route", 11));

    // Before the fix: the new feature was absent from the filter's id list, hence hidden.
    await expect
        .poll(() => renderedNames(page), {
            timeout: WAIT_MS,
            message: "le filtre actif n'a pas jugé l'entité ajoutée",
        })
        .toEqual([TARGET, `${TARGET} bis`]);
});

test("[layers] le tableau ouvert suit une entité ajoutée", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object"
    );
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
    await expect(page.locator(".gl-table-panel")).toBeAttached({ timeout: WAIT_MS });
    await page.evaluate((id) => /** @type {any} */ (window).GeoLeaf.Table.setLayer(id), LAYER);
    const rows = page.locator("tr[data-feature-id]");
    await expect(rows).toHaveCount(COUNT, { timeout: WAIT_MS });

    await addFeature(page, line("r-10", "Route ajoutée", 10.5));

    // Before the fix: ten rows until the next filter or visibility change.
    await expect(rows, "le tableau ouvert n'a pas suivi l'ajout").toHaveCount(COUNT + 1, {
        timeout: WAIT_MS,
    });
});

// ── ③ A writer of the whole collection changed the store and announced nothing ───────────────
//
// The event of ① left from the calls of `GeoLeaf.Layers` alone. A real-time tick, an OGC
// auto-refresh and a host's own `GeoLeaf.GeoJSON.updateLayerData` rewrite the same store around
// it: the two subscribers stayed stale until the user's next gesture.

test("[geojson] une collection réécrite sous un filtre actif est jugée par le filtre", async ({
    page,
}) => {
    await boot(page);
    await search(page, TARGET);
    await expect.poll(() => renderedNames(page), { timeout: WAIT_MS }).toEqual([TARGET]);

    await writeWholeCollection(page, [
        ...lines().features,
        // Passes the search — its name contains the searched text.
        line("r-10", `${TARGET} bis`, 10.5),
        // Fails it — must stay hidden.
        line("r-11", "Autre route", 11),
    ]);

    // Before the fix: the filter's id list was never rebuilt, so the passing newcomer stayed
    // hidden.
    await expect
        .poll(() => renderedNames(page), {
            timeout: WAIT_MS,
            message: "le filtre actif n'a pas rejugé la collection réécrite",
        })
        .toEqual([TARGET, `${TARGET} bis`]);
});

test("[geojson] le tableau ouvert suit une collection réécrite", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object"
    );
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
    await expect(page.locator(".gl-table-panel")).toBeAttached({ timeout: WAIT_MS });
    await page.evaluate((id) => /** @type {any} */ (window).GeoLeaf.Table.setLayer(id), LAYER);
    const rows = page.locator("tr[data-feature-id]");
    await expect(rows).toHaveCount(COUNT, { timeout: WAIT_MS });

    await writeWholeCollection(page, [...lines().features, line("r-10", "Route ajoutée", 10.5)]);

    // Before the fix: ten rows until the next filter or visibility change.
    await expect(rows, "le tableau ouvert n'a pas suivi la collection réécrite").toHaveCount(
        COUNT + 1,
        { timeout: WAIT_MS }
    );
});

test("[editor] éditer une entité sous un filtre actif ne lève pas le filtre", async ({ page }) => {
    await boot(page);
    await search(page, TARGET);
    await expect.poll(() => renderedNames(page), { timeout: WAIT_MS }).toEqual([TARGET]);

    await armEditor(page);
    const mid = await page.evaluate((name) => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const map = G.Core.getMap().getNativeMap();
        const f = G.Layers.getFeatures("routes_principales").find(
            (/** @type {any} */ x) => x.properties?.name === name
        );
        const p = map.project(f.geometry.coordinates[2]);
        const rect = map.getContainer().getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
    }, TARGET);
    await page.mouse.click(mid.x, mid.y);
    await page.waitForFunction(
        () => {
            const map = /** @type {any} */ (window).GeoLeaf.Core.getMap().getNativeMap();
            const src = map.getSource("td-linestring");
            const data = src?.serialize?.()?.data ?? src?._data;
            return (data?.features?.length ?? 0) > 0;
        },
        null,
        { timeout: 10_000 }
    );

    // During the edit: the original is hidden for its copy, and the filtered-out lines stay
    // hidden. Before the fix, every one of them came back.
    await expect
        .poll(() => renderedNames(page), {
            timeout: WAIT_MS,
            message: "sélectionner une entité a levé le filtre du panneau",
        })
        .toEqual([]);

    // Released unchanged: the original comes back, and only it.
    await page.keyboard.press("Enter");
    await expect
        .poll(() => renderedNames(page), {
            timeout: WAIT_MS,
            message: "relâcher l'entité a effacé le filtre du panneau",
        })
        .toEqual([TARGET]);
});
