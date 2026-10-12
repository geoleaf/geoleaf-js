/**
 * @geoleaf-plugins/isochrone — what `configure()` holds
 *
 * Validated whole or refused whole, and a refusal names the field — never its value.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOverrides, setOverrides } from "../runtime-overrides.js";

/** Stands for a key: it must never reach a log. */
const SENTINEL = "s3nt1nel-K3Y";

/** The page's namespace, reached without assuming the core's global declaration is loaded. */
const host = globalThis as { GeoLeaf?: unknown };
const previous = host.GeoLeaf;
let warn = vi.fn();

beforeEach(() => {
    warn = vi.fn();
    host.GeoLeaf = { Log: { warn } };
});

afterEach(() => {
    setOverrides(null);
    host.GeoLeaf = previous;
});

describe("@geoleaf-plugins/isochrone — setOverrides", () => {
    it("holds nothing until a host gives something", () => {
        expect(getOverrides()).toBeNull();
    });

    it("accepts an address and query parameters", () => {
        expect(
            setOverrides({ endpoint: "https://engine.example", query: { api_key: SENTINEL } })
        ).toBe(true);
        expect(getOverrides()).toEqual({
            endpoint: "https://engine.example",
            query: { api_key: SENTINEL },
        });
    });

    it("accepts either field alone, and an empty object", () => {
        expect(setOverrides({ endpoint: "https://engine.example" })).toBe(true);
        expect(getOverrides()).toEqual({ endpoint: "https://engine.example" });
        expect(setOverrides({ query: { token: "t" } })).toBe(true);
        expect(getOverrides()).toEqual({ query: { token: "t" } });
        expect(setOverrides({})).toBe(true);
        expect(getOverrides()).toEqual({});
    });

    it("replaces the previous settings whole — nothing of them survives", () => {
        setOverrides({ endpoint: "https://one.example", query: { api_key: SENTINEL } });
        setOverrides({ endpoint: "https://two.example" });
        expect(getOverrides()).toEqual({ endpoint: "https://two.example" });
    });

    it("clears the settings on `null`", () => {
        setOverrides({ endpoint: "https://engine.example" });
        expect(setOverrides(null)).toBe(true);
        expect(getOverrides()).toBeNull();
    });

    it("copies the query, so a host editing its own object changes nothing here", () => {
        const query = { api_key: "first" };
        setOverrides({ query });
        query.api_key = "second";
        expect(getOverrides()?.query).toEqual({ api_key: "first" });
    });
    it("copies a parameter named `__proto__` as a plain key, and reaches no prototype", () => {
        // An own key, as soon as the object comes from `JSON.parse`.
        const query = JSON.parse('{"__proto__":"x","token":"t"}') as Record<string, string>;
        expect(setOverrides({ query })).toBe(true);
        const held = getOverrides()?.query ?? {};
        expect(Object.getPrototypeOf(held)).toBe(Object.prototype);
        expect(Object.keys(held).sort()).toEqual(["__proto__", "token"]);
    });
});

describe("@geoleaf-plugins/isochrone — setOverrides refuses, whole", () => {
    it.each([
        ["a string", "https://engine.example", "overrides"],
        ["a list", [], "overrides"],
        ["a number", 3, "overrides"],
        ["undefined", undefined, "overrides"],
        ["an address in http", { endpoint: "http://engine.example" }, "endpoint"],
        ["an address that is not a string", { endpoint: 42 }, "endpoint"],
        ["an address that cannot be read", { endpoint: "https://" }, "endpoint"],
        ["an address carrying credentials", { endpoint: "https://u:p@engine.example" }, "endpoint"],
        ["a query that is not an object", { query: "api_key=x" }, "query"],
        ["a query that is a list", { query: ["api_key"] }, "query"],
        ["a null query", { query: null }, "query"],
        ["a parameter that is not a string", { query: { api_key: 42 } }, "query"],
        ["the parameter reserved for the question", { query: { json: "{}" } }, "query"],
    ])("refuses %s, and names the field", (_label, input, field) => {
        expect(setOverrides(input)).toBe(false);
        expect(getOverrides()).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain(`\`${field}\``);
    });

    it("keeps the settings in force when the new ones are refused", () => {
        setOverrides({ endpoint: "https://engine.example", query: { api_key: "kept" } });
        expect(setOverrides({ endpoint: "https://other.example", query: { json: "x" } })).toBe(
            false
        );
        expect(getOverrides()).toEqual({
            endpoint: "https://engine.example",
            query: { api_key: "kept" },
        });
    });

    it("names the field of a refusal, never the value that was refused", () => {
        setOverrides({ endpoint: `http://engine.example/?api_key=${SENTINEL}` });
        setOverrides({ endpoint: `https://user:${SENTINEL}@engine.example` });
        setOverrides({ query: { json: SENTINEL } });
        setOverrides({ query: { api_key: SENTINEL, other: 1 } });
        expect(warn).toHaveBeenCalledTimes(4);
        for (const call of warn.mock.calls) {
            expect(call.map(String).join(" ")).not.toContain(SENTINEL);
        }
    });
});
