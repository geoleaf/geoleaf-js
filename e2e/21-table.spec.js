// @ts-check
// E2E table (@geoleaf-plugins/table) on deploy-coverage (port 8769).
//
// End-to-end guard for the core → plugin table extraction: proves that, once
// the plugin is loaded, the GeoLeaf.Table facade mounts, the bottom-sheet
// panel attaches to the DOM through the plugin lifecycle (geoleaf:map:ready),
// and that open/close + the toolbar-action wiring
// (`geoleaf:toolbar:action` → Table.open) hold in a browser.
//
// 2026-07-02 — table converted to a LAZY plugin (registerLazy +
// registerLazyForAction in init.js, like print/measure/editor — cf.
// 14-print.spec.js). The `dist/geoleaf-table.plugin.js` bundle is no longer
// loaded at boot: the tab button appears immediately (registerLazyForAction),
// but GeoLeaf.Table only exists after a load (real click or
// GeoLeaf.plugins.load('table')).
//
// TWO distinct lazinesses, not to be conflated:
//   1. the BUNDLE is lazy (registerLazy)             → lifted by plugins.load('table')
//   2. the DOM PANEL is lazy (TB-01, d2e3187a)       → lifted by the `table` action
// `defaultVisible: false` ⇒ `geoleaf:map:ready` builds nothing;
// `TableLifecycle.ensureInitialized()` builds the DOM on the action's 1st
// trigger, then `entry.ts` calls `GeoLeaf.Table.open()`. Loading the bundle
// alone thus does NOT make `.gl-table-panel` appear — see the
// `fireTableAction` helper.
//
// Target: deploy-coverage — a copy of deploy-core (active profile `tourism`,
// `modules.table.showButton` not disabled). Port 8769 is started by
// playwright.config.js's webServer; `npm run build:deploy-coverage` must have
// populated `deploy/deploy-coverage` beforehand (after `build:deploy:all`).
//
// Scope: deterministic guard of the extraction (mount + facade + open + UI).
// The rich data-driven flow (layer selection → rows, sort, row selection →
// map highlight/zoom, GeoJSON/CSV/KML/GPX/Excel export) is deliberately left
// to the MANUAL desktop+mobile test: it depends on a `table.enabled` layer
// *visible* at boot and loaded as full GeoJSON (vectorTiles layers expose no
// `features`), which is not deterministic here — same posture as
// 04-core-ui-features / 05-accessibility which only assert the panel's
// presence.
//
// `serviceWorkers: 'block'`: same precaution as the other plugin specs on PWA
// variants.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { registerCoverageCollection } from "./helpers/coverage.js";
import { bootMapUntilIdle } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage"), serviceWorkers: "block" });

// This spec already TARGETED the instrumented variant without ever yielding
// its coverage: the bundle was measured, the data thrown away at page close.
// The wiring below pours it in. ⚠️ It only has value since the istanbul
// `include` covers `src/capabilities/**`: before that, the code exercised
// here was OUTSIDE the denominator, and three more dumps would have moved
// nothing.
registerCoverageCollection(test, "table");

const TABLE_CHUNK = /geoleaf-table\.plugin\.js/;

/** Returns whether a resource matching `re` has been requested by the page. */
function resourceLoaded(page, re) {
    return page.evaluate(
        (src) => performance.getEntriesByType("resource").some((e) => new RegExp(src).test(e.name)),
        re.source
    );
}

/** Loads the lazy table plugin (what the toolbar action does) and waits for its API. */
async function armTable(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object",
        null,
        { timeout: 10000 }
    );
}

/**
 * Triggers the `table` toolbar action — the ONLY path that builds the panel.
 *
 * TB-01 in docs/specs/plugins/CDC_table.md (commit `d2e3187a`, 2026-06-28):
 * with `modules.table.defaultVisible: false`, `geoleaf:map:ready` no longer
 * builds the panel; `TableLifecycle.ensureInitialized()` builds it on the
 * FIRST trigger of the `"table"` action, and `entry.ts` follows with
 * `GeoLeaf.Table.open()`. Loading the bundle thus does not suffice to make
 * `.gl-table-panel` exist.
 */
async function fireTableAction(page) {
    await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
        timeout: 10000,
    });
    await page.evaluate(() => {
        /** @type {HTMLElement|null} */ (
            document.querySelector('[data-gl-toolbar-action="table"]')
        )?.click();
    });
}

test.describe("21-table — lazy boundary (registerLazy + registerLazyForAction)", () => {
    test("the namespace and the lazy bundle are both absent at boot", async ({ page }) => {
        await bootMapUntilIdle(page);
        const ns = await page.evaluate(() => typeof (/** @type {any} */ (window).GeoLeaf?.Table));
        expect(ns).toBe("undefined");
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(false);
    });

    test("the table toolbar button is rendered at boot (lazy action)", async ({ page }) => {
        await bootMapUntilIdle(page);
        // registerLazyForAction shows the tab immediately via getLazyUISlots().
        await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeVisible({
            timeout: 10000,
        });
    });
});

test.describe("21-table — façade + panneau + ouverture (deploy-coverage, tourism)", () => {
    test("le plugin se charge et le panneau se monte (chargement lazy)", async ({ page }) => {
        await bootMapUntilIdle(page);
        await armTable(page);
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(true);

        // The plugin bundle is injected and the facade mounted on the public namespace.
        const api = await page.evaluate(() => {
            const T = /** @type {any} */ (window).GeoLeaf?.Table;
            if (!T) return null;
            return [
                "open",
                "show",
                "hide",
                "toggle",
                "setLayer",
                "sortByField",
                "getSelectedIds",
            ].map((m) => typeof T[m]);
        });
        expect(api).not.toBeNull();
        expect(api).toEqual([
            "function",
            "function",
            "function",
            "function",
            "function",
            "function",
            "function",
        ]);

        // TB-01 — `defaultVisible: false` in its STRONG form: loading the
        // bundle builds NO DOM. (Before d2e3187a, panel.ts attached the hidden
        // panel at plugin boot; no longer the contract — cf. lifecycle.ts
        // `_onMapReady`.)
        await expect(page.locator(".gl-table-panel")).toHaveCount(0);

        // The action's first trigger builds the panel (ensureInitialized).
        await fireTableAction(page);
        await expect(page.locator(".gl-table-panel")).toBeAttached({ timeout: 10000 });
    });

    test("open() révèle un panneau fonctionnel, toggle() le referme", async ({ page }) => {
        await bootMapUntilIdle(page);
        await armTable(page);
        // TB-01: the panel only exists after the action's 1st trigger, which
        // builds AND opens it. It is closed back through the facade to recover
        // EXACTLY the precondition tested below (panel mounted, closed) before
        // exercising open().
        await fireTableAction(page);
        const panel = page.locator(".gl-table-panel");
        await expect(panel).toBeAttached({ timeout: 10000 });
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.hide());
        await expect(panel).not.toHaveClass(/gl-is-visible/);

        // Open via the public facade (equivalent to the `action:table` toolbar button click).
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.open());
        await expect(panel).toHaveClass(/gl-is-visible/, { timeout: 10000 });

        // The toolbar and its controls are rendered.
        await expect(page.locator(".gl-table-panel__toolbar")).toBeVisible();
        await expect(page.locator("[data-table-layer-select]")).toBeAttached();
        await expect(page.locator("[data-table-search]")).toBeAttached();

        // Without a selection, the selection-dependent actions are disabled.
        await expect(page.locator("[data-table-btn='zoom']")).toBeDisabled();
        await expect(page.locator("[data-table-btn='highlight']")).toBeDisabled();

        // Close via the facade.
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Table.toggle());
        await expect(panel).not.toHaveClass(/gl-is-visible/);
    });

    test("l'action toolbar `table` déclenche le chargement lazy PUIS l'ouverture", async ({
        page,
    }) => {
        await bootMapUntilIdle(page);
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(false);

        // Simulates the real click: dispatches the toolbar action without
        // pre-loading the plugin. desktop-panel-slots.ts intercepts via
        // plugins.isLazyAction()/ensureLoadedForAction() before re-dispatching
        // the event once the bundle is loaded.
        await page.evaluate(() => {
            const btn = /** @type {any} */ (document).querySelector(
                '[data-gl-toolbar-action="table"]'
            );
            btn?.click();
        });

        const panel = page.locator(".gl-table-panel");
        await expect(panel).toBeAttached({ timeout: 10000 });
        await expect(panel).toHaveClass(/gl-is-visible/, { timeout: 10000 });
        expect(await resourceLoaded(page, TABLE_CHUNK)).toBe(true);
    });
});
