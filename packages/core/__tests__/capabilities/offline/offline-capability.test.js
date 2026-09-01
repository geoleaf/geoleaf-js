/**
 * Unit tests — capabilities/offline/offline-capability.ts (S14 Phase B).
 *
 * Validates the OFFLINE_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection (the boot-time gate path). The offline engine
 * is opt-in (`enableWhenAbsent: false`) and depends on the `pwa` capability.
 */
import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { OFFLINE_CAPABILITY } =
    await import("../../../src/capabilities/offline/offline-capability.ts");
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

describe("OFFLINE_CAPABILITY declaration", () => {
    it("has id 'offline'", () => {
        expect(OFFLINE_CAPABILITY.id).toBe("offline");
    });
    it("has a non-empty label and description", () => {
        expect(OFFLINE_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(OFFLINE_CAPABILITY.description.length).toBeGreaterThan(0);
    });
    it("gate targets 'modules.offline.enabled' with enableWhenAbsent: false (opt-in boot gate)", () => {
        expect(OFFLINE_CAPABILITY.gate?.configPath).toBe("modules.offline.enabled");
        expect(OFFLINE_CAPABILITY.gate?.enableWhenAbsent).toBe(false);
    });
    it("declares a dependency on the 'pwa' capability (introspection metadata)", () => {
        expect(OFFLINE_CAPABILITY.dependencies).toContain("pwa");
    });
    it("configSchema exposes 'enabled' boolean + a 'cache' object", () => {
        expect(OFFLINE_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(OFFLINE_CAPABILITY.configSchema?.cache?.type).toBe("object");
    });
    it("declares a dynamic loader (B3 — engine loads via import() off the boot path)", () => {
        expect(typeof OFFLINE_CAPABILITY.loader).toBe("function");
    });
});

describe("CapabilityRegistry + OFFLINE_CAPABILITY", () => {
    it("getSchema returns the declaration without loader after registration", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("offline");
        expect(schema?.id).toBe("offline");
        expect(schema?.gate?.configPath).toBe("modules.offline.enabled");
        expect("loader" in schema).toBe(false);
    });
    it("isEnabled() — false when modules.offline.enabled is absent (opt-in boot gate)", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("offline", makeCapConfig({}))).toBe(false);
    });
    it("isEnabled() — true when modules.offline.enabled is true", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { offline: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("offline", cfg)).toBe(true);
    });
    it("isEnabled() — false when modules.offline.enabled is false", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { offline: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("offline", cfg)).toBe(false);
    });
});

describe("Introspection + OFFLINE_CAPABILITY", () => {
    it("getCapabilitySchema('offline') returns the schema after registration", () => {
        CapabilityRegistry.register(OFFLINE_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("offline");
        expect(schema?.id).toBe("offline");
    });
});
