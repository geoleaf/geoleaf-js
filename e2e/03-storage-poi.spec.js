// @ts-check
// E2E: 03-storage-poi — full variant (port 8768): storage + editor coexistence.
// NOTE: deploy-full ships Editor in place of AddPOI (build-deploy.cjs supersede),
// so this scenario validates the storage cache button alongside the editor toolbar
// slot — not the legacy [data-gl-toolbar-action="poi-add"], which is absent here.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

test.use({ baseURL: baseURL("full") });

test.describe("03-storage-poi", () => {
    test("page loads and map is visible", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    });

    test("full toolbar exposes the storage cache and editor buttons", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        // Storage cache button (S2 toolbar slot) and Editor button (supersedes AddPOI on full).
        await expect(page.locator('[data-gl-toolbar-action="offline-ui"]').first()).toBeVisible({
            timeout: 10000,
        });
        await expect(page.locator('[data-gl-toolbar-action="editor"]').first()).toBeVisible({
            timeout: 10000,
        });
    });

    test("[a11y] storage-poi page passes WCAG 2.1 AA axe scan", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });
});
