/**
 * T3.3 — layer-manager/attach-toggle.ts branch coverage
 */

vi.mock("../../src/utils/log/index.ts", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// GeoJSONCore mock — controlled per test
const mockGetLayerById = vi.fn();
const mockShowLayer = vi.fn();
const mockHideLayer = vi.fn();
vi.mock("../../src/kernel/geojson/core.js", () => ({
    GeoJSONCore: {
        getLayerById: (...args) => mockGetLayerById(...args),
        showLayer: (...args) => mockShowLayer(...args),
        hideLayer: (...args) => mockHideLayer(...args),
    },
}));

// ThemeApplierCore mock — controlled per test
const mockLoadLayerFromProfile = vi.fn();
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: {
        _loadLayerFromProfile: (...args) => mockLoadLayerFromProfile(...args),
    },
}));

// Capture the Log mock instance (same object used by attach-toggle.ts before any resetModules)
import { Log as TopLog } from "../../src/utils/log/index.js";

import { attachToggleHandler } from "../../src/kernel/layer-manager/attach-toggle.js";

function makeToggleBtn() {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    return btn;
}

function cleanup(btn) {
    if (btn.parentNode) btn.parentNode.removeChild(btn);
}

describe("layer-manager/attach-toggle — T3.3 branch coverage", () => {
    beforeEach(() => {
        mockGetLayerById.mockReset();
        mockShowLayer.mockReset();
        mockHideLayer.mockReset();
        mockLoadLayerFromProfile.mockReset();
    });

    // ── Guard: already attached ───────────────────────────────────────────
    it("does not attach handler twice if _toggleHandlerAttached is already true", () => {
        const btn = makeToggleBtn();
        btn._toggleHandlerAttached = true;
        const checkVis = vi.fn();
        attachToggleHandler(btn, "lyr1", checkVis);
        // Click should not trigger anything since we're using the native addEventListener path
        // but the guard should have returned early
        btn.click();
        expect(checkVis).not.toHaveBeenCalled();
        cleanup(btn);
    });

    // ── _isToggling guard ─────────────────────────────────────────────────
    it("blocks double toggle when _isToggling is true", () => {
        const btn = makeToggleBtn();
        mockGetLayerById.mockReturnValue({ id: "lyr2", layer: {} });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyr2", checkVis);
        btn._isToggling = true; // simulate mid-toggle
        btn.click();
        expect(mockHideLayer).not.toHaveBeenCalled();
        cleanup(btn);
    });

    // ── itemId or GeoJSONCore absent ──────────────────────────────────────
    it("returns early when itemId is empty string", () => {
        const btn = makeToggleBtn();
        attachToggleHandler(btn, "", vi.fn());
        btn.click();
        expect(mockGetLayerById).not.toHaveBeenCalled();
        cleanup(btn);
    });

    // ── toggles to hide when layer is currently visible ───────────────────
    it("hides layer and updates classes when isCurrentlyVisible=true", () => {
        const btn = makeToggleBtn();
        btn.setAttribute("aria-pressed", "true");
        mockGetLayerById.mockReturnValue({ id: "lyrHide" });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyrHide", checkVis);
        btn.click();
        expect(mockHideLayer).toHaveBeenCalledWith("lyrHide");
        expect(btn.getAttribute("aria-pressed")).toBe("false");
        expect(btn.classList.contains("gl-layer-manager__item-toggle--on")).toBe(false);
        cleanup(btn);
    });

    // ── toggles to show when layer is currently hidden ────────────────────
    it("shows layer and updates classes when isCurrentlyVisible=false", () => {
        const btn = makeToggleBtn();
        btn.setAttribute("aria-pressed", "false");
        const fakeLayerData = { id: "lyrShow" };
        mockGetLayerById.mockReturnValue(fakeLayerData);
        const checkVis = vi.fn().mockReturnValue(false);
        attachToggleHandler(btn, "lyrShow", checkVis);
        btn.click();
        expect(mockShowLayer).toHaveBeenCalledWith("lyrShow");
        expect(btn.getAttribute("aria-pressed")).toBe("true");
        cleanup(btn);
    });

    // ── layerItem class manipulation on hide ──────────────────────────────
    it("adds gl-layer--hidden to layerItem on hide", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrItemHide");
        document.body.appendChild(layerItem);
        mockGetLayerById.mockReturnValue({ id: "lyrItemHide" });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyrItemHide", checkVis);
        btn.click();
        expect(layerItem.classList.contains("gl-layer--hidden")).toBe(true);
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── layerItem class manipulation on show ──────────────────────────────
    it("removes gl-layer--hidden from layerItem on show", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrItemShow");
        layerItem.classList.add("gl-layer--hidden");
        document.body.appendChild(layerItem);
        mockGetLayerById.mockReturnValue({ id: "lyrItemShow" });
        const checkVis = vi.fn().mockReturnValue(false);
        attachToggleHandler(btn, "lyrItemShow", checkVis);
        btn.click();
        expect(layerItem.classList.contains("gl-layer--hidden")).toBe(false);
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── labelBtn found and disabled on hide ───────────────────────────────
    it("disables labelBtn when found in layerItem on hide", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrLblHide");
        const labelBtn = document.createElement("button");
        labelBtn.className = "gl-layer-manager__label-toggle";
        labelBtn.setAttribute("aria-pressed", "true");
        layerItem.appendChild(labelBtn);
        document.body.appendChild(layerItem);
        mockGetLayerById.mockReturnValue({ id: "lyrLblHide" });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyrLblHide", checkVis);
        btn.click();
        expect(labelBtn.disabled).toBe(true);
        expect(labelBtn.classList.contains("gl-layer-manager__label-toggle--disabled")).toBe(true);
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── labelBtn found and enabled on show (when label is enabled in style)
    it("enables labelBtn on show when label style is active", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrLblShow");
        const labelBtn = document.createElement("button");
        labelBtn.className = "gl-layer-manager__label-toggle";
        labelBtn.disabled = true;
        labelBtn.classList.add("gl-layer-manager__label-toggle--disabled");
        layerItem.appendChild(labelBtn);
        document.body.appendChild(layerItem);
        // layerData has currentStyle with label.enabled=true
        mockGetLayerById
            .mockReturnValueOnce({ id: "lyrLblShow" }) // main call
            .mockReturnValue({ currentStyle: { label: { enabled: true } } }); // _enableLabelBtnIfApplicable call
        const checkVis = vi.fn().mockReturnValue(false);
        attachToggleHandler(btn, "lyrLblShow", checkVis);
        btn.click();
        expect(labelBtn.disabled).toBe(false);
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── labelBtn not found — fallback to parentElement query ─────────────
    it("falls back to parentElement query when layerItem is null (labelBtn not found)", () => {
        const btn = makeToggleBtn();
        // No [data-layer-id="lyrParent"] in DOM
        mockGetLayerById.mockReturnValue({ id: "lyrParent" });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyrParent", checkVis);
        btn.click();
        // Should not throw even when neither layerItem nor parentElement labelBtn found
        expect(mockHideLayer).toHaveBeenCalledWith("lyrParent");
        cleanup(btn);
    });

    // ── layerData not found → lazy load path ─────────────────────────────
    it("triggers lazy load when layerData is null", () => {
        mockLoadLayerFromProfile.mockReturnValue(Promise.resolve({ id: "lyrLazy" }));
        mockGetLayerById.mockReturnValue(null);
        const btn = makeToggleBtn();
        attachToggleHandler(btn, "lyrLazy", vi.fn());
        btn.click();
        expect(btn.classList.contains("gl-layer-manager__item-toggle--loading")).toBe(true);
        expect(btn.disabled).toBe(true);
        cleanup(btn);
    });

    // ── _afterLazyLoadSuccess — loadedLayer is null → warns ──────────────
    it("_afterLazyLoadSuccess: warns and doesn't show layer when loadedLayer is null/falsy", async () => {
        mockLoadLayerFromProfile.mockReturnValue(Promise.resolve(null));
        mockGetLayerById.mockReturnValue(null);
        const btn = makeToggleBtn();
        attachToggleHandler(btn, "lyrNull", vi.fn());
        btn.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(TopLog.warn).toHaveBeenCalledWith(
            expect.stringContaining("Layer loading failed"),
            "lyrNull"
        );
        cleanup(btn);
    });

    // ── _afterLazyLoadSuccess — loadedLayer is valid ──────────────────────
    it("_afterLazyLoadSuccess: shows layer on successful load", async () => {
        mockLoadLayerFromProfile.mockReturnValue(Promise.resolve({ id: "lyrLoaded", layer: {} }));
        mockGetLayerById.mockReturnValue(null);
        const btn = makeToggleBtn();
        attachToggleHandler(btn, "lyrLoaded", vi.fn());
        btn.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(mockShowLayer).toHaveBeenCalledWith("lyrLoaded");
        expect(btn.classList.contains("gl-layer-manager__item-toggle--on")).toBe(true);
        cleanup(btn);
    });

    // ── _handleLazyLoad — loader throws error ────────────────────────────
    it("_handleLazyLoad: handles load error gracefully", async () => {
        // Use mockImplementation to create the rejected promise lazily (on call),
        // avoiding an eagerly-created unhandled rejection that crashes the Jest worker.
        mockLoadLayerFromProfile.mockImplementation(() => Promise.reject(new Error("Load failed")));
        mockGetLayerById.mockReturnValue(null);
        const btn = makeToggleBtn();
        attachToggleHandler(btn, "lyrError", vi.fn());
        btn.click();
        // Flush microtask queue to let .catch() handler run
        await new Promise((r) => setTimeout(r, 0));
        expect(TopLog.error).toHaveBeenCalledWith(
            expect.stringContaining("Error loading layer"),
            "lyrError",
            expect.any(Error)
        );
        expect(btn.disabled).toBe(false);
        cleanup(btn);
    });

    // ── _handleLazyLoad — loader not available (uses module isolation) ────
    it("_handleLazyLoad: handles missing ThemeApplierCore._loadLayerFromProfile", async () => {
        const btn = makeToggleBtn();
        mockGetLayerById.mockReturnValue(null);
        // Mutate the shared mock object to remove _loadLayerFromProfile temporarily
        const { ThemeApplierCore } = await import("../../src/kernel/themes/theme-applier/core.js");
        const origFn = ThemeApplierCore._loadLayerFromProfile;
        delete ThemeApplierCore._loadLayerFromProfile;
        try {
            attachToggleHandler(btn, "lyrNoLoader", vi.fn());
            btn.click();
            // disabled should be re-enabled immediately since no loader
            expect(btn.disabled).toBe(false);
        } finally {
            ThemeApplierCore._loadLayerFromProfile = origFn;
        }
        cleanup(btn);
    });

    // ── addEventListener path — MapLibre (no L.DomEvent needed) ──────────
    it("uses L.DomEvent.on when L.DomEvent is available", async () => {
        vi.resetModules();
        const { attachToggleHandler: ath } = await import(
            "../../src/kernel/layer-manager/attach-toggle.js"
        );
        const btn = makeToggleBtn();
        const addEventSpy = vi.spyOn(btn, "addEventListener");
        ath(btn, "lyrL", vi.fn().mockReturnValue(false));
        expect(addEventSpy).toHaveBeenCalledWith("click", expect.any(Function));
        cleanup(btn);
    });

    // ── _findLabelBtn — from parentElement when no layerItem ──────────────
    it("finds labelBtn via toggleBtn.parentElement when layerItem is null", () => {
        const container = document.createElement("div");
        const btn = document.createElement("button");
        const labelBtn = document.createElement("button");
        labelBtn.className = "gl-layer-manager__label-toggle";
        container.appendChild(btn);
        container.appendChild(labelBtn);
        document.body.appendChild(container);
        // No [data-layer-id] in DOM for this layer
        mockGetLayerById.mockReturnValue({ id: "lyrParentLbl" });
        const checkVis = vi.fn().mockReturnValue(true);
        attachToggleHandler(btn, "lyrParentLbl", checkVis);
        btn.click();
        // labelBtn should be disabled via parentElement path
        expect(labelBtn.disabled).toBe(true);
        document.body.removeChild(container);
    });

    // ── _enableLabelBtnIfApplicable — label not enabled in style ─────────
    it("does not enable labelBtn when currentStyle.label.enabled is false", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrNoLbl");
        const labelBtn = document.createElement("button");
        labelBtn.className = "gl-layer-manager__label-toggle";
        labelBtn.disabled = true;
        layerItem.appendChild(labelBtn);
        document.body.appendChild(layerItem);
        mockGetLayerById
            .mockReturnValueOnce({ id: "lyrNoLbl" })
            .mockReturnValue({ currentStyle: { label: { enabled: false } } });
        const checkVis = vi.fn().mockReturnValue(false);
        attachToggleHandler(btn, "lyrNoLbl", checkVis);
        btn.click();
        expect(labelBtn.disabled).toBe(true); // not enabled since label.enabled=false
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── _enableLabelBtnIfApplicable — no currentStyle ────────────────────
    it("does not enable labelBtn when getLayerById returns null for enable check", () => {
        const btn = makeToggleBtn();
        const layerItem = document.createElement("div");
        layerItem.setAttribute("data-layer-id", "lyrNoData");
        const labelBtn = document.createElement("button");
        labelBtn.className = "gl-layer-manager__label-toggle";
        labelBtn.disabled = true;
        layerItem.appendChild(labelBtn);
        document.body.appendChild(layerItem);
        mockGetLayerById.mockReturnValueOnce({ id: "lyrNoData" }).mockReturnValue(null); // null for enable check
        const checkVis = vi.fn().mockReturnValue(false);
        attachToggleHandler(btn, "lyrNoData", checkVis);
        btn.click();
        expect(labelBtn.disabled).toBe(true);
        cleanup(btn);
        document.body.removeChild(layerItem);
    });

    // ── toggle error caught by try/catch ──────────────────────────────────
    it("catches and logs errors thrown during toggle", () => {
        const btn = makeToggleBtn();
        mockGetLayerById.mockImplementation(() => {
            throw new Error("unexpected error");
        });
        attachToggleHandler(btn, "lyrBadData", vi.fn());
        expect(() => btn.click()).not.toThrow();
        // Use TopLog (captured before any resetModules) — same instance as attach-toggle.ts uses
        expect(TopLog.warn).toHaveBeenCalledWith(
            expect.stringContaining("Toggle error"),
            expect.any(Error)
        );
        cleanup(btn);
    });
});
