/**
 * Unit tests — geolocation-capability.ts (in-core capability, extraction roadmap contrôles carte)
 *
 * Validates the GEOLOCATION_CAPABILITY declaration + CapabilityRegistry/Introspection.
 * Geolocation is opt-out (profile-level).
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { GEOLOCATION_CAPABILITY } = await import(
    "../../../src/capabilities/geolocation/geolocation-capability.ts"
);
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

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

describe("GEOLOCATION_CAPABILITY declaration", () => {
    it("has id 'geolocation'", () => {
        expect(GEOLOCATION_CAPABILITY.id).toBe("geolocation");
    });

    it("has a non-empty label and description", () => {
        expect(typeof GEOLOCATION_CAPABILITY.label).toBe("string");
        expect(GEOLOCATION_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof GEOLOCATION_CAPABILITY.description).toBe("string");
        expect(GEOLOCATION_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.geolocation.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(GEOLOCATION_CAPABILITY.gate?.configPath).toBe("modules.geolocation.enabled");
        expect(GEOLOCATION_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes enabled + position", () => {
        expect(GEOLOCATION_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(GEOLOCATION_CAPABILITY.configSchema?.position?.type).toBe("string");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(GEOLOCATION_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + GEOLOCATION_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("geolocation");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("geolocation");
        expect(schema?.gate?.configPath).toBe("modules.geolocation.enabled");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.geolocation.enabled is absent (opt-out)", () => {
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("geolocation", makeCapConfig({}))).toBe(true);
    });

    it("isEnabled() — false when modules.geolocation.enabled is false", () => {
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        const cfg = makeCapConfig({ modules: { geolocation: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("geolocation", cfg)).toBe(false);
    });
});

describe("Introspection facade", () => {
    it("getAllCapabilities() includes geolocation after registration", () => {
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const geo = caps.find((c) => c.id === "geolocation");
        expect(geo).toBeDefined();
        expect(geo?.gate?.configPath).toBe("modules.geolocation.enabled");
    });

    it("getCapabilitySchema('geolocation') returns schema without loader", () => {
        CapabilityRegistry.register(GEOLOCATION_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("geolocation");
        expect(schema?.id).toBe("geolocation");
        expect("loader" in schema).toBe(false);
    });
});
