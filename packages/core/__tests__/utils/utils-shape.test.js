/**
 * KERNEL S14 — the invariant the convergence installs.
 *
 * `import { Utils } from "@geoleaf/core"` and `window.GeoLeaf.Utils` must describe the
 * SAME surface. Before S14 they did not — 12 keys on the ESM side, 27 on the global —
 * and **nothing in the suite compared them**, so the divergence was free to grow. That
 * is exactly how `escapeHtml` and `wktToGeoJSON` ended up documented on
 * `GeoLeaf.Utils` while being reachable only through a module the bundle never loaded.
 *
 * The two are deliberately DISTINCT objects: the global must stay mutable and
 * re-appliable by the `core-map` module lifecycle. So the guarded invariant is shape
 * equality, not reference equality.
 */

describe("GeoLeaf.Utils — ESM export ↔ runtime global", () => {
    let esmUtils;
    let globalUtils;

    beforeEach(async () => {
        global.GeoLeaf = undefined;
        vi.resetModules();

        const { setupCoreMap } = await import("../../src/globals/globals.core.js");
        setupCoreMap();
        globalUtils = global.GeoLeaf.Utils;

        const { createUtilsNamespace } = await import("../../src/utils/general/utils-namespace.js");
        esmUtils = createUtilsNamespace();
    });

    it("exposes the same enumerable keys on both sides", () => {
        expect(Object.keys(esmUtils).sort()).toEqual(Object.keys(globalUtils).sort());
    });

    it("builds two distinct objects (the global stays re-appliable)", () => {
        expect(esmUtils).not.toBe(globalUtils);
    });

    it("keeps performanceProfiler a NON-enumerable lazy getter on both sides", () => {
        for (const [label, obj] of [
            ["esm", esmUtils],
            ["global", globalUtils],
        ]) {
            const d = Object.getOwnPropertyDescriptor(obj, "performanceProfiler");
            expect(d, `${label}: descriptor missing`).toBeDefined();
            // A getter, not a value: `Object.assign`-style copying would have read it
            // eagerly at boot and destroyed the laziness — silently, since the key
            // would still be present.
            expect(typeof d.get, `${label}: not a getter`).toBe("function");
            expect(d.enumerable, `${label}: became enumerable`).toBe(false);
            expect(Object.keys(obj)).not.toContain("performanceProfiler");
        }
    });

    it("carries wktToGeoJSON, repatriated from the dead assembler at S14", () => {
        expect(typeof esmUtils.wktToGeoJSON).toBe("function");
        expect(typeof globalUtils.wktToGeoJSON).toBe("function");
    });

    it("does NOT carry escapeHtml — Security.escapeHtml is the live equivalent", () => {
        // It was documented on GeoLeaf.Utils but only ever existed on the dead
        // `utils-api.ts` object. Re-adding it here would resurrect a duplicate of
        // `GeoLeaf.Security.escapeHtml`.
        expect(esmUtils.escapeHtml).toBeUndefined();
        expect(globalUtils.escapeHtml).toBeUndefined();
    });
});
