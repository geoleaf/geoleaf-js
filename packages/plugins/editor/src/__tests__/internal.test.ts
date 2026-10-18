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
    /** A host whose one adapter drives `native` and holds exclusive mode as the core's does. */
    function _mockHost(withMembers = true) {
        const native: Record<string, unknown> = {};
        const held = { value: false };
        const adapter: Record<string, unknown> = { getNativeMap: vi.fn(() => native) };
        if (withMembers) {
            adapter.enterExclusiveMode = vi.fn((cursor?: string) => {
                held.value = true;
                adapter.lastCursor = cursor;
            });
            adapter.exitExclusiveMode = vi.fn(() => {
                held.value = false;
            });
        }
        (globalThis as any).GeoLeaf = { Core: { getMap: vi.fn(() => adapter) } };
        return { native, held, adapter };
    }

    it("🔴 enters exclusive mode on the adapter, without a cursor, and leaves the native map unwritten", () => {
        const { native, held, adapter } = _mockHost();
        _setExclusiveMode(true);
        expect(held.value).toBe(true);
        expect(adapter.lastCursor).toBeUndefined();
        expect(native["__geoleafExclusiveMode"]).toBeUndefined();
    });

    it("🔴 exits exclusive mode on the adapter", () => {
        const { held } = _mockHost();
        _setExclusiveMode(true);
        _setExclusiveMode(false);
        expect(held.value).toBe(false);
    });

    it("an adapter without the members: nothing throws, nothing is written in their place", () => {
        const { native } = _mockHost(false);
        expect(() => _setExclusiveMode(true)).not.toThrow();
        expect(() => _setExclusiveMode(false)).not.toThrow();
        expect(native["__geoleafExclusiveMode"]).toBeUndefined();
    });

    it("is a no-op when the native map is unavailable", () => {
        (globalThis as any).GeoLeaf = {};
        expect(() => _setExclusiveMode(true)).not.toThrow();
    });
});
