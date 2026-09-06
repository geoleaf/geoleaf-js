/**
 * Unit tests — the three public seams added to `GeoLeaf.Layers` (R3 · 0.2).
 *
 * `isVisible` / `isEnabled` promote the READ side of the centralized visibility
 * state, which had no public route: the write side (`GeoJSON.showLayer` /
 * `hideLayer` / `toggleLayer`) was already public and frozen, the read was not.
 *
 * ⚠️ The two booleans are separated ON PURPOSE, and the test that matters is
 * `distinguishes physical visibility from intent`: a layer outside its zoom range
 * is `isEnabled === true` (the user asked for it) and `isVisible === false` (it is
 * not painted). A single accessor returning the raw 6-field state made those two
 * indistinguishable at the call site, and reading the wrong one to drive a toggle
 * is a defect that was committed once already.
 *
 * `create` is the only route to a layer the active profile does not declare —
 * `setData` writes to an EXISTING layer, and the profile loader skips definitions
 * with no resolvable source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDataApi, LayerDefinition } from "../../src/contracts/layer-data.contract.js";

const { buildLayersPublicApi } = await import("../../src/kernel/geojson/layers-public-api.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");
const profileLoader = await import("../../src/kernel/geojson/loader/profile.ts");
// The REAL manager, mounted where the seam reads it. Not a mock: the point of
// these two accessors is which field of the real state machine each returns, and
// a stub returning what the test wants would assert nothing about that.
const { VisibilityManager } = await import("../../src/kernel/geojson/visibility-manager.ts");

/** The visibility metadata a layer carries, as these tests set it field by field. */
interface SeededVisibility {
    current: boolean;
    logicalState: boolean;
    zoomConstrained?: boolean;
    [key: string]: unknown;
}

/** The global namespace, as this file writes and clears it. */
const g = globalThis as unknown as {
    GeoLeaf: Record<string, unknown> & { _LayerVisibilityManager?: unknown };
};

/** Seeds a layer whose visibility metadata is set field by field. */
function seedLayer(id: string, visibility: SeededVisibility | null) {
    GeoJSONShared.state.layers.set(id, {
        id,
        config: {},
        geometryType: "point",
        features: [],
        ...(visibility ? { _visibility: visibility } : {}),
    });
}

let api: LayerDataApi;

beforeEach(() => {
    GeoJSONShared.reset();
    // Only the two members this file's paths touch — cast at the boundary rather
    // than stubbing a full adapter, which would say nothing more and drift with it.
    GeoJSONShared.state.adapter = {
        updateLayerData: vi.fn(),
        setFeatureState: vi.fn(),
    } as unknown as typeof GeoJSONShared.state.adapter;
    g.GeoLeaf = { ...(g.GeoLeaf ?? {}), _LayerVisibilityManager: VisibilityManager };
    api = buildLayersPublicApi();
});

afterEach(() => {
    GeoJSONShared.reset();
    delete g.GeoLeaf?._LayerVisibilityManager;
    vi.restoreAllMocks();
});

describe("visibility reads — isVisible / isEnabled", () => {
    it("reports a painted layer as both visible and enabled", () => {
        seedLayer("L1", { current: true, logicalState: true, zoomConstrained: false });
        expect(api.isVisible("L1")).toBe(true);
        expect(api.isEnabled("L1")).toBe(true);
    });

    // 🛑 THE assertion of this file. A mutation swapping the two fields must fall
    // HERE and only here — the other cases agree on both, so they cannot tell.
    it("distinguishes physical visibility from intent on a zoom-constrained layer", () => {
        seedLayer("L1", { current: false, logicalState: true, zoomConstrained: true });
        expect(api.isVisible("L1")).toBe(false); // not painted: out of zoom range
        expect(api.isEnabled("L1")).toBe(true); // still what the user asked for
    });

    it("reports a layer switched off as neither visible nor enabled", () => {
        seedLayer("L1", { current: false, logicalState: false, zoomConstrained: false });
        expect(api.isVisible("L1")).toBe(false);
        expect(api.isEnabled("L1")).toBe(false);
    });

    it("returns false for an unknown layer rather than throwing", () => {
        expect(api.isVisible("nope")).toBe(false);
        expect(api.isEnabled("nope")).toBe(false);
    });

    it("returns false, without throwing, on a host where the manager is not mounted", () => {
        seedLayer("L1", { current: true, logicalState: true });
        delete g.GeoLeaf._LayerVisibilityManager;
        expect(api.isVisible("L1")).toBe(false);
        expect(api.isEnabled("L1")).toBe(false);
    });

    it("treats a layer whose visibility metadata is not yet initialised as off", () => {
        seedLayer("L1", null);
        expect(api.isVisible("L1")).toBe(false);
        expect(api.isEnabled("L1")).toBe(false);
    });
});

describe("create — a layer the active profile does not declare", () => {
    it("delegates to the profile loader and returns the loaded-layer result", async () => {
        const spy = vi
            .spyOn(profileLoader, "loadLayerDefinition")
            .mockResolvedValue({ id: "adhoc", label: "Ad hoc", featureCount: 2 });
        const def = { id: "adhoc", label: "Ad hoc", url: "https://example.test/a.geojson" };

        await expect(api.create(def)).resolves.toEqual({
            id: "adhoc",
            label: "Ad hoc",
            featureCount: 2,
        });
        expect(spy).toHaveBeenCalledWith(def);
    });

    it("refuses a definition whose id is already a layer, naming setData", async () => {
        seedLayer("L1", { current: true, logicalState: true });
        await expect(
            api.create({ id: "L1", url: "https://example.test/a.geojson" })
        ).rejects.toThrow(/setData/);
    });

    it("refuses a definition with no id", async () => {
        // The missing `id` is the point of this case, so the cast is what lets the
        // refusal be exercised at all — the type already forbids the call.
        await expect(
            api.create({ url: "https://example.test/a.geojson" } as unknown as LayerDefinition)
        ).rejects.toThrow(/id/);
    });
});

// A layer that renders on the map but has no row in the layer manager is the
// silent half of this seam: nothing errors, the features are there, and the user
// simply cannot toggle it. The profile loader registers its batch once it lands,
// so a layer created here must be registered too — otherwise `create` differs
// from the path it claims to reuse, invisibly.
describe("create — the layer reaches the layer manager, not only the map", () => {
    it("registers the loaded layer with the layer manager", async () => {
        const registerWithLayerManager = vi.fn();
        g.GeoLeaf.LayerManager = { _registerGeoJsonLayer: vi.fn() };
        profileLoader.setupProfileDeps({
            getConfig: () => ({ getActiveProfile: () => ({ id: "p1" }) }),
            getLayerManager: () => ({ registerWithLayerManager }),
            getLoader: () => ({
                _loadSingleLayer: vi.fn(async () => ({
                    id: "adhoc",
                    label: "Ad hoc",
                    featureCount: 1,
                })),
            }),
            setAllLayerConfigs: vi.fn(),
        } as unknown as Parameters<typeof profileLoader.setupProfileDeps>[0]);

        await api.create({ id: "adhoc", label: "Ad hoc", url: "https://example.test/a.geojson" });
        expect(registerWithLayerManager).toHaveBeenCalledTimes(1);
    });

    it("does not register when the definition yielded no layer", async () => {
        const registerWithLayerManager = vi.fn();
        profileLoader.setupProfileDeps({
            getConfig: () => ({ getActiveProfile: () => ({ id: "p1" }) }),
            getLayerManager: () => ({ registerWithLayerManager }),
            getLoader: () => ({ _loadSingleLayer: vi.fn() }),
            setAllLayerConfigs: vi.fn(),
        } as unknown as Parameters<typeof profileLoader.setupProfileDeps>[0]);

        // No `url`, no `dataFile`, no `data` block: the loader skips it and logs why.
        await expect(api.create({ id: "sans-source" })).resolves.toBeNull();
        expect(registerWithLayerManager).not.toHaveBeenCalled();
    });
});
