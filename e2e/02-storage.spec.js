// @ts-check
// E2E: 02-storage — map + cache/offline UI (the critical offline-storage scenario).
// Selectors updated for the toolbar-slot cache button (data-gl-toolbar-action="offline-ui");
// the legacy .gl-cache-button anchor was removed when the button became a core toolbar slot.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

// Port 8767 (deploy-storage) is retired: storage ships in both gated variants now.
// ⚠️ This spec then targeted `deploy-addpoi`, "the closest neighbour of the
// old storage-only build". That variant no longer exists: `addpoi` merged
// into `editor`. The target becomes `deploy-full`, which carries editing AND
// `offline-ui` — so the editor's tool buttons now sit beside the cache
// button under test, which the note above named precisely as the
// difference. A change of VARIANT, not of port.
test.use({ baseURL: baseURL("full") });

test.describe("02-storage", () => {
    test("page loads and map is visible", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    });

    test("page loads without critical JavaScript errors", async ({ page }) => {
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        const critical = errors.filter(
            (e) => !e.includes("favicon") && !e.includes("chrome-extension")
        );
        expect(critical).toHaveLength(0);
    });

    test("[a11y] storage page passes WCAG 2.1 AA axe scan", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    test("cache toolbar button is present and opens the styled cache modal", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        // S2 toolbar slot: the cache button is rendered by the core toolbar with
        // data-gl-toolbar-action="offline-ui" (desktop right band + mobile pill).
        const btn = page.locator('[data-gl-toolbar-action="offline-ui"]').first();
        await expect(btn).toBeVisible({ timeout: 10000 });
        await btn.click();
        // The cache modal is mounted lazily and styled via bundled CSS: display must not be "none".
        const modal = page.locator("#gl-cache-modal");
        await expect(modal).toHaveCount(1, { timeout: 5000 });
        const display = await modal.evaluate((el) => getComputedStyle(el).display);
        expect(display).not.toBe("none");
    });
});
