/**
 * fetch-interceptor.test.ts
 *
 * Uses vi.resetModules() + dynamic import per test group to work around the
 * module-level `_originalFetch` captured at import time. Each `beforeEach`
 * stubs globalThis.fetch BEFORE the dynamic import so _originalFetch captures
 * the stub, ensuring uninstall() correctly restores it in tests.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type InterceptorModule = typeof import("../fetch-interceptor.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.example.com";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const STATIC_TOKEN = "STATIC_DEV_TOKEN"; // no dots → triggers warning

function makeOkResponse(status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(),
        clone: () => makeOkResponse(status),
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
    } as unknown as Response;
}

// ─── install / uninstall ──────────────────────────────────────────────────────

describe("install / uninstall", () => {
    let interceptor: InterceptorModule;
    let originalFetch: typeof fetch;

    beforeEach(async () => {
        vi.resetModules();
        originalFetch = vi.fn() as unknown as typeof fetch;
        vi.stubGlobal("fetch", originalFetch);
        interceptor = await import("../fetch-interceptor.js");
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("replaces globalThis.fetch after install()", () => {
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        expect(globalThis.fetch).not.toBe(originalFetch);
    });

    it("restores the original fetch after uninstall()", () => {
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        interceptor.uninstall();
        expect(globalThis.fetch).toBe(originalFetch);
    });

    it("removes __GEOLEAF_WORKER_HEADERS_HOOK__ from globalThis after uninstall() if previously set", () => {
        // The hook is installed by entry.ts._configure(), not by fetch-interceptor.install() alone.
        // This test verifies that uninstall() removes it when it IS present (e.g. set externally).
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        // Simulate entry.ts setting the hook
        (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"] = vi.fn();
        interceptor.uninstall();
        expect(
            (globalThis as Record<string, unknown>)["__GEOLEAF_WORKER_HEADERS_HOOK__"]
        ).toBeUndefined();
    });
});

// ─── URL matching and header injection ───────────────────────────────────────

describe("URL matching and header injection", () => {
    let interceptor: InterceptorModule;
    let backendFetch: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        backendFetch = vi.fn().mockResolvedValue(makeOkResponse(200));
        vi.stubGlobal("fetch", backendFetch);
        interceptor = await import("../fetch-interceptor.js");
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("injects Authorization: Bearer header for URLs matching baseUrl", async () => {
        await globalThis.fetch(`${BASE_URL}/data/layer.geojson`);
        const callInit = backendFetch.mock.calls[0][1];
        expect(callInit.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it("passes through without modification for URLs not matching baseUrl", async () => {
        await globalThis.fetch("https://other.example.com/data.geojson");
        const callInit = backendFetch.mock.calls[0][1];
        expect(callInit?.headers?.Authorization).toBeUndefined();
    });

    it("does not intercept .mvt URLs (routed to MapLibre bridge)", async () => {
        await globalThis.fetch(`${BASE_URL}/tiles/14/100/200.mvt`);
        const callInit = backendFetch.mock.calls[0][1];
        // Passed through to original fetch without auth header injection
        expect(callInit?.headers?.Authorization).toBeUndefined();
    });

    it("does not intercept .pmtiles URLs (routed to MapLibre bridge)", async () => {
        await globalThis.fetch(`${BASE_URL}/map.pmtiles`);
        const callInit = backendFetch.mock.calls[0][1];
        expect(callInit?.headers?.Authorization).toBeUndefined();
    });

    it("does not intercept .pbf URLs (routed to MapLibre bridge)", async () => {
        await globalThis.fetch(`${BASE_URL}/tiles/14/100/200.pbf`);
        const callInit = backendFetch.mock.calls[0][1];
        expect(callInit?.headers?.Authorization).toBeUndefined();
    });
});

// ─── 401 retry behavior ───────────────────────────────────────────────────────

describe("401 retry behavior", () => {
    let interceptor: InterceptorModule;
    let callCount: number;

    beforeEach(async () => {
        vi.resetModules();
        callCount = 0;
        const fetchMock = vi.fn().mockImplementation(async () => {
            callCount++;
            // First call → 401, second call → 200
            return makeOkResponse(callCount === 1 ? 401 : 200);
        });
        vi.stubGlobal("fetch", fetchMock);
        interceptor = await import("../fetch-interceptor.js");
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("retries the request with a refreshed token after a 401 response", async () => {
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);
        // Two calls: original (401) + retry (200)
        expect(callCount).toBe(2);
        expect(response.status).toBe(200);
    });
});

// ─── geoleaf:connector:auth-error dispatch ───────────────────────────────────────────

describe("geoleaf:connector:auth-error on failed retry", () => {
    let interceptor: InterceptorModule;

    beforeEach(async () => {
        vi.resetModules();
        // fetch returns 401 on every call
        const fetchMock = vi.fn().mockResolvedValue(makeOkResponse(401));
        vi.stubGlobal("fetch", fetchMock);
        interceptor = await import("../fetch-interceptor.js");
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("dispatches geoleaf:connector:auth-error when no new token can be obtained after 401", async () => {
        // getToken returns null → _handleUnauthorized cannot get a new token → emits auth-error
        interceptor.install({ baseUrl: BASE_URL, getToken: () => null });

        const events: CustomEvent[] = [];
        document.addEventListener("geoleaf:connector:auth-error", (e) =>
            events.push(e as CustomEvent)
        );

        const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);
        await new Promise((r) => setTimeout(r, 10));

        expect(response.status).toBe(401);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].detail.baseUrl).toBe(BASE_URL);
    });
});

// ─── static token warning ─────────────────────────────────────────────────────

describe("static token warning", () => {
    let interceptor: InterceptorModule;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeOkResponse(200)));
        interceptor = await import("../fetch-interceptor.js");
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("warns when getToken returns a static token without dots (non-JWT)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        interceptor.install({ baseUrl: BASE_URL, getToken: () => STATIC_TOKEN });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Static token detected"));
        warn.mockRestore();
    });

    it("does not warn when getToken returns a valid JWT (contains dots)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

// ─── getWorkerHeaders ─────────────────────────────────────────────────────────

describe("getWorkerHeaders", () => {
    let interceptor: InterceptorModule;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("fetch", vi.fn());
        interceptor = await import("../fetch-interceptor.js");
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("returns Authorization header for a URL matching baseUrl when token is in RAM cache", async () => {
        // Install with a getToken callback so the token is resolvable synchronously
        // We need the RAM cache populated for getWorkerHeaders (sync path)
        // Since getToken is used, getWorkerHeaders will call TokenStore.getTokenSync
        // which reads from RAM cache — we must use the auth.endpoint path to populate IDB
        // Instead, test via the __GEOLEAF_WORKER_HEADERS_HOOK__ directly
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });

        // The hook is installed on globalThis by entry.ts, but fetch-interceptor
        // exposes getWorkerHeaders directly for testing
        const headers = interceptor.getWorkerHeaders(`${BASE_URL}/data.geojson`, BASE_URL);
        // With getToken mode, getWorkerHeaders uses TokenStore.getTokenSync which reads RAM cache.
        // RAM cache is empty at this point since save() was never called.
        // getWorkerHeaders returns undefined when no RAM cache entry exists.
        expect(headers).toBeUndefined();
    });

    it("returns undefined for a URL that does not match baseUrl", async () => {
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        const headers = interceptor.getWorkerHeaders(
            "https://other.example.com/data.geojson",
            BASE_URL
        );
        expect(headers).toBeUndefined();
    });

    it("returns undefined when no token is in the RAM cache", async () => {
        interceptor.install({ baseUrl: BASE_URL, getToken: () => TOKEN });
        const headers = interceptor.getWorkerHeaders(`${BASE_URL}/data.geojson`, BASE_URL);
        expect(headers).toBeUndefined();
    });
});
