/**
 * Unit tests — capabilities/filter/filter-capability.ts (S5, F0).
 *
 * Validates the FILTER_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection (the boot-time gate path). Filter is a
 * generic attribute-filter capability with an OPT-OUT gate (enableWhenAbsent: true).
 */
import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { FILTER_CAPABILITY } = await import("../../../src/capabilities/filter/filter-capability.ts");
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the gate. */
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

describe("FILTER_CAPABILITY declaration", () => {
    it("has id 'filter'", () => {
        expect(FILTER_CAPABILITY.id).toBe("filter");
    });
    it("has a non-empty label and description", () => {
        expect(FILTER_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(FILTER_CAPABILITY.description.length).toBeGreaterThan(0);
    });
    it("gate targets 'modules.filter.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(FILTER_CAPABILITY.gate?.configPath).toBe("modules.filter.enabled");
        expect(FILTER_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });
    it("configSchema exposes an 'enabled' boolean and the field-kind enum", () => {
        expect(FILTER_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(FILTER_CAPABILITY.configSchema?.fields?.type).toBe("array");
        expect(FILTER_CAPABILITY.configSchema?.fields?.items?.properties?.kind?.enum).toContain(
            "taxonomy"
        );
    });
    it("has no loader (inline capability)", () => {
        expect(FILTER_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + FILTER_CAPABILITY (opt-out gate)", () => {
    it("getSchema returns the declaration without loader after registration", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("filter");
        expect(schema?.id).toBe("filter");
        expect(schema?.gate?.configPath).toBe("modules.filter.enabled");
        expect("loader" in schema).toBe(false);
    });
    it("isEnabled() — true when modules.filter.enabled is absent (opt-out)", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("filter", makeCapConfig({}))).toBe(true);
    });
    it("isEnabled() — false only when modules.filter.enabled is explicitly false", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        const cfg = makeCapConfig({ modules: { filter: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("filter", cfg)).toBe(false);
    });
    it("isEnabled() — true when modules.filter.enabled is true", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        const cfg = makeCapConfig({ modules: { filter: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("filter", cfg)).toBe(true);
    });
});

describe("Introspection + FILTER_CAPABILITY", () => {
    it("getCapabilitySchema('filter') returns the schema after registration", () => {
        CapabilityRegistry.register(FILTER_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("filter");
        expect(schema?.id).toBe("filter");
    });
});
