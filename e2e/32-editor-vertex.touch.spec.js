// @ts-check
// E2E [touch]: the first tapped vertex must be VISIBLE — editor line / polyline / polygon.
// deploy-full (8768), the only variant bundling the editor.
//
// 🛑 THIS DEFECT CANNOT BE SEEN WITH A MOUSE, and that is why it reached the public demo.
//
// Terra Draw's `createLine()` seeds a LineString with the SAME coordinate twice
// (`[c, c]`) — the second one is the "live" vertex that a hover moves. A polygon gets
// four identical coordinates. Both are degenerate: zero length, zero area, MapLibre
// paints nothing. The closing point that IS painted is only created on the second click.
//
// On a desktop the defect is invisible because `pointermove` immediately drags that live
// vertex, so a rubber band appears and shows where the first point landed. A finger emits
// no `pointermove` between two taps, so nothing is ever drawn — the user taps and the map
// stays blank, then the second tap makes a segment appear out of nowhere.
//
// The fix is `showCoordinatePoints: true` on the three accumulating modes
// (`packages/plugins/editor/src/drawing/modes.ts`). The `coordinatePoint*` styles it needs
// already exist in `drawing/styles.ts` and have never had any effect.
//
// Assertion target: source `td-point`. Terra Draw's MapLibre adapter pushes every Point
// feature there — vertices, closing points, snapping points — under the default `td`
// prefix (the editor builds the adapter without `prefixId`).
//
// ⚠️ Read through `getSource(id).getData()`, NOT `._data`: under MapLibre 6 `setData`
// stores `{ geojson: data }`, so `_data` is no longer a FeatureCollection. `getData()`
// resolves locally when the data is inline, so it introduces no worker round-trip.

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";

test.use({ baseURL: baseURL("full") });

/** Number of Point features Terra Draw currently renders. -1 = not measurable. */
function tdPointCount(page) {
    return page.evaluate(async () => {
        const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
        let src;
        try {
            src = native?.getSource?.("td-point");
        } catch {
            return -1;
        }
        // -1 and 0 must stay distinguishable: "cannot measure" is not "measured empty".
        // Without that, a broken probe would read as a passing witness.
        if (!src || typeof src.getData !== "function") return -1;
        const fc = await src.getData();
        return (fc?.features ?? []).length;
    });
}

/** Loads the lazy editor plugin (what the toolbar action does) and waits for its API. */
async function armEditor(page) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.plugins.load("editor"));
    await page.waitForFunction(
        () => typeof (/** @type {any} */ (window).GeoLeaf?.Editor) === "object",
        null,
        { timeout: 10000 }
    );
}

/**
 * Opens the menu and arms one drawing tool, returning once Terra Draw is really listening.
 *
 * The `td-point` layer is the deterministic gate: it is added by the adapter's
 * `register()`, reached from `adapter.start()`, so its presence proves the pending
 * `setMode()` is one microtask away. A fixed sleep here is a race — a tap that lands
 * before `setMode()` is swallowed and no feature is ever created.
 */
async function activateTool(page, tool) {
    await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.Editor.toggleMenu());
    const btn = page.locator(`button.gl-editor-tool-btn[data-tool="${tool}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.tap();
    await expect(btn).toHaveClass(/gl-editor-tool-btn--active/, { timeout: 8000 });
    await page.waitForFunction(
        () => {
            const native = /** @type {any} */ (window).GeoLeaf?.Core?.getMap?.()?.getNativeMap?.();
            try {
                return !!native?.getLayer?.("td-point");
            } catch {
                return false;
            }
        },
        null,
        { timeout: 15000 }
    );
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

test.beforeEach(async ({ page }) => {
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
    await armEditor(page);
});

// The three modes that accumulate vertices. `point` is excluded on purpose: a point is
// already a painted circle from the first tap, it never had this defect. All three are
// covered because `modes.ts` has THREE call sites to fix — a partial fix must stay red.
for (const tool of ["line", "polyline", "polygon"]) {
    test(`[touch][editor] ${tool} — the first tapped vertex is rendered`, async ({ page }) => {
        await activateTool(page, tool);
        const box = await canvasBox(page);

        // WITNESS. Without it a "> 0" would also pass on a map that already carried points,
        // and would prove nothing about what the first tap does.
        expect(await tdPointCount(page)).toBe(0);

        await page.touchscreen.tap(at(box, 0.5, 0.45).x, at(box, 0.5, 0.45).y);

        // Assert "> 0", never an equality: `[c, c]` yields two coincident coordinate points
        // for a line, and the polygon ring drops its closing coordinate, so the exact count
        // differs per geometry and is not the contract.
        await expect.poll(() => tdPointCount(page), { timeout: 5000 }).toBeGreaterThan(0);
    });
}

test("[touch][editor] the rendered vertex is a coordinate point of the armed mode", async ({
    page,
}) => {
    await activateTool(page, "line");
    const box = await canvasBox(page);
    expect(await tdPointCount(page)).toBe(0);

    await page.touchscreen.tap(at(box, 0.5, 0.45).x, at(box, 0.5, 0.45).y);
    await expect.poll(() => tdPointCount(page), { timeout: 5000 }).toBeGreaterThan(0);

    // Names the mechanism rather than counting it: Terra Draw tags guidance points with
    // `coordinatePoint: true` and the owning mode. Asserting the tag is what distinguishes
    // "a vertex is drawn" from "some unrelated Point happens to be in the source".
    const kinds = await page.evaluate(async () => {
        const src = /** @type {any} */ (window).GeoLeaf.Core.getMap()
            .getNativeMap()
            .getSource("td-point");
        const fc = await src.getData();
        return (fc?.features ?? []).map((f) => ({
            mode: f.properties?.mode,
            cp: f.properties?.coordinatePoint === true,
        }));
    });
    expect(kinds.some((k) => k.cp && k.mode === "line")).toBe(true);
});
