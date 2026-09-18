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
/**
 * The mode where the plugin holds the token. ⚠️ The memory-cache tests below ran under
 * `VALID_CONFIG` — the `getToken` mode — and thereby asserted the defect: a host-provided token
 * never reached the tiles, since the bridge read only the store the host never fills.
 */
const AUTH_CONFIG = { baseUrl: BASE_URL, auth: { endpoint: `${BASE_URL}/auth` } };

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

describe("setTransformRequest callback — mode auth.endpoint (le magasin de jetons)", () => {
    it("returns undefined for URLs that do not match baseUrl", () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge(AUTH_CONFIG);
        const result = mapMock.callTransformRequest("https://other.example.com/tile.mvt");
        expect(result).toBeUndefined();
    });

    it("returns { url, headers } for matching URL when token is in RAM cache", async () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        // Populate RAM cache (same TokenStore instance used by the bridge)
        await TokenStore.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        installMapLibreBridge(AUTH_CONFIG);
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
        installMapLibreBridge(AUTH_CONFIG);
        const result = mapMock.callTransformRequest(`${BASE_URL}/tiles/14/100/200.mvt`);
        expect(result).toBeUndefined();
    });

    // Regression — bug no. 4: `url.startsWith(baseUrl)` accepted a suffix host and
    // leaked the bearer. isSameOrigin must reject it even with the token cached.
    it("does NOT inject the bearer for a suffix-host URL, even with a cached token", async () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        // Token IS available — so a reject here can only come from the origin guard.
        await TokenStore.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        installMapLibreBridge(AUTH_CONFIG);
        // `${BASE_URL}.evil.net` starts with BASE_URL but is a different origin.
        const result = mapMock.callTransformRequest(`${BASE_URL}.evil.net/tiles/14/100/200.mvt`);
        expect(result).toBeUndefined();
    });

    it("still injects the bearer for a legitimate same-origin tile (discrimination)", async () => {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        await TokenStore.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        installMapLibreBridge(AUTH_CONFIG);
        const url = `${BASE_URL}/tiles/14/100/200.mvt`;
        expect(mapMock.callTransformRequest(url)).toEqual({
            url,
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
    });
});

// ─── getToken mode: the host's token reaches the tiles ───────────────────────

describe("setTransformRequest callback — mode getToken (le jeton de l'hôte)", () => {
    const TILE = `${BASE_URL}/tiles/14/100/200.pbf`;

    function install(getToken: () => string | null | Promise<string | null>) {
        const mapMock = makeMapMock();
        mockGeoLeafCore(mapMock);
        installMapLibreBridge({ baseUrl: BASE_URL, getToken });
        return mapMock;
    }

    afterEach(() => {
        delete (globalThis as { maplibregl?: unknown }).maplibregl;
    });

    it("🛑 un getToken synchrone : { url, headers } du jeton de l'hôte", () => {
        const mapMock = install(() => "host.tok.1");
        expect(mapMock.callTransformRequest(TILE)).toEqual({
            url: TILE,
            headers: { Authorization: "Bearer host.tok.1" },
        });
    });

    it("🛑 un getToken asynchrone sur un moteur qui attend la transformation : une promesse de { url, headers }", async () => {
        (globalThis as { maplibregl?: unknown }).maplibregl = { getVersion: () => "6.7.0" };
        const mapMock = install(async () => "host.tok.1");
        const result = mapMock.callTransformRequest(TILE);
        expect(result).toBeInstanceOf(Promise);
        expect(await result).toEqual({
            url: TILE,
            headers: { Authorization: "Bearer host.tok.1" },
        });
    });

    it("un getToken asynchrone qui rend null : une promesse de { url } — jamais undefined", async () => {
        // MapLibre applies its `|| { url }` fallback to the returned value, not to what a
        // promise resolves to: a promise of undefined would become the request itself.
        (globalThis as { maplibregl?: unknown }).maplibregl = { getVersion: () => "6.7.0" };
        const mapMock = install(async () => null);
        expect(await mapMock.callTransformRequest(TILE)).toEqual({ url: TILE });
    });

    it("un getToken qui rejette (hôte sans réseau) : { url }, sans exception", async () => {
        (globalThis as { maplibregl?: unknown }).maplibregl = { getVersion: () => "6.7.0" };
        const mapMock = install(async () => {
            throw new Error("host session unreachable");
        });
        expect(await mapMock.callTransformRequest(TILE)).toEqual({ url: TILE });
    });

    it("🛑 un moteur antérieur à 5.21 ne reçoit jamais de promesse : undefined", () => {
        // Before 5.21, MapLibre used the returned value AS the request: a promise there breaks
        // every same-origin resource, authenticated or not.
        (globalThis as { maplibregl?: unknown }).maplibregl = { getVersion: () => "5.20.2" };
        const mapMock = install(async () => "host.tok.1");
        expect(mapMock.callTransformRequest(TILE)).toBeUndefined();
    });

    it("🛑 le jeton de l'hôte est relu à chaque tuile — l'hôte le fait tourner, rien ne le copie", () => {
        let token = "host.tok.1";
        const mapMock = install(() => token);
        expect(mapMock.callTransformRequest(TILE)).toMatchObject({
            headers: { Authorization: "Bearer host.tok.1" },
        });
        token = "host.tok.2";
        expect(mapMock.callTransformRequest(TILE)).toMatchObject({
            headers: { Authorization: "Bearer host.tok.2" },
        });
    });

    it("🛑 en mode getToken, le magasin de jetons n'est plus sollicité par tuile", () => {
        const read = vi.spyOn(TokenStore, "getTokenAsync");
        const mapMock = install(() => "host.tok.1");
        mapMock.callTransformRequest(TILE);
        expect(read).not.toHaveBeenCalled();
    });

    it("une URL d'une autre origine : undefined, sans solliciter l'hôte", () => {
        const getToken = vi.fn(() => "host.tok.1");
        const mapMock = install(getToken);
        expect(
            mapMock.callTransformRequest("https://other.example.com/tiles/1/2/3.pbf")
        ).toBeUndefined();
        expect(getToken).not.toHaveBeenCalled();
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
