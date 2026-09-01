// @ts-check
// BROWSER VERIFICATION — computed accessibility and real focus. Scenarios B.1
// and B.6 of the internal browser-verification table.
//
// These two scenarios are the CORE of what happy-dom cannot decide:
//   - B.1: a region's **computed accessible name** cannot be read in a
//          `getAttribute` — it takes the accessibility tree, which only a
//          real browser builds. Reached here through Playwright's role engine
//          (`getByRole`), not the raw DOM.
//   - B.6: the focus trap's `offsetParent !== null` filter is UNTESTABLE
//          under happy-dom — `offsetParent` is `undefined` there, so the
//          filter keeps everything and the assertion would pass no matter
//          what. `focus-trap.ts` documents it in black and white
//          ("It cannot be covered by a test […] Blocked on the browser
//          verification pass"). This is precisely that pass.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { bootMap, waitMapLoaded } from "./helpers/boot.js";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

test.describe("VN — accessibilité calculée et focus réel (B.1, B.6)", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await bootMap(page);
        await waitMapLoaded(page);
    });

    // ── B.1 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: the filter panel without `modules.filter.title` announced
    // "Filter" (aria-label) while displaying « Filtrer » (WCAG 2.5.3, Label in
    // Name). `render.ts` now derives the region's `aria-label` AND the
    // visible `<h2>` from the SAME source (`_title(config)`).
    //
    // ⚠️ The test reads the VISIBLE title then asks the accessibility tree for
    // the region BY THAT NAME (`getByRole`). If the two diverged — the very
    // defect — the region would not be found under the visible name. The only
    // way to prove it: `getByRole` computes the accessible name (aria-label
    // wins), which a `getAttribute` does not.
    test("B.1 — le nom accessible du panneau de filtres égale son titre visible", async ({
        page,
    }) => {
        // The panel is `visibility: hidden` at boot; opening it brings it into the tree.
        await page.getByRole("button", { name: "Filtres" }).first().click();

        const panel = page.locator(".gl-filter-panel.gl-is-open");
        await expect(panel).toBeVisible({ timeout: 10000 });

        // The title as a sighted user reads it.
        const visibleTitle = (await panel.locator(".gl-filter-panel__title").textContent())?.trim();
        expect(visibleTitle, "titre visible introuvable").toBeTruthy();

        // The region as a screen reader names it. If the aria-label diverged
        // from the title ("Filter" ≠ « Filtrer »), this `getByRole` would find
        // nothing.
        await expect(
            page.getByRole("region", { name: visibleTitle }),
            `le nom accessible de la région ≠ le titre visible "${visibleTitle}" (WCAG 2.5.3)`
        ).toBeVisible({ timeout: 10000 });
    });

    // ── B.6 🔴 ────────────────────────────────────────────────────────────────────────
    // Counter-proof: the focus trap's selector only listened for `button` — a
    // link (photo credit, source) was thus SKIPPED, and `Tab` left the modal.
    // The selector now includes `[href]` (`focus-trap.ts`). Second half,
    // unverifiable anywhere else: the `offsetParent !== null` filter keeps
    // only the focusables really VISIBLE, which only makes sense in a
    // rendering engine.
    //
    // A forged gallery (2 images) is opened through the public API, the
    // lightbox opened, a link injected into it, and it is proven that `Tab`
    // from the link (last focusable) comes back to the close button (first) —
    // the focus stays trapped.
    test("B.6 — Tab dans la lightbox avec un lien reste piégé dans la modale", async ({ page }) => {
        await page.evaluate(() => {
            window.GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "l1",
                    featureId: "f1",
                    properties: { gal: ["https://e.com/1.jpg", "https://e.com/2.jpg"] },
                    geometry: null,
                    lngLat: { lat: -48, lng: -58 },
                    point: { x: 10, y: 10 },
                },
                { layerId: "l1", fields: [{ field: "gal", type: "gallery" }] }
            );
        });

        await page.locator(".gl-poi-gallery__main img").click();
        const lightbox = page.locator(".gl-poi-lightbox-global");
        await expect(lightbox).toBeVisible({ timeout: 5000 });

        // A legitimate link in the modal (credit / source) — exactly the case
        // the old `button`-only selector let escape.
        await page.evaluate(() => {
            const box = document.querySelector(".gl-poi-lightbox-global");
            const a = document.createElement("a");
            a.href = "https://e.com/credit";
            a.textContent = "crédit";
            a.className = "gl-vn-credit";
            box.appendChild(a);
        });

        // Focus the link (last focusable), then Tab → must come back into the modal.
        await page.locator("a.gl-vn-credit").focus();
        await page.keyboard.press("Tab");

        const stillTrapped = await page.evaluate(
            () => !!document.activeElement?.closest?.(".gl-poi-lightbox-global")
        );
        expect(
            stillTrapped,
            "Tab depuis le lien s'est échappé de la lightbox (sélecteur tronqué ?)"
        ).toBe(true);

        // And the precise wrap point: Tab from the last focusable returns to
        // the first (the close button), not elsewhere.
        const focusedClass = await page.evaluate(() => document.activeElement?.className ?? "");
        expect(focusedClass).toContain("gl-poi-lightbox__close");

        // Symmetry: Shift+Tab from the close button (first) goes to the link
        // (last). The cycle is closed at BOTH ends, not just one.
        await page.locator(".gl-poi-lightbox__close").focus();
        await page.keyboard.press("Shift+Tab");
        const wrappedToLast = await page.evaluate(
            () => document.activeElement?.className === "gl-vn-credit"
        );
        expect(wrappedToLast, "Shift+Tab depuis le premier ne boucle pas vers le dernier").toBe(
            true
        );
    });
});
