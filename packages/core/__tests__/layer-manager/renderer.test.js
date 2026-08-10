/**
 */
/* Phase 4.14 — modules/layer-manager/renderer.ts */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/kernel/layer-manager/style-selector.js", () => ({
    StyleSelector: {},
}));
vi.mock("../../src/kernel/ui/components.js", () => ({
    _UIComponents: {
        createToggleButton: vi.fn((container, opts) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = opts?.className || "";
            if (opts?.isActive) btn.classList.add("gl-layer-manager__item-toggle--on");
            btn.setAttribute("aria-pressed", opts?.isActive ? "true" : "false");
            if (container) container.appendChild(btn);
            return btn;
        }),
    },
}));
vi.mock("../../src/kernel/shared/geojson-state.js", () => ({
    GeoJSONShared: { state: {}, getLayerById: vi.fn() },
}));
vi.mock("../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: {
        clearElementFast: vi.fn((el) => {
            if (el) el.innerHTML = "";
        }),
    },
}));
vi.mock("../../src/kernel/layer-manager/basemap-selector.js", () => ({
    BasemapSelector: { render: vi.fn() },
}));
vi.mock("../../src/capabilities/labels/label-button-manager.js", () => ({
    LabelButtonManager: { syncImmediate: vi.fn(), createButton: vi.fn() },
}));
vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        _layers: new Map(),
        getLayerById: vi.fn(),
        showLayer: vi.fn(),
        hideLayer: vi.fn(),
    },
}));
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: {},
}));
import { LMRenderer } from "../../src/kernel/layer-manager/renderer.js";
import { GeoJSONCore } from "../../src/kernel/geojson/core.js";
import { GeoJSONShared } from "../../src/kernel/shared/geojson-state.js";
import { BasemapSelector } from "../../src/kernel/layer-manager/basemap-selector.js";
import { checkLayerVisibility } from "../../src/kernel/layer-manager/visibility-checker.js";

// domCreate() from dom-helpers.js works natively in jsdom — no mock needed.

describe("layer-manager/renderer (Phase 4.14)", () => {
    let bodyEl;

    beforeEach(() => {
        bodyEl = document.createElement("div");
        document.body.appendChild(bodyEl);
        GeoJSONCore.getLayerById = vi.fn(() => ({
            _visibility: { current: true, logicalState: true },
            layer: {},
            visible: true,
            currentStyle: null,
        }));
        GeoJSONShared.state = { map: { hasLayer: () => true } };
    });

    afterEach(() => {
        if (bodyEl?.parentNode) bodyEl.parentNode.removeChild(bodyEl);
    });

    it("renderSections does nothing when bodyEl is null", () => {
        LMRenderer.renderSections(null, []);
        // No DOM created — bodyEl stays empty (null guard returns early)
        expect(bodyEl.children.length).toBe(0);
    });

    it("renderSections shows empty message when sections is empty", () => {
        LMRenderer.renderSections(bodyEl, []);
        const empty = bodyEl.querySelector(".gl-layer-manager__empty");
        expect(empty).not.toBeNull();
    });

    it("renderSections filters legacy poi/route and renders section with label", () => {
        LMRenderer.renderSections(bodyEl, [
            { id: "poi", label: "POI" },
            { id: "geojson", label: "Couches", items: [] },
        ]);
        expect(bodyEl.querySelector(".gl-layer-manager__section")).not.toBeNull();
        expect(bodyEl.querySelector(".gl-layer-manager__section-title").textContent).toBe(
            "Couches"
        );
    });

    describe("Phase 9.9 — coverage 60%", () => {
        it("renderSections with items and collapsible builds accordion", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geojson-default",
                    label: "Layers",
                    order: 1,
                    collapsedByDefault: true,
                    items: [{ id: "lyr1", label: "Layer 1", type: "fill", visible: true }],
                },
            ]);
            expect(bodyEl.querySelector(".gl-layer-manager__section")).not.toBeNull();
        });

        it("renderSections with basemap section delegates to BasemapSelector", () => {
            LMRenderer.renderSections(bodyEl, [
                { id: "basemap", label: "Fond", items: [{ id: "street", label: "Rue" }] },
            ]);
            expect(bodyEl.querySelector(".gl-layer-manager__section")).not.toBeNull();
            expect(BasemapSelector.render).toHaveBeenCalled();
        });

        it("collapsible section has accordion header and body", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "sec1",
                    label: "Section",
                    order: 1,
                    collapsedByDefault: true,
                    items: [{ id: "i1", label: "Item 1", type: "fill", visible: true }],
                },
            ]);
            expect(bodyEl.querySelector(".gl-layer-manager__accordion-header")).not.toBeNull();
            expect(bodyEl.querySelector(".gl-layer-manager__accordion-body")).not.toBeNull();
            expect(bodyEl.querySelector(".gl-layer-manager__section--collapsed")).not.toBeNull();
        });

        it("accordion header click toggles collapsed state", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "sec1",
                    label: "Section",
                    collapsedByDefault: true,
                    items: [{ id: "i1", label: "Item 1", type: "fill", visible: true }],
                },
            ]);
            const sectionEl = bodyEl.querySelector(".gl-layer-manager__section");
            const header = bodyEl.querySelector(".gl-layer-manager__accordion-header");
            const arrow = header?.querySelector(".gl-layer-manager__accordion-arrow");
            expect(sectionEl?.classList.contains("gl-layer-manager__section--collapsed")).toBe(
                true
            );
            expect(arrow?.textContent).toBe("▶");
            header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(sectionEl?.classList.contains("gl-layer-manager__section--collapsed")).toBe(
                false
            );
            expect(arrow?.textContent).toBe("▼");
            header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(sectionEl?.classList.contains("gl-layer-manager__section--collapsed")).toBe(
                true
            );
            expect(arrow?.textContent).toBe("▶");
        });

        it("syncToggles does not throw", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Layers",
                    items: [{ id: "lyr1", label: "L1", type: "fill", visible: true }],
                },
            ]);
            expect(() => LMRenderer.syncToggles()).not.toThrow();
        });

        it("syncToggles updates toggle state and class for items in document", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Layers",
                    items: [{ id: "lyr1", label: "L1", toggleable: true, visible: true }],
                },
            ]);
            const itemEl = bodyEl.querySelector('[data-layer-id="lyr1"]');
            const toggleBtn = itemEl?.querySelector(".gl-layer-manager__item-toggle");
            expect(itemEl).not.toBeNull();
            expect(toggleBtn).not.toBeNull();
            LMRenderer.syncToggles();
            expect(toggleBtn?.getAttribute("aria-pressed")).toBe("true");
            expect(itemEl?.classList.contains("gl-layer--hidden")).toBe(false);
        });

        it("renderSections with toggleable item creates toggle and label controls", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Layers",
                    items: [{ id: "lyr1", label: "Layer 1", toggleable: true, visible: true }],
                },
            ]);
            expect(bodyEl.querySelector(".gl-layer-manager__items")).not.toBeNull();
            expect(bodyEl.querySelector(".gl-layer-manager__item-toggle")).not.toBeNull();
            expect(bodyEl.querySelector(".gl-layer-manager__label")).not.toBeNull();
        });

        it("renderSections with item without id but with value renders value span", () => {
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Info",
                    items: [{ label: "Note", value: "Some value text" }],
                },
            ]);
            const valueEl = bodyEl.querySelector(".gl-layer-manager__value");
            expect(valueEl).not.toBeNull();
            expect(valueEl?.textContent).toBe("Some value text");
        });

        it("toggle button click hides layer when currently visible", () => {
            GeoJSONCore.getLayerById.mockReturnValue({
                _visibility: { current: true, logicalState: true },
                layer: {},
                visible: true,
            });
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Layers",
                    items: [{ id: "lyr1", label: "L1", toggleable: true, visible: true }],
                },
            ]);
            const toggleBtn = bodyEl.querySelector(".gl-layer-manager__item-toggle");
            const itemEl = bodyEl.querySelector('[data-layer-id="lyr1"]');
            expect(toggleBtn?.getAttribute("aria-pressed")).toBe("true");
            toggleBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(GeoJSONCore.hideLayer).toHaveBeenCalledWith("lyr1");
            expect(toggleBtn?.getAttribute("aria-pressed")).toBe("false");
            expect(itemEl?.classList.contains("gl-layer--hidden")).toBe(true);
        });

        it("toggle button click shows layer when currently hidden", () => {
            GeoJSONCore.getLayerById.mockReturnValue({
                _visibility: { current: false, logicalState: false },
                layer: {},
                visible: false,
            });
            LMRenderer.renderSections(bodyEl, [
                {
                    id: "geo",
                    label: "Layers",
                    items: [{ id: "lyr2", label: "L2", toggleable: true, visible: false }],
                },
            ]);
            const toggleBtn = bodyEl.querySelector(".gl-layer-manager__item-toggle");
            const itemEl = bodyEl.querySelector('[data-layer-id="lyr2"]');
            expect(itemEl?.classList.contains("gl-layer--hidden")).toBe(true);
            toggleBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(GeoJSONCore.showLayer).toHaveBeenCalledWith("lyr2");
            expect(toggleBtn?.getAttribute("aria-pressed")).toBe("true");
            expect(itemEl?.classList.contains("gl-layer--hidden")).toBe(false);
        });
    });
});

// ── visibility-checker catch path (lines 42-44) ──────────────────────────────
describe("layer-manager/visibility-checker — catch path", () => {
    it("checkLayerVisibility returns false when getLayerById throws", () => {
        GeoJSONCore.getLayerById.mockImplementation(() => {
            throw new Error("boom");
        });
        expect(checkLayerVisibility("lyr1")).toBe(false);
        GeoJSONCore.getLayerById.mockReset();
    });
});
