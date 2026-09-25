/**
 * `Config.set` keeps what it is given, even when nothing has read the configuration yet.
 *
 * `get`, `getAll` and `getModuleConfig` all start with the same guard: if no configuration has
 * been loaded, they wire the store first (`_initSubModules`). `set` had no such guard. Before
 * the store was wired, `ConfigStore.set` logged « Configuration non initialisée » and dropped
 * the value.
 *
 * The page never hit this for one accidental reason. A label resolved at import time called
 * `Config.get`, and that call wired the store as a side effect. With labels no longer resolved
 * at import, the store is not wired until something reads it. A host following the natural
 * order (import the bundle, `Config.set(…)`, then `boot()`) would then lose its values in
 * silence.
 *
 * The precedence pinned by the last case is the existing contract, stated in `set`'s TSDoc. An
 * application configuration loaded afterwards merges OVER a value set before it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/log/index.js", () => ({
    Log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), setLevel: vi.fn() },
}));

/**
 * A fresh, fully wired `Config` singleton, which nothing has read yet: the bare singleton plus
 * the side-effect siblings that graft its members, in the order `globals.config.ts` loads them.
 */
async function freshConfig() {
    vi.resetModules();
    const { Config } = await import("../../src/kernel/config/geoleaf-config/config-core.js");
    await import("../../src/kernel/config/geoleaf-config/config-loaders.js");
    await import("../../src/kernel/config/geoleaf-config/config-accessors.js");
    await import("../../src/kernel/config/geoleaf-config/config-validation.js");
    return Config;
}

beforeEach(() => {
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {};
});

describe("Config.set before any read", () => {
    it("keeps the value", async () => {
        const Config = await freshConfig();
        Config.set("ui.language", "en");
        expect(Config.get("ui.language")).toBe("en");
    });

    it("the value survives an application configuration that does not declare it", async () => {
        const Config = await freshConfig();
        Config.set("ui.language", "en");
        await Config.init({ config: { map: { zoom: 5 } } });
        expect(Config.get("ui.language")).toBe("en");
        expect(Config.get("map.zoom")).toBe(5);
    });

    it("an application configuration that DOES declare it wins — the documented precedence", async () => {
        const Config = await freshConfig();
        Config.set("ui.language", "en");
        await Config.init({ config: { ui: { language: "fr" } } });
        expect(Config.get("ui.language")).toBe("fr");
    });
});
