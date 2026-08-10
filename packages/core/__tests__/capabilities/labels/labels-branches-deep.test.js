/**
 * @fileoverview Deep branch coverage for labels module (T10.2.5)
 *
 * Strategy: await import() — Istanbul ESM instrumentation active.
 * Mocks: only Core.getMap, GeoJSONCore.getLayerById (boundary of the map engine),
 *        _UIComponents.attachEventHandler (DOM event plumbing only).
 * NOT mocked: LabelRenderer, LabelButtonManager (execute for real instrumentation).
 *
 * Targets:
 *   - labels.ts              : enableLabels, disableLabels, toggleLabels, initializeLayerLabels,
 *                              refreshLabels, _createLabelsForLayer, _handleZoomChange,
 *                              _resolveLabelStyleConfig branches (integratedLabel, disabled,
 *                              configLabel), _computeShouldShow, _isOutOfRange (zoom, scale),
 *                              _processZoomLayerItem, destroy
 *   - label-renderer.ts      : createSymbolLayerForMapLibre, _resolveMapFontStack
 *   - label-button-manager.ts: createButton, _doSync, _getState, _applyState,
 *                              syncImmediate
 */

// ── vi.mock calls (hoisted before imports) ─────────────────────────────────

const _mockGetLayerById = vi.fn(() => null);
const _mockGetMap = vi.fn(() => null);

vi.mock("../../../src/api/geoleaf.core.js", () => ({
    Core: { getMap: _mockGetMap },
}));

vi.mock("../../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerById: (id) => _mockGetLayerById(id) },
}));

vi.mock("../../../src/kernel/ui/components.js", () => ({
    _UIComponents: {
        attachEventHandler: (el, ev, fn) => el.addEventListener(ev, fn),
    },
}));

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/utils/i18n/i18n.js", () => ({
    getLabel: (key) => key,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function _makeMapLibreAdapter() {
    const layers = {};
    const sources = {};
    const nativeMap = {
        getSource: vi.fn((id) => sources[id] ?? null),
        getLayer: vi.fn((id) => layers[id] ?? null),
        addLayer: vi.fn((layer) => {
            layers[layer.id] = layer;
        }),
        removeLayer: vi.fn((id) => {
            delete layers[id];
        }),
        getStyle: vi.fn(() => ({
            layers: [
                {
                    type: "symbol",
                    layout: { "text-font": ["Noto Sans Regular"] },
                },
            ],
        })),
        getZoom: vi.fn(() => 12),
        on: vi.fn(),
    };
    return {
        getNativeMap: vi.fn(() => nativeMap),
        getLayerRegistry: vi.fn(() => ({
            getSourceId: vi.fn((layerId) => `gl-src-${layerId}`),
        })),
        createMarker: vi.fn((latlng, opts) => ({
            latlng,
            opts,
            addTo: vi.fn(),
            remove: vi.fn(),
        })),
        getZoom: vi.fn(() => 12),
        on: vi.fn(),
        _nativeMap: nativeMap,
    };
}

function _makeLayerData(overrides = {}) {
    return {
        features: [
            {
                id: "f1",
                type: "Feature",
                geometry: { type: "Point", coordinates: [6.0, 45.0] },
                properties: { name: "Mon POI", category: "hiking" },
            },
        ],
        _visibility: { current: true },
        currentStyle: {},
        ...overrides,
    };
}

// ── Modules ────────────────────────────────────────────────────────────────

let Labels, LabelRenderer, LabelButtonManager;

describe("labels-branches-deep (T10.2.5)", () => {
    beforeAll(async () => {
        const labelsMod = await import("../../../src/capabilities/labels/labels.ts");
        Labels = labelsMod.Labels;

        const rendererMod = await import("../../../src/capabilities/labels/label-renderer.ts");
        LabelRenderer = rendererMod.LabelRenderer;

        const buttonMgr = await import("../../../src/capabilities/labels/label-button-manager.ts");
        LabelButtonManager = buttonMgr.LabelButtonManager;
    });

    beforeEach(() => {
        vi.clearAllMocks();
        _mockGetLayerById.mockReturnValue(null);
        _mockGetMap.mockReturnValue(null);
        Labels.destroy();
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels — basic exports
    // ════════════════════════════════════════════════════════════════════

    describe("Labels exports", () => {
        test("all public methods exist", () => {
            expect(typeof Labels.init).toBe("function");
            expect(typeof Labels.enableLabels).toBe("function");
            expect(typeof Labels.disableLabels).toBe("function");
            expect(typeof Labels.toggleLabels).toBe("function");
            expect(typeof Labels.hasLabelConfig).toBe("function");
            expect(typeof Labels.areLabelsEnabled).toBe("function");
            expect(typeof Labels.refreshLabels).toBe("function");
            expect(typeof Labels.destroy).toBe("function");
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.enableLabels — branch coverage
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.enableLabels", () => {
        test("warns when layerId missing", async () => {
            await Labels.enableLabels("");
            expect(Labels.hasLabelConfig("")).toBe(false);
        });

        test("throws on obsolete styleFile config", async () => {
            await expect(
                Labels.enableLabels("layer1", { styleFile: "style.json" })
            ).rejects.toThrow("Obsolete configuration");
        });

        test("no label config → no state created", async () => {
            _mockGetLayerById.mockReturnValue(_makeLayerData());
            await Labels.enableLabels("layer-no-label", {}, true);
            expect(Labels.hasLabelConfig("layer-no-label")).toBe(false);
        });

        test("integratedLabel disabled branch → skips", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: { label: { enabled: false, labelId: "name" } },
                })
            );
            await Labels.enableLabels("layer-disabled", {}, true);
            expect(Labels.hasLabelConfig("layer-disabled")).toBe(false);
        });

        test("integratedLabel enabled, visibleByDefault=true, layer visible", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("layer-enabled", {}, true);
            expect(Labels.hasLabelConfig("layer-enabled")).toBe(true);
            expect(Labels.areLabelsEnabled("layer-enabled")).toBe(true);
        });

        test("integratedLabel enabled, visibleByDefault=false → state set but not shown", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: false },
                    },
                })
            );
            await Labels.enableLabels("layer-hidden", {}, true);
            expect(Labels.hasLabelConfig("layer-hidden")).toBe(true);
            expect(Labels.areLabelsEnabled("layer-hidden")).toBe(false);
        });

        test("integratedLabel with labelScale config", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                        labelScale: { minScale: 1000, maxScale: 50000 },
                    },
                })
            );
            await Labels.enableLabels("layer-scale", {}, true);
            expect(Labels.hasLabelConfig("layer-scale")).toBe(true);
        });

        test("configLabel path (labelConfig.labelId set)", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(_makeLayerData());
            await Labels.enableLabels(
                "layer-config",
                {
                    enabled: true,
                    labelId: "name",
                    font: { family: "Arial", sizePt: 12 },
                    color: "#ff0000",
                },
                true
            );
            expect(Labels.hasLabelConfig("layer-config")).toBe(true);
        });

        test("layer not visible — _computeShouldShow=false, but enabled=visibleByDefault", async () => {
            // Layer currently invisible — _computeShouldShow returns false (no markers rendered),
            // but the enabled state = visibleByDefault = true (set in state before the check).
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    _visibility: { current: false },
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("layer-invisible", {}, true);
            expect(Labels.hasLabelConfig("layer-invisible")).toBe(true);
            // enabled = visibleByDefault = true (rendering skipped by _computeShouldShow)
            expect(Labels.areLabelsEnabled("layer-invisible")).toBe(true);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.disableLabels
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.disableLabels", () => {
        test("no-op when layerId empty", () => {
            Labels.disableLabels("");
        });

        test("no-op when layer has no state", () => {
            Labels.disableLabels("nonexistent");
        });

        test("disables and clears tooltips", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("lyr-disable", {}, true);
            expect(Labels.areLabelsEnabled("lyr-disable")).toBe(true);
            Labels.disableLabels("lyr-disable");
            expect(Labels.areLabelsEnabled("lyr-disable")).toBe(false);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.toggleLabels
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.toggleLabels", () => {
        test("returns false when layerId empty", () => {
            expect(Labels.toggleLabels("")).toBe(false);
        });

        test("returns false when no state", () => {
            expect(Labels.toggleLabels("nonexistent")).toBe(false);
        });

        test("returns false when label not enabled in style", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: { label: { enabled: false } },
                })
            );
            await Labels.enableLabels("lyr-toggle-off", { enabled: true, labelId: "name" }, true);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: { label: { enabled: false } },
                })
            );
            const result = Labels.toggleLabels("lyr-toggle-off");
            expect(result).toBe(false);
        });

        test("toggling from enabled → disabled", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("lyr-toggle", {}, true);
            expect(Labels.areLabelsEnabled("lyr-toggle")).toBe(true);
            const result = Labels.toggleLabels("lyr-toggle");
            expect(result).toBe(false);
        });

        test("toggling from disabled → enabled", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: false },
                    },
                })
            );
            await Labels.enableLabels("lyr-toggle2", {}, true);
            // initially disabled
            expect(Labels.areLabelsEnabled("lyr-toggle2")).toBe(false);
            const result = Labels.toggleLabels("lyr-toggle2");
            expect(result).toBe(true);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.initializeLayerLabels
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.initializeLayerLabels", () => {
        test("returns early when layerId empty", () => {
            Labels.initializeLayerLabels("");
        });

        test("returns early when layer data not found", () => {
            _mockGetLayerById.mockReturnValue(null);
            Labels.initializeLayerLabels("nonexistent");
        });

        test("returns early when label not enabled in currentStyle", () => {
            _mockGetLayerById.mockReturnValue(_makeLayerData({ currentStyle: {} }));
            Labels.initializeLayerLabels("lyr-noenable");
        });

        test("label visibleByDefault=false → enableLabels with false", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, visibleByDefault: false },
                    },
                    _visibility: { current: true },
                })
            );
            Labels.initializeLayerLabels("lyr-notvisible");
            await new Promise((r) => setTimeout(r, 20));
            expect(Labels.hasLabelConfig("lyr-notvisible")).toBe(true);
        });

        test("layer hidden — enableLabels called with false", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, visibleByDefault: true },
                    },
                    _visibility: { current: false },
                })
            );
            Labels.initializeLayerLabels("lyr-hidden-init");
            await new Promise((r) => setTimeout(r, 20));
            expect(Labels.hasLabelConfig("lyr-hidden-init")).toBe(true);
        });

        test("label visibleByDefault=true, layer visible → enableLabels visible", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                    _visibility: { current: true },
                })
            );
            Labels.initializeLayerLabels("lyr-visible-init");
            await new Promise((r) => setTimeout(r, 20));
            expect(Labels.hasLabelConfig("lyr-visible-init")).toBe(true);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.refreshLabels
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.refreshLabels", () => {
        test("no-op when layerId empty", () => {
            Labels.refreshLabels("");
        });

        test("no-op when no state", () => {
            Labels.refreshLabels("nonexistent");
        });

        test("no-op when state.enabled=false", async () => {
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: false },
                    },
                })
            );
            await Labels.enableLabels("lyr-refresh-off", {}, false);
            Labels.refreshLabels("lyr-refresh-off");
        });

        test("refreshes labels when enabled and visible", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("lyr-refresh", {}, true);
            Labels.refreshLabels("lyr-refresh");
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels — isOutOfRange zoom/scale branches
    // ════════════════════════════════════════════════════════════════════

    describe("Labels._createLabelsForLayer — isOutOfRange branches", () => {
        test("minZoom/maxZoom — current zoom out of range suppresses labels", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getZoom.mockReturnValue(5); // too low
            adapter.getZoom = vi.fn(() => 5);
            // Make it return zoom 5 from map.getZoom
            const mockMap = {
                getZoom: vi.fn(() => 5),
                on: vi.fn(),
            };
            _mockGetMap.mockReturnValue(mockMap);
            _mockGetLayerById.mockReturnValue(_makeLayerData());
            await Labels.enableLabels(
                "lyr-zoom",
                { enabled: true, labelId: "name", minZoom: 10, maxZoom: 16 },
                true
            );
            // label config created but out of range → no markers
            expect(Labels.hasLabelConfig("lyr-zoom")).toBe(true);
        });

        test("minZoom/maxZoom — current zoom in range", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            const mockMap = {
                getZoom: vi.fn(() => 12),
                on: vi.fn(),
                getNativeMap: vi.fn(() => adapter._nativeMap),
                getLayerRegistry: vi.fn(() => ({
                    getSourceId: vi.fn(() => "gl-src-lyr-zoom-in"),
                })),
                createMarker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
            };
            _mockGetMap.mockReturnValue(mockMap);
            _mockGetLayerById.mockReturnValue(_makeLayerData());
            await Labels.enableLabels(
                "lyr-zoom-in",
                { enabled: true, labelId: "name", minZoom: 10, maxZoom: 16 },
                true
            );
            expect(Labels.hasLabelConfig("lyr-zoom-in")).toBe(true);
        });

        test("zoom too high → out of range", async () => {
            const mockMap = {
                getZoom: vi.fn(() => 20),
                on: vi.fn(),
            };
            _mockGetMap.mockReturnValue(mockMap);
            _mockGetLayerById.mockReturnValue(_makeLayerData());
            await Labels.enableLabels(
                "lyr-zoom-high",
                { enabled: true, labelId: "name", minZoom: 10, maxZoom: 16 },
                true
            );
            expect(Labels.hasLabelConfig("lyr-zoom-high")).toBe(true);
        });

        test("no features on layer → warns", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue({
                _visibility: { current: true },
                // no features property
            });
            await Labels.enableLabels("lyr-no-features", { enabled: true, labelId: "name" }, true);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // Labels.destroy
    // ════════════════════════════════════════════════════════════════════

    describe("Labels.destroy", () => {
        test("destroys all layer states", async () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            _mockGetLayerById.mockReturnValue(
                _makeLayerData({
                    currentStyle: {
                        label: { enabled: true, labelId: "name", visibleByDefault: true },
                    },
                })
            );
            await Labels.enableLabels("lyr-destroy1", {}, true);
            await Labels.enableLabels("lyr-destroy2", {}, false);
            expect(Labels.hasLabelConfig("lyr-destroy1")).toBe(true);
            Labels.destroy();
            expect(Labels.hasLabelConfig("lyr-destroy1")).toBe(false);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // LabelRenderer.createSymbolLayerForMapLibre
    // ════════════════════════════════════════════════════════════════════

    describe("LabelRenderer.createSymbolLayerForMapLibre", () => {
        test("warns when no labelId", () => {
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre("lyr", {}, {}, tooltips);
            expect(tooltips.size).toBe(0);
        });

        test("warns when no map adapter", () => {
            _mockGetMap.mockReturnValue(null);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre("lyr", { labelId: "name" }, {}, tooltips);
            expect(tooltips.size).toBe(0);
        });

        test("warns when adapter lacks getNativeMap", () => {
            _mockGetMap.mockReturnValue({ no: "native" });
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre("lyr", { labelId: "name" }, {}, tooltips);
            expect(tooltips.size).toBe(0);
        });

        test("warns when source not found", () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue(null);
            _mockGetMap.mockReturnValue(adapter);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre("lyr", { labelId: "name" }, {}, tooltips);
            expect(tooltips.size).toBe(0);
        });

        test("creates symbol layer when source exists", () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre(
                "lyr-sym",
                { labelId: "name" },
                {
                    color: "#ff0000",
                    opacity: 0.9,
                    font: { sizePt: 14 },
                    buffer: { enabled: true, color: "#ffffff", sizePx: 2, opacity: 1 },
                },
                tooltips
            );
            expect(tooltips.size).toBe(1);
            expect(adapter._nativeMap.addLayer).toHaveBeenCalled();
        });

        test("removes existing label layer before adding", () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            adapter._nativeMap.getLayer.mockReturnValue({ id: "gl-lyr-dup-label-text" }); // exists
            _mockGetMap.mockReturnValue(adapter);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre(
                "lyr-dup",
                { labelId: "name" },
                {},
                tooltips
            );
            expect(adapter._nativeMap.removeLayer).toHaveBeenCalledWith("gl-lyr-dup-label-text");
        });

        test("stored removal function removes layer", () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            adapter._nativeMap.getLayer
                .mockReturnValueOnce(null)
                .mockReturnValueOnce({ id: "gl-lyr-removal-label-text" });
            _mockGetMap.mockReturnValue(adapter);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre(
                "lyr-removal",
                { labelId: "name" },
                {},
                tooltips
            );
            const entry = tooltips.values().next().value;
            expect(typeof entry.remove).toBe("function");
            entry.remove();
            expect(adapter._nativeMap.removeLayer).toHaveBeenCalled();
        });

        test("_resolveMapFontStack with no symbol layers → fallback Noto Sans", () => {
            const adapter = _makeMapLibreAdapter();
            adapter._nativeMap.getStyle.mockReturnValue({ layers: [] }); // no symbol layers
            adapter._nativeMap.getSource.mockReturnValue({ type: "geojson" });
            _mockGetMap.mockReturnValue(adapter);
            const tooltips = new Map();
            LabelRenderer.createSymbolLayerForMapLibre(
                "lyr-font",
                { labelId: "name" },
                {},
                tooltips
            );
            const [call] = adapter._nativeMap.addLayer.mock.calls;
            expect(call[0].layout["text-font"]).toEqual(["Noto Sans Regular"]);
        });
    });

    // ════════════════════════════════════════════════════════════════════
    // LabelButtonManager
    // ════════════════════════════════════════════════════════════════════

    describe("LabelButtonManager.createButton", () => {
        test("returns null when layerId missing", () => {
            const container = document.createElement("div");
            const result = LabelButtonManager.createButton("", container);
            expect(result).toBeNull();
        });

        test("returns null when container missing", () => {
            const result = LabelButtonManager.createButton("lyr", null);
            expect(result).toBeNull();
        });

        test("returns existing button if already created", () => {
            const container = document.createElement("div");
            const btn = document.createElement("button");
            btn.className = "gl-layer-manager__label-toggle";
            container.appendChild(btn);
            const result = LabelButtonManager.createButton("lyr", container);
            expect(result).toBe(btn);
        });

        test("inserts before visibility toggle when present", () => {
            const container = document.createElement("div");
            const visToggle = document.createElement("button");
            visToggle.className = "gl-layer-manager__item-toggle";
            container.appendChild(visToggle);
            const result = LabelButtonManager.createButton("lyr", container);
            expect(result).not.toBeNull();
            // label toggle should be before visibility toggle
            const children = Array.from(container.children);
            expect(children.indexOf(result)).toBeLessThan(children.indexOf(visToggle));
        });

        test("appends when no visibility toggle present", () => {
            const container = document.createElement("div");
            const result = LabelButtonManager.createButton("lyr-append", container);
            expect(result).not.toBeNull();
            expect(container.contains(result)).toBe(true);
        });
    });

    describe("LabelButtonManager._getState", () => {
        test("returns correct state when layer not found", () => {
            _mockGetLayerById.mockReturnValue(null);
            const state = LabelButtonManager._getState("nonexistent");
            expect(state.layerExists).toBe(false);
            expect(state.layerVisible).toBe(false);
            expect(state.labelEnabled).toBe(false);
        });

        test("returns correct state when layer visible with label enabled", () => {
            _mockGetLayerById.mockReturnValue({
                _visibility: { current: true },
                currentStyle: { label: { enabled: true } },
            });
            const state = LabelButtonManager._getState("lyr");
            expect(state.layerExists).toBe(true);
            expect(state.layerVisible).toBe(true);
            expect(state.labelEnabled).toBe(true);
        });
    });

    describe("LabelButtonManager._applyState", () => {
        test("enables button when label enabled + layer visible", () => {
            const button = document.createElement("button");
            button.className =
                "gl-layer-manager__label-toggle gl-layer-manager__label-toggle--disabled";
            LabelButtonManager._applyState(button, {
                layerId: "lyr",
                layerExists: true,
                layerVisible: true,
                labelEnabled: true,
                areLabelsActive: false,
            });
            expect(button.disabled).toBe(false);
            expect(button.getAttribute("aria-pressed")).toBe("false");
        });

        test("shows active state when labels active + visible", () => {
            const button = document.createElement("button");
            LabelButtonManager._applyState(button, {
                layerId: "lyr",
                layerExists: true,
                layerVisible: true,
                labelEnabled: true,
                areLabelsActive: true,
            });
            expect(button.classList.contains("gl-layer-manager__label-toggle--on")).toBe(true);
            expect(button.getAttribute("aria-pressed")).toBe("true");
        });

        test("disables button when label disabled", () => {
            const button = document.createElement("button");
            button.disabled = false;
            LabelButtonManager._applyState(button, {
                layerId: "lyr",
                layerExists: false,
                layerVisible: false,
                labelEnabled: false,
                areLabelsActive: false,
            });
            expect(button.disabled).toBe(true);
        });
    });

    describe("LabelButtonManager.syncImmediate", () => {
        test("no-op when layerId empty", () => {
            LabelButtonManager.syncImmediate("");
        });

        test("calls _doSync when no DOM element found", () => {
            LabelButtonManager.syncImmediate("lyr-no-dom");
            // Should not throw even when no DOM element
        });
    });
});
