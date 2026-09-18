/**
 * instance-renewal.test.ts — what an instance of `createConnector()` may touch of the
 * singleton's session, with the REAL store, client and interceptor.
 *
 * 🛑 THE STORE HELD ONE RENEWAL DELEGATE FOR THE PAGE, and an instance installed and removed it.
 * `createConnector({ getToken }).destroy()` left the singleton's next 401 with nothing to renew
 * the session with: erased, and `auth-error` — a path only an explicit refusal may take. An
 * instance built with `auth.endpoint` sent the singleton's renewals to ITS endpoint; and a
 * `configure()` called after an instance sent the instance's renewals to the singleton's.
 *
 * Only the edges are doubled: `fetch` (the servers) and IndexedDB (so that an expired token
 * survives the memory cache, as it does on a device).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeIDBDouble } from "./helpers/idb-double.js";

type ConnectorApi = typeof import("../connector-api.js");
type Store = (typeof import("../token-store.js"))["TokenStore"];

const BASE = "https://api.example.com";
const ENDPOINT = `${BASE}/auth`;
const OTHER = "https://other.example.org";
const OTHER_ENDPOINT = `${OTHER}/auth`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const OTHER_STORED = "eyJvdGhlcg.payload.sig";
const OTHER_RENEWED = "eyJvdGhlclI.payload.sig";
const HOST_TOKEN = "eyJob3N0.payload.sig";
const HOUR = 3_600_000;

/** Renewals received, per endpoint. */
type Servers = { renewals: Record<string, number> };

/**
 * The fake servers: one renewal endpoint per API, each answering its own token, and an API that
 * accepts only the singleton's renewed token.
 */
function serve(servers: Servers) {
    const answers: Record<string, string> = {
        [`${ENDPOINT}/refresh`]: RENEWED,
        [`${OTHER_ENDPOINT}/refresh`]: OTHER_RENEWED,
    };
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const renewed = answers[url];
        if (renewed !== undefined) {
            const endpoint = url.slice(0, -"/refresh".length);
            servers.renewals[endpoint] = (servers.renewals[endpoint] ?? 0) + 1;
            return new Response(JSON.stringify({ token: renewed, expiresIn: 3600 }), {
                status: 200,
            });
        }
        const authorization = new Headers(init?.headers).get("authorization");
        return new Response("{}", { status: authorization === `Bearer ${RENEWED}` ? 200 : 401 });
    });
}

const WATCHED = ["geoleaf:connector:auth-error", "geoleaf:connector:token-refreshed"] as const;

describe("une instance de createConnector() et la session du singleton", () => {
    let api: ConnectorApi;
    let store: Store;
    let servers: Servers;
    let events: string[];
    const record = (event: Event): void => {
        events.push(event.type);
    };

    /** Loads the plugin fresh. ⚠️ `fetch` is stubbed BEFORE the import: the interceptor captures it. */
    async function mount(): Promise<void> {
        vi.resetModules();
        vi.stubGlobal("indexedDB", makeIDBDouble());
        servers = { renewals: {} };
        vi.stubGlobal("fetch", serve(servers));
        store = (await import("../token-store.js")).TokenStore;
        api = await import("../connector-api.js");
    }

    /** The singleton in `auth.endpoint` mode, with a session the API will answer 401 to. */
    async function mountSingleton(): Promise<void> {
        await mount();
        await store.save(BASE, STORED, Date.now() + HOUR);
        await api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } });
    }

    beforeEach(() => {
        events = [];
        for (const name of WATCHED) document.addEventListener(name, record);
    });

    afterEach(async () => {
        for (const name of WATCHED) document.removeEventListener(name, record);
        // ⚠️ The queue resume is held on `globalThis`, so it survives `vi.resetModules()`.
        (await import("../session-resume.js")).disarmSessionResume();
        delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
        vi.unstubAllGlobals();
    });

    it.each([
        ["d'une autre API", OTHER],
        ["de la même API", BASE],
    ])(
        "🛑 le destroy() d'une instance %s laisse au singleton son renouvellement",
        async (_label, baseUrl) => {
            await mountSingleton();
            api.createConnector({ baseUrl, getToken: () => HOST_TOKEN }).destroy();

            const response = await fetch(`${BASE}/data/p.json`);

            expect(servers.renewals[ENDPOINT] ?? 0).toBe(1);
            expect(response.status).toBe(200);
            expect((await store.load(BASE))?.token).toBe(RENEWED);
            expect(events).not.toContain("geoleaf:connector:auth-error");
        }
    );

    it("🛑 une instance à auth.endpoint ne détourne pas le renouvellement du singleton", async () => {
        await mountSingleton();
        api.createConnector({ baseUrl: OTHER, auth: { endpoint: OTHER_ENDPOINT } });

        const response = await fetch(`${BASE}/data/p.json`);

        expect(servers.renewals[OTHER_ENDPOINT] ?? 0).toBe(0);
        expect(servers.renewals[ENDPOINT] ?? 0).toBe(1);
        expect(response.status).toBe(200);
    });

    it("🛑 une instance renouvelle ses lectures par SON point de renouvellement, même après un configure()", async () => {
        await mount();
        await store.save(OTHER, OTHER_STORED, Date.now() - 60_000);
        const instance = api.createConnector({
            baseUrl: OTHER,
            auth: { endpoint: OTHER_ENDPOINT },
        });
        await store.save(BASE, STORED, Date.now() + HOUR);
        await api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } });

        expect(await instance.getTokenAsync()).toBe(OTHER_RENEWED);
        expect(servers.renewals[OTHER_ENDPOINT] ?? 0).toBe(1);
        expect(servers.renewals[ENDPOINT] ?? 0).toBe(0);
    });

    it("contre-épreuve : une reconfiguration sans auth.endpoint retire le délégué de la page", async () => {
        // The singleton still owns the page's delegate, and a mode without renewal must remove
        // it — without it, a `getToken` host would see its API's sessions renewed against an
        // endpoint it no longer declares.
        await mountSingleton();
        await api.configure({ baseUrl: BASE, getToken: () => HOST_TOKEN });

        const outcome = await store.forceRefresh(BASE);

        expect(servers.renewals[ENDPOINT] ?? 0).toBe(0);
        expect(outcome.verdict).not.toBe("renewed");
    });
});
