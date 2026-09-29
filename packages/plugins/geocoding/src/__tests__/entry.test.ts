/**
 * @geoleaf-plugins/geocoding — smoke test
 * Confirms the public API builds and mounts. Replace with real coverage.
 */
import { describe, it, expect, vi } from "vitest";
import { buildPublicApi } from "../public-api.js";

describe("@geoleaf-plugins/geocoding public API", () => {
    it("builds an object with the documented surface", () => {
        const api = buildPublicApi();
        expect(typeof api).toBe("object");
        expect(typeof api.open).toBe("function");
    });
});

describe("@geoleaf-plugins/geocoding entry — lifecycle", () => {
    it("🛑 se démonte avec l'application : le destroy() de son module retire le contrôle", async () => {
        // Measured by the `71-mount-remount` E2E: the search bar stayed on the page after
        // `GeoLeaf.mount(…).unmount()`. Its teardown existed (`GeocodingRegistry.destroy`);
        // nothing called it.
        vi.resetModules();
        const { GeocodingRegistry } = await import("../registry.js");
        const destroy = vi.spyOn(GeocodingRegistry, "destroy");
        const register = vi.fn();
        const host = globalThis as { GeoLeaf?: unknown };
        const previous = host.GeoLeaf;
        host.GeoLeaf = {
            plugins: { register: vi.fn() },
            registry: { register, isInitialized: () => false },
            I18n: { registerDict: vi.fn() },
        };
        try {
            await import("../entry.js");
            const module = register.mock.calls
                .map(([m]) => m as { id: string; init?: () => void; destroy?: () => void })
                .find((m) => m.id === "geocoding");
            expect(typeof module?.init, "the slot carries no lifecycle").toBe("function");
            module?.destroy?.();
            expect(destroy).toHaveBeenCalledTimes(1);
        } finally {
            host.GeoLeaf = previous;
        }
    });
});
