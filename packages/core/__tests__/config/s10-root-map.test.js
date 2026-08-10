/**
 * Config-contract Phase C / C1 — B1 root family: profile.json `map.*`.
 *
 * Per-value verification of every map.* parameter through the real
 * CoreMapModule resolution, observed at the GeoLeaf.init() seam (mapOptions,
 * center, zoom) and the map.fitBounds() call (padding). Source of truth:
 * profiles/_reference.
 *
 * Consumer: packages/core/src/app/boot-modules/core-map.module.ts. See inventory B1.
 */

import {
    makeFakeMap,
    populateInitGeoLeaf,
    stubPerformance,
    REFERENCE_PROFILE,
} from "./_helpers/config-harness.js";

// ─── vi.hoisted : mocks available before static imports (init.ts captures _g) ─
const mocks = vi.hoisted(() => {
    const AppLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const GeoLeaf = {
        _app: { AppLog, checkPlugins: vi.fn(), showNotification: vi.fn().mockReturnValue(true) },
    };
    return {
        GeoLeaf,
        // padBounds is mocked: it returns an identifiable object so we can assert
        // maxBounds === padBounds(profileBounds, boundsMargin) by reference.
        padBounds: vi.fn((bounds, margin) => ({ __padded: true, margin, src: bounds })),
        initBasemaps: vi.fn(),
        initPOI: vi.fn(),
        initGeoJSON: vi.fn(),
        initUIPanels: vi.fn(),
        initI18n: vi.fn(),
    };
});

vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mocks.GeoLeaf,
    getGeoLeaf: () => mocks.GeoLeaf,
}));
vi.mock("../../src/app/init-features.js", () => ({
    initBasemaps: mocks.initBasemaps,
    initPOI: mocks.initPOI,
    initGeoJSON: mocks.initGeoJSON,
    initUIPanels: mocks.initUIPanels,
}));
vi.mock("../../src/kernel/map/map-container.js", () => ({
    padBounds: mocks.padBounds,
}));
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    initI18n: mocks.initI18n,
    getLabel: vi.fn((key) => key),
}));
vi.mock("../../src/utils/performance/runtime-metrics.js", () => ({}));

// S1.2: logic migrated from initApp() → CoreMapModule.init()
import { CoreMapModule } from "../../src/app/boot-modules/core-map.module.ts";

const GeoLeaf = mocks.GeoLeaf;
const BOUNDS = [
    [43, 1],
    [44, 2],
];

describe("config B1 — profile.json map.* (CoreMapModule seam)", () => {
    let fakeMap;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(GeoLeaf).forEach((k) => {
            if (k !== "_app") delete GeoLeaf[k];
        });
        fakeMap = makeFakeMap();
        document.body.innerHTML = "";
        const loader = document.createElement("div");
        loader.id = "gl-loader";
        document.body.appendChild(loader);
        stubPerformance();
    });

    /** Run CoreMapModule.init() with the given map config; return the captured init/fitBounds args. */
    function run(mapCfg) {
        populateInitGeoLeaf(GeoLeaf, fakeMap);
        new CoreMapModule().init(null, { map: mapCfg, ui: {} });
        const initArg = GeoLeaf.init.mock.calls[0]?.[0];
        const fitBoundsCall = fakeMap.fitBounds.mock.calls[0];
        return { initArg, fitBoundsCall };
    }

    // ── zoom resolution: initialMaxZoom → maxZoom → 12 (ANO-019, live alias) ──
    describe("zoom = initialMaxZoom || maxZoom || 12 [ANO-019]", () => {
        it("initialMaxZoom alone drives the initial zoom", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 9 });
            expect(initArg.map.zoom).toBe(9);
        });

        it("falls back to maxZoom when initialMaxZoom is absent", async () => {
            const { initArg } = await run({ bounds: BOUNDS, maxZoom: 15 });
            expect(initArg.map.zoom).toBe(15);
        });

        it("falls back to 12 when neither is set", async () => {
            const { initArg } = await run({ bounds: BOUNDS });
            expect(initArg.map.zoom).toBe(12);
        });

        it("initialMaxZoom wins over maxZoom for the initial zoom (|| precedence)", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 9, maxZoom: 18 });
            expect(initArg.map.zoom).toBe(9);
            // maxZoom still flows to mapOptions.maxZoom independently (see below)
            expect(initArg.map.mapOptions.maxZoom).toBe(18);
        });
    });

    // ── maxZoom / minZoom passthrough into mapOptions ────────────────────────
    describe("maxZoom / minZoom → mapOptions", () => {
        it("numeric maxZoom sets mapOptions.maxZoom", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 10, maxZoom: 17 });
            expect(initArg.map.mapOptions.maxZoom).toBe(17);
        });

        it("no maxZoom → mapOptions.maxZoom undefined", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 10 });
            expect(initArg.map.mapOptions.maxZoom).toBeUndefined();
        });

        it("numeric minZoom (no positionFixed) sets mapOptions.minZoom", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 10, minZoom: 5 });
            expect(initArg.map.mapOptions.minZoom).toBe(5);
        });
    });

    // ── padding: array [x,y] → {top:y,bottom:y,left:x,right:x} | object passthrough ──
    describe("padding (array vs object) → fitBounds", () => {
        it("array [x,y] maps to {top:y,bottom:y,left:x,right:x}", async () => {
            const { fitBoundsCall } = await run({
                bounds: BOUNDS,
                initialMaxZoom: 10,
                padding: [40, 60],
            });
            expect(fitBoundsCall[1].padding).toEqual({ top: 60, bottom: 60, left: 40, right: 40 });
        });

        it("object form passes through unchanged", async () => {
            const padding = { top: 10, right: 20, bottom: 30, left: 40 };
            const { fitBoundsCall } = await run({ bounds: BOUNDS, initialMaxZoom: 10, padding });
            expect(fitBoundsCall[1].padding).toEqual(padding);
        });

        it("absent padding defaults to [50,50] → 50 on all sides", async () => {
            const { fitBoundsCall } = await run({ bounds: BOUNDS, initialMaxZoom: 10 });
            expect(fitBoundsCall[1].padding).toEqual({
                top: 50,
                bottom: 50,
                left: 50,
                right: 50,
            });
        });
    });

    // ── positionFixed + boundsMargin → maxBounds + minZoom default 3 ─────────
    describe("positionFixed + boundsMargin → mapOptions.maxBounds", () => {
        it("positionFixed sets maxBounds = padBounds(profileBounds, boundsMargin)", async () => {
            const { initArg } = await run({
                bounds: BOUNDS,
                initialMaxZoom: 10,
                positionFixed: true,
                boundsMargin: 0.5,
            });
            expect(mocks.padBounds).toHaveBeenCalledWith(
                { south: 43, west: 1, north: 44, east: 2 },
                0.5
            );
            expect(initArg.map.mapOptions.maxBounds).toBe(mocks.padBounds.mock.results[0].value);
        });

        it("boundsMargin defaults to 0.3 when not a number", async () => {
            await run({ bounds: BOUNDS, initialMaxZoom: 10, positionFixed: true });
            expect(mocks.padBounds).toHaveBeenCalledWith(expect.any(Object), 0.3);
        });

        it("positionFixed minZoom defaults to 3 (or explicit minZoom)", async () => {
            const def = await run({ bounds: BOUNDS, initialMaxZoom: 10, positionFixed: true });
            expect(def.initArg.map.mapOptions.minZoom).toBe(3);
            const explicit = await run({
                bounds: BOUNDS,
                initialMaxZoom: 10,
                positionFixed: true,
                minZoom: 4,
            });
            expect(explicit.initArg.map.mapOptions.minZoom).toBe(4);
        });

        it("no positionFixed → no maxBounds", async () => {
            const { initArg } = await run({ bounds: BOUNDS, initialMaxZoom: 10 });
            expect(initArg.map.mapOptions.maxBounds).toBeUndefined();
            expect(mocks.padBounds).not.toHaveBeenCalled();
        });
    });

    // ── bounds vs center+zoom positioning mode ───────────────────────────────
    describe("positioning mode (bounds vs center+zoom)", () => {
        it("bounds → center is the bounds midpoint and fitBounds is called", async () => {
            const { initArg, fitBoundsCall } = await run({ bounds: BOUNDS, initialMaxZoom: 10 });
            expect(initArg.map.center).toEqual([43.5, 1.5]);
            expect(fitBoundsCall).toBeTruthy();
        });

        it("center+zoom (no bounds) → center/zoom from config, no fitBounds", async () => {
            const { initArg } = await run({ center: [20, 10], zoom: 4 });
            expect(initArg.map.center).toEqual([20, 10]);
            expect(initArg.map.zoom).toBe(4);
            expect(fakeMap.fitBounds).not.toHaveBeenCalled();
        });

        it("neither bounds nor center+zoom → early return, no GeoLeaf.init", () => {
            populateInitGeoLeaf(GeoLeaf, fakeMap);
            new CoreMapModule().init(null, { map: {}, ui: {} });
            expect(GeoLeaf.init).not.toHaveBeenCalled();
            expect(GeoLeaf._app.AppLog.error).toHaveBeenCalledWith(
                expect.stringContaining("bounds")
            );
        });
    });

    // ── reference fixture exercises every map.* key at once ──────────────────
    it("reference fixture profile.json map.* resolves end-to-end", async () => {
        const { initArg, fitBoundsCall } = await run(REFERENCE_PROFILE.map);
        // initialMaxZoom (10) wins for initial zoom; maxZoom (18) → mapOptions.maxZoom
        expect(initArg.map.zoom).toBe(10);
        expect(initArg.map.mapOptions.maxZoom).toBe(18);
        // positionFixed:true + boundsMargin:0.5 → maxBounds; minZoom:4
        expect(initArg.map.mapOptions.minZoom).toBe(4);
        expect(initArg.map.mapOptions.maxBounds).toBe(mocks.padBounds.mock.results[0].value);
        expect(mocks.padBounds).toHaveBeenCalledWith(expect.any(Object), 0.5);
        // bounds midpoint center
        expect(initArg.map.center).toEqual([43.5, 1.5]);
        // padding object form passes through
        expect(fitBoundsCall[1].padding).toEqual({ top: 60, right: 40, bottom: 60, left: 40 });
    });
});
