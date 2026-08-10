/**
 * Unit tests — capabilities/legend/config.ts (S10 F2 — in-core capability).
 *
 * The config reader merges `modules.legend.*` over the built-in defaults
 * (`enabled: true`, opt-out ; `position`/`collapsedByDefault`/`title` reproduce the
 * former hardcoded control options). The opt-out gate is read off the same accessor
 * (B.29 — the `isLegendEnabled()` alias is resorbed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { configGet } = vi.hoisted(() => ({ configGet: vi.fn() }));

vi.mock("../../../src/kernel/config/config-primitives.js", () => ({
    Config: { get: (...a) => configGet(...a) },
}));

const legendConfig = await import("../../../src/capabilities/legend/config.ts");
const { getLegendConfig } = legendConfig;

afterEach(() => configGet.mockReset());

describe("getLegendConfig", () => {
    it("defaults when modules.legend is absent (opt-out, hardcoded-parity)", () => {
        configGet.mockReturnValue({});
        // B.24/B.38 — `title` used to be pinned to the ENGLISH literal "Legend", which is
        // what this assertion froze. It now comes from `ui.legend.title`; with i18n not
        // initialised the dictionary falls back to fr, hence "Légende". Same force
        // (exact toEqual on the whole object), new contract — see legend-title-i18n.test.js
        // for the localisation itself and for the profile-override precedence.
        expect(getLegendConfig()).toEqual({
            enabled: true,
            position: "bottomleft",
            collapsedByDefault: false,
            title: "Légende",
        });
    });

    it("merges the profile block over the defaults (config réveillée — option B)", () => {
        configGet.mockReturnValue({
            title: "Légende",
            collapsedByDefault: true,
            position: "topright",
        });
        const cfg = getLegendConfig();
        expect(cfg.enabled).toBe(true);
        expect(cfg.title).toBe("Légende");
        expect(cfg.collapsedByDefault).toBe(true);
        expect(cfg.position).toBe("topright");
    });

    it("respects an explicit enabled:false", () => {
        configGet.mockReturnValue({ enabled: false });
        expect(getLegendConfig().enabled).toBe(false);
    });

    it("reads the 'modules.legend' path", () => {
        configGet.mockReturnValue({});
        getLegendConfig();
        expect(configGet).toHaveBeenCalledWith("modules.legend", {});
    });
});

/**
 * B.29 — the opt-out gate used to have a named accessor of its own,
 * `isLegendEnabled()`. It is resorbed into `getLegendConfig().enabled !== false`,
 * the spelling every sibling capability's late gate already uses. The three
 * assertions below are the former ones, unchanged, re-expressed on the surviving
 * accessor: the gate's truth table is still pinned key by key.
 */
describe("the opt-out gate (ex-isLegendEnabled)", () => {
    it("true when absent (opt-out) and when explicitly true", () => {
        configGet.mockReturnValue({});
        expect(getLegendConfig().enabled !== false).toBe(true);
        configGet.mockReturnValue({ enabled: true });
        expect(getLegendConfig().enabled !== false).toBe(true);
    });

    it("false only when explicitly disabled", () => {
        configGet.mockReturnValue({ enabled: false });
        expect(getLegendConfig().enabled !== false).toBe(false);
    });

    it("the capability exports exactly one config accessor", () => {
        // The anomaly B.29 closed: legend was the only capability whose config.ts
        // exported a second, boolean accessor. Re-adding one fails here.
        expect(Object.keys(legendConfig).sort()).toEqual(["getLegendConfig"]);
    });
});
