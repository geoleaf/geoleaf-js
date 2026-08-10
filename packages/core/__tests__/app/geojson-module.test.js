/**
 * GeoJSONModule — F0/S8 registry-driven layer load.
 *
 * Verifies that GeoJSONModule.init() (moved out of the UI-phase initGeoJSON) binds the
 * map via GeoLeaf.GeoJSON.init() and awaits loadFromActiveProfile so the layer registry
 * is hot before UIModule's theme applier runs. init() must never reject (a rejection
 * would abort the ModuleRegistry chain).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `ensureGeoLeaf()` returns a fixed reference the module reads at call time — mutate its
// props per test (cleared in beforeEach).
const mockGeoLeaf = {};
vi.mock("../../src/utils/general/geoleaf-global.js", () => ({
    ensureGeoLeaf: () => mockGeoLeaf,
    getGeoLeaf: () => mockGeoLeaf,
}));
vi.mock("../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { reset: vi.fn() },
}));

// Dynamic import — defers loading geojson.module.js (and the mocked accessor) until
// after `mockGeoLeaf` is initialized, so the vi.mock factory doesn't hit its TDZ.
const { GeoJSONModule } = await import("../../src/app/boot-modules/geojson.module.ts");

describe("GeoJSONModule (F0/S8 — registry-driven layer load)", () => {
    const AppLog = { log: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const fakeMap = { getNativeMap: () => ({}) };
    const fakeAdapter = { getNativeMap: () => ({}) };

    beforeEach(() => {
        vi.clearAllMocks();
        for (const k of Object.keys(mockGeoLeaf)) delete mockGeoLeaf[k];
        mockGeoLeaf._app = { _currentMap: fakeMap, AppLog };
    });

    it("has id 'geojson' and depends on config + core-map", () => {
        const mod = new GeoJSONModule();
        expect(mod.id).toBe("geojson");
        expect([...mod.dependencies]).toEqual(["config", "core-map"]);
    });

    it("init() binds the shared map via GeoJSON.init and awaits loadFromActiveProfile", async () => {
        const initFn = vi.fn();
        const loadFn = vi.fn().mockResolvedValue([]);
        mockGeoLeaf.GeoJSON = { init: initFn, loadFromActiveProfile: loadFn };

        await new GeoJSONModule().init(fakeAdapter, {});

        expect(initFn).toHaveBeenCalledWith({
            map: fakeMap,
            fitBoundsOnLoad: false,
            maxZoomOnFit: 12,
        });
        expect(loadFn).toHaveBeenCalledTimes(1);
    });

    it("init() falls back to the adapter when _currentMap is absent", async () => {
        const initFn = vi.fn();
        mockGeoLeaf._app = { AppLog }; // no _currentMap
        mockGeoLeaf.GeoJSON = {
            init: initFn,
            loadFromActiveProfile: vi.fn().mockResolvedValue([]),
        };

        await new GeoJSONModule().init(fakeAdapter, {});

        expect(initFn).toHaveBeenCalledWith(expect.objectContaining({ map: fakeAdapter }));
    });

    it("init() swallows a loadFromActiveProfile rejection (never rejects the chain)", async () => {
        mockGeoLeaf.GeoJSON = {
            init: vi.fn(),
            loadFromActiveProfile: vi.fn().mockRejectedValue(new Error("load fail")),
        };

        await expect(new GeoJSONModule().init(fakeAdapter, {})).resolves.toBeUndefined();
        expect(AppLog.warn).toHaveBeenCalled();
    });

    it("init() logs and returns when GeoJSON.init is unavailable", async () => {
        mockGeoLeaf.GeoJSON = {}; // no init

        await new GeoJSONModule().init(fakeAdapter, {});

        expect(AppLog.log).toHaveBeenCalledWith(
            expect.stringContaining("GeoJSON.init() unavailable")
        );
    });
});
