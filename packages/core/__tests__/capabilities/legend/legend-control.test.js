/**
 */
/* Phase 5.22 - legend-control */

const mockClearElementFast = vi.fn((el) => {
    if (el) el.innerHTML = "";
});
const mockRenderSection = vi.fn();
const mockRenderFooter = vi.fn();
const mockRenderAccordion = vi.fn();

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/kernel/security/dom-security.js", () => ({
    DOMSecurity: { clearElementFast: (el) => mockClearElementFast(el) },
}));
// D2: legend-control reads the sprite injector from the MapLibre adapter now.
vi.mock("../../../src/utils/loaders/profile-sprite-loader.js", () => ({
    ensureProfileSpriteInjectedSync: vi.fn(() => Promise.resolve()),
    isProfileSpriteReady: () =>
        document.querySelector('svg[data-geoleaf-sprite="profile"]') !== null,
    registerSpriteIcons: vi.fn(() => Promise.resolve()),
    hasProfileSprite: vi.fn(() => false),
}));
vi.mock("../../../src/capabilities/legend/legend-renderer.ts", () => ({
    LegendRenderer: {
        renderSection: (el, section) => mockRenderSection(el, section),
        renderFooter: (el, footer) => mockRenderFooter(el, footer),
        renderAccordion: (el, data) => mockRenderAccordion(el, data),
    },
}));
import { LegendControl } from "../../../src/capabilities/legend/legend-control.js";
import { Log } from "../../../src/utils/log/index.js";
// Namespace: the test MUTATES `lrMod.LegendRenderer.renderAccordion` to
// cover the "renderAccordion absent" branch. A property of the mocked object,
// not the namespace binding — an ESM namespace is sealed, its objects are not.
import * as lrMod from "../../../src/capabilities/legend/legend-renderer.js";

describe("legend/legend-control (Phase 5.22)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '<svg data-geoleaf-sprite="profile"></svg>';
    });

    describe("LegendControl.create", () => {
        it("exports create function", () => {
            expect(LegendControl).toBeDefined();
            expect(LegendControl.create).toBeDefined();
            expect(typeof LegendControl.create).toBe("function");
        });

        it("returns control instance with default position when options provided", () => {
            const control = LegendControl.create({ position: "bottomleft", title: "Legend" });
            expect(control).toBeDefined();
            expect(control._glOptions).toBeDefined();
            expect(control._glOptions.position).toBe("bottomleft");
            expect(control._glOptions.title).toBe("Legend");
        });

        it("addTo creates container with gl-map-legend class", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({ title: "Test" });
            control.addTo(mockAdapter);
            const container = control._container;
            expect(container).toBeInstanceOf(HTMLElement);
            expect(container.className).toContain("gl-map-legend");
            expect(control._bodyEl).toBeTruthy();
        });

        it("remove clears _map and _container", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            control.remove();
            expect(control._map).toBeNull();
            expect(control._container).toBeNull();
        });

        it("show sets container display to block", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            control.show();
            expect(control._container.style.display).toBe("block");
        });

        it("hide sets container display to none", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            control.hide();
            expect(control._container.style.display).toBe("none");
        });

        it("updateMultiLayerContent clears body and calls renderAccordion per entry", async () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            const entries = [
                { layerId: "l1", label: "Layer 1", sections: [] },
                { layerId: "l2", label: "Layer 2", sections: [] },
            ];
            control.updateMultiLayerContent(entries);
            await Promise.resolve();
            expect(mockClearElementFast).toHaveBeenCalled();
            expect(mockRenderAccordion).toHaveBeenCalledTimes(2);
        });
    });

    // create() returns an adapter-agnostic control instance (plain object).
    it("create returns a valid control instance", () => {
        const ctrl = LegendControl.create({});
        expect(ctrl).not.toBeNull();
        expect(ctrl._glOptions).toBeDefined();
    });

    it("updateMultiLayerContent runs ensureSpriteLoaded callback", async () => {
        const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
        const control = LegendControl.create({});
        control.addTo(mockAdapter);
        const entries = [{ layerId: "l1", label: "L1", sections: [] }];
        control.updateMultiLayerContent(entries);
        await Promise.resolve();
        expect(mockRenderAccordion).toHaveBeenCalled();
    });

    describe("branches supplémentaires", () => {
        it("collapsible: true — toggle créé et _toggleCollapsed déclenché", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({ title: "T", collapsible: true });
            control.addTo(mockAdapter);
            const toggle = control._container.querySelector(".gl-map-legend__toggle");
            expect(toggle).not.toBeNull();
            toggle.click();
            expect(control._container.classList.contains("gl-map-legend--collapsed")).toBe(true);
            expect(control._glOptions.collapsed).toBe(true);
            toggle.click();
            expect(control._container.classList.contains("gl-map-legend--collapsed")).toBe(false);
        });

        it("show() sans container — pas d'erreur", () => {
            const control = LegendControl.create({});
            expect(() => control.show()).not.toThrow();
        });

        it("hide() sans container — pas d'erreur", () => {
            const control = LegendControl.create({});
            expect(() => control.hide()).not.toThrow();
        });

        it("updateMultiLayerContent avant onAdd — retour immédiat", () => {
            const control = LegendControl.create({});
            expect(() => control.updateMultiLayerContent([])).not.toThrow();
            expect(mockRenderAccordion).not.toHaveBeenCalled();
        });

        it("opts.collapsed: true — container reçoit la classe collapsed", () => {
            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({ collapsed: true });
            control.addTo(mockAdapter);
            expect(control._container.classList.contains("gl-map-legend--collapsed")).toBe(true);
        });

        it("updateMultiLayerContent: Log.error si renderAccordion absent", () => {
            const savedFn = lrMod.LegendRenderer.renderAccordion;
            // Remove renderAccordion so typeof check fails inside _updateMultiLayerLegendContent
            lrMod.LegendRenderer.renderAccordion = null;

            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            control.updateMultiLayerContent([]);

            expect(Log.error).toHaveBeenCalledWith(
                "[Legend] Renderer.renderAccordion not available"
            );
            lrMod.LegendRenderer.renderAccordion = savedFn;
        });

        it("ensureSpriteLoaded: no sprite → callback(false) then late re-render after 1s", async () => {
            vi.useFakeTimers();
            // No sprite in the DOM → the (mocked) injector resolves without adding
            // one → callback(false) → "No SVG sprite found" + a 1s retry.
            document.body.innerHTML = "";

            const mockAdapter = { addControl: vi.fn(() => ({ remove: vi.fn() })) };
            const control = LegendControl.create({});
            control.addTo(mockAdapter);
            control.updateMultiLayerContent([{ layerId: "l1", label: "L1", sections: [] }]);
            // Flush the injector's awaited promise so the (false) callback runs and
            // schedules the 1s retry.
            await Promise.resolve();
            await Promise.resolve();

            // The sprite arrives late; the 1s retry finds it → Log.info + re-render.
            document.body.innerHTML = '<svg data-geoleaf-sprite="profile"></svg>';
            vi.advanceTimersByTime(1100);

            expect(Log.debug).toHaveBeenCalledWith(expect.stringContaining("No SVG sprite found"));
            expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("Sprite loaded late"));

            vi.useRealTimers();
        });
    });
});
