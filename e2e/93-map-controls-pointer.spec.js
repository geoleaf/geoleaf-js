/**
 * The map controls GeoLeaf adds itself answer the pointer.
 *
 * ## The defect
 *
 * MapLibre turns `pointer-events` off on its four control corners and back on for children
 * wearing `.maplibregl-ctrl`. GeoLeaf hands the adapter bare elements, which do not wear that
 * class: in a corner, a `.geoleaf-ctrl` (the theme toggle, the geolocation button) inherited
 * `pointer-events: none`, and a click or a tap fell through to the map. The keyboard still
 * worked, which is why no unit test saw it. In the bottom-left corner, `branding.css` itself set
 * `pointer-events: none` on every child, its own overlay included, so the propagation guard of
 * the branding overlay never received anything.
 *
 * ## What the spec demands
 *
 * 1. A hit test at the centre of every GeoLeaf control on the map lands INSIDE that control —
 *    not on the canvas underneath.
 * 2. A real mouse click on the theme toggle switches the theme.
 *
 * No delivered profile switches `theme-toggle` on: the spec turns it on by rewriting the served
 * profile bundle, and counts the rewrites — a route that stopped biting would test the default
 * profile while believing otherwise.
 */
import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { selectProfile } from "./helpers/boot.js";
import { bootPage, installSignals } from "./helpers/mount.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

const PROFILE = "tourism";

/**
 * Switches `theme-toggle` on in the served bundle.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<() => number>} the number of rewritten bundles
 */
async function routeThemeToggleOn(context) {
    let routed = 0;
    await context.route(`**/profiles/${PROFILE}/profile-bundle.json**`, async (route) => {
        const bundle = await (await route.fetch()).json();
        bundle.modules = bundle.modules ?? {};
        bundle.modules["theme-toggle"] = {
            ...(bundle.modules["theme-toggle"] ?? {}),
            enabled: true,
        };
        routed++;
        await route.fulfill({ json: bundle });
    });
    return () => routed;
}

test.describe("contrôles de carte — ils répondent au pointeur", () => {
    test("chaque contrôle GeoLeaf reçoit le pointeur, et la bascule de thème répond à la souris", async ({
        page,
        context,
    }) => {
        const routed = await routeThemeToggleOn(context);
        await selectProfile(page, PROFILE);
        await installSignals(page);
        await bootPage(page);
        expect(routed(), "la retouche du profil n'a pas mordu").toBeGreaterThan(0);

        const toggle = page.locator(".geoleaf-ctrl-theme-toggle a");
        await expect(toggle).toBeVisible({ timeout: 15_000 });
        // The boot veil fades out after `app:ready`: until it is gone, every hit lands on it,
        // and the test would measure the veil instead of the controls (seen on the first run).
        await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 15_000 });

        const hits = await page.evaluate(() =>
            [...document.querySelectorAll(".geoleaf-ctrl, .gl-branding")]
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.width > 0 && r.height > 0)
                .map(({ el, r }) => {
                    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                    return {
                        control: String(el.className),
                        hit: hit ? `${hit.tagName}.${String(hit.className)}` : null,
                        inside: !!hit && el.contains(hit),
                    };
                })
        );
        expect(hits.map((h) => h.control)).toEqual(
            expect.arrayContaining([
                expect.stringContaining("geoleaf-ctrl-theme-toggle"),
                expect.stringContaining("gl-branding"),
            ])
        );
        expect(hits.filter((h) => !h.inside)).toEqual([]);

        const isDark = () => page.evaluate(() => document.body.classList.contains("gl-theme-dark"));
        const before = await isDark();
        const box = await toggle.boundingBox();
        if (!box) throw new Error("la bascule de thème n'a pas de boîte");
        // A real mouse click at the button's centre — what hit testing decides, not a dispatch.
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(isDark, { timeout: 5_000 }).toBe(!before);
    });
});
