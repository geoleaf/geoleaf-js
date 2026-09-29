/**
 * Unit tests — `entry.ts` (coverage, file at 0%).
 *
 * Side-effect module: mounts `GeoLeaf.RealtimeLayer`, registers the plugin,
 * and wires the auto-boot on `geoleaf:app:ready`. Loaded dynamically
 * (`vi.resetModules()`) after preparing the global namespace.
 * `realtime-runtime` is mocked to isolate the entry from real bootstrapping.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

// Complete by construction: we keep all of realtime-runtime's real exports
// (public-api imports several) and only replace bootFromProfile.
vi.mock("../realtime-runtime.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../realtime-runtime.js")>()),
    bootFromProfile: vi.fn(),
}));

type Register = (id: string, meta: Record<string, unknown>) => void;
interface GlobalShape {
    GeoLeaf?: {
        plugins?: { register?: Register };
        registry?: { register: (m: unknown) => void; isInitialized: () => boolean };
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
        // healthCheck reflects the facade's presence
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

    test("🛑 se démonte avec l'application : le destroy() de son module arrête chaque source", async () => {
        // Measured by the `71-mount-remount` E2E: `bootFromProfile` restarts the sources on every
        // `geoleaf:app:ready`, and nothing stopped them at unmount — they were still polling after
        // `GeoLeaf.mount(…).unmount()`, one more `visibilitychange` listener per cycle.
        const runtime = await import("../realtime-runtime.js");
        const stopAll = vi.spyOn(runtime, "stopAll");
        const register = vi.fn();
        g.GeoLeaf = {
            plugins: { register: vi.fn() },
            registry: { register, isInitialized: () => false },
        } as never;
        await import("../entry.js");

        const module = register.mock.calls
            .map(([m]) => m as { id: string; init?: () => void; destroy?: () => void })
            .find((m) => m.id === "realtime-layer");
        expect(module, "no lifecycle module registered").toBeDefined();
        expect(typeof module?.init).toBe("function");
        module?.destroy?.();
        expect(stopAll).toHaveBeenCalledTimes(1);
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
