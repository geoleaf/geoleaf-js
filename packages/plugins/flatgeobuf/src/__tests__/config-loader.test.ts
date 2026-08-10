/*!
 * Tests — config-loader.ts
 * Declarative JSON config parser: loadLayerFromConfig.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadLayerFromConfig } from "../config-loader.js";
import type { FgbLayerJsonConfig } from "../config-loader.js";

// ─── Mock public-api ──────────────────────────────────────────────────────────

vi.mock("../public-api.js", () => ({
    loadAsLayer: vi.fn().mockResolvedValue("layer-id"),
    loadBboxAsLayer: vi.fn().mockResolvedValue("layer-id"),
}));

// Import mocks after vi.mock() declaration
import { loadAsLayer, loadBboxAsLayer } from "../public-api.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FgbLayerJsonConfig> = {}): FgbLayerJsonConfig {
    return {
        id: "test-layer",
        plugin: "flatgeobuf",
        data: { url: "https://example.com/data.fgb" },
        ...overrides,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("loadLayerFromConfig", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("routes to loadBboxAsLayer when data.bbox is present", async () => {
        const config = makeConfig({
            data: { url: "https://example.com/data.fgb", bbox: [2.225, 41.362, 8.227, 51.089] },
        });

        await loadLayerFromConfig(config);

        expect(loadBboxAsLayer).toHaveBeenCalledOnce();
        expect(loadAsLayer).not.toHaveBeenCalled();
    });

    it("converts bbox [W, S, E, N] to {minX, minY, maxX, maxY}", async () => {
        const config = makeConfig({
            data: { url: "https://example.com/data.fgb", bbox: [2.225, 41.362, 8.227, 51.089] },
        });

        await loadLayerFromConfig(config);

        expect(loadBboxAsLayer).toHaveBeenCalledWith(
            "https://example.com/data.fgb",
            { minX: 2.225, minY: 41.362, maxX: 8.227, maxY: 51.089 },
            expect.any(Object)
        );
    });

    it("routes to loadAsLayer when data.bbox is absent", async () => {
        const config = makeConfig();

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledOnce();
        expect(loadBboxAsLayer).not.toHaveBeenCalled();
    });

    it("maps data.limit to maxFeatures", async () => {
        const config = makeConfig({ data: { url: "https://example.com/data.fgb", limit: 1000 } });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            "https://example.com/data.fgb",
            expect.objectContaining({ maxFeatures: 1000 })
        );
    });

    it("maps data.autoRefresh and data.debounceMs when bbox is present", async () => {
        const config = makeConfig({
            data: {
                url: "https://example.com/data.fgb",
                bbox: [-5, 41, 10, 51],
                autoRefresh: true,
                debounceMs: 500,
            },
        });

        await loadLayerFromConfig(config);

        expect(loadBboxAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Object),
            expect.objectContaining({ autoRefresh: true, debounceMs: 500 })
        );
    });

    it("defaults autoRefresh to false when absent (bbox path)", async () => {
        const config = makeConfig({
            data: { url: "https://example.com/data.fgb", bbox: [-5, 41, 10, 51] },
        });

        await loadLayerFromConfig(config);

        expect(loadBboxAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Object),
            expect.objectContaining({ autoRefresh: false })
        );
    });

    it("maps defaultVisible to visible in layer options", async () => {
        const config = makeConfig({ defaultVisible: false });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ visible: false })
        );
    });

    it("maps cluster to layer options", async () => {
        const config = makeConfig({ cluster: true });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ cluster: true })
        );
    });

    it("maps label to layerName", async () => {
        const config = makeConfig({ label: "Éco-régions (FlatGeobuf)" });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ layerName: "Éco-régions (FlatGeobuf)" })
        );
    });

    it("maps id to layerId", async () => {
        const config = makeConfig({ id: "eco_regions_fgb" });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ layerId: "eco_regions_fgb" })
        );
    });

    it("forwards geometry and zIndex to layer options (full-file path)", async () => {
        const config = makeConfig({ geometry: "polygon", zIndex: 51 });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ geometry: "polygon", zIndex: 51 })
        );
    });

    it("forwards geometry and zIndex to layer options (bbox path)", async () => {
        const config = makeConfig({
            geometry: "polygon",
            zIndex: 30,
            data: { url: "https://example.com/data.fgb", bbox: [-5, 41, 10, 51] },
        });

        await loadLayerFromConfig(config);

        expect(loadBboxAsLayer).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Object),
            expect.objectContaining({ geometry: "polygon", zIndex: 30 })
        );
    });

    it("resolves a profile-relative data.url against profilesBasePath + _profileId", async () => {
        (globalThis as any).GeoLeaf = {
            Config: { get: () => ({ profilesBasePath: "profiles" }) },
        };
        const config = makeConfig({
            _profileId: "france-rail",
            data: { url: "data/zones.fgb" },
        });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            expect.stringContaining("profiles/france-rail/data/zones.fgb"),
            expect.any(Object)
        );
        (globalThis as any).GeoLeaf = undefined;
    });

    it("leaves an absolute data.url unchanged", async () => {
        const config = makeConfig({
            _profileId: "france-rail",
            data: { url: "https://cdn.example.com/zones.fgb" },
        });

        await loadLayerFromConfig(config);

        expect(loadAsLayer).toHaveBeenCalledWith(
            "https://cdn.example.com/zones.fgb",
            expect.any(Object)
        );
    });

    it("returns the layer ID from the underlying function", async () => {
        vi.mocked(loadAsLayer).mockResolvedValue("returned-layer-id");
        const config = makeConfig();

        const result = await loadLayerFromConfig(config);

        expect(result).toBe("returned-layer-id");
    });
});
