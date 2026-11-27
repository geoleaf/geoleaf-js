/**
 * `modules.table.enabled: false` withholds the slot — the predicate the kernel reads at render.
 * The click on a slot offered under `enabled: false` loaded the plugin and opened nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const g = globalThis as { GeoLeaf?: unknown };

afterEach(() => {
    delete g.GeoLeaf;
    vi.resetModules();
});

/** Loads the entry before the boot and returns the slot's predicate. */
async function predicate(values: Record<string, unknown>): Promise<() => boolean> {
    const register = vi.fn();
    g.GeoLeaf = {
        registry: { register, isInitialized: () => false },
        mount: () => undefined,
        Config: { get: (k: string, d?: unknown) => (k in values ? values[k] : d) },
        plugins: { register: vi.fn() },
        I18n: { registerDict: vi.fn() },
    };
    await import("../entry.js");
    const module = register.mock.calls.map(([m]) => m).find((m) => m.id === "table");
    return module.ui.isAvailable;
}

describe("table — the slot follows `enabled`", () => {
    it("is withheld by an explicit `enabled: false`, offered otherwise", async () => {
        expect((await predicate({ "modules.table.enabled": false }))()).toBe(false);
        vi.resetModules();
        expect((await predicate({}))()).toBe(true);
    });
});
