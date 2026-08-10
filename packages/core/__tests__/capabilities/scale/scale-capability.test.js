/**
 * Unit tests — scale-capability.ts (in-core capability, extraction roadmap contrôles carte)
 *
 * Validates the SCALE_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection. Scale is opt-out (profile-level).
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { SCALE_CAPABILITY } = await import("../../../src/capabilities/scale/scale-capability.ts");
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the scale gate. */
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

describe("SCALE_CAPABILITY declaration", () => {
    it("has id 'scale'", () => {
        expect(SCALE_CAPABILITY.id).toBe("scale");
    });

    it("has a non-empty label and description", () => {
        expect(typeof SCALE_CAPABILITY.label).toBe("string");
        expect(SCALE_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof SCALE_CAPABILITY.description).toBe("string");
        expect(SCALE_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.scale.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(SCALE_CAPABILITY.gate?.configPath).toBe("modules.scale.enabled");
        expect(SCALE_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes enabled + scale type fields + position", () => {
        expect(SCALE_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(SCALE_CAPABILITY.configSchema?.scaleGraphic?.type).toBe("boolean");
        expect(SCALE_CAPABILITY.configSchema?.scaleNumeric?.type).toBe("boolean");
        expect(SCALE_CAPABILITY.configSchema?.scaleNumericEditable?.type).toBe("boolean");
        expect(SCALE_CAPABILITY.configSchema?.scaleNivel?.type).toBe("boolean");
        expect(SCALE_CAPABILITY.configSchema?.position?.type).toBe("string");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(SCALE_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + SCALE_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(SCALE_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("scale");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("scale");
        expect(schema?.gate?.configPath).toBe("modules.scale.enabled");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.scale.enabled is absent (opt-out)", () => {
        CapabilityRegistry.register(SCALE_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("scale", makeCapConfig({}))).toBe(true);
    });

    it("isEnabled() — false when modules.scale.enabled is false", () => {
        CapabilityRegistry.register(SCALE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { scale: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("scale", cfg)).toBe(false);
    });
});

describe("Introspection facade", () => {
    it("getAllCapabilities() includes scale after registration", () => {
        CapabilityRegistry.register(SCALE_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const scale = caps.find((c) => c.id === "scale");
        expect(scale).toBeDefined();
        expect(scale?.gate?.configPath).toBe("modules.scale.enabled");
    });

    it("getCapabilitySchema('scale') returns schema without loader", () => {
        CapabilityRegistry.register(SCALE_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("scale");
        expect(schema?.id).toBe("scale");
        expect("loader" in schema).toBe(false);
    });
});
