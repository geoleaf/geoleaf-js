/**
 * Coverage — LayerManager
 * Targets: src/kernel/layer-manager/renderer.ts
 *          src/kernel/layer-manager/style-selector.ts
 *
 * Sprint T9 — coverage-modules pattern.
 *
 * ⚠️ This list announced EIGHT targets; this file imports only two
 * (29/07/2026). The six others — `shared.ts`, `visibility-checker.ts`,
 * `attach-toggle.ts`, `render-sections.ts`, `item-controls.ts`,
 * `basemap-selector.ts` — were no longer covered here, and two of them do
 * not even exist under that name any more (`shared.ts` vanished,
 * `item-controls.ts` became `item-controls-seam.ts`). A target list no
 * import backs suggests coverage that does not happen: the opposite of the
 * service a `Targets:` header must render.
 */
"use strict";

// ── Shared mocks ──────────────────────────────────────────────────────────────
vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/kernel/shared/geojson-state.js", () => ({
    GeoJSONShared: {
        state: { layers: new Map(), map: null },
        getLayers: vi.fn(() => new Map()),
    },
}));

vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        getLayerById: vi.fn(() => null),
        showLayer: vi.fn(),
        hideLayer: vi.fn(),
    },
}));

// ⚠️ A `vi.mock("…/themes/theme-applier/core.js")` providing
// `ThemeApplierCore.loadLayerFromProfile` lived here. It is DEAD: none of
// the three modules under test (`renderer`, `visibility-checker`,
// `style-selector`) reaches `theme-applier/`, directly or through its
// imports. Proven by mutation — throwing factory, suite unchanged at
// 10/10. Removed: a mock that bites nothing gives the illusion of an
// isolation that does not exist, and masks the test's real surface.

vi.mock("../../src/kernel/layer-manager/render-sections.js", () => ({
    renderSections: vi.fn(),
}));

vi.mock("../../src/kernel/layer-manager/item-controls.js", () => ({
    renderItems: vi.fn(),
    renderToggleControls: vi.fn(),
}));

vi.mock("../../src/kernel/layer-manager/attach-toggle.js", () => ({
    attachToggleHandler: vi.fn(),
}));

vi.mock("../../src/kernel/layer-manager/visibility-checker.js", () => ({
    checkLayerVisibility: vi.fn(() => false),
}));

// ── LMRenderer ────────────────────────────────────────────────────────────────
import { LMRenderer } from "../../src/kernel/layer-manager/renderer.ts";

describe("Coverage — LMRenderer", () => {
    it("renderSections does not throw with null bodyEl", () => {
        expect(() => LMRenderer.renderSections(null, [])).not.toThrow();
    });

    it("renderSections does not throw with a valid body element and empty sections", () => {
        const body = document.createElement("div");
        expect(() => LMRenderer.renderSections(body, [])).not.toThrow();
    });

    it("renderSections does not throw with populated sections", () => {
        const body = document.createElement("div");
        const sections = [{ id: "s1", items: [{ id: "layer-1", label: "Layer 1" }] }];
        expect(() => LMRenderer.renderSections(body, sections)).not.toThrow();
    });

    it("syncToggles does not throw when DOM has no layer items", () => {
        expect(() => LMRenderer.syncToggles()).not.toThrow();
    });

    it("syncToggles does not throw when DOM has layer items with data-layer-id", () => {
        const item = document.createElement("div");
        item.setAttribute("data-layer-id", "layer-1");
        document.body.appendChild(item);
        expect(() => LMRenderer.syncToggles()).not.toThrow();
        item.remove();
    });

    it("syncToggles updates aria-pressed on toggle buttons", () => {
        const item = document.createElement("div");
        item.setAttribute("data-layer-id", "layer-2");
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "gl-layer-manager__item-toggle";
        item.appendChild(toggleBtn);
        document.body.appendChild(item);

        LMRenderer.syncToggles();

        expect(toggleBtn.getAttribute("aria-pressed")).toBe("false"); // mock returns false
        item.remove();
    });
});

// ── VisibilityChecker ─────────────────────────────────────────────────────────
// ⚠️ This block imported `visibility-checker.ts` betting that the `.ts`
// extension would bypass the `vi.mock("…/visibility-checker.js")` set
// above, and its title claimed "real implementation via real import". **It
// was false**: vitest resolves both to the SAME module, so the block
// exercised the mock. The defect was undetectable because the mock returns
// `false` and both assertions expect `false` — they passed either way.
// Proven by mutation both ways: mock → `true` turns this block red; the
// REAL implementation → `true` leaves it green. The mock cannot be removed
// (`renderer.ts` legitimately depends on it), hence `importActual`: the
// only way to reach the real implementation from here.
const { checkLayerVisibility } = await vi.importActual(
    "../../src/kernel/layer-manager/visibility-checker.ts"
);

describe("Coverage — checkLayerVisibility (implémentation réelle via importActual)", () => {
    it("returns false when GeoJSONCore.getLayerById returns null", () => {
        const result = checkLayerVisibility("non-existent-layer");
        expect(result).toBe(false);
    });

    it("handles empty string layerId", () => {
        const result = checkLayerVisibility("");
        expect(result).toBe(false);
    });
});

// ── StyleSelector ─────────────────────────────────────────────────────────────
import { StyleSelector } from "../../src/kernel/layer-manager/style-selector.ts";

describe("Coverage — StyleSelector", () => {
    it("is exported and defined", () => {
        expect(StyleSelector).toBeDefined();
    });

    it("has expected shape (object or class)", () => {
        expect(typeof StyleSelector === "object" || typeof StyleSelector === "function").toBe(true);
    });
});
