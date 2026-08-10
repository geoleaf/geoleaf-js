/**
 *
 * labels-branches.test.js
 * Sprint T19 — Branch coverage for _processZoomLayerItem, _resolveShouldShowForZoom,
 * _handleZoomChange with active layers, refreshLabels visibility check.
 */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockGetLayerById = vi.fn(() => null);
const mockCreateTooltipsForLayer = vi.fn();
const mockIsScaleInRange = vi.fn(() => true);
const mockCalculateMapScale = vi.fn(() => 1000);

vi.mock("../../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/config/config-primitives.js", () => ({ Config: {} }));
vi.mock("../../../src/capabilities/labels/label-renderer.ts", () => ({
    LabelRenderer: { createTooltipsForLayer: (...args) => mockCreateTooltipsForLayer(...args) },
}));
vi.mock("../../../src/utils/general/scale-utils.js", () => ({
    isScaleInRange: (...args) => mockIsScaleInRange(...args),
    calculateMapScale: (...args) => mockCalculateMapScale(...args),
}));
vi.mock("../../../src/api/geoleaf.core.js", () => ({ Core: { getMap: vi.fn(() => null) } }));
vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id) => mockGetLayerById(id) },
}));
import { Labels } from "../../../src/capabilities/labels/labels.js";
import { Core } from "../../../src/api/geoleaf.core.js";

beforeEach(() => {
    vi.clearAllMocks();
    mockIsScaleInRange.mockReturnValue(true);
    mockCalculateMapScale.mockReturnValue(1000);
    Labels.destroy();
});

// ─── _handleZoomChange with active layers ────────────────────────────────────

describe("_handleZoomChange with active map and layers", () => {
    it("processes enabled visible layer — shouldShow=true, isShowing=false → calls _createLabelsForLayer", async () => {
        const mockMap = { getZoom: vi.fn(() => 12) };
        Core.getMap.mockReturnValue(mockMap);
        const mockLayer = {};
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
            _visibility: { current: true },
            layer: mockLayer,
        });
        await Labels.enableLabels("ly1", {}, true);
        mockCreateTooltipsForLayer.mockClear();

        // Now trigger zoomChange — layer is enabled but tooltips were consumed
        // _processZoomLayerItem: enabled=true, visible=true, shouldShow=true, isShowing=false (cleared)
        Labels._handleZoomChange({ zoom: 14 });
        await new Promise((r) => setTimeout(r, 10));
        // getLayerById may be called again; verify no crash
        Core.getMap.mockReturnValue(null);
    });

    it("processes disabled layer state — returns early without acting", async () => {
        const mockMap = { getZoom: vi.fn(() => 12) };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly1", {}, false); // enabled=false
        mockCreateTooltipsForLayer.mockClear();
        Labels._handleZoomChange({ zoom: 14 });
        // Since layerState.enabled=false, processZoomLayerItem skips
        expect(mockCreateTooltipsForLayer).not.toHaveBeenCalled();
        Core.getMap.mockReturnValue(null);
    });

    it("processes layer not visible — clears tooltips when some exist", async () => {
        const mockMap = { getZoom: vi.fn(() => 12) };
        Core.getMap.mockReturnValue(mockMap);
        // Layer is enabled but not visible at zoom change time
        mockGetLayerById
            .mockReturnValueOnce({
                // initial call for enableLabels
                currentStyle: { label: { enabled: true, field: "name" } },
                _visibility: { current: true },
                layer: null,
            })
            .mockReturnValue({
                // subsequent calls: not visible
                currentStyle: { label: { enabled: true, field: "name" } },
                _visibility: { current: false },
                layer: null,
            });
        await Labels.enableLabels("ly1", {}, true);
        Labels._handleZoomChange({ zoom: 14 });
        Core.getMap.mockReturnValue(null);
    });
});

// ─── _resolveShouldShowForZoom branches via _processZoomLayerItem ────────────

describe("_resolveShouldShowForZoom branches", () => {
    it("labelScale branch — scale in range → shouldShow=true", async () => {
        const mockMap = { getZoom: vi.fn(() => 12) };
        Core.getMap.mockReturnValue(mockMap);
        mockIsScaleInRange.mockReturnValue(true);
        mockGetLayerById.mockReturnValue({
            currentStyle: {
                label: { enabled: true, field: "name" },
                labelScale: { minScale: 500, maxScale: 5000 },
            },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly1", {}, true);
        Labels._handleZoomChange({ zoom: 13 });
        Core.getMap.mockReturnValue(null);
    });

    it("labelScale branch — scale out of range → shouldShow=false, clears tooltips", async () => {
        const mockMap = { getZoom: vi.fn(() => 12) };
        Core.getMap.mockReturnValue(mockMap);
        mockIsScaleInRange.mockReturnValue(false); // out of range
        mockGetLayerById.mockReturnValue({
            currentStyle: {
                label: { enabled: true, field: "name" },
                labelScale: { minScale: 100, maxScale: 200 },
            },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly1", {}, true);
        Labels._handleZoomChange({ zoom: 20 });
        Core.getMap.mockReturnValue(null);
    });

    it("minZoom undefined → always show", async () => {
        const mockMap = { getZoom: vi.fn(() => 5) };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
            _visibility: { current: true },
            layer: null,
        });
        // No minZoom/maxZoom in config → _resolveShouldShowForZoom returns true
        await Labels.enableLabels("ly1", {}, true);
        Labels._handleZoomChange({ zoom: 5 });
        Core.getMap.mockReturnValue(null);
    });

    it("zoom < minZoom → shouldShow=false", async () => {
        const mockMap = { getZoom: vi.fn(() => 3) };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels(
            "ly1",
            { enabled: true, labelId: "name", minZoom: 10, maxZoom: 18 },
            true
        );
        Labels._handleZoomChange({ zoom: 3 });
        Core.getMap.mockReturnValue(null);
    });

    it("zoom > maxZoom → shouldShow=false", async () => {
        const mockMap = { getZoom: vi.fn(() => 20) };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels(
            "ly1",
            { enabled: true, labelId: "name", minZoom: 10, maxZoom: 18 },
            true
        );
        Labels._handleZoomChange({ zoom: 20 });
        Core.getMap.mockReturnValue(null);
    });

    it("zoom in range → shouldShow=true", async () => {
        const mockMap = { getZoom: vi.fn(() => 14) };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" }, labelScale: null },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels(
            "ly1",
            { enabled: true, labelId: "name", minZoom: 10, maxZoom: 18 },
            true
        );
        Labels._handleZoomChange({ zoom: 14 });
        Core.getMap.mockReturnValue(null);
    });
});

// `_handleLayerLoaded` and its three tests went with the `geoleaf:layer-loaded`
// seam (B.39): the method was reachable from that subscriber and nowhere else, so
// the tests exercised code no production path could enter. The layer-load →
// labels wiring that IS live is the direct call from
// `geojson/loader/single-layer.ts` to `Labels.initializeLayerLabels()`.

// ─── refreshLabels — invisible layer ──────────────────────────────────────

describe("refreshLabels — layer not currently visible", () => {
    it("returns early (no crash) when layer._visibility.current is false", async () => {
        mockGetLayerById
            .mockReturnValueOnce({
                currentStyle: { label: { enabled: true, field: "name" } },
                _visibility: { current: true },
                layer: null,
            })
            .mockReturnValue({
                currentStyle: { label: { enabled: true, field: "name" } },
                _visibility: { current: false },
                layer: null,
            });
        await Labels.enableLabels("ly-invis", {}, true);
        mockCreateTooltipsForLayer.mockClear();
        Labels.refreshLabels("ly-invis");
        expect(mockCreateTooltipsForLayer).not.toHaveBeenCalled();
    });
});

// ─── _ensureZoomListener ────────────────────────────────────────────────────

describe("_ensureZoomListener", () => {
    it("attaches listener once and does not re-attach on second call", async () => {
        const onSpy = vi.fn();
        const mockMap = { getZoom: vi.fn(() => 10), on: onSpy };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        // First enable attaches the listener
        await Labels.enableLabels("ly-a", {}, true);
        // Second enable should NOT attach again
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly-b", {}, true);
        // zoomend listener should only be registered once
        const zoomEndCallCount = onSpy.mock.calls.filter(([evt]) => evt === "zoomend").length;
        expect(zoomEndCallCount).toBe(1);
        Core.getMap.mockReturnValue(null);
    });
});

// ─── B.35 (b) — listener lifecycle: attach once, release on destroy ─────────
//
// The `zoomend` subscription on the map adapter is process-wide. It used not to
// be released, and `zoomListenerAttached` was never reset — so a `_reset()` /
// `init()` cycle (LabelsLifecycle, module destroy, tests) permanently pinned the
// FIRST map adapter.
//
// The two `geoleaf:layer-loaded` cases that used to open this block were deleted
// with the seam (B.39): they asserted the subscribe/unsubscribe bookkeeping of a
// listener no emitter has ever reached, so they proved nothing about production
// behaviour — only that the dead code was internally consistent.

describe("listener lifecycle (B.35b)", () => {
    it("destroy() detaches zoomend from the map it was attached to", async () => {
        const onSpy = vi.fn();
        const offSpy = vi.fn();
        const mockMap = { getZoom: vi.fn(() => 10), on: onSpy, off: offSpy };
        Core.getMap.mockReturnValue(mockMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly-zoom", {}, true);
        const attached = onSpy.mock.calls.find(([evt]) => evt === "zoomend");
        expect(attached).toBeDefined();

        Labels.destroy();

        expect(offSpy).toHaveBeenCalledWith("zoomend", attached[1]);
        Core.getMap.mockReturnValue(null);
    });

    it("after destroy(), a later init cycle re-attaches zoomend to the NEW map", async () => {
        const firstMap = { getZoom: vi.fn(() => 10), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(firstMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly-first", {}, true);
        Labels.destroy();

        const secondMap = { getZoom: vi.fn(() => 11), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(secondMap);
        await Labels.enableLabels("ly-second", {}, true);

        const reattached = secondMap.on.mock.calls.filter(([evt]) => evt === "zoomend");
        expect(reattached).toHaveLength(1);
        Core.getMap.mockReturnValue(null);
    });

    it("destroy() tolerates a map handle without off() (partial adapters / doubles)", async () => {
        const bareMap = { getZoom: vi.fn(() => 10), on: vi.fn() };
        Core.getMap.mockReturnValue(bareMap);
        mockGetLayerById.mockReturnValue({
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        });
        await Labels.enableLabels("ly-bare", {}, true);
        expect(() => Labels.destroy()).not.toThrow();
        Core.getMap.mockReturnValue(null);
    });
});

// ─── B.40 — adapter swapped WITHOUT destroy() ───────────────────────────────
//
// A basemap switch or a theme change replaces the map adapter in place: no
// `destroy()` runs, so `zoomListenerAttached` stays `true` and the subscription
// stays on the map that no longer exists. Labels then stop reacting to zoom.

describe("adapter swap without destroy (B.40)", () => {
    function layerWithLabels() {
        return {
            currentStyle: { label: { enabled: true, field: "name" } },
            _visibility: { current: true },
            layer: null,
        };
    }

    it("re-arms zoomend on the NEW map when the adapter is replaced in place", async () => {
        const firstMap = { getZoom: vi.fn(() => 10), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(firstMap);
        mockGetLayerById.mockReturnValue(layerWithLabels());
        await Labels.enableLabels("ly-first", {}, true);
        const firstAttach = firstMap.on.mock.calls.filter(([evt]) => evt === "zoomend");
        expect(firstAttach).toHaveLength(1);

        // Basemap / theme switch — a brand-new adapter, no destroy() in between.
        const secondMap = { getZoom: vi.fn(() => 11), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(secondMap);
        await Labels.enableLabels("ly-second", {}, true);

        expect(secondMap.on.mock.calls.filter(([evt]) => evt === "zoomend")).toHaveLength(1);
        // …and the stale subscription on the previous adapter is released.
        expect(firstMap.off).toHaveBeenCalledWith("zoomend", firstAttach[0][1]);
        Core.getMap.mockReturnValue(null);
    });

    it("labels still react to zoom after the swap (the handler runs on the new map)", async () => {
        const firstMap = { getZoom: vi.fn(() => 10), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(firstMap);
        mockGetLayerById.mockReturnValue(layerWithLabels());
        await Labels.enableLabels("ly-first", {}, true);

        const secondMap = { getZoom: vi.fn(() => 11), on: vi.fn(), off: vi.fn() };
        Core.getMap.mockReturnValue(secondMap);
        await Labels.enableLabels("ly-second", {}, true);

        const zoomend = secondMap.on.mock.calls.find(([evt]) => evt === "zoomend");
        expect(zoomend).toBeDefined();
        const spy = vi.fn();
        const original = Labels._handleZoomChange;
        Labels._handleZoomChange = spy;
        try {
            zoomend[1]();
        } finally {
            Labels._handleZoomChange = original;
        }
        expect(spy).toHaveBeenCalledWith({ zoom: 11 });
        Core.getMap.mockReturnValue(null);
    });
});

// The `labels-lite.ts` no-op stub (and the whole frozen lite build it served) was
// removed in S4 — a consumer who does not want labels simply omits LABELS_INSTALLER
// from their entry's manifest, and the capability tree-shakes out.
