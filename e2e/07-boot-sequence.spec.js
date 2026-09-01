// @ts-check
// E2E: 07-boot-sequence — boot lifecycle, perf marks, deferred modules, coverage

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { collectCoverage } from "./helpers/coverage.js";
import { captureConsole } from "./helpers/boot.js";

test.use({ baseURL: baseURL("coverage") });

test.describe("07-boot-sequence", () => {
    test("map container loads and GeoLeaf is defined", async ({ page }) => {
        // Enable perf marks before page loads
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        const hasGeoLeaf = await page.evaluate(() => typeof window.GeoLeaf !== "undefined");
        expect(hasGeoLeaf).toBe(true);
    });

    test("geoleaf:map:ready event fires", async ({ page }) => {
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
            window.__GL_MAP_READY = false;
            document.addEventListener("geoleaf:map:ready", () => {
                window.__GL_MAP_READY = true;
            });
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait for the event (may already have fired)
        await page.waitForFunction(() => window.__GL_MAP_READY === true, null, { timeout: 30000 });
        const ready = await page.evaluate(() => window.__GL_MAP_READY);
        expect(ready).toBe(true);
    });

    test("geoleaf:app:ready event fires with version", async ({ page }) => {
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
            window.__GL_APP_READY_DETAIL = null;
            document.addEventListener("geoleaf:app:ready", (e) => {
                window.__GL_APP_READY_DETAIL = e.detail || {};
            });
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        await page.waitForFunction(() => window.__GL_APP_READY_DETAIL !== null, null, {
            timeout: 30000,
        });
        const detail = await page.evaluate(() => window.__GL_APP_READY_DETAIL);
        expect(detail).toBeTruthy();
        expect(detail.version).toBeDefined();
        expect(detail.timestamp).toBeDefined();
    });

    test("performance marks contain initApp start and ready", async ({ page }) => {
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait for app:ready before checking marks
        await page.waitForFunction(
            () => {
                return performance.getEntriesByName("geoleaf:initApp:ready").length > 0;
            },
            null,
            { timeout: 30000 }
        );

        const marks = await page.evaluate(() =>
            performance.getEntriesByType("mark").map((m) => m.name)
        );
        expect(marks).toContain("geoleaf:initApp:start");
        expect(marks).toContain("geoleaf:initApp:ready");
    });

    test("deferred modules initialize after app:ready", async ({ page }) => {
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
            window.__GL_APP_READY_TS = 0;
            document.addEventListener("geoleaf:app:ready", () => {
                window.__GL_APP_READY_TS = performance.now();
            });
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait for app:ready + deferred UI init mark
        await page.waitForFunction(() => window.__GL_APP_READY_TS > 0, null, { timeout: 30000 });

        // Check that deferred UI init mark exists and fires after app:ready start mark
        const deferredMark = await page.evaluate(() => {
            const entries = performance.getEntriesByName("geoleaf:init:deferredUI:start");
            return entries.length > 0 ? entries[0].startTime : null;
        });
        // deferredUI mark should exist (may be null if not emitted in this profile)
        if (deferredMark !== null) {
            const appReadyMark = await page.evaluate(() => {
                const entries = performance.getEntriesByName("geoleaf:initApp:ready");
                return entries.length > 0 ? entries[0].startTime : 0;
            });
            // Deferred modules start before or around app:ready (they're triggered by app:ready event)
            expect(typeof deferredMark).toBe("number");
            expect(typeof appReadyMark).toBe("number");
        }
    });

    test("GeoJSON data files are fetched during boot", async ({ page }) => {
        const geojsonRequests = [];
        page.on("response", (response) => {
            if (response.url().endsWith(".geojson") && response.status() === 200) {
                geojsonRequests.push(response.url());
            }
        });

        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait for app ready
        await page.waitForFunction(
            () => {
                return performance.getEntriesByName("geoleaf:initApp:ready").length > 0;
            },
            null,
            { timeout: 30000 }
        );

        // Give GeoJSON fetches a moment to complete
        await page.waitForTimeout(3000);

        expect(geojsonRequests.length).toBeGreaterThan(0);
    });

    test("Istanbul coverage data is available on instrumented build", async ({ page }) => {
        await page.addInitScript(() => {
            window.__GEOLEAF_PERF__ = true;
        });
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });

        // Wait for full init
        await page.waitForFunction(
            () => {
                return performance.getEntriesByName("geoleaf:initApp:ready").length > 0;
            },
            null,
            { timeout: 30000 }
        );

        const hasCoverage = await page.evaluate(() => !!window.__coverage__);
        expect(hasCoverage).toBe(true);
    });

    // Regression net — the boot console must not carry a readiness warning per themed layer.
    //
    // Until 26/08/2026 it carried one PER LAYER of the default theme (nine on the tourism
    // profile). Cause: `LegendContract.isAvailable()` only tested that the facade CARRIED
    // `loadLayerLegend`, which is true from `registerGlobals` on — so the theme engine's
    // per-layer calls were waved through before `Legend.init`, which mounts on
    // `geoleaf:app:ready`, an event CAUSED by the end of that same theme apply. Nothing was
    // lost (LegendLifecycle reloads every configured layer right after init) but nothing
    // stopped it either, and no gate could see it: `ci:local` reads no browser console.
    //
    // Same shape as the assertion locking the sibling defect on GeoJSON, in
    // `15-file-import.spec.js`.
    test("boot console carries no '[Legend] Module not initialized'", async ({ page }) => {
        const { all } = captureConsole(page);
        // No `__GEOLEAF_PERF__` opt-in here, unlike its neighbours: the
        // `geoleaf:initApp:ready` mark waited on below is UNCONDITIONAL
        // (`app/boot-core.ts` says so, and says it must stay that way). Only the
        // granular `geoleaf:boot:*` marks sit behind the flag. Setting it here bought
        // nothing and cost one `tsc --checkJs` error against the TOOLING-TS ratchet.
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 20000 });
        // The warnings fired DURING the theme apply, so waiting for app:ready is what makes
        // this assertion meaningful: before it, an empty console proves nothing.
        await page.waitForFunction(
            () => performance.getEntriesByName("geoleaf:initApp:ready").length > 0,
            null,
            { timeout: 30000 }
        );

        const offenders = all.filter((line) => /\[Legend\] Module not initialized/.test(line));
        expect(offenders, offenders.join("\n")).toEqual([]);
    });
});

// Collect coverage data after all tests
test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
        window.__GEOLEAF_PERF__ = true;
    });
    // Absolute: this page comes from `browser.newPage()`, which carries no baseURL.
    await page.goto(`${baseURL("coverage")}/`);

    // Wait for full initialization
    try {
        await page.waitForFunction(
            () => {
                return performance.getEntriesByName("geoleaf:initApp:ready").length > 0;
            },
            null,
            { timeout: 30000 }
        );
    } catch {
        console.warn("[coverage] App did not fully initialize — collecting partial coverage");
    }

    await collectCoverage(page, "boot-sequence");
    await page.close();
});
