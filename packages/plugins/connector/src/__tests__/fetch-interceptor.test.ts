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
        expect(new Headers(callInit.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
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

    it("🛑 intercepts a PMTiles archive, and keeps its Range header", async () => {
        // The `pmtiles` library reads the archive through THIS `fetch`, on the main thread, with
        // `Range` carried by a `Headers` object; the MapLibre bridge only ever sees the
        // `pmtiles://` URL. Excluded here "because the bridge handles it", the archive carried
        // a token in NEITHER mode — and spreading `init.headers` as an object would have lost
        // `Range` the day it was intercepted.
        await globalThis.fetch(`${BASE_URL}/map.pmtiles`, {
            headers: new Headers({ range: "bytes=0-16383" }),
        });
        const headers = new Headers(backendFetch.mock.calls[0][1]?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
        expect(headers.get("range")).toBe("bytes=0-16383");
    });

    it("🛑 a Headers object on an ordinary request keeps its entries", async () => {
        await globalThis.fetch(`${BASE_URL}/data/layer.geojson`, {
            headers: new Headers({ Accept: "application/geo+json" }),
        });
        const headers = new Headers(backendFetch.mock.calls[0][1]?.headers);
        expect(headers.get("accept")).toBe("application/geo+json");
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("🛑 a Request keeps its own headers, as fetch would", async () => {
        await globalThis.fetch(
            new Request(`${BASE_URL}/data/layer.geojson`, { headers: { "X-Trace": "t-1" } })
        );
        const headers = new Headers(backendFetch.mock.calls[0][1]?.headers);
        expect(headers.get("x-trace")).toBe("t-1");
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("does not intercept .pbf URLs (routed to MapLibre bridge)", async () => {
        await globalThis.fetch(`${BASE_URL}/tiles/14/100/200.pbf`);
        const callInit = backendFetch.mock.calls[0][1];
        expect(callInit?.headers?.Authorization).toBeUndefined();
    });
});

// ─── PMTiles in auth.endpoint mode ────────────────────────────────────────────

describe("mode auth.endpoint — une archive PMTiles porte le jeton stocké", () => {
    it("🛑 l'archive reçoit le jeton du magasin, et garde son Range", async () => {
        vi.resetModules();
        const backendFetch = vi.fn().mockResolvedValue(makeOkResponse(200));
        vi.stubGlobal("fetch", backendFetch);
        const interceptor = await import("../fetch-interceptor.js");
        const { TokenStore } = await import("../token-store.js");
        await TokenStore.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        interceptor.install({ baseUrl: BASE_URL, auth: { endpoint: `${BASE_URL}/auth` } });
        try {
            await globalThis.fetch(`${BASE_URL}/map.pmtiles`, {
                headers: new Headers({ range: "bytes=0-16383" }),
            });
            const headers = new Headers(backendFetch.mock.calls[0]?.[1]?.headers);
            expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
            expect(headers.get("range")).toBe("bytes=0-16383");
        } finally {
            interceptor.uninstall();
            await TokenStore.clear(BASE_URL);
            vi.unstubAllGlobals();
        }
    });
});

// ─── The 401 replay keeps what the request carried ────────────────────────────

describe("le rejeu du 401 garde ce que la requête portait", () => {
    let interceptor: InterceptorModule;
    let backendFetch: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        vi.resetModules();
        let call = 0;
        backendFetch = vi.fn(async (input: RequestInfo | URL) => {
            // A real `fetch` spends a Request's body: reading it twice fails.
            if (input instanceof Request) await input.text();
            return makeOkResponse(++call === 1 ? 401 : 200);
        });
        vi.stubGlobal("fetch", backendFetch);
        interceptor = await import("../fetch-interceptor.js");
        let n = 0;
        interceptor.install({ baseUrl: BASE_URL, getToken: () => `tok.${++n}` });
    });

    afterEach(() => {
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it.each([
        ["un objet", { "Content-Type": "application/json", Prefer: "return=representation" }],
        [
            "un objet Headers",
            new Headers({ "Content-Type": "application/json", Prefer: "return=representation" }),
        ],
    ])(
        "🛑 %s : Content-Type et Prefer survivent au rejeu",
        async (_label: string, sent: HeadersInit) => {
            // A renewed write that loses `Prefer: return=representation` gets no row back, and one
            // that loses `Content-Type` is refused — a refusal the drain does not replay.
            const response = await globalThis.fetch(`${BASE_URL}/data/rows`, {
                method: "PATCH",
                headers: sent,
                body: "{}",
            });
            expect(response.status).toBe(200);
            const replay = new Headers(backendFetch.mock.calls[1]?.[1]?.headers);
            expect(replay.get("content-type")).toBe("application/json");
            expect(replay.get("prefer")).toBe("return=representation");
            expect(replay.get("authorization")).toBe("Bearer tok.3");
        }
    );

    it("🛑 une Request porteuse d'un corps se rejoue — elle n'est pas dépensée par son premier envoi", async () => {
        const response = await globalThis.fetch(
            new Request(`${BASE_URL}/data/rows`, { method: "POST", body: '{"a":1}' })
        );
        expect(response.status).toBe(200);
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

// ─── token mode: a 401 must RENEW, not destroy ───────────────────────────────
//
// 🛑 Every 401 test above goes through `getToken`, i.e. the mode where the HOST holds
// the token. The `auth.endpoint` mode — the one where the plugin holds it and knows how
// to renew it — was covered by NO test, and that is exactly where recovery was dead:
// `TokenStore.clear()` wipes RAM **and** IndexedDB before any attempt, so the re-read
// that follows finds nothing and the refresh delegate is never reached.

describe("mode jeton — un 401 tente le renouvellement AVANT d'effacer quoi que ce soit", () => {
    let interceptor: InterceptorModule;
    let store: Record<string, ReturnType<typeof vi.fn>>;
    let order: string[];
    /** The raw mock, kept apart: after `install()` the global IS the patched function. */
    let rawFetch: ReturnType<typeof vi.fn>;

    /** What the renewal concluded, in the store's vocabulary. */
    type Outcome =
        | { verdict: "renewed"; token: string }
        | { verdict: "refused"; presented: string }
        | { verdict: "unavailable" | "absent" | "superseded" };

    function makeStore(outcome: Outcome) {
        return {
            forceRefresh: vi.fn(async () => {
                order.push("refresh");
                return outcome;
            }),
            clear: vi.fn(async () => {
                order.push("clear");
            }),
            declareSessionDead: vi.fn(async () => {
                order.push("declare");
                return true;
            }),
            getTokenAsync: vi.fn().mockResolvedValue(TOKEN),
            getTokenSync: vi.fn().mockReturnValue(TOKEN),
            load: vi.fn().mockResolvedValue({ token: TOKEN, expiresAt: Date.now() - 1000 }),
            save: vi.fn().mockResolvedValue(undefined),
            _setRefreshFn: vi.fn(),
        };
    }

    beforeEach(() => {
        order = [];
    });

    afterEach(() => {
        interceptor?.uninstall();
        vi.unstubAllGlobals();
        vi.doUnmock("../token-store.js");
    });

    async function mount(outcome: Outcome, fetchImpl: () => Promise<Response>) {
        vi.resetModules();
        store = makeStore(outcome);
        vi.doMock("../token-store.js", () => ({ TokenStore: store }));
        rawFetch = vi.fn().mockImplementation(fetchImpl);
        vi.stubGlobal("fetch", rawFetch);
        interceptor = await import("../fetch-interceptor.js");
        interceptor.install({ baseUrl: BASE_URL, auth: { endpoint: `${BASE_URL}/auth` } });
    }

    it("🛑 tente le renouvellement, et n'efface pas avant de l'avoir tenté", async () => {
        await mount({ verdict: "refused", presented: TOKEN }, async () => makeOkResponse(401));

        await globalThis.fetch(`${BASE_URL}/data.geojson`);

        expect(store["forceRefresh"]).toHaveBeenCalledWith(BASE_URL);
        // The ORDER is the property: erasing first makes the renewal impossible.
        expect(order[0]).toBe("refresh");
    });

    it("le renouvellement RÉUSSI rejoue la requête avec le jeton neuf, sans rien effacer", async () => {
        let call = 0;
        await mount({ verdict: "renewed", token: "neuf.token.sig" }, async () =>
            makeOkResponse(++call === 1 ? 401 : 200)
        );

        const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);

        expect(response.status).toBe(200);
        expect(store["clear"]).not.toHaveBeenCalled();
        expect(store["declareSessionDead"]).not.toHaveBeenCalled();
    });

    it("le renouvellement REFUSÉ déclare la session morte, pour le jeton refusé — la contre-épreuve", async () => {
        // Without it, "do not erase before" would become "never erase", and a dead token
        // would sit in the store being presented for ever.
        await mount({ verdict: "refused", presented: TOKEN }, async () => makeOkResponse(401));

        const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);

        expect(response.status).toBe(401);
        expect(store["declareSessionDead"]).toHaveBeenCalledWith(
            BASE_URL,
            TOKEN,
            expect.any(String)
        );
        expect(order).toEqual(["refresh", "declare"]);
    });

    it.each(["unavailable", "superseded"] as const)(
        "🛑 un renouvellement « %s » n'efface rien et ne déclare rien",
        async (verdict: "unavailable" | "superseded") => {
            await mount({ verdict }, async () => makeOkResponse(401));

            const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);

            expect(response.status).toBe(401);
            expect(store["clear"]).not.toHaveBeenCalled();
            expect(store["declareSessionDead"]).not.toHaveBeenCalled();
        }
    );

    it("🛑 sans session stockée : la réponse d'origine, sans effacement ni auth-error", async () => {
        const original = makeOkResponse(401);
        await mount({ verdict: "absent" }, async () => original);
        const events: Event[] = [];
        const listener = (e: Event): void => {
            events.push(e);
        };
        document.addEventListener("geoleaf:connector:auth-error", listener);

        const response = await globalThis.fetch(`${BASE_URL}/data.geojson`);

        document.removeEventListener("geoleaf:connector:auth-error", listener);
        expect(response).toBe(original);
        expect(store["declareSessionDead"]).not.toHaveBeenCalled();
        expect(events).toHaveLength(0);
    });

    it("🛑 le point de renouvellement n'est PAS intercepté — sinon il s'attend lui-même", async () => {
        // `AuthClient.refresh` posts to `${endpoint}/refresh` through the GLOBAL
        // `fetch`, hence through this very patch. Intercepting it commits two faults: it
        // would resolve a token — i.e. await the in-flight refresh promise, a deadlock —
        // and it would OVERWRITE the `Authorization` header the request already carries,
        // the expired token it exists to present.
        await mount({ verdict: "absent" }, async () => makeOkResponse(200));
        rawFetch.mockClear();
        store["getTokenAsync"].mockClear();

        await globalThis.fetch(`${BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { Authorization: "Bearer perime.token.sig" },
        });

        expect(store["getTokenAsync"]).not.toHaveBeenCalled();
        const init = rawFetch.mock.calls[0]?.[1] as RequestInit | undefined;
        expect((init?.headers as Record<string, string>)?.Authorization).toBe(
            "Bearer perime.token.sig"
        );
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
//
// The GeoJSON worker's path. ⚠️ Its first test here was titled "returns Authorization header"
// and asserted `undefined` — the defect written down as expected: in `getToken` mode the hook
// read the plugin's store, which the host never fills. The seam itself (the hook `configure()`
// installs, as the core calls it) is proven in `host-token-paths.test.ts`.

describe("getWorkerHeaders", () => {
    let interceptor: InterceptorModule;
    let store: (typeof import("../token-store.js"))["TokenStore"];
    const LAYER = `${BASE_URL}/data.geojson`;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeOkResponse(200)));
        interceptor = await import("../fetch-interceptor.js");
        store = (await import("../token-store.js")).TokenStore;
    });

    afterEach(async () => {
        await store.clear(BASE_URL);
        interceptor.uninstall();
        vi.unstubAllGlobals();
    });

    it("mode getToken : l'en-tête du jeton de l'hôte", () => {
        const headers = interceptor.getWorkerHeaders(LAYER, {
            baseUrl: BASE_URL,
            getToken: () => TOKEN,
        });
        expect(headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    });

    it("mode getToken : une URL d'une autre origine n'a pas d'en-tête", () => {
        const headers = interceptor.getWorkerHeaders("https://other.example.com/data.geojson", {
            baseUrl: BASE_URL,
            getToken: () => TOKEN,
        });
        expect(headers).toBeUndefined();
    });

    it("mode auth.endpoint : l'en-tête du cache mémoire", async () => {
        await store.save(BASE_URL, TOKEN, Date.now() + 3_600_000);
        const headers = interceptor.getWorkerHeaders(LAYER, {
            baseUrl: BASE_URL,
            auth: { endpoint: `${BASE_URL}/auth` },
        });
        expect(headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    });

    it("mode auth.endpoint : rien en cache, pas d'en-tête", () => {
        const headers = interceptor.getWorkerHeaders(LAYER, {
            baseUrl: BASE_URL,
            auth: { endpoint: `${BASE_URL}/auth` },
        });
        expect(headers).toBeUndefined();
    });
});
