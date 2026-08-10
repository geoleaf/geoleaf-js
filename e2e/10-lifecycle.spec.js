// @ts-check
// Sprint S5 — E2E: lifecycle create → destroy → recreate
//
// Validates the lifecycle teardown seam (Core.destroy → runLifecycleTeardowns,
// map/index.ts:209-211) in a real Chromium + MapLibre GL context. The exact
// shared-store invariants (POIShared/GeoJSONShared/LMShared/ProfileManager reset
// to empty) are pinned by the unit oracle:
//   packages/core/__tests__/app/lifecycle-create-destroy-recreate.test.js
// This E2E confirms the BROWSER-LEVEL outcome the oracle cannot see:
//   - clean teardown: the MapLibre canvas and POI markers are removed, slot freed;
//   - clean recreate: exactly one functional map mounts (no visual doubling);
//   - stability: repeated destroy → recreate does not accumulate canvases/markers;
//   - indicative heap snapshot (Chromium-only, logged — no hard gate).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

const MAP_SELECTOR = "#geoleaf-map";
const CANVAS_SELECTOR = "#geoleaf-map .maplibregl-canvas";
const MARKER_SELECTOR = ".maplibregl-marker";
const MAP_TIMEOUT = 20_000;

/** Boot the page and wait for the GeoLeaf map to be fully initialized. */
async function waitForMap(page) {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(MAP_SELECTOR).waitFor({ state: "visible", timeout: MAP_TIMEOUT });
    await page.waitForFunction(
        () => {
            try {
                const a = window.GeoLeaf && window.GeoLeaf.Core && window.GeoLeaf.Core.getMap();
                return a && a.getNativeMap && a.getNativeMap() !== null;
            } catch {
                return false;
            }
        },
        null,
        { timeout: MAP_TIMEOUT }
    );
}

/** Reads the active map id + its current center/zoom (used to recreate identically). */
async function readMapState(page) {
    return page.evaluate(() => {
        const ids = window.GeoLeaf.Core.listMaps();
        const id = ids[0];
        const native = window.GeoLeaf.Core.getMap().getNativeMap();
        const c = native.getCenter();
        return { id, center: [c.lat, c.lng], zoom: native.getZoom() };
    });
}

/** Current used JS heap in MB (Chromium only; 0 when unavailable). */
async function heapMb(page) {
    return page.evaluate(() =>
        performance.memory
            ? Math.round((performance.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
            : 0
    );
}

// Served from deploy-core (port 8766). MapLibre needs a WebGL context; on a
// GPU-less host (CI/WSL) the software-GL launchOptions come from the shared
// config (use.launchOptions, sourced from e2e/helpers/launch-options.js).
test.use({ baseURL: baseURL("core") });

test.describe("10-lifecycle — create → destroy → recreate", () => {
    test("destroy() frees the registry slot and clears the map from the DOM", async ({ page }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await waitForMap(page);

        // Snapshot the booted state.
        const { id } = await readMapState(page);
        expect(id).toBeTruthy();
        expect(await page.evaluate(() => window.GeoLeaf.Core.listMaps())).toEqual([id]);
        expect(await page.locator(CANVAS_SELECTOR).count()).toBe(1);

        // Destroy the last (only) map → lifecycle seam tears the shared state down.
        const destroyed = await page.evaluate((mapId) => window.GeoLeaf.Core.destroy(mapId), id);
        expect(destroyed).toBe(true);

        // Registry slot freed.
        expect(await page.evaluate(() => window.GeoLeaf.Core.listMaps())).toEqual([]);
        // MapLibre canvas removed (map.remove()) and any POI markers gone.
        await page.waitForFunction(
            (sel) => document.querySelectorAll(sel).length === 0,
            CANVAS_SELECTOR,
            { timeout: MAP_TIMEOUT }
        );
        expect(await page.locator(CANVAS_SELECTOR).count()).toBe(0);
        expect(await page.locator(MARKER_SELECTOR).count()).toBe(0);

        expect(pageErrors, `uncaught errors during destroy: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("recreate after destroy mounts exactly one functional map (no doubling)", async ({
        page,
    }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await waitForMap(page);
        const state = await readMapState(page);

        // destroy → recreate with the same id and viewport.
        await page.evaluate((mapId) => window.GeoLeaf.Core.destroy(mapId), state.id);
        const recreated = await page.evaluate(
            (s) => !!window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
            state
        );
        expect(recreated).toBe(true);

        // Exactly one map registered, exactly one canvas mounted (no stacking).
        expect(await page.evaluate(() => window.GeoLeaf.Core.listMaps())).toEqual([state.id]);
        await page.waitForFunction(
            (sel) => document.querySelectorAll(sel).length === 1,
            CANVAS_SELECTOR,
            { timeout: MAP_TIMEOUT }
        );
        expect(await page.locator(CANVAS_SELECTOR).count()).toBe(1);

        // The recreated map is functional (native map reachable).
        const usable = await page.evaluate(() => {
            const a = window.GeoLeaf.Core.getMap();
            return !!(a && a.getNativeMap && a.getNativeMap());
        });
        expect(usable).toBe(true);

        expect(pageErrors, `uncaught errors during recreate: ${pageErrors.join(" | ")}`).toEqual(
            []
        );
    });

    test("repeated destroy → recreate does not accumulate canvases or markers", async ({
        page,
    }) => {
        test.setTimeout(60_000);
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await waitForMap(page);
        const state = await readMapState(page);
        const heapStart = await heapMb(page);

        const CYCLES = 3;
        for (let i = 1; i <= CYCLES; i++) {
            await page.evaluate((mapId) => window.GeoLeaf.Core.destroy(mapId), state.id);
            await page.waitForFunction(
                (sel) => document.querySelectorAll(sel).length === 0,
                CANVAS_SELECTOR,
                { timeout: MAP_TIMEOUT }
            );

            await page.evaluate(
                (s) => window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
                state
            );
            await page.waitForFunction(
                (sel) => document.querySelectorAll(sel).length === 1,
                CANVAS_SELECTOR,
                { timeout: MAP_TIMEOUT }
            );

            // Invariant across every cycle: a single canvas, a single registered map,
            // and no residual markers carried over from a previous instance.
            expect(await page.locator(CANVAS_SELECTOR).count(), `cycle ${i}: canvas count`).toBe(1);
            expect(
                await page.evaluate(() => window.GeoLeaf.Core.listMaps()),
                `cycle ${i}: listMaps`
            ).toEqual([state.id]);
            expect(
                await page.locator(MARKER_SELECTOR).count(),
                `cycle ${i}: residual markers`
            ).toBe(0);
        }

        // Indicative heap snapshot — Chromium-only, logged, NO hard gate (GC is
        // non-deterministic without --expose-gc; a real leak shows as steady growth).
        const heapEnd = await heapMb(page);
        if (heapStart || heapEnd) {
            console.info(
                `[lifecycle] heap: start=${heapStart}MB, after ${CYCLES} cycles=${heapEnd}MB, delta=${Math.round((heapEnd - heapStart) * 10) / 10}MB (indicative)`
            );
        } else {
            console.info("[lifecycle] heap: performance.memory not available");
        }

        expect(pageErrors, `uncaught errors during cycles: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("[a11y] page passes WCAG 2.1 AA after a destroy → recreate cycle", async ({ page }) => {
        await waitForMap(page);
        const state = await readMapState(page);

        await page.evaluate((mapId) => window.GeoLeaf.Core.destroy(mapId), state.id);
        await page.evaluate(
            (s) => window.GeoLeaf.Core.init({ mapId: s.id, center: s.center, zoom: s.zoom }),
            state
        );
        await page.waitForFunction(
            (sel) => document.querySelectorAll(sel).length === 1,
            CANVAS_SELECTOR,
            { timeout: MAP_TIMEOUT }
        );

        const results = await scanPage(page);
        expect(results.violations).toEqual([]);
    });
});
