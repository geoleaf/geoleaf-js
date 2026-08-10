/**
 * Unit tests — capabilities/filter/config.ts + public-api.ts (S5, F0).
 *
 * The config reader merges `modules.filter.*` over the built-in defaults
 * (`enabled: true`, opt-out); the thin public API (`isEnabled`/`getConfig`) wraps it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

const { getFilterConfig } = await import("../../../src/capabilities/filter/config.ts");
const { buildPublicApi } = await import("../../../src/capabilities/filter/public-api.ts");

afterEach(() => configGet.mockReset());

describe("getFilterConfig", () => {
    it("defaults to enabled:true when modules.filter is absent (opt-out)", () => {
        configGet.mockReturnValue({});
        expect(getFilterConfig().enabled).toBe(true);
    });
    it("merges the profile block over the defaults", () => {
        configGet.mockReturnValue({ title: "Filtrer", fields: [{ id: "cat", kind: "taxonomy" }] });
        const cfg = getFilterConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.title).toBe("Filtrer");
        expect(cfg.fields).toHaveLength(1);
        expect(cfg.fields[0].kind).toBe("taxonomy");
    });
    it("respects an explicit enabled:false", () => {
        configGet.mockReturnValue({ enabled: false });
        expect(getFilterConfig().enabled).toBe(false);
    });
    it("reads the 'modules.filter' path", () => {
        configGet.mockReturnValue({});
        getFilterConfig();
        expect(configGet).toHaveBeenCalledWith("modules.filter", {});
    });
});

describe("buildPublicApi (GeoLeaf.Filter)", () => {
    it("isEnabled() — true when absent (opt-out) and when explicitly true", () => {
        const api = buildPublicApi();
        configGet.mockReturnValue({});
        expect(api.isEnabled()).toBe(true);
        configGet.mockReturnValue({ enabled: true });
        expect(api.isEnabled()).toBe(true);
    });
    it("isEnabled() — false only when explicitly disabled", () => {
        const api = buildPublicApi();
        configGet.mockReturnValue({ enabled: false });
        expect(api.isEnabled()).toBe(false);
    });
    it("getConfig() returns the merged config", () => {
        const api = buildPublicApi();
        configGet.mockReturnValue({ title: "Filtrer" });
        expect(api.getConfig()).toMatchObject({ enabled: true, title: "Filtrer" });
    });
});
