/**
 * Unit tests — `LayerDefinition.inlineData`: a layer whose data the CALLER supplies,
 * instead of a URL for the loader to resolve.
 *
 * The profile loader resolved a URL before anything else and discarded every
 * descriptor without `url` or `dataFile` — in `return null`, without throwing, so
 * neither a synchronous `try/catch` nor a `.catch` on the promise saw it. A host
 * creating shell layers and filling them itself therefore got a silently empty map.
 *
 * ⚠️ **What is asserted here is a RELAXATION, so the counter-proof carries as much
 * weight as the feature**: `still discards a descriptor with no source at all`
 * exists because a guard widened until it accepts everything is indistinguishable,
 * from the passing side, from a guard that works.
 *
 * 📌 The loading path itself is NOT new — `_loadSingleLayer` already serves a
 * caller-supplied payload without touching the network, and deferred theme layers
 * already use it. These tests pin the seam between the public key and that path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LayerDefinition } from "../../src/contracts/layer-data.contract.js";

const profileLoader = await import("../../src/kernel/geojson/loader/profile.ts");
const { GeoJSONShared } = await import("../../src/kernel/geojson/shared.ts");

/** The normalized definition `_loadSingleLayer` receives, as these tests read it. */
type NormalizedDef = Record<string, unknown>;

let loadSingleLayer: ReturnType<typeof vi.fn>;
let registerWithLayerManager: ReturnType<typeof vi.fn>;

/** The definition as it reached the loader, or `undefined` when it was discarded. */
function defReceived(): NormalizedDef | undefined {
    return loadSingleLayer.mock.calls[0]?.[2] as NormalizedDef | undefined;
}

beforeEach(() => {
    GeoJSONShared.reset();
    loadSingleLayer = vi.fn(
        (layerId: string, layerLabel: string): Promise<{ id: string; label: string }> =>
            Promise.resolve({ id: layerId, label: layerLabel })
    );
    registerWithLayerManager = vi.fn();
    // Only the three members this path touches — cast at the boundary rather than
    // stubbing the full locator, which would say nothing more and drift with it.
    profileLoader.setupProfileDeps({
        getConfig: () => ({ getActiveProfile: () => ({ id: "test-profile" }) }),
        getLoader: () => ({ _loadSingleLayer: loadSingleLayer }),
        getLayerManager: () => ({ registerWithLayerManager }),
    } as unknown as Parameters<typeof profileLoader.setupProfileDeps>[0]);
});

describe("inlineData — a payload standing in for a URL", () => {
    it("loads a layer that declares inlineData and no url", async () => {
        const payload = {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: null, properties: { n: 1 } }],
        };

        const loaded = await profileLoader.loadLayerDefinition({
            id: "shell",
            inlineData: payload,
        } as LayerDefinition);

        expect(loadSingleLayer).toHaveBeenCalledTimes(1);
        expect(loaded).not.toBeNull();
        expect(defReceived()?._cachedData).toBe(payload);
    });

    it("hands the payload over to the loader's internal key rather than alongside it", async () => {
        // Both halves matter. `_cachedData` is what the existing path reads; the
        // absence of `inlineData` is what keeps a full collection from being
        // retained on the stored definition, since only the internal copy is
        // deleted after conversion.
        await profileLoader.loadLayerDefinition({
            id: "shell",
            inlineData: { type: "FeatureCollection", features: [] },
        } as LayerDefinition);

        const def = defReceived();
        expect(def).toHaveProperty("_cachedData");
        expect(def).not.toHaveProperty("inlineData");
    });

    it("registers the layer with the layer manager, as a profile-declared layer is", async () => {
        // A layer that paints but has no row in the manager cannot be toggled, and
        // nothing fails or logs — the defect is visible only to whoever looks for
        // the row. The criterion is indistinguishability from a profile layer.
        await profileLoader.loadLayerDefinition({
            id: "shell",
            inlineData: { type: "FeatureCollection", features: [] },
        } as LayerDefinition);

        expect(registerWithLayerManager).toHaveBeenCalledTimes(1);
    });

    it("still discards a descriptor with no source at all — the guard was relaxed, not removed", async () => {
        const loaded = await profileLoader.loadLayerDefinition({
            id: "sourceless",
        } as LayerDefinition);

        expect(loaded).toBeNull();
        expect(loadSingleLayer).not.toHaveBeenCalled();
        expect(registerWithLayerManager).not.toHaveBeenCalled();
    });

    it("leaves the url path untouched — no payload key appears on a url layer", async () => {
        await profileLoader.loadLayerDefinition({
            id: "remote",
            url: "https://example.test/a.geojson",
        } as LayerDefinition);

        const def = defReceived();
        expect(def?.url).toBe("https://example.test/a.geojson");
        expect(def).not.toHaveProperty("_cachedData");
    });
});
