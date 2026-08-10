/**
 * Tests for GeoLeaf.Utils.ObjectUtils
 */
import * as mod from "../../src/utils/general/object-utils.js";

// Initialize GeoLeaf namespace if not present
if (!global.GeoLeaf) {
    global.GeoLeaf = { Utils: {} };
}

describe("GeoLeaf.Utils.ObjectUtils", () => {
    beforeAll(() => {
        global.GeoLeaf = global.GeoLeaf || {};
        global.GeoLeaf.Log = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        // Build ObjectUtils namespace compatible avec le test
        const ObjectUtils = {
            getNestedValue: mod.getNestedValue,
            hasNestedPath: mod.hasNestedPath,
            setNestedValue: mod.setNestedValue,
        };
        global.GeoLeaf.Utils = global.GeoLeaf.Utils || {};
        global.GeoLeaf.Utils.ObjectUtils = ObjectUtils;
        global.GeoLeaf.Utils.getNestedValue = mod.getNestedValue;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("getNestedValue", () => {
        let getNestedValue;

        beforeEach(() => {
            getNestedValue = global.GeoLeaf.Utils.ObjectUtils.getNestedValue;
        });

        it("should get top-level property", () => {
            const obj = { name: "John", age: 30 };
            expect(getNestedValue(obj, "name")).toBe("John");
            expect(getNestedValue(obj, "age")).toBe(30);
        });

        it("should get nested property", () => {
            const obj = {
                user: {
                    name: "John",
                    address: {
                        city: "Paris",
                        zip: "75001",
                    },
                },
            };
            expect(getNestedValue(obj, "user.name")).toBe("John");
            expect(getNestedValue(obj, "user.address.city")).toBe("Paris");
            expect(getNestedValue(obj, "user.address.zip")).toBe("75001");
        });

        it("should return null for missing path", () => {
            const obj = { user: { name: "John" } };
            expect(getNestedValue(obj, "user.age")).toBeNull();
            expect(getNestedValue(obj, "user.address.city")).toBeNull();
            expect(getNestedValue(obj, "profile.avatar")).toBeNull();
        });

        it("should handle null/undefined object", () => {
            expect(getNestedValue(null, "path")).toBeNull();
            expect(getNestedValue(undefined, "path")).toBeNull();
        });

        it("should handle null/undefined in path", () => {
            const obj = { user: null };
            expect(getNestedValue(obj, "user.name")).toBeNull();

            const obj2 = { user: { profile: undefined } };
            expect(getNestedValue(obj2, "user.profile.name")).toBeNull();
        });

        it("should handle invalid path", () => {
            const obj = { name: "John" };
            expect(getNestedValue(obj, "")).toBeNull();
            expect(getNestedValue(obj, null)).toBeNull();
            expect(getNestedValue(obj, undefined)).toBeNull();
        });

        it("should handle falsy values correctly", () => {
            const obj = {
                zero: 0,
                empty: "",
                bool: false,
                nested: {
                    zero: 0,
                },
            };
            expect(getNestedValue(obj, "zero")).toBe(0);
            expect(getNestedValue(obj, "empty")).toBe("");
            expect(getNestedValue(obj, "bool")).toBe(false);
            expect(getNestedValue(obj, "nested.zero")).toBe(0);
        });

        it("should handle arrays in path", () => {
            const obj = {
                users: [{ name: "John" }, { name: "Jane" }],
            };
            expect(getNestedValue(obj, "users.0.name")).toBe("John");
            expect(getNestedValue(obj, "users.1.name")).toBe("Jane");
        });

        it("should be available as alias on GeoLeaf.Utils", () => {
            expect(global.GeoLeaf.Utils.getNestedValue).toBe(getNestedValue);
        });
    });

    describe("hasNestedPath", () => {
        let hasNestedPath;

        beforeEach(() => {
            hasNestedPath = global.GeoLeaf.Utils.ObjectUtils.hasNestedPath;
        });

        it("should return true for existing path", () => {
            const obj = {
                user: {
                    name: "John",
                    address: { city: "Paris" },
                },
            };
            expect(hasNestedPath(obj, "user")).toBe(true);
            expect(hasNestedPath(obj, "user.name")).toBe(true);
            expect(hasNestedPath(obj, "user.address.city")).toBe(true);
        });

        it("should return false for missing path", () => {
            const obj = { user: { name: "John" } };
            expect(hasNestedPath(obj, "user.age")).toBe(false);
            expect(hasNestedPath(obj, "profile")).toBe(false);
            expect(hasNestedPath(obj, "user.address.city")).toBe(false);
        });

        it("should return false for null/undefined object", () => {
            expect(hasNestedPath(null, "path")).toBe(false);
            expect(hasNestedPath(undefined, "path")).toBe(false);
        });

        it("should return true even for falsy values", () => {
            const obj = { zero: 0, empty: "", bool: false };
            expect(hasNestedPath(obj, "zero")).toBe(true);
            expect(hasNestedPath(obj, "empty")).toBe(true);
            expect(hasNestedPath(obj, "bool")).toBe(true);
        });
    });

    describe("setNestedValue", () => {
        let setNestedValue;

        beforeEach(() => {
            setNestedValue = global.GeoLeaf.Utils.ObjectUtils.setNestedValue;
        });

        it("should set top-level property", () => {
            const obj = {};
            setNestedValue(obj, "name", "John");
            expect(obj.name).toBe("John");
        });

        it("should set nested property", () => {
            const obj = {};
            setNestedValue(obj, "user.name", "John");
            expect(obj.user.name).toBe("John");
        });

        it("should create intermediate objects", () => {
            const obj = {};
            setNestedValue(obj, "user.address.city", "Paris");
            expect(obj).toEqual({
                user: {
                    address: {
                        city: "Paris",
                    },
                },
            });
        });

        it("should overwrite existing values", () => {
            const obj = { user: { name: "John" } };
            setNestedValue(obj, "user.name", "Jane");
            expect(obj.user.name).toBe("Jane");
        });

        it("should throw for invalid object", () => {
            expect(() => setNestedValue(null, "path", "value")).toThrow();
            expect(() => setNestedValue(undefined, "path", "value")).toThrow();
            expect(() => setNestedValue("string", "path", "value")).toThrow();
        });

        it("should throw for invalid path", () => {
            const obj = {};
            expect(() => setNestedValue(obj, "", "value")).toThrow();
            expect(() => setNestedValue(obj, null, "value")).toThrow();
        });

        it("should return the modified object", () => {
            const obj = {};
            const result = setNestedValue(obj, "user.name", "John");
            expect(result).toBe(obj);
        });

        // S5 (optimisation KERNEL) — this sink has no internal caller but IS public
        // (GeoLeaf.Utils.setNestedValue / Utils.ObjectUtils.setNestedValue), so a
        // consumer can drive it with an untrusted path.
        describe("@security — prototype-polluting segments", () => {
            afterEach(() => {
                delete Object.prototype.polluted;
                delete Object.prototype.owned;
            });

            it("refuses a leading __proto__ segment", () => {
                const obj = {};
                setNestedValue(obj, "__proto__.polluted", "PWNED");

                expect(obj.polluted).toBeUndefined();
                expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
                expect({}.polluted).toBeUndefined();
            });

            it("refuses constructor/prototype segments", () => {
                const obj = {};
                setNestedValue(obj, "constructor.prototype.owned", "PWNED");

                expect(Object.prototype.owned).toBeUndefined();
                expect({}.owned).toBeUndefined();
            });

            it("refuses a single-segment __proto__ path", () => {
                const obj = {};
                setNestedValue(obj, "__proto__", { polluted: true });

                expect(Object.getPrototypeOf(obj)).toBe(Object.prototype);
                expect({}.polluted).toBeUndefined();
            });

            it("returns the object unchanged rather than throwing", () => {
                const obj = { keep: 1 };
                expect(setNestedValue(obj, "__proto__.polluted", "PWNED")).toBe(obj);
                expect(obj.keep).toBe(1);
            });

            it("does not follow an inherited object as an intermediate", () => {
                // `key in current` would have descended into the prototype's `shared`
                // object and written there, mutating every sibling instance.
                const proto = { shared: {} };
                const obj = Object.create(proto);
                setNestedValue(obj, "shared.value", "own");

                expect(obj.shared.value).toBe("own");
                expect(proto.shared.value).toBeUndefined();
            });

            it("still writes legitimate nested paths", () => {
                const obj = {};
                setNestedValue(obj, "user.address.city", "Paris");
                expect(obj.user.address.city).toBe("Paris");
            });
        });
    });

    describe("Module exposure", () => {
        it("should expose ObjectUtils on GeoLeaf.Utils", () => {
            expect(global.GeoLeaf.Utils.ObjectUtils).toBeDefined();
            expect(typeof global.GeoLeaf.Utils.ObjectUtils).toBe("object");
        });

        it("should expose getNestedValue as alias", () => {
            expect(global.GeoLeaf.Utils.getNestedValue).toBeDefined();
            expect(typeof global.GeoLeaf.Utils.getNestedValue).toBe("function");
        });

        it("should expose all functions", () => {
            const { ObjectUtils } = global.GeoLeaf.Utils;
            expect(typeof ObjectUtils.getNestedValue).toBe("function");
            expect(typeof ObjectUtils.hasNestedPath).toBe("function");
            expect(typeof ObjectUtils.setNestedValue).toBe("function");
        });
    });
});
