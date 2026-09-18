// @ts-check
// Witness — a boot that cannot complete SAYS SO, on screen and to the host.
//
// WHAT THIS SPEC MEASURES, against the real bundle in a real Chromium:
//   ① WebGL2 unavailable → the veil turns into the failure screen, the event names
//      `reason: "webgl"`, and the downloaded diagnostic is JSON carrying the failure and the
//      log's recent entries — the failure among them.
//      Before: MapLibre threw `GPUInitializationError`, the facade reduced it to `null`, and
//      the spinner turned forever.
//   ② `profile.json` in 404 → the failure screen, WITHOUT « Continue »: there is no extent,
//      so no map could show.
//   ③ A declared section absent from the REAL profile bundle → the attention screen names the
//      resource, and « Continue » reveals the map. Before: the section was silently skipped,
//      and the profile counted as loaded.
//
// WebGL2 is cut by an init script that makes `getContext("webgl2")` return null — injected by
// the protocol, so the page's CSP does not apply to it. The bundle is altered IN THE PAGE
// (`window.fetch` wrapped by an init script), not with `route.fetch()`: that one runs on the
// Node side, which cannot resolve the nginx vhost the Chromium resolves.
//
// `serviceWorkers: 'block'` — deploy-core ships a PWA service worker, which would escape
// `page.route`. The resulting `[SWRegister] Registration failed` warning is a harness artifact.
//
// The `vn-` prefix: browser verification outside the suite numbering.

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/**
 * Records the boot signals from the very first script of the page.
 *
 * @param {import("@playwright/test").Page} page
 */
async function recordSignals(page) {
    await page.addInitScript(() => {
        const slot = /** @type {any} */ (window);
        slot.__glSignals = [];
        for (const name of ["geoleaf:boot:failed", "geoleaf:profile:failed", "geoleaf:app:ready"]) {
            document.addEventListener(name, (event) => {
                slot.__glSignals.push({ name, detail: /** @type {CustomEvent} */ (event).detail });
            });
        }
    });
}

/**
 * The signals recorded so far.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ name: string, detail: any }[]>}
 */
function signals(page) {
    return page.evaluate(() => /** @type {any} */ (window).__glSignals);
}

test.describe("vn — un démarrage qui ne peut pas aboutir le dit", () => {
    test("WebGL2 indisponible → écran d'échec, raison webgl, diagnostic téléchargeable", async ({
        page,
    }) => {
        await page.addInitScript(() => {
            const proto = /** @type {any} */ (HTMLCanvasElement.prototype);
            const original = proto.getContext;
            proto.getContext = function (/** @type {string} */ type, /** @type {any[]} */ ...rest) {
                return type === "webgl2" ? null : original.call(this, type, ...rest);
            };
        });
        await recordSignals(page);

        await page.goto("/");

        await expect(page.locator("#gl-loader .gl-boot-failure")).toBeVisible({ timeout: 30000 });
        await expect(page.locator('#gl-loader [data-gl-action="continue"]')).toHaveCount(0);
        const failed = (await signals(page)).filter((s) => s.name === "geoleaf:boot:failed");
        expect(failed[0]?.detail).toMatchObject({
            reason: "webgl",
            phase: "map",
            provisional: false,
        });

        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.locator('#gl-loader [data-gl-action="download"]').click(),
        ]);
        const diagnostic = JSON.parse(await readFile(await download.path(), "utf8"));
        expect(diagnostic).toMatchObject({
            format: "geoleaf-diagnostic",
            state: "failed",
            failure: { reason: "webgl" },
        });
        // The log's record travels with it, and the failure itself is one of its error entries.
        const errors = diagnostic.entries.filter((/** @type {any} */ e) => e.level === "error");
        expect(errors.some((/** @type {any} */ e) => e.message.includes("Boot failed"))).toBe(true);
    });

    test("profile.json en 404 → écran d'échec, sans « Continuer »", async ({ page }) => {
        await recordSignals(page);
        await page.route("**/profiles/tourism/profile.json*", (route) =>
            route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" })
        );

        await page.goto("/");

        await expect(page.locator("#gl-loader .gl-boot-failure")).toBeVisible({ timeout: 30000 });
        await expect(page.locator('#gl-loader [data-gl-action="continue"]')).toHaveCount(0);
        const recorded = await signals(page);
        expect(recorded.find((s) => s.name === "geoleaf:profile:failed")?.detail).toMatchObject({
            fatal: true,
            failures: [{ resource: "profile.json", required: true }],
        });
        expect(recorded.find((s) => s.name === "geoleaf:boot:failed")?.detail).toMatchObject({
            reason: "profile",
        });
    });

    test("section déclarée absente du bundle réel → écran nommant la ressource, « Continuer » révèle la carte", async ({
        page,
    }) => {
        await recordSignals(page);
        await page.addInitScript(() => {
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const response = await originalFetch(input, init);
                const url =
                    typeof input === "string"
                        ? input
                        : input instanceof URL
                          ? input.href
                          : input.url;
                if (!/\/profiles\/tourism\/profile-bundle\.json(\?|$)/.test(url)) return response;
                const bundle = await response.clone().json();
                if (bundle.modules) delete bundle.modules["position-share"];
                return new Response(JSON.stringify(bundle), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            };
        });

        await page.goto("/");

        const screen = page.locator("#gl-loader .gl-boot-failure");
        await expect(screen).toContainText("Files.modules.position-share", { timeout: 30000 });
        const continueButton = page.locator('#gl-loader [data-gl-action="continue"]');
        await expect(continueButton).toBeVisible();

        await continueButton.click();

        await expect(page.locator("#gl-loader")).toBeHidden({ timeout: 10000 });
        const names = (await signals(page)).map((s) => s.name);
        expect(names).toContain("geoleaf:app:ready");
        expect(names.indexOf("geoleaf:profile:failed")).toBeLessThan(
            names.indexOf("geoleaf:app:ready")
        );
    });
});
