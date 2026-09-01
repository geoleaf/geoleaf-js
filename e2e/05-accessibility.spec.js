// @ts-check
// Automated WCAG tests via @axe-core/playwright
//
// Dedicated accessibility suite: deep axe scans over the deploy variants, plus
// behavioural tests (focus trap, keyboard nav, ARIA).
//
// References:
//   - RGAA 4.1 / WCAG 2.1 AA (mandatory for public-sector bodies)
//   - packages/core/docs/ACCESSIBILITY.md — implemented ARIA patterns
//   - Decision: full-page scans, MapLibre canvas excluded, runOnly wcag2aa

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage, scanComponent } from "./helpers/axe-config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — Baseline axe scans over the 2 deploy variants
// Checks that no third-party plugin introduces a WCAG regression.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][baseline] axe scans — 2 deploy variants", () => {
    test("core (deploy-core) passes WCAG 2.1 AA", async ({ page }) => {
        page.context().setDefaultTimeout(30000);
        await page.goto(`${baseURL("core")}/`);
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        // Allow secondary modules to attach their DOM before scanning
        await page.waitForTimeout(3000);
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    // ⚠️ A SCAN DISAPPEARED HERE, AND IT IS A DELETION, NOT A REPOINT.
    // It targeted `deploy-addpoi`, with this motive: "that variant had NO a11y scan, and it
    // is the only one where the add-POI button and form are rendered". The motive fell with
    // the variant — the `poi-add` button and its form now live on `deploy-full`, which the
    // scan below already covers. Repointing it would have produced a byte-for-byte
    // DUPLICATE, exactly what an earlier architecture note refused to do for another
    // retired variant. The POI journey's a11y surface is therefore not lost: it sits in the
    // `full` scan, and `09-editor.spec.js` carries its own editor scan.

    test("full (deploy-full) passes WCAG 2.1 AA", async ({ page }) => {
        page.context().setDefaultTimeout(30000);
        await page.goto(`${baseURL("full")}/`);
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — UI components: layer manager, legend, table, zoom controls
// Targeted tests on the components always present in the tourism profile.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][ui-components] ARIA sur composants UI actifs", () => {
    test.use({ baseURL: baseURL("core") });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("layer manager (.gl-layer-manager) passe axe scan", async ({ page }) => {
        await expect(page.locator(".gl-layer-manager")).toBeAttached({ timeout: 5000 });
        const results = await scanComponent(page, ".gl-layer-manager");
        expect(results.violations).toEqual([]);
    });

    test("légende (.gl-map-legend) passe axe scan", async ({ page }) => {
        await expect(page.locator(".gl-map-legend")).toBeAttached({ timeout: 5000 });
        const results = await scanComponent(page, ".gl-map-legend");
        expect(results.violations).toEqual([]);
    });

    test("contrôles zoom MapLibre ont des labels accessibles", async ({ page }) => {
        // GeoLeaf toolbar zoom controls must have accessible names for screen readers.
        // Use toBeAttached (not toBeVisible) — controls exist in DOM but may be
        // considered "hidden" by Playwright due to toolbar overflow in headless.
        const zoomIn = page.locator('[data-gl-toolbar-action="zoom-in"]');
        const zoomOut = page.locator('[data-gl-toolbar-action="zoom-out"]');
        await expect(zoomIn).toBeAttached({ timeout: 5000 });
        await expect(zoomOut).toBeAttached({ timeout: 5000 });
        // Verify aria-label or title is present
        const zoomInLabel =
            (await zoomIn.getAttribute("aria-label")) ?? (await zoomIn.getAttribute("title"));
        const zoomOutLabel =
            (await zoomOut.getAttribute("aria-label")) ?? (await zoomOut.getAttribute("title"));
        expect(zoomInLabel).toBeTruthy();
        expect(zoomOutLabel).toBeTruthy();
    });

    test("tableau (.gl-table-panel) passe axe scan quand présent", async ({ page }) => {
        // TWO lazinesses to lift (cf. 21-table.spec.js):
        //  1. the BUNDLE is lazy (registerLazy)  → plugins.load('table')
        //  2. the DOM PANEL is lazy: with `modules.table.defaultVisible: false` (tourism
        //     profile), `geoleaf:map:ready` builds nothing; `TableLifecycle.ensureInitialized()`
        //     builds the DOM on the first `table` toolbar action.
        // Loading the bundle alone therefore leaves `.gl-table-panel` out of the DOM.
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("table"));
        await page.waitForFunction(
            () => typeof (/** @type {any} */ (window).GeoLeaf?.Table) === "object",
            null,
            { timeout: 10000 }
        );
        await expect(page.locator('[data-gl-toolbar-action="table"]').first()).toBeAttached({
            timeout: 10000,
        });
        await page.evaluate(() => {
            /** @type {HTMLElement|null} */ (
                document.querySelector('[data-gl-toolbar-action="table"]')
            )?.click();
        });
        const tablePanel = page.locator(".gl-table-panel");
        await expect(tablePanel).toBeAttached({ timeout: 10000 });
        const results = await scanComponent(page, ".gl-table-panel");
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 — Focus management and keyboard navigation
// Behavioural tests: Escape, Tab, focus trap, focus return.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][keyboard] navigation clavier / focus management", () => {
    test.use({ baseURL: baseURL("core") });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("contrôles carte atteignables au clavier (Tab depuis body)", async ({ page }) => {
        // Press Tab from body — at least one visible interactive map control must receive focus
        await page.keyboard.press("Tab");
        const focused = page.locator(":focus");
        // The focused element should be inside the MapLibre container or GeoLeaf controls
        const focusedCount = await focused.count();
        expect(focusedCount).toBeGreaterThan(0);
    });

    test("side panel s'ouvre programmatiquement et ariahidden=false", async ({ page }) => {
        // The `.gl-poi-sidepanel` container is created LAZILY on first open
        // (capabilities/feature-info/surfaces/sidepanel.ts — `if (_el && _content) return _el;`):
        // it does not exist in the DOM at boot. So we open it through the public façade
        // `GeoLeaf.FeatureInfo.openSidePanel(detail, layout)` (feature-info/public-api.ts),
        // which is what the test title says. `modules.feature-info.enabled: true` in tourism.
        await page.evaluate(() => {
            /** @type {any} */ (window).GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "a11y-e2e",
                    featureId: "a11y-1",
                    properties: { title: "Panneau a11y" },
                    geometry: { type: "Point" },
                    lngLat: { lat: -32.95, lng: -60.64 },
                    point: { x: 0, y: 0 },
                },
                { layerId: "a11y-e2e", fields: [{ field: "title", type: "text", label: "Titre" }] }
            );
        });

        const sidepanel = page.locator(".gl-poi-sidepanel");
        await expect(sidepanel).toBeAttached({ timeout: 10000 });
        await expect(sidepanel).toHaveClass(/(^|\s)open(\s|$)/);

        // Exposure to assistive technologies once OPEN — which is what the title says.
        // The shell is a named landmark, and `openSidePanel` flips `aria-hidden`
        // back to "false" + removes `inert` (sidepanel.ts): closed, the drawer
        // stays in the DOM, hidden by a mere `transform: translateX(100%)`, so
        // off-screen ≠ hidden — the aria-hidden/inert pair is what takes it out
        // of the a11y tree and the tab order.
        expect(await sidepanel.getAttribute("role")).toBe("complementary");
        expect(await sidepanel.getAttribute("aria-label")).toBeTruthy();
        expect(await sidepanel.getAttribute("aria-hidden")).toBe("false");
        expect(await sidepanel.getAttribute("inert")).toBeNull();

        // Focus management (this group's subject): opening moves focus onto
        // the close button (sidepanel.ts), so keyboard/screen-reader users land
        // INSIDE the panel — impossible had the subtree stayed inert.
        await expect(sidepanel.locator("[data-action='close']")).toBeFocused();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4 — Mobile viewport (375×667)
// Checks WCAG on the specifically mobile components.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][mobile] viewport 375×667", () => {
    test.use({
        baseURL: baseURL("core"),
        viewport: { width: 375, height: 667 },
    });

    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);
    });

    test("page entière passe axe scan en viewport mobile", async ({ page }) => {
        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });

    test("mobile toolbar (.gl-map-toolbar) a role=toolbar si présent", async ({ page }) => {
        // The mobile toolbar is always initialized by initMobileToolbar() when .gl-main exists.
        const toolbar = page.locator(".gl-map-toolbar");
        await expect(toolbar).toBeAttached({ timeout: 10000 });
        const role = await toolbar.getAttribute("role");
        expect(role).toBe("toolbar");
        const results = await scanComponent(page, ".gl-map-toolbar");
        expect(results.violations).toEqual([]);
    });

    test("sheet modal ([role=dialog][aria-modal]) passe axe si ouvert", async ({ page }) => {
        // The sheet overlay is created at initMobileToolbar() init time.
        // Open it via the layers toolbar button (showLayerManager: true in tourism profile).
        const sheetTrigger = page.locator('[data-gl-sheet="layers"]').first();
        await expect(sheetTrigger).toBeAttached({ timeout: 10000 });
        await sheetTrigger.click();
        const sheet = page.locator('.gl-sheet-overlay[aria-modal="true"]').first();
        await expect(sheet).toBeVisible({ timeout: 5000 });
        // Verify required ARIA attributes
        const ariaLabel =
            (await sheet.getAttribute("aria-labelledby")) ??
            (await sheet.getAttribute("aria-label"));
        expect(ariaLabel).toBeTruthy();
        const results = await scanComponent(page, ".gl-sheet-overlay");
        expect(results.violations).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5 — Lightbox
//
// 🔻 THIS GROUP WAS A PERMANENT `skip`, on a premise proven FALSE twice over.
// The written motive was: "the shipped profile contains no POI with images;
// this test will be enabled when image data is present". Verified 2026-08-19:
//
//   ① The shipped profile DOES contain some. The `sites_rosario` layer
//      declares an `image` widget field and its TWO features carry a photo
//      and a filled gallery. Three other layers declare the same widget. The
//      missing data was not missing.
//   ② And above all, it was NOT NECESSARY. The lightbox opens through the
//      public API on a forged gallery — the pattern already existed in
//      `vn-a11y-focus.spec.js`, written for another scenario. Waiting for
//      shipped data was waiting for something the test did not need.
//
// 🛑 The lesson goes beyond this file: a data-conditioned `skip` is verified
// by nobody. Its condition never gets re-tested — it gets re-read, and a
// re-read confirms what it reads. This one survived the appearance of the
// very data that lifted it.
//
// What this test covers and the unit guard cannot: the FULL `axe` scan on the
// real rendering — computed contrast, tab order, accessibility tree.
// `axe-core` is only available via `@axe-core/playwright`, hence only here.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("[a11y][lightbox] dialog ARIA", () => {
    test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

    test("la lightbox ouverte passe le scan axe", async ({ page }) => {
        page.context().setDefaultTimeout(30000);
        await page.goto("/");
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });

        // Gallery FORGED through the public API — same pattern as
        // `vn-a11y-focus.spec.js` B.6. ⚠️ Deliberately forged rather than
        // clicked in the profile: the test's subject is the MODAL, not the
        // path to it, and depending on a named feature of the shipped profile
        // would tie this test to demonstration data. The profile does carry
        // images — verified at the group's head, and what obsoleted the old
        // skip.
        await page.evaluate(() => {
            window.GeoLeaf.FeatureInfo.openSidePanel(
                {
                    layerId: "a11y-lightbox",
                    featureId: "f1",
                    properties: {
                        gal: ["https://example.invalid/one.jpg", "https://example.invalid/two.jpg"],
                    },
                    geometry: null,
                    lngLat: { lat: -48, lng: -58 },
                    point: { x: 10, y: 10 },
                },
                { layerId: "a11y-lightbox", fields: [{ field: "gal", type: "gallery" }] }
            );
        });

        await page.locator(".gl-poi-gallery__main img").click();
        const lightbox = page.locator(".gl-poi-lightbox-global");
        await expect(lightbox).toBeVisible({ timeout: 5000 });

        // The selector carries the role: if `role="dialog"` disappeared, this
        // test would no longer find its target and would redden — intended.
        // The old skip ALREADY aimed at this selector at a time when the role
        // was not set: it would have failed on its target even with the data
        // it was waiting for.
        const dialog = page.locator('[role="dialog"].gl-poi-lightbox-global');
        await expect(dialog).toBeVisible();

        const results = await scanComponent(page, '[role="dialog"].gl-poi-lightbox-global');
        expect(results.violations).toEqual([]);
    });
});
