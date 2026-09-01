/**
 * Unit tests — `entry.ts` (coverage, file at 0%).
 *
 * Side-effect module: mounts `GeoLeaf.FileImport` (convert/importAsLayer/…)
 * and registers the plugin. Loaded dynamically (`vi.resetModules()`) after
 * preparing the global namespace.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";

type Register = (id: string, meta: Record<string, unknown>) => void;
interface GlobalShape {
    GeoLeaf?: {
        plugins?: { register?: Register };
        FileImport?: Record<string, unknown>;
    };
}
const g = globalThis as unknown as GlobalShape;

beforeEach(() => {
    vi.resetModules();
    g.GeoLeaf = undefined;
});

describe("file-import entry.ts", () => {
    test("monte GeoLeaf.FileImport avec ses 4 méthodes et enregistre le plugin", async () => {
        const register = vi.fn();
        g.GeoLeaf = { plugins: { register } };

        await import("../entry.js");

        const FI = g.GeoLeaf.FileImport;
        expect(FI).toBeTruthy();
        expect(typeof FI!.convert).toBe("function");
        expect(typeof FI!.importAsLayer).toBe("function");
        expect(typeof FI!.getSupportedFormats).toBe("function");
        expect(typeof FI!.registerConverter).toBe("function");
        expect(register).toHaveBeenCalledWith(
            "file-import",
            expect.objectContaining({ label: expect.any(String) })
        );
        const meta = register.mock.calls[0][1] as { healthCheck: () => boolean };
        expect(meta.healthCheck()).toBe(true);
    });

    test("sans plugins.register → monte quand même l'API", async () => {
        g.GeoLeaf = {};
        await import("../entry.js");
        expect(g.GeoLeaf.FileImport).toBeTruthy();
    });

    test("sans GeoLeaf → se charge sans jeter", async () => {
        g.GeoLeaf = undefined;
        await expect(import("../entry.js")).resolves.toBeDefined();
    });
});
