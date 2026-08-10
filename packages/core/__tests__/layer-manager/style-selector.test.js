/**
 */
/* Phase 4.16 — modules/layer-manager/style-selector.ts */

vi.mock("../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: vi.fn() },
}));
vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: { getLayerData: vi.fn(() => null), setLayerStyle: vi.fn() },
}));
vi.mock("../../src/utils/loaders/style-loader.js", () => ({ StyleLoader: null }));
vi.mock("../../src/capabilities/labels/labels.js", () => ({ Labels: null }));
vi.mock("../../src/capabilities/labels/label-button-manager.js", () => ({
    LabelButtonManager: null,
}));
vi.mock("../../src/capabilities/legend/legend-seam.js", () => ({
    LegendContract: { isAvailable: vi.fn(() => false) },
}));

import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.js";
import { GeoJSONCore } from "../../src/kernel/geojson/core.js";
import { Config } from "../../src/kernel/config/config-primitives.js";

describe("layer-manager/style-selector (Phase 4.16)", () => {
    it("getCurrentStyle returns null for unknown layerId", () => {
        expect(StyleSelector.getCurrentStyle("unknown")).toBeNull();
    });

    it("setCurrentStyle and getCurrentStyle roundtrip", () => {
        StyleSelector.setCurrentStyle("ly1", "dark");
        expect(StyleSelector.getCurrentStyle("ly1")).toBe("dark");
    });

    it("renderDOM returns null when item has no multiple styles", () => {
        expect(StyleSelector.renderDOM({ id: "ly1" })).toBeNull();
    });

    it("renderDOM returns select when item has multiple styles", () => {
        const item = {
            id: "ly1",
            styles: {
                available: [
                    { id: "default", label: "Default" },
                    { id: "dark", label: "Dark" },
                ],
                default: "default",
            },
        };
        const el = StyleSelector.renderDOM(item);
        expect(el).not.toBeNull();
        expect(el.querySelector("select").options.length).toBe(2);
    });

    it("bindEvents does nothing when item has no multiple styles", () => {
        const container = document.createElement("div");
        StyleSelector.bindEvents(container, { id: "ly1" });
        expect(container.querySelector("select")).toBeNull();
    });

    it("bindEvents attaches change handler and setCurrentStyle/applyStyle on change", async () => {
        const item = {
            id: "ly1",
            styles: {
                available: [
                    { id: "default", label: "Default" },
                    { id: "dark", label: "Dark" },
                ],
                default: "default",
            },
        };
        const container = StyleSelector.renderDOM(item);
        const select = container.querySelector("select");
        select.dataset.layerId = "ly1";
        GeoJSONCore.getLayerData.mockReturnValue(null);
        StyleSelector.bindEvents(container, item);
        select.value = "dark";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(StyleSelector.getCurrentStyle("ly1")).toBe("dark");
    });

    it("applyStyle returns early when GeoJSONCore or layerData missing", async () => {
        GeoJSONCore.getLayerData.mockReturnValue(null);
        await StyleSelector.applyStyle("ly1", "dark");
        expect(GeoJSONCore.setLayerStyle).not.toHaveBeenCalled();
    });

    it("applyStyle is a no-op when StyleLoader is unavailable (legacy fetch path removed in S3)", async () => {
        GeoJSONCore.getLayerData.mockReturnValue({
            config: {
                id: "ly1",
                _profileId: "p1",
                _layerDirectory: "layers",
                styles: {
                    directory: "styles",
                    available: [{ id: "dark", file: "dark.json" }],
                },
            },
        });
        await StyleSelector.applyStyle("ly1", "dark");
        expect(GeoJSONCore.setLayerStyle).not.toHaveBeenCalled();
    });
});

// ── T22 — layer-manager/style-selector.ts branch coverage ─────────────────────
describe("layer-manager/style-selector — T22 branch coverage", () => {
    beforeEach(() => {
        GeoJSONCore.getLayerData.mockReset();
        GeoJSONCore.setLayerStyle.mockClear();
        Config.get.mockReset();
    });

    it("applyStyle returns early when config.styles absent (branch 5.0)", async () => {
        GeoJSONCore.getLayerData.mockReturnValue({ config: { id: "ly1" } });
        await StyleSelector.applyStyle("ly1", "dark");
        expect(GeoJSONCore.setLayerStyle).not.toHaveBeenCalled();
    });

    it("applyStyle returns early when styleId not in available (branch 7.1)", async () => {
        GeoJSONCore.getLayerData.mockReturnValue({
            config: { id: "ly1", styles: { available: [{ id: "light" }] } },
        });
        await StyleSelector.applyStyle("ly1", "nonexistent");
        expect(GeoJSONCore.setLayerStyle).not.toHaveBeenCalled();
    });

    it("renderDOM uses available[0].id when no currentStyle and no default (branch 11.2)", () => {
        const item = {
            id: "ly-T22-nodef",
            styles: {
                available: [
                    { id: "first", label: "First" },
                    { id: "second", label: "Second" },
                ],
            },
        };
        const el = StyleSelector.renderDOM(item);
        expect(el).not.toBeNull();
        expect(el.querySelector("select").options[0].selected).toBe(true);
    });

    it("renderDOM uses style.id when label absent (branch 12.1)", () => {
        const item = {
            id: "ly-nolabel",
            styles: {
                available: [{ id: "s1" }, { id: "s2" }],
                default: "s1",
            },
        };
        const el = StyleSelector.renderDOM(item);
        const options = el.querySelector("select").options;
        expect(options[0].textContent).toBe("s1");
        expect(options[1].textContent).toBe("s2");
    });

    it("bindEvents returns early when select not found in container (branch 16.0)", () => {
        const item = {
            id: "ly-no-select",
            styles: { available: [{ id: "a" }, { id: "b" }] },
        };
        const emptyContainer = document.createElement("div");
        expect(() => StyleSelector.bindEvents(emptyContainer, item)).not.toThrow();
    });

    it("applyStyle is a no-op when StyleLoader is unavailable (T22 — legacy fetch path removed in S3)", async () => {
        globalThis.fetch = vi.fn();
        GeoJSONCore.getLayerData.mockReturnValue({
            config: {
                id: "ly1",
                _profileId: "p1",
                _layerDirectory: "layers",
                styles: { directory: "styles", available: [{ id: "dark", file: "dark.json" }] },
            },
        });
        await StyleSelector.applyStyle("ly1", "dark");
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(GeoJSONCore.setLayerStyle).not.toHaveBeenCalled();
    });
});
