/**
 * @vitest-environment happy-dom
 *
 * Sprint 2 (A.7) regression — `gl_shown` URL parameter must restore layers
 * that are NOT part of the active theme.
 *
 * Before the fix in permalink-sync.ts, `VisibilityManager.setVisibility(id,
 * true, "user")` returned silently when the layer was missing from
 * `GeoJSONShared.state.layers`, so copy/pasting a URL with `gl_shown=…`
 * dropped the requested layer. The fix lazy-loads the layer via
 * `ThemeApplierCore._loadLayerFromProfile()` (same path used by the layer
 * manager's "load on demand" toggle) before applying the user override.
 *
 * Uses happy-dom (not jsdom) — same Node 18 / webidl-conversions workaround
 * as the rest of the share suite.
 */
import { vi } from "vitest";

const mockSetVisibility = vi.hoisted(() => vi.fn());
const mockGetCenter = vi.hoisted(() => vi.fn(() => ({ lat: 48.857, lng: 2.347 })));
const mockGetZoom = vi.hoisted(() => vi.fn(() => 12));

vi.mock("../../../src/kernel/geojson/visibility-manager.js", () => ({
    VisibilityManager: { setVisibility: mockSetVisibility },
}));

const mockLayersMap = vi.hoisted(() => new Map());
vi.mock("../../../src/kernel/geojson/shared.js", () => ({
    GeoJSONShared: { state: { layers: mockLayersMap } },
}));

vi.mock("../../../src/utils/log/index.js", () => ({
    Log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockLoadLayerFromProfile = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock("../../../src/kernel/themes/theme-applier/core.js", () => ({
    ThemeApplierCore: { _loadLayerFromProfile: mockLoadLayerFromProfile },
}));

import { applyState } from "../../../src/capabilities/permalink/permalink-sync.ts";

function makeMap() {
    return {
        setView: vi.fn(),
        getCenter: mockGetCenter,
        getZoom: mockGetZoom,
        on: vi.fn(),
        off: vi.fn(),
    };
}

beforeEach(() => {
    mockSetVisibility.mockClear();
    mockLoadLayerFromProfile.mockClear();
    mockLayersMap.clear();
});

describe("applyState — gl_shown restoration (A.7 fix)", () => {
    test("layer already loaded → direct setVisibility(user)", () => {
        mockLayersMap.set("eco_regions", { _visibility: {} });
        applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["eco_regions"] }, makeMap());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockSetVisibility).toHaveBeenCalledWith("eco_regions", true, "user");
        expect(mockLoadLayerFromProfile).not.toHaveBeenCalled();
    });

    test("layer missing from active theme → lazy-loaded then made visible", async () => {
        mockLoadLayerFromProfile.mockResolvedValue(true);
        applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["eco_regions"] }, makeMap());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockLoadLayerFromProfile).toHaveBeenCalledWith("eco_regions");
        // setVisibility is chained after the loader promise resolves
        await Promise.resolve();
        await Promise.resolve();
        expect(mockSetVisibility).toHaveBeenCalledWith("eco_regions", true, "user");
    });

    test("loader resolves to falsy → setVisibility NOT called", async () => {
        mockLoadLayerFromProfile.mockResolvedValue(null);
        applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["ghost"] }, makeMap());
        document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));

        expect(mockLoadLayerFromProfile).toHaveBeenCalledWith("ghost");
        await Promise.resolve();
        await Promise.resolve();
        expect(mockSetVisibility).not.toHaveBeenCalled();
    });

    test("loader rejects → no throw, no setVisibility", async () => {
        mockLoadLayerFromProfile.mockRejectedValue(new Error("not in profile"));
        expect(() => {
            applyState({ lat: 48, lng: 2, zoom: 10, shownLayers: ["bad"] }, makeMap());
            document.dispatchEvent(new CustomEvent("geoleaf:theme:applied"));
        }).not.toThrow();

        await Promise.resolve();
        await Promise.resolve();
        expect(mockSetVisibility).not.toHaveBeenCalled();
    });
});
