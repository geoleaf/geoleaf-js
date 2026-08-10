/**
 * Coverage — LayerManager
 * Targets: src/kernel/layer-manager/renderer.ts
 *          src/kernel/layer-manager/style-selector.ts
 *
 * Sprint T9 — coverage-modules pattern.
 *
 * ⚠️ Cette liste annonçait HUIT cibles ; ce fichier n'en importe que deux (B-31, 29/07/2026).
 * Les six autres — `shared.ts`, `visibility-checker.ts`, `attach-toggle.ts`,
 * `render-sections.ts`, `item-controls.ts`, `basemap-selector.ts` — n'étaient plus couvertes
 * ici, et deux d'entre elles n'existent même plus sous ce nom (`shared.ts` a disparu,
 * `item-controls.ts` est devenu `item-controls-seam.ts`). Une liste de cibles qu'aucun import
 * ne soutient donne à croire à une couverture qui n'a pas lieu : c'est le contraire du service
 * qu'un en-tête `Targets:` doit rendre.
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

// ⚠️ R.32 (25/07/2026) — un `vi.mock("…/themes/theme-applier/core.js")` fournissant
// `ThemeApplierCore.loadLayerFromProfile` vivait ici. Il est MORT : aucun des trois modules
// sous test (`renderer`, `visibility-checker`, `style-selector`) n'atteint `theme-applier/`,
// ni directement ni par ses imports. Prouvé par mutation — factory qui jette, suite
// inchangée à 10/10. Retiré : un mock qui ne mord rien donne l'illusion d'une isolation
// qui n'existe pas, et masque quelle est la vraie surface du test.

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
// ⚠️ R.32 (25/07/2026) — ce bloc importait `visibility-checker.ts` en pariant que
// l'extension `.ts` contournerait le `vi.mock("…/visibility-checker.js")` posé plus haut,
// et son titre affirmait « real implementation via real import ». **C'était faux** :
// vitest résout les deux vers le MÊME module, donc le bloc exerçait le mock. Le défaut
// était indétectable parce que le mock rend `false` et que les deux assertions attendent
// `false` — elles passaient dans les deux cas. Prouvé par mutation dans les deux sens :
// mock → `true` fait rougir ce bloc ; la VRAIE implémentation → `true` le laisse vert.
// Le mock ne peut pas être retiré (`renderer.ts` en dépend légitimement), d'où
// `importActual` : c'est le seul moyen d'atteindre l'implémentation réelle d'ici.
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
