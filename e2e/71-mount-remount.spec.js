// @ts-check
// E2E: GeoLeaf.mount() — the WHOLE application, unmounted and mounted again ten times.
//
// `10-lifecycle` cycles `Core.destroy` / `Core.init`: the map alone, which by construction comes
// back BARE — no layer, no panel, no basemap. This spec proves the other lifecycle, the one
// `GeoLeaf.mount()` (core 3.13.0) gives a host: `unmount()` takes the application down whole,
// and the next `mount()` gives it back whole.
//
// The page boots as it always does (`init.js` calls `GeoLeaf.boot()`, APP-02 untouched, nothing
// served is rewritten); a `mount()` then takes that application over — which exercises
// `boot() → unmount` on the way. What « whole » means is MEASURED, not listed: a snapshot S0 of
// the application `boot()` produced, before any teardown (layer-manager entries, style layers and
// sources, active basemap, running modules, panels, canvases), that every mount must reproduce.
//
// Seen RED by mutation of the SERVED bundle (bytes restored, `sha256sum -c`, the precompressed
// variants set aside so nginx serves the mutation), named in the commit: without the registry
// teardown, the next `ready` never settles (4/4); without the basemap reset, the first mount after
// the takeover is not S0.

import { test, expect } from "./helpers/test.js";
import { baseURL } from "./helpers/base-url.js";
import { installListenerProbe, liveListeners } from "./helpers/listener-probe.js";
import {
    BOOT_TIMEOUT as TIMEOUT,
    MAP_ID,
    bootPage,
    installSignals,
    mountAndWait,
} from "./helpers/mount.js";

test.use({ baseURL: baseURL("core") });

/**
 * What « the application » is, as the page shows it. Counts and names only — every field must
 * come back identical on every mount.
 */
function snapshot(page) {
    return page.evaluate(() => {
        const G = /** @type {any} */ (window).GeoLeaf;
        const adapter = G.Core.getMap();
        const native = adapter && adapter.getNativeMap ? adapter.getNativeMap() : null;
        const style = native && native.getStyle ? native.getStyle() : null;
        return {
            maps: G.Core.listMaps(),
            canvases: document.querySelectorAll(".maplibregl-canvas").length,
            layerManagerEntries: document.querySelectorAll(".gl-layer-manager__item").length,
            styleLayers: style ? style.layers.length : 0,
            sources: style ? Object.keys(style.sources).sort() : [],
            basemap: G.Baselayers.getActiveKey(),
            modules: G.registry
                .getActiveModules()
                .map((m) => m.id)
                .sort(),
            rightPanels: document.querySelectorAll("#gl-right-panel").length,
            filterPanels: document.querySelectorAll("#gl-filter-panel").length,
        };
    });
}

/**
 * The snapshot once the application has settled: layers keep loading in the background after
 * `geoleaf:app:ready`, so it is read until two readings 500 ms apart agree.
 */
async function settledSnapshot(page) {
    let previous = null;
    const deadline = Date.now() + TIMEOUT;
    while (Date.now() < deadline) {
        const current = await snapshot(page);
        if (previous && JSON.stringify(previous) === JSON.stringify(current)) return current;
        previous = current;
        await page.waitForTimeout(500);
    }
    throw new Error("the application never settled");
}

/** What the page must look like once the application is unmounted. */
async function expectEmpty(page, label) {
    const empty = await page.evaluate(() => ({
        maps: /** @type {any} */ (window).GeoLeaf.Core.listMaps(),
        canvases: document.querySelectorAll(".maplibregl-canvas").length,
        layerManagerEntries: document.querySelectorAll(".gl-layer-manager__item").length,
        rightPanels: document.querySelectorAll("#gl-right-panel").length,
        filterPanels: document.querySelectorAll("#gl-filter-panel").length,
        leftPanels: document.querySelectorAll("#gl-left-panel").length,
        registryArmed: /** @type {any} */ (window).GeoLeaf.registry.isInitialized(),
        managedListeners: /** @type {any} */ (window).GeoLeaf.Utils.events.getCount(),
    }));
    expect(empty, `${label}: the unmounted application left something`).toEqual({
        maps: [],
        canvases: 0,
        layerManagerEntries: 0,
        rightPanels: 0,
        filterPanels: 0,
        leftPanels: 0,
        registryArmed: false,
        managedListeners: 0,
    });
}

test.describe("71-mount-remount — the application, unmounted and mounted again", () => {
    test("ten mount → unmount cycles give the whole application back, without a leak", async ({
        page,
    }) => {
        test.setTimeout(300_000);
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await installListenerProbe(page);
        await bootPage(page);

        // S0 is the application `init.js` booted — no teardown has run yet, so nothing a teardown
        // forgot can be in it. Every mount must reproduce it, the first included: the takeover
        // unmounts that application, and a reset it misses shows on the very first mount.
        const s0 = await settledSnapshot(page);
        // Non-vacuity: S0 is a real application, not a bare map that would match another one.
        expect(s0.maps).toEqual([MAP_ID]);
        expect(s0.layerManagerEntries, "S0 has no layer-manager entry").toBeGreaterThan(0);
        expect(s0.styleLayers, "S0 has no style layer").toBeGreaterThan(0);
        expect(s0.basemap, "S0 has no active basemap").not.toBeNull();
        expect(s0.modules, "S0 runs no capability").toContain("legend");
        expect(s0.rightPanels).toBe(1);

        await mountAndWait(page);
        expect(
            await settledSnapshot(page),
            "the takeover gave the booted application back"
        ).toEqual(s0);

        const CYCLES = 10;
        const counts = [];
        for (let i = 1; i <= CYCLES; i++) {
            await page.evaluate(() => /** @type {any} */ (window).__glHandle.unmount());
            await expectEmpty(page, `cycle ${i}`);

            await mountAndWait(page);
            expect(await settledSnapshot(page), `cycle ${i}: the application came back`).toEqual(
                s0
            );
            // One `app:ready` per boot: the page's, the takeover's, and one per cycle.
            expect(
                await page.evaluate(() => /** @type {any} */ (window).__glReady),
                `cycle ${i}: app:ready`
            ).toBe(i + 2);
            counts.push(await liveListeners(page));
        }

        // Judged on the series, as in `10-lifecycle`: a leak drifts, jitter does not.
        const JITTER = 2;
        expect(counts[0], "listener probe observed nothing — it is not wired").toBeGreaterThan(50);
        expect(
            Math.max(...counts) - counts[0],
            `live listeners drifted across ${CYCLES} cycles: ${counts.join(", ")}`
        ).toBeLessThanOrEqual(JITTER);
        console.info(`[mount-remount] live listeners over ${CYCLES} cycles: ${counts.join(", ")}`);

        expect(await page.evaluate(() => /** @type {any} */ (window).__glAborted)).toEqual([]);
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("StrictMode — mount, unmount, mount in one tick: one boot, one map", async ({ page }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await bootPage(page);
        await mountAndWait(page);
        const readyBefore = await page.evaluate(() => /** @type {any} */ (window).__glReady);

        const outcome = await page.evaluate(async (id) => {
            const first = /** @type {any} */ (window).GeoLeaf.mount(id);
            void first.unmount();
            const second = /** @type {any} */ (window).GeoLeaf.mount(id);
            await second.ready;
            const firstReady = await first.ready.then(
                () => "resolved",
                (e) => `${e.name}:${e.reason}`
            );
            await second.unmount();
            return { firstReady };
        }, MAP_ID);

        expect(outcome.firstReady).toBe("GeoLeafMountError:unmounted");
        // The takeover's mount was live when `first` came: the second is the only new boot.
        expect(await page.evaluate(() => /** @type {any} */ (window).__glReady)).toBe(
            readyBefore + 1
        );
        await expectEmpty(page, "after the StrictMode sequence");
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("unmounted while it starts: the boot ends, no map is left, ready says why", async ({
        page,
    }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await bootPage(page);
        await mountAndWait(page);
        await page.evaluate(() => /** @type {any} */ (window).__glHandle.unmount());

        const outcome = await page.evaluate(async (id) => {
            const handle = /** @type {any} */ (window).GeoLeaf.mount(id);
            // Wait for THIS boot to be under way — its configuration requested —, then leave.
            await new Promise((resolve) =>
                document.addEventListener("geoleaf:config:loaded", resolve, { once: true })
            );
            await handle.unmount();
            return handle.ready.then(
                () => "resolved",
                (e) => `${e.name}:${e.reason}`
            );
        }, MAP_ID);

        expect(outcome).toBe("GeoLeafMountError:unmounted");
        expect(await page.evaluate(() => /** @type {any} */ (window).__glAborted)).toEqual([
            "unmounted",
        ]);
        await expectEmpty(page, "after an unmount during the boot");
        // Nothing of that boot reaches the page later: no map, no failure screen.
        await page.waitForTimeout(2000);
        await expectEmpty(page, "2 s later");
        expect(await page.locator(".gl-boot-failure").count()).toBe(0);
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });

    test("boot() after unmount() starts the application again — it is no longer ignored", async ({
        page,
    }) => {
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        await installSignals(page);
        await bootPage(page);
        await mountAndWait(page);
        const s0 = await settledSnapshot(page);
        await page.evaluate(() => /** @type {any} */ (window).__glHandle.unmount());

        const readyBefore = await page.evaluate(() => /** @type {any} */ (window).__glReady);
        await page.evaluate(() => /** @type {any} */ (window).GeoLeaf.boot());
        await page.waitForFunction((n) => /** @type {any} */ (window).__glReady > n, readyBefore, {
            timeout: TIMEOUT,
        });

        expect(await settledSnapshot(page)).toEqual(s0);
        expect(pageErrors, `uncaught errors: ${pageErrors.join(" | ")}`).toEqual([]);
    });
});
