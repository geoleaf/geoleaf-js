/**
 * Tests for src/kernel/layer-manager/attach-toggle.ts
 * Sprint 2 — branch coverage: attachToggleHandler, all toggle/lazy paths
 *
 * ⚠️ Nommé `-sprint2` au STRUCT S7 : arrivé de `__tests__/layers/`, il entrait en
 * collision de FICHIER avec `layer-manager/attach-toggle.test.js` — deux suites de
 * couverture de branches sur le même module, sous deux dossiers dont l'un ne nommait
 * rien (`layers/`). Contrairement aux deux doublons stricts du sprint, ces deux-là
 * couvrent des axes réellement distincts (Sprint 2 vs T3.3) : rien à fusionner ici,
 * seulement un nom à désambiguïser. Le jeton vient de l'en-tête ci-dessus, pas d'un
 * compteur — même patron que `basemaps/registry-sprint2.test.js`.
 */

const mockGeoJSONCore = vi.hoisted(() => ({
    hideLayer: vi.fn(),
    showLayer: vi.fn(),
    getLayerById: vi.fn(),
}));
const mockThemeApplierCore = vi.hoisted(() => ({}));
const mockLog = vi.hoisted(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock("../../src/kernel/geojson/core.js", () => ({ GeoJSONCore: mockGeoJSONCore }));
vi.mock("../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: mockThemeApplierCore,
}));
vi.mock("../../src/utils/log/index.js", () => ({ Log: mockLog }));

import { attachToggleHandler } from "../../src/kernel/layer-manager/attach-toggle.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeToggleBtn(overrides = {}) {
    return {
        closest: vi.fn(() => null),
        querySelector: vi.fn(() => null),
        parentElement: null,
        getAttribute: vi.fn((attr) => (attr === "aria-pressed" ? "true" : null)),
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        removeEventListener: vi.fn(),
        addEventListener: vi.fn(),
        classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn() },
        disabled: false,
        _toggleHandlerAttached: false,
        _isToggling: false,
        ...overrides,
    };
}

/**
 * After calling attachToggleHandler(btn, ...), retrieve the registered click handler.
 * The source uses L.DomEvent.on when available (from global mock), so we check there first.
 */
function getClickHandler(btn) {
    const L = window.L;
    if (L && L.DomEvent && L.DomEvent.on && L.DomEvent.on.mock) {
        const call = [...L.DomEvent.on.mock.calls]
            .reverse()
            .find(([el, ev]) => el === btn && ev === "click");
        if (call) return call[2];
    }
    // Fallback: addEventListener
    const call = btn.addEventListener.mock.calls.find(([ev]) => ev === "click");
    return call ? call[1] : null;
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("layer-manager/attach-toggle — Sprint 2 branch coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete mockThemeApplierCore._loadLayerFromProfile;
        // Clear DomEvent mock between tests
        if (window.L && window.L.DomEvent) {
            window.L.DomEvent.on.mockClear();
        }
    });

    describe("attachToggleHandler — guard", () => {
        it("returns without attaching if handler already attached", () => {
            const btn = makeToggleBtn({ _toggleHandlerAttached: true });
            attachToggleHandler(btn, "lyr1", () => true);
            // Handler must NOT be registered — check both paths
            const L = window.L;
            const domEventCalled =
                L && L.DomEvent && L.DomEvent.on && L.DomEvent.on.mock
                    ? L.DomEvent.on.mock.calls.some(([el]) => el === btn)
                    : false;
            expect(domEventCalled).toBe(false);
            // Also confirm addEventListener wasn't used as fallback
            expect(btn.addEventListener).not.toHaveBeenCalled();
        });

        it("sets _toggleHandlerAttached = true after first attach", () => {
            const btn = makeToggleBtn();
            attachToggleHandler(btn, "lyr1", () => true);
            expect(btn._toggleHandlerAttached).toBe(true);
        });
    });

    describe("attachToggleHandler — toggle visible → hide", () => {
        it("calls GeoJSONCore.hideLayer when layer is visible (checkVisibility = true)", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "lyr1", () => true);
            const handler = getClickHandler(btn);
            expect(handler).toBeDefined();
            handler(new Event("click"));

            expect(mockGeoJSONCore.hideLayer).toHaveBeenCalledWith("lyr1");
        });

        it("sets aria-pressed to false after hide", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "lyr1", () => true);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(btn.setAttribute).toHaveBeenCalledWith("aria-pressed", "false");
        });
    });

    describe("attachToggleHandler — toggle not visible → show", () => {
        it("calls GeoJSONCore.showLayer when layer is not visible (checkVisibility = false)", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: false });

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(mockGeoJSONCore.showLayer).toHaveBeenCalledWith("lyr1");
        });

        it("sets aria-pressed to true after show", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: false });

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(btn.setAttribute).toHaveBeenCalledWith("aria-pressed", "true");
        });
    });

    describe("attachToggleHandler — _isToggling debounce guard", () => {
        it("blocks a second synchronous click while _isToggling is set", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "lyr1", () => true);
            const handler = getClickHandler(btn);

            handler(new Event("click")); // first click sets _isToggling = true
            handler(new Event("click")); // second click blocked

            expect(mockGeoJSONCore.hideLayer).toHaveBeenCalledTimes(1);
        });
    });

    describe("_handleLazyLoad", () => {
        it("warns and returns when ThemeApplierCore._loadLayerFromProfile is null", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue(null); // no layer → lazy load
            mockThemeApplierCore._loadLayerFromProfile = null;

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(mockLog.warn).toHaveBeenCalled();
            expect(mockGeoJSONCore.showLayer).not.toHaveBeenCalled();
        });

        it("warns and returns when ThemeApplierCore._loadLayerFromProfile is not set", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue(null);
            // _loadLayerFromProfile not set

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("calls _loadLayerFromProfile when available (success path)", async () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue(null);
            const fakeLayer = { id: "lyr1" };
            const loaderFn = vi.fn(() => Promise.resolve(fakeLayer));
            mockThemeApplierCore._loadLayerFromProfile = loaderFn;

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            await Promise.resolve();

            expect(loaderFn).toHaveBeenCalledWith("lyr1");
        });

        it("logs error when _loadLayerFromProfile rejects", async () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue(null);
            const loaderFn = vi.fn(() => Promise.reject(new Error("load failed")));
            mockThemeApplierCore._loadLayerFromProfile = loaderFn;

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            // Flush promise chain: rejection + catch
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockLog.error).toHaveBeenCalled();
        });
    });

    describe("_afterLazyLoadSuccess", () => {
        it("warns and returns early when loadedLayer is null", async () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue(null);
            const loaderFn = vi.fn(() => Promise.resolve(null)); // null loaded layer
            mockThemeApplierCore._loadLayerFromProfile = loaderFn;

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockLog.warn).toHaveBeenCalled();
        });

        it("shows layer after successful load", async () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById
                .mockReturnValueOnce(null) // first call: no layer → lazy load
                .mockReturnValue({ visible: false }); // second call: in _enableLabelBtnIfApplicable
            const fakeLayer = { id: "lyr1" };
            const loaderFn = vi.fn(() => Promise.resolve(fakeLayer));
            mockThemeApplierCore._loadLayerFromProfile = loaderFn;

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(mockGeoJSONCore.showLayer).toHaveBeenCalledWith("lyr1");
        });
    });

    describe("_findLabelBtn", () => {
        it("finds label toggle button via parentElement.querySelector fallback", () => {
            const labelBtn = { disabled: true, classList: { remove: vi.fn() } };
            const btn = makeToggleBtn();
            // parentElement with label toggle
            btn.parentElement = {
                querySelector: vi.fn((q) =>
                    q === ".gl-layer-manager__label-toggle" ? labelBtn : null
                ),
            };

            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: false, currentStyle: null });

            attachToggleHandler(btn, "lyr1", () => false);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(btn.parentElement.querySelector).toHaveBeenCalledWith(
                ".gl-layer-manager__label-toggle"
            );
        });

        it("finds label btn via DOM [data-layer-id] element", () => {
            const labelBtn = document.createElement("button");
            labelBtn.className = "gl-layer-manager__label-toggle";
            const layerItem = document.createElement("div");
            layerItem.setAttribute("data-layer-id", "domLyr");
            layerItem.appendChild(labelBtn);
            document.body.appendChild(layerItem);

            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "domLyr", () => true);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            expect(mockGeoJSONCore.hideLayer).toHaveBeenCalledWith("domLyr");
            document.body.removeChild(layerItem);
        });

        it("warns when label button not found during hide", () => {
            const btn = makeToggleBtn(); // no parentElement
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "lyr1", () => true);
            const handler = getClickHandler(btn);
            handler(new Event("click"));

            // warn is called for "Label button NOT FOUND"
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe("L.DomEvent availability", () => {
        it("attaches click handler (via L.DomEvent.on or addEventListener)", () => {
            const btn = makeToggleBtn();
            mockGeoJSONCore.getLayerById.mockReturnValue({ visible: true });

            attachToggleHandler(btn, "lyr1", () => true);

            // Handler must be attached via one of the two mechanisms
            const handler = getClickHandler(btn);
            expect(handler).toBeInstanceOf(Function);
        });
    });
});
