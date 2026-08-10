/**
 * @file Prototype-pollution guards on the profile-reachable `modules` bag writers.
 *
 * @security Sprint 13.2. These three writers are the sinks closest to the Sprint 5
 * bug class: untrusted JSON → `Object.entries` → dynamic-key write. A profile is the
 * least trustworthy input the system has (fetched at runtime, authored outside the
 * repo), and until this sprint none of the three guarded its keys.
 *
 * Written RED on purpose and seen failing before the guards were added — the Sprint 5
 * post-mortem is explicit that its tests mocked the sink and therefore proved nothing
 * (see docs/security/SECURITY_CONTRACT.md §5). Every test here drives the real
 * exported function, with no mock in the write path.
 *
 * ⚠️ `JSON.parse` is load-bearing in these fixtures and cannot be replaced by an
 * object literal: `JSON.parse('{"__proto__":{}}')` yields `__proto__` as an OWN,
 * enumerable property, which is what makes `Object.entries` list it and the
 * assignment hit the inherited setter. `{ __proto__: x }` in source sets the
 * prototype instead and is never enumerated — a fixture written that way passes
 * whether or not the guard exists.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mergeModulesBag } from "../../src/kernel/config/geoleaf-config/module-config.js";
import { mergeModuleBags } from "../../src/kernel/config/profile-loader-helpers.js";

/** Fails the run loudly if a test leaked onto the real Object.prototype. */
function expectNoGlobalPollution() {
    expect({}.pwned).toBeUndefined();
    expect(Object.prototype.pwned).toBeUndefined();
}

afterEach(() => {
    delete Object.prototype.pwned;
});

describe("@security mergeModulesBag — a profile cannot re-parent the modules bag", () => {
    let target;

    beforeEach(() => {
        target = {};
    });

    it("refuses a __proto__ module id coming from parsed JSON", () => {
        const incoming = JSON.parse('{"__proto__":{"pwned":true}}');
        // Guard the fixture itself: if this ever becomes false, the test below is
        // vacuous and would pass with the protection removed.
        expect(Object.prototype.hasOwnProperty.call(incoming, "__proto__")).toBe(true);

        mergeModulesBag(target, incoming);

        const bag = target.modules;
        expect(Object.getPrototypeOf(bag)).toBe(Object.prototype);
        expect(bag.pwned).toBeUndefined();
        expectNoGlobalPollution();
    });

    it("refuses `constructor` and `prototype` module ids", () => {
        mergeModulesBag(target, JSON.parse('{"constructor":{"pwned":1},"prototype":{"pwned":1}}'));

        expect(Object.prototype.hasOwnProperty.call(target.modules, "constructor")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(target.modules, "prototype")).toBe(false);
        expect(target.modules.constructor).toBe(Object);
        expectNoGlobalPollution();
    });

    it("keeps the legitimate entries of a bag that also carries a hostile key", () => {
        // Rejecting one key must not abort the merge: a profile mixing a poisoned
        // id with real ones still has to configure the real ones.
        mergeModulesBag(target, JSON.parse('{"__proto__":{"pwned":1},"poi":{"enabled":true}}'));

        expect(target.modules.poi).toEqual({ enabled: true });
        expectNoGlobalPollution();
    });

    // Behaviour preservation — this is the contract mergeModulesBag exists for
    // (see its docblock: a wholesale assignment would drop other plugins' entries).
    it("still merges legitimate module ids entry by entry", () => {
        const t = { modules: { poi: { a: 1 }, filters: { keep: true } } };
        mergeModulesBag(t, { filters: { b: 2 }, basemaps: { c: 3 } });

        expect(t.modules).toEqual({
            poi: { a: 1 },
            filters: { b: 2 },
            basemaps: { c: 3 },
        });
    });
});

describe("@security mergeModuleBags — the inline profile block cannot re-parent the merge", () => {
    it("refuses a __proto__ id from the inline block", () => {
        const inline = JSON.parse('{"__proto__":{"pwned":true}}');
        const merged = mergeModuleBags({ poi: { a: 1 } }, inline);

        expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
        expect(merged.pwned).toBeUndefined();
        expect(merged.poi).toEqual({ a: 1 });
        expectNoGlobalPollution();
    });

    it("refuses a __proto__ id from the file-loaded block", () => {
        // The `{ ...fromFiles }` spread uses CreateDataPropertyOrThrow, so it does
        // NOT trigger the setter — a hostile key lands as an own data property that
        // shadows the accessor. Harmless in itself, but it must not reach the bag.
        const merged = mergeModuleBags(JSON.parse('{"__proto__":{"pwned":true}}'), {
            poi: { a: 1 },
        });

        expect(merged.pwned).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(false);
        expectNoGlobalPollution();
    });

    it("still lets the inline block override the file block per module", () => {
        const merged = mergeModuleBags({ poi: { a: 1, keep: true } }, { poi: { a: 9 } });

        expect(merged.poi).toEqual({ a: 9, keep: true });
    });
});
