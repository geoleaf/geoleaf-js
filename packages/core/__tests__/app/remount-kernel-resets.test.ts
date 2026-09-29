/**
 * Witness — what an application teardown must reset for the next mount to be whole.
 *
 * ## What this file pins
 *
 * `GeoLeaf.mount()` tears an application down through `ModuleRegistry.destroy()` and boots it
 * again. No production path had ever called those `destroy()`s, and each case below is state
 * that survived them, read at HEAD before the fix and seen RED here:
 *
 * - the basemap: `_activeKey` survived, and `setBaseLayer` returns early on the same key — the
 *   second map got no basemap at all;
 * - the permalink kept syncing the destroyed map, and the next `startSync` threw on it;
 * - the theme applier kept `_isFirstLoad === false`, so the second map was never fitted to the
 *   theme's layers;
 * - `onPerformanceMetrics` fired on the first boot only: its listener was `{ once: true }`,
 *   posted at import, and the metrics cached;
 * - the proximity filter released none of its document listeners: `events.on()` returns an
 *   id, and its teardown only called functions;
 * - `CoreMapModule.destroy()` wiped the WHOLE listener manager, including what a host had
 *   registered through `GeoLeaf.Utils.events` before the boot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { Baselayers } = await import("../../src/kernel/basemaps/facade.ts");
const { _baseLayers, setMap } = await import("../../src/kernel/basemaps/registry.ts");
const { UIModule } = await import("../../src/app/boot-modules/ui.module.ts");
const { ThemeEngineModule } = await import("../../src/app/boot-modules/theme-engine.module.ts");
const { ThemeApplierCore } = await import("../../src/kernel/themes/theme-applier/core.ts");
const { CoreMapLifecycle } = await import("../../src/app/boot-modules/core-map-lifecycle.ts");
const { events } = await import("../../src/utils/general/event-listener-manager.ts");
const { FilterPanelProximity } =
    await import("../../src/capabilities/filter/panel/proximity/proximity.ts");
const { ensureGeoLeaf } = await import("../../src/utils/general/geoleaf-global.ts");
await import("../../src/utils/performance/runtime-metrics.ts");

const BASEMAP_SOURCE_ID = "__geoleaf_basemap__";

const GeoLeaf = ensureGeoLeaf() as unknown as Record<string, unknown>;
const saved = {
    app: GeoLeaf["_app"],
    permalink: GeoLeaf["Permalink"],
    perf: GeoLeaf["_perfCallback"],
};

/** A native map whose style is loaded, recording what the basemap registry does to it. */
function makeNativeMap() {
    return {
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
        getLayer: vi.fn(() => null),
        getSource: vi.fn(() => null),
        getStyle: vi.fn(() => ({ layers: [] })),
        setStyle: vi.fn(),
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        loaded: vi.fn(() => true),
        isStyleLoaded: vi.fn(() => true),
        setTerrain: vi.fn(),
        getTerrain: vi.fn(() => null),
    };
}

const STREET = {
    street: {
        id: "street",
        label: "Street",
        url: "https://tiles.example.test/{z}/{x}/{y}.png",
    },
};

beforeEach(() => {
    GeoLeaf["_app"] = { AppLog: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    document.body.replaceChildren();
});

afterEach(() => {
    GeoLeaf["_app"] = saved.app;
    GeoLeaf["Permalink"] = saved.permalink;
    GeoLeaf["_perfCallback"] = saved.perf;
    Baselayers.destroy();
    Object.keys(_baseLayers).forEach((k) => delete _baseLayers[k]);
    setMap(null);
    events.offAll();
    document.body.replaceChildren();
});

describe("the application teardown resets what the next mount reads", () => {
    it("🛑 the same basemap is applied to the NEXT map, and its switcher leaves the page", () => {
        const first = makeNativeMap();
        Baselayers.init({ map: first, baselayers: STREET, activeKey: "street", ui: {} } as never);
        expect(first.addSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID, expect.anything());
        expect(document.getElementById("gl-left-panel")).not.toBeNull();

        new UIModule().destroy();
        expect(document.getElementById("gl-left-panel")).toBeNull();

        const second = makeNativeMap();
        Baselayers.init({ map: second, baselayers: STREET, activeKey: "street", ui: {} } as never);
        expect(second.addSource).toHaveBeenCalledWith(BASEMAP_SOURCE_ID, expect.anything());
    });

    it("🛑 the permalink stops syncing the map that goes away", () => {
        const stopSync = vi.fn();
        GeoLeaf["Permalink"] = { stopSync };

        new UIModule().destroy();

        expect(stopSync).toHaveBeenCalledTimes(1);
    });

    it("🛑 the theme applier fits the next map again, and forgets the theme it applied", () => {
        ThemeApplierCore._isFirstLoad = false;
        ThemeApplierCore._currentThemeId = "t1";

        new ThemeEngineModule().destroy();

        expect(ThemeApplierCore._isFirstLoad).toBe(true);
        expect(ThemeApplierCore.getCurrentThemeId()).toBeNull();
    });

    it("🛑 onPerformanceMetrics hears every boot, with the metrics of that boot", () => {
        const received: unknown[] = [];
        GeoLeaf["_perfCallback"] = (metrics: unknown) => received.push(metrics);

        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));
        document.dispatchEvent(new CustomEvent("geoleaf:app:ready"));

        expect(received).toHaveLength(2);
        expect(received[1]).not.toBe(received[0]);
    });

    it("🛑 the proximity filter releases every listener it registered", () => {
        const before = events.getCount();

        FilterPanelProximity.initProximityFilter({} as never);
        expect(events.getCount()).toBeGreaterThan(before);
        FilterPanelProximity.destroy();

        expect(events.getCount()).toBe(before);
    });

    it("🛑 the core-map teardown keeps what was registered before the boot", () => {
        const host = vi.fn();
        const hostId = events.on(document, "host-event", host);
        (GeoLeaf["_app"] as Record<string, unknown>)["_eventsMark"] = events.mark();
        events.on(document, "boot-event", () => undefined);

        CoreMapLifecycle._reset();

        expect(events.getCount()).toBe(1);
        document.dispatchEvent(new Event("host-event"));
        expect(host).toHaveBeenCalledTimes(1);
        events.off(hostId as number);
    });
});
