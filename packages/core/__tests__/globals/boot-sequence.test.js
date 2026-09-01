/**
 *
 * T4.5 — globals.ts orchestrator coverage
 *
 * Targets:
 *   - globals.ts (0% → covered): the B1→B11 import chain and _g export
 *   - Pre-existing GeoLeaf namespace guard at orchestrator level
 *   - _g export resolves to globalThis in jsdom environment
 *
 * Strategy: mock all 7 sub-global side-effect imports as no-ops so that
 * globals.ts itself is exercised in isolation, without re-running the
 * already-covered sub-module logic.
 */

// Stub all sub-global side-effect imports
vi.mock("../../src/globals/globals.core.js", () => ({}));
vi.mock("../../src/globals/globals.config.js", () => ({}));
vi.mock("../../src/globals/globals.geojson.js", () => ({}));
vi.mock("../../src/globals/globals.ui.js", () => ({}));
vi.mock("../../src/globals/globals.storage.js", () => ({}));
// 🛑 `globals.poi.js` IS NO LONGER MOCKED: the file no longer exists. The
// POI module was dissolved and its global vanished with it; neutralising it
// amounted to neutralising a path nothing takes. A mock aimed at an absent
// file does not fail the suite — it merely makes it longer and falser to
// read, and it survives indefinitely because nothing rereads a passing mock
// list. ⚠️ The four neighbours above all aim at a LIVE file: checked, it is
// not the whole list that drifted, it is one entry.
vi.mock("../../src/globals/globals.api.js", () => ({}));

describe("globals.ts — orchestrator boot-sequence", () => {
    let _g;

    beforeAll(async () => {
        const mod = await import("../../src/globals/globals.js");
        _g = mod._g;
    });

    it("exports _g", () => {
        expect(_g).toBeDefined();
    });

    it("_g is globalThis in jsdom environment", () => {
        expect(_g).toBe(globalThis);
    });

    it("_g is the same object as window in jsdom", () => {
        expect(_g).toBe(window);
    });

    it("does not wipe a pre-existing GeoLeaf namespace", async () => {
        // Simulate a pre-existing value — since sub-globals are mocked as no-ops,
        // any value set before require persists after the module loads.
        const sentinel = { _guard: true };
        globalThis.GeoLeaf = sentinel;

        vi.resetModules();

        // Re-stub after resetModules
        vi.mock("../../src/globals/globals.core.js", () => ({}));
        vi.mock("../../src/globals/globals.config.js", () => ({}));
        vi.mock("../../src/globals/globals.geojson.js", () => ({}));
        vi.mock("../../src/globals/globals.ui.js", () => ({}));
        vi.mock("../../src/globals/globals.storage.js", () => ({}));
        // Second site of the same dead mock — see the motive at the top of
        // the file. The register entry only cited ONE: purging that one
        // alone would have left the line half settled with nothing saying so.
        vi.mock("../../src/globals/globals.api.js", () => ({}));

        await import("../../src/globals/globals.js");

        // globals.ts itself does not assign GeoLeaf — only sub-globals do (mocked as no-ops)
        // The sentinel must be untouched
        expect(globalThis.GeoLeaf).toBe(sentinel);
    });

    it("exported _g.GeoLeaf sentinel is still intact after re-require", () => {
        expect(globalThis.GeoLeaf).toBeDefined();
        expect(globalThis.GeoLeaf._guard).toBe(true);
    });
});
