/*!
 * Tests — internal helpers: _getNativeMap, _getBaseLayers
 */
import { describe, it, expect, vi, afterEach } from "vitest";

// terra-draw stubs needed transitively
vi.mock("terra-draw", () => ({
    TerraDraw: vi.fn(),
    TerraDrawPointMode: vi.fn(),
    TerraDrawLineStringMode: vi.fn(),
    TerraDrawPolygonMode: vi.fn(),
    TerraDrawSelectMode: vi.fn(),
}));
vi.mock("terra-draw-maplibre-gl-adapter", () => ({
    TerraDrawMapLibreGLAdapter: vi.fn(),
}));

import { _getNativeMap, _getBaseLayers, _setExclusiveMode } from "../internal.js";

afterEach(() => {
    delete (globalThis as any).GeoLeaf;
});

describe("internal — _getNativeMap", () => {
    it("returns null when GeoLeaf.Core is absent", () => {
        (globalThis as any).GeoLeaf = {};
        expect(_getNativeMap()).toBeNull();
    });

    it("returns the native map via Core.getMap().getNativeMap()", () => {
        const native = { addSource: vi.fn(), addLayer: vi.fn() };
        (globalThis as any).GeoLeaf = {
            Core: { getMap: vi.fn(() => ({ getNativeMap: vi.fn(() => native) })) },
        };
        expect(_getNativeMap()).toBe(native);
    });
});

describe("internal — _getBaseLayers", () => {
    it("returns null when GeoLeaf is absent", () => {
        expect(_getBaseLayers()).toBeNull();
    });

    it("returns GeoLeaf.BaseLayers when present", () => {
        const bm = { setBaseLayer: vi.fn(), getActiveKey: vi.fn() };
        (globalThis as any).GeoLeaf = { BaseLayers: bm };
        expect(_getBaseLayers()).toBe(bm);
    });

    it("falls back to GeoLeaf.Baselayers (lowercase l)", () => {
        const bm = { setBaseLayer: vi.fn(), getActiveKey: vi.fn() };
        (globalThis as any).GeoLeaf = { Baselayers: bm };
        expect(_getBaseLayers()).toBe(bm);
    });

    it("prefers BaseLayers over Baselayers", () => {
        const bmUpper = { setBaseLayer: vi.fn() };
        const bmLower = { setBaseLayer: vi.fn() };
        (globalThis as any).GeoLeaf = { BaseLayers: bmUpper, Baselayers: bmLower };
        expect(_getBaseLayers()).toBe(bmUpper);
    });
});

describe("internal — _setExclusiveMode", () => {
    function _mockNativeMap(): Record<string, unknown> {
        const native: Record<string, unknown> = {};
        (globalThis as any).GeoLeaf = {
            Core: { getMap: vi.fn(() => ({ getNativeMap: vi.fn(() => native) })) },
        };
        return native;
    }

    it("sets __geoleafExclusiveMode = true on the native map", () => {
        const native = _mockNativeMap();
        _setExclusiveMode(true);
        expect(native["__geoleafExclusiveMode"]).toBe(true);
    });

    it("clears __geoleafExclusiveMode = false on the native map", () => {
        const native = _mockNativeMap();
        _setExclusiveMode(true);
        _setExclusiveMode(false);
        expect(native["__geoleafExclusiveMode"]).toBe(false);
    });

    it("is a no-op when the native map is unavailable", () => {
        (globalThis as any).GeoLeaf = {};
        expect(() => _setExclusiveMode(true)).not.toThrow();
    });
});
