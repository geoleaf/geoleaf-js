// @ts-check
// Config-contract Phase C / C1 — targeted E2E (visible effects) for the
// B1/B2 config families.
//
// The exhaustive per-value coverage lives in Vitest (__tests__/config/s10-*).
// Here we only confirm, in a real browser, that the config → visible effect
// chain works end to end for effects robust under software rendering (DOM,
// WebGL-independent): the branding banner (geoleaf.config.json).
//
// The `cfg-` prefix marks the config-contract spec family (collision-proof
// against the 10,11,12… plugin-validation numbering).
//
// EXECUTION PREREQUISITE: standard e2e harness (`npm run build:deploy:all`
// to populate deploy/*, then Playwright) WITH software WebGL rendering
// (SwiftShader flags from e2e/helpers/launch-options.js — wired into
// playwright.config.js; without them the headless `new maplibregl.Map()`
// fails and the branding is never mounted). The per-value coverage lives in
// Vitest (__tests__/config/s10-*) and does not depend on the browser.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") }); // deploy-core (profil tourism)

test.describe("cfg-c1 — racine/features (effets visibles)", () => {
    test("branding.enabled:true + branding.text → bandeau affiché avec le texte", async ({
        page,
    }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        const branding = page.locator(".gl-branding");
        await expect(branding).toBeVisible({ timeout: 10000 });
        // deploy-core/profiles/geoleaf.config.json → modules.branding.text is "Propulsé par © GeoLeaf…"
        await expect(branding).toContainText("Propulsé par");
    });

    test("modules.branding.enabled:false → aucun bandeau (effet du flag)", async ({ page }) => {
        // Patch the geoleaf.config.json response before boot to disable branding.
        //
        // The key is `modules.branding.enabled`, NOT the root `branding`: the
        // capability migrated from the root app-global key to its capability
        // block (capabilities/branding/branding-capability.ts →
        // gate.configPath "modules.branding.enabled", opt-in). Patching
        // `cfg.branding` only wrote to a dead key any more — the banner
        // stayed displayed.
        //
        // geoleaf.config.json is indeed the target: the gate is evaluated on
        // the PRE-MERGE baseCfg (app/boot-core.ts `toCapConfig(baseCfg)`),
        // and `modules.branding` is an app-global block declared in that
        // file.
        await page.addInitScript(() => {
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const url = typeof input === "string" ? input : input && input.url;
                const res = await origFetch(input, init);
                if (url && url.includes("geoleaf.config.json")) {
                    try {
                        const cfg = await res.clone().json();
                        cfg.modules = Object.assign({}, cfg.modules);
                        cfg.modules.branding = Object.assign({}, cfg.modules.branding, {
                            enabled: false,
                        });
                        return new Response(JSON.stringify(cfg), {
                            status: 200,
                            headers: { "Content-Type": "application/json" },
                        });
                    } catch {
                        return res;
                    }
                }
                return res;
            };
        });

        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        // Give the boot/branding init time to run, then assert the banner never appears.
        await page.waitForTimeout(1500);
        await expect(page.locator(".gl-branding")).toHaveCount(0);
    });
});
