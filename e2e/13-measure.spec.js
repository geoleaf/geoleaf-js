// @ts-check
// E2E: 13-measure (@geoleaf-plugins/measure) — deploy-core (port 8766), LAZY.
//
// Sprint S7 (plugin-validation). measure is registered LAZY in init.js
// (`registerLazy('measure')` + `registerLazyForAction('measure','measure')`):
// `GeoLeaf.Measure`, the floating menu and the lazy bundle only exist once the
// plugin is loaded (toolbar action, or `GeoLeaf.plugins.load('measure')`).
// `armMeasure()` reproduces that load; the boot-state test asserts the real lazy
// boundary (namespace + bundle absent before first use).
//
// DOM contract — packages/plugins/measure/src/floating-menu.ts:
//   - menu root        .gl-measure-root           (appended to the map container)
//   - menu dialog      .gl-measure-menu           (hidden: .gl-measure-menu--hidden)
//   - tool buttons     button.gl-measure-tool-btn[data-tool="distance|gps|rect|circle|polygon|annotation-tooltip"]
//   - active tool      .gl-measure-tool-btn--active
//   - unit cyclers     button.gl-measure-unit-btn[data-unit-type="dist|area"]
//   - clear / export   button.gl-measure-action-btn[data-action="clear|export"]
//
// Tools capture pointer events on the map canvas:
//   - distance / polygon: DOM-capture click/dblclick on the container (target === canvas)
//   - gps:      its own navigator.geolocation.watchPosition (independent of the
//               geoloc control) → a fake watchPosition drives it
// The drag-based surface tools (rect, circle) rely on MapLibre's own map mouse
// events (mousedown/mousemove/mouseup), which are NOT raised by Playwright's
// synthetic mouse input in headless — they are covered by unit tests
// (tool-rect.test.ts / tool-circle.test.ts); the e2e proves a surface measure via
// the polygon tool (DOM-capture), like distance. See CDC §Validation S7 (finding).
// The public API `startMeasure()` only sets the active-button state; the drawing
// handlers are wired by the menu's onToolSelect (a tool-button click) — so this
// spec drives tools through the menu buttons (see CDC §Validation S7, finding).
//
// NOTE: deploy-core ships a PWA service worker → serviceWorkers:'block' for
// deterministic chunk loading + fake-geolocation injection. Run after
// `npm run build:deploy:all`.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanComponent } from "./helpers/axe-config.js";

const MEASURE_CHUNK = /geoleaf-measure\.plugin\.js/;
const MENU_OPEN = ".gl-measure-menu:not(.gl-measure-menu--hidden)";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** Navigates, waits for the map, and returns the collected page errors. */
async function boot(page) {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    // Wait until the native MapLibre map is loaded (drawing relies on project/unproject).
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!m && typeof m.loaded === "function" && m.loaded();
        },
        null,
        { timeout: 15000 }
    );
    // The boot loader overlay intercepts pointer events until it clears.
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
    return errors;
}

/** Loads the lazy measure plugin (what the toolbar action does) and waits for its API. */
async function armMeasure(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("measure"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Measure) === "object",
        null,
        { timeout: 10000 }
    );
}

/**
 * Opens the floating menu via the real toolbar button. Passing the button element
 * makes openMeasureMenu() reposition the menu to the RIGHT of the map toolbar,
 * clear of the zoom buttons (a bare action event leaves it at the top-left default,
 * overlapping the toolbar). Falls back to the action event if the button is hidden.
 */
async function openMenu(page) {
    const tbtn = page.locator('[data-gl-toolbar-action="measure"]').first();
    if (await tbtn.isVisible().catch(() => false)) {
        await tbtn.click();
    } else {
        await page.evaluate(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "measure" } })
            )
        );
    }
    await expect(page.locator(MENU_OPEN)).toBeVisible({ timeout: 8000 });
}

/** Opens the menu and arms a tool via its menu button, returning once it is active. */
async function activateTool(page, tool) {
    await openMenu(page);
    const btn = page.locator(`button.gl-measure-tool-btn[data-tool="${tool}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(btn).toHaveClass(/gl-measure-tool-btn--active/, { timeout: 5000 });
    await page.waitForTimeout(300);
}

/** Returns the bounding box of the map canvas. */
async function canvasBox(page) {
    const cv = page.locator("#geoleaf-map canvas.maplibregl-canvas").first();
    await expect(cv).toBeVisible({ timeout: 10000 });
    const box = await cv.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");
    return box;
}

/** Absolute viewport point at fractional (fx,fy) inside the canvas. */
function at(box, fx, fy) {
    return { x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) };
}

function featureCount(page) {
    return page.evaluate(
        () => /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.length
    );
}

// ---------------------------------------------------------------------------

test.describe("[measure] lazy boundary & menu", () => {
    test("the namespace and the lazy bundle are both absent at boot", async ({ page }) => {
        await boot(page);
        const state = await page.evaluate(
            (re) => ({
                ns: typeof (/** @type {any} */ (window).GeoLeaf?.Measure),
                chunk: performance
                    .getEntriesByType("resource")
                    .some((e) => new RegExp(re).test(e.name)),
            }),
            MEASURE_CHUNK.source
        );
        expect(state.ns).toBe("undefined");
        expect(state.chunk).toBe(false);
    });

    test("the measure toolbar button is rendered at boot (lazy action)", async ({ page }) => {
        await boot(page);
        // registerLazyForAction shows the pill immediately; profileKey ui.showMeasure
        // is absent in tourism → defaultVisible (true).
        await expect(page.locator('[data-gl-toolbar-action="measure"]').first()).toBeVisible({
            timeout: 10000,
        });
    });

    test("loading the plugin fetches the bundle, mounts the API and renders the menu", async ({
        page,
    }) => {
        await boot(page);
        await armMeasure(page);

        const chunkLoaded = await page.evaluate(
            (re) =>
                performance.getEntriesByType("resource").some((e) => new RegExp(re).test(e.name)),
            MEASURE_CHUNK.source
        );
        expect(chunkLoaded).toBe(true);

        await openMenu(page);
        await expect(page.locator(".gl-measure-root")).toBeAttached();
        // At least the three tool groups (distance/gps, rect/circle/polygon, annotation).
        const tools = await page.locator("button.gl-measure-tool-btn[data-tool]").count();
        expect(tools).toBeGreaterThanOrEqual(4);
    });

    test("exposes the documented public API surface", async ({ page }) => {
        await boot(page);
        await armMeasure(page);
        const api = await page.evaluate(() => {
            const M = /** @type {any} */ (window).GeoLeaf.Measure;
            return [
                "startMeasure",
                "stopMeasure",
                "clearAll",
                "getCollection",
                "exportGeoJSON",
                "setUnits",
                "getUnits",
                "getPrintableAnnotations",
                "registerMeasureType",
            ].map((k) => typeof M[k]);
        });
        expect(api.every((t) => t === "function")).toBe(true);
    });
});

// ---------------------------------------------------------------------------

test.describe("[measure] tools (real pointer)", () => {
    test("distance: canvas clicks + dblclick commit a LineString measure", async ({ page }) => {
        const errors = await boot(page);
        await armMeasure(page);
        await activateTool(page, "distance");

        const box = await canvasBox(page);
        const p1 = at(box, 0.45, 0.4);
        const p2 = at(box, 0.6, 0.55);
        const p3 = at(box, 0.7, 0.45);
        await page.mouse.click(p1.x, p1.y);
        await page.mouse.click(p2.x, p2.y);
        await page.mouse.click(p3.x, p3.y);
        await page.mouse.dblclick(p3.x, p3.y);

        await expect
            .poll(
                () =>
                    page.evaluate(() =>
                        /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.some(
                            (f) => f.geometry?.type === "LineString"
                        )
                    ),
                { timeout: 8000 }
            )
            .toBe(true);

        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });

    test("polygon: canvas clicks + dblclick commit a Polygon surface measure", async ({ page }) => {
        await boot(page);
        await armMeasure(page);
        await activateTool(page, "polygon");

        const box = await canvasBox(page);
        const p1 = at(box, 0.4, 0.4);
        const p2 = at(box, 0.62, 0.42);
        const p3 = at(box, 0.6, 0.62);
        const p4 = at(box, 0.42, 0.6);
        await page.mouse.click(p1.x, p1.y);
        await page.mouse.click(p2.x, p2.y);
        await page.mouse.click(p3.x, p3.y);
        await page.mouse.dblclick(p4.x, p4.y);

        await expect
            .poll(
                () =>
                    page.evaluate(() =>
                        /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.some(
                            (f) => f.geometry?.type === "Polygon"
                        )
                    ),
                { timeout: 8000 }
            )
            .toBe(true);
    });

    test("gps: fake position fixes build a track that finishes as a feature", async ({ page }) => {
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window);
            const cbs = [];
            const fake = {
                watchPosition: (success) => {
                    cbs.push(success);
                    return 7;
                },
                clearWatch: () => {},
                getCurrentPosition: () => {},
            };
            Object.defineProperty(navigator, "geolocation", {
                value: fake,
                configurable: true,
            });
            w.__measGeoFire = (lng, lat, ts) =>
                cbs.forEach((cb) =>
                    cb({
                        coords: {
                            longitude: lng,
                            latitude: lat,
                            accuracy: 5,
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null,
                        },
                        timestamp: ts,
                    })
                );
        });

        await boot(page);
        await armMeasure(page);
        await activateTool(page, "gps");

        // Three fixes ~80 m apart, 10 s spacing (~8 m/s < gpsMaxJumpMps 25).
        const t0 = 1_700_000_000_000;
        await page.evaluate((t) => /** @type {any} */ (window).__measGeoFire(2.35, 48.85, t), t0);
        await page.evaluate(
            (t) => /** @type {any} */ (window).__measGeoFire(2.3508, 48.8505, t),
            t0 + 10_000
        );
        await page.evaluate(
            (t) => /** @type {any} */ (window).__measGeoFire(2.3516, 48.851, t),
            t0 + 20_000
        );

        // Stop the tool → finishSession commits the collected track (≥2 vertices).
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Measure.stopMeasure());

        await expect.poll(() => featureCount(page), { timeout: 8000 }).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------

test.describe("[measure] units, export, persistence, a11y", () => {
    test("setUnits / getUnits round-trip", async ({ page }) => {
        await boot(page);
        await armMeasure(page);
        const units = await page.evaluate(() => {
            const M = /** @type {any} */ (window).GeoLeaf.Measure;
            M.setUnits({ distance: "km", area: "ha" });
            return M.getUnits();
        });
        expect(units.distance).toBe("km");
        expect(units.area).toBe("ha");
    });

    test("exportGeoJSON returns a GeoJSON FeatureCollection Blob", async ({ page }) => {
        await boot(page);
        await armMeasure(page);
        const out = await page.evaluate(async () => {
            const blob = await /** @type {any} */ (window).GeoLeaf.Measure.exportGeoJSON({
                download: false,
            });
            const text = await blob.text();
            const parsed = JSON.parse(text);
            return {
                type: blob.type,
                fcType: parsed.type,
                isArray: Array.isArray(parsed.features),
            };
        });
        expect(out.type).toContain("geo+json");
        expect(out.fcType).toBe("FeatureCollection");
        expect(out.isArray).toBe(true);
    });

    test("persistence: a measure survives a page reload (localStorage)", async ({ page }) => {
        await boot(page);
        await armMeasure(page);
        await activateTool(page, "polygon");

        const box = await canvasBox(page);
        const p1 = at(box, 0.4, 0.4);
        const p2 = at(box, 0.62, 0.42);
        const p3 = at(box, 0.6, 0.62);
        const p4 = at(box, 0.42, 0.6);
        await page.mouse.click(p1.x, p1.y);
        await page.mouse.click(p2.x, p2.y);
        await page.mouse.click(p3.x, p3.y);
        await page.mouse.dblclick(p4.x, p4.y);

        await expect.poll(() => featureCount(page), { timeout: 8000 }).toBeGreaterThan(0);
        const before = await featureCount(page);

        // localStorage write is debounced (~300 ms) — let it flush before reload.
        await page.waitForTimeout(600);
        await page.reload();
        await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
        await armMeasure(page);
        // Restoration from localStorage runs in _ensureMenu() (on first menu open /
        // tool use), not on plugin load — open the menu to trigger it.
        await openMenu(page);

        await expect.poll(() => featureCount(page), { timeout: 8000 }).toBe(before);
    });

    test("the open measure menu passes a WCAG 2.1 AA axe scan", async ({ page }) => {
        const errors = await boot(page);
        await armMeasure(page);
        await openMenu(page);
        // Scope to the measure plugin surface — the core map-toolbar hover tooltip
        // (.gl-toolbar-tooltip, white-on-grey, aria-hidden) is a separate core issue,
        // out of scope for validating the measure plugin (see CDC §Validation S7).
        const results = await scanComponent(page, ".gl-measure-root");
        expect(results.violations).toEqual([]);
        expect(errors.filter((e) => !/favicon|chrome-extension/.test(e))).toHaveLength(0);
    });
});
