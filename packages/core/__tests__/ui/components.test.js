/**
 */
/* Phase 5.1 — modules/ui/components.ts */

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { _UIComponents } from "../../src/kernel/ui/components.js";

describe("ui/components (Phase 5.1)", () => {
    let container;

    beforeEach(() => {
        container = document.createElement("div");
    });

    describe("createAccordion", () => {
        it("creates accordion with header and body", () => {
            const result = _UIComponents.createAccordion(container, {
                layerId: "ly1",
                label: "Ma couche",
                collapsed: false,
                visible: true,
            });
            expect(result.accordionEl).toBeTruthy();
            expect(result.headerEl).toBeTruthy();
            expect(result.bodyEl).toBeTruthy();
            expect(result.accordionEl.getAttribute("data-layer-id")).toBe("ly1");
            expect(
                result.accordionEl.querySelector(".gl-legend__accordion-title").textContent
            ).toBe("Ma couche");
        });

        it("adds collapsed class when config.collapsed true", () => {
            _UIComponents.createAccordion(container, {
                layerId: "ly1",
                label: "X",
                collapsed: true,
                visible: true,
            });
            expect(container.querySelector(".gl-legend__accordion--collapsed")).toBeTruthy();
        });

        it("sets aria-expanded on header", () => {
            const result = _UIComponents.createAccordion(container, {
                layerId: "ly1",
                label: "X",
                collapsed: false,
                visible: true,
            });
            expect(result.headerEl.getAttribute("aria-expanded")).toBe("true");
        });

        it("adds inactive class when config.visible false", () => {
            _UIComponents.createAccordion(container, {
                layerId: "ly1",
                label: "X",
                collapsed: false,
                visible: false,
            });
            expect(container.querySelector(".gl-legend__accordion--inactive")).toBeTruthy();
        });

        it("calls onToggle when header clicked and visible", () => {
            const onToggle = vi.fn();
            const result = _UIComponents.createAccordion(container, {
                layerId: "ly1",
                label: "X",
                collapsed: false,
                visible: true,
                onToggle,
            });
            result.headerEl.click();
            expect(onToggle).toHaveBeenCalledWith("ly1", false);
        });
    });

    describe("renderCircleSymbol", () => {
        it("creates circle div with default styles", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderCircleSymbol(parent, {});
            expect(el).toBeTruthy();
            expect(el.className).toContain("gl-legend__circle");
            expect(el.style.backgroundColor).toBeTruthy();
            expect(el.style.borderRadius).toBe("50%");
        });

        it("uses config fillColor and radius", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderCircleSymbol(parent, {
                fillColor: "#ff0000",
                radius: 10,
            });
            expect(el.style.backgroundColor).toMatch(/#ff0000|rgb\s*\(\s*255\s*,/);
            expect(el.style.width).toBe("20px");
        });

        it("applies fillOpacity to the fill (rgba) and keeps the swatch opaque", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderCircleSymbol(parent, {
                fillColor: "#3388ff",
                fillOpacity: 0.8,
                icon: "my-icon",
            });
            // fillOpacity now tints the background (rgba) instead of dimming the whole
            // swatch — the border stays opaque so hollow markers keep their outline.
            expect(el.style.opacity).toBe("");
            expect(el.style.backgroundColor).toMatch(/rgba?\(\s*51\s*,\s*136\s*,\s*255/);
            expect(el.querySelector("svg")).toBeTruthy();
        });

        it("keeps the swatch visible when fillOpacity is 0 (hollow marker)", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderCircleSymbol(parent, {
                fillColor: "#000000",
                color: "#000000",
                fillOpacity: 0,
            });
            // Regression: fillOpacity:0 must not hide the whole swatch (was style.opacity:0).
            expect(el.style.opacity).toBe("");
            expect(el.style.border).toContain("solid");
        });
    });

    describe("renderLineSymbol", () => {
        it("creates line element with color and width", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderLineSymbol(parent, { width: 3, color: "#3388ff" });
            expect(el).toBeTruthy();
            expect(parent.contains(el)).toBe(true);
        });

        it("creates SVG line when dashArray or width > 5 or outline", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderLineSymbol(parent, { width: 6, color: "#333" });
            expect(el.tagName).toBe("svg");
            const line = el.querySelector("line");
            expect(line).toBeTruthy();
        });

        it("creates SVG line with dashArray and outline", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderLineSymbol(parent, {
                width: 2,
                dashArray: "4,2",
                outlineColor: "#000",
                outlineWidth: 2,
            });
            expect(el.tagName).toBe("svg");
            expect(el.querySelectorAll("line").length).toBeGreaterThanOrEqual(1);
        });

        it("applies dashed and dotted style on fallback div", () => {
            const parent = document.createElement("div");
            const elDashed = _UIComponents.renderLineSymbol(parent, { width: 2, style: "dashed" });
            expect(elDashed).toBeTruthy();
            expect(elDashed.className).toContain("gl-legend__line");
            const parent2 = document.createElement("div");
            const elDotted = _UIComponents.renderLineSymbol(parent2, { width: 2, style: "dotted" });
            expect(elDotted).toBeTruthy();
            expect(elDotted.className).toContain("gl-legend__line");
        });

        it("applies opacity on line", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderLineSymbol(parent, {
                width: 3,
                color: "#333",
                opacity: 0.5,
            });
            expect(el.style.opacity).toBe("0.5");
        });
    });

    describe("renderPolygonSymbol", () => {
        it("creates polygon div with color and border", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderPolygonSymbol(parent, { fillColor: "#3388ff" });
            expect(el).toBeTruthy();
            expect(el.className).toContain("gl-legend__polygon");
            expect(el.style.backgroundColor).toBeTruthy();
        });

        it("creates SVG polygon when fillOpacity 0 (stroke only)", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderPolygonSymbol(parent, {
                fillOpacity: 0,
                borderColor: "#333",
            });
            expect(el.tagName).toBe("svg");
            const rect = el.querySelector("rect");
            expect(rect).toBeTruthy();
            expect(rect.getAttribute("fill")).toBe("none");
        });

        it("creates SVG polygon with hatch diagonal", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderPolygonSymbol(parent, {
                hatch: { enabled: true, type: "diagonal", spacingPx: 8 },
            });
            expect(el.tagName).toBe("svg");
            expect(el.querySelector("pattern")).toBeTruthy();
        });

        it("creates SVG polygon with hatch dot, cross and x", () => {
            const parent = document.createElement("div");
            const elDot = _UIComponents.renderPolygonSymbol(parent, {
                hatch: { enabled: true, type: "dot", spacingPx: 6 },
            });
            expect(elDot.querySelector("circle")).toBeTruthy();
            const parent2 = document.createElement("div");
            const elCross = _UIComponents.renderPolygonSymbol(parent2, {
                hatch: { enabled: true, type: "cross", spacingPx: 8 },
            });
            expect(elCross.querySelectorAll("line").length).toBe(2);
            const parent3 = document.createElement("div");
            const elX = _UIComponents.renderPolygonSymbol(parent3, {
                hatch: { enabled: true, type: "x", spacingPx: 8 },
            });
            expect(elX.querySelectorAll("line").length).toBe(2);
        });

        it("creates SVG polygon with hatch pattern_only", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderPolygonSymbol(parent, {
                hatch: { enabled: true, renderMode: "pattern_only", type: "diagonal" },
            });
            expect(el.tagName).toBe("svg");
        });
    });

    describe("renderSymbol", () => {
        it("delegates circle type to renderCircleSymbol", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderSymbol(parent, { type: "circle" });
            expect(el).toBeTruthy();
            expect(el.className).toContain("gl-legend__circle");
        });

        it("delegates line type to renderLineSymbol", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderSymbol(parent, { type: "line", color: "#333" });
            expect(el).toBeTruthy();
        });

        it("delegates polygon and fill type to renderPolygonSymbol", () => {
            const parent = document.createElement("div");
            const elP = _UIComponents.renderSymbol(parent, { type: "polygon" });
            expect(elP).toBeTruthy();
            const parent2 = document.createElement("div");
            const elF = _UIComponents.renderSymbol(parent2, { type: "fill" });
            expect(elF).toBeTruthy();
        });

        it("delegates star type to renderStarSymbol", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderSymbol(parent, { type: "star", count: 3 });
            expect(el).toBeTruthy();
            expect(el.className).toContain("gl-legend__stars");
        });

        it("delegates icon type with iconUrl to img element", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderSymbol(parent, {
                type: "icon",
                iconUrl: "https://example.com/i.png",
                size: 24,
            });
            expect(el.tagName).toBe("IMG");
            expect(el.src).toContain("example.com");
            expect(el.style.width).toBe("24px");
        });

        it("uses config.symbol when present", () => {
            const parent = document.createElement("div");
            const el = _UIComponents.renderSymbol(parent, {
                symbol: { type: "line", color: "#000" },
            });
            expect(el).toBeTruthy();
        });
    });

    describe("createToggleButton", () => {
        it("creates button with aria-pressed", () => {
            const btn = _UIComponents.createToggleButton(container, {
                isActive: true,
                label: "Toggle",
            });
            expect(btn).toBeTruthy();
            expect(btn.getAttribute("aria-pressed")).toBe("true");
            expect(btn.classList.contains("gl-toggle-btn--on")).toBe(true);
        });

        it("supports active alias and title and id", () => {
            const btn = _UIComponents.createToggleButton(container, {
                active: true,
                title: "Tooltip",
                id: "my-toggle",
            });
            expect(btn.getAttribute("data-toggle-id")).toBe("my-toggle");
            expect(btn.title).toBe("Tooltip");
        });

        it("calls onToggle when clicked", () => {
            const onToggle = vi.fn();
            const btn = _UIComponents.createToggleButton(container, {
                id: "t1",
                isActive: false,
                onToggle,
            });
            btn.click();
            expect(onToggle).toHaveBeenCalled();
        });
    });

    describe("attachEventHandler", () => {
        it("attaches listener via native addEventListener", () => {
            const el = document.createElement("button");
            const handler = vi.fn();
            _UIComponents.attachEventHandler(el, "click", handler);
            el.click();
            expect(handler).toHaveBeenCalled();
        });
    });
});
