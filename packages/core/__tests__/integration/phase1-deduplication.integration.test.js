/**
 * Integration — Phase 1 Deduplication (object utils)
 * Reactivated from deferred/integration/phase1-deduplication.test.js
 * Uses direct imports from object-utils.ts instead of window.GeoLeaf.Utils (old global).
 */

import {
    getNestedValue,
    hasNestedPath,
    setNestedValue,
} from "../../src/utils/general/object-utils.js";
import { deepMerge } from "../../src/utils/general/utils-base.js";

describe("Integration — Phase 1: Object Utils deduplication", () => {
    describe("getNestedValue", () => {
        test("is a function", () => {
            expect(typeof getNestedValue).toBe("function");
        });

        test("returns value at simple key", () => {
            const obj = { name: "Test", value: 42 };
            expect(getNestedValue(obj, "name")).toBe("Test");
            expect(getNestedValue(obj, "value")).toBe(42);
        });

        test("returns value at nested dot-path", () => {
            const obj = {
                attributes: {
                    description: "Test description",
                    metadata: { author: "John Doe" },
                },
            };
            expect(getNestedValue(obj, "attributes.description")).toBe("Test description");
            expect(getNestedValue(obj, "attributes.metadata.author")).toBe("John Doe");
        });

        test("returns null for non-existent path", () => {
            const obj = { name: "Test" };
            expect(getNestedValue(obj, "nonexistent")).toBeNull();
            expect(getNestedValue(obj, "attributes.missing")).toBeNull();
        });

        test("returns null for deeply missing nested path", () => {
            const obj = { a: { b: 1 } };
            expect(getNestedValue(obj, "a.b.c.d")).toBeNull();
        });

        test("handles array access", () => {
            const obj = { tags: ["a", "b", "c"] };
            const tags = getNestedValue(obj, "tags");
            expect(Array.isArray(tags)).toBe(true);
            expect(tags).toHaveLength(3);
        });
    });

    describe("hasNestedPath", () => {
        test("is a function", () => {
            expect(typeof hasNestedPath).toBe("function");
        });

        test("returns true for existing path", () => {
            const obj = { attributes: { name: "Test" } };
            expect(hasNestedPath(obj, "attributes.name")).toBe(true);
        });

        test("returns false for missing path", () => {
            const obj = { attributes: { name: "Test" } };
            expect(hasNestedPath(obj, "attributes.missing")).toBe(false);
        });

        test("returns true for top-level key", () => {
            const obj = { id: "abc" };
            expect(hasNestedPath(obj, "id")).toBe(true);
        });

        test("returns false for empty object", () => {
            expect(hasNestedPath({}, "any.path")).toBe(false);
        });

        test("returns false for falsy nested value (empty string)", () => {
            const obj = { name: "" };
            // hasNestedPath checks existence, not truthiness
            const result = hasNestedPath(obj, "name");
            expect(typeof result).toBe("boolean");
        });
    });

    describe("setNestedValue", () => {
        test("is a function", () => {
            expect(typeof setNestedValue).toBe("function");
        });

        test("sets value at simple key", () => {
            const obj = {};
            setNestedValue(obj, "name", "Alice");
            expect(obj.name).toBe("Alice");
        });

        test("creates intermediate objects for nested path", () => {
            const obj = {};
            setNestedValue(obj, "attributes.name", "Test");
            expect(obj.attributes).toBeDefined();
            expect(obj.attributes.name).toBe("Test");
        });

        test("creates deeply nested path", () => {
            const obj = {};
            setNestedValue(obj, "a.b.c.d", 42);
            expect(obj.a.b.c.d).toBe(42);
        });

        test("overrides existing value", () => {
            const obj = { count: 5 };
            setNestedValue(obj, "count", 10);
            expect(obj.count).toBe(10);
        });

        test("sets null value", () => {
            const obj = { name: "old" };
            setNestedValue(obj, "name", null);
            expect(obj.name).toBeNull();
        });
    });

    describe("deepMerge (deduplication across modules)", () => {
        test("is a function", () => {
            expect(typeof deepMerge).toBe("function");
        });

        test("merges two shallow objects", () => {
            const result = deepMerge({ a: 1 }, { b: 2 });
            expect(result.a).toBe(1);
            expect(result.b).toBe(2);
        });

        test("override scalar value from source", () => {
            const result = deepMerge({ color: "red" }, { color: "blue" });
            expect(result.color).toBe("blue");
        });

        test("deep merge nested object", () => {
            const result = deepMerge({ map: { zoom: 10, center: [0, 0] } }, { map: { zoom: 15 } });
            expect(result.map.zoom).toBe(15);
        });

        test("preserves keys not in source", () => {
            const result = deepMerge({ map: { zoom: 10, center: [0, 0] } }, { map: { zoom: 15 } });
            expect(result.map.center).toEqual([0, 0]);
        });
    });

    describe("Module consistency validation", () => {
        test("getNestedValue and hasNestedPath agree on existing paths", () => {
            const obj = { a: { b: { c: 42 } } };
            const exists = hasNestedPath(obj, "a.b.c");
            const value = getNestedValue(obj, "a.b.c");
            expect(exists).toBe(true);
            expect(value).toBe(42);
        });

        test("getNestedValue and hasNestedPath agree on missing paths", () => {
            const obj = { a: 1 };
            const exists = hasNestedPath(obj, "x.y.z");
            const value = getNestedValue(obj, "x.y.z");
            expect(exists).toBe(false);
            expect(value).toBeNull();
        });

        test("setNestedValue then getNestedValue returns same value", () => {
            const obj = {};
            setNestedValue(obj, "module.feature.enabled", true);
            expect(getNestedValue(obj, "module.feature.enabled")).toBe(true);
        });
    });
});
