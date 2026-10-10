// @ts-check
/**
 * 77 — THE OFFLINE WINDOW HANDS THE APPLICATION'S LOG OVER AS A FILE
 *
 * 🛑 THE DEFECT THIS SPEC EXISTS FOR. The core keeps a bounded, redacted record of what it
 * logged, and exports it (`GeoLeaf.Log.exportDiagnostic()`). The only control that offered it
 * was the boot failure screen: once the application had started, the journal was reachable
 * through a console — which the person standing in the field with a tablet does not have.
 * Read red on the bundle built before the button existed.
 *
 * What is proven here and not by the unit suite: a real download, from the shipped bundle,
 * whose content is the core's document — parsed back, not assumed.
 */

import fs from "node:fs";
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { serveBasemapTilesLocally } from "./helpers/basemap.js";

test.use({ baseURL: baseURL("full") });

// The basemap's tiles are not this spec's subject: their latency must not decide it.
test.beforeEach(async ({ context }) => {
    await serveBasemapTilesLocally(context);
});

test("[offline] « Exporter le journal » télécharge le journal du core, tel qu'il l'exporte", async ({
    page,
}) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 20000 });
    // A marker in the journal: the file must hold what the application LOGGED, not a shell.
    await page.evaluate(() =>
        /** @type {any} */ (window).GeoLeaf.Log.warn("[e2e-77] repère du journal exporté")
    );

    await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
    const button = page.locator(".gl-cache-log-export__btn");
    await expect(button, "la fenêtre ne propose pas d'exporter le journal").toBeVisible({
        timeout: 15000,
    });

    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toMatch(/^geoleaf-log-.+\.json$/);
    const file = await download.path();
    const report = JSON.parse(fs.readFileSync(file, "utf8"));

    expect(report.format).toBe("geoleaf-log");
    expect(Array.isArray(report.entries)).toBe(true);
    expect(
        report.entries.some((/** @type {any} */ entry) =>
            JSON.stringify(entry).includes("[e2e-77] repère du journal exporté")
        ),
        "le fichier ne porte pas ce que l'application a journalisé"
    ).toBe(true);
});
