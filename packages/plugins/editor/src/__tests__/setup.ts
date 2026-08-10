/**
 * Vitest setup for @geoleaf-plugins/editor tests.
 *
 * Provides:
 *  - A base GeoLeaf global installed at module load (for config.test.ts compatibility)
 *  - installMockGeoLeaf / uninstallMockGeoLeaf helpers for per-test map setup
 *  - makeMockMaplibreMap for floating-menu tests
 */

import { vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// maplibre-gl mock
// ---------------------------------------------------------------------------

export function makeMockMaplibreMap(): any {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    container.appendChild(canvas);

    return {
        getCanvas: vi.fn(() => canvas),
        getContainer: vi.fn(() => container),
        getZoom: vi.fn(() => 12),
        getCenter: vi.fn(() => ({ lat: 48.85, lng: 2.35 })),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
    };
}

// ---------------------------------------------------------------------------
// GeoLeaf dynamic helpers (used by floating-menu.test.ts)
// ---------------------------------------------------------------------------

export function installMockGeoLeaf(overrides?: { nativeMap?: any }): void {
    const nativeMap = overrides?.nativeMap ?? makeMockMaplibreMap();

    (globalThis as any).GeoLeaf = {
        _version: "2.0.0",
        Core: {
            getMap: vi.fn(() => ({
                getNativeMap: vi.fn(() => nativeMap),
            })),
        },
        plugins: {
            register: vi.fn(),
            isLoaded: vi.fn().mockReturnValue(false),
        },
        registry: {
            register: vi.fn(),
        },
        I18n: {
            registerDict: vi.fn(),
            t: vi.fn((key: string) => key),
            getLabel: vi.fn((key: string) => key),
        },
        Config: {
            get: vi.fn().mockReturnValue(undefined),
        },
        Editor: undefined,
    };
}

export function uninstallMockGeoLeaf(): void {
    delete (globalThis as any).GeoLeaf;
}

// ---------------------------------------------------------------------------
// Base GeoLeaf global — installed at module load for config.test.ts
// ---------------------------------------------------------------------------

const _mockPlugins = { register: vi.fn(), isLoaded: vi.fn().mockReturnValue(false) };
const _mockI18n = {
    registerDict: vi.fn(),
    t: vi.fn((key: string) => key),
    getLabel: vi.fn((key: string) => key),
};
const _mockRegistry = { register: vi.fn() };
const _mockConfig = { get: vi.fn().mockReturnValue(undefined) };

Object.defineProperty(globalThis, "GeoLeaf", {
    configurable: true,
    writable: true,
    value: {
        _version: "2.0.0",
        plugins: _mockPlugins,
        I18n: _mockI18n,
        registry: _mockRegistry,
        Config: _mockConfig,
        Editor: undefined,
    },
});

// ---------------------------------------------------------------------------
// ResizeObserver stub (happy-dom does not implement it)
// ---------------------------------------------------------------------------

if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks();
    // Restore base GeoLeaf if a floating-menu test called uninstallMockGeoLeaf()
    if (!(globalThis as any).GeoLeaf) {
        (globalThis as any).GeoLeaf = {
            _version: "2.0.0",
            plugins: _mockPlugins,
            I18n: _mockI18n,
            registry: _mockRegistry,
            Config: _mockConfig,
            Editor: undefined,
        };
    }
    (globalThis as any).GeoLeaf.Editor = undefined;
});
