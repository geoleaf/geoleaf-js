/**
 * Unit tests — coordinates-capability.ts (in-core capability, extraction roadmap contrôles carte)
 *
 * Validates the COORDINATES_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection. Coordinates is opt-out (profile-level).
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { COORDINATES_CAPABILITY } = await import(
    "../../../src/capabilities/coordinates/coordinates-capability.ts"
);
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the coordinates gate. */
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

describe("COORDINATES_CAPABILITY declaration", () => {
    it("has id 'coordinates'", () => {
        expect(COORDINATES_CAPABILITY.id).toBe("coordinates");
    });

    it("has a non-empty label and description", () => {
        expect(typeof COORDINATES_CAPABILITY.label).toBe("string");
        expect(COORDINATES_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof COORDINATES_CAPABILITY.description).toBe("string");
        expect(COORDINATES_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.coordinates.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(COORDINATES_CAPABILITY.gate?.configPath).toBe("modules.coordinates.enabled");
        expect(COORDINATES_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes enabled/position/decimals fields", () => {
        expect(COORDINATES_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(COORDINATES_CAPABILITY.configSchema?.position?.type).toBe("string");
        expect(COORDINATES_CAPABILITY.configSchema?.decimals?.type).toBe("number");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(COORDINATES_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + COORDINATES_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(COORDINATES_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("coordinates");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("coordinates");
        expect(schema?.gate?.configPath).toBe("modules.coordinates.enabled");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.coordinates.enabled is absent (opt-out)", () => {
        CapabilityRegistry.register(COORDINATES_CAPABILITY);
        const cfg = makeCapConfig({});
        expect(CapabilityRegistry.isEnabled("coordinates", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.coordinates.enabled is false", () => {
        CapabilityRegistry.register(COORDINATES_CAPABILITY);
        const cfg = makeCapConfig({ modules: { coordinates: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("coordinates", cfg)).toBe(false);
    });
});

describe("Introspection facade", () => {
    it("getAllCapabilities() includes coordinates after registration", () => {
        CapabilityRegistry.register(COORDINATES_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const coordinates = caps.find((c) => c.id === "coordinates");
        expect(coordinates).toBeDefined();
        expect(coordinates?.gate?.configPath).toBe("modules.coordinates.enabled");
    });

    it("getCapabilitySchema('coordinates') returns schema without loader", () => {
        CapabilityRegistry.register(COORDINATES_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("coordinates");
        expect(schema?.id).toBe("coordinates");
        expect("loader" in schema).toBe(false);
    });
});
