// @ts-check
// E2E: 04 — the core UI features that used to be "lazy modules"
//
// ⚠ REWRITTEN IN S5 (presets chantier). The lazy machinery is GONE — `src/lazy/`,
// `app/lazy-module-loader.ts`, `GeoLeaf._loadModule`, `GeoLeaf._loadAllSecondaryModules`.
//
// The history in one paragraph: every capability anchors itself through
// `capabilities/<cap>/install.ts` (S2), so its code is in the eager closure. That made the
// `lazy/*` files re-export shells loading nothing new — S4 deleted three of them, S5 the last
// two. Rollup had been saying so out loud ("Generated empty chunks: lazy/basemap-selector,
// lazy/layer-manager"): the boot was firing a dynamic import for an EMPTY file on every page
// load, and awaiting it in UIModule.
//
// So this file no longer tests a loading mechanism — there is none. It tests that the FEATURES
// still render, which is what a user cares about, plus one guard that the dead API stays dead.
//
// Port 8766 (deploy-core) — profile tourism: showLayerManager, showLegend,
// showThemeSelector all true.
//
// DOM signatures verified against packages/core/src/ source.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

test.use({ baseURL: baseURL("core") });

// Shared setup: navigate and wait for map to be visible
test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guard: the lazy API must stay dead
// ─────────────────────────────────────────────────────────────────────────────

test("[purge] the lazy-loading API is gone from the GeoLeaf namespace", async ({ page }) => {
    // Anti-resurrection guard (S5, BREAKING). These two were the public face of a mechanism
    // that had stopped mechanising anything. If either comes back, someone has re-added a
    // second composition root — the exact thing that let excluded capabilities sit in the
    // shipped payload while `npm run size` reported them gone.
    const surface = await page.evaluate(() => ({
        loadModule: typeof window.GeoLeaf._loadModule,
        loadAll: typeof window.GeoLeaf._loadAllSecondaryModules,
        ensure: typeof window.GeoLeaf._app?._ensureModule,
    }));
    expect(surface).toEqual({
        loadModule: "undefined",
        loadAll: "undefined",
        ensure: "undefined",
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The features — all eager now, all must still render
// ─────────────────────────────────────────────────────────────────────────────

test("[layer-manager] gl-layer-manager control is present in DOM", async ({ page }) => {
    // kernel — profile.ui.showLayerManager: true
    // control.ts creates .gl-layer-manager at init, collapsed by default
    await expect(page.locator(".gl-layer-manager")).toBeAttached({ timeout: 5000 });
});

test("[basemap-selector] basemap select section is in layer manager DOM", async ({ page }) => {
    // kernel — 4 basemaps in profile
    // basemap-selector.ts injects .gl-layer-manager__basemap-select into the layer manager
    // element is present even when the "basemap" section is collapsed
    await expect(page.locator(".gl-layer-manager__basemap-select")).toBeAttached({ timeout: 8000 });
});

test("[legend] gl-map-legend control is present in DOM", async ({ page }) => {
    // capability `legend` (via capabilities/legend/install.ts) — profile.ui.showLegend
    // legend-control.ts creates the .gl-map-legend control
    //
    // ⚠️ MEASURED UNDER `taskset -c 0,1` on 2026-08-19 — two cores, a harder
    // floor than the remote runner's 4. The control attaches in
    // **1,669 · 1,671 · 2,042 ms** over three runs: margin ≈ 2.4× under the
    // 5,000 ms budget.
    //
    // 🔻 This budget had been reported as EXPIRING under this same
    // constraint, which made this test one of the two named instances of a
    // "green on 16 cores, red on 4" line. **The symptom no longer
    // reproduces** — neither here nor on the runner, where it was already
    // green. The class does exist: it simply has other instances, measured
    // elsewhere. Do not tighten this budget onto today's margin: it is
    // measured cold on TWO cores, not on the slowest possible machine.
    await expect(page.locator(".gl-map-legend")).toBeAttached({ timeout: 5000 });
});

test("[themes] at least one primary theme button is visible", async ({ page }) => {
    // capability `theme-selector` (via capabilities/theme-selector/install.ts)
    // ThemeSelector.init() populates #gl-theme-primary-container with .gl-theme-btn after
    // GeoJSON layer configs are fetched — allow up to 15 s for async profile load
    await expect(page.locator(".gl-theme-btn").first()).toBeVisible({ timeout: 15000 });
});

test("[labels] label toggle button present for at least one layer", async ({ page }) => {
    // capability `labels` (via capabilities/labels/install.ts)
    // label-button-manager.ts injects .gl-layer-manager__label-toggle into each layer item
    // after GeoJSON layer configs are loaded (~3-10 s)
    await expect(page.locator(".gl-layer-manager__label-toggle").first()).toBeAttached({
        timeout: 15000,
    });
});

test("[a11y] page passes WCAG 2.1 AA axe scan once the capabilities have mounted", async ({
    page,
}) => {
    // The eager capabilities mount on geoleaf:app:ready; give them time to attach their DOM.
    await page.waitForTimeout(3000);
    const results = await scanPage(page);
    expect(results.violations).toEqual([]);
});
