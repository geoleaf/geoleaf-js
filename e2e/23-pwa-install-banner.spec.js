// @ts-check
// E2E: 23-pwa — PWA install banners (deploy-core, port 8766).
//
// This file discharges scenario **S7** of the internal browser-verification
// table, which said why it could NOT be covered at the unit tier: "the real
// rendering is behind a `setTimeout(1500)` and `getLabel` resolves against the
// runtime's active language; happy-dom exercises neither the real timer nor
// full DOM rendering (the tests advance fake timers, not the real delay)".
//
// ⚠️ Context indispensable to read these tests: until 2026-07-21, the `pwa`
// capability was **dead in production**. `_applyModularEnrichedProfile`
// returned the profile object instead of the merged config, so
// `capabilities/pwa/install.ts` received `undefined` for `modules.pwa`,
// took the "gate off" branch and called `_unregisterAll()`. None of these
// banners had thus EVER been able to display, on any profile. These tests are
// the first real verification of that path.
//
// S7's 3 sub-scenarios:
//   1. `installPrompt.enabled:true` + `short_name` set, in a NON-FR language
//      → translated banner carrying the configured app name (and not "GeoLeaf")
//   2. iOS Safari not installed → iOS banner (the one behind the `setTimeout(1500)`)
//   3. profile without `installPrompt.enabled` → NO banner

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("core") });

// Deliberately distinct from "GeoLeaf": that is what makes the test
// discriminating. If the `modules.pwa.short_name` read regresses, the fallback
// is "GeoLeaf" and the assertion fails — instead of passing on a value
// identical by coincidence.
const APP_NAME = "Atlas Rosario";

/**
 * Rewrites `modules.pwa` in the `geoleaf.config.json` response before boot.
 * Same vehicle as `cfg-c1-root-features.spec.js`: `modules.pwa` is an
 * app-global block declared in that file, not in the profile bundle.
 */
async function patchPwa(page, patch) {
    await page.addInitScript((p) => {
        const origFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const url = typeof input === "string" ? input : input && input.url;
            const res = await origFetch(input, init);
            if (url && url.includes("geoleaf.config.json")) {
                try {
                    const cfg = await res.clone().json();
                    cfg.modules = Object.assign({}, cfg.modules);
                    cfg.modules.pwa = Object.assign({}, cfg.modules.pwa, p);
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
    }, patch);
}

/** Fires a synthetic `beforeinstallprompt` — headless Chromium never does. */
async function fireBeforeInstallPrompt(page) {
    await page.evaluate(() => {
        const evt = /** @type {any} */ (new Event("beforeinstallprompt"));
        evt.prompt = () => Promise.resolve();
        evt.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
        window.dispatchEvent(evt);
    });
}

test.describe("23-pwa — bannière d'installation (S7)", () => {
    test("installPrompt activé + short_name posé, en anglais → bannière traduite au nom configuré", async ({
        page,
    }) => {
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            name: "Atlas Cartographique Rosario",
            installPrompt: { enabled: true },
        });
        // `?lang=en` takes precedence over `ui.language` (i18n.ts) — the
        // shortest path to a non-FR language without touching the profile.
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Bounded re-emission: `beforeinstallprompt` is edge-triggered and its
        // listener is set by `PwaLifecycle` in the `sharedLifecycle` pass,
        // whose order relative to the map container's appearance is not
        // guaranteed. A single dispatch can thus land before the arming and be
        // lost without a trace. Same motive as `22-feature-info`'s
        // `geoleaf:feature:hover` seam.
        const banner = page.locator("#gl-install-banner");
        await expect(async () => {
            await fireBeforeInstallPrompt(page);
            await expect(banner).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 15000 });

        // The scenario's TWO halves, asserted separately so a failure says
        // which. (a) the label is in English — `pwa.install.title` is
        // "Install the {0} app" in `en` vs « Installer l'application {0} » in `fr`.
        await expect(banner).toContainText("Install the");
        await expect(banner).not.toContainText("Installer l'application");
        // (b) the name comes from the config, not the library's fallback.
        await expect(banner).toContainText(APP_NAME);
        await expect(banner).not.toContainText("GeoLeaf");

        // The action button is translated too (`pwa.install.button`).
        await expect(banner).toContainText("Install");
    });

    test("profil SANS installPrompt.enabled → aucune bannière, même sur beforeinstallprompt", async ({
        page,
    }) => {
        // ⚠️ THIS TEST NOW PATCHES THE CONFIG, and the motive deserves reading.
        //
        // It used to say "the shipped config carries
        // `installPrompt.enabled: false` — so we patch NOTHING, this test
        // proves the real deployment's default state". That was true until the
        // fix that enabled the install prompt: on an iOS fleet it is the
        // offline storage's survival condition, on Android the cheapest
        // engagement signal.
        //
        // 🛑 The test was thus only green because the DEPLOY was stale. The
        // first honest rebuild reddened it — measured 2026-08-02 — and the red
        // would have been attributed to the wrong batch when it came from a
        // configuration change.
        //
        // What it guards stays EXACTLY the same: a profile that does not
        // enable the prompt displays no banner. What changes is that this
        // state must now be set explicitly instead of inherited from the
        // deploy — which is more honest: a test depending on an ambient
        // configuration default does not say what it thinks it says.
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            installPrompt: { enabled: false },
        });
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        await fireBeforeInstallPrompt(page);
        // Let the iOS banner's delay (1500 ms) pass by a wide margin: if a
        // banner were to appear in error, it has the time.
        await page.waitForTimeout(2500);

        await expect(page.locator("#gl-install-banner")).toHaveCount(0);
        await expect(page.locator("#gl-ios-install-banner")).toHaveCount(0);
    });
});

test.describe("23-pwa — bannière iOS (S7)", () => {
    // `isIOSInstallable()` tests `/iPhone|iPad|iPod/i` on the UA then
    // `navigator.standalone !== true` (platform.ts). An iPhone UA thus
    // suffices to take this path; `standalone` is absent under Chromium, which
    // matches "not installed yet".
    test.use({
        userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        viewport: { width: 390, height: 844 },
    });

    test("iOS non installé → bannière iOS après son délai réel, au nom configuré", async ({
        page,
    }) => {
        await patchPwa(page, {
            enabled: true,
            short_name: APP_NAME,
            installPrompt: { enabled: true },
        });
        await page.goto("/?lang=en");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // No `beforeinstallprompt` here: iOS does not emit it, which is this
        // second banner's whole reason to exist. It arrives on its own, behind
        // `setTimeout(1500)` — the real delay happy-dom could not exercise.
        const banner = page.locator("#gl-ios-install-banner");
        await expect(banner).toBeVisible({ timeout: 15000 });

        await expect(banner).toContainText(APP_NAME);
        await expect(banner).not.toContainText("GeoLeaf");
        // `pwa.ios.title` = "Install {0}" in English, « Installer {0} » in French.
        await expect(banner).toContainText("Install");
    });
});
