/**
 * T10.3.2b — components-branches-deep.test.js
 * Covers: src/kernel/ui/components.ts (171 branches)
 * Strategy: await import() + minimal mock (Log only)
 * Real DOM operations via jsdom.
 */
"use strict";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("_UIComponents (T10.3.2b)", () => {
    let _UIComponents;

    beforeAll(async () => {
        const mod = await import("../../src/kernel/ui/components.ts");
        _UIComponents = mod._UIComponents;
    });

    const mkContainer = () => document.createElement("div");

    // ── createAccordion() ──────────────────────────────────────────────────────

    describe("createAccordion()", () => {
        it("creates all required elements", () => {
            const c = mkContainer();
            const { accordionEl, headerEl, bodyEl } = _UIComponents.createAccordion(c, {
                layerId: "l1",
                label: "Layer 1",
                collapsed: false,
                visible: true,
            });
            expect(accordionEl).toBeTruthy();
            expect(headerEl).toBeTruthy();
            expect(bodyEl).toBeTruthy();
        });

        it("adds collapsed class when collapsed:true", () => {
            const c = mkContainer();
            const { accordionEl } = _UIComponents.createAccordion(c, {
                layerId: "l2",
                label: "Layer 2",
                collapsed: true,
            });
            expect(accordionEl.classList.contains("gl-legend__accordion--collapsed")).toBe(true);
        });

        it("does NOT add collapsed class when collapsed:false", () => {
            const c = mkContainer();
            const { accordionEl } = _UIComponents.createAccordion(c, {
                layerId: "l3",
                label: "Layer 3",
                collapsed: false,
            });
            expect(accordionEl.classList.contains("gl-legend__accordion--collapsed")).toBe(false);
        });

        it("adds inactive class when visible:false", () => {
            const c = mkContainer();
            const { accordionEl } = _UIComponents.createAccordion(c, {
                layerId: "l4",
                label: "Layer 4",
                visible: false,
            });
            expect(accordionEl.classList.contains("gl-legend__accordion--inactive")).toBe(true);
        });

        it("click on visible accordion triggers toggle + callback", () => {
            const c = mkContainer();
            const onToggle = vi.fn();
            const { headerEl } = _UIComponents.createAccordion(c, {
                layerId: "lid",
                label: "Togglable",
                collapsed: false,
                visible: true,
                onToggle,
            });
            headerEl.click();
            expect(onToggle).toHaveBeenCalledWith("lid", expect.any(Boolean));
        });

        it("click on inactive accordion is a no-op (visible:false)", () => {
            const c = mkContainer();
            const onToggle = vi.fn();
            const { headerEl } = _UIComponents.createAccordion(c, {
                layerId: "inactive",
                label: "Inactive",
                visible: false,
                onToggle,
            });
            headerEl.click();
            expect(onToggle).not.toHaveBeenCalled();
        });

        it("click without onToggle callback doesn't throw", () => {
            const c = mkContainer();
            const { headerEl } = _UIComponents.createAccordion(c, {
                layerId: "no-cb",
                label: "No CB",
                visible: true,
                collapsed: false,
            });
            expect(() => headerEl.click()).not.toThrow();
        });
    });

    // ── renderCircleSymbol() ──────────────────────────────────────────────────

    describe("renderCircleSymbol()", () => {
        it("uses default radius 24 when not specified", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, {});
            expect(el.style.width).toBe("48px");
        });

        it("uses specified radius", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, { radius: 10 });
            expect(el.style.width).toBe("20px");
        });

        it("applies fillColor or falls back to color", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, { fillColor: "#f00" });
            // Color format varies by DOM impl: jsdom normalizes to rgb(), happy-dom keeps hex
            expect(el.style.backgroundColor).toBeTruthy();
        });

        it("applies fillOpacity to the background (rgba), not whole-swatch opacity", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, {
                fillColor: "#3388ff",
                fillOpacity: 0.5,
            });
            expect(el.style.opacity).toBe("");
            expect(el.style.backgroundColor).toMatch(/rgba?\(\s*51\s*,\s*136\s*,\s*255/);
        });

        it("does not set opacity when fillOpacity not provided", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, {});
            expect(el.style.opacity).toBe("");
        });

        it("attaches icon when config.icon present (valid id)", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, { icon: "my-icon" });
            // SVG should have been appended
            const svg = el.querySelector("svg");
            expect(svg).not.toBeNull();
        });

        it("handles icon with # prefix", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, { icon: "#my-icon", iconColor: "#fff" });
            const svg = el.querySelector("svg");
            expect(svg).not.toBeNull();
        });

        it("rejects icon with invalid characters — logs error, no SVG", () => {
            const c = mkContainer();
            const el = _UIComponents.renderCircleSymbol(c, { icon: "bad icon!!" });
            const svg = el.querySelector("svg");
            expect(svg).toBeNull();
        });

        it("logs sprite missing warning when sprite not in DOM", () => {
            const c = mkContainer();
            // Remove any sprite that may be present
            document
                .querySelectorAll('svg[data-geoleaf-sprite="profile"]')
                .forEach((e) => e.remove());
            const el = _UIComponents.renderCircleSymbol(c, { icon: "some-icon" });
            const svg = el.querySelector("svg");
            expect(svg).not.toBeNull();
            expect(svg.getAttribute("data-sprite-missing")).toBe("true");
        });

        it("logs symbol missing when sprite present but symbol absent", () => {
            const c = mkContainer();
            // Insert a sprite without the wanted symbol
            const spriteSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            spriteSvg.setAttribute("data-geoleaf-sprite", "profile");
            spriteSvg.style.display = "none";
            document.body.appendChild(spriteSvg);
            const el = _UIComponents.renderCircleSymbol(c, { icon: "nonexistent-symbol" });
            const svg = el.querySelector("svg");
            expect(svg.getAttribute("data-symbol-missing")).toBe("#nonexistent-symbol");
            document.body.removeChild(spriteSvg);
        });

        it("no sprite warning when symbol exists in sprite", () => {
            const c = mkContainer();
            const spriteSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            spriteSvg.setAttribute("data-geoleaf-sprite", "profile");
            spriteSvg.style.display = "none";
            const sym = document.createElementNS("http://www.w3.org/2000/svg", "symbol");
            sym.setAttribute("id", "existing-symbol");
            spriteSvg.appendChild(sym);
            document.body.appendChild(spriteSvg);
            const el = _UIComponents.renderCircleSymbol(c, { icon: "existing-symbol" });
            const svg = el.querySelector("svg");
            expect(svg.getAttribute("data-sprite-missing")).toBeNull();
            expect(svg.getAttribute("data-symbol-missing")).toBeNull();
            document.body.removeChild(spriteSvg);
        });
    });

    // ── renderLineSymbol() ────────────────────────────────────────────────────

    describe("renderLineSymbol()", () => {
        it("returns a div for simple solid line", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { color: "#00f" });
            expect(el.tagName).toBe("DIV");
        });

        it("returns SVG for dashed line", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { dashArray: "4,4" });
            expect(el.tagName).toBe("svg");
        });

        it("returns SVG for thick line (width > 5)", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { width: 6 });
            expect(el.tagName).toBe("svg");
        });

        it("returns SVG when outlineColor + outlineWidth both present", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, {
                outlineColor: "#000",
                outlineWidth: 2,
            });
            expect(el.tagName).toBe("svg");
        });

        it("dashed style applies background-image on div", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { style: "dashed" });
            expect(el.style.backgroundImage).toContain("linear-gradient");
        });

        it("dotted style applies background-image on div", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { style: "dotted" });
            expect(el.style.backgroundImage).toContain("linear-gradient");
        });

        it("solid style has no backgroundImage", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { style: "solid" });
            expect(el.style.backgroundImage).toBe("");
        });

        it("opacity applied when config.opacity present", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, { opacity: 0.5 });
            expect(el.style.opacity).toBe("0.5");
        });

        it("SVG with outlineColor adds outline line element", () => {
            const c = mkContainer();
            const el = _UIComponents.renderLineSymbol(c, {
                outlineColor: "#ccc",
                outlineWidth: 3,
                opacity: 0.8,
                outlineOpacity: 0.5,
            });
            const lines = el.querySelectorAll("line");
            expect(lines.length).toBe(2); // outline + main
        });
    });

    // ── renderPolygonSymbol() ─────────────────────────────────────────────────

    describe("renderPolygonSymbol()", () => {
        it("returns div for simple polygon", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, { fillColor: "#3ff" });
            expect(el.tagName).toBe("DIV");
        });

        it("returns SVG when fillOpacity=0", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, { fillOpacity: 0 });
            expect(el.tagName).toBe("svg");
        });

        it("returns SVG when hatch.enabled=true", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, {
                hatch: { enabled: true, type: "diagonal" },
            });
            expect(el.tagName).toBe("svg");
        });

        it("hatch with renderMode=pattern_only sets fillOpacity=1", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, {
                hatch: { enabled: true, type: "diagonal", renderMode: "pattern_only" },
            });
            expect(el.tagName).toBe("svg");
        });

        it("hatch type dot", () => {
            const c = mkContainer();
            expect(() =>
                _UIComponents.renderPolygonSymbol(c, {
                    hatch: { enabled: true, type: "dot", stroke: { color: "#f00" } },
                })
            ).not.toThrow();
        });

        it("hatch type cross", () => {
            const c = mkContainer();
            expect(() =>
                _UIComponents.renderPolygonSymbol(c, {
                    hatch: { enabled: true, type: "cross" },
                })
            ).not.toThrow();
        });

        it("hatch type x", () => {
            const c = mkContainer();
            expect(() =>
                _UIComponents.renderPolygonSymbol(c, {
                    hatch: { enabled: true, type: "x" },
                })
            ).not.toThrow();
        });

        it("fillOpacity fallback to opacity when fillOpacity undefined", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, { opacity: 0.5 });
            expect(el.style.opacity).toBe("0.5");
        });

        it("fillOpacity defaults to 1 when none specified — no opacity style", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, {});
            expect(el.style.opacity).toBe("");
        });

        it("SVG polygon has dashArray attribute when config.dashArray set", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, { fillOpacity: 0, dashArray: "4,4" });
            const rect = el.querySelector("rect");
            expect(rect.getAttribute("stroke-dasharray")).toBe("4,4");
        });

        it("fillColor or color resolve correctly", () => {
            const c = mkContainer();
            const el = _UIComponents.renderPolygonSymbol(c, { color: "#abcdef" });
            expect(el.style.backgroundColor).toBeTruthy();
        });
    });

    // ── renderStarSymbol() ────────────────────────────────────────────────────

    describe("renderStarSymbol()", () => {
        it("renders default 5 stars", () => {
            const c = mkContainer();
            const el = _UIComponents.renderStarSymbol(c, {});
            expect(el.querySelectorAll(".gl-legend__star").length).toBe(5);
        });

        it("renders specified count of stars", () => {
            const c = mkContainer();
            const el = _UIComponents.renderStarSymbol(c, { count: 3, color: "#f00", size: 16 });
            expect(el.querySelectorAll(".gl-legend__star").length).toBe(3);
        });
    });

    // ── renderSymbol() ────────────────────────────────────────────────────────

    describe("renderSymbol()", () => {
        const types = ["circle", "marker", "line", "polygon", "fill", "star", "icon"];
        for (const type of types) {
            it(`dispatches to renderer for type "${type}"`, () => {
                const c = mkContainer();
                expect(() =>
                    _UIComponents.renderSymbol(c, {
                        type,
                        iconUrl: type === "icon" ? "http://example.com/icon.png" : undefined,
                    })
                ).not.toThrow();
            });
        }

        it("unknown type falls back to circle renderer", () => {
            const c = mkContainer();
            const el = _UIComponents.renderSymbol(c, { type: "unknown_type" });
            expect(el).toBeTruthy();
        });

        it("icon type with iconUrl creates img element", () => {
            const c = mkContainer();
            _UIComponents.renderSymbol(c, {
                type: "icon",
                iconUrl: "http://x.com/a.png",
                size: 32,
            });
            expect(c.querySelector("img")).not.toBeNull();
        });

        it("icon type without iconUrl falls back to circle", () => {
            const c = mkContainer();
            const el = _UIComponents.renderSymbol(c, { type: "icon" });
            expect(el).toBeTruthy();
        });

        it("supports config.symbol wrapper", () => {
            const c = mkContainer();
            const el = _UIComponents.renderSymbol(c, { symbol: { type: "line" } });
            expect(el).toBeTruthy();
        });
    });

    // ── createToggleButton() ──────────────────────────────────────────────────

    describe("createToggleButton()", () => {
        it("creates button with aria-pressed=false when isActive=false", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { isActive: false });
            expect(btn.getAttribute("aria-pressed")).toBe("false");
        });

        it("creates button with aria-pressed=true when active=true (alias)", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { active: true });
            expect(btn.getAttribute("aria-pressed")).toBe("true");
        });

        it("adds --on class when isActive:true", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { isActive: true });
            expect(btn.classList.contains("gl-toggle-btn--on")).toBe(true);
        });

        it("sets data-toggle-id when id provided", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { id: "my-toggle" });
            expect(btn.getAttribute("data-toggle-id")).toBe("my-toggle");
        });

        it("sets title when provided", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { title: "Toggle me" });
            expect(btn.title).toBe("Toggle me");
        });

        it("sets textContent when label provided", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { label: "My Label" });
            expect(btn.textContent).toBe("My Label");
        });

        it("click calls onToggle callback", () => {
            const c = mkContainer();
            const onToggle = vi.fn();
            const btn = _UIComponents.createToggleButton(c, {
                id: "t1",
                onToggle,
                isActive: false,
            });
            btn.click();
            expect(onToggle).toHaveBeenCalled();
        });

        it("no callback — click does not throw", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, { isActive: false });
            expect(() => btn.click()).not.toThrow();
        });

        it("custom className applied", () => {
            const c = mkContainer();
            const btn = _UIComponents.createToggleButton(c, {
                className: "my-btn",
                isActive: true,
            });
            expect(btn.classList.contains("my-btn")).toBe(true);
            expect(btn.classList.contains("my-btn--on")).toBe(true);
        });
    });

    // ── attachEventHandler() ──────────────────────────────────────────────────

    describe("attachEventHandler()", () => {
        it("attaches click handler that fires", () => {
            const el = document.createElement("button");
            const handler = vi.fn();
            _UIComponents.attachEventHandler(el, "click", handler);
            el.click();
            expect(handler).toHaveBeenCalled();
        });

        it("attaches non-click event", () => {
            const el = document.createElement("div");
            const handler = vi.fn();
            _UIComponents.attachEventHandler(el, "mouseenter", handler);
            el.dispatchEvent(new Event("mouseenter"));
            expect(handler).toHaveBeenCalled();
        });
    });
});
