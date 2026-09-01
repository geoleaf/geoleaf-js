/**
 * Tests for floating-menu.ts — Sprint S3
 * Covers: initEditorMenu, toggleEditorMenu, setEditorActiveTool,
 *         updateUndoRedoState, destroyEditorMenu, drag.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    initEditorMenu,
    toggleEditorMenu,
    setEditorActiveTool,
    getEditorActiveTool,
    deactivateActiveTool,
    updateUndoRedoState,
    destroyEditorMenu,
    positionEditorMenuNear,
} from "../sub-menu/floating-menu.js";
import { getEditorConfig } from "../config.js";
import type { EditorTool } from "../types.js";
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
        destroyEditorMenu();
        uninstallMockGeoLeaf();
    });

    // -------------------------------------------------------------------------
    // initEditorMenu / DOM creation
    // -------------------------------------------------------------------------

    it("initEditorMenu creates .gl-editor-root in the map container", () => {
        initEditorMenu(getEditorConfig(), {});
        expect(container.querySelector(".gl-editor-root")).not.toBeNull();
    });

    it("initEditorMenu creates a .gl-editor-menu (initially hidden)", () => {
        initEditorMenu(getEditorConfig(), {});
        const menu = container.querySelector(".gl-editor-menu");
        expect(menu).not.toBeNull();
        expect(menu!.classList.contains("gl-editor-menu--hidden")).toBe(true);
    });

    // This test froze `top-left`, the anchor that overlays the pill on the
    // core's toolbar. It checked two properties out of four, so it could not
    // see that the three other anchors set NOTHING and fell back to top-left.
    // All four are now asserted, on all four anchors.
    it("initEditorMenu applies the default position (top-right — away from the core toolbar)", () => {
        initEditorMenu(getEditorConfig(), {});
        const root = container.querySelector<HTMLElement>(".gl-editor-root")!;
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("10px");
        expect(root.style.getPropertyValue("--gl-editor-right")).toBe("10px");
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("auto");
        expect(root.style.getPropertyValue("--gl-editor-bottom")).toBe("auto");
        expect(root.getAttribute("data-gl-anchor-x")).toBe("right");
    });

    it.each([
        ["top-left", { top: "10px", right: "auto", bottom: "auto", left: "10px", x: "left" }],
        ["top-right", { top: "10px", right: "10px", bottom: "auto", left: "auto", x: "right" }],
        ["bottom-left", { top: "auto", right: "auto", bottom: "10px", left: "10px", x: "left" }],
        ["bottom-right", { top: "auto", right: "10px", bottom: "10px", left: "auto", x: "right" }],
    ])("initEditorMenu anchors %s on its two own edges, and only those", (pos, want) => {
        initEditorMenu({ ...getEditorConfig(), menuPosition: pos as never }, {});
        const root = container.querySelector<HTMLElement>(".gl-editor-root")!;
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe(want.top);
        expect(root.style.getPropertyValue("--gl-editor-right")).toBe(want.right);
        expect(root.style.getPropertyValue("--gl-editor-bottom")).toBe(want.bottom);
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe(want.left);
        expect(root.getAttribute("data-gl-anchor-x")).toBe(want.x);
    });

    it("initEditorMenu applies custom object position, sentinel semantics preserved", () => {
        const cfg = { ...getEditorConfig(), menuPosition: { top: 50, left: 80 } as const };
        initEditorMenu(cfg, {});
        const root = container.querySelector<HTMLElement>(".gl-editor-root")!;
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("50px");
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("80px");
        // An explicit object keeps control: the two other edges stay neutral
        // and no `data-gl-anchor-x` is set — an integrator who pinned pixels
        // is not moved by the default change.
        expect(root.style.getPropertyValue("--gl-editor-right")).toBe("auto");
        expect(root.style.getPropertyValue("--gl-editor-bottom")).toBe("auto");
        expect(root.hasAttribute("data-gl-anchor-x")).toBe(false);
    });

    it("initEditorMenu is idempotent: second call does not duplicate DOM", () => {
        const cfg = getEditorConfig();
        initEditorMenu(cfg, {});
        initEditorMenu(cfg, {});
        expect(container.querySelectorAll(".gl-editor-root").length).toBe(1);
    });

    it("initEditorMenu with no native map skips DOM creation", () => {
        destroyEditorMenu();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap: null as any });
        initEditorMenu(getEditorConfig(), {});
        expect(container.querySelector(".gl-editor-root")).toBeNull();
    });

    // -------------------------------------------------------------------------
    // toggleEditorMenu
    // -------------------------------------------------------------------------

    it("toggleEditorMenu opens the menu (removes --hidden)", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        const menu = container.querySelector(".gl-editor-menu")!;
        expect(menu.classList.contains("gl-editor-menu--hidden")).toBe(false);
    });

    it("toggleEditorMenu closes the menu on second call", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu(); // open
        toggleEditorMenu(); // close
        const menu = container.querySelector(".gl-editor-menu")!;
        expect(menu.classList.contains("gl-editor-menu--hidden")).toBe(true);
    });

    it("toggleEditorMenu lazy-inits if initEditorMenu was not called", () => {
        toggleEditorMenu();
        expect(container.querySelector(".gl-editor-root")).not.toBeNull();
    });

    it("toggleEditorMenu with no native map is a no-op", () => {
        destroyEditorMenu();
        uninstallMockGeoLeaf();
        installMockGeoLeaf({ nativeMap: null as any });
        toggleEditorMenu();
        expect(container.querySelector(".gl-editor-root")).toBeNull();
    });

    it("onToggle callback is called on open/close", () => {
        const onToggle = vi.fn();
        initEditorMenu(getEditorConfig(), { onToggle });
        toggleEditorMenu(); // open
        expect(onToggle).toHaveBeenCalledWith(true);
        toggleEditorMenu(); // close
        expect(onToggle).toHaveBeenLastCalledWith(false);
    });

    // -------------------------------------------------------------------------
    // Mode tool buttons (point / line / polyline / polygon / select)
    // -------------------------------------------------------------------------

    it("clicking a creation tool calls onToolSelect with the tool id", () => {
        const onToolSelect = vi.fn();
        initEditorMenu(getEditorConfig(), { onToolSelect });
        toggleEditorMenu();
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="point"]')!;
        btn.click();
        expect(onToolSelect).toHaveBeenCalledWith("point");
    });

    it("clicking the active tool disarms it (calls onToolSelect(null))", () => {
        const onToolSelect = vi.fn();
        initEditorMenu(getEditorConfig(), { onToolSelect });
        toggleEditorMenu();
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="point"]')!;
        btn.click(); // arm
        btn.click(); // disarm
        expect(onToolSelect).toHaveBeenLastCalledWith(null);
    });

    it("clicking a tool adds --active class and sets aria-pressed=true", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="polygon"]')!;
        btn.click();
        expect(btn.classList.contains("gl-editor-tool-btn--active")).toBe(true);
        expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    it("only one tool is active at a time", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        const pointBtn = container.querySelector<HTMLButtonElement>('button[data-tool="point"]')!;
        const lineBtn = container.querySelector<HTMLButtonElement>('button[data-tool="line"]')!;
        pointBtn.click();
        lineBtn.click();
        expect(pointBtn.getAttribute("aria-pressed")).toBe("false");
        expect(lineBtn.getAttribute("aria-pressed")).toBe("true");
    });

    it("setEditorActiveTool arms the button and updates getEditorActiveTool", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        setEditorActiveTool("polyline");
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="polyline"]')!;
        expect(btn.classList.contains("gl-editor-tool-btn--active")).toBe(true);
        expect(getEditorActiveTool()).toBe("polyline");
    });

    it("setEditorActiveTool(null) clears active state", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        setEditorActiveTool("select");
        setEditorActiveTool(null);
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="select"]')!;
        expect(btn.classList.contains("gl-editor-tool-btn--active")).toBe(false);
        expect(getEditorActiveTool()).toBeNull();
    });

    it("closing the menu disarms the active tool and notifies callback", () => {
        const onToolSelect = vi.fn();
        initEditorMenu(getEditorConfig(), { onToolSelect });
        toggleEditorMenu();
        setEditorActiveTool("polygon");
        toggleEditorMenu(); // close
        expect(getEditorActiveTool()).toBeNull();
        expect(onToolSelect).toHaveBeenLastCalledWith(null);
    });

    it("deactivateActiveTool disarms the active tool, resets the button and notifies(null)", () => {
        const onToolSelect = vi.fn();
        initEditorMenu(getEditorConfig(), { onToolSelect });
        toggleEditorMenu();
        setEditorActiveTool("select");
        deactivateActiveTool();
        const btn = container.querySelector<HTMLButtonElement>('button[data-tool="select"]')!;
        expect(btn.getAttribute("aria-pressed")).toBe("false");
        expect(getEditorActiveTool()).toBeNull();
        expect(onToolSelect).toHaveBeenLastCalledWith(null);
    });

    it("deactivateActiveTool is a no-op when no tool is armed", () => {
        const onToolSelect = vi.fn();
        initEditorMenu(getEditorConfig(), { onToolSelect });
        toggleEditorMenu();
        deactivateActiveTool();
        expect(onToolSelect).not.toHaveBeenCalled();
    });

    it("tools disabled via enabledTools are not rendered", () => {
        const cfg = { ...getEditorConfig(), enabledTools: ["point"] as EditorTool[] };
        initEditorMenu(cfg, {});
        expect(container.querySelector('button[data-tool="point"]')).not.toBeNull();
        expect(container.querySelector('button[data-tool="line"]')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // Undo / redo buttons
    // -------------------------------------------------------------------------

    it("undo and redo buttons start disabled", () => {
        initEditorMenu(getEditorConfig(), {});
        const undoBtn = container.querySelector<HTMLButtonElement>('button[data-action="undo"]')!;
        const redoBtn = container.querySelector<HTMLButtonElement>('button[data-action="redo"]')!;
        expect(undoBtn.disabled).toBe(true);
        expect(redoBtn.disabled).toBe(true);
    });

    it("updateUndoRedoState enables/disables undo and redo buttons", () => {
        initEditorMenu(getEditorConfig(), {});
        updateUndoRedoState(true, false);
        const undoBtn = container.querySelector<HTMLButtonElement>('button[data-action="undo"]')!;
        const redoBtn = container.querySelector<HTMLButtonElement>('button[data-action="redo"]')!;
        expect(undoBtn.disabled).toBe(false);
        expect(redoBtn.disabled).toBe(true);
    });

    it("clicking undo calls onUndo callback", () => {
        const onUndo = vi.fn();
        initEditorMenu(getEditorConfig(), { onUndo });
        updateUndoRedoState(true, false);
        const btn = container.querySelector<HTMLButtonElement>('button[data-action="undo"]')!;
        btn.click();
        expect(onUndo).toHaveBeenCalled();
    });

    it("clicking redo calls onRedo callback", () => {
        const onRedo = vi.fn();
        initEditorMenu(getEditorConfig(), { onRedo });
        updateUndoRedoState(false, true);
        const btn = container.querySelector<HTMLButtonElement>('button[data-action="redo"]')!;
        btn.click();
        expect(onRedo).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Delete / close buttons
    // -------------------------------------------------------------------------

    it("clicking delete calls onDelete callback", () => {
        const onDelete = vi.fn();
        initEditorMenu(getEditorConfig(), { onDelete });
        const btn = container.querySelector<HTMLButtonElement>('button[data-action="delete"]')!;
        btn.click();
        expect(onDelete).toHaveBeenCalled();
    });

    it("close button hides the menu", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu(); // open
        const closeBtn = container.querySelector<HTMLButtonElement>(
            ".gl-editor-action-btn--close"
        )!;
        closeBtn.click();
        expect(
            container.querySelector(".gl-editor-menu")!.classList.contains("gl-editor-menu--hidden")
        ).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Drag — mouse
    // -------------------------------------------------------------------------

    it("dragging the handle updates --gl-editor-left and --gl-editor-top", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        const root = container.querySelector<HTMLElement>(".gl-editor-root")!;
        const handle = container.querySelector<HTMLElement>(".gl-editor-menu__handle")!;

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

        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("70px"); // 10 + 60
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("40px"); // 10 + 30

        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    it("drag is clamped to container bounds", () => {
        initEditorMenu(getEditorConfig(), {});
        toggleEditorMenu();
        const root = container.querySelector<HTMLElement>(".gl-editor-root")!;
        const handle = container.querySelector<HTMLElement>(".gl-editor-menu__handle")!;

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
            new MouseEvent("mousemove", { clientX: 9999, clientY: 9999, bubbles: true })
        );

        // max left = 800 - 100 = 700 ; max top = 600 - 150 = 450
        expect(root.style.getPropertyValue("--gl-editor-left")).toBe("700px");
        expect(root.style.getPropertyValue("--gl-editor-top")).toBe("450px");

        document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // -------------------------------------------------------------------------
    // Tooltip
    // -------------------------------------------------------------------------

    it("creates a .gl-editor-tooltip element in .gl-editor-root", () => {
        initEditorMenu(getEditorConfig(), {});
        const root = container.querySelector(".gl-editor-root")!;
        expect(root.querySelector(".gl-editor-tooltip")).not.toBeNull();
    });

    it("tooltip becomes visible on mouseenter of a button", () => {
        initEditorMenu(getEditorConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-editor-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(true);
    });

    it("tooltip hides on mouseleave", () => {
        initEditorMenu(getEditorConfig(), {});
        const btn = container.querySelector<HTMLElement>("[data-tooltip]")!;
        btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        btn.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        const tip = container.querySelector<HTMLElement>(".gl-editor-tooltip")!;
        expect(tip.classList.contains("gl-is-visible")).toBe(false);
    });

    // -------------------------------------------------------------------------
    // destroyEditorMenu
    // -------------------------------------------------------------------------

    it("destroyEditorMenu removes .gl-editor-root from the container", () => {
        initEditorMenu(getEditorConfig(), {});
        destroyEditorMenu();
        expect(container.querySelector(".gl-editor-root")).toBeNull();
    });

    it("destroyEditorMenu resets getEditorActiveTool to null", () => {
        initEditorMenu(getEditorConfig(), {});
        setEditorActiveTool("point");
        destroyEditorMenu();
        expect(getEditorActiveTool()).toBeNull();
    });

    it("setEditorActiveTool after destroy does not throw", () => {
        initEditorMenu(getEditorConfig(), {});
        destroyEditorMenu();
        expect(() => setEditorActiveTool("point")).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
describe("positionEditorMenuNear", () => {
    let container: HTMLElement;

    /** Fixes an element's getBoundingClientRect (happy-dom returns zeroes). */
    const rect = (el: Element, r: Partial<DOMRect>): void => {
        const full = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...r };
        (el as HTMLElement).getBoundingClientRect = () => full as DOMRect;
    };

    const cssVar = (name: string): string =>
        (container.querySelector(".gl-editor-root") as HTMLElement).style.getPropertyValue(name);

    beforeEach(() => {
        const nativeMap = makeMockMaplibreMap();
        installMockGeoLeaf({ nativeMap });
        container = nativeMap.getContainer() as HTMLElement;
        initEditorMenu(getEditorConfig(), {});
        rect(container, { top: 0, left: 0, right: 1000, bottom: 800 });
    });

    afterEach(() => {
        destroyEditorMenu();
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
        positionEditorMenuNear(pill({ top: 300, right: 60, height: 40 }), container);
        expect(cssVar("--gl-editor-left")).toBe("70px");
    });

    it("anchors on the pill BAR, not on the clicked button", () => {
        // The button's own rect is all zeroes; reading it would give left: 10px.
        positionEditorMenuNear(pill({ top: 300, right: 200, height: 40 }), container);
        expect(cssVar("--gl-editor-left")).toBe("210px");
    });

    it("clamps the top to the map's upper edge when the pill sits near it", () => {
        // Menu height is 0 in happy-dom, so centring on a pill at top: 0 would
        // yield 0 — below the mapRect.top + 4 floor.
        positionEditorMenuNear(pill({ top: 0, right: 60, height: 0 }), container);
        expect(cssVar("--gl-editor-top")).toBe("4px");
    });

    it("clamps the left so the menu never escapes the map's right edge", () => {
        positionEditorMenuNear(pill({ top: 300, right: 990, height: 40 }), container);
        expect(cssVar("--gl-editor-left")).toBe("936px"); // 1000 - 64
    });

    it("falls back to the parent element when no toolbar ancestor exists", () => {
        const parent = document.createElement("div");
        const btn = document.createElement("button");
        parent.appendChild(btn);
        container.appendChild(parent);
        rect(parent, { top: 100, right: 50, height: 20 });
        rect(btn, { top: 0, left: 0, right: 0, bottom: 0 });
        positionEditorMenuNear(btn, container);
        expect(cssVar("--gl-editor-left")).toBe("60px");
    });
});
