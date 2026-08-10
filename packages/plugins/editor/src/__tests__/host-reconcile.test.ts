/**
 * Tests for host-layer reconciliation — Sprint S10 (EDT.10.5).
 * Covers hide/show (filter), commit/remove (source rewrite), id fallback,
 * the empty-featureId guard, and the missing-source safety branch.
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

function makeDeps(
    fc: unknown = makeFC(),
    sourceId = "gl-L"
): HostReconcileDeps & {
    setLayerFilter: ReturnType<typeof vi.fn>;
    updateLayerData: ReturnType<typeof vi.fn>;
} {
    const setLayerFilter = vi.fn();
    const updateLayerData = vi.fn();
    const nativeMap = {
        getSource: vi.fn((id: string) =>
            id === sourceId ? { serialize: () => ({ data: fc }) } : null
        ),
    };
    return {
        facade: { setLayerFilter, updateLayerData },
        nativeMap,
        setLayerFilter,
        updateLayerData,
    };
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

describe("commitHostGeometry", () => {
    it("replaces the matched feature geometry, leaves others untouched, clears filter", () => {
        const deps = makeDeps();
        const newGeom = { type: "Point", coordinates: [9, 9] };
        commitHostGeometry(deps, "L", "f1", newGeom);

        expect(deps.updateLayerData).toHaveBeenCalledOnce();
        const [, data] = deps.updateLayerData.mock.calls[0] as [string, { features: any[] }];
        expect(data.features[0].geometry).toEqual(newGeom);
        expect(data.features[1].geometry).toEqual({ type: "Point", coordinates: [1, 1] });
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
    });

    it("matches on a top-level feature id when properties.id is absent", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    id: "top1",
                    properties: {},
                    geometry: { type: "Point", coordinates: [0, 0] },
                },
            ],
        };
        const deps = makeDeps(fc);
        const newGeom = { type: "Point", coordinates: [5, 5] };
        commitHostGeometry(deps, "L", "top1", newGeom);
        const [, data] = deps.updateLayerData.mock.calls[0] as [string, { features: any[] }];
        expect(data.features[0].geometry).toEqual(newGeom);
    });
});

describe("removeHostFeature", () => {
    it("drops the matched feature and clears the filter", () => {
        const deps = makeDeps();
        removeHostFeature(deps, "L", "f1");
        const [, data] = deps.updateLayerData.mock.calls[0] as [string, { features: any[] }];
        expect(data.features).toHaveLength(1);
        expect(data.features[0].properties.id).toBe("f2");
        expect(deps.setLayerFilter).toHaveBeenLastCalledWith("L", null);
    });
});

describe("missing source safety", () => {
    it("commit warns and does not call updateLayerData when the source is absent", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const deps = makeDeps(makeFC(), "gl-OTHER"); // source id won't match "gl-L"/"L"
        commitHostGeometry(deps, "L", "f1", { type: "Point", coordinates: [0, 0] });
        expect(deps.updateLayerData).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        // Still restores visibility so the user is not left with a hidden original.
        expect(deps.setLayerFilter).toHaveBeenCalledWith("L", null);
        warn.mockRestore();
    });
});
