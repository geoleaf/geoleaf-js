/**
 * Unit tests — theme-toggle-capability.ts (in-core capability, extraction roadmap contrôles carte)
 *
 * Validates the THEME_TOGGLE_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection. The button defaults OFF (opt-in) but the
 * declaration gate uses enableWhenAbsent:true for pre-merge module registration.
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { THEME_TOGGLE_CAPABILITY } = await import(
    "../../../src/capabilities/theme-toggle/theme-toggle-capability.ts"
);
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

describe("THEME_TOGGLE_CAPABILITY declaration", () => {
    it("has id 'theme-toggle'", () => {
        expect(THEME_TOGGLE_CAPABILITY.id).toBe("theme-toggle");
    });

    it("has a non-empty label and description", () => {
        expect(typeof THEME_TOGGLE_CAPABILITY.label).toBe("string");
        expect(THEME_TOGGLE_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof THEME_TOGGLE_CAPABILITY.description).toBe("string");
        expect(THEME_TOGGLE_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.theme-toggle.enabled' (registration opt-out)", () => {
        expect(THEME_TOGGLE_CAPABILITY.gate?.configPath).toBe("modules.theme-toggle.enabled");
        expect(THEME_TOGGLE_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes enabled (default false, opt-in) + position", () => {
        expect(THEME_TOGGLE_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(THEME_TOGGLE_CAPABILITY.configSchema?.enabled?.default).toBe(false);
        expect(THEME_TOGGLE_CAPABILITY.configSchema?.position?.type).toBe("string");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(THEME_TOGGLE_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + THEME_TOGGLE_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(THEME_TOGGLE_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("theme-toggle");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("theme-toggle");
        expect(schema?.gate?.configPath).toBe("modules.theme-toggle.enabled");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — registration true when absent (module registers pre-merge)", () => {
        CapabilityRegistry.register(THEME_TOGGLE_CAPABILITY);
        const cfg = makeCapConfig({});
        expect(CapabilityRegistry.isEnabled("theme-toggle", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.theme-toggle.enabled is false", () => {
        CapabilityRegistry.register(THEME_TOGGLE_CAPABILITY);
        const cfg = makeCapConfig({ modules: { "theme-toggle": { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("theme-toggle", cfg)).toBe(false);
    });
});

describe("Introspection facade", () => {
    it("getAllCapabilities() includes theme-toggle after registration", () => {
        CapabilityRegistry.register(THEME_TOGGLE_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const tt = caps.find((c) => c.id === "theme-toggle");
        expect(tt).toBeDefined();
        expect(tt?.gate?.configPath).toBe("modules.theme-toggle.enabled");
    });

    it("getCapabilitySchema('theme-toggle') returns schema without loader", () => {
        CapabilityRegistry.register(THEME_TOGGLE_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("theme-toggle");
        expect(schema?.id).toBe("theme-toggle");
        expect("loader" in schema).toBe(false);
    });
});
