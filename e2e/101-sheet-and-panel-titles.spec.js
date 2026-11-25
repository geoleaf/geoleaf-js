/**
 * One title per sheet, and a long feature name readable in full — on a phone.
 *
 * ## The defects
 *
 * 1. **Title twice.** The mobile sheet has its own title, then moves the layer manager or the
 *    legend into its body with their own header: « Couches » then « COUCHES », « Légende » then
 *    « LÉGENDE ». The filter panel already hid its header there; the other two did not.
 * 2. **Legend folded in the sheet.** With `collapsedByDefault`, the legend arrived folded: a
 *    second tap to read anything. The side panel already forced it open on wide screens.
 * 3. **Long name cut.** The side panel's title was held on one line with an ellipsis: on a phone
 *    a feature's full name was readable nowhere in the panel.
 *
 * ## What the spec demands
 *
 * At a phone's width: in the Layers and Legend sheets, the sheet's title shows and the moved
 * panel's own title does not; the legend's body shows. A side panel opened on a long name shows
 * it whole — no horizontal overflow of the title.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 412, height: 915 },
});

test.beforeEach(async ({ page }) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} sheet
 */
async function openSheet(page, sheet) {
    const button = page.locator(`[data-gl-sheet="${sheet}"]`).locator("visible=true").first();
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    await expect(page.locator(".gl-sheet-panel__title")).toBeVisible();
}

test("feuille Couches : un seul titre", async ({ page }) => {
    await openSheet(page, "layers");
    await expect(page.locator(".gl-sheet-panel__body .gl-layer-manager")).toBeVisible();
    await expect(page.locator(".gl-sheet-panel__body .gl-layer-manager__title")).toBeHidden();
});

test("feuille Légende : un seul titre, et la légende dépliée", async ({ page }) => {
    await openSheet(page, "legend");
    await expect(page.locator(".gl-sheet-panel__body .gl-map-legend")).toBeVisible();
    await expect(page.locator(".gl-sheet-panel__body .gl-map-legend__title")).toBeHidden();
    await expect(page.locator(".gl-sheet-panel__body .gl-map-legend__body")).toBeVisible();
});

test("panneau latéral : un nom long se lit en entier", async ({ page }) => {
    const name = 'Museo de Ángel Vicente Peñaloza "El Chacho" — maison natale et archives';
    await page.evaluate((title) => {
        /** @type {any} */ (window).GeoLeaf.FeatureInfo.openSidePanel(
            {
                layerId: "titles-e2e",
                featureId: "titles-1",
                properties: { title },
                geometry: { type: "Point" },
                lngLat: { lat: -32.95, lng: -60.64 },
                point: { x: 0, y: 0 },
            },
            {
                layerId: "titles-e2e",
                fields: [{ field: "title", type: "text", variant: "title", label: "Titre" }],
            }
        );
    }, name);
    const text = page.locator(".gl-poi-sidepanel__title-text");
    await expect(text).toBeVisible({ timeout: 10_000 });
    await expect(text).toHaveText(name);
    const overflow = await text.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, "le titre déborde : il est coupé").toBeLessThanOrEqual(1);
});
