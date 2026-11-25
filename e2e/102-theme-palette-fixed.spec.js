/**
 * A palette fixed by the integrator applies without offering a choice — on the shipped bundle.
 *
 * ## The defect
 *
 * `modules.theme-palette.enabled: false` with `default: "green"` is the case the capability sheet
 * puts first: an integrator fixes a brand colour and offers no selector. The interface stayed
 * orange — no `data-gl-palette` on `<html>`. The capability's DECLARATION gate read the same
 * `enabled` key: `false` left the module unregistered, so the half that applies the palette never
 * ran; only the button was meant to depend on `enabled`.
 *
 * ## What the spec demands
 *
 * The profile's bundle rewritten to `{ enabled: false, default: "green" }` (the rewrites are
 * counted): the green palette is applied, and no palette button is drawn.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({
    baseURL: baseURL("core"),
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
});

test("enabled: false et default: green — palette verte, aucun bouton", async ({
    page,
    context,
}) => {
    await page.addInitScript(() => {
        try {
            localStorage.removeItem("gl-palette");
        } catch {
            /* storage unavailable: the palette then reads the configuration only */
        }
    });
    let routed = 0;
    await context.route("**/profiles/tourism/profile-bundle.json**", async (route) => {
        const bundle = await (await route.fetch()).json();
        bundle.modules = bundle.modules ?? {};
        bundle.modules["theme-palette"] = { enabled: false, default: "green" };
        routed++;
        await route.fulfill({ json: bundle });
    });
    await installSignals(page);
    await bootPage(page);
    await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });
    expect(routed, "la retouche du profil n'a pas mordu").toBeGreaterThan(0);

    await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.glPalette ?? null))
        .toBe("green");
    await expect(page.locator(".gl-rp-palette-btn")).toHaveCount(0);
});
