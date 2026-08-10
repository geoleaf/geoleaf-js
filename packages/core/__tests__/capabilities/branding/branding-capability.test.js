/**
 * Unit tests — branding-capability.ts (in-core capability, extraction roadmap contrôles carte)
 *
 * Validates the BRANDING_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection facade. Branding is opt-in (app-global).
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { BRANDING_CAPABILITY } = await import(
    "../../../src/capabilities/branding/branding-capability.ts"
);
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the branding gate. */
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

describe("BRANDING_CAPABILITY declaration", () => {
    it("has id 'branding'", () => {
        expect(BRANDING_CAPABILITY.id).toBe("branding");
    });

    it("has a non-empty label and description", () => {
        expect(typeof BRANDING_CAPABILITY.label).toBe("string");
        expect(BRANDING_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof BRANDING_CAPABILITY.description).toBe("string");
        expect(BRANDING_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.branding.enabled' with opt-in semantics (enableWhenAbsent absent)", () => {
        expect(BRANDING_CAPABILITY.gate?.configPath).toBe("modules.branding.enabled");
        expect(BRANDING_CAPABILITY.gate?.enableWhenAbsent).toBeUndefined();
    });

    it("configSchema exposes enabled/text/position fields", () => {
        expect(BRANDING_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(BRANDING_CAPABILITY.configSchema?.text?.type).toBe("string");
        expect(BRANDING_CAPABILITY.configSchema?.position?.type).toBe("string");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(BRANDING_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + BRANDING_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("branding");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("branding");
        expect(schema?.gate?.configPath).toBe("modules.branding.enabled");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — false when modules.branding.enabled is absent (opt-in)", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const cfg = makeCapConfig({}); // no modules.branding key
        expect(CapabilityRegistry.isEnabled("branding", cfg)).toBe(false);
    });

    it("isEnabled() — true when modules.branding.enabled is true", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const cfg = makeCapConfig({ modules: { branding: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("branding", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.branding.enabled is false", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const cfg = makeCapConfig({ modules: { branding: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("branding", cfg)).toBe(false);
    });
});

describe("Introspection facade", () => {
    it("getAllCapabilities() includes branding after registration", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const branding = caps.find((c) => c.id === "branding");
        expect(branding).toBeDefined();
        expect(branding?.gate?.configPath).toBe("modules.branding.enabled");
    });

    it("getCapabilitySchema('branding') returns schema without loader", () => {
        CapabilityRegistry.register(BRANDING_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("branding");
        expect(schema?.id).toBe("branding");
        expect("loader" in schema).toBe(false);
    });
});
