/**
 * Unit tests — labels-capability.ts (S4 — in-core capability)
 *
 * Validates the LABELS_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection facade.
 *
 * Branches covered:
 *  - LABELS_CAPABILITY shape: id, gate, configSchema fields present
 *  - isEnabled() gate with modules.labels.enabled = true/false/absent (opt-out)
 *  - capConfig adapter (dot-notation reader, mirrors boot.ts implementation)
 *  - Introspection.getAllCapabilities() returns labels after registration
 *  - Introspection.getCapabilitySchema('labels') returns schema sans loader
 */

import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { LABELS_CAPABILITY } = await import("../../../src/capabilities/labels/labels-capability.ts");
const { Introspection } = await import("../../../src/api/geoleaf.introspection.ts");

/** Mirrors the capConfig adapter created in boot.ts for the labels gate. */
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

// ─── LABELS_CAPABILITY shape ───────────────────────────────────────────────────

describe("LABELS_CAPABILITY declaration", () => {
    it("has id 'labels'", () => {
        expect(LABELS_CAPABILITY.id).toBe("labels");
    });

    it("has a non-empty label and description", () => {
        expect(typeof LABELS_CAPABILITY.label).toBe("string");
        expect(LABELS_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(typeof LABELS_CAPABILITY.description).toBe("string");
        expect(LABELS_CAPABILITY.description.length).toBeGreaterThan(0);
    });

    it("gate targets 'modules.labels.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(LABELS_CAPABILITY.gate?.configPath).toBe("modules.labels.enabled");
        expect(LABELS_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });

    it("configSchema exposes an 'enabled' boolean field", () => {
        expect(LABELS_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
    });

    it("has no loader (inline — eager loading with the UI bundle)", () => {
        expect(LABELS_CAPABILITY.loader).toBeUndefined();
    });
});

// ─── CapabilityRegistry integration ───────────────────────────────────────────

describe("CapabilityRegistry + LABELS_CAPABILITY", () => {
    it("getSchema returns correct data after registration", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("labels");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("labels");
        expect(schema?.gate?.configPath).toBe("modules.labels.enabled");
        expect(schema?.configSchema?.enabled?.type).toBe("boolean");
        expect("loader" in schema).toBe(false);
    });

    it("isEnabled() — true when modules.labels.enabled is absent (enableWhenAbsent: true)", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const cfg = makeCapConfig({}); // no modules.labels key
        expect(CapabilityRegistry.isEnabled("labels", cfg)).toBe(true);
    });

    it("isEnabled() — true when modules.labels.enabled is true", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const cfg = makeCapConfig({ modules: { labels: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("labels", cfg)).toBe(true);
    });

    it("isEnabled() — false when modules.labels.enabled is false", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const cfg = makeCapConfig({ modules: { labels: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("labels", cfg)).toBe(false);
    });
});

// ─── Introspection facade ──────────────────────────────────────────────────────

describe("Introspection facade", () => {
    it("getAllCapabilities() includes labels after registration", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const caps = Introspection.getAllCapabilities();
        const labels = caps.find((c) => c.id === "labels");
        expect(labels).toBeDefined();
        expect(labels?.gate?.configPath).toBe("modules.labels.enabled");
    });

    it("getCapabilitySchema('labels') returns schema without loader", () => {
        CapabilityRegistry.register(LABELS_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("labels");
        expect(schema?.id).toBe("labels");
        expect("loader" in schema).toBe(false);
    });

    it("getAllCapabilities() returns empty array when nothing registered", () => {
        expect(Introspection.getAllCapabilities()).toHaveLength(0);
    });
});
