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

    it("🛑 chargé APRÈS le boot, il inscrit encore son démontage — sans son créneau", async () => {
        // Measured by `scripts/probe-remount-plugins.mjs`: evaluated once the application ran,
        // the plugin registered nothing, and its control was still in the page after
        // `unmount()`. The slot stays out: the toolbar is built, and the button belongs to the
        // lazy declaration that drew it.
        vi.resetModules();
        const { GeocodingRegistry } = await import("../registry.js");
        const destroy = vi.spyOn(GeocodingRegistry, "destroy");
        const register = vi.fn();
        const host = globalThis as { GeoLeaf?: unknown };
        const previous = host.GeoLeaf;
        host.GeoLeaf = {
            plugins: { register: vi.fn() },
            registry: { register, isInitialized: () => true },
            mount: () => undefined,
            I18n: { registerDict: vi.fn() },
        };
        try {
            await import("../entry.js");
            expect(register).toHaveBeenCalledTimes(1);
            const module = register.mock.calls[0]![0] as { id: string; destroy: () => void };
            expect(module.id).toBe("geocoding");
            expect("ui" in module).toBe(false);
            module.destroy();
            expect(destroy).toHaveBeenCalledTimes(1);
        } finally {
            host.GeoLeaf = previous;
        }
    });

    it("avant le boot, le module porte aussi le créneau de barre", async () => {
        vi.resetModules();
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
            const module = register.mock.calls[0]![0] as { ui?: Record<string, unknown> };
            expect(Object.keys(module.ui ?? {})).toEqual(["mobileIcon"]);
        } finally {
            host.GeoLeaf = previous;
        }
    });
});
