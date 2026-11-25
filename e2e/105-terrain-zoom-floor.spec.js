/**
 * A tilted map with terrain shows no empty band at low zoom — the terrain waits for a zoom floor.
 *
 * ## The defect
 *
 * The demonstration profile opens on its basemap « Relief 3D », tilted at 60°, framed on its
 * whole extent (zoom 4.4). At that zoom the engine's terrain draws nothing past a distance: a band
 * of empty background crossed the top of the map, with a cut corner, on the desktop and the
 * phone. Measured: it goes with the terrain, not with the extent, and from zoom 5.5 on.
 *
 * ## What the spec demands
 *
 * At the opening framing, the map is tilted and holds no terrain; zoomed in to 7, at rest, the
 * terrain is there; zoomed back out, it is gone again.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

// The suite turns the demo's relief off at boot (`helpers/test.js`): this spec is about it.
test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
    relief: true,
});

/** @param {import('@playwright/test').Page} page */
function camera(page) {
    return page.evaluate(() => {
        const m = /** @type {any} */ (window).GeoLeaf.Core.getAdapter().getNativeMap();
        return { zoom: m.getZoom(), pitch: m.getPitch(), terrain: !!m.getTerrain() };
    });
}

/** @param {import('@playwright/test').Page} page @param {number} zoom */
async function zoomTo(page, zoom) {
    await page.evaluate((z) => {
        /** @type {any} */ (window).GeoLeaf.Core.getAdapter().getNativeMap().jumpTo({ zoom: z });
    }, zoom);
}

test("relief coupé sous le plancher de zoom, revenu au-dessus", async ({ page }) => {
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });

    const opening = await camera(page);
    expect(opening.zoom, "le cadrage d'ouverture n'est plus sous le plancher").toBeLessThan(6);
    expect(opening.pitch).toBeGreaterThan(30);
    expect(opening.terrain, "relief posé sous le plancher : la bande vide revient").toBe(false);

    await zoomTo(page, 7);
    await expect.poll(async () => (await camera(page)).terrain, { timeout: 10_000 }).toBe(true);

    await zoomTo(page, 4.5);
    await expect.poll(async () => (await camera(page)).terrain, { timeout: 10_000 }).toBe(false);
});
