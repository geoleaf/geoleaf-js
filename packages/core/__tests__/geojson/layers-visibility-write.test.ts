/**
 * Unit tests — the visibility WRITE seam and the `userOverride` read.
 *
 * `isVisible` / `isEnabled` promoted the read side; two things stayed unreachable:
 * WHO last set a layer's visibility, and setting it as anyone other than the user.
 * `GeoJSON.showLayer` / `hideLayer` / `toggleLayer` hard-wire `"user"`, so a host
 * restoring a saved state could not say so, and its restore was indistinguishable
 * from a click.
 *
 * 🛑 **The test that matters most is `repaints after recording the intent`.**
 * `setVisibility` on the manager updates the button and NOT the painted state — the
 * two existing writes each chain `updateLayerVisibilityByZoom()` for that reason.
 * A seam that omitted it would pass every assertion about state while leaving the
 * map untouched, and nothing would fail or log. That defect has been shipped once
 * on this very facade, under a different name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi } from "../../src/contracts/layer-data.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");
// The REAL manager for the read paths: which field each accessor returns is the
// subject, and a stub returning what the test wants would assert nothing about it.
const { VisibilityManager } = await import("../../src/kernel/geojson/visibility-manager.ts");

const g = globalThis as unknown as {
    GeoLeaf: Record<string, unknown> & {
        _LayerVisibilityManager?: unknown;
        _GeoJSONLayerManager?: unknown;
    };
};

let api: LayerDataApi;
let repaint: ReturnType<typeof vi.fn>;

/** Seeds a layer with the visibility metadata these tests set field by field. */
function seedLayer(id: string, visibility: Record<string, unknown>) {
    GeoJSONShared.state.layers.set(id, {
        id,
        config: {},
        geometryType: "point",
        features: [],
        _visibility: visibility,
    } as never);
}

beforeEach(() => {
    GeoJSONShared.reset();
    repaint = vi.fn();
    // 🛑 Not decoration: `_applyVisibilityChange` returns `false` without an adapter,
    // and the manager records `source` only when the physical change lands. Omit this
    // and the seam looks broken while the defect is in the harness.
    GeoJSONShared.state.adapter = {
        showLayer: vi.fn(),
        hideLayer: vi.fn(),
    } as unknown as typeof GeoJSONShared.state.adapter;
    g.GeoLeaf = {
        ...(g.GeoLeaf ?? {}),
        _LayerVisibilityManager: VisibilityManager,
        _GeoJSONLayerManager: { updateLayerVisibilityByZoom: repaint },
    };
    api = buildLayersPublicApi();
});

afterEach(() => {
    GeoJSONShared.reset();
    delete g.GeoLeaf?._LayerVisibilityManager;
    delete g.GeoLeaf?._GeoJSONLayerManager;
    vi.restoreAllMocks();
});

describe("isUserOverridden — WHO asked, not WHAT was asked", () => {
    it("distinguishes a user-set layer from a theme-set one", () => {
        // The whole point of the accessor. Both layers are switched ON — `isEnabled`
        // cannot tell them apart, and an automatic rule that may override one but not
        // the other has no other way to ask.
        seedLayer("byUser", { current: true, logicalState: true, userOverride: true });
        seedLayer("byTheme", { current: true, logicalState: true, userOverride: false });

        expect(api.isEnabled("byUser")).toBe(true);
        expect(api.isEnabled("byTheme")).toBe(true);

        expect(api.isUserOverridden("byUser")).toBe(true);
        expect(api.isUserOverridden("byTheme")).toBe(false);
    });

    it("reports false for a layer the store does not know", () => {
        expect(api.isUserOverridden("ghost")).toBe(false);
    });
});

describe("setVisibility — the write that names its source", () => {
    it("records the intent under the source it was given", () => {
        seedLayer("L1", { current: false, logicalState: false, userOverride: false });

        api.setVisibility("L1", true, "system");

        const state = VisibilityManager.getVisibilityState("L1");
        expect(state?.logicalState).toBe(true);
        expect(state?.source).toBe("system");
        // A system restore must NOT be recorded as a user action — that is the whole
        // reason this route exists next to `showLayer`.
        expect(state?.userOverride).toBe(false);
    });

    it("marks a user-sourced write as a user override, unlike a system one", () => {
        seedLayer("L1", { current: false, logicalState: false, userOverride: false });

        api.setVisibility("L1", true, "user");

        expect(VisibilityManager.getVisibilityState("L1")?.userOverride).toBe(true);
        expect(api.isUserOverridden("L1")).toBe(true);
    });

    it("repaints after recording the intent — the step that has no visible symptom", () => {
        // `setVisibility` alone moves the button and leaves the map as it was. Nothing
        // throws and nothing logs, so only this assertion stands between the seam and
        // a layer switched on that never appears.
        seedLayer("L1", { current: false, logicalState: false, userOverride: false });

        api.setVisibility("L1", true, "system");

        expect(repaint).toHaveBeenCalledTimes(1);
    });

    it("refuses a layer the store does not know, without touching the map", () => {
        expect(api.setVisibility("ghost", true, "system")).toBe(false);
        expect(repaint).not.toHaveBeenCalled();
    });
});
