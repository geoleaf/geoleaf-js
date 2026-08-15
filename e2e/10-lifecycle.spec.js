// @ts-check
// E2E: lifecycle create → destroy → recreate
//
// Validates the lifecycle teardown seam (Core.destroy → runLifecycleTeardowns,
// map/index.ts:209-211) in a real Chromium + MapLibre GL context. The exact
// shared-store invariants (POIShared/GeoJSONShared/LMShared/ProfileManager reset
// to empty) are pinned by the unit oracle:
//   packages/core/__tests__/app/lifecycle-create-destroy-recreate.test.js
// This E2E confirms the BROWSER-LEVEL outcome the oracle cannot see:
//   - clean teardown: the MapLibre canvas and POI markers are removed, slot freed;
//   - clean recreate: exactly one functional map mounts (no visual doubling);
//   - stability: ten destroy → recreate cycles accumulate no canvas, no marker,
//     no `#gl-right-panel` orphan and NO LISTENER (S6.2 — the CDC asks for a
//     "tested guarantee that destroy() leaves no listener, reference or residual
//     state", and counting canvases alone never gave it);
//   - indicative heap snapshot (Chromium-only, logged — no hard gate).

import { test, expect } from "@playwright/test";
import { baseURL } from "./helpers/base-url.js";
import { scanPage } from "./helpers/axe-config.js";

const MAP_SELECTOR = "#geoleaf-map";
const CANVAS_SELECTOR = "#geoleaf-map .maplibregl-canvas";
const MARKER_SELECTOR = ".maplibregl-marker";
const PANEL_SELECTOR = "#gl-right-panel";
const MAP_TIMEOUT = 20_000;

/**
 * Installs a live-listener probe before any page script runs.
 *
 * DevTools' `getEventListeners()` is not reachable from page context, so the only
 * way to observe listener accumulation is to wrap the prototype methods ourselves.
 * A naive +1/-1 counter is NOT enough: a defensive `removeEventListener()` for a
 * handler that was never added would decrement and mask a real leak. So we key on
 * (target, type, handler, capture) and hold a Map of live keys — `remove` on an
 * unknown key is then a no-op, exactly as it is in the DOM.
 *
 * ⚠️ ONLY LISTENERS ON *ATTACHED* TARGETS COUNT, and that is a measured correction,
 * not a convenience. Counting every registration made this probe go RED on a
 * non-defect: MapLibre's `Map._setupPainter()` binds `webglcontextcreationerror` to
 * its `<canvas>` and never unbinds it, so each cycle left one more handler behind —
 * on a canvas that `map.remove()` had already detached. A handler on a node no
 * longer in the document is unreachable and GC-collectable; it is not residual
 * state. Keeping it in the count would have forced a baseline stamp over a
 * third-party non-bug — the exact move this repo treats as a gate that stops
 * guarding. `WeakRef` is what lets us ask the question without retaining the node.
 */
async function installListenerProbe(page) {
    await page.addInitScript(() => {
        const proto = EventTarget.prototype;
        const add = proto.addEventListener;
        const remove = proto.removeEventListener;
        const ids = new WeakMap();
        const live = new Map();
        let next = 1;
        const idOf = (o) => {
            if (o === null || (typeof o !== "object" && typeof o !== "function")) return String(o);
            let id = ids.get(o);
            if (!id) ids.set(o, (id = next++));
            return id;
        };
        const keyOf = (target, type, handler, opts) =>
            `${idOf(target)}|${type}|${idOf(handler)}|${
                (typeof opts === "object" && opts !== null ? opts.capture : opts) ? 1 : 0
            }`;
        proto.addEventListener = function (type, handler, opts) {
            live.set(keyOf(this, type, handler, opts), new WeakRef(this));
            return add.call(this, type, handler, opts);
        };
        proto.removeEventListener = function (type, handler, opts) {
            live.delete(keyOf(this, type, handler, opts));
            return remove.call(this, type, handler, opts);
        };
        Object.defineProperty(window, "__glLiveListeners", {
            get: () => {
                let n = 0;
                for (const [key, ref] of live) {
                    const t = ref.deref();
                    if (t === undefined) {
                        live.delete(key); // target collected — nothing residual left
                    } else if (t === window || t === document || t.isConnected !== false) {
                        n++;
                    }
                }
                return n;
            },
        });
    });
}

/** Current number of live DOM listeners, as seen by the probe above. */
async function liveListeners(page) {
    return page.evaluate(() => window.__glLiveListeners);
}

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
    // B-205 / S6.3 — the top-level shortcuts and the Core façade read ONE registry.
    // Only an E2E can see this: it takes a real boot for the discrepancy to exist at
    // all (the mirror was filled by `GeoLeaf.createMap()`, which the boot never calls),
    // so every unit oracle saw two empty maps agreeing.
    test("GeoLeaf.getMap/getAllMaps and Core.getMap/listMaps read the same registry", async ({
        page,
    }) => {
        await waitForMap(page);
        const { id } = await readMapState(page);

        const agree = await page.evaluate((mapId) => {
            const G = window.GeoLeaf;
            return {
                topLevel: G.getMap(mapId),
                core: G.Core.getMap(mapId),
                same: G.getMap(mapId) === G.Core.getMap(mapId),
                topCount: G.getAllMaps().length,
                coreCount: G.Core.listMaps().length,
            };
        }, id);

        // Before S6.3 `topLevel` was null and `topCount` 0 for a live, booted map.
        expect(agree.topLevel, "GeoLeaf.getMap returned nothing for a live map").toBeTruthy();
        expect(agree.core, "GeoLeaf.Core.getMap returned nothing for a live map").toBeTruthy();
        expect(agree.same, "the two registries handed back different objects").toBe(true);
        expect(agree.topCount, "GeoLeaf.getAllMaps() count").toBe(agree.coreCount);
        expect(agree.coreCount).toBe(1);
    });

    // S6.4/6.5/6.6 — moving a live map instead of destroying and rebuilding it.
    test("reattach() moves the live map and the canvas takes the new parent's size", async ({
        page,
    }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await waitForMap(page);
        const { id } = await readMapState(page);

        const result = await page.evaluate((mapId) => {
            const G = window.GeoLeaf;
            const before = {
                attached: G.Core.isAttached(mapId),
                canvasWidth: document.querySelector("#geoleaf-map .maplibregl-canvas").clientWidth,
            };

            // A slot of DELIBERATELY different width. Without `resize()` the WebGL
            // drawing buffer keeps the size it was built with, so the canvas would stay
            // at `before.canvasWidth` inside a container that is no longer that wide —
            // which is the whole point of asserting dimensions and not just parentage.
            const slot = document.createElement("div");
            slot.id = "reattach-slot";
            slot.style.cssText = "width:400px;height:300px;position:relative;";
            document.body.appendChild(slot);

            const moved = G.Core.reattach(mapId, slot);
            const container = G.Core.getMap(mapId).getContainer();
            const canvas = document.querySelector("#geoleaf-map .maplibregl-canvas");
            return {
                before,
                moved,
                inSlot: container.parentElement === slot,
                stillAttached: G.Core.isAttached(mapId),
                stillRegistered: G.Core.listMaps().includes(mapId),
                containerWidth: container.clientWidth,
                canvasWidth: canvas.clientWidth,
                canvasCount: document.querySelectorAll("#geoleaf-map .maplibregl-canvas").length,
            };
        }, id);

        expect(result.before.attached, "the booted map should read as attached").toBe(true);
        expect(result.moved, "reattach() returned false").toBe(true);
        expect(result.inSlot, "the container did not end up in the new parent").toBe(true);
        expect(result.stillAttached).toBe(true);
        expect(result.stillRegistered, "the map left the registry while being moved").toBe(true);
        // Moved, not rebuilt: exactly one canvas, and it is the same one.
        expect(result.canvasCount, "the map was rebuilt rather than moved").toBe(1);
        // The engine re-read its container. `resize()` removed → this is what goes red.
        expect(
            Math.abs(result.canvasWidth - result.containerWidth),
            `canvas ${result.canvasWidth}px vs container ${result.containerWidth}px — resize() did not happen`
        ).toBeLessThanOrEqual(1);
        expect(result.canvasWidth, "the canvas kept its pre-move width").not.toBe(
            result.before.canvasWidth
        );

        expect(pageErrors, `uncaught errors during reattach: ${pageErrors.join(" | ")}`).toEqual(
            []
        );
    });

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

    test("repeated destroy → recreate leaves no residual listener, node or marker", async ({
        page,
    }) => {
        test.setTimeout(180_000);
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));

        await installListenerProbe(page);
        await waitForMap(page);
        const state = await readMapState(page);
        const heapStart = await heapMb(page);

        // Ten cycles, not three: a per-cycle leak of one or two listeners is inside
        // the noise of three rounds and unmistakable over ten.
        const CYCLES = 10;
        const counts = [];
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

            // The right panel is mounted once or not at all — never stacked. An
            // orphan here is the shape a teardown that forgets its DOM produces.
            expect(
                await page.locator(PANEL_SELECTOR).count(),
                `cycle ${i}: ${PANEL_SELECTOR} nodes`
            ).toBeLessThanOrEqual(1);

            counts.push(await liveListeners(page));
        }

        // Listeners: judged on the SERIES, not cycle by cycle. Measured on this suite,
        // the count jitters by ±1 around its steady state — an async release landing
        // just after the canvas is back, so the sampling instant decides whether it is
        // counted. A per-cycle "==" red on that jitter means nothing and would get
        // stamped away; a leak, by contrast, DRIFTS: one handler per cycle is +9 over
        // ten rounds, an order of magnitude outside the noise. So we allow 2 (one more
        // than the jitter ever observed) and let drift blow straight through it.
        const JITTER = 2;
        // Non-vacuity floor. A probe that stopped observing — prototype methods
        // reassigned later, init script not applied — would return 0 forever, and
        // "0 - 0 ≤ 2" is the green of a gate that reads nothing.
        expect(counts[0], "listener probe observed nothing — it is not wired").toBeGreaterThan(50);
        expect(
            Math.max(...counts) - counts[0],
            `live listeners drifted across ${CYCLES} cycles: ${counts.join(", ")}`
        ).toBeLessThanOrEqual(JITTER);

        // Indicative heap snapshot — Chromium-only, logged, NO hard gate (GC is
        // non-deterministic without --expose-gc; a real leak shows as steady growth).
        const heapEnd = await heapMb(page);
        console.info(
            `[lifecycle] live listeners over ${CYCLES} cycles: ${counts.join(", ")} (gated, drift ≤ ${JITTER})`
        );
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
