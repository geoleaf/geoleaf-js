/**
 * Resetting the filter clears a proximity placed from the toolbar.
 *
 * ## The defect
 *
 * The proximity filter lives outside the panel: the toolbar button arms it, a click on the map
 * places its centre, and the filter engine reads it from a hidden wrapper the toolbar owns.
 * `GeoLeaf.Filter.reset()` and the panel's « Réinitialiser » cleared the panel's controls only:
 * the proximity field stayed in `getActiveFilter()`, the map stayed filtered, the circle stayed
 * drawn, and the toolbar button stayed lit — a second click on it was the only way back to
 * « everything visible ». The capability's own contract reads « `reset()` — puts the controls
 * back to zero, then applies: everything visible ».
 *
 * ## What the spec demands
 *
 * Proximity placed and validated from the toolbar, then each reset path in turn: the façade
 * (`Filter.reset()`) and the panel's button. After each, no `proximity` field, the toolbar button
 * back to inactive, its bar closed, and a new click on the button arms proximity again (the
 * button's state and the filter's agree).
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
});

const BUTTON = '[data-gl-sheet="proximity"]';

/** @param {import('@playwright/test').Page} page */
function hasProximity(page) {
    return page.evaluate(
        () =>
            /** @type {any} */ (window).GeoLeaf.Filter.getActiveFilter().fields?.some(
                (/** @type {{ kind: string }} */ f) => f.kind === "proximity"
            ) ?? false
    );
}

/** @param {import('@playwright/test').Page} page */
async function placeProximity(page) {
    const button = page.locator(BUTTON).locator("visible=true").first();
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    await expect(button).toHaveClass(/gl-map-toolbar__btn--active/);
    const centre = await page.evaluate(() => {
        const r = /** @type {any} */ (window).GeoLeaf.Core.getAdapter()
            .getNativeMap()
            .getCanvas()
            .getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(centre.x, centre.y);
    const validate = page.locator("button.gl-proximity-bar__validate");
    await expect(validate).toBeEnabled({ timeout: 5_000 });
    await validate.click();
    await expect.poll(() => hasProximity(page), { timeout: 5_000 }).toBe(true);
}

/** @param {import('@playwright/test').Page} page */
async function expectCleared(page) {
    await expect.poll(() => hasProximity(page), { timeout: 5_000 }).toBe(false);
    const button = page.locator(BUTTON).locator("visible=true").first();
    await expect(button).not.toHaveClass(/gl-map-toolbar__btn--active/);
    await expect(page.locator(".gl-proximity-bar.gl-is-visible")).toHaveCount(0);
    // The button and the filter agree: one click arms proximity again, it does not disarm it.
    await button.click();
    await expect(button).toHaveClass(/gl-map-toolbar__btn--active/);
    await button.click();
    await expect(button).not.toHaveClass(/gl-map-toolbar__btn--active/);
}

test.beforeEach(async ({ page }) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
});

test("Filter.reset() efface la proximité posée depuis la barre", async ({ page }) => {
    await placeProximity(page);
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Filter.reset());
    await expectCleared(page);
});

test("« Réinitialiser » du panneau efface la proximité posée depuis la barre", async ({ page }) => {
    await placeProximity(page);
    await page.locator("[id^='gl-rp-tab-filter']").first().click();
    const reset = page.locator("#gl-filter-panel [data-gl-action='filter-reset']");
    await expect(reset).toBeVisible({ timeout: 10_000 });
    await reset.click();
    await expectCleared(page);
});
