/**
 * Tests for host-layer reconciliation — Sprint S10 (EDT.10.5).
 * Covers hide/show (filter), the empty-featureId guard, and a feature the layer's store does
 * not hold (shown back, never rewritten at the source). The store path is in
 * `host-reconcile-store.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    hideHostFeature,
    showHostFeature,
    commitHostGeometry,
    removeHostFeature,
    getHiddenHost,
    resetHostReconcile,
    type HostReconcileDeps,
} from "../selection/host-reconcile.js";

const EXCLUDE = (id: string) => ["all", ["!=", ["get", "id"], id], ["!=", ["id"], id]];

function makeFC() {
    return {
        type: "FeatureCollection",
        features: [
            {
                type: "Feature",
                properties: { id: "f1", name: "A" },
                geometry: { type: "Point", coordinates: [0, 0] },
            },
            {
                type: "Feature",
                properties: { id: "f2", name: "B" },
                geometry: { type: "Point", coordinates: [1, 1] },
            },
        ],
    };
}

/**
 * The deps entry.ts builds, plus a map source under the name the removed fallback looked for
 * (`gl-L`) and an `updateLayerData` spy on the facade — so a source rewrite would be SEEN.
 */
function makeDeps(fc: unknown = makeFC()): HostReconcileDeps & {
    setLayerFilter: ReturnType<typeof vi.fn>;
    updateLayerData: ReturnType<typeof vi.fn>;
} {
    const setLayerFilter = vi.fn();
    const updateLayerData = vi.fn();
    const nativeMap = {
        getSource: vi.fn((id: string) =>
            id === "gl-L" ? { serialize: () => ({ data: fc }) } : null
        ),
    };
    const facade = { setLayerFilter, updateLayerData };
    const deps = { facade, nativeMap };
    return { ...deps, setLayerFilter, updateLayerData };
}

beforeEach(() => resetHostReconcile());

describe("hideHostFeature / showHostFeature", () => {
    it("hide applies an exclude filter and tracks the hidden feature", () => {
        const deps = makeDeps();
        hideHostFeature(deps, "L", "f1");
        expect(deps.setLayerFilter).toHaveBeenCalledWith("L", EXCLUDE("f1"));
        expect(getHiddenHost()).toEqual({ layerId: "L", featureId: "f1" });
    });

    it("show clears the filter and the tracked state", () => {
        const deps = makeDeps();
        hideHostFeature(deps, "L", "f1");
        showHostFeature(deps);
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
        expect(getHiddenHost()).toBeNull();
    });

    it("hide is a no-op when featureId is empty", () => {
        const deps = makeDeps();
        hideHostFeature(deps, "L", "");
        expect(deps.setLayerFilter).not.toHaveBeenCalled();
        expect(getHiddenHost()).toBeNull();
    });
});

// 🛑 A FEATURE THE LAYER'S STORE DOES NOT HOLD IS NEVER WRITTEN THROUGH THE MAP SOURCE. The
// store is the layer's data (`host-reconcile-store.test.ts`); the fallback that rewrote the
// source looked for `gl-<id>` / `<id>`, while the core names a GeoJSON source `gl-src-<id>`:
// dead against a real map. Pointed at the right name, it would have been worse than dead — a
// source re-fed under an active filter holds a SUBSET, and rewriting it from what it held made
// that subset the layer's data. Removed on 27/09/2026. Each 🛑 case below was seen red with the
// fallback in place, against a source mocked under the name it looked for.
describe("a feature the layer's store does not hold", () => {
    it("🛑 commit warns, shows the original back, and rewrites no source", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const deps = makeDeps();
        commitHostGeometry(deps, "L", "f1", { type: "Point", coordinates: [9, 9] });
        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
        warn.mockRestore();
    });

    it("🛑 remove warns, shows the original back, and rewrites no source", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const deps = makeDeps();
        removeHostFeature(deps, "L", "f1");
        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
        warn.mockRestore();
    });
});
