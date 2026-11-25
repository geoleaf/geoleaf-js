/**
 * `GeoLeaf.getPerformanceMetrics()` and `getRuntimeMetrics()` exist on the shipped bundle.
 *
 * The metrics module mounted them at its own evaluation, `if (GeoLeaf) …`. In the shipped bundle
 * that module sits in the core-utils chunk, evaluated BEFORE the one that creates the namespace:
 * the condition was false, and the two documented members existed in no bundle — the code was
 * there, the mount never happened. Red on the code before the fix: both `undefined`.
 *
 * The test replays the shipped order: the metrics module first, the namespace after.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type Host = { GeoLeaf?: Record<string, unknown> };
const host = globalThis as unknown as Host;

beforeEach(() => {
    vi.resetModules();
    delete host.GeoLeaf;
});

afterEach(() => {
    delete host.GeoLeaf;
});

describe("métriques d'exécution — montées sur le namespace", () => {
    it("le module de métriques évalué AVANT le namespace : les deux fonctions existent", async () => {
        await import("../../src/utils/performance/runtime-metrics.js");
        await import("../../src/app/app-namespace.js");

        expect(typeof host.GeoLeaf?.getPerformanceMetrics).toBe("function");
        expect(typeof host.GeoLeaf?.getRuntimeMetrics).toBe("function");
        const metrics = (host.GeoLeaf?.getRuntimeMetrics as () => Record<string, unknown>)();
        expect(metrics).toHaveProperty("timeToMapReadyMs");
        expect(metrics).toHaveProperty("timeToAppReadyMs");
    });
});
