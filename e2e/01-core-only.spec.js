// @ts-check
// Sprint 8.4 — E2E: 01-core-only — map displays, zoom works, GeoJSON layers load

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

test.use({ baseURL: baseURL("core") });

test.describe("01-core-only", () => {
    test("page loads and map container is present", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    });

    test("map has valid dimensions", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        const box = await page.locator("#geoleaf-map").boundingBox();
        expect(box).not.toBeNull();
        expect(box.width).toBeGreaterThan(100);
        expect(box.height).toBeGreaterThan(100);
    });

    test("[a11y] page passes WCAG 2.1 AA axe scan", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    test("core-only does not contain any cache UI (plugin-storage absent)", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await expect(page.locator(".gl-cache-button")).toHaveCount(0);
        await expect(page.locator("#gl-cache-modal")).toHaveCount(0);
        await expect(page.locator(".gl-cache-section")).toHaveCount(0);
        await expect(page.locator(".geoleaf-ctrl-cache-button")).toHaveCount(0);
    });
});
