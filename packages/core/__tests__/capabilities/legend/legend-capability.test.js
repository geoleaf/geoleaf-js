/**
 * Unit tests — legend-capability.ts (S10 F2 — in-core capability).
 *
 * Validates the LEGEND_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection facade. Notably locks the opt-out gate
 * (enableWhenAbsent: true): the boot gate reads the pre-merge baseCfg, so an
 * opt-in (=== true) would silently disable the legend on every profile — the
 * recurring migration pitfall.
 *
 * Branches covered:
 *  - LEGEND_CAPABILITY shape: id, gate, configSchema fields present
 *  - isEnabled() gate with modules.legend.enabled = true/false/absent (opt-out)
 *  - Introspection.getAllCapabilities() returns legend after registration
 *  - Introspection.getCapabilitySchema('legend') returns schema sans loader
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { LEGEND_CAPABILITY } = await import("../../../src/capabilities/legend/legend-capability.ts");
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the legend gate. */
function makeCapConfig(baseCfg) {
    return {
        get: (key, def = undefined) => {
            const parts = key.split(".");
            return parts.reduce((o, k) => o?.[k], baseCfg) ?? def;
        },
    };
}

beforeEach(() => {
    CapabilityRegistry._reset();
});

// ─── LEGEND_CAPABILITY shape ────────────────────────────────────────────────────

describe("LEGEND_CAPABILITY declaration", () => {
    it("has id 'legend'", () => {
        expect(LEGEND_CAPABILITY.id).toBe("legend");
    });

    it("has a non-empty label and description", () => {
        expect(typeof LEGEND_CAPABILITY.label).toBe("string");
        expect(LEGEND_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof LEGEND_CAPABILITY.description).toBe("string");
        expect(LEGEND_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.legend.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(LEGEND_CAPABILITY.gate?.configPath).toBe("modules.legend.enabled");
        expect(LEGEND_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes enabled/title/position/collapsedByDefault", () => {
        expect(LEGEND_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(LEGEND_CAPABILITY.configSchema?.enabled?.default).toBe(true);
        expect(LEGEND_CAPABILITY.configSchema?.title?.type).toBe("string");
        expect(LEGEND_CAPABILITY.configSchema?.position?.type).toBe("string");
        expect(LEGEND_CAPABILITY.configSchema?.position?.enum).toContain("bottomleft");
        expect(LEGEND_CAPABILITY.configSchema?.collapsedByDefault?.type).toBe("boolean");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(LEGEND_CAPABILITY.loader).toBeUndefined();
    });
});

// ─── CapabilityRegistry integration ───────────────────────────────────────────

describe("CapabilityRegistry + LEGEND_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("legend");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("legend");
        expect(schema?.gate?.configPath).toBe("modules.legend.enabled");
        expect(schema?.configSchema?.enabled?.type).toBe("boolean");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.legend.enabled is absent (enableWhenAbsent: true)", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const cfg = makeCapConfig({}); // no modules.legend key (pre-merge baseCfg)
        expect(CapabilityRegistry.isEnabled("legend", cfg)).toBe(true);
    });

    it("isEnabled() — true when modules.legend.enabled is true", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const cfg = makeCapConfig({ modules: { legend: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("legend", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.legend.enabled is false", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const cfg = makeCapConfig({ modules: { legend: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("legend", cfg)).toBe(false);
    });
});

// ─── Introspection facade ──────────────────────────────────────────────────────

describe("Introspection facade", () => {
    it("getAllCapabilities() includes legend after registration", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const legend = caps.find((c) => c.id === "legend");
        expect(legend).toBeDefined();
        expect(legend?.gate?.configPath).toBe("modules.legend.enabled");
    });

    it("getCapabilitySchema('legend') returns schema without loader", () => {
        CapabilityRegistry.register(LEGEND_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("legend");
        expect(schema?.id).toBe("legend");
        expect("loader" in schema).toBe(false);
    });
});
