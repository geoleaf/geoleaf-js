/**
 * Unit tests — capabilities/cluster/cluster-capability.ts (revived S3).
 *
 * Validates the CLUSTER_CAPABILITY declaration and its integration with
 * CapabilityRegistry + Introspection (the boot-time gate path). Cluster is a
 * pull-based policy capability with an OPT-OUT gate (enableWhenAbsent: true).
 */
import { beforeEach, describe, expect, it } from "vitest";

const { CapabilityRegistry } = await import("../../../src/kernel/api/capability-registry.ts");
const { CLUSTER_CAPABILITY } =
    await import("../../../src/capabilities/cluster/cluster-capability.ts");
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

describe("CLUSTER_CAPABILITY declaration", () => {
    it("has id 'cluster'", () => {
        expect(CLUSTER_CAPABILITY.id).toBe("cluster");
    });
    it("has a non-empty label and description", () => {
        expect(CLUSTER_CAPABILITY.label.length).toBeGreaterThan(0);
        expect(CLUSTER_CAPABILITY.description.length).toBeGreaterThan(0);
    });
    it("gate targets 'modules.cluster.enabled' with enableWhenAbsent: true (opt-out)", () => {
        expect(CLUSTER_CAPABILITY.gate?.configPath).toBe("modules.cluster.enabled");
        expect(CLUSTER_CAPABILITY.gate?.enableWhenAbsent).toBe(true);
    });
    it("configSchema exposes an 'enabled' boolean and the clusterStrategy enum", () => {
        expect(CLUSTER_CAPABILITY.configSchema?.enabled?.type).toBe("boolean");
        expect(CLUSTER_CAPABILITY.configSchema?.clusterStrategy?.enum).toContain("unified");
    });
    it("has no loader (inline capability)", () => {
        expect(CLUSTER_CAPABILITY.loader).toBeUndefined();
    });
});

describe("CapabilityRegistry + CLUSTER_CAPABILITY (opt-out gate)", () => {
    it("getSchema returns the declaration without loader after registration", () => {
        CapabilityRegistry.register(CLUSTER_CAPABILITY);
        const schema = CapabilityRegistry.getSchema("cluster");
        expect(schema?.id).toBe("cluster");
        expect(schema?.gate?.configPath).toBe("modules.cluster.enabled");
        expect("loader" in schema).toBe(false);
    });
    it("isEnabled() — true when modules.cluster.enabled is absent (opt-out)", () => {
        CapabilityRegistry.register(CLUSTER_CAPABILITY);
        expect(CapabilityRegistry.isEnabled("cluster", makeCapConfig({}))).toBe(true);
    });
    it("isEnabled() — false only when modules.cluster.enabled is explicitly false", () => {
        CapabilityRegistry.register(CLUSTER_CAPABILITY);
        const cfg = makeCapConfig({ modules: { cluster: { enabled: false } } });
        expect(CapabilityRegistry.isEnabled("cluster", cfg)).toBe(false);
    });
    it("isEnabled() — true when modules.cluster.enabled is true", () => {
        CapabilityRegistry.register(CLUSTER_CAPABILITY);
        const cfg = makeCapConfig({ modules: { cluster: { enabled: true } } });
        expect(CapabilityRegistry.isEnabled("cluster", cfg)).toBe(true);
    });
});

describe("Introspection + CLUSTER_CAPABILITY", () => {
    it("getCapabilitySchema('cluster') returns the schema after registration", () => {
        CapabilityRegistry.register(CLUSTER_CAPABILITY);
        const schema = Introspection.getCapabilitySchema("cluster");
        expect(schema?.id).toBe("cluster");
    });
});
