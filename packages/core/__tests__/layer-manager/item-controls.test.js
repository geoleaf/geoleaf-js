/**
 */
/* layer-manager/item-controls.ts — T22 branch coverage */

vi.mock("../../src/kernel/layer-manager/style-selector.js", () => ({
    StyleSelector: {
        renderDOM: vi.fn(() => null),
        bindEvents: vi.fn(),
    },
}));
vi.mock("../../src/kernel/ui/components.js", () => ({
    _UIComponents: {
        createToggleButton: vi.fn(() => document.createElement("button")),
    },
}));
vi.mock("../../src/kernel/layer-manager/visibility-checker.js", () => ({
    checkLayerVisibility: vi.fn(() => true),
}));
vi.mock("../../src/kernel/layer-manager/attach-toggle.js", () => ({
    attachToggleHandler: vi.fn(),
}));
vi.mock("../../src/utils/i18n/i18n.js", () => ({
    getLabel: vi.fn((k) => k),
}));
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { renderItems, renderToggleControls } from "../../src/kernel/layer-manager/item-controls.js";
import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.js";
import { attachToggleHandler } from "../../src/kernel/layer-manager/attach-toggle.js";
import { checkLayerVisibility } from "../../src/kernel/layer-manager/visibility-checker.js";

describe("layer-manager/item-controls — T22 branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        StyleSelector.renderDOM.mockReturnValue(null);
    });

    // ── renderItems: item.label falsy uses "" fallback (branch 4.0) ────────────

    it("renderItems uses empty string when item.label is absent (branch 4.0)", () => {
        const sectionEl = document.createElement("div");
        const section = {
            items: [{ id: "ly1" }], // no label
        };
        expect(() => renderItems(section, sectionEl)).not.toThrow();
        const spans = sectionEl.querySelectorAll(".gl-layer-manager__label");
        expect(spans.length).toBeGreaterThan(0);
        expect(spans[0].textContent).toBe("");
    });

    // ── renderItems: item.id exists and not toggleable — creates controls (non-toggleable branch) ──

    it("renderItems emits the layer-item controls seam for non-toggleable item with id (branch 84 else-if)", () => {
        const details = [];
        const handler = (e) => details.push(e.detail);
        document.addEventListener("geoleaf:layer-item:controls", handler);
        const sectionEl = document.createElement("div");
        const section = {
            items: [{ id: "ly1", label: "Layer 1", toggleable: false }],
        };
        renderItems(section, sectionEl);
        document.removeEventListener("geoleaf:layer-item:controls", handler);
        const detail = details.find((d) => d.layerId === "ly1");
        expect(detail).toBeDefined();
        expect(detail.toggleable).toBe(false);
        expect(detail.controlsContainer).toBeInstanceOf(HTMLElement);
    });

    // ── renderItems: item has no id — renders value (else branch) ──────────────

    it("renderItems renders value for item with no id (else branch)", () => {
        const sectionEl = document.createElement("div");
        const section = {
            items: [{ value: "some-info" }], // no id, no toggleable
        };
        renderItems(section, sectionEl);
        const valueEl = sectionEl.querySelector(".gl-layer-manager__value");
        expect(valueEl).not.toBeNull();
        expect(valueEl.textContent).toBe("some-info");
    });

    // ── renderToggleControls: item.styles set → StyleSelector.renderDOM called (branches 13.0, 14.0) ──

    it("renderToggleControls calls StyleSelector.renderDOM when item has styles (branches 13.0, 14.0)", () => {
        const mainRow = document.createElement("div");
        const itemEl = document.createElement("div");
        const item = {
            id: "ly1",
            styles: { available: [{ id: "dark" }] },
        };
        renderToggleControls(item, mainRow, itemEl);
        expect(StyleSelector.renderDOM).toHaveBeenCalledWith(item);
    });

    // ── renderToggleControls: StyleSelector.renderDOM returns element → appended (branch 15.0) ──

    it("renderToggleControls appends styleElement when renderDOM returns non-null (branch 15.0)", () => {
        const styleEl = document.createElement("div");
        StyleSelector.renderDOM.mockReturnValue(styleEl);
        const mainRow = document.createElement("div");
        const itemEl = document.createElement("div");
        const item = {
            id: "ly1",
            styles: { available: [{ id: "dark" }] },
        };
        renderToggleControls(item, mainRow, itemEl);
        expect(itemEl.contains(styleEl)).toBe(true);
        expect(StyleSelector.bindEvents).toHaveBeenCalledWith(styleEl, item);
    });

    // ── renderItems: item.toggleable=true → calls renderToggleControls (branch 82.0) ──

    it("renderItems calls renderToggleControls for toggleable item (branch 82.0)", () => {
        const sectionEl = document.createElement("div");
        const section = {
            items: [{ id: "ly1", label: "Layer 1", toggleable: true }],
        };
        renderItems(section, sectionEl);
        expect(attachToggleHandler).toHaveBeenCalled();
    });

    // ── renderItems: checkLayerVisibility returns false → adds gl-layer--hidden (branch 3.0) ──

    it("renderItems adds gl-layer--hidden when checkLayerVisibility returns false (branch 3.0)", () => {
        checkLayerVisibility.mockReturnValueOnce(false);
        const sectionEl = document.createElement("div");
        const section = {
            items: [{ id: "ly1", label: "Layer 1", toggleable: false }],
        };
        renderItems(section, sectionEl);
        const itemEl =
            sectionEl.querySelector("[data-layer-id='ly1']") ||
            sectionEl.querySelector(".gl-layer-manager__item");
        expect(itemEl.classList.contains("gl-layer--hidden")).toBe(true);
    });

    // ── renderItems: item.toggleable=true, styles → StyleSelector also called ──

    it("renderToggleControls: item.styles with renderDOM null does not append (branch 15 false)", () => {
        StyleSelector.renderDOM.mockReturnValue(null);
        const mainRow = document.createElement("div");
        const itemEl = document.createElement("div");
        const item = {
            id: "ly1",
            styles: { available: [{ id: "dark" }] },
        };
        renderToggleControls(item, mainRow, itemEl);
        expect(StyleSelector.bindEvents).not.toHaveBeenCalled();
    });
});
