/**
 * Tests for config/debug-flag — getDebugMode()
 * Batch D1: covers lines 24-26 (0% → 100%)
 */
import { getDebugMode } from "../../src/kernel/config/debug-flag.js";

describe("config/debug-flag", () => {
    afterEach(() => {
        delete globalThis.GeoLeaf;
    });

    it("returns false when globalThis.GeoLeaf is undefined", () => {
        delete globalThis.GeoLeaf;
        expect(getDebugMode()).toBe(false);
    });

    it("returns false when globalThis.GeoLeaf.DEBUG is undefined", () => {
        globalThis.GeoLeaf = {};
        expect(getDebugMode()).toBe(false);
    });

    it("returns false when globalThis.GeoLeaf.DEBUG is false", () => {
        globalThis.GeoLeaf = { DEBUG: false };
        expect(getDebugMode()).toBe(false);
    });

    it("returns true when globalThis.GeoLeaf.DEBUG is true", () => {
        globalThis.GeoLeaf = { DEBUG: true };
        expect(getDebugMode()).toBe(true);
    });

    it("returns false when globalThis.GeoLeaf.DEBUG is truthy but not boolean true", () => {
        globalThis.GeoLeaf = { DEBUG: 1 };
        expect(getDebugMode()).toBe(false);
    });
});
