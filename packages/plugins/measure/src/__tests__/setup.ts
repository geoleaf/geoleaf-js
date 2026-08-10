/**
 * Vitest setup for @geoleaf-plugins/measure tests.
 *
 * Provides:
 *  - A minimal GeoLeaf global (Config, Core.getMap, plugins, I18n) backed by vi.fn()
 *  - A minimal maplibre-gl mock (Map with addSource/addLayer/getSource/project/unproject/getContainer/dragPan)
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// maplibre-gl mock
// ---------------------------------------------------------------------------

export function makeMockMaplibreMap(opts?: { tainted?: boolean }): any {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    container.appendChild(canvas); // canvas must be inside container for capture listener tests

    const sources: Record<string, unknown> = {};
    const layers: string[] = [];
    const events: Record<string, Array<(...args: unknown[]) => void>> = {};

    const map: any = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (!events[event]) events[event] = [];
            events[event].push(cb);
            return map;
        }),
        off: vi.fn(),
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            if (!events[event]) events[event] = [];
            events[event].push(cb);
            setTimeout(() => cb(), 0);
            return map;
        }),
        addSource: vi.fn((id: string, src: unknown) => {
            sources[id] = src;
        }),
        getSource: vi.fn((id: string) => sources[id] ?? null),
        removeSource: vi.fn((id: string) => {
            delete sources[id];
        }),
        addLayer: vi.fn((layer: { id: string }) => {
            layers.push(layer.id);
        }),
        getLayer: vi.fn((id: string) => (layers.includes(id) ? { id } : undefined)),
        removeLayer: vi.fn((id: string) => {
            const idx = layers.indexOf(id);
            if (idx !== -1) layers.splice(idx, 1);
        }),
        setLayoutProperty: vi.fn(),
        setPaintProperty: vi.fn(),
        getCanvas: vi.fn(() => canvas),
        getContainer: vi.fn(() => container),
        project: vi.fn((_lngLat: unknown) => ({ x: 100, y: 100 })),
        unproject: vi.fn((_point: unknown) => ({ lng: 2.35, lat: 48.85 })),
        getZoom: vi.fn(() => 12),
        getCenter: vi.fn(() => ({ lat: 48.85, lng: 2.35 })),
        getBounds: vi.fn(() => ({
            getWest: () => 2.0,
            getSouth: () => 48.7,
            getEast: () => 2.7,
            getNorth: () => 49.0,
        })),
        dragPan: {
            enable: vi.fn(),
            disable: vi.fn(),
        },
        setCursor: vi.fn(),
        getStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [] })),
        remove: vi.fn(),
        _fireEvent: (event: string, ...args: unknown[]) => {
            (events[event] ?? []).forEach((cb) => cb(...args));
        },
    };

    if (opts?.tainted) {
        canvas.toDataURL = () => {
            throw new DOMException("Tainted canvas", "SecurityError");
        };
    }

    return map;
}

// ---------------------------------------------------------------------------
// GeoLeaf global mock
// ---------------------------------------------------------------------------

export interface MockGeoLeaf {
    _nativeMap: ReturnType<typeof makeMockMaplibreMap>;
    Config: { get: ReturnType<typeof vi.fn> };
    Core: { getMap: ReturnType<typeof vi.fn> };
    plugins: { isLoaded: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };
    registry: { register: ReturnType<typeof vi.fn> };
    I18n: { registerDict: ReturnType<typeof vi.fn>; getLabel: ReturnType<typeof vi.fn> };
    UI: { _geolocationActive: boolean };
}

export function installMockGeoLeaf(overrides?: {
    nativeMap?: any;
    measureConfig?: Partial<Record<string, unknown>>;
    geolocActive?: boolean;
}): MockGeoLeaf {
    const nativeMap = overrides?.nativeMap ?? makeMockMaplibreMap();

    const mockGL: MockGeoLeaf = {
        _nativeMap: nativeMap,
        Config: {
            // Mirrors the core S0 compat layer: plugin config resolves under both the
            // new `modules.measure` path (INV-CONFIG) and the legacy `measureConfig`
            // root key. Tests inject via `measureConfig` for readability; the plugin
            // now reads `modules.measure`, so both must return the same block.
            get: vi.fn((key: string, def: unknown) => {
                if (key === "modules.measure" || key === "measureConfig") {
                    return overrides?.measureConfig ?? {};
                }
                return def;
            }),
        },
        Core: {
            getMap: vi.fn(() => ({
                getNativeMap: vi.fn(() => nativeMap),
            })),
        },
        plugins: {
            isLoaded: vi.fn((_id: string) => false),
            register: vi.fn(),
        },
        registry: {
            register: vi.fn(),
        },
        I18n: {
            registerDict: vi.fn(),
            getLabel: vi.fn((key: string) => key),
        },
        UI: {
            _geolocationActive: overrides?.geolocActive ?? false,
        },
    };

    (globalThis as any).GeoLeaf = mockGL;
    return mockGL;
}

// ---------------------------------------------------------------------------
// Geolocation control button mock
// ---------------------------------------------------------------------------

/**
 * Injects a mock `.geoleaf-ctrl-geolocation a` link into the document body.
 * Returns the link element so tests can spy on `.click()`.
 */
export function installGeolocButtonMock(): {
    link: HTMLAnchorElement;
    ctrl: HTMLDivElement;
} {
    const ctrl = document.createElement("div");
    ctrl.className = "geoleaf-ctrl-geolocation";
    const link = document.createElement("a");
    link.href = "#";
    ctrl.appendChild(link);
    document.body.appendChild(ctrl);
    return { link, ctrl };
}

export function uninstallGeolocButtonMock(ctrl: HTMLDivElement): void {
    ctrl.remove();
}

export function uninstallMockGeoLeaf(): void {
    delete (globalThis as any).GeoLeaf;
}

// ---------------------------------------------------------------------------
// navigator.geolocation mock
// ---------------------------------------------------------------------------

type PositionCb = (pos: GeolocationPosition) => void;
type ErrorCb = (err: GeolocationPositionError) => void;

export interface GeolocationMock {
    watchPosition: ReturnType<typeof vi.fn>;
    clearWatch: ReturnType<typeof vi.fn>;
    getCurrentPosition: ReturnType<typeof vi.fn>;
    /** Fire a successful position to all registered watchPosition callbacks. */
    _firePosition(coord: [number, number], timestamp?: number): void;
    /** Fire a GeolocationPositionError to all registered error callbacks. */
    _fireError(code: number): void;
}

export function installGeolocationMock(): GeolocationMock {
    const posCbs: PositionCb[] = [];
    const errCbs: ErrorCb[] = [];

    const mock: GeolocationMock = {
        watchPosition: vi.fn((success: PositionCb, error: ErrorCb) => {
            posCbs.push(success);
            errCbs.push(error);
            return 42; // fake watchId
        }),
        clearWatch: vi.fn(),
        getCurrentPosition: vi.fn(),
        _firePosition(coord: [number, number], timestamp = Date.now()) {
            const pos = {
                coords: {
                    longitude: coord[0],
                    latitude: coord[1],
                    accuracy: 5,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null,
                },
                timestamp,
            } as unknown as GeolocationPosition;
            posCbs.forEach((cb) => cb(pos));
        },
        _fireError(code: number) {
            const err = {
                code,
                message: "test error",
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3,
            } as unknown as GeolocationPositionError;
            errCbs.forEach((cb) => cb(err));
        },
    };

    Object.defineProperty(globalThis.navigator, "geolocation", {
        value: mock,
        configurable: true,
        writable: true,
    });
    return mock;
}

export function uninstallGeolocationMock(): void {
    Object.defineProperty(globalThis.navigator, "geolocation", {
        value: undefined,
        configurable: true,
        writable: true,
    });
}

// ---------------------------------------------------------------------------
// ResizeObserver mock (happy-dom does not implement it)
// ---------------------------------------------------------------------------

if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class ResizeObserver {
        private _cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
            this._cb = cb;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        /** Test helper: manually fire a resize notification. */
        _fire(el: Element, width: number, height: number) {
            this._cb([{ contentRect: { width, height } } as ResizeObserverEntry], this);
        }
    };
}
