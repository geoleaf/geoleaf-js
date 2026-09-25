/**
 * An entry of `layers.json` that points to a `configFile` overrides that config's `label`.
 *
 * `layers.schema.json` has always promised it: "Optional display label override (otherwise read
 * from the layer config)". The loader did not keep that promise. It built each layer from its
 * config file plus the entry's `layerManagerId`, and dropped the entry's `label`. The inventory
 * still listed the key as consumed, because a reader of `layer.label` exists — but that reader
 * only ever saw the config's value.
 *
 * An entry WITHOUT `configFile` is the layer itself (the loader returns it as-is), so its `label`
 * was always read. Both shapes are pinned here, on both loading paths: the bundle, which is the
 * production path, and the HTTP cascade, which is its fallback.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { ProfileLoader } = await import("../../src/kernel/config/profile-loader.ts");
const { ConfigLoader } = await import("../../src/kernel/config/loader.ts");

/** Three shapes: an override, no override, and an inline entry with no config file. */
const INDEX = {
    layers: [
        { id: "a", configFile: "layers/a/a_config.json", label: "From the index" },
        { id: "b", configFile: "layers/b/b_config.json" },
        { id: "c", label: "Inline", geometry: "point" },
    ],
};

const CONFIGS: Record<string, Record<string, unknown>> = {
    a: { id: "a", label: "From the config", geometry: "point" },
    b: { id: "b", label: "B from the config", geometry: "point" },
};

const profile = { id: "fixture", Files: {} };

/** The label of each enriched layer, by id. */
function labels(enriched: Record<string, unknown>): Record<string, unknown> {
    const layers = enriched.layers as { id: string; label?: unknown }[];
    return Object.fromEntries(layers.map((l) => [l.id, l.label]));
}

const EXPECTED = { a: "From the index", b: "B from the config", c: "Inline" };

afterEach(() => vi.restoreAllMocks());

describe("layers.json — an entry's label overrides its config's", () => {
    it("on the bundle path", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const enriched = ProfileLoader._processBundle(
            { _profileId: "fixture", layersFile: INDEX, layerConfigs: CONFIGS },
            profile,
            "/profiles/fixture",
            "fixture"
        );
        expect(labels(enriched)).toEqual(EXPECTED);
    });

    it("on the HTTP cascade", async () => {
        vi.spyOn(ConfigLoader, "fetchJson").mockImplementation(async (url: string) => {
            const id = /layers\/(\w+)\//.exec(url)?.[1] ?? "";
            const config = CONFIGS[id];
            return config ? structuredClone(config) : null;
        });
        const results = await ProfileLoader._loadLayerConfigs(INDEX.layers, "/p", 0, {});
        const enriched = ProfileLoader._buildEnrichedProfile({
            profile,
            baseUrl: "/p",
            profileId: "fixture",
            themes: null,
            mapping: null,
            layersSource: INDEX.layers,
            layersConfigs: results,
        } as never);
        expect(labels(enriched)).toEqual(EXPECTED);
    });
});
