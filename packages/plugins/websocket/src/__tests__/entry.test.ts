/**
 * entry.test.ts — GeoLeaf.Ws entry point side-effects.
 *
 * Verifies that importing entry.ts mounts GeoLeaf.Ws and registers the plugin
 * when GeoLeaf global is present. Uses vi.resetModules() so each test gets a
 * fresh module and clean singleton state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("entry.ts — GeoLeaf global integration", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];
    });

    it("mounts GeoLeaf.Ws when GeoLeaf global is present", async () => {
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register: vi.fn() },
        };

        await import("../entry.js");

        const GeoLeaf = (globalThis as Record<string, unknown>)["GeoLeaf"] as Record<
            string,
            unknown
        >;
        expect(GeoLeaf["Ws"]).toBeDefined();
        expect(typeof (GeoLeaf["Ws"] as Record<string, unknown>)["init"]).toBe("function");
    });

    it("registers the plugin with healthCheck via GeoLeaf.plugins.register", async () => {
        const register = vi.fn();
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register },
        };

        await import("../entry.js");

        expect(register).toHaveBeenCalledWith(
            "websocket",
            expect.objectContaining({
                label: "WebSocket Transport",
                healthCheck: expect.any(Function),
            })
        );
    });

    it("healthCheck returns false when GeoLeaf.Ws state is not connected", async () => {
        const register = vi.fn();
        (globalThis as Record<string, unknown>)["GeoLeaf"] = {
            plugins: { register },
        };

        await import("../entry.js");

        const { healthCheck } = register.mock.calls[0][1] as { healthCheck: () => boolean };
        // Default state is 'disconnected', not 'connected'
        expect(healthCheck()).toBe(false);
    });

    it("does NOT mount GeoLeaf.Ws when GeoLeaf global is absent", async () => {
        // No GeoLeaf global
        delete (globalThis as Record<string, unknown>)["GeoLeaf"];

        await import("../entry.js");

        expect((globalThis as Record<string, unknown>)["GeoLeaf"]).toBeUndefined();
    });
});
