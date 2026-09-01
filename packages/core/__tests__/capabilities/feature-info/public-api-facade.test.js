/**
 * Unit tests — `capabilities/feature-info/public-api.ts` (facade at 33%).
 *
 * Pure facade: `buildPublicApi()` returns the object mounted on
 * `GeoLeaf.FeatureInfo`, each method delegating to an internal module. The
 * delegates are mocked and the delegation is verified + the
 * `if (!enabled) return` guards (popup/side-panel).
 */
import { vi, test, expect, beforeEach } from "vitest";

// vi.hoisted: vi.mock's factory is hoisted to the top; the variables it
// references must be too (otherwise "Cannot access before initialization").
const {
    getFeatureInfoConfig,
    closePopup,
    handleClick,
    openSidePanelFn,
    closeSidePanel,
    getLayerBinding,
} = vi.hoisted(() => ({
    getFeatureInfoConfig: vi.fn(),
    closePopup: vi.fn(),
    handleClick: vi.fn(),
    openSidePanelFn: vi.fn(),
    closeSidePanel: vi.fn(),
    getLayerBinding: vi.fn(() => ({ layerId: "x" })),
}));

vi.mock("../../../src/capabilities/feature-info/config.js", () => ({ getFeatureInfoConfig }));
vi.mock("../../../src/capabilities/feature-info/surfaces/popup.js", () => ({
    closePopup,
    handleClick,
}));
vi.mock("../../../src/capabilities/feature-info/surfaces/sidepanel.js", () => ({
    openSidePanel: openSidePanelFn,
    closeSidePanel,
}));
vi.mock("../../../src/capabilities/feature-info/convert.js", () => ({ getLayerBinding }));

import { buildPublicApi } from "../../../src/capabilities/feature-info/public-api.js";

let api;
beforeEach(() => {
    vi.clearAllMocks();
    getFeatureInfoConfig.mockReturnValue({ enabled: true });
    api = buildPublicApi();
});

test("isEnabled reflète la config", () => {
    expect(api.isEnabled()).toBe(true);
    getFeatureInfoConfig.mockReturnValue({ enabled: false });
    expect(api.isEnabled()).toBe(false);
});

test("close ferme popup ET side-panel", () => {
    api.close();
    expect(closePopup).toHaveBeenCalled();
    expect(closeSidePanel).toHaveBeenCalled();
});

test("openPopup délègue à handleClick quand activé", () => {
    api.openPopup({ id: 1 }, "popup");
    expect(handleClick).toHaveBeenCalledWith({ id: 1 }, "popup");
});

test("openPopup est un no-op quand désactivé", () => {
    getFeatureInfoConfig.mockReturnValue({ enabled: false });
    api.openPopup({ id: 1 }, "popup");
    expect(handleClick).not.toHaveBeenCalled();
});

test("openSidePanel délègue quand activé, no-op sinon", () => {
    api.openSidePanel({ id: 2 }, "panel");
    expect(openSidePanelFn).toHaveBeenCalledWith({ id: 2 }, "panel");

    openSidePanelFn.mockClear();
    getFeatureInfoConfig.mockReturnValue({ enabled: false });
    api.openSidePanel({ id: 2 }, "panel");
    expect(openSidePanelFn).not.toHaveBeenCalled();
});

test("getConfig délègue à getLayerBinding", () => {
    expect(api.getConfig("roads")).toEqual({ layerId: "x" });
    expect(getLayerBinding).toHaveBeenCalledWith("roads");
});
