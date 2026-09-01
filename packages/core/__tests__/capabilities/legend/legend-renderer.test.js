/**
 * Phase 60 — Step 4.3: src/capabilities/legend/legend-renderer.ts (0% → 60%)
 */
vi.mock("../../../src/utils/log/index.ts", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const mockRenderSymbol = vi.fn();
const mockCreateAccordion = vi.fn();
// API review — `renderAccordion` now consumes the ESM import as
// `renderSymbol` already did, no longer `globalThis.GeoLeaf._UIComponents`.
// The tests follow: they mocked the CHANNEL, they now mock the module. A test
// that plants the key on a fake global itself stays green whatever happens to
// the real one.
let mockUIComponents = { renderSymbol: mockRenderSymbol, createAccordion: mockCreateAccordion };
vi.mock("../../../src/kernel/ui/components.ts", () => ({
    get _UIComponents() {
        return mockUIComponents;
    },
}));

// domCreate() from dom-helpers.js works natively in jsdom — no mock needed.

import { LegendRenderer } from "../../../src/capabilities/legend/legend-renderer.ts";
import { Log } from "../../../src/utils/log/index.js";

describe("legend/legend-renderer (step 4.3)", () => {
    let container;

    beforeEach(() => {
        container = document.createElement("div");
        mockRenderSymbol.mockClear();
    });

    it("exporte LegendRenderer avec renderSection, renderItem, renderSymbol, renderFooter, renderAccordion", () => {
        expect(LegendRenderer).toBeDefined();
        expect(typeof LegendRenderer.renderSection).toBe("function");
        expect(typeof LegendRenderer.renderItem).toBe("function");
        expect(typeof LegendRenderer.renderSymbol).toBe("function");
        expect(typeof LegendRenderer.renderFooter).toBe("function");
        expect(typeof LegendRenderer.renderAccordion).toBe("function");
    });

    it("renderSection creates section, title et items", () => {
        const section = { title: "Layer 1", items: [{ label: "A" }, { label: "B" }] };
        const result = LegendRenderer.renderSection(container, section);
        expect(result).toBeDefined();
        expect(container.querySelector(".gl-legend__section")).not.toBeNull();
        expect(container.querySelector(".gl-legend__section-title")?.textContent).toBe("Layer 1");
        expect(mockRenderSymbol).toHaveBeenCalled();
    });

    it("renderItem creates item avec label", () => {
        const item = { label: "Test", description: "Desc" };
        LegendRenderer.renderItem(container, item);
        expect(container.querySelector(".gl-legend__label")?.textContent).toBe("Test");
        expect(container.querySelector(".gl-legend__description")?.textContent).toBe("Desc");
    });

    it("renderFooter ne fait rien si footer vide", () => {
        LegendRenderer.renderFooter(container, null);
        LegendRenderer.renderFooter(container, {});
        expect(container.querySelector(".gl-legend__footer")).toBeFalsy();
    });

    it("renderFooter creates footer avec text et style italic", () => {
        LegendRenderer.renderFooter(container, { text: "Source", style: "italic" });
        const footer = container.querySelector(".gl-legend__footer");
        expect(footer?.textContent).toBe("Source");
        expect(footer?.style.fontStyle).toBe("italic");
    });

    it("renderAccordion appelle _UIComponents.createAccordion si disponible", () => {
        const bodyEl = document.createElement("div");
        mockCreateAccordion.mockReturnValue({ bodyEl });
        LegendRenderer.renderAccordion(container, {
            layerId: "lyr1",
            label: "Layer",
            sections: [{ title: "S1", items: [] }],
        });
        expect(mockCreateAccordion).toHaveBeenCalled();
    });

    it("renderAccordion does nothing when _UIComponents missing", () => {
        const prev = mockUIComponents;
        mockUIComponents = { renderSymbol: mockRenderSymbol };
        LegendRenderer.renderAccordion(container, { layerId: "l", label: "L", sections: [] });
        expect(container.children.length).toBe(0);
        mockUIComponents = prev;
    });

    it("renderSymbol calls _UIComponents.renderSymbol", () => {
        LegendRenderer.renderItem(container, { label: "X", symbol: {} });
        expect(mockRenderSymbol).toHaveBeenCalled();
    });

    it("renderSection without title does not create title element", () => {
        const section = { items: [{ label: "Only item" }] };
        LegendRenderer.renderSection(container, section);
        expect(container.querySelector(".gl-legend__section-title")).toBeFalsy();
        expect(container.querySelector(".gl-legend__item")).toBeTruthy();
    });

    it("renderItem without description does not create description element", () => {
        LegendRenderer.renderItem(container, { label: "No desc" });
        expect(container.querySelector(".gl-legend__description")).toBeFalsy();
        expect(container.querySelector(".gl-legend__label")?.textContent).toBe("No desc");
    });

    it("renderAccordion onToggle calls Legend.toggleAccordion when set", () => {
        const toggleAccordion = vi.fn();
        mockCreateAccordion.mockImplementation((_, config) => {
            const bodyEl = document.createElement("div");
            if (config.onToggle) config.onToggle("ly1", true);
            return { bodyEl };
        });
        globalThis.GeoLeaf = globalThis.GeoLeaf || {};
        globalThis.GeoLeaf.Legend = { toggleAccordion };
        LegendRenderer.renderAccordion(container, { layerId: "ly1", label: "L", sections: [] });
        expect(toggleAccordion).toHaveBeenCalledWith("ly1");
        delete globalThis.GeoLeaf.Legend;
    });

    // renderSection uses domCreate (document.createElement wrapper), so it always produces DOM output.
    it("renderSection renders via domCreate", () => {
        const result = LegendRenderer.renderSection(document.createElement("div"), {
            items: [],
        });
        expect(result).toBeDefined();
        expect(result.className).toContain("gl-legend__section");
    });

    // renderItem uses domCreate — always produces DOM output.
    it("renderItem renders via domCreate", () => {
        const result = LegendRenderer.renderItem(document.createElement("div"), { label: "X" });
        expect(result).toBeDefined();
        expect(result.className).toContain("gl-legend__item");
    });

    it("renderItem uses empty string when item.label is undefined", () => {
        LegendRenderer.renderItem(container, { label: undefined });
        const labelEl = container.querySelector(".gl-legend__label");
        expect(labelEl?.textContent).toBe("");
    });

    // renderFooter uses domCreate — renders footer via document.createElement wrapper.
    it("renderFooter renders footer via domCreate", () => {
        const tmpContainer = document.createElement("div");
        LegendRenderer.renderFooter(tmpContainer, { text: "Source" });
        expect(tmpContainer.querySelector(".gl-legend__footer")).toBeTruthy();
        expect(tmpContainer.querySelector(".gl-legend__footer").textContent).toBe("Source");
    });

    it("renderSymbol calls Log.error when _UIComponents.renderSymbol not available", () => {
        const prev = mockUIComponents;
        mockUIComponents = null;
        LegendRenderer.renderSymbol(document.createElement("div"), { label: "X" });
        expect(Log.error).toHaveBeenCalledWith(
            "[LegendRenderer] Module _UIComponents not available"
        );
        mockUIComponents = prev;
    });
});
