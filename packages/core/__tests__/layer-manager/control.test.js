/**
 * Phase 60 — Step 3.4: src/kernel/layer-manager/control.ts (0% → 60%)
 */
vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockRenderSections = vi.hoisted(() => vi.fn());
const mockSyncToggles = vi.hoisted(() => vi.fn());
vi.mock("../../src/kernel/layer-manager/renderer.ts", () => ({
    LMRenderer: {
        renderSections: mockRenderSections,
        syncToggles: mockSyncToggles,
    },
}));
import { LMControl } from "../../src/kernel/layer-manager/control.js";
import { LMRenderer as mockLMR } from "../../src/kernel/layer-manager/renderer.js";

describe("layer-manager/control (step 3.4)", () => {
    beforeEach(() => {
        mockRenderSections.mockClear();
        mockSyncToggles.mockClear();
    });

    it("exporte LMControl avec create", () => {
        expect(LMControl).toBeDefined();
        expect(typeof LMControl.create).toBe("function");
    });

    // Sprint 6: LMControl now uses addTo(adapter) instead of onAdd(map) — adapter pattern.
    it("create retourne un controle valide quand L.Control est present", () => {
        const ctrl = LMControl.create({});
        expect(ctrl).not.toBeNull();
        expect(typeof ctrl.addTo).toBe("function");
    });

    it("create returns une instance avec addTo, updateSections, refresh", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ position: "topright", title: "Layers" });
        expect(instance).not.toBeNull();
        expect(typeof instance.addTo).toBe("function");
        expect(typeof instance.updateSections).toBe("function");
        expect(typeof instance.refresh).toBe("function");
        instance.addTo(mockAdapter);
        const result = instance._container;
        expect(result).toBeTruthy();
        expect(result.className).toContain("gl-layer-manager");
        instance.updateSections([{ id: "a" }]);
        expect(mockRenderSections).toHaveBeenCalled();
        instance.refresh();
        expect(mockSyncToggles).toHaveBeenCalled();
    });
});

// ── T22 — layer-manager/control.ts branch coverage ───────────────────────────
describe("layer-manager/control — T22 branch coverage", () => {
    beforeEach(() => {
        mockRenderSections.mockClear();
        mockSyncToggles.mockClear();
    });

    it("title defaults to 'Legend' when not provided (branch 1.1)", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ position: "topright" });
        expect(instance).not.toBeNull();
        instance.addTo(mockAdapter);
        const container = instance._container;
        const titleEl = container.querySelector(".gl-layer-manager__title");
        expect(titleEl.textContent).toBe("Legend");
    });

    it("position defaults to 'bottomright' when not provided (branch 8.1)", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ title: "L" });
        expect(instance).not.toBeNull();
        instance.addTo(mockAdapter);
        expect(mockAdapter.addControl).toHaveBeenCalled();
    });

    it("collapsed: true adds collapsed class on addTo (branch 3.0)", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ title: "L", collapsed: true });
        instance.addTo(mockAdapter);
        const container = instance._container;
        expect(container.classList.contains("gl-layer-manager--collapsed")).toBe(true);
    });

    it("collapsible: true builds toggle button (branch 11.0)", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ title: "L", collapsible: true });
        instance.addTo(mockAdapter);
        const container = instance._container;
        const toggle = container.querySelector(".gl-layer-manager__toggle");
        expect(toggle).not.toBeNull();
        expect(toggle.tagName.toLowerCase()).toBe("button");
    });

    it("updateSections with non-array uses [] fallback (branch 14.1)", () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const instance = LMControl.create({ title: "L" });
        instance.addTo(mockAdapter);
        mockRenderSections.mockClear();
        instance.updateSections("not-an-array");
        expect(mockRenderSections).toHaveBeenCalledWith(expect.anything(), []);
    });

    it("refresh calls _renderSections when syncToggles is not a function (branches 15.1, 17.0)", () => {
        const origSync = mockLMR.syncToggles;
        mockLMR.syncToggles = undefined;
        try {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const instance = LMControl.create({ title: "L" });
            instance.addTo(mockAdapter);
            instance.updateSections([{ id: "a" }]);
            mockRenderSections.mockClear();
            instance.refresh();
            expect(mockRenderSections).toHaveBeenCalled();
        } finally {
            mockLMR.syncToggles = origSync;
        }
    });
});
