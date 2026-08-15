// @ts-check
// E2E [touch]: closing a measurement with a finger — distance vs polygon.
// deploy-core (8766).
//
// 🛑 THIS FILE STARTED AS A MEASUREMENT, NOT AS A FIX.
//
// The claim under test was an INFERENCE: "the distance tool closes on `dblclick` or the
// space bar, neither of which a finger has". Plausible — but mobile browsers do synthesise
// `dblclick` from a double-tap under some conditions, and the tool already disarms
// `doubleClickZoom`, which is one of the conditions that usually gets in the way. An
// inference is not a measurement, and a fix built on one is a fix without an object.
//
// The asymmetry that motivated the question IS measured, and it is real:
//   · polygon  — `_isSnapping(coord)` on the first vertex closes the ring, from a plain
//                `click`. A finger has that. (`tools/tool-polygon.ts`)
//   · distance — `_onDblClick` or `_onKeyDown` (space) only. (`tools/tool-distance.ts`)
//
// So the polygon test below is a WITNESS: it must pass whatever the verdict, and it proves
// the harness can close a measurement at all. If it failed, a red on the distance test
// would say nothing about `dblclick`.
//
// ✅ VERDICT (14/08/2026): THE INFERENCE WAS WRONG. Both tests passed on the FIRST run,
// with no product change whatsoever — Chromium does synthesise `dblclick` from a
// double-tap here, and `_onDblClick` closes the measurement normally. The planned "add a
// touch closing gesture to the distance tool" was a fix without an object, and it was not
// written. This file stays as the guard that keeps the property true.
//
// ⚠️ WHAT THIS DOES **NOT** PROVE. It is measured under Chromium's touch EMULATION. On a
// real handset the browser's own double-tap-to-zoom can claim the gesture before
// `dblclick` is ever synthesised, and that depends on the effective `touch-action` of the
// map container — which MapLibre sets on `.maplibregl-canvas-container` and which this
// suite does not vary. Treat a report of "I cannot close a distance measurement on my
// phone" as a NEW measurement, not as a regression of this test.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

const MENU_OPEN = ".gl-measure-menu:not(.gl-measure-menu--hidden)";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

async function boot(page) {
    await page.goto("/");
    await expect(page.locator("#geoleaf-map")).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(
        () => {
            const m = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            return !!m && typeof m.loaded === "function" && m.loaded();
        },
        null,
        { timeout: 15000 }
    );
    await page
        .locator("#gl-loader")
        .waitFor({ state: "hidden", timeout: 10000 })
        .catch(() => {});
}

async function armMeasure(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("measure"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Measure) === "object",
        null,
        { timeout: 10000 }
    );
}

async function openMenu(page) {
    const tbtn = page.locator('[data-gl-toolbar-action="measure"]').first();
    if (await tbtn.isVisible().catch(() => false)) {
        await tbtn.tap();
    } else {
        await page.evaluate(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:toolbar:action", { detail: { action: "measure" } })
            )
        );
    }
    await expect(page.locator(MENU_OPEN)).toBeVisible({ timeout: 8000 });
}

async function activateTool(page, tool) {
    await openMenu(page);
    const btn = page.locator(`button.gl-measure-tool-btn[data-tool="${tool}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.tap();
    await expect(btn).toHaveClass(/gl-measure-tool-btn--active/, { timeout: 5000 });
    await page.waitForTimeout(300);
}

async function canvasBox(page) {
    const cv = page.locator("#geoleaf-map canvas.maplibregl-canvas").first();
    await expect(cv).toBeVisible({ timeout: 10000 });
    const box = await cv.boundingBox();
    if (!box) throw new Error("canvas has no bounding box");
    return box;
}

function at(box, fx, fy) {
    return { x: Math.round(box.x + fx * box.width), y: Math.round(box.y + fy * box.height) };
}

function hasMeasure(page, type) {
    return page.evaluate(
        (t) =>
            /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.some(
                (f) => f.properties?.measureType === t
            ),
        type
    );
}

test.beforeEach(async ({ page }) => {
    await boot(page);
    await armMeasure(page);
});

test("[touch][measure] WITNESS — a polygon closes by tapping its first vertex", async ({
    page,
}) => {
    await activateTool(page, "polygon");
    const box = await canvasBox(page);
    const first = at(box, 0.35, 0.35);

    await page.touchscreen.tap(first.x, first.y);
    await page.touchscreen.tap(at(box, 0.65, 0.35).x, at(box, 0.65, 0.35).y);
    await page.touchscreen.tap(at(box, 0.65, 0.65).x, at(box, 0.65, 0.65).y);
    // Closing gesture: tap the first vertex again — `_isSnapping` picks it up.
    await page.touchscreen.tap(first.x, first.y);

    await expect.poll(() => hasMeasure(page, "polygon"), { timeout: 8000 }).toBe(true);
});

test("[touch][measure] a distance measurement can be closed with a finger", async ({ page }) => {
    await activateTool(page, "distance");
    const box = await canvasBox(page);
    const last = at(box, 0.65, 0.6);

    await page.touchscreen.tap(at(box, 0.35, 0.35).x, at(box, 0.35, 0.35).y);
    await page.touchscreen.tap(last.x, last.y);

    // Double-tap on the last vertex. Under the pre-fix code this only ever closed if the
    // browser synthesised a `dblclick` — which is precisely what this file was written to
    // measure rather than assume.
    await page.touchscreen.tap(last.x, last.y);
    await page.touchscreen.tap(last.x, last.y);

    await expect.poll(() => hasMeasure(page, "distance"), { timeout: 8000 }).toBe(true);
});
