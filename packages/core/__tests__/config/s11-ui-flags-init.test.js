/**
 * Config-contract Phase C / C2 — B3 ui.json: ui.* flags resolved by
 * CoreMapModule/SharedModule/UIModule (formerly orchestrated by app/init.ts,
 * removed — roadmap nettoyage Sprint 3 / A-1: it was a legacy test-only facade
 * that just delegated to these same module classes).
 *
 * Observed at the GeoLeaf.init() seam + the populated GeoLeaf module stubs:
 *   - ui.theme              → GeoLeaf.init({ ui: { theme }}) (core-map.module.ts)
 *   - modules.permalink.{enabled,mode} → GeoLeaf.Permalink.init(cfg) (core-map.module.ts, opt-out, S13)
 *   - modules.filter.enabled → hides #gl-filter-toggle when false (ui.module.ts #13)
 *   - ui.showLayerManager / showCoordinates → gated inside the 'geoleaf:app:ready'
 *     deferred-UI listener (legend init migrated to LegendLifecycle — S10/F1)
 *
 * Mirrors the s10-root-map seam harness (file-local hoisted mocks). The deferred
 * listener is captured via an addEventListener spy and invoked directly, so that
 * listeners from earlier `run()` calls cannot fire on a shared dispatch.
 * Inventory B3.
 */

import { makeFakeMap, populateInitGeoLeaf, stubPerformance } from "./_helpers/config-harness.js";

// ─── vi.hoisted: mocks available before static imports (module classes capture _g) ──
const mocks = vi.hoisted(() => {
    const AppLog = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const GeoLeaf = {
        _app: { AppLog, checkPlugins: vi.fn(), showNotification: vi.fn().mockReturnValue(true) },
    };
    return {
        GeoLeaf,
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
// S1.2: logic migrated from initApp() → CoreMapModule/SharedModule/UIModule directly
import { CoreMapModule } from "../../src/app/boot-modules/core-map.module.ts";
import { SharedModule } from "../../src/app/boot-modules/shared.module.ts";
import { UIModule } from "../../src/app/boot-modules/ui.module.ts";

const GeoLeaf = mocks.GeoLeaf;
const VALID_MAP = {
    bounds: [
        [43, 1],
        [44, 2],
    ],
    initialMaxZoom: 10,
};

describe("config B3 — ui.* flags (boot module sequence seam)", () => {
    let fakeMap;
    let appReadyHandler; // the latest captured 'geoleaf:app:ready' deferred-UI listener
    const realAddEventListener = document.addEventListener.bind(document);

    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(GeoLeaf).forEach((k) => {
            if (k !== "_app") delete GeoLeaf[k];
        });
        appReadyHandler = null;
        // Capture UIModule's deferred-UI listener instead of registering it, so it
        // never accumulates on `document` across runs.
        vi.spyOn(document, "addEventListener").mockImplementation((type, handler, opts) => {
            if (type === "geoleaf:app:ready") {
                appReadyHandler = handler;
                return;
            }
            return realAddEventListener(type, handler, opts);
        });
        fakeMap = makeFakeMap();
        document.body.innerHTML = "";
        const loader = document.createElement("div");
        loader.id = "gl-loader";
        document.body.appendChild(loader);
        stubPerformance();
    });

    afterEach(() => vi.restoreAllMocks());

    /** Run the boot module sequence with the given ui config; return the GeoLeaf.init() arg. */
    async function run(ui, overrides = {}, extraCfg = {}) {
        populateInitGeoLeaf(GeoLeaf, fakeMap, overrides);
        const cfg = { map: { ...VALID_MAP }, ui, ...extraCfg };
        new CoreMapModule().init(null, cfg);
        new SharedModule().init(null, cfg);
        await new UIModule().init(null, cfg);
        return GeoLeaf.init.mock.calls[0]?.[0];
    }

    // ── ui.theme ──────────────────────────────────────────────────────────────
    describe("ui.theme", () => {
        it("theme → GeoLeaf.init({ ui: { theme }})", async () => {
            const initArg = await run({ theme: "dark" });
            expect(initArg.ui.theme).toBe("dark");
        });
        it("absent → defaults to 'light'", async () => {
            const initArg = await run({});
            expect(initArg.ui.theme).toBe("light");
        });
    });

    // ── modules.permalink.{enabled,mode} (migré de ui.permalink en S13 — opt-out) ──
    describe("modules.permalink", () => {
        it("enabled → Permalink.init called with the config (incl. mode)", async () => {
            const Permalink = { init: vi.fn(), readAndStore: vi.fn() };
            await run(
                {},
                { Permalink },
                { modules: { permalink: { enabled: true, mode: "query" } } }
            );
            expect(Permalink.init).toHaveBeenCalledWith(
                expect.objectContaining({ enabled: true, mode: "query" })
            );
            expect(Permalink.readAndStore).toHaveBeenCalled();
        });
        it("enabled:false → Permalink.init NOT called (opt-out disable)", async () => {
            const Permalink = { init: vi.fn(), readAndStore: vi.fn() };
            await run({}, { Permalink }, { modules: { permalink: { enabled: false } } });
            expect(Permalink.init).not.toHaveBeenCalled();
        });
        it("absent → Permalink.init called (opt-out default on)", async () => {
            const Permalink = { init: vi.fn(), readAndStore: vi.fn() };
            await run({}, { Permalink });
            expect(Permalink.init).toHaveBeenCalled();
        });
    });

    // ── modules.filter.enabled (was ui.showFilterPanel — migrated S5) ──────────
    describe("modules.filter.enabled", () => {
        it("false → #gl-filter-toggle hidden", async () => {
            const toggle = document.createElement("button");
            toggle.id = "gl-filter-toggle";
            document.body.appendChild(toggle);
            await run({}, {}, { modules: { filter: { enabled: false } } });
            expect(toggle.style.display).toBe("none");
        });
    });

    // ── ui.showLayerManager / showCoordinates (deferred UI) ───────────────────
    describe("deferred UI flags (geoleaf:app:ready)", () => {
        async function runDeferred(ui) {
            appReadyHandler = null;
            await run(ui);
            if (typeof appReadyHandler === "function") appReadyHandler();
        }

        it("showLayerManager not false → LayerManager.init called; false → not called", async () => {
            await runDeferred({ showLayerManager: true });
            expect(GeoLeaf.LayerManager.init).toHaveBeenCalled();
            vi.clearAllMocks();
            await runDeferred({ showLayerManager: false });
            expect(GeoLeaf.LayerManager.init).not.toHaveBeenCalled();
        });

        // showCoordinates test removed: the coordinates readout is now the in-core
        // `coordinates` capability (gated via CapabilityRegistry + CoordinatesLifecycle
        // on app:ready), no longer gated here. Covered by __tests__/capabilities/coordinates/.
    });
});
