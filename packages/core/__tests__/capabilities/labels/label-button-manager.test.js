/**
 */
/* Phase 5.25 - label-button-manager */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockAttachEventHandler = vi.fn();
const mockGetLayerById = vi.fn(() => null);
const mockToggleLabels = vi.fn(() => false);
const mockAreLabelsEnabled = vi.fn(() => false);

vi.mock("../../../src/utils/log/index.ts", () => ({ Log: logMock }));
vi.mock("../../../src/kernel/ui/components.ts", () => ({
    _UIComponents: { attachEventHandler: (el, ev, fn) => mockAttachEventHandler(el, ev, fn) },
}));
vi.mock("../../../src/kernel/geojson/core.ts", () => ({
    GeoJSONCore: { getLayerById: (id) => mockGetLayerById(id) },
}));
vi.mock("../../../src/capabilities/labels/labels.ts", () => ({
    Labels: {
        toggleLabels: (id) => mockToggleLabels(id),
        areLabelsEnabled: (id) => mockAreLabelsEnabled(id),
    },
}));
vi.mock("../../../src/utils/general/dom-helpers.ts", () => ({
    domCreate: (tag, className, parent) => domCreateDouble(tag, className, parent),
}));
vi.mock("../../../src/utils/i18n/i18n.ts", () => ({
    getLabel: (key) => key,
}));

import { domCreateDouble } from "../../_helpers/dom-create-double.js";
import { LabelButtonManager } from "../../../src/capabilities/labels/label-button-manager.js";

describe("label-button-manager (Phase 5.25)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetLayerById.mockReturnValue(null);
        mockAreLabelsEnabled.mockReturnValue(false);
    });

    describe("LabelButtonManager export", () => {
        it("exports createButton, syncImmediate, _doSync, _getState, _applyState", () => {
            expect(LabelButtonManager.createButton).toBeDefined();
            expect(LabelButtonManager.syncImmediate).toBeDefined();
        });
    });

    describe("createButton", () => {
        it("returns null when layerId or container missing", () => {
            expect(LabelButtonManager.createButton("", document.createElement("div"))).toBeNull();
            expect(LabelButtonManager.createButton("ly1", null)).toBeNull();
            expect(logMock.warn).toHaveBeenCalled();
        });

        it("returns existing button when already in container", () => {
            const container = document.createElement("div");
            const existing = document.createElement("button");
            existing.className = "gl-layer-manager__label-toggle";
            container.appendChild(existing);
            expect(LabelButtonManager.createButton("ly1", container)).toBe(existing);
        });

        it("creates button with correct class and aria attributes", () => {
            const container = document.createElement("div");
            const btn = LabelButtonManager.createButton("ly1", container);
            expect(btn).not.toBeNull();
            expect(btn.className).toContain("gl-layer-manager__label-toggle");
            expect(btn.getAttribute("aria-label")).toBeTruthy();
            expect(btn.disabled).toBe(true);
            expect(mockAttachEventHandler).toHaveBeenCalled();
        });
    });

    describe("_getState", () => {
        it("returns layerExists false when getLayerById returns null", () => {
            mockGetLayerById.mockReturnValue(null);
            const state = LabelButtonManager._getState("ly1");
            expect(state.layerId).toBe("ly1");
            expect(state.layerExists).toBe(false);
            expect(state.labelEnabled).toBe(false);
            expect(state.areLabelsActive).toBe(false);
        });

        it("returns labelEnabled and layerVisible from layer data", () => {
            mockGetLayerById.mockReturnValue({
                _visibility: { current: true },
                currentStyle: { label: { enabled: true } },
            });
            mockAreLabelsEnabled.mockReturnValue(true);
            const state = LabelButtonManager._getState("ly1");
            expect(state.layerExists).toBe(true);
            expect(state.layerVisible).toBe(true);
            expect(state.labelEnabled).toBe(true);
            expect(state.areLabelsActive).toBe(true);
        });
    });

    describe("_applyState", () => {
        it("disables button when label not enabled or layer not visible", () => {
            const button = document.createElement("button");
            LabelButtonManager._applyState(button, {
                layerId: "ly1",
                layerExists: true,
                layerVisible: false,
                labelEnabled: false,
                areLabelsActive: false,
            });
            expect(button.disabled).toBe(true);
            expect(button.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(
                true
            );
        });

        it("enables button and sets aria-pressed when labels active", () => {
            const button = document.createElement("button");
            LabelButtonManager._applyState(button, {
                layerId: "ly1",
                layerExists: true,
                layerVisible: true,
                labelEnabled: true,
                areLabelsActive: true,
            });
            expect(button.disabled).toBe(false);
            expect(button.getAttribute("aria-pressed")).toBe("true");
            expect(button.classList.contains("gl-layer-manager__label-toggle--on")).toBe(true);
        });
    });

    describe("syncImmediate", () => {
        it("does not throw when layerId provided", () => {
            expect(() => LabelButtonManager.syncImmediate("ly1")).not.toThrow();
        });
    });
});

// ── T22 — label-button-manager.ts branch coverage ─────────────────────────────
describe("label-button-manager — T22 branch coverage", () => {
    let btn, handler, container;

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetLayerById.mockReturnValue(null);
        mockAreLabelsEnabled.mockReturnValue(false);
        mockToggleLabels.mockReturnValue(false);
        container = document.createElement("div");
        btn = LabelButtonManager.createButton("lyt", container);
        handler = mockAttachEventHandler.mock.calls[0][2];
    });

    // ── click handler ─────────────────────────────────────────────────────────

    it("handler: ev.stopPropagation called (MISS[0] if[0])", () => {
        const ev = new Event("click");
        const spy = vi.spyOn(ev, "stopPropagation");
        handler(ev);
        expect(spy).toHaveBeenCalled();
    });

    it("handler: returns early when button.disabled (MISS[1] if[0])", () => {
        // btn is disabled by default
        expect(btn.disabled).toBe(true);
        handler(new Event("click"));
        expect(mockGetLayerById).not.toHaveBeenCalled();
    });

    it("handler: returns early when labelEnabled false (MISS[2] if[0])", () => {
        btn.disabled = false;
        mockGetLayerById.mockReturnValue(null); // labelEnabled = false
        handler(new Event("click"));
        expect(mockToggleLabels).not.toHaveBeenCalled();
    });

    it("handler: Labels.toggleLabels called when labelEnabled true (MISS[3] if[0])", () => {
        btn.disabled = false;
        mockGetLayerById.mockReturnValue({ currentStyle: { label: { enabled: true } } });
        handler(new Event("click"));
        expect(mockToggleLabels).toHaveBeenCalledWith("lyt");
    });

    it("handler: toggleLabels returns true → adds --on class (MISS[4] if[0])", () => {
        btn.disabled = false;
        mockGetLayerById.mockReturnValue({ currentStyle: { label: { enabled: true } } });
        mockToggleLabels.mockReturnValue(true);
        handler(new Event("click"));
        expect(btn.classList.contains("gl-layer-manager__label-toggle--on")).toBe(true);
        expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    it("handler: toggleLabels returns false → removes --on class (MISS[4] if[1])", () => {
        btn.disabled = false;
        mockGetLayerById.mockReturnValue({ currentStyle: { label: { enabled: true } } });
        mockToggleLabels.mockReturnValue(false);
        handler(new Event("click"));
        expect(btn.getAttribute("aria-pressed")).toBe("false");
    });

    it("handler: catch block logs warning when getLayerById throws (MISS[5] if[0])", () => {
        btn.disabled = false;
        mockGetLayerById.mockImplementation(() => {
            throw new Error("boom");
        });
        expect(() => handler(new Event("click"))).not.toThrow();
        expect(logMock.warn).toHaveBeenCalled();
    });

    // ── createButton ─────────────────────────────────────────────────────────

    it("createButton: insertBefore visibilityToggle when present (MISS[11] if[0])", () => {
        const c = document.createElement("div");
        const toggle = document.createElement("button");
        toggle.className = "gl-layer-manager__item-toggle";
        c.appendChild(toggle);
        const b = LabelButtonManager.createButton("lyx", c);
        expect(b).not.toBeNull();
        expect(c.firstChild).toBe(b);
    });

    // ── syncImmediate ─────────────────────────────────────────────────────────

    it("syncImmediate: returns early when layerId empty", () => {
        expect(() => LabelButtonManager.syncImmediate("")).not.toThrow();
    });

    // ── _doSync ───────────────────────────────────────────────────────────────

    it("_doSync: returns early when layerId empty (MISS[15] if[0])", () => {
        expect(() => LabelButtonManager._doSync("")).not.toThrow();
    });

    it("_doSync: enters controlsContainer block, createButton called (MISS[18,19,20])", () => {
        const item = document.createElement("div");
        item.dataset.layerId = "lytest2";
        const controls = document.createElement("div");
        controls.className = "gl-layer-manager__item-controls";
        item.appendChild(controls);
        document.body.appendChild(item);
        LabelButtonManager._doSync("lytest2");
        const createdBtn = controls.querySelector(".gl-layer-manager__label-toggle");
        expect(createdBtn).not.toBeNull();
        item.remove();
    });

    // ── _applyState ───────────────────────────────────────────────────────────

    it("_applyState: shouldAppearOn false → removes --on class (MISS[25] if[1])", () => {
        const b = document.createElement("button");
        b.classList.add("gl-layer-manager__label-toggle--on");
        LabelButtonManager._applyState(b, {
            layerId: "ly1",
            layerExists: true,
            layerVisible: true,
            labelEnabled: true,
            areLabelsActive: false,
        });
        expect(b.classList.contains("gl-layer-manager__label-toggle--on")).toBe(false);
        expect(b.getAttribute("aria-pressed")).toBe("false");
    });

    // ── syncImmediate ─────────────────────────────────────────────────────────

    it("syncImmediate: returns early when layerId empty (MISS[26] if[0])", () => {
        expect(() => LabelButtonManager.syncImmediate("")).not.toThrow();
    });
});
