/**
 * Tests for measure-api.ts — the plugin lifecycle behind `GeoLeaf.Measure.*`.
 *
 * This module carried NO tests before PLUGINS B.12. It is not new code: it lived in
 * `public-api.ts`, which the package excludes from coverage, so its 0 % never showed —
 * the same blind spot that let the S6 scale bug live in `print`'s facade. Splitting the
 * facade made it measurable; these tests close the gap.
 *
 * Collaborators are mocked so the subject is measure-api's OWN logic: the lazy bootstrap
 * (`_ensureMenu`), the no-core guards, the tool dispatch, and the boot restoration.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    // internal
    _warnNoCore: vi.fn(() => false),
    _getNativeMap: vi.fn<() => unknown>(() => null),
    // config
    getMeasureConfig: vi.fn(() => ({ maxFeatures: 10 })),
    // floating-menu
    initMenu: vi.fn(),
    toggleMeasureMenu: vi.fn(),
    setActiveTool: vi.fn(),
    // Mimics the REAL selectTool: it notifies onToolSelect (that is the whole point of
    // the distinction). Without this the mock would hide the defect being tested.
    selectTool: vi.fn(),
    setCurrentUnits: vi.fn(),
    getCurrentUnits: vi.fn(() => ({ distance: "m", area: "m2" })),
    positionMeasureMenuNear: vi.fn(),
    // engine
    initEngine: vi.fn(),
    setOnFeatureAdded: vi.fn(),
    addSurfaceFeature: vi.fn(),
    clearEngineCollection: vi.fn(),
    getEngineCollection: vi.fn<() => { type: string; features: unknown[] }>(() => ({
        type: "FeatureCollection",
        features: [],
    })),
    loadCollection: vi.fn(),
    removeFeatureById: vi.fn(),
    rerenderLabels: vi.fn(),
    // layers
    initLayers: vi.fn(),
    // tools
    activateDistance: vi.fn(),
    deactivateDistance: vi.fn(),
    activateRect: vi.fn(),
    deactivateRect: vi.fn(),
    activateCircle: vi.fn(),
    deactivateCircle: vi.fn(),
    activatePolygon: vi.fn(),
    deactivatePolygon: vi.fn(),
    activateGps: vi.fn(),
    deactivateGps: vi.fn(),
    activateAnnotationTooltip: vi.fn(),
    deactivateAnnotation: vi.fn(),
    activateCustom: vi.fn(),
    deactivateCustom: vi.fn(),
    // overlays
    initAnnotationOverlays: vi.fn(),
    createOverlayFromFeature: vi.fn(),
    clearAllOverlays: vi.fn(),
    getPrintableAnnotations: vi.fn(() => [{ id: "a" }]),
    // persistence
    initPersistence: vi.fn<() => unknown[] | null>(() => null),
    scheduleSave: vi.fn(),
    clearStorage: vi.fn(),
    // export
    exportGeoJSON: vi.fn(async () => new Blob()),
}));

vi.mock("../internal.js", () => ({
    _warnNoCore: mocks._warnNoCore,
    _getNativeMap: mocks._getNativeMap,
}));
vi.mock("../config.js", () => ({ getMeasureConfig: mocks.getMeasureConfig }));
vi.mock("../floating-menu.js", () => ({
    initMenu: mocks.initMenu,
    toggleMeasureMenu: mocks.toggleMeasureMenu,
    setActiveTool: mocks.setActiveTool,
    selectTool: mocks.selectTool,
    setCurrentUnits: mocks.setCurrentUnits,
    getCurrentUnits: mocks.getCurrentUnits,
    positionMeasureMenuNear: mocks.positionMeasureMenuNear,
}));
vi.mock("../measure-engine.js", () => ({
    initEngine: mocks.initEngine,
    setOnFeatureAdded: mocks.setOnFeatureAdded,
    addSurfaceFeature: mocks.addSurfaceFeature,
    clearEngineCollection: mocks.clearEngineCollection,
    getEngineCollection: mocks.getEngineCollection,
    loadCollection: mocks.loadCollection,
    removeFeatureById: mocks.removeFeatureById,
    rerenderLabels: mocks.rerenderLabels,
}));
vi.mock("../draw-layers.js", () => ({ initLayers: mocks.initLayers }));
vi.mock("../tools/tool-distance.js", () => ({
    activateDistance: mocks.activateDistance,
    deactivateDistance: mocks.deactivateDistance,
}));
vi.mock("../tools/tool-rect.js", () => ({
    activateRect: mocks.activateRect,
    deactivateRect: mocks.deactivateRect,
}));
vi.mock("../tools/tool-circle.js", () => ({
    activateCircle: mocks.activateCircle,
    deactivateCircle: mocks.deactivateCircle,
}));
vi.mock("../tools/tool-polygon.js", () => ({
    activatePolygon: mocks.activatePolygon,
    deactivatePolygon: mocks.deactivatePolygon,
}));
vi.mock("../tools/tool-gps.js", () => ({
    activateGps: mocks.activateGps,
    deactivateGps: mocks.deactivateGps,
}));
vi.mock("../tools/tool-annotation.js", () => ({
    activateAnnotationTooltip: mocks.activateAnnotationTooltip,
    deactivateAnnotation: mocks.deactivateAnnotation,
}));
vi.mock("../tools/tool-custom.js", () => ({
    activateCustom: mocks.activateCustom,
    deactivateCustom: mocks.deactivateCustom,
}));
vi.mock("../annotation-overlays.js", () => ({
    initAnnotationOverlays: mocks.initAnnotationOverlays,
    createOverlayFromFeature: mocks.createOverlayFromFeature,
    clearAllOverlays: mocks.clearAllOverlays,
    getPrintableAnnotations: mocks.getPrintableAnnotations,
}));
vi.mock("../persistence.js", () => ({
    initPersistence: mocks.initPersistence,
    scheduleSave: mocks.scheduleSave,
    clearStorage: mocks.clearStorage,
}));
vi.mock("../geojson-export.js", () => ({ exportGeoJSON: mocks.exportGeoJSON }));

type Api = typeof import("../measure-api.js");

function makeMap(): { getContainer: () => HTMLElement } {
    const el = document.createElement("div");
    return { getContainer: () => el };
}

/** Fresh module per test — `_menuInitialized` and the pill latch are module state. */
async function load(): Promise<Api> {
    vi.resetModules();
    return import("../measure-api.js");
}

describe("measure-api", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks._warnNoCore.mockReturnValue(false);
        mocks._getNativeMap.mockReturnValue(makeMap());
        mocks.getMeasureConfig.mockReturnValue({ maxFeatures: 10 });
        mocks.initPersistence.mockReturnValue(null);
        mocks.getEngineCollection.mockReturnValue({ type: "FeatureCollection", features: [] });
        // Replay the real floating-menu contract: selectTool() notifies onToolSelect,
        // setActiveTool() does not. This is exactly the distinction finding #1 turned on.
        mocks.selectTool.mockImplementation((type: unknown) => {
            const cbs = mocks.initMenu.mock.calls[0]?.[1] as
                { onToolSelect?: (t: unknown) => void } | undefined;
            cbs?.onToolSelect?.(type);
        });
    });

    // ── guards ───────────────────────────────────────────────────────────────
    describe("no-core guards", () => {
        it.each([
            ["openMeasureMenu", (a: Api) => a.openMeasureMenu()],
            ["startMeasure", (a: Api) => a.startMeasure("distance")],
            ["stopMeasure", (a: Api) => a.stopMeasure()],
            ["clearAll", (a: Api) => a.clearAll()],
            ["setUnits", (a: Api) => a.setUnits({ distance: "km" })],
        ])("%s does nothing when the core is absent", async (_name, call) => {
            mocks._warnNoCore.mockReturnValue(true);
            const api = await load();
            call(api);
            expect(mocks.initEngine).not.toHaveBeenCalled();
            expect(mocks.setActiveTool).not.toHaveBeenCalled();
            expect(mocks.setCurrentUnits).not.toHaveBeenCalled();
        });
    });

    // ── lazy bootstrap ───────────────────────────────────────────────────────
    describe("_ensureMenu (lazy bootstrap)", () => {
        it("wires engine, layers, overlays and menu on first use", async () => {
            const api = await load();
            api.startMeasure("distance");
            expect(mocks.initEngine).toHaveBeenCalledTimes(1);
            expect(mocks.initLayers).toHaveBeenCalledTimes(1);
            expect(mocks.initAnnotationOverlays).toHaveBeenCalledTimes(1);
            expect(mocks.initMenu).toHaveBeenCalledTimes(1);
        });

        it("bootstraps ONCE across repeated calls", async () => {
            const api = await load();
            api.startMeasure("distance");
            api.startMeasure("rect");
            api.openMeasureMenu();
            expect(mocks.initEngine).toHaveBeenCalledTimes(1);
        });

        it("does not bootstrap while the map is unavailable, and retries once it is", async () => {
            mocks._getNativeMap.mockReturnValue(null);
            const api = await load();
            api.startMeasure("distance");
            expect(mocks.initEngine).not.toHaveBeenCalled();
            // Discriminating: an early return that LATCHED would never boot the plugin.
            mocks._getNativeMap.mockReturnValue(makeMap());
            api.startMeasure("distance");
            expect(mocks.initEngine).toHaveBeenCalledTimes(1);
        });

        it("restores only annotation features from storage at boot", async () => {
            mocks.initPersistence.mockReturnValue([
                { properties: { annotationKind: "label" } },
                { properties: { annotationKind: "tooltip" } },
                { properties: { annotationKind: "other" } },
                { properties: {} },
            ]);
            const api = await load();
            api.startMeasure("distance");
            expect(mocks.loadCollection).toHaveBeenCalledTimes(1);
            // The whole collection is loaded, but only label/tooltip get an overlay.
            expect(mocks.createOverlayFromFeature).toHaveBeenCalledTimes(2);
        });

        it("skips restoration when storage is empty", async () => {
            mocks.initPersistence.mockReturnValue([]);
            const api = await load();
            api.startMeasure("distance");
            expect(mocks.loadCollection).not.toHaveBeenCalled();
        });
    });

    // ── overlay callbacks ────────────────────────────────────────────────────
    describe("annotation overlay callbacks", () => {
        async function bootAndGetCallbacks(): Promise<{
            onCreated: (f: unknown) => void;
            onMutated: () => void;
            onRemoved: (id: string) => void;
        }> {
            const api = await load();
            api.startMeasure("distance");
            return mocks.initAnnotationOverlays.mock.calls[0][2];
        }

        it("adds a created annotation and schedules a save", async () => {
            const cbs = await bootAndGetCallbacks();
            cbs.onCreated({ type: "Feature" });
            expect(mocks.addSurfaceFeature).toHaveBeenCalledTimes(1);
            expect(mocks.scheduleSave).toHaveBeenCalled();
        });

        it("refuses a created annotation once maxFeatures is reached", async () => {
            mocks.getMeasureConfig.mockReturnValue({ maxFeatures: 2 });
            mocks.getEngineCollection.mockReturnValue({
                type: "FeatureCollection",
                features: [{}, {}],
            });
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const cbs = await bootAndGetCallbacks();
            cbs.onCreated({ type: "Feature" });
            expect(mocks.addSurfaceFeature).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("maxFeatures"));
            warn.mockRestore();
        });

        it("schedules a save on mutation and removes by id on removal", async () => {
            const cbs = await bootAndGetCallbacks();
            cbs.onMutated();
            expect(mocks.scheduleSave).toHaveBeenCalled();
            cbs.onRemoved("feat-1");
            expect(mocks.removeFeatureById).toHaveBeenCalledWith("feat-1");
        });
    });

    // ── menu callbacks ───────────────────────────────────────────────────────
    describe("menu callbacks", () => {
        async function bootAndGetMenuCallbacks(): Promise<Record<string, (a?: unknown) => void>> {
            const api = await load();
            api.startMeasure("distance");
            return mocks.initMenu.mock.calls[0][1];
        }

        it.each([
            ["distance", "activateDistance"],
            ["rect", "activateRect"],
            ["circle", "activateCircle"],
            ["polygon", "activatePolygon"],
            ["gps", "activateGps"],
            ["annotation-tooltip", "activateAnnotationTooltip"],
        ])("onToolSelect(%s) deactivates all then arms %s", async (tool, activator) => {
            const cbs = await bootAndGetMenuCallbacks();
            vi.clearAllMocks();
            cbs.onToolSelect(tool);
            expect(mocks.deactivateDistance).toHaveBeenCalled();
            expect(mocks.deactivateGps).toHaveBeenCalled();
            expect(mocks[activator as keyof typeof mocks]).toHaveBeenCalled();
        });

        it("onToolSelect with an unknown tool only deactivates", async () => {
            const cbs = await bootAndGetMenuCallbacks();
            vi.clearAllMocks();
            cbs.onToolSelect("nope");
            expect(mocks.deactivateDistance).toHaveBeenCalled();
            expect(mocks.activateDistance).not.toHaveBeenCalled();
        });

        it("onUnitsChange sets the units then re-renders labels", async () => {
            const cbs = await bootAndGetMenuCallbacks();
            cbs.onUnitsChange({ distance: "km" });
            expect(mocks.setCurrentUnits).toHaveBeenCalledWith({ distance: "km" });
            expect(mocks.rerenderLabels).toHaveBeenCalled();
        });

        it("onToggle reflects the open state on the pill button", async () => {
            const api = await load();
            const pill = document.createElement("button");
            api.openMeasureMenu(pill);
            const cbs = mocks.initMenu.mock.calls[0][1];
            cbs.onToggle(true);
            expect(pill.classList.contains("gl-map-toolbar__btn--active")).toBe(true);
            cbs.onToggle(false);
            expect(pill.classList.contains("gl-map-toolbar__btn--active")).toBe(false);
        });

        it("onClearAll clears overlays, collection and storage", async () => {
            const cbs = await bootAndGetMenuCallbacks();
            vi.clearAllMocks();
            cbs.onClearAll();
            expect(mocks.clearAllOverlays).toHaveBeenCalled();
            expect(mocks.clearEngineCollection).toHaveBeenCalled();
            expect(mocks.clearStorage).toHaveBeenCalled();
        });

        it("onExport swallows an export rejection instead of leaving it unhandled", async () => {
            mocks.exportGeoJSON.mockRejectedValueOnce(new Error("boom"));
            const err = vi.spyOn(console, "error").mockImplementation(() => {});
            const cbs = await bootAndGetMenuCallbacks();
            cbs.onExport();
            await new Promise((r) => setTimeout(r, 0));
            expect(err).toHaveBeenCalledWith(
                expect.stringContaining("export error"),
                expect.any(Error)
            );
            err.mockRestore();
        });
    });

    // ── menu placement ───────────────────────────────────────────────────────
    describe("openMeasureMenu", () => {
        it("toggles the menu and positions it on first open only", async () => {
            const api = await load();
            const pill = document.createElement("button");
            api.openMeasureMenu(pill);
            api.openMeasureMenu(pill);
            expect(mocks.toggleMeasureMenu).toHaveBeenCalledTimes(2);
            expect(mocks.positionMeasureMenuNear).toHaveBeenCalledTimes(1);
        });

        it("does not position when no pill button was ever supplied", async () => {
            const api = await load();
            api.openMeasureMenu();
            expect(mocks.positionMeasureMenuNear).not.toHaveBeenCalled();
        });
    });

    // ── operations ───────────────────────────────────────────────────────────
    describe("operations", () => {
        // Non-regression, CDC finding #1 (MAJEUR): the facade used to call setActiveTool,
        // which only lights the button up — the tool LOOKED armed and no drawing handler
        // was ever wired, so clicking the map did nothing. Asserting "setActiveTool was
        // called" would have passed throughout the defect; what discriminates is that the
        // TOOL ITSELF gets activated.
        it("startMeasure actually activates the drawing tool, not just its button", async () => {
            const api = await load();
            api.startMeasure("circle");
            expect(mocks.activateCircle).toHaveBeenCalledTimes(1);
        });

        // One fresh module per tool rather than clearAllMocks() in a loop: clearing wipes
        // `initMenu.mock.calls`, which the selectTool replay reads to find onToolSelect —
        // the test would then pass for the wrong reason on every iteration but the first.
        it.each([
            ["distance", "activateDistance"],
            ["rect", "activateRect"],
            ["circle", "activateCircle"],
            ["polygon", "activatePolygon"],
            ["gps", "activateGps"],
        ])("startMeasure(%s) activates %s", async (tool, activator) => {
            const api = await load();
            api.startMeasure(tool as never);
            expect(mocks[activator as keyof typeof mocks]).toHaveBeenCalled();
        });

        it("stopMeasure deactivates everything and disarms", async () => {
            const api = await load();
            api.stopMeasure();
            expect(mocks.deactivateDistance).toHaveBeenCalled();
            expect(mocks.deactivateAnnotation).toHaveBeenCalled();
            expect(mocks.setActiveTool).toHaveBeenCalledWith(null);
        });

        it("clearAll disarms, clears overlays, collection and storage", async () => {
            const api = await load();
            api.clearAll();
            expect(mocks.setActiveTool).toHaveBeenCalledWith(null);
            expect(mocks.clearAllOverlays).toHaveBeenCalled();
            expect(mocks.clearEngineCollection).toHaveBeenCalled();
            expect(mocks.clearStorage).toHaveBeenCalled();
        });

        it("getCollection and getUnits forward to their modules", async () => {
            const api = await load();
            expect(api.getCollection()).toEqual({ type: "FeatureCollection", features: [] });
            expect(api.getUnits()).toEqual({ distance: "m", area: "m2" });
        });

        it("setUnits applies the units then re-renders labels", async () => {
            const api = await load();
            api.setUnits({ distance: "km" });
            expect(mocks.setCurrentUnits).toHaveBeenCalledWith({ distance: "km" });
            expect(mocks.rerenderLabels).toHaveBeenCalled();
        });

        it("exportGeoJSON passes the live collection and the config", async () => {
            const api = await load();
            await api.exportGeoJSON({ download: false });
            expect(mocks.exportGeoJSON).toHaveBeenCalledWith(
                { type: "FeatureCollection", features: [] },
                { download: false },
                { maxFeatures: 10 }
            );
        });

        it("getPrintableAnnotations forwards to the overlay module", async () => {
            const api = await load();
            expect(api.getPrintableAnnotations()).toEqual([{ id: "a" }]);
        });

        it("registerMeasureType accepts a custom tool without touching the core", async () => {
            const api = await load();
            expect(() =>
                api.registerMeasureType("heat", { cursor: "crosshair" } as never)
            ).not.toThrow();
        });
    });

    // ── Registered tools (B-253) ────────────────────────────────────────────
    //
    // ⚠️ The test above asserts a NON-THROW and nothing else — it passed unchanged while
    // `registerMeasureType()` wrote to a registry no code ever read. It is kept as the
    // signature check it always was; what follows asserts the effect it never did.

    describe("registered tools", () => {
        /**
         * Registers on the SAME module instance that is then booted.
         *
         * `load()` calls `vi.resetModules()`, so registering before it drops the registry on
         * the floor — the first draft of these tests did exactly that and failed for a reason
         * that had nothing to do with the subject.
         */
        async function bootWithRegistry(
            register?: (api: Api) => void
        ): Promise<{ api: Api; cbs: Record<string, (a?: unknown) => void> }> {
            const api = await load();
            register?.(api);
            api.startMeasure("distance"); // drives _ensureMenu(), which hands initMenu its callbacks
            return { api, cbs: mocks.initMenu.mock.calls[0][1] };
        }

        it("arms a registered tool through the dispatch, definition included", async () => {
            const def = { cursor: "cell", onActivate: vi.fn(), onDeactivate: vi.fn() };
            const { cbs } = await bootWithRegistry((api) =>
                api.registerMeasureType("denivele", def as never)
            );
            vi.clearAllMocks();

            cbs.onToolSelect("denivele");

            expect(mocks.activateCustom).toHaveBeenCalledWith(expect.anything(), "denivele", def);
        });

        it("still only deactivates for an id that was never registered", async () => {
            const { cbs } = await bootWithRegistry();
            vi.clearAllMocks();
            cbs.onToolSelect("jamais-enregistre");
            expect(mocks.deactivateCustom).toHaveBeenCalled();
            expect(mocks.activateCustom).not.toHaveBeenCalled();
        });

        it("disarms the registered tool on every teardown path", async () => {
            const { api, cbs } = await bootWithRegistry((a) =>
                a.registerMeasureType("denivele", { onActivate: vi.fn() } as never)
            );

            // 1. switching to a built-in
            vi.clearAllMocks();
            cbs.onToolSelect("distance");
            expect(mocks.deactivateCustom).toHaveBeenCalled();

            // 2. closing the menu — floating-menu notifies with null
            vi.clearAllMocks();
            cbs.onToolSelect(null);
            expect(mocks.deactivateCustom).toHaveBeenCalled();
            expect(mocks.activateCustom).not.toHaveBeenCalled();

            // 3. stopMeasure()
            vi.clearAllMocks();
            api.stopMeasure();
            expect(mocks.deactivateCustom).toHaveBeenCalled();

            // 4. clearAll()
            vi.clearAllMocks();
            api.clearAll();
            expect(mocks.deactivateCustom).toHaveBeenCalled();
        });

        it("re-registering an id replaces the definition that gets armed", async () => {
            const first = { onActivate: vi.fn() };
            const second = { onActivate: vi.fn() };
            const { cbs } = await bootWithRegistry((api) => {
                api.registerMeasureType("dup", first as never);
                api.registerMeasureType("dup", second as never);
            });
            vi.clearAllMocks();

            cbs.onToolSelect("dup");

            expect(mocks.activateCustom).toHaveBeenCalledWith(expect.anything(), "dup", second);
        });
    });
});
