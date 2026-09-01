/**
 * Unit tests — `capabilities/offline/offline-engine-entry.ts` (composition root, at 0%).
 *
 * The only module statically assembling the offline engine (loaded through
 * the capability's dynamic loader). At evaluation, if it finds
 * `GeoLeaf.Storage`, it injects the engine there (`wireModules`) and
 * registers the POI restoration. Loaded dynamically after preparing (or not)
 * the facade.
 */
import { vi, describe, test, expect, beforeEach } from "vitest";

beforeEach(() => {
    vi.resetModules();
});

describe("offline-engine-entry", () => {
    test("câble db + cacheManager + cache + pull dans GeoLeaf.Storage", async () => {
        const wireModules = vi.fn();
        globalThis.GeoLeaf = {
            Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            Storage: { wireModules },
            // registerPoiRestore reads the Layers surface; a neutral stub suffices.
            Layers: { onLayerAdded: vi.fn() },
        };

        await import("../../../src/capabilities/offline/offline-engine-entry.js");

        expect(wireModules).toHaveBeenCalledTimes(1);
        const wired = wireModules.mock.calls[0][0];
        expect(wired.db).toBeTruthy();
        expect(wired.cacheManager).toBeTruthy();
        expect(wired.cache?.Storage).toBeTruthy();
        // Without this line, "the pull is injected" would stay ASSERTED-ONLY:
        // the three assertions above pass perfectly with `pull` absent.
        expect(typeof wired.pull?.pullLayer).toBe("function");
    });

    test("sans GeoLeaf.Storage → se charge sans câbler ni jeter", async () => {
        globalThis.GeoLeaf = {
            Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };
        await expect(
            import("../../../src/capabilities/offline/offline-engine-entry.js")
        ).resolves.toBeDefined();
    });
});
