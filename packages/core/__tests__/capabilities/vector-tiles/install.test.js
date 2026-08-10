/**
 * Unit tests — the `vector-tiles` capability installer (presets build, S5).
 *
 * VectorTiles was the last kernel→capability static edge left after S4: `globals.geojson.ts`
 * (KERNEL) imported it directly, which pinned 744 lines of MVT machinery into the eager closure
 * of every bundle — including one composed by a consumer who serves nothing but plain GeoJSON.
 *
 * What these tests lock:
 *   - the declaration is gate-less on purpose (activation is per-layer, `data.vectorTiles`) ;
 *   - it owns NO ICoreModule (policy capability, like `cluster`) — the registry stays at 22 ;
 *   - `registerGlobals` is what writes `_VectorTiles`, and it is additive.
 *
 * Loaded via ESM `await import()` — never `require(".ts")`, which creates a second, non-merged
 * V8 instance under forks + tsx + V8 coverage.
 */

import { describe, expect, it } from "vitest";

const install = await import("../../../src/capabilities/vector-tiles/install.ts");
const capability = await import(
    "../../../src/capabilities/vector-tiles/vector-tiles-capability.ts"
);
const vectorTiles = await import("../../../src/capabilities/vector-tiles/vector-tiles.ts");

const { VECTOR_TILES_INSTALLER } = install;
const { VECTOR_TILES_CAPABILITY } = capability;
const { VectorTiles } = vectorTiles;

describe("vector-tiles installer (capabilities/vector-tiles/install)", () => {
    it("exposes its capability declaration", () => {
        expect(VECTOR_TILES_INSTALLER.declaration).toBe(VECTOR_TILES_CAPABILITY);
        expect(VECTOR_TILES_INSTALLER.declaration.id).toBe("vector-tiles");
    });

    it("declares NO config gate (activation is per-layer, via data.vectorTiles.tilesUrl)", () => {
        // A `modules.vectorTiles.enabled` key would be a public parameter gating nothing the
        // layer config does not already gate. The contract allows a gate-less declaration:
        // "No gate → always enabled".
        expect(VECTOR_TILES_CAPABILITY.gate).toBeUndefined();
    });

    it("declares no createModule (policy capability — registry stays at 22 modules)", () => {
        expect(VECTOR_TILES_INSTALLER.createModule).toBeUndefined();
    });

    it("declares no sharedLifecycle (nothing to run pre-map)", () => {
        expect(VECTOR_TILES_INSTALLER.sharedLifecycle).toBeUndefined();
    });

    it("registerGlobals assigns GeoLeaf._VectorTiles (ex-globals.geojson.ts) and is additive", () => {
        const gl = { existing: 1 };
        VECTOR_TILES_INSTALLER.registerGlobals(gl);
        expect(gl._VectorTiles).toBe(VectorTiles);
        expect(gl.existing).toBe(1);
    });

    it("registerGlobals is idempotent", () => {
        const gl = {};
        VECTOR_TILES_INSTALLER.registerGlobals(gl);
        VECTOR_TILES_INSTALLER.registerGlobals(gl);
        expect(gl._VectorTiles).toBe(VectorTiles);
    });
});
