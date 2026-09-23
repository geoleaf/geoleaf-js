// @ts-check
/**
 * 56 — "SELECT ALL" OVER 30 000 ENTITIES, ON THE SHIPPED BUNDLE.
 *
 * What no unit suite can give: the real minified plugin, the real GeoJSON loader, a real
 * scroll in Chromium.
 *
 * 🛑 THE DEFECT MEASURED. Past 150 rows the table renders only a window, while search and
 * selection read the DOM. Measured in unit tests on 600 rows: "select all" took 33. On a
 * 30 000-row layer an operator believed they were exporting their whole parc and exported a
 * thousandth of it.
 *
 * WHAT THIS ADDS TO THE UNIT SUITE. That one exercises the model under jsdom, where no
 * height is computed and scrolling is simulated. Here the virtual window is driven by a real
 * `scrollTop` on a container that has a height, and the model crosses the bundle's GeoJSON
 * worker.
 *
 * ⚠️ WHAT THIS SPEC DOES NOT SEE. Touch (the table has no `.touch` spec) and WebKit (the
 * `core` target does not enable it — `playwright.config.js`). And it does not move
 * `verify-e2e-coverage.cjs`, which measures BOOT on `baseURL("coverage")`.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";
import { makeFeatureCollection } from "./helpers/feature-factory.js";

test.use({ baseURL: baseURL("core") });

/**
 * The tourism layer this spec hijacks.
 *
 * ⚠️ Measured on `deploy-core`: the profile declares eight `table.enabled` layers, and only
 * THREE are loaded at boot — `sites_de_conservation_wdpa`, `aires_protegees_nationales_sib`
 * and `provinces`. Picking a layer on the strength of the bundle rather than of the runtime
 * yields an empty table and a failure whose cause is invisible. `provinces` is the lightest
 * of the three (24 entities originally).
 */
const LAYER = "provinces";

/** The dose this repository gates — the scale bench's, and the one the row cap allows. */
const COUNT = 30_000;

/**
 * The columns the layer will declare: the ones the seeded generator produces.
 * `label` holds `label-<n>`, which makes a search's result computable.
 */
const COLUMNS = [
    { field: "properties.ref", label: "Ref" },
    { field: "properties.label", label: "Label" },
    { field: "properties.status", label: "Status" },
];

test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/**
 * Hijacks the profile and the layer's data.
 *
 * 🛑 The profile MUST be patched: `profiles/tourism/config/plugins/table.json` declares
 * `maxRowsPerLayer: 10000`. Without this detour a proof "over 30 000" would measure 10 000
 * and come out GREEN — the class of error this repository has already paid for twice.
 *
 * Routes go on the CONTEXT, not the page: the GeoJSON loader fetches from a Web Worker, and
 * a page-level route does not reliably bite on it.
 */
async function armScaleLayer(context) {
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        const cfg = bundle.layerConfigs?.[LAYER];
        if (!cfg) throw new Error(`the bundle no longer carries a \`${LAYER}\` layer`);
        cfg.table = { enabled: true, columns: COLUMNS };
        bundle.modules = bundle.modules ?? {};
        bundle.modules.table = { ...(bundle.modules.table ?? {}), maxRowsPerLayer: COUNT };
        await route.fulfill({ json: bundle });
    });

    // Generated per run, never committed: 30 000 entities with 11 properties is ~10 MB of
    // JSON. The seed is what makes that safe — the bytes are reproducible without being stored.
    const body = JSON.stringify(makeFeatureCollection({ count: COUNT, seed: 1, clumps: 200 }));
    await context.route(`**/${LAYER}/data/${LAYER}.geojson**`, (route) =>
        route.fulfill({ contentType: "application/geo+json", body })
    );
}

/** Loads the lazy plugin and waits for its façade. */
async function armTable(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object",
        null,
        { timeout: 30_000 }
    );
}

/**
 * Fires the `table` toolbar action — the ONLY path that builds the panel (TB-01 of
 * `docs/specs/plugins/CDC_table.md`): loading the bundle does not suffice.
 */
async function openTable(page) {
    await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
        timeout: 30_000,
    });
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
    await expect(page.locator(".gl-table-panel")).toBeAttached({ timeout: 30_000 });
}

/** Puts the 30 000-row layer in the table and waits for the model to carry it. */
async function showScaleLayer(page) {
    // The loader populates layers AFTER `map:ready`: without this wait, `setLayer` targets a
    // layer the seam does not know yet and the table stays empty without saying so. Measured:
    // `getAllLayers()` returns `[]` right after the plugin loads.
    await page.waitForFunction(
        (id) => {
            const gj = /** @type {any} */ (window).GeoLeaf?.GeoJSON;
            return (gj?.getLayerData?.(id)?.features ?? []).length > 0;
        },
        LAYER,
        { timeout: 120_000 }
    );
    await page.evaluate((id) => /** @type {any} */ (window).GeoLeaf.Table.setLayer(id), LAYER);
    await page.waitForFunction(
        () => document.querySelectorAll("tr[data-feature-id]").length > 0,
        null,
        { timeout: 60_000 }
    );
}

test.describe("56 — the table searches and selects on the model, at 30 000", () => {
    // The per-test default is 60 s (`playwright.config.js`): pulling and rendering 30 000
    // entities exceeds it. Same shape as the performance baseline's scale bench.
    test.setTimeout(240_000);

    test("select-all takes all 30 000, not the rendered window", async ({ page, context }) => {
        await armScaleLayer(context);
        await page.goto("/");
        await armTable(page);
        await openTable(page);
        await showScaleLayer(page);

        // The premise without which the assertion would prove nothing: the DOM holds ONLY A
        // WINDOW. Were the render complete, selecting all from the DOM would suffice and this
        // guard would be green on the very defect it measures.
        const rendered = await page.locator("tr[data-feature-id]").count();
        expect(rendered).toBeGreaterThan(0);
        expect(rendered).toBeLessThan(COUNT);

        await page.locator(".gl-table-panel__checkbox-all").click();

        const selected = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Table.getSelectedIds().length
        );
        expect(selected).toBe(COUNT);
    });

    test("a search survives a scroll, and select-all takes its result", async ({
        page,
        context,
    }) => {
        await armScaleLayer(context);
        await page.goto("/");
        await armTable(page);
        await openTable(page);
        await showScaleLayer(page);

        // The seeded generator writes `label-<n>`: "label-1" keeps 1, 10-19, 100-199,
        // 1000-1999 and 10000-19999 — 11 111 rows out of 30 000, well past the virtualisation
        // threshold, so the filtered view is STILL a window. The value is MEASURED
        // (`makeFeatureCollection`), never guessed: "Label 1" would have matched nothing and
        // failed for the wrong reason.
        await page.locator("[data-table-search]").fill("label-1");
        await page.waitForFunction(
            () => {
                const rows = document.querySelectorAll("tr[data-feature-id] td:nth-child(3)");
                return (
                    rows.length > 0 &&
                    Array.from(rows).every((td) =>
                        (td.textContent ?? "").toLowerCase().includes("label-1")
                    )
                );
            },
            null,
            { timeout: 30_000 }
        );

        const before = await page.locator("tr[data-feature-id]").count();

        await page.locator(".gl-table-panel__wrapper").evaluate((el) => {
            el.scrollTop = 4000;
            el.dispatchEvent(new Event("scroll", { bubbles: true }));
        });

        // 🛑 THE DEFECT: `updateVirtualRows` cleared the tbody and re-created the rows without
        // re-applying the filter — the search evaporated on the first scroll.
        const strays = await page.evaluate(() =>
            Array.from(document.querySelectorAll("tr[data-feature-id] td:nth-child(3)"))
                .map((td) => td.textContent ?? "")
                .filter((text) => !text.toLowerCase().includes("label-1"))
        );
        expect(strays).toEqual([]);
        expect(await page.locator("tr[data-feature-id]").count()).toBeGreaterThan(0);
        expect(before).toBeGreaterThan(0);

        // Under a search, select-all takes the RESULT and not the layer — the only reading the
        // header checkbox can honestly reflect.
        await page.locator(".gl-table-panel__checkbox-all").click();
        const selected = await page.evaluate(
            () => /** @type {any} */ (window).GeoLeaf.Table.getSelectedIds().length
        );
        expect(selected).toBeGreaterThan(0);
        expect(selected).toBeLessThan(COUNT);
    });
});
