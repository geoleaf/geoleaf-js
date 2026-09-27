// @ts-check
/**
 * 67 — THE FILTER SAYS WHEN IT KEEPS NOTHING
 *
 * 🛑 THE DEFECT, MEASURED ON 26/09/2026. A filter that matched no feature hid them all without a
 * word: an empty map could not be told from a failure, while the feature search, next to it, says
 * it found nothing. The kernel counted what it judged and kept; the capability dropped the counts.
 *
 * Asserted where the user reads it — the panel's status line — after the user's own gesture:
 * typing into the panel's text field, which goes through the debounced panel pipeline, not
 * through the API. The expected wording is read from the page's dictionary, so the spec does not
 * depend on the language the app resolves. Seen red on the bundle built before the fix: the status
 * line did not exist.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap is not this spec's subject: its third-party latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

/** A layer of the shipped profile loaded at boot — the filter judges it, so `total > 0`. */
const LAYER = "routes_principales";
/** A string no feature of the shipped profile carries. */
const NOTHING = "zqxw-aucune-entite-zqxw";
const WAIT_MS = 20_000;

test("[filter] le panneau dit qu'aucune entité ne correspond, et se tait sinon", async ({
    page,
}) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: WAIT_MS });
    // The panel mounts on `geoleaf:app:ready`, once the layers are loaded.
    await page.waitForFunction(
        (id) => {
            const w = /** @type {any} */ (window);
            try {
                return (
                    !!document.querySelector("#gl-filter-panel") &&
                    w.GeoLeaf?.Filter?.isEnabled?.() &&
                    w.GeoLeaf.Layers.getFeatureCount(id) > 0
                );
            } catch {
                return false;
            }
        },
        LAYER,
        { timeout: WAIT_MS }
    );

    const expected = await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.I18n.getLabel("ui.filter_panel.no_match")
    );
    expect(expected, "la clé `ui.filter_panel.no_match` manque au dictionnaire servi").not.toBe(
        "ui.filter_panel.no_match"
    );

    // The panel is `visibility: hidden` at boot; opening it brings its controls into reach.
    await page.getByRole("button", { name: "Filtres" }).first().click();
    const panel = page.locator(".gl-filter-panel.gl-is-open");
    await expect(panel).toBeVisible({ timeout: WAIT_MS });

    const status = panel.locator(".gl-filter-panel__status");
    await expect(status, "la ligne d'état est rendue avec le panneau").toHaveCount(1);
    await expect(status, "aucun filtre : rien à dire").toHaveText("");

    const input = panel.locator('[data-gl-filter-id="searchText"] input.gl-pill-search__input');
    await input.fill(NOTHING);
    await expect(status, "une recherche qui ne garde rien le dit").toHaveText(expected, {
        timeout: WAIT_MS,
    });
    await expect(status, "la ligne d'état est une région live").toHaveAttribute("role", "status");

    await input.fill("");
    await expect(status, "la recherche levée, le message s'efface").toHaveText("", {
        timeout: WAIT_MS,
    });
});
