/**
 * One `geoleaf:map:ready` per boot, and a map destroyed during the boot ends quietly.
 *
 * ## The defects
 *
 * 1. **Two `geoleaf:map:ready` per boot.** The MapLibre adapter dispatched it on the engine's
 *    `load`, and the reveal dispatched it again just before `geoleaf:app:ready`. Subscribers rely
 *    on one moment or the other (the route sweep on the engine's load, the connector on the late
 *    one), so the event is now announced ONCE per boot, at the first of the two.
 * 2. **A destroy during the boot logged errors.** `Core.destroy()` on the first
 *    `geoleaf:map:ready`: the layer loads still in flight failed one by one — 5 to 19
 *    `console.error` « Failed to load layer … MapLibre adapter not available ». An interrupted
 *    load is not a failure.
 * 3. **A destroy from a `geoleaf:app:ready` listener** set before the deferred panels let
 *    `LayerManager.init()` run on the destroyed map: « map is not ready », uncaught.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** @param {import('@playwright/test').Page} page */
function collectErrors(page) {
    /** @type {string[]} */
    const errors = [];
    page.on("console", (m) => {
        // Warnings too: `LayerManager.init()` is wrapped in a try, its failure is LOGGED as a
        // warning — a console-errors-only check is green on the defect.
        if (m.type() === "error" || m.type() === "warning") errors.push(m.text().split("\n")[0]);
    });
    page.on("pageerror", (e) => errors.push(`pageerror ${String(e).split("\n")[0]}`));
    return errors;
}

test.describe("boot et démontage", () => {
    test("geoleaf:map:ready part une seule fois par boot", async ({ page }) => {
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window);
            w.__mapReady = 0;
            w.__appReady = false;
            document.addEventListener("geoleaf:map:ready", () => w.__mapReady++);
            document.addEventListener("geoleaf:app:ready", () => (w.__appReady = true));
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => /** @type {any} */ (window).__appReady === true, null, {
            timeout: 60_000,
        });
        // Both former emitters have had their chance: the engine's `load` and the reveal.
        await page.waitForTimeout(2000);
        expect(await page.evaluate(() => /** @type {any} */ (window).__mapReady)).toBe(1);
    });

    test("un destroy pendant le boot interrompt les chargements sans erreur", async ({ page }) => {
        const errors = collectErrors(page);
        await page.addInitScript(() => {
            document.addEventListener(
                "geoleaf:map:ready",
                () => {
                    const core = /** @type {any} */ (window).GeoLeaf.Core;
                    core.destroy(core.listMaps()[0]);
                    /** @type {any} */ (window).__destroyed = true;
                },
                { once: true }
            );
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => /** @type {any} */ (window).__destroyed === true, null, {
            timeout: 60_000,
        });
        // The loads in flight settle within a few seconds; give them the time to fail.
        await page.waitForTimeout(6000);
        expect(errors.filter((e) => /Failed to load layer|adapter not available/.test(e))).toEqual(
            []
        );
    });

    test("un destroy depuis geoleaf:app:ready ne laisse rien monter sur la carte détruite", async ({
        page,
    }) => {
        const errors = collectErrors(page);
        await page.addInitScript(() => {
            document.addEventListener(
                "geoleaf:app:ready",
                () => {
                    const core = /** @type {any} */ (window).GeoLeaf.Core;
                    core.destroy(core.listMaps()[0]);
                    /** @type {any} */ (window).__destroyed = true;
                },
                { once: true }
            );
        });
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => /** @type {any} */ (window).__destroyed === true, null, {
            timeout: 60_000,
        });
        await page.waitForTimeout(2500);
        expect(errors.filter((e) => /map is not ready/.test(e))).toEqual([]);
    });
});
