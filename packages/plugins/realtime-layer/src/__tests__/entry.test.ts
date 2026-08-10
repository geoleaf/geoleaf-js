/**
 * Unit tests — `entry.ts` (couverture, fichier à 0 %).
 *
 * Module à effet de bord : monte `GeoLeaf.RealtimeLayer`, enregistre le plugin, et câble
 * l'auto-boot sur `geoleaf:app:ready`. On le charge dynamiquement (`vi.resetModules()`)
 * après avoir préparé le namespace global. `realtime-runtime` est mocké pour isoler l'entrée
 * de l'amorçage réel.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

// Complet par construction (patron B.12) : on garde tous les exports réels de
// realtime-runtime (public-api en importe plusieurs) et on ne remplace que bootFromProfile.
vi.mock("../realtime-runtime.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../realtime-runtime.js")>()),
    bootFromProfile: vi.fn(),
}));

type Register = (id: string, meta: Record<string, unknown>) => void;
interface GlobalShape {
    GeoLeaf?: {
        plugins?: { register?: Register };
        RealtimeLayer?: unknown;
    };
}
const g = globalThis as unknown as GlobalShape;

beforeEach(() => {
    vi.resetModules();
    g.GeoLeaf = undefined;
});

describe("realtime-layer entry.ts", () => {
    test("monte GeoLeaf.RealtimeLayer et enregistre le plugin", async () => {
        const register = vi.fn();
        g.GeoLeaf = { plugins: { register } };

        await import("../entry.js");

        expect(g.GeoLeaf.RealtimeLayer).toBeTruthy();
        expect(register).toHaveBeenCalledWith(
            "realtime-layer",
            expect.objectContaining({ label: expect.any(String), optional: ["websocket"] })
        );
        // healthCheck reflète la présence de la façade
        const meta = register.mock.calls[0][1] as { healthCheck: () => boolean };
        expect(meta.healthCheck()).toBe(true);
    });

    test("auto-boot sur geoleaf:app:ready", async () => {
        const { bootFromProfile } = await import("../realtime-runtime.js");
        g.GeoLeaf = { plugins: { register: vi.fn() } };
        await import("../entry.js");

        document.dispatchEvent(new Event("geoleaf:app:ready"));
        expect(bootFromProfile).toHaveBeenCalled();
    });

    test("sans plugins.register → monte quand même l'API", async () => {
        g.GeoLeaf = {};
        await import("../entry.js");
        expect(g.GeoLeaf.RealtimeLayer).toBeTruthy();
    });

    test("sans GeoLeaf → se charge sans jeter", async () => {
        g.GeoLeaf = undefined;
        await expect(import("../entry.js")).resolves.toBeDefined();
    });
});
