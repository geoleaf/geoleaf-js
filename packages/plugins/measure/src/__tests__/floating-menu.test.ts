/**
 * Tests for floating-menu.ts
 * Covers: initMenu, toggleMeasureMenu, setActiveTool, setCurrentUnits, destroyMenu, drag.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    initMenu,
    toggleMeasureMenu,
    setActiveTool,
    getCurrentTool,
    setCurrentUnits,
    getCurrentUnits,
    setMenuPosition,
    getMenuHeight,
    positionMeasureMenuNear,
    destroyMenu,
    selectTool,
} from "../floating-menu.js";
import { getMeasureConfig } from "../config.js";
import { renderRecap } from "../recap-box.js";
import { installMockGeoLeaf, uninstallMockGeoLeaf, makeMockMaplibreMap } from "./setup.js";

// Make requestAnimationFrame synchronous so drag tests are deterministic.
(globalThis as any).requestAnimationFrame = (fn: FrameRequestCallback): number => {
    fn(0);
    return 0;
};
(globalThis as any).cancelAnimationFrame = (_id: number): void => {};

describe("floating-menu", () => {
    let nativeMap: ReturnType<typeof makeMockMaplibreMap>;
    let container: HTMLElement;

    beforeEach(() => {
        nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        container = nativeMap.getContainer() as HTMLElement;
    });

    afterEach(() => {
        destroyMenu();
        uninstallMockGeoLeaf();
    });

    // -------------------------------------------------------------------------
    // initMenu / DOM creation
    // -------------------------------------------------------------------------

    it("initMenu creates .gl-measure-root in the map container", () => {
        initMenu(getMeasureConfig(), {});
        expect(container.querySelector(".gl-measure-root")).not.toBeNull();
    });

    it("initMenu creates a .gl-measure-menu (initially hidden)", () => {
        initMenu(getMeasureConfig(), {});
        const menu = container.querySelector(".gl-measure-menu");
        expect(menu).not.toBeNull();
        expect(menu!.classList.contains("gl-measure-menu--hidden")).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Recap box hosting — PLUGINS S5
    // The menu has declared itself the "recap-box host" from the start but never
    // called initRecapBox(); these tests pin the hosting so it cannot lapse again.
    // -------------------------------------------------------------------------

    it("initMenu hosts the recap box inside the root", () => {
        initMenu(getMeasureConfig(), {});
        const root = container.querySelector(".gl-measure-root")!;
        expect(root.querySelector(".gl-measure-recap")).not.toBeNull();
    });

    it("the recap box follows the menu in the DOM, so it renders below it", () => {
        initMenu(getMeasureConfig(), {});
        const root = container.querySelector(".gl-measure-root")!;
        const children = [...root.children];
        const menuIdx = children.findIndex((el) => el.classList.contains("gl-measure-menu"));
        const recapIdx = children.findIndex((el) => el.classList.contains("gl-measure-recap"));
        expect(menuIdx).toBeGreaterThanOrEqual(0);
        expect(recapIdx).toBeGreaterThan(menuIdx);
    });

    it("closing the menu hides a populated recap box without dropping its rows", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu(); // open
        renderRecap([{ index: 1, coordStr: "A", lengthStr: "10 m" }], { perimeterStr: "10 m" });
        const recap = container.querySelector(".gl-measure-recap")!;
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(false);

        toggleMeasureMenu(); // close
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(true);
        expect(recap.querySelectorAll("tbody tr").length).toBe(1);

        toggleMeasureMenu(); // reopen
        expect(recap.classList.contains("gl-measure-recap--hidden")).toBe(false);
    });

    it("destroyMenu releases the recap box (later renders do not throw)", () => {
        initMenu(getMeasureConfig(), {});
        destroyMenu();
        expect(() =>
            renderRecap([{ index: 1, coordStr: "A", lengthStr: "10 m" }], { perimeterStr: "10 m" })
        ).not.toThrow();
        expect(container.querySelector(".gl-measure-recap")).toBeNull();
    });

    it("initMenu applies default top-left position", () => {
        initMenu(getMeasureConfig(), {});
        const root = container.querySelector(".gl-measure-root") as HTMLElement;
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("10px");
        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("10px");
    });

    it("initMenu applies custom object position", () => {
        const cfg = { ...getMeasureConfig(), menuPosition: { top: 50, left: 80 } };
        initMenu(cfg, {});
        const root = container.querySelector(".gl-measure-root") as HTMLElement;
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("50px");
        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("80px");
    });

    it("initMenu is idempotent: second call does not duplicate DOM", () => {
        const cfg = getMeasureConfig();
        initMenu(cfg, {});
        initMenu(cfg, {});
        expect(container.querySelectorAll(".gl-measure-root").length).toBe(1);
    });

    // -------------------------------------------------------------------------
    // toggleMeasureMenu
    // -------------------------------------------------------------------------

    it("toggleMeasureMenu opens the menu (removes --hidden)", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        const menu = container.querySelector(".gl-measure-menu")!;
        expect(menu.classList.contains("gl-measure-menu--hidden")).toBe(false);
    });

    it("toggleMeasureMenu closes the menu on second call", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu(); // open
        toggleMeasureMenu(); // close
        const menu = container.querySelector(".gl-measure-menu")!;
        expect(menu.classList.contains("gl-measure-menu--hidden")).toBe(true);
    });

    it("toggleMeasureMenu lazy-inits if initMenu was not called", () => {
        toggleMeasureMenu();
        expect(container.querySelector(".gl-measure-root")).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // Tool buttons
    // -------------------------------------------------------------------------

    it("clicking a tool button calls onToolSelect with the tool id", () => {
        const onToolSelect = vi.fn();
        initMenu(getMeasureConfig(), { onToolSelect });
        toggleMeasureMenu();
        const distBtn = container.querySelector<HTMLButtonElement>('button[data-tool="distance"]')!;
        distBtn.click();
        expect(onToolSelect).toHaveBeenCalledWith("distance");
    });

    it("clicking the active tool button disarms it (calls onToolSelect(null))", () => {
        const onToolSelect = vi.fn();
        initMenu(getMeasureConfig(), { onToolSelect });
        toggleMeasureMenu();
        const distBtn = container.querySelector<HTMLButtonElement>('button[data-tool="distance"]')!;
        distBtn.click(); // arm
        distBtn.click(); // disarm
        expect(onToolSelect).toHaveBeenLastCalledWith(null);
    });

    it("clicking a tool button adds --active class and sets aria-pressed=true", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="distance"]')!;
        btn.click();
        expect(btn.classList.contains("gl-measure-tool-btn--active")).toBe(true);
        expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    it("setActiveTool marks the button as active", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        setActiveTool("gps");
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="gps"]')!;
        expect(btn.classList.contains("gl-measure-tool-btn--active")).toBe(true);
        expect(getCurrentTool()).toBe("gps");
    });

    it("setActiveTool(null) clears active state", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        setActiveTool("distance");
        setActiveTool(null);
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="distance"]')!;
        expect(btn.classList.contains("gl-measure-tool-btn--active")).toBe(false);
        expect(getCurrentTool()).toBeNull();
    });

    it("closing the menu disarms the active tool and notifies callback", () => {
        const onToolSelect = vi.fn();
        initMenu(getMeasureConfig(), { onToolSelect });
        toggleMeasureMenu();
        setActiveTool("polygon");
        toggleMeasureMenu(); // close
        expect(getCurrentTool()).toBeNull();
        expect(onToolSelect).toHaveBeenLastCalledWith(null);
    });

    it("tools disabled via enabledTools are not rendered", () => {
        const cfg = { ...getMeasureConfig(), enabledTools: ["distance"] as any };
        initMenu(cfg, {});
        expect(container.querySelector('button[data-tool="distance"]')).not.toBeNull();
        expect(container.querySelector('button[data-tool="gps"]')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // Unit cycle buttons
    // -------------------------------------------------------------------------

    it("unit toggle button shows default distance unit from config", () => {
        const cfg = { ...getMeasureConfig(), defaultDistanceUnit: "km" as const };
        initMenu(cfg, {});
        const btn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='dist']"
        )!;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe("km");
    });

    it("clicking distance toggle cycles m → km and calls onUnitsChange", () => {
        const onUnitsChange = vi.fn();
        initMenu({ ...getMeasureConfig(), defaultDistanceUnit: "m" }, { onUnitsChange });
        const btn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='dist']"
        )!;
        expect(btn.textContent).toBe("m");
        btn.click(); // m → km
        expect(onUnitsChange).toHaveBeenCalledWith({ distance: "km" });
        expect(btn.textContent).toBe("km");
        btn.click(); // km → m
        expect(onUnitsChange).toHaveBeenLastCalledWith({ distance: "m" });
        expect(btn.textContent).toBe("m");
    });

    it("setCurrentUnits updates the unit toggle button text", () => {
        initMenu(getMeasureConfig(), {});
        setCurrentUnits({ distance: "km", area: "ha" });
        const distBtn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='dist']"
        )!;
        const areaBtn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='area']"
        )!;
        expect(distBtn.textContent).toBe("km");
        expect(areaBtn.textContent).toBe("ha");
        expect(getCurrentUnits()).toEqual({ distance: "km", area: "ha" });
    });

    // -------------------------------------------------------------------------
    // Drag handle
    // -------------------------------------------------------------------------

    it("dragging the handle updates --gl-measure-left and --gl-measure-top", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        const root = container.querySelector<HTMLElement>(".gl-measure-root")!;
        const handle = container.querySelector<HTMLElement>(".gl-measure-menu__handle")!;

        // Stub getBoundingClientRect so clamping has room
        container.getBoundingClientRect = () =>
            ({
                width: 800,
                height: 600,
                top: 0,
                left: 0,
                right: 800,
                bottom: 600,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        Object.defineProperty(root, "offsetWidth", { configurable: true, get: () => 100 });
        Object.defineProperty(root, "offsetHeight", { configurable: true, get: () => 150 });

        handle.dispatchEvent(
            new MouseEvent("mousedown", { button: 0, clientX: 0, clientY: 0, bubbles: true })
        );
        document.dispatchEvent(
            new MouseEvent("mousemove", { clientX: 60, clientY: 30, bubbles: true })
        );

        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("70px"); // 10 + 60
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("40px"); // 10 + 30

        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    it("drag is clamped to container bounds (right/bottom)", () => {
        initMenu(getMeasureConfig(), {});
        toggleMeasureMenu();
        const root = container.querySelector<HTMLElement>(".gl-measure-root")!;
        const handle = container.querySelector<HTMLElement>(".gl-measure-menu__handle")!;

        container.getBoundingClientRect = () =>
            ({
                width: 800,
                height: 600,
                top: 0,
                left: 0,
                right: 800,
                bottom: 600,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
        Object.defineProperty(root, "offsetWidth", { configurable: true, get: () => 100 });
        Object.defineProperty(root, "offsetHeight", { configurable: true, get: () => 150 });

        handle.dispatchEvent(
            new MouseEvent("mousedown", { button: 0, clientX: 0, clientY: 0, bubbles: true })
        );
        document.dispatchEvent(
            new MouseEvent("mousemove", { clientX: 2000, clientY: 2000, bubbles: true })
        );

        // max left = 800 - 100 = 700 ; max top = 600 - 150 = 450
        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("700px");
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("450px");

        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // -------------------------------------------------------------------------
    // destroyMenu
    // -------------------------------------------------------------------------

    it("destroyMenu removes the root element from the container", () => {
        initMenu(getMeasureConfig(), {});
        destroyMenu();
        expect(container.querySelector(".gl-measure-root")).toBeNull();
    });

    it("destroyMenu resets getCurrentTool to null", () => {
        initMenu(getMeasureConfig(), {});
        setActiveTool("distance");
        destroyMenu();
        expect(getCurrentTool()).toBeNull();
    });

    it("clear button click calls onClearAll callback", () => {
        const onClearAll = vi.fn();
        initMenu(getMeasureConfig(), { onClearAll });
        toggleMeasureMenu();
        const clearBtn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-action-btn[data-action='clear']"
        )!;
        clearBtn.click();
        expect(onClearAll).toHaveBeenCalled();
    });

    it("export button click calls onExport callback", () => {
        const onExport = vi.fn();
        initMenu(getMeasureConfig(), { onExport });
        toggleMeasureMenu();
        const exportBtn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-action-btn[data-action='export']"
        )!;
        exportBtn.click();
        expect(onExport).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Branch coverage — area selector, no-map guard, no-surface-tools, post-destroy guards
    // -------------------------------------------------------------------------

    it("clicking area toggle cycles m² → ha → km² → m²", () => {
        const onUnitsChange = vi.fn();
        initMenu({ ...getMeasureConfig(), defaultAreaUnit: "m2" }, { onUnitsChange });
        const btn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='area']"
        )!;
        expect(btn.textContent).toBe("m²");
        btn.click(); // m2 → ha
        expect(btn.textContent).toBe("ha");
        expect(onUnitsChange).toHaveBeenLastCalledWith({ area: "ha" });
        btn.click(); // ha → km2
        expect(btn.textContent).toBe("km²");
        expect(onUnitsChange).toHaveBeenLastCalledWith({ area: "km2" });
        btn.click(); // km2 → m2
        expect(btn.textContent).toBe("m²");
    });

    it("initMenu with no native map skips DOM creation", () => {
        destroyMenu();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap: null as any });
        initMenu(getMeasureConfig(), {});
        expect(container.querySelector(".gl-measure-root")).toBeNull();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap });
    });

    it("toggleMeasureMenu with no native map returns without creating DOM", () => {
        destroyMenu();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap: null as any });
        toggleMeasureMenu();
        expect(container.querySelector(".gl-measure-root")).toBeNull();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap });
    });

    it("no surface tools branch: surface group not appended when none enabled", () => {
        const cfg = { ...getMeasureConfig(), enabledTools: ["distance", "gps"] as any };
        initMenu(cfg, {});
        expect(container.querySelector(".gl-measure-menu__surface-group")).toBeNull();
    });

    it("setActiveTool after destroyMenu does not throw (covers _syncActiveButton guard)", () => {
        initMenu(getMeasureConfig(), {});
        destroyMenu();
        expect(() => setActiveTool("distance")).not.toThrow();
    });

    it("setCurrentUnits after destroyMenu is a no-op", () => {
        initMenu(getMeasureConfig(), {});
        destroyMenu();
        expect(() => setCurrentUnits({ distance: "km" })).not.toThrow();
    });

    it("initMenu with existing root updates unit button without rebuilding DOM", () => {
        initMenu(getMeasureConfig(), {});
        const rootBefore = container.querySelector(".gl-measure-root");
        initMenu({ ...getMeasureConfig(), defaultDistanceUnit: "km" }, {});
        expect(container.querySelectorAll(".gl-measure-root").length).toBe(1);
        expect(container.querySelector(".gl-measure-root")).toBe(rootBefore);
        const distBtn = container.querySelector<HTMLButtonElement>(
            ".gl-measure-unit-btn[data-unit-type='dist']"
        )!;
        expect(distBtn.textContent).toBe("km");
    });

    // -------------------------------------------------------------------------
    // Tooltip — _showTip / _hideTip / _wireTips
    // -------------------------------------------------------------------------

    it("creates a .gl-measure-tooltip element in .gl-measure-root", () => {
        initMenu(getMeasureConfig(), {});
        const root = container.querySelector(".gl-measure-root")!;
        expect(root.querySelector(".gl-measure-tooltip")).not.toBeNull();
    });

    it("tooltip becomes visible on mouseenter of a tool button", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-measure-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(true);
        expect(tip.textContent).toBe(btn.dataset.tooltip);
    });

    it("tooltip becomes visible on focusin of a tool button", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-measure-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(true);
    });

    it("tooltip hides on mouseleave", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        btn.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-measure-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("tooltip hides on focusout", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-measure-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("tooltip does not show when button has no data-tooltip value", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        delete btn.dataset.tooltip;
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-measure-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    it("_showTip is a no-op after destroyMenu (tooltipEl becomes null)", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        destroyMenu();
        expect(() =>
            btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
        ).not.toThrow();
    });

    it("_hideTip is a no-op after destroyMenu", () => {
        initMenu(getMeasureConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        destroyMenu();
        expect(() =>
            btn.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }))
        ).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // setMenuPosition / getMenuHeight guards (uncovered branches)
    // -------------------------------------------------------------------------

    it("setMenuPosition is a no-op when _root is null (before initMenu)", () => {
        expect(() => setMenuPosition(50, 100)).not.toThrow();
    });

    it("getMenuHeight returns 0 when _menuEl is null (before initMenu)", () => {
        expect(getMenuHeight()).toBe(0);
    });

    it("setMenuPosition updates CSS variables when root exists", () => {
        initMenu(getMeasureConfig(), {});
        setMenuPosition(42, 88);
        const root = container.querySelector<HTMLElement>(".gl-measure-root")!;
        expect(root.style.getPropertyValue("--gl-measure-top")).toBe("42px");
        expect(root.style.getPropertyValue("--gl-measure-left")).toBe("88px");
    });
});

// ---------------------------------------------------------------------------
// positionMeasureMenuNear — PLUGINS S5
// Moved out of public-api.openMeasureMenu ("façade ≠ implémentation") and delegating
// to @geoleaf/host-runtime. public-api.ts is coverage-excluded, so — exactly as on the
// editor side before S4 — this math had never been measured. These cases pin the
// clamping, which is the part that silently misbehaves.
// ---------------------------------------------------------------------------

describe("positionMeasureMenuNear", () => {
    let container: HTMLElement;

    /** Fixes an element's getBoundingClientRect (happy-dom returns zeroes). */
    const rect = (el: Element, r: Partial<DOMRect>): void => {
        const full = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...r };
        (el as HTMLElement).getBoundingClientRect = () => full as DOMRect;
    };

    const cssVar = (name: string): string =>
        (container.querySelector(".gl-measure-root") as HTMLElement).style.getPropertyValue(name);

    beforeEach(() => {
        const nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        container = nativeMap.getContainer() as HTMLElement;
        initMenu(getMeasureConfig(), {});
        rect(container, { top: 0, left: 0, right: 1000, bottom: 800 });
    });

    afterEach(() => {
        destroyMenu();
        uninstallMockGeoLeaf();
    });

    /** A pill button inside a .gl-map-toolbar bar, both with fixed rects. */
    function pill(barRect: Partial<DOMRect>): Element {
        const bar = document.createElement("div");
        bar.className = "gl-map-toolbar";
        const btn = document.createElement("button");
        bar.appendChild(btn);
        container.appendChild(bar);
        rect(bar, barRect);
        rect(btn, { top: 0, left: 0, right: 0, bottom: 0 });
        return btn;
    }

    it("places the menu to the right of the pill bar, with a 10px gap", () => {
        positionMeasureMenuNear(pill({ top: 300, right: 60, height: 40 }), container);
        expect(cssVar("--gl-measure-left")).toBe("70px");
    });

    it("anchors on the pill BAR, not on the clicked button", () => {
        // The button's own rect is all zeroes; reading it would give left: 10px.
        positionMeasureMenuNear(pill({ top: 300, right: 200, height: 40 }), container);
        expect(cssVar("--gl-measure-left")).toBe("210px");
    });

    it("clamps the top to the map's upper edge when the pill sits near it", () => {
        positionMeasureMenuNear(pill({ top: 0, right: 60, height: 0 }), container);
        expect(cssVar("--gl-measure-top")).toBe("4px");
    });

    it("clamps the left so the menu never escapes the map's right edge", () => {
        positionMeasureMenuNear(pill({ top: 300, right: 990, height: 40 }), container);
        expect(cssVar("--gl-measure-left")).toBe("936px"); // 1000 - 64
    });

    it("falls back to the parent element when no toolbar ancestor exists", () => {
        const parent = document.createElement("div");
        const btn = document.createElement("button");
        parent.appendChild(btn);
        container.appendChild(parent);
        rect(parent, { top: 100, right: 50, height: 20 });
        rect(btn, { top: 0, left: 0, right: 0, bottom: 0 });
        positionMeasureMenuNear(btn, container);
        expect(cssVar("--gl-measure-left")).toBe("60px");
    });
});

// ---------------------------------------------------------------------------
// selectTool vs setActiveTool — CDC finding #1 (MAJEUR)
// ---------------------------------------------------------------------------

describe("floating-menu — arming path (finding #1)", () => {
    beforeEach(() => {
        installMockGeoLeaf({ nativeMap: makeMockMaplibreMap() });
    });

    afterEach(() => {
        destroyMenu();
        uninstallMockGeoLeaf();
    });

    it("selectTool notifies onToolSelect — this is what actually arms the drawing", () => {
        const onToolSelect = vi.fn();
        initMenu(getMeasureConfig(), { onToolSelect });
        selectTool("polygon");
        expect(onToolSelect).toHaveBeenCalledWith("polygon");
        expect(getCurrentTool()).toBe("polygon");
    });

    it("setActiveTool does NOT notify — it is the visual-only disarm path", () => {
        const onToolSelect = vi.fn();
        initMenu(getMeasureConfig(), { onToolSelect });
        setActiveTool("polygon");
        expect(onToolSelect).not.toHaveBeenCalled();
        expect(getCurrentTool()).toBe("polygon");
    });

    it("both light the button up identically — which is why the defect went unseen", () => {
        initMenu(getMeasureConfig(), {});
        setActiveTool("rect");
        const viaSetter = document.querySelector('button[data-tool="rect"]')?.className;
        setActiveTool(null);
        selectTool("rect");
        const viaSelect = document.querySelector('button[data-tool="rect"]')?.className;
        expect(viaSelect).toBe(viaSetter);
    });
});
