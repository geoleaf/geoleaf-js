/**
 * Unit tests — `capabilities/offline/offline-engine-entry.ts` (racine de composition, à 0 %).
 *
 * Seul module qui assemble statiquement le moteur offline (chargé via le loader dynamique de
 * la capacité). À l'évaluation, s'il trouve `GeoLeaf.Storage`, il y injecte le moteur
 * (`wireModules`) et enregistre la restauration POI. On le charge dynamiquement après avoir
 * préparé (ou non) la façade.
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
            // registerPoiRestore lit la surface Layers ; un stub neutre suffit.
            Layers: { onLayerAdded: vi.fn() },
        };

        await import("../../../src/capabilities/offline/offline-engine-entry.js");

        expect(wireModules).toHaveBeenCalledTimes(1);
        const wired = wireModules.mock.calls[0][0];
        expect(wired.db).toBeTruthy();
        expect(wired.cacheManager).toBeTruthy();
        expect(wired.cache?.Storage).toBeTruthy();
        // Tâche 4.1 — sans cette ligne, « le rapatriement est injecté » resterait AFFIRMÉ :
        // les trois assertions ci-dessus passent parfaitement avec `pull` absent.
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
