// @ts-check
/**
 * 81 — ON A PHONE, WHAT THE NETWORK STATE SHOWS STAYS IN VIEW
 *
 * 🛑 THREE DEFECTS OF ONE CLASS, all measured on the deployed bundle before the fix, on a
 * phone-wide viewport:
 *
 * - the offline badge the network detector puts on the map sat on the row the theme selector
 *   takes below the tablet breakpoint: it was half hidden for as long as the network was down;
 * - the sync strip scrolls sideways with no visible scrollbar, and carried its two buttons with
 *   it: the action began at 330 px of a 375 px screen and ended at 444 px;
 * - the status row of the offline window does the same: its action ended at 453 px against a
 *   row that ends at 347 px — in each of the six languages.
 *
 * ⚠️ WHAT IS LOOKED AT: rectangles. A button is "in view" when its box is inside the box of the
 * strip that holds it; two surfaces "do not overlap" when their boxes do not intersect. Nothing
 * here reads a colour.
 *
 * ⚠️ THE LANGUAGE IS FORCED for the offline window: its row is the longest in French, by two
 * pixels over German — measured across the six. A shorter language would pass on a narrower
 * margin than the one a French user gets.
 */

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { bootMapUntilLoaded } from "./helpers/boot.js";

/**
 * Reads the box of the first element matching `selector`, in viewport pixels.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<{left: number, top: number, right: number, bottom: number}>}
 */
async function box(page, selector) {
    const rect = await page.locator(selector).first().boundingBox();
    if (!rect) throw new Error(`[81] ${selector} has no box — it is not rendered.`);
    return {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
    };
}

/**
 * Reads a box once the element has finished moving: no transition left running on it.
 *
 * ⚠️ Two reads that agree are NOT that: taken before the transition has started, they agree
 * on the starting position. Measured — one run in three settled on the row above that way.
 * The element's own animations are the fact; two frames are let through first, so a
 * transition triggered by the style change just made has had the time to exist.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<{left: number, top: number, right: number, bottom: number}>}
 */
async function settledBox(page, selector) {
    await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    );
    await page.waitForFunction(
        (sel) => document.querySelector(sel)?.getAnimations({ subtree: true }).length === 0,
        selector,
        { timeout: 5_000 }
    );
    return box(page, selector);
}

test.describe("phone, core variant", () => {
    test.use({
        baseURL: baseURL("core"),
        serviceWorkers: "block",
        viewport: { width: 375, height: 812 },
        hasTouch: true,
    });

    test("the offline badge does not sit under the theme selector", async ({ page, context }) => {
        await bootMapUntilLoaded(page);
        await page
            .locator("#gl-loader")
            .waitFor({ state: "hidden", timeout: 10_000 })
            .catch(() => {});

        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        const badge = page.locator(".geoleaf-offline-badge-control");
        await expect(badge).toBeVisible({ timeout: 10_000 });
        // 🛑 The sync strip opens on the same event, a read of the queue later, and pushes the
        // map AND the theme selector down by its height — the selector by a TRANSITION.
        // Measured on the defect: read as soon as the strip is visible, the selector is still
        // on the row above (top 10 px, against 62 px three hundred milliseconds later) and the
        // two boxes miss each other. This test passed on the defect for exactly that reason.
        await expect(page.locator(".gl-sync-banner__action")).toBeVisible({ timeout: 10_000 });
        const selector = await settledBox(page, "#gl-theme-primary-container");

        const b = await box(page, ".geoleaf-offline-badge-control");
        const apart =
            b.right <= selector.left ||
            b.left >= selector.right ||
            b.bottom <= selector.top ||
            b.top >= selector.bottom;
        expect(
            apart,
            `badge ${JSON.stringify(b)} intersects the theme selector ${JSON.stringify(selector)}`
        ).toBe(true);
    });

    test("the sync strip keeps its action and its close button on screen", async ({
        page,
        context,
    }) => {
        await bootMapUntilLoaded(page);
        // The strip shows itself once it has something to say: being offline is one.
        await context.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await expect(page.locator(".gl-sync-banner__action")).toBeVisible({ timeout: 10_000 });

        const strip = await box(page, ".gl-sync-banner");
        for (const selector of [".gl-sync-banner__action", ".gl-sync-banner__close"]) {
            const button = await box(page, selector);
            expect(button.left, `${selector} starts before the strip`).toBeGreaterThanOrEqual(
                strip.left
            );
            expect(button.right, `${selector} ends past the strip`).toBeLessThanOrEqual(
                strip.right
            );
        }
    });
});

test.describe("phone, full variant", () => {
    test.use({
        baseURL: baseURL("full"),
        serviceWorkers: "block",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
    });

    test("the offline window keeps its sync action inside the status row", async ({ page }) => {
        await page.addInitScript(() => {
            try {
                localStorage.setItem("gl-lang", "fr");
            } catch {
                // Storage refused: the page falls back on its own language, and says so below.
            }
        });
        await bootMapUntilLoaded(page);
        await page
            .locator("#gl-loader")
            .waitFor({ state: "hidden", timeout: 10_000 })
            .catch(() => {});

        await page.locator('[data-gl-toolbar-action="offline-ui"]').first().click();
        await expect(page.locator(".gl-cache-sync-status__action")).toBeVisible({
            timeout: 15_000,
        });
        await expect(page.locator(".gl-cache-sync-status__action")).toHaveText("Synchroniser");

        const row = await box(page, ".gl-cache-sync-status");
        const action = await box(page, ".gl-cache-sync-status__action");
        expect(action.left, "the action starts before the row").toBeGreaterThanOrEqual(row.left);
        expect(action.right, "the action ends past the row").toBeLessThanOrEqual(row.right);
    });
});
