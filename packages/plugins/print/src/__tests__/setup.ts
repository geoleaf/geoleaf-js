/**
 * Vitest setup for @geoleaf-plugins/print tests.
 *
 * Provides:
 *  - A minimal GeoLeaf global (Config, Core.getMap) backed by vi.fn()
 *  - A minimal maplibre-gl mock (Map that fires 'idle' immediately)
 *  - Canvas mock helpers
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Canvas mock (jsdom doesn't implement getContext properly for 2D)
// ---------------------------------------------------------------------------

function _makeCanvas(w = 100, h = 100): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
}

// ---------------------------------------------------------------------------
// maplibre-gl mock
// ---------------------------------------------------------------------------

export function makeMockMaplibreMap(opts?: { idleError?: Error; tainted?: boolean }): any {
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};

    const canvas = _makeCanvas(400, 300);

    const map: any = {
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (!events[event]) events[event] = [];
            events[event].push(cb);
            // Trigger idle asynchronously so tests can await
            if (event === "idle") {
                setTimeout(() => {
                    if (opts?.idleError) {
                        // don't fire — let timeout kick in
                    } else {
                        cb();
                    }
                }, 0);
            }
            return map;
        }),
        on: vi.fn(),
        getCanvas: vi.fn(() => canvas),
        getStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [] })),
        getZoom: vi.fn(() => 12),
        getCenter: vi.fn(() => ({ lat: 48.85, lng: 2.35 })),
        getBounds: vi.fn(() => ({
            getWest: () => 2.0,
            getSouth: () => 48.7,
            getEast: () => 2.7,
            getNorth: () => 49.0,
        })),
        remove: vi.fn(),
        _requestManager: undefined,
    };

    // Intercept toDataURL on the canvas if tainted
    if (opts?.tainted) {
        canvas.toDataURL = () => {
            throw new DOMException("Tainted canvas", "SecurityError");
        };
    }

    return map;
}

/** vi.fn() constructor that returns a fresh mock map each call. */
export function makeMockMaplibreConstructor(mapOpts?: { idleError?: Error; tainted?: boolean }) {
    return vi.fn((_opts: unknown) => makeMockMaplibreMap(mapOpts));
}

// ---------------------------------------------------------------------------
// GeoLeaf global mock
// ---------------------------------------------------------------------------

export interface MockGeoLeaf {
    _nativeMap: ReturnType<typeof makeMockMaplibreMap>;
    Config: { get: ReturnType<typeof vi.fn> };
    Core: { getMap: ReturnType<typeof vi.fn> };
}

export function installMockGeoLeaf(overrides?: {
    nativeMap?: any;
    printConfig?: Partial<Record<string, unknown>>;
}): MockGeoLeaf {
    const nativeMap = overrides?.nativeMap ?? makeMockMaplibreMap();

    const mockGL: MockGeoLeaf = {
        _nativeMap: nativeMap,
        Config: {
            // Mirrors the core S0 compat layer: plugin config resolves under both
            // the new `modules.print` path (INV-CONFIG) and the legacy `printConfig`
            // root key. Tests inject via `printConfig` for readability; the plugin
            // now reads `modules.print`, so both must return the same block.
            get: vi.fn((key: string, def: unknown) => {
                if (key === "modules.print" || key === "printConfig") {
                    return overrides?.printConfig ?? {};
                }
                return def;
            }),
        },
        Core: {
            getMap: vi.fn(() => ({
                getNativeMap: vi.fn(() => nativeMap),
            })),
        },
    };

    (globalThis as any).GeoLeaf = mockGL;
    return mockGL;
}

export function uninstallMockGeoLeaf(): void {
    delete (globalThis as any).GeoLeaf;
}
