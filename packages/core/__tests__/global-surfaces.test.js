/**
 * Unit tests — the three `GeoLeaf.*` surfaces `global.d.ts` gained.
 *
 * `gl.Sync`, `gl.ThemeSelector` and `gl._VectorTiles` were reachable, mounted at boot
 * and (for Sync) consumed by a shipped plugin, yet appeared in NO type file: they fell
 * into the `[key: string]: unknown` tail of `GeoLeafGlobal`, so every consumer either
 * cast or wrote its own local view — `_VectorTiles` had TWO such views, and they were
 * disjoint (`loader-types.ts` vs `layer-manager/style.ts`).
 *
 * The declaration itself is checked by `tsc` (mutating a member's type now fails the
 * build — before B.25 the `as unknown as typeof _gl.Sync` in `geoleaf.sync.ts` asserted
 * nothing). What `tsc` CANNOT catch is the declaration drifting away from the object
 * actually mounted: a renamed method would leave `global.d.ts` describing a surface that
 * no longer exists, and the whole point of typing a runtime global is that the type is
 * not fiction. These tests pin the mounted objects against the declared members.
 */
import { describe, expect, it } from "vitest";

const { Sync } = await import("../src/api/geoleaf.sync.ts");
const { THEME_SELECTOR_INSTALLER } = await import("../src/capabilities/theme-selector/install.ts");
const { VECTOR_TILES_INSTALLER } = await import("../src/capabilities/vector-tiles/install.ts");
const { SyncHandlerContract } = await import("../src/kernel/shared/sync-handler-seam.ts");

/** Members `global.d.ts` declares on each surface — keep in sync with the interface. */
const DECLARED = {
    Sync: ["registerHandler", "getHandler"],
    // GeoLeafThemeSelector (promoted from permalink-types.ts).
    ThemeSelector: ["getCurrentTheme", "setTheme"],
    // Typed as the capability's own export, the only shape covering BOTH kernel views.
    _VectorTiles: ["shouldUseVectorTiles", "loadVectorTileLayer", "updateLayerStyle"],
};

describe("GeoLeaf.Sync — public API of fact, now declared", () => {
    it("self-mounts on the global namespace at import (pre-boot plugin registration)", () => {
        // A data plugin registers at its own eval, before core boot completes.
        expect(globalThis.GeoLeaf?.Sync).toBe(Sync);
    });

    it("carries every member global.d.ts declares", () => {
        for (const member of DECLARED.Sync) {
            expect(typeof globalThis.GeoLeaf.Sync[member]).toBe("function");
        }
    });

    it("round-trips a handler through the declared surface", () => {
        SyncHandlerContract._reset();
        const handler = { processSyncQueue: async () => ({ synced: 1 }) };
        globalThis.GeoLeaf.Sync.registerHandler("poi", handler);
        expect(globalThis.GeoLeaf.Sync.getHandler("poi")).toBe(handler);
        SyncHandlerContract._reset();
    });
});

describe("GeoLeaf.ThemeSelector / GeoLeaf._VectorTiles — declared members exist", () => {
    it.each([
        ["ThemeSelector", THEME_SELECTOR_INSTALLER],
        ["_VectorTiles", VECTOR_TILES_INSTALLER],
    ])("%s — the installer mounts an object carrying every declared member", (key, installer) => {
        const gl = {};
        installer.registerGlobals(gl);
        expect(gl[key]).toBeTypeOf("object");
        for (const member of DECLARED[key]) {
            expect(typeof gl[key][member]).toBe("function");
        }
    });

    it("ThemeSelector.getCurrentTheme returns null before a theme is applied", () => {
        // The reason the promoted type widened to `string | null | undefined`: the view
        // that used to live in permalink-types.ts said `string | undefined`, while
        // `_state.currentTheme` starts at `null` (theme-selector-state.ts).
        const gl = {};
        THEME_SELECTOR_INSTALLER.registerGlobals(gl);
        expect(gl.ThemeSelector.getCurrentTheme()).toBeNull();
    });
});
