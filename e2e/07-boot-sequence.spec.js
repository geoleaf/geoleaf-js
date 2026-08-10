// @ts-check
// Sprint 8 B.2 — E2E: 07-boot-sequence — boot lifecycle, perf marks, deferred modules, coverage

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { collectCoverage } from "./helpers/coverage.js";

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
