/**
 */
/* Phase 5.32 - theme-applier/deferred */

const mockSetVisibilityAndStyle = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockLayers = new Map();
const mockGetActiveProfile = vi.fn(() => null);
const mockConfigGet = vi.fn(() => undefined);
const mockLoader = vi.fn();
const mockThemeCacheGet = vi.fn(() => Promise.resolve(null));
const mockThemeCacheStore = vi.fn(() => Promise.resolve());

vi.mock("../../src/kernel/themes/theme-applier/core.js", () => {
    const TA = {
        _pendingLayerConfigs: null,
        _pendingCheckTimer: null,
        _setLayerVisibilityAndStyle: mockSetVisibilityAndStyle,
    };
    return { ThemeApplierCore: TA };
});

vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: {
        getActiveProfile: (...args) => mockGetActiveProfile(...args),
        get: (key) => mockConfigGet(key),
    },
}));
vi.mock("../../src/kernel/shared/geojson-state.js", () => ({
    GeoJSONShared: {
        state: {
            get layers() {
                return mockLayers;
            },
        },
    },
}));
vi.mock("../../src/kernel/geojson/loader/single-layer.js", () => ({
    LoaderSingleLayer: { _loadSingleLayer: null },
}));
vi.mock("../../src/kernel/themes/theme-cache.js", () => ({
    ThemeCache: {
        get: (...args) => mockThemeCacheGet(...args),
        store: (...args) => mockThemeCacheStore(...args),
    },
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: { warn: vi.fn() } }));
import { ThemeApplierDeferred as TA } from "../../src/kernel/themes/theme-applier/deferred.js";
import { LoaderSingleLayer } from "../../src/kernel/geojson/loader/single-layer.js";

describe("theme-applier/deferred (Phase 5.32)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockLayers.clear();
        TA._pendingLayerConfigs = new Map();
        TA._pendingCheckTimer = null;
        if (TA._setLayerVisibilityAndStyle !== mockSetVisibilityAndStyle) {
            TA._setLayerVisibilityAndStyle = mockSetVisibilityAndStyle;
        }
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("_scheduleLayerConfig", () => {
        it("stores config and schedules pending check", async () => {
            const p = TA._scheduleLayerConfig("layer-1", true, "style-a");
            await expect(p).resolves.toBeUndefined();
            expect(TA._pendingLayerConfigs.get("layer-1")).toEqual({
                visible: true,
                styleId: "style-a",
            });
            expect(TA._pendingCheckTimer).not.toBeNull();
        });

        it("creates _pendingLayerConfigs Map if missing", async () => {
            TA._pendingLayerConfigs = null;
            await TA._scheduleLayerConfig("x", false, "s");
            expect(TA._pendingLayerConfigs).toBeInstanceOf(Map);
            expect(TA._pendingLayerConfigs.get("x")).toEqual({ visible: false, styleId: "s" });
        });
    });

    describe("_schedulePendingCheck", () => {
        it("does not double-schedule when timer exists", () => {
            TA._pendingCheckTimer = 123;
            TA._schedulePendingCheck();
            expect(TA._pendingCheckTimer).toBe(123);
        });

        it("runs _checkPendingLayerConfigs after 1000ms", () => {
            TA._setLayerVisibilityAndStyle = vi.fn(() => Promise.resolve());
            TA._pendingLayerConfigs.set("l1", { visible: true, styleId: "s1" });
            mockLayers.set("l1", { layer: {} });
            TA._schedulePendingCheck();
            expect(TA._pendingCheckTimer).not.toBeNull();
            vi.advanceTimersByTime(1000);
            expect(TA._setLayerVisibilityAndStyle).toHaveBeenCalledWith("l1", true, "s1");
            expect(TA._pendingLayerConfigs.has("l1")).toBe(false);
        });
    });

    describe("_checkPendingLayerConfigs", () => {
        it("does nothing when no pending configs", () => {
            TA._checkPendingLayerConfigs();
            expect(mockSetVisibilityAndStyle).not.toHaveBeenCalled();
        });

        it("applies config for layers present in GeoJSONShared and removes them", () => {
            TA._pendingLayerConfigs.set("a", { visible: true, styleId: "default" });
            TA._pendingLayerConfigs.set("b", { visible: false });
            mockLayers.set("a", {});
            mockLayers.set("b", {});
            TA._checkPendingLayerConfigs();
            expect(mockSetVisibilityAndStyle).toHaveBeenCalledWith("a", true, "default");
            expect(mockSetVisibilityAndStyle).toHaveBeenCalledWith("b", false, undefined);
            expect(TA._pendingLayerConfigs.has("a")).toBe(false);
            expect(TA._pendingLayerConfigs.has("b")).toBe(false);
        });

        it("keeps configs for layers not yet in state", () => {
            TA._pendingLayerConfigs.set("missing", { visible: true, styleId: "s" });
            TA._checkPendingLayerConfigs();
            expect(mockSetVisibilityAndStyle).not.toHaveBeenCalled();
            expect(TA._pendingLayerConfigs.has("missing")).toBe(true);
        });
    });

    describe("_normalizeBasePath", () => {
        it("trims and removes trailing slash", () => {
            expect(TA._normalizeBasePath("  profiles/  ")).toBe("profiles");
            expect(TA._normalizeBasePath("profiles/")).toBe("profiles");
        });
    });

    describe("_resolveDataFilePath", () => {
        it("returns null when dataFile or _layerDirectory missing", () => {
            expect(TA._resolveDataFilePath({})).toBeNull();
            expect(TA._resolveDataFilePath({ dataFile: "x.json" })).toBeNull();
            expect(TA._resolveDataFilePath({ _layerDirectory: "layer1" })).toBeNull();
        });

        it("returns null when Config or getActiveProfile missing", () => {
            const orig = mockGetActiveProfile;
            mockGetActiveProfile.mockImplementation(() => null);
            expect(
                TA._resolveDataFilePath({
                    dataFile: "d.json",
                    _layerDirectory: "layer1",
                })
            ).toBeNull();
            mockGetActiveProfile.mockImplementation(orig);
        });

        it("returns full path when profile has id and _getProfilesBasePath returns base", () => {
            mockGetActiveProfile.mockReturnValue({ id: "profile1" });
            mockConfigGet.mockReturnValue(undefined);
            const path = TA._resolveDataFilePath({
                dataFile: "data.json",
                _layerDirectory: "my-layer",
            });
            expect(path).toBe("profiles/profile1/my-layer/data.json");
        });

        it("uses Config.get data.profilesBasePath when set", () => {
            mockGetActiveProfile.mockReturnValue({ id: "p2" });
            mockConfigGet.mockReturnValue("data/profiles");
            const path = TA._resolveDataFilePath({
                dataFile: "f.geojson",
                _layerDirectory: "ly",
            });
            expect(path).toBe("data/profiles/p2/ly/f.geojson");
        });
    });

    describe("_getProfilesBasePath", () => {
        it("returns Config.get value when non-empty string", () => {
            mockConfigGet.mockReturnValue("  custom/  ");
            expect(TA._getProfilesBasePath({})).toBe("custom");
        });

        it("returns activeProfile.profilesBasePath when Config.get empty", () => {
            mockConfigGet.mockReturnValue("");
            expect(TA._getProfilesBasePath({ profilesBasePath: "app/profiles/" })).toBe(
                "app/profiles"
            );
        });

        it("returns default profiles when neither set", () => {
            mockConfigGet.mockReturnValue(undefined);
            expect(TA._getProfilesBasePath({})).toBe("profiles");
        });
    });

    describe("_loadLayerFromProfile", () => {
        beforeEach(() => {
            mockGetActiveProfile.mockReturnValue(null);
            LoaderSingleLayer._loadSingleLayer = null;
        });

        it("returns null when Config missing or getActiveProfile not a function", async () => {
            const a = await TA._loadLayerFromProfile("any");
            expect(a).toBeNull();
        });

        it("returns null when activeProfile is null or not an object", async () => {
            mockGetActiveProfile.mockReturnValue(null);
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
            mockGetActiveProfile.mockReturnValue("string");
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
        });

        it("returns null when no profile layers array (geojsonLayers / geojson.layers / layers / Layers)", async () => {
            mockGetActiveProfile.mockReturnValue({ id: "p1" });
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
        });

        it("returns null when layerId not in profile layers", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [{ id: "other", dataFile: "x.json", _layerDirectory: "d" }],
            });
            mockConfigGet.mockReturnValue("profiles");
            LoaderSingleLayer._loadSingleLayer = null;
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
        });

        it("returns null when _resolveDataFilePath returns null", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [{ id: "l1", _layerDirectory: "dir" }],
            });
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
        });

        it("returns null when LoaderSingleLayer._loadSingleLayer is null", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [
                    { id: "l1", dataFile: "d.json", _layerDirectory: "dir", label: "Layer 1" },
                ],
            });
            mockConfigGet.mockReturnValue("profiles");
            LoaderSingleLayer._loadSingleLayer = null;
            expect(await TA._loadLayerFromProfile("l1")).toBeNull();
        });

        it("uses geojson.layers when geojsonLayers not array", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojson: { layers: [{ id: "l1", dataFile: "d.json", _layerDirectory: "dir" }] },
            });
            mockConfigGet.mockReturnValue("profiles");
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer" });
            const result = await TA._loadLayerFromProfile("l1");
            expect(result).toEqual({ id: "layer" });
        });

        it("loads layer with cache miss and normalizes popup/tooltip/sidepanel and clustering", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [
                    {
                        id: "l1",
                        dataFile: "d.json",
                        _layerDirectory: "dir",
                        label: "L1",
                        popup: { fields: ["a"] },
                        tooltip: { fields: ["b"] },
                        sidepanel: { detailLayout: ["c"] },
                        clustering: {
                            enabled: true,
                            maxClusterRadius: 50,
                            disableClusteringAtZoom: 10,
                        },
                    },
                ],
            });
            mockConfigGet.mockReturnValue("profiles");
            mockThemeCacheGet.mockResolvedValue(null);
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer" });
            const result = await TA._loadLayerFromProfile("l1");
            expect(result).toEqual({ id: "layer" });
            const callArg = mockLoader.mock.calls[0][2];
            expect(callArg.clustering).toBe(true);
            expect(callArg.maxClusterRadius).toBe(50);
            expect(callArg.disableClusteringAtZoom).toBe(10);
        });

        it("uses cached data when ThemeCache.get returns data and refreshes cache on success", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [
                    { id: "l1", dataFile: "d.json", _layerDirectory: "dir", label: "L1" },
                ],
            });
            mockConfigGet.mockReturnValue("profiles");
            mockThemeCacheGet.mockResolvedValue({ cached: true });
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer" });
            await TA._loadLayerFromProfile("l1");
            expect(mockThemeCacheStore).toHaveBeenCalledWith("l1", "p1", { cached: true });
        });

        it("returns null and logs when loader throws", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p1",
                geojsonLayers: [
                    { id: "l1", dataFile: "d.json", _layerDirectory: "dir", label: "L1" },
                ],
            });
            mockConfigGet.mockReturnValue("profiles");
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockRejectedValue(new Error("load failed"));
            const result = await TA._loadLayerFromProfile("l1");
            expect(result).toBeNull();
        });

        it("uses null profileId when activeProfile.id is undefined", async () => {
            mockGetActiveProfile.mockReturnValue({
                geojsonLayers: [
                    { id: "l1", dataFile: "d.json", _layerDirectory: "dir", label: "L1" },
                ],
            });
            mockConfigGet.mockReturnValue("profiles");
            // Return cached data so ThemeCache.store gets called (TTL refresh)
            mockThemeCacheGet.mockResolvedValue({ cached: true });
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer-data" });
            await TA._loadLayerFromProfile("l1");
            // profileId should be null because activeProfile has no .id
            expect(mockThemeCacheStore).toHaveBeenCalledWith("l1", null, expect.anything());
        });

        it("reads layers from profile.geojson.layers fallback", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p2",
                geojson: { layers: [{ id: "l2", dataFile: "d2.json", _layerDirectory: "dir2" }] },
            });
            mockConfigGet.mockReturnValue("profiles");
            mockThemeCacheGet.mockResolvedValue(null);
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer-data2" });
            const result = await TA._loadLayerFromProfile("l2");
            expect(result).not.toBeNull();
        });

        it("reads layers from profile.layers fallback", async () => {
            mockGetActiveProfile.mockReturnValue({
                id: "p3",
                layers: [{ id: "l3", dataFile: "d3.json", _layerDirectory: "dir3" }],
            });
            mockConfigGet.mockReturnValue("profiles");
            mockThemeCacheGet.mockResolvedValue(null);
            LoaderSingleLayer._loadSingleLayer = mockLoader;
            mockLoader.mockResolvedValue({ id: "layer-data3" });
            const result = await TA._loadLayerFromProfile("l3");
            expect(result).not.toBeNull();
        });
    });
});
