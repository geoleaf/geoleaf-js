/**
 * Unit tests — kernel/api/capability-registry.ts (S2.1)
 *
 * Strategy: await import() so Istanbul instruments every branch of
 * CapabilityRegistry (register, isEnabled, ensureLoaded, getSchema, getAllSchemas).
 *
 * The `_reset()` helper clears internal Maps between tests to guarantee isolation.
 *
 * Branches covered:
 *  - register(): first call stores, duplicate call is no-op
 *  - isEnabled(): unknown id → false
 *                no gate → true (always enabled)
 *                gate + key absent + enableWhenAbsent undefined → false (opt-in default)
 *                gate + key absent + enableWhenAbsent true → true
 *                gate + value truthy → true
 *                gate + value false → false
 *  - ensureLoaded(): no loader → resolves without throw, marks as loaded
 *                   with loader → called once; second call = no-op
 *  - getSchema(): known id → object without loader field; unknown → null
 *  - getAllSchemas(): correct count; no loader field on any item
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { CapabilityRegistry } = await import("../../src/kernel/api/capability-registry.ts");

beforeEach(() => {
    CapabilityRegistry._reset();
});

// ─── register ─────────────────────────────────────────────────────────────────

describe("register", () => {
    it("stores the declaration", () => {
        CapabilityRegistry.register({ id: "labels" });
        expect(CapabilityRegistry.getSchema("labels")).not.toBeNull();
    });

    it("is idempotent — second call with same id is a no-op", () => {
        CapabilityRegistry.register({ id: "labels", label: "Labels v1" });
        CapabilityRegistry.register({ id: "labels", label: "Labels v2" });
        expect(CapabilityRegistry.getAllSchemas()).toHaveLength(1);
        expect(CapabilityRegistry.getSchema("labels")?.label).toBe("Labels v1");
    });

    it("stores multiple distinct capabilities", () => {
        CapabilityRegistry.register({ id: "labels" });
        CapabilityRegistry.register({ id: "route" });
        CapabilityRegistry.register({ id: "cluster" });
        expect(CapabilityRegistry.getAllSchemas()).toHaveLength(3);
    });
});

// ─── isEnabled ────────────────────────────────────────────────────────────────

describe("isEnabled", () => {
    const configWith = (key, val) => ({
        get: (k, def) => (k === key ? val : def),
    });

    const emptyConfig = { get: (_k, def) => def };

    it("returns false for unknown capability id", () => {
        expect(CapabilityRegistry.isEnabled("nope", emptyConfig)).toBe(false);
    });

    it("returns true when no gate is declared (always enabled)", () => {
        CapabilityRegistry.register({ id: "labels" });
        expect(CapabilityRegistry.isEnabled("labels", emptyConfig)).toBe(true);
    });

    it("returns false when gate key is absent and enableWhenAbsent is undefined (opt-in default)", () => {
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled" },
        });
        expect(CapabilityRegistry.isEnabled("labels", emptyConfig)).toBe(false);
    });

    it("returns true when gate key is absent and enableWhenAbsent is true", () => {
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled", enableWhenAbsent: true },
        });
        expect(CapabilityRegistry.isEnabled("labels", emptyConfig)).toBe(true);
    });

    it("returns true when gate key has a truthy value", () => {
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled" },
        });
        expect(
            CapabilityRegistry.isEnabled("labels", configWith("modules.labels.enabled", true))
        ).toBe(true);
    });

    it("returns true when gate key has a non-false truthy value (string, number)", () => {
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled" },
        });
        expect(
            CapabilityRegistry.isEnabled("labels", configWith("modules.labels.enabled", "yes"))
        ).toBe(true);
        CapabilityRegistry._reset();
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled" },
        });
        expect(
            CapabilityRegistry.isEnabled("labels", configWith("modules.labels.enabled", 1))
        ).toBe(true);
    });

    it("returns false when gate key value is strictly false", () => {
        CapabilityRegistry.register({
            id: "labels",
            gate: { configPath: "modules.labels.enabled" },
        });
        expect(
            CapabilityRegistry.isEnabled("labels", configWith("modules.labels.enabled", false))
        ).toBe(false);
    });
});

// ─── ensureLoaded ─────────────────────────────────────────────────────────────

describe("ensureLoaded", () => {
    it("resolves without throw when no loader is declared", async () => {
        CapabilityRegistry.register({ id: "labels" });
        await expect(CapabilityRegistry.ensureLoaded("labels")).resolves.toBeUndefined();
    });

    it("marks as loaded even when there is no loader", async () => {
        CapabilityRegistry.register({ id: "labels" });
        await CapabilityRegistry.ensureLoaded("labels");
        expect(CapabilityRegistry.isLoaded("labels")).toBe(true);
    });

    it("calls the loader exactly once", async () => {
        const loader = vi.fn().mockResolvedValue(undefined);
        CapabilityRegistry.register({ id: "labels", loader });
        await CapabilityRegistry.ensureLoaded("labels");
        await CapabilityRegistry.ensureLoaded("labels"); // second call — no-op
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for an unknown id (resolves immediately)", async () => {
        await expect(CapabilityRegistry.ensureLoaded("nope")).resolves.toBeUndefined();
    });
});

// ─── getSchema ────────────────────────────────────────────────────────────────

describe("getSchema", () => {
    it("returns null for unknown id", () => {
        expect(CapabilityRegistry.getSchema("nope")).toBeNull();
    });

    it("returns ICapabilitySchema without the loader field", () => {
        const loader = vi.fn();
        CapabilityRegistry.register({
            id: "labels",
            label: "Labels",
            gate: { configPath: "modules.labels.enabled" },
            configSchema: { minZoom: { type: "number", default: 8 } },
            loader,
        });
        const schema = CapabilityRegistry.getSchema("labels");
        expect(schema).not.toBeNull();
        expect(schema?.id).toBe("labels");
        expect(schema?.label).toBe("Labels");
        expect(schema?.gate?.configPath).toBe("modules.labels.enabled");
        expect(schema?.configSchema?.minZoom.type).toBe("number");
        expect("loader" in schema).toBe(false);
    });

    it("preserves dependencies array", () => {
        CapabilityRegistry.register({ id: "cluster", dependencies: ["labels"] });
        expect(CapabilityRegistry.getSchema("cluster")?.dependencies).toEqual(["labels"]);
    });
});

// ─── getAllSchemas ─────────────────────────────────────────────────────────────

describe("getAllSchemas", () => {
    it("returns empty array when nothing is registered", () => {
        expect(CapabilityRegistry.getAllSchemas()).toHaveLength(0);
    });

    it("returns correct count", () => {
        CapabilityRegistry.register({ id: "labels" });
        CapabilityRegistry.register({ id: "route" });
        expect(CapabilityRegistry.getAllSchemas()).toHaveLength(2);
    });

    it("preserves insertion order", () => {
        CapabilityRegistry.register({ id: "labels" });
        CapabilityRegistry.register({ id: "route" });
        CapabilityRegistry.register({ id: "cluster" });
        const ids = CapabilityRegistry.getAllSchemas().map((s) => s.id);
        expect(ids).toEqual(["labels", "route", "cluster"]);
    });

    it("no item has a loader field", () => {
        CapabilityRegistry.register({ id: "labels", loader: vi.fn() });
        CapabilityRegistry.register({ id: "route", loader: vi.fn() });
        for (const schema of CapabilityRegistry.getAllSchemas()) {
            expect("loader" in schema).toBe(false);
        }
    });
});
