// @ts-check
// E2E [touch]: the drag-based measure tools (circle, rect) must work with a finger.
// deploy-core (8766).
//
// 🛑 TWO LOCKS, CUMULATIVE — and neither is visible to a synthetic mouse.
//
// `createDragTool` (packages/plugins/measure/src/tools/tool-shared.ts) drives both tools
// from `map.on("mousedown")` → `map.on("mousemove")` → a one-shot `mouseup` on document.
// A finger drag emits NO compatibility mouse events at all, and even if one arrived, the
// `e.originalEvent?.button !== 0` guard rejects it — `undefined !== 0` is true. The type
// says as much: `MeasureMapMouseEvent.originalEvent` was declared `MouseEvent`.
//
// The second half of the report is a separate defect: nothing marks WHERE the finger
// landed. `gl-measure-vertices` exists and is styled, but `createDragTool` never called
// `updateVertices` — so the anchor was missing under the mouse too. Below 1 m of radius
// (circle) or 2 points (rect) the preview draws nothing either, so the user had no
// feedback whatsoever until the gesture was already large.
//
// ⚠️ The anchor is asserted MID-GESTURE, in its own test. On release the tool clears its
// preview, so a completed drag cannot observe it — and it is a capability the fix ADDS,
// not a regression it restores. Mixing it with the commit assertion would mix two reds of
// different natures.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { touchDrag, touchDragInspect } from "./helpers/touch.js";

const MENU_OPEN = ".gl-measure-menu:not(.gl-measure-menu--hidden)";

test.use({ baseURL: baseURL("core"), serviceWorkers: "block" });

/** Navigates and waits until the native map is loaded (drag relies on project/unproject). */
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

/** Loads the lazy measure plugin (what the toolbar action does) and waits for its API. */
async function armMeasure(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("measure"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Measure) === "object",
        null,
        { timeout: 10000 }
    );
}

/** Opens the floating menu via the real toolbar button, falling back to the action event. */
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

/** Opens the menu and arms a tool via its menu button, returning once it is active. */
async function activateTool(page, tool) {
    await openMenu(page);
    const btn = page.locator(`button.gl-measure-tool-btn[data-tool="${tool}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.tap();
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

/** True once the collection holds at least one feature of that measure type. */
function hasMeasure(page, type) {
    return page.evaluate(
        (t) =>
            /** @type {any} */ (window).GeoLeaf.Measure.getCollection().features.some(
                (f) => f.properties?.measureType === t
            ),
        type
    );
}

/** Feature count of a measure source. -1 = not measurable, which is not the same as empty. */
function srcCount(page, id) {
    return page.evaluate(async (sid) => {
        const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
        let src;
        try {
            src = native?.getSource?.(sid);
        } catch {
            return -1;
        }
        if (!src || typeof src.getData !== "function") return -1;
        const fc = await src.getData();
        return (fc?.features ?? []).length;
    }, id);
}

test.beforeEach(async ({ page }) => {
    await boot(page);
    await armMeasure(page);
});

// Both tools share `createDragTool`, but their validity thresholds differ — metres for the
// circle, screen pixels for the rect — so a touch path that mis-feeds one can still satisfy
// the other. Covering only one would leave half the fix unguarded.
for (const tool of ["circle", "rect"]) {
    test(`[touch][measure] ${tool} — a one-finger drag commits a measure`, async ({ page }) => {
        await activateTool(page, tool);
        const box = await canvasBox(page);

        // WITNESS: nothing of this type exists yet, so the assertion below cannot pass on
        // a leftover from another tool or from the profile.
        expect(await hasMeasure(page, tool)).toBe(false);

        await touchDrag(page, at(box, 0.35, 0.35), at(box, 0.65, 0.6));

        await expect.poll(() => hasMeasure(page, tool), { timeout: 8000 }).toBe(true);
    });
}

test("[touch][measure] the anchor is visible while the gesture is still in progress", async ({
    page,
}) => {
    await activateTool(page, "circle");
    const box = await canvasBox(page);

    expect(await srcCount(page, "gl-measure-vertices")).toBe(0);

    let midGesture = -1;
    await touchDragInspect(page, at(box, 0.35, 0.35), at(box, 0.65, 0.6), async () => {
        midGesture = await srcCount(page, "gl-measure-vertices");
    });

    // The whole point of the report: the user could not tell where they had
    // tapped. The anchor must be painted from the press, before the gesture
    // is large enough to draw anything else.
    expect(midGesture).toBeGreaterThan(0);

    // ...and it must not linger once the gesture is over.
    await expect.poll(() => srcCount(page, "gl-measure-vertices"), { timeout: 5000 }).toBe(0);
});
