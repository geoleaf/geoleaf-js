/**
 * Unit tests — capabilities/taxonomy/taxonomy-capability.ts (SR0).
 *
 * Validates the TAXONOMY_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection (the boot-time gate path).
 */
import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { TAXONOMY_CAPABILITY } =
    await import("../../../src/capabilities/taxonomy/taxonomy-capability.ts");
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

describe("TAXONOMY_CAPABILITY declaration", () => {
    it("has id 'taxonomy'", () => {
        expect(TAXONOMY_CAPABILITY.id).toBe("taxonomy");
    });
    it("has a non-empty label and description", () => {
        expect(TAXONOMY_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(TAXONOMY_CAPABILITY.description.length).toBeGreaterThan(0);
    });
    it("gate targets 'modules.taxonomy.enabled' with enableWhenAbsent: TRUE (opt-out)", () => {
        // The key lives in a profile RESOURCE, loaded after the boot gate reads
        // config. An opt-in gate would read `undefined` and silence the capability
        // for every profile — the pitfall that kept the old painter dead.
        expect(TAXONOMY_CAPABILITY.gate?.configPath).toBe("modules.taxonomy.enabled");
        expect(TAXONOMY_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });
    it("configSchema exposes an 'enabled' boolean field defaulting to true", () => {
        expect(TAXONOMY_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(TAXONOMY_CAPABILITY.configSchema?.enabled?.default).toBe(true);
    });
    it("has no loader (inline capability)", () => {
        expect(TAXONOMY_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + TAXONOMY_CAPABILITY", () => {
    it("getSchema returns the declaration without loader after registration", () => {
        CapabilityRegistry.register(TAXONOMY_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("taxonomy");
        expect(schema?.id).toBe("taxonomy");
        expect(schema?.gate?.configPath).toBe("modules.taxonomy.enabled");
        expect("loader" in schema).toBe(false);
    });
    it("isEnabled() — TRUE when modules.taxonomy.enabled is absent (opt-out)", () => {
        // This is the assertion that used to be inverted, and the reason the whole
        // capability was inert at boot.
        CapabilityRegistry.register(TAXONOMY_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("taxonomy", makeCapConfig({}))).toBe(true);
    });
    it("isEnabled() — true when modules.taxonomy.enabled is true", () => {
        CapabilityRegistry.register(TAXONOMY_CAPABILITY);
        const cfg = makeCapConfig({ modules: { taxonomy: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("taxonomy", cfg)).toBe(true);
    });
    it("isEnabled() — false when modules.taxonomy.enabled is false", () => {
        CapabilityRegistry.register(TAXONOMY_CAPABILITY);
        const cfg = makeCapConfig({ modules: { taxonomy: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("taxonomy", cfg)).toBe(false);
    });
});

describe("Introspection + TAXONOMY_CAPABILITY", () => {
    it("getCapabilitySchema('taxonomy') returns the schema after registration", () => {
        CapabilityRegistry.register(TAXONOMY_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("taxonomy");
        expect(schema?.id).toBe("taxonomy");
    });
});
