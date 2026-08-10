/**
 * Label teardown when a layer removal throws.
 *
 * Despite the name, `layerState.tooltips` holds no DOM tooltips: each entry is a
 * closure calling `nativeMap.removeLayer(labelLayerId)` (label-renderer.ts). That
 * call throws if the MapLibre style was reloaded or destroyed in between — a
 * basemap switch or a theme change is enough. Three of the teardown paths wrapped
 * it in a try/catch; the shared `_clearTooltips` helper, used by the zoom path,
 * did not.
 *
 * The load-bearing assertion here is `tooltips.size === 0`. A throw must not stop
 * the map from being cleared: `_processZoomLayerItem` reads `tooltips.size > 0` as
 * "labels are currently showing", so a map left non-empty pins `isShowing` to true
 * and `_createLabelsForLayer` is never called again — the layer loses its labels
 * for the rest of the session, silently. That is why the catch must sit inside the
 * forEach callback and `.clear()` outside it.
 */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockGetLayerById = vi.fn(() => null);
const mockCreateTooltipsForLayer = vi.fn();
const mockCreateSymbolLayerForMapLibre = vi.fn();

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({ Config: {} }));
vi.mock("../../../src/capabilities/labels/label-renderer.ts", () => ({
    LabelRenderer: {
        createTooltipsForLayer: (...args) => mockCreateTooltipsForLayer(...args),
        createSymbolLayerForMapLibre: (...args) => mockCreateSymbolLayerForMapLibre(...args),
    },
}));
vi.mock("../../../src/utils/general/scale-utils.js", () => ({
    isScaleInRange: vi.fn(() => true),
    calculateMapScale: vi.fn(() => 1000),
}));
// A truthy map handle is required: `_handleZoomChange` bails out before reaching
// the teardown when `Core.getMap()` is null, which would make the zoom-path tests
// pass without executing a single line of what they claim to cover.
const mapHandle = { getZoom: () => 8 };
vi.mock("../../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: vi.fn(() => mapHandle) },
}));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id) => mockGetLayerById(id) },
}));

import { Labels } from "../../../src/capabilities/labels/labels.js";

/** Tracks which removals ran, so we can prove the catch is per-entry. */
let removed;

/**
 * Makes the renderer mock populate the tooltip map with three removal closures,
 * the middle one throwing — the shape `label-renderer.ts` produces when
 * `nativeMap.removeLayer()` fails on a stale style.
 */
function seedTooltips({ throwOn = "b" } = {}) {
    mockCreateSymbolLayerForMapLibre.mockImplementation((_id, _cfg, _style, tooltips) => {
        for (const key of ["a", "b", "c"]) {
            tooltips.set(key, {
                remove: () => {
                    removed.push(key);
                    if (key === throwOn) throw new Error("style reloaded");
                },
            });
        }
    });
}

/** Brings a layer up with three seeded tooltips and returns its state map. */
async function enableSeededLayer(layerId = "ly1") {
    mockGetLayerById.mockReturnValue({
        currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
        _visibility: { current: true },
        layer: null,
        features: [],
    });
    await Labels.enableLabels(layerId, {}, true);
}

describe("label teardown survives a throwing layer removal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Labels.destroy();
        removed = [];
        seedTooltips();
    });

    describe("disableLabels", () => {
        it("does not propagate the throw", async () => {
            await enableSeededLayer();
            expect(() => Labels.disableLabels("ly1")).not.toThrow();
        });

        it("still removes the entries after the throwing one", async () => {
            await enableSeededLayer();
            Labels.disableLabels("ly1");
            expect(removed).toEqual(["a", "b", "c"]);
        });

        it("still disables the layer", async () => {
            await enableSeededLayer();
            Labels.disableLabels("ly1");
            expect(Labels.areLabelsEnabled("ly1")).toBe(false);
        });
    });

    describe("refreshLabels", () => {
        it("does not propagate the throw", async () => {
            await enableSeededLayer();
            expect(() => Labels.refreshLabels("ly1")).not.toThrow();
        });

        it("still rebuilds the labels afterwards", async () => {
            await enableSeededLayer();
            mockCreateSymbolLayerForMapLibre.mockClear();
            Labels.refreshLabels("ly1");
            // The rebuild is what proves the throw did not abort the method.
            expect(mockCreateSymbolLayerForMapLibre).toHaveBeenCalled();
        });
    });

    // No test covered this method's real body before — the visibility-manager
    // suites only assert that a mock of it gets called.
    describe("_hideLabelsForLayer", () => {
        it("does not propagate the throw", async () => {
            await enableSeededLayer();
            expect(() => Labels._hideLabelsForLayer("ly1")).not.toThrow();
        });

        it("hides without disabling — that is toggleLabels' job", async () => {
            await enableSeededLayer();
            Labels._hideLabelsForLayer("ly1");
            expect(Labels.areLabelsEnabled("ly1")).toBe(true);
        });

        it("empties the tooltip map so the layer is not stuck 'showing'", async () => {
            await enableSeededLayer();
            Labels._hideLabelsForLayer("ly1");
            // A non-empty map here pins `isShowing` true in _processZoomLayerItem
            // and the layer never rebuilds its labels again.
            mockCreateSymbolLayerForMapLibre.mockClear();
            Labels.refreshLabels("ly1");
            expect(mockCreateSymbolLayerForMapLibre).toHaveBeenCalled();
        });
    });

    // The zoom path is the one that had no protection at all: it goes through
    // the shared `_clearTooltips` helper, which carried no try/catch.
    describe("zoom path (_handleZoomChange → _clearTooltips)", () => {
        it("does not propagate the throw when the layer scrolls out of view", async () => {
            await enableSeededLayer();
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
                _visibility: { current: false },
                layer: null,
                features: [],
            });
            expect(() => Labels._handleZoomChange({ zoom: 8 })).not.toThrow();
        });

        it("still clears every entry despite the throw", async () => {
            await enableSeededLayer();
            mockGetLayerById.mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
                _visibility: { current: false },
                layer: null,
                features: [],
            });
            removed = [];
            Labels._handleZoomChange({ zoom: 8 });
            expect(removed).toEqual(["a", "b", "c"]);
        });
    });
});
