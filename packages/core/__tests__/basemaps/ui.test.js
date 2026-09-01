/**
 */
/* Phase 5.28 - src/kernel/basemaps/ui.ts */

const logMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}));
const mockSetBaseLayer = vi.hoisted(() => vi.fn());
const mockGetActiveKey = vi.hoisted(() => vi.fn(() => "street"));
const _baseLayersMock = vi.hoisted(() => ({
    street: { label: "Street" },
    satellite: { label: "Satellite" },
}));

vi.mock("../../src/utils/log/index.js", () => ({ Log: logMock }));
vi.mock("../../src/kernel/basemaps/registry.ts", () => ({
    _baseLayers: _baseLayersMock,
    setBaseLayer: mockSetBaseLayer,
    getActiveKey: mockGetActiveKey,
}));

import {
    refreshUI,
    createBaseLayerControlsUI,
    bindUIOnce,
    destroyUI,
} from "../../src/kernel/basemaps/ui.ts";

describe("basemaps/ui (Phase 5.28)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetActiveKey.mockReturnValue("street");
        document.body.innerHTML = "";
    });

    describe("exports", () => {
        it("exports refreshUI, createBaseLayerControlsUI, bindUIOnce, destroyUI", () => {
            expect(refreshUI).toBeDefined();
            expect(createBaseLayerControlsUI).toBeDefined();
            expect(bindUIOnce).toBeDefined();
            expect(destroyUI).toBeDefined();
        });
    });

    describe("refreshUI", () => {
        it("does not throw when no elements", () => {
            expect(() => refreshUI()).not.toThrow();
        });

        it("toggles gl-baselayer-active and gl-is-active on elements with data-gl-baselayer", () => {
            const btn = document.createElement("button");
            btn.dataset.glBaselayer = "street";
            document.body.appendChild(btn);
            mockGetActiveKey.mockReturnValue("street");
            refreshUI();
            expect(btn.classList.contains("gl-baselayer-active")).toBe(true);
            expect(btn.classList.contains("gl-is-active")).toBe(true); // CSS isolation
            expect(btn.getAttribute("aria-pressed")).toBe("true");
        });

        it("removes active class when key does not match getActiveKey", () => {
            const btn = document.createElement("button");
            btn.dataset.glBaselayer = "satellite";
            document.body.appendChild(btn);
            mockGetActiveKey.mockReturnValue("street");
            refreshUI();
            expect(btn.classList.contains("gl-baselayer-active")).toBe(false);
            expect(btn.getAttribute("aria-pressed")).toBe("false");
        });
    });

    describe("createBaseLayerControlsUI", () => {
        it("does not throw when config null and no GeoLeaf.Config", () => {
            const prev = globalThis.GeoLeaf;
            globalThis.GeoLeaf = {};
            expect(() => createBaseLayerControlsUI(null)).not.toThrow();
            globalThis.GeoLeaf = prev;
        });

        it("creates left panel and buttons when showControls true", () => {
            createBaseLayerControlsUI({
                ui: { showBaseLayerControls: true },
                basemaps: {},
            });
            const panel = document.getElementById("gl-left-panel");
            expect(panel).not.toBeNull();
            expect(panel.className).toContain("gl-left-panel");
            const buttons = panel.querySelectorAll("[data-gl-baselayer]");
            expect(buttons.length).toBeGreaterThanOrEqual(1);
        });

        it("does not create panel when showBaseLayerControls false", () => {
            createBaseLayerControlsUI({
                ui: { showBaseLayerControls: false },
                basemaps: {},
            });
            expect(logMock.info).toHaveBeenCalled();
            const panel = document.getElementById("gl-left-panel");
            if (panel) expect(panel.parentNode).toBeFalsy();
        });
    });

    describe("bindUIOnce", () => {
        it("does not throw", () => {
            expect(() => bindUIOnce()).not.toThrow();
        });
    });

    describe("destroyUI", () => {
        it("does not throw", () => {
            bindUIOnce();
            expect(() => destroyUI()).not.toThrow();
        });

        // Regression — destroyUI() resets `_uiBound`, so a click listener left attached
        // would be re-added by the next bindUIOnce() and fire setBaseLayer once per cycle.
        it("detaches the document click listener (no stacking across destroy→init)", () => {
            const addSpy = vi.spyOn(document, "addEventListener");
            const removeSpy = vi.spyOn(document, "removeEventListener");

            bindUIOnce();
            const added = addSpy.mock.calls.filter((c) => c[0] === "click");
            expect(added).toHaveLength(1);
            const clickHandler = added[0][1];

            destroyUI();
            expect(removeSpy).toHaveBeenCalledWith("click", clickHandler);

            addSpy.mockRestore();
            removeSpy.mockRestore();
        });

        it("a destroy→init cycle leaves a single live click listener", () => {
            const target = document.createElement("div");
            target.setAttribute("data-gl-baselayer", "satellite");
            document.body.appendChild(target);

            bindUIOnce();
            destroyUI();
            bindUIOnce();

            mockSetBaseLayer.mockClear();
            target.click();
            // Two stacked listeners would call it twice — the whole point of the fix.
            expect(mockSetBaseLayer).toHaveBeenCalledTimes(1);

            destroyUI();
        });
    });
});

// ── T22 — basemaps/ui.ts branch coverage ──────────────────────────────────────
describe("basemaps/ui — T22 branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetActiveKey.mockReturnValue("street");
        document.body.innerHTML = "";
    });

    // ── refreshUI: key falsy branch (branch 5.0) ─────────────────────────────

    it("refreshUI skips element when data-gl-baselayer is empty string (branch 5.0)", () => {
        const btn = document.createElement("button");
        btn.dataset.glBaselayer = "";
        document.body.appendChild(btn);
        expect(() => refreshUI()).not.toThrow();
        expect(btn.classList.contains("gl-baselayer-active")).toBe(false);
    });

    // ── refreshUI: marks only the active button ──────────────────────────────

    // Replaces a test that asserted `getPropertyValue("--indicator-width")`
    // was `toBeDefined()`. That property is gone (nothing ever read it), but the
    // assertion could never have failed anyway: getPropertyValue returns "" for
    // an absent property, and "" is defined. It is now an assertion on what
    // refreshUI actually guarantees.
    it("refreshUI marks the active button and clears the others", () => {
        const active = document.createElement("button");
        active.dataset.glBaselayer = "street";
        const other = document.createElement("button");
        other.dataset.glBaselayer = "satellite";
        other.classList.add("gl-baselayer-active", "gl-is-active");
        document.body.append(active, other);

        mockGetActiveKey.mockReturnValue("street");
        refreshUI();

        expect(active.classList.contains("gl-baselayer-active")).toBe(true);
        expect(active.classList.contains("gl-is-active")).toBe(true);
        expect(active.getAttribute("aria-pressed")).toBe("true");
        // Stale state on the previously active button must be cleared.
        expect(other.classList.contains("gl-baselayer-active")).toBe(false);
        expect(other.classList.contains("gl-is-active")).toBe(false);
        expect(other.getAttribute("aria-pressed")).toBe("false");
    });

    // ── Boot desync regression ───────────────────────────────────────────────

    // At boot, setBaseLayer defers until the map is idle and both call sites pass
    // `silent: true`, so the refreshUI() in init() ran against a null active key
    // and no button was ever marked — the control showed no selection until the
    // user clicked one (verified stable at t+1s/3s/8s on the deployed demo).
    // bindUIOnce() now subscribes to _setActiveKey, so late activation re-syncs.
    it("re-syncs the UI when a basemap becomes active after init (boot desync)", async () => {
        const { _setActiveKey } = await import("../../src/kernel/basemaps/basemaps-state.ts");

        const btn = document.createElement("button");
        btn.dataset.glBaselayer = "street";
        document.body.appendChild(btn);

        // Nothing is active yet — this is the state init() leaves behind.
        mockGetActiveKey.mockReturnValue(null);
        bindUIOnce();
        refreshUI();
        expect(btn.classList.contains("gl-baselayer-active")).toBe(false);

        // The deferred activation lands.
        mockGetActiveKey.mockReturnValue("street");
        _setActiveKey("street");

        expect(btn.classList.contains("gl-baselayer-active")).toBe(true);
        expect(btn.getAttribute("aria-pressed")).toBe("true");

        destroyUI();
    });

    it("stops re-syncing after destroyUI (no leaked subscription)", async () => {
        const { _setActiveKey } = await import("../../src/kernel/basemaps/basemaps-state.ts");

        const btn = document.createElement("button");
        btn.dataset.glBaselayer = "street";
        document.body.appendChild(btn);

        bindUIOnce();
        destroyUI();

        mockGetActiveKey.mockReturnValue("street");
        _setActiveKey("street");

        expect(btn.classList.contains("gl-baselayer-active")).toBe(false);
    });

    // ── createBaseLayerControlsUI: config=null + GeoLeaf.Config.get (branches 16.0, 18.x) ──

    it("createBaseLayerControlsUI uses GeoLeaf.Config when config is null and Config.get exists (branches 16.0, 18.x)", () => {
        globalThis.GeoLeaf = {
            Config: {
                get: vi.fn((k) => (k === "ui" ? { showBaseLayerControls: false } : null)),
            },
        };
        expect(() => createBaseLayerControlsUI(null)).not.toThrow();
        delete globalThis.GeoLeaf;
    });

    // ── _populateLeftPanel: def.label falsy uses key as fallback (branches 13.0, 14.0) ──

    it("_populateLeftPanel uses key when def.label is absent (branches 13.0, 14.0)", () => {
        _baseLayersMock["noLabel"] = {};
        createBaseLayerControlsUI({
            ui: { showBaseLayerControls: true },
            basemaps: {},
        });
        const panel = document.getElementById("gl-left-panel");
        expect(panel).not.toBeNull();
        const btns = panel.querySelectorAll("[data-gl-baselayer='noLabel']");
        expect(btns.length).toBeGreaterThanOrEqual(1);
        delete _baseLayersMock["noLabel"];
    });

    // ── bindUIOnce click handler: !target branch (branch 24.0) ───────────────

    it("bindUIOnce click handler returns early when target has no [data-gl-baselayer] (branch 24.0)", () => {
        bindUIOnce();
        const div = document.createElement("div");
        document.body.appendChild(div);
        div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mockSetBaseLayer).not.toHaveBeenCalled();
    });

    // ── bindUIOnce click handler: !key branch (branch 25.0) ──────────────────

    it("bindUIOnce click handler returns early when key is empty (branch 25.0)", () => {
        bindUIOnce();
        const btn = document.createElement("button");
        btn.dataset.glBaselayer = "";
        document.body.appendChild(btn);
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(mockSetBaseLayer).not.toHaveBeenCalled();
    });
});
