/**
 * Unit tests — capabilities/route/route-capability.ts (S11).
 *
 * Validates the ROUTE_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection (the boot-time gate path).
 */
import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { ROUTE_CAPABILITY } = await import("../../../src/capabilities/route/route-capability.ts");
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

describe("ROUTE_CAPABILITY declaration", () => {
    it("has id 'route'", () => {
        expect(ROUTE_CAPABILITY.id).toBe("route");
    });
    it("has a non-empty label and description", () => {
        expect(ROUTE_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(ROUTE_CAPABILITY.description.length).toBeGreaterThan(0);
    });
    it("gate targets 'modules.route.enabled' with enableWhenAbsent: true (opt-out boot gate)", () => {
        expect(ROUTE_CAPABILITY.gate?.configPath).toBe("modules.route.enabled");
        expect(ROUTE_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });
    it("configSchema exposes an 'enabled' boolean field", () => {
        expect(ROUTE_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
    });
    it("has no loader (inline capability)", () => {
        expect(ROUTE_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + ROUTE_CAPABILITY", () => {
    it("getSchema returns the declaration without loader after registration", () => {
        CapabilityRegistry.register(ROUTE_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("route");
        expect(schema?.id).toBe("route");
        expect(schema?.gate?.configPath).toBe("modules.route.enabled");
        expect("loader" in schema).toBe(false);
    });
    it("isEnabled() — true when modules.route.enabled is absent (opt-out boot gate)", () => {
        CapabilityRegistry.register(ROUTE_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("route", makeCapConfig({}))).toBe(true);
    });
    it("isEnabled() — true when modules.route.enabled is true", () => {
        CapabilityRegistry.register(ROUTE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { route: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("route", cfg)).toBe(true);
    });
    it("isEnabled() — false when modules.route.enabled is false", () => {
        CapabilityRegistry.register(ROUTE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { route: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("route", cfg)).toBe(false);
    });
});

describe("Introspection + ROUTE_CAPABILITY", () => {
    it("getCapabilitySchema('route') returns the schema after registration", () => {
        CapabilityRegistry.register(ROUTE_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("route");
        expect(schema?.id).toBe("route");
    });
});
