/**
 * Unit tests — theme-selector-capability.ts (S8 — in-core capability)
 *
 * Validates the THEME_SELECTOR_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection facade. Notably locks the opt-out gate
 * (enableWhenAbsent: true): the boot gate reads the pre-merge baseCfg, so an
 * opt-in (=== true) would silently disable the bar — the F2 pitfall.
 *
 * Branches covered:
 *  - THEME_SELECTOR_CAPABILITY shape: id, gate, configSchema fields present
 *  - isEnabled() gate with modules.theme-selector.enabled = true/false/absent (opt-out)
 *  - capConfig adapter (dot-notation reader, mirrors boot.ts toCapConfig)
 *  - Introspection.getAllCapabilities() returns theme-selector after registration
 *  - Introspection.getCapabilitySchema('theme-selector') returns schema sans loader
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { THEME_SELECTOR_CAPABILITY } =
    await import("../../../src/capabilities/theme-selector/theme-selector-capability.ts");
const { THEME_TOGGLE_CAPABILITY } =
    await import("../../../src/capabilities/theme-toggle/theme-toggle-capability.ts");
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the theme-selector gate. */
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

// ─── THEME_SELECTOR_CAPABILITY shape ───────────────────────────────────────────

describe("THEME_SELECTOR_CAPABILITY declaration", () => {
    it("has id 'theme-selector'", () => {
        expect(THEME_SELECTOR_CAPABILITY.id).toBe("theme-selector");
    });

    it("has a non-empty label and description", () => {
        expect(typeof THEME_SELECTOR_CAPABILITY.label).toBe("string");
        expect(THEME_SELECTOR_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof THEME_SELECTOR_CAPABILITY.description).toBe("string");
        expect(THEME_SELECTOR_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.theme-selector.enabled' with enableWhenAbsent: true (registration-only)", () => {
        expect(THEME_SELECTOR_CAPABILITY.gate?.configPath).toBe("modules.theme-selector.enabled");
        expect(THEME_SELECTOR_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema announces the EFFECTIVE default, not the gate's (B.23)", () => {
        // The schema is what the integrator and the no-code studio read
        // through `getCapabilitySchema('theme-selector')`. It must announce
        // what the runtime DOES, not what the boot gate is worth.
        //
        // The runtime is opt-IN: `theme-selector.ts` tests
        // `enabled === true` and bails when the key is absent. Announcing
        // `default: true` thus promised a bar the code never renders — the defect.
        //
        // ⚠️ The gate stays `enableWhenAbsent: true`, and that is DELIBERATE:
        // it only registers the module, before the profile merge (the
        // boot-gate timing trap). The two need not agree with each other —
        // the SCHEMA must agree with the RUNTIME.
        expect(THEME_SELECTOR_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(THEME_SELECTOR_CAPABILITY.configSchema?.enabled?.default).toBe(false);
    });

    it("annonce le même contrat que theme-toggle, qui a le même besoin (B.23)", () => {
        // Alignment guard: both capabilities are profile-level, opt-out gate
        // to survive the pre-merge, late opt-in decision. If one drifts, this one turns red.
        expect(THEME_SELECTOR_CAPABILITY.gate?.enableWhenAbsent).toBe(
            THEME_TOGGLE_CAPABILITY.gate?.enableWhenAbsent
        );
        expect(THEME_SELECTOR_CAPABILITY.configSchema?.enabled?.default).toBe(
            THEME_TOGGLE_CAPABILITY.configSchema?.enabled?.default
        );
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(THEME_SELECTOR_CAPABILITY.loader).toBeUndefined();
    });
});

// ─── CapabilityRegistry integration ───────────────────────────────────────────

describe("CapabilityRegistry + THEME_SELECTOR_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("theme-selector");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("theme-selector");
        expect(schema?.gate?.configPath).toBe("modules.theme-selector.enabled");
        expect(schema?.configSchema?.enabled?.type).toBe("boolean");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.theme-selector.enabled is absent (enableWhenAbsent: true)", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const cfg = makeCapConfig({}); // no modules.theme-selector key
        expect(CapabilityRegistry.isEnabled("theme-selector", cfg)).toBe(true);
    });

    it("isEnabled() — true when modules.theme-selector.enabled is true", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const cfg = makeCapConfig({ modules: { "theme-selector": { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("theme-selector", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.theme-selector.enabled is false", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const cfg = makeCapConfig({ modules: { "theme-selector": { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("theme-selector", cfg)).toBe(false);
    });
});

// ─── Introspection facade ──────────────────────────────────────────────────────

describe("Introspection facade", () => {
    it("getAllCapabilities() includes theme-selector after registration", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const themeSelector = caps.find((c) => c.id === "theme-selector");
        expect(themeSelector).toBeDefined();
        expect(themeSelector?.gate?.configPath).toBe("modules.theme-selector.enabled");
    });

    it("getCapabilitySchema('theme-selector') returns schema without loader", () => {
        CapabilityRegistry.register(THEME_SELECTOR_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("theme-selector");
        expect(schema?.id).toBe("theme-selector");
        expect("loader" in schema).toBe(false);
    });

    it("getAllCapabilities() returns empty array when nothing registered", () => {
        expect(Introspection.getAllCapabilities()).toHaveLength(0);
    });
});
