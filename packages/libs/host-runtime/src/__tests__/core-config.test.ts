/*!
 * @geoleaf/host-runtime — coreConfigGet tests
 * © 2026 Mattieu Pottier — MIT License
 *
 * Runs under the package default (`environment: "node"`): the accessor only reads
 * `globalThis`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { coreConfigGet, type GeoLeafHost } from "../host.js";

type Carrier = { GeoLeaf?: GeoLeafHost };
const carrier = globalThis as Carrier;

afterEach(() => {
    delete carrier.GeoLeaf;
});

describe("coreConfigGet", () => {
    it("returns the fallback when the namespace is absent", () => {
        expect(coreConfigGet("data.profilesBasePath", "../profiles")).toBe("../profiles");
    });

    it("returns the fallback when Config is not yet mounted", () => {
        carrier.GeoLeaf = {};
        expect(coreConfigGet("any.key", "fb")).toBe("fb");
    });

    it("returns the fallback when Config carries no get()", () => {
        carrier.GeoLeaf = { Config: {} as GeoLeafHost["Config"] };
        expect(coreConfigGet("any.key", "fb")).toBe("fb");
    });

    it("returns the configured value when present", () => {
        carrier.GeoLeaf = { Config: { get: () => 42 } };
        expect(coreConfigGet<number>("zoom", 1)).toBe(42);
    });

    it("forwards both the key and the fallback to Config.get", () => {
        const seen: unknown[] = [];
        carrier.GeoLeaf = {
            Config: {
                get: (k: string, d?: unknown) => {
                    seen.push(k, d);
                    return "v";
                },
            },
        };
        coreConfigGet("a.b", "dflt");
        expect(seen).toEqual(["a.b", "dflt"]);
    });

    /**
     * Regression guard (PLUGINS S1). The nine live copies this export replaces all
     * ended with `value === undefined ? defaultValue : value`; the export itself did
     * NOT, and returned `undefined` straight through. Adopting it across the plugins
     * without this guard would have been a silent behaviour change on every key a
     * profile leaves unset.
     */
    it("falls back when Config.get itself returns undefined", () => {
        carrier.GeoLeaf = { Config: { get: () => undefined } };
        expect(coreConfigGet("missing.key", "fb")).toBe("fb");
    });

    it("preserves falsy values that are not undefined", () => {
        carrier.GeoLeaf = { Config: { get: () => 0 } };
        expect(coreConfigGet<number>("count", 99)).toBe(0);

        carrier.GeoLeaf = { Config: { get: () => false } };
        expect(coreConfigGet<boolean>("flag", true)).toBe(false);

        carrier.GeoLeaf = { Config: { get: () => null } };
        expect(coreConfigGet<unknown>("nullable", "fb")).toBeNull();
    });

    it("returns undefined when no fallback was supplied and nothing is configured", () => {
        expect(coreConfigGet("nope")).toBeUndefined();
    });
});
