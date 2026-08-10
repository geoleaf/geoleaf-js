/**
 * Unit tests — capabilities/cluster options (revived S3).
 *
 * `applyGeoJSONClusterOptions` ported verbatim from the former
 * adapter-options._applyClusterOptions (default radius 80, max-zoom clamped).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

const { applyGeoJSONClusterOptions } = await import("../../../src/capabilities/cluster/options.ts");

const LOG = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

afterEach(() => configGet.mockReset());

describe("applyGeoJSONClusterOptions (GeoJSON per-layer)", () => {
    it("sets cluster:true + default radius 80 + default max-zoom 14 (min of 14 and source 22-1)", () => {
        const opts = {};
        applyGeoJSONClusterOptions(opts, {}, "L", LOG);
        expect(opts.cluster).toBe(true);
        expect(opts.clusterRadius).toBe(80);
        expect(opts.clusterMaxZoom).toBe(14);
    });
    it("reads def.clusterRadius / def.disableClusteringAtZoom", () => {
        const opts = { maxzoom: 20 };
        applyGeoJSONClusterOptions(
            opts,
            { clusterRadius: 40, disableClusteringAtZoom: 10 },
            "L",
            LOG
        );
        expect(opts.clusterRadius).toBe(40);
        expect(opts.clusterMaxZoom).toBe(10);
    });
    it("clamps clusterMaxZoom to sourceMaxZoom-1", () => {
        const opts = { maxzoom: 8 };
        applyGeoJSONClusterOptions(opts, { disableClusteringAtZoom: 14 }, "L", LOG);
        expect(opts.clusterMaxZoom).toBe(7);
    });
    it("config.clusterRadius / disableClusteringAtZoom feed the defaults when the def is silent (wired S6)", () => {
        configGet.mockImplementation((k, d) =>
            k === "modules.cluster" ? { clusterRadius: 55, disableClusteringAtZoom: 12 } : d
        );
        const opts = { maxzoom: 20 };
        applyGeoJSONClusterOptions(opts, {}, "L", LOG);
        expect(opts.clusterRadius).toBe(55);
        expect(opts.clusterMaxZoom).toBe(12);
    });
    it("per-layer def.clusterRadius overrides config.clusterRadius (precedence: def > config > default)", () => {
        configGet.mockImplementation((k, d) =>
            k === "modules.cluster" ? { clusterRadius: 55 } : d
        );
        const opts = { maxzoom: 20 };
        applyGeoJSONClusterOptions(opts, { clusterRadius: 33 }, "L", LOG);
        expect(opts.clusterRadius).toBe(33);
    });
});
