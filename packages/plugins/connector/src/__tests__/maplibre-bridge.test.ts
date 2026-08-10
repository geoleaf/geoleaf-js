/**
 * maplibre-bridge.test.ts
 *
 * vmForks pool gives a fresh module per FILE — both bridge and TokenStore are
 * the same shared instances throughout this file (no vi.resetModules needed).
 *
 * DOM isolation: document.addEventListener is spied in beforeEach to track
 * every listener added during a test. afterEach removes all of them so no
 * stale listeners leak across tests.
 */

import { installMapLibreBridge } from "../maplibre-bridge.js";
import { TokenStore } from "../token-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type ListenerEntry = {
    type: string;
    fn: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.example.com";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const VALID_CONFIG = { baseUrl: BASE_URL, getToken: () => TOKEN };

function makeMapMock() {
    let _installedFn: ((url: string) => unknown) | null = null;
    return {
        setTransformRequest: vi.fn((fn: (url: string) => unknown) => {
            _installedFn = fn;
        }),
        callTransformRequest: (url: string) => _installedFn?.(url),
        hasTransformRequest: () => _installedFn !== null,
    };
}

function mockGeoLeafCore(nativeMap: unknown) {
    (globalThis as any).GeoLeaf = {
        Core: {
            getMap: () => ({
                getNativeMap: () => nativeMap,
            }),
        },
    };
}

// ─── DOM listener isolation ───────────────────────────────────────────────────

const _tracked: ListenerEntry[] = [];
const _origAdd = document.addEventListener.bind(document);
const _origRemove = document.removeEventListener.bind(document);

beforeEach(() => {
    // Spy on addEventListener to capture every listener registered during this test.
    // afterEach will remove them all, preventing stale listeners from leaking.
    vi.spyOn(document, "addEventListener").mockImplementation(
        (
            type: string,
            fn: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions
        ) => {
            _tracked.push({ type, fn, options });
            _origAdd(type, fn, options as EventListenerOptions);
        }
    );
});

afterEach(async () => {
    // Remove ALL listeners tracked during this test
    for (const { type, fn, options } of _tracked) {
        _origRemove(type, fn, options as EventListenerOptions);
    }
    _tracked.length = 0;
    vi.restoreAllMocks();
    delete (globalThis as any).GeoLeaf;
    await TokenStore.clear(BASE_URL);
    TokenStore._setRefreshFn(null);
});

// ─── Immediate install (map available at configure() time) ───────────────────

describe("immediate install — map available at configure() time", () => {
    it("calls setTransformRequest immediately when map is available", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        expect(mapMock.setTransformRequest).toHaveBeenCalledTimes(1);
    });

    it("does not throw when GeoLeaf is not on globalThis", () => {
        delete (globalThis as any).GeoLeaf;
        expect(() => installMapLibreBridge(VALID_CONFIG)).not.toThrow();
    });

    it("does not throw when Core.getMap() returns null", () => {
        (globalThis as any).GeoLeaf = { Core: { getMap: () => null } };
        expect(() => installMapLibreBridge(VALID_CONFIG)).not.toThrow();
    });

    it("does not throw when getNativeMap() returns object without setTransformRequest", () => {
        mockGeoLeafCore({ someOtherMethod: vi.fn() });
        expect(() => installMapLibreBridge(VALID_CONFIG)).not.toThrow();
    });

    it("does not call setTransformRequest when map has no such method", () => {
        const noTRMap = { someOtherMethod: vi.fn() };
        mockGeoLeafCore(noTRMap);
        installMapLibreBridge(VALID_CONFIG);
        expect(noTRMap.someOtherMethod).not.toHaveBeenCalled();
    });
});

// ─── Deferred install (map not ready at configure() time) ────────────────────

describe("deferred install — map not available at configure() time", () => {
    it("registers a geoleaf:map:ready listener when map is not available", () => {
        delete (globalThis as any).GeoLeaf;
        // Override spy to also capture the once option
        const capturedEvents: string[] = [];
        vi.spyOn(document, "addEventListener").mockImplementation(
            (
                type: string,
                fn: EventListenerOrEventListenerObject,
                options?: boolean | AddEventListenerOptions
            ) => {
                capturedEvents.push(type);
                _tracked.push({ type, fn, options });
                _origAdd(type, fn, options as EventListenerOptions);
            }
        );
        installMapLibreBridge(VALID_CONFIG);
        expect(capturedEvents).toContain("geoleaf:map:ready");
    });

    it("installs setTransformRequest when geoleaf:map:ready fires", () => {
        delete (globalThis as any).GeoLeaf;
        const mapMock = makeMapMock();
        installMapLibreBridge(VALID_CONFIG);
        mockGeoLeafCore(mapMock);
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        expect(mapMock.setTransformRequest).toHaveBeenCalledTimes(1);
    });

    it("installs only once on geoleaf:map:ready (once: true behaviour)", () => {
        delete (globalThis as any).GeoLeaf;
        const mapMock = makeMapMock();
        installMapLibreBridge(VALID_CONFIG);
        mockGeoLeafCore(mapMock);
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        document.dispatchEvent(new CustomEvent("geoleaf:map:ready"));
        // once:true → listener is auto-removed after first dispatch
        expect(mapMock.setTransformRequest).toHaveBeenCalledTimes(1);
    });
});

// ─── setTransformRequest callback behavior ───────────────────────────────────

describe("setTransformRequest callback", () => {
    it("returns undefined for URLs that do not match baseUrl", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        const result = mapMock.callTransformRequest("https://other.example.com/tile.mvt");
        expect(result).toBeUndefined();
    });

    it("returns { url, headers } for matching URL when token is in RAM cache", async () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        // Populate RAM cache (same TokenStore instance used by the bridge)
        await TokenStore.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        installMapLibreBridge(VALID_CONFIG);
        const url = `${BASE_URL}/tiles/14/100/200.mvt`;
        const result = mapMock.callTransformRequest(url);
        expect(result).toEqual({
            url,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    });

    it("returns undefined for matching URL when no token is in RAM cache", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        const result = mapMock.callTransformRequest(`${BASE_URL}/tiles/14/100/200.mvt`);
        expect(result).toBeUndefined();
    });
});

// ─── geoleaf:basemap:change re-install ───────────────────────────────────────

describe("geoleaf:basemap:change re-install", () => {
    it("re-installs setTransformRequest on geoleaf:basemap:change", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        // First call: immediate install (1)
        expect(mapMock.setTransformRequest).toHaveBeenCalledTimes(1);

        document.dispatchEvent(
            new CustomEvent("geoleaf:basemap:change", {
                detail: { key: "satellite", map: mapMock },
            })
        );
        // Second call: basemap change re-install (2)
        expect(mapMock.setTransformRequest).toHaveBeenCalledTimes(2);
    });

    it("uses detail.map from the event when present (fast path)", () => {
        const primaryMap = makeMapMock();
        mockGeoLeafCore(primaryMap);
        installMapLibreBridge(VALID_CONFIG);

        const secondMap = makeMapMock();
        document.dispatchEvent(
            new CustomEvent("geoleaf:basemap:change", {
                detail: { key: "satellite", map: secondMap },
            })
        );
        // secondMap should be called (from detail), not primaryMap again
        expect(secondMap.setTransformRequest).toHaveBeenCalledTimes(1);
    });

    it("falls back to GeoLeaf.Core when detail.map is absent", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        const callsBefore = mapMock.setTransformRequest.mock.calls.length;

        document.dispatchEvent(
            new CustomEvent("geoleaf:basemap:change", {
                detail: { key: "satellite" }, // no map in detail
            })
        );
        // Falls back to globalThis.GeoLeaf.Core.getMap().getNativeMap()
        expect(mapMock.setTransformRequest.mock.calls.length).toBe(callsBefore + 1);
    });

    it("does not throw when detail.map is not a valid MapLibre instance", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(VALID_CONFIG);
        expect(() =>
            document.dispatchEvent(
                new CustomEvent("geoleaf:basemap:change", {
                    detail: { key: "satellite", map: { notAMap: true } },
                })
            )
        ).not.toThrow();
    });
});
