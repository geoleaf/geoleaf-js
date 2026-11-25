/**
 * The user's position shows as a dot — the first browser test that drives the geolocation button.
 *
 * ## The defect
 *
 * The marker icon was a `<div class="gl-user-location-dot">`. The adapter sanitises marker icons
 * against an SVG-only allow-list, which dropped the `<div>`: the marker was an empty, transparent
 * box. Only the accuracy circle showed — and above 1 000 m of accuracy, nothing at all. The icon is
 * now an SVG circle carrying the dot's class.
 *
 * ## What the spec demands
 *
 * Position simulated at 25 m and at 5 000 m of accuracy, the button pressed: the marker holds a
 * rendered circle, painted with a non-transparent fill.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

for (const accuracy of [25, 5000]) {
    test(`position à ${accuracy} m : le marqueur montre un point`, async ({ page, context }) => {
        await context.grantPermissions(["geolocation"]);
        await context.setGeolocation({ latitude: -32.95, longitude: -60.65, accuracy });
        await installSignals(page);
        await bootPage(page);
        await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });

        // The map control on wide screens, the toolbar button (which relays to it) below.
        const button = page
            .locator('.geoleaf-ctrl-geolocation a, [data-gl-sheet="geoloc"]')
            .locator("visible=true")
            .first();
        await expect(button).toBeVisible({ timeout: 15_000 });
        await button.click();

        const marker = page.locator(".gl-user-location-marker");
        await expect(marker).toBeAttached({ timeout: 15_000 });
        // The dot grows in (`scale(0)` → `scale(1)`, 0.3 s): measured at once it reads 0 px —
        // seen on the first run after the fix. Poll until it has its size.
        const read = () =>
            page.evaluate(() => {
                const circle = document.querySelector(".gl-user-location-marker circle");
                if (!circle) return null;
                const r = circle.getBoundingClientRect();
                return { w: Math.round(r.width), fill: getComputedStyle(circle).fill };
            });
        expect(
            await read(),
            "le marqueur ne porte aucun cercle : l'icône a été vidée"
        ).not.toBeNull();
        await expect
            .poll(async () => (await read())?.w ?? 0, { timeout: 5_000 })
            .toBeGreaterThan(8);
        const dot = await read();
        expect(dot?.fill).not.toMatch(/^(none|rgba\(0, 0, 0, 0\))$/);
    });
}
