/**
 * session-outage.test.ts — what a 401 does to a stored session, with the REAL store, client
 * and interceptor.
 *
 * No module is mocked here, deliberately. The defect this suite exists for lived in the SEAM:
 * the client answered `null` for an outage as for a refusal, and the interceptor erased the
 * session on any `null`. Each piece, tested alone with its neighbours mocked, was right about
 * its own contract — only running them together shows a one-minute outage of the
 * authentication server signing the device out.
 *
 * Only the edges are doubled: `fetch` (the servers, and whatever the tests make them answer)
 * and IndexedDB (so that an expired token survives the memory cache, as it does on a device).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeIDBDouble } from "./helpers/idb-double.js";

type ConnectorApi = typeof import("../connector-api.js");
type Store = (typeof import("../token-store.js"))["TokenStore"];

const BASE = "https://api.example.com";
const ENDPOINT = `${BASE}/auth`;
// Dotted values, so the connector's "static token" heuristic stays quiet.
const STORED = "eyJzdG9yZWQ.payload.sig";
const RENEWED = "eyJyZW5ld2Vk.payload.sig";
const FRESH = "eyJmcmVzaA.payload.sig";
const HOUR = 3_600_000;

/** What the renewal endpoint answers — flipped by the tests, read at request time. */
type Renewal = "renewed" | "503" | "network" | "401" | "html";

interface Servers {
    renewal: Renewal;
    renewals: number;
    /** When set, the renewal answers only once it settles — a renewal held in flight. */
    gate: Promise<void> | null;
}

/** The two fake servers: the renewal endpoint, and an API that accepts only the renewed token. */
function serve(state: Servers) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url === `${ENDPOINT}/refresh`) {
            state.renewals += 1;
            if (state.gate) await state.gate;
            switch (state.renewal) {
                case "network":
                    throw new TypeError("Failed to fetch");
                case "503":
                    return new Response("", { status: 503 });
                case "401":
                    return new Response("", { status: 401 });
                case "html":
                    return new Response("<!doctype html><title>Sign in</title>", { status: 200 });
                default:
                    return new Response(JSON.stringify({ token: RENEWED, expiresIn: 3600 }), {
                        status: 200,
                    });
            }
        }
        const authorization = new Headers(init?.headers).get("authorization");
        return new Response("{}", { status: authorization === `Bearer ${RENEWED}` ? 200 : 401 });
    });
}

const WATCHED = ["geoleaf:connector:auth-error", "geoleaf:connector:token-refreshed"] as const;

describe("une session sur un 401 — ce qui l'efface, et ce qui ne doit pas", () => {
    let api: ConnectorApi;
    let store: Store;
    let state: Servers;
    let events: string[];
    const record = (event: Event): void => {
        events.push(event.type);
    };

    /**
     * Loads the plugin fresh, with a session stored (unless `stored` is null), then configures
     * it in `auth.endpoint` mode.
     *
     * ⚠️ `fetch` is stubbed BEFORE the import: the interceptor captures it at import time.
     */
    async function mount(
        renewal: Renewal,
        stored: { token: string; expiresAt: number } | null = {
            token: STORED,
            expiresAt: Date.now() + HOUR,
        }
    ): Promise<void> {
        vi.resetModules();
        vi.stubGlobal("indexedDB", makeIDBDouble());
        state = { renewal, renewals: 0, gate: null };
        vi.stubGlobal("fetch", serve(state));
        store = (await import("../token-store.js")).TokenStore;
        api = await import("../connector-api.js");
        if (stored) await store.save(BASE, stored.token, stored.expiresAt);
        // Without a session and without `auth.ui`, `configure()` refuses to finish — after
        // having installed the interceptor, which is all these tests need.
        await api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } }).catch(() => undefined);
    }

    beforeEach(() => {
        events = [];
        for (const name of WATCHED) document.addEventListener(name, record);
    });

    afterEach(async () => {
        for (const name of WATCHED) document.removeEventListener(name, record);
        // ⚠️ The queue resume is held on `globalThis`, so it survives `vi.resetModules()`: left
        // armed, one test's listener answers the next test's events and hides its defects.
        (await import("../session-resume.js")).disarmSessionResume();
        delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each([
        ["répond 503", "503"],
        ["est injoignable", "network"],
    ] as const)(
        "🛑 un 401 dont le renouvellement %s garde la session, sans auth-error",
        async (_label, renewal) => {
            await mount(renewal);

            const response = await fetch(`${BASE}/data/p.json`);

            expect(response.status).toBe(401);
            expect(state.renewals).toBe(1);
            expect((await store.load(BASE))?.token).toBe(STORED);
            expect(events).not.toContain("geoleaf:connector:auth-error");
        }
    );

    it.each([
        ["refusé (401)", "401"],
        ["un 2xx inexploitable", "html"],
    ] as const)(
        "contre-épreuve : un renouvellement %s termine la session, et le dit",
        async (_label, renewal) => {
            // Without it, "keep the session" would become "never end it", and a dead token
            // would be presented for ever.
            await mount(renewal);

            await fetch(`${BASE}/data/p.json`);

            expect(await store.load(BASE)).toBeNull();
            expect(events).toContain("geoleaf:connector:auth-error");
        }
    );

    it("renouvelé : la requête est rejouée avec le jeton neuf", async () => {
        await mount("renewed");

        const response = await fetch(`${BASE}/data/p.json`);

        expect(response.status).toBe(200);
        expect((await store.load(BASE))?.token).toBe(RENEWED);
        expect(events).toContain("geoleaf:connector:token-refreshed");
    });

    it("🛑 sans session stockée, un 401 est rendu tel quel — ni renouvellement, ni auth-error", async () => {
        // A session that does not exist cannot die. After a sign-out, `auth-error` reopened
        // the login window on every protected request — the `signed-out` contract says the
        // opposite.
        await mount("renewed", null);

        const response = await fetch(`${BASE}/data/p.json`);

        expect(response.status).toBe(401);
        expect(state.renewals).toBe(0);
        expect(events).not.toContain("geoleaf:connector:auth-error");
    });

    it("🛑 une déconnexion pendant le renouvellement l'emporte : la session ne ressuscite pas", async () => {
        await mount("renewed");
        let open!: () => void;
        state.gate = new Promise<void>((resolve) => (open = resolve));

        const pending = fetch(`${BASE}/data/p.json`);
        await vi.waitFor(() => expect(state.renewals).toBe(1));
        await api.logout();
        open();
        await pending;

        expect(await store.load(BASE)).toBeNull();
        expect(events).not.toContain("geoleaf:connector:token-refreshed");
    });

    it("🛑 une connexion pendant un renouvellement refusé l'emporte : le jeton neuf reste", async () => {
        await mount("401");
        let open!: () => void;
        state.gate = new Promise<void>((resolve) => (open = resolve));

        const pending = fetch(`${BASE}/data/p.json`);
        await vi.waitFor(() => expect(state.renewals).toBe(1));
        // A sign-in completed meanwhile — the login window stores its token exactly so.
        await store.save(BASE, FRESH, Date.now() + HOUR);
        open();
        await pending;

        expect((await store.load(BASE))?.token).toBe(FRESH);
        expect(events).not.toContain("geoleaf:connector:auth-error");
    });

    it("pendant une panne, une seule tentative de renouvellement par durée d'échange", async () => {
        // Deduplication only merges CONCURRENT attempts: during an outage every request that
        // met a 401 started its own POST. One per exchange window, and the window is the
        // exchange's own time budget — no number of its own.
        vi.useFakeTimers({ toFake: ["Date"] });
        await mount("503");

        await fetch(`${BASE}/data/a.json`);
        await fetch(`${BASE}/data/b.json`);
        expect(state.renewals).toBe(1);

        vi.setSystemTime(Date.now() + 15_001);
        await fetch(`${BASE}/data/c.json`);
        expect(state.renewals).toBe(2);
    });

    it("une session gardée revient : token-refreshed, puis la file repart (requeueAll puis pushOutbox)", async () => {
        const order: string[] = [];
        (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
            Storage: {
                requeueAll: vi.fn(async (reason?: string) => {
                    order.push(`requeueAll:${reason}`);
                    return { requeued: 1 };
                }),
                pushOutbox: vi.fn(async () => {
                    order.push("pushOutbox");
                    return { pushed: 1 };
                }),
            },
        };
        vi.useFakeTimers({ toFake: ["Date"] });
        await mount("503");
        expect((await fetch(`${BASE}/data/a.json`)).status).toBe(401);

        // The authentication server is back; the next request meets the API's 401 again.
        state.renewal = "renewed";
        vi.setSystemTime(Date.now() + 15_001);
        const response = await fetch(`${BASE}/data/b.json`);

        expect(response.status).toBe(200);
        expect(events).toContain("geoleaf:connector:token-refreshed");
        await vi.waitFor(() => expect(order).toEqual(["requeueAll:authRequired", "pushOutbox"]));
    });
});

/**
 * Records the two public gestures of the queue resume, in order, on a stub `GeoLeaf.Storage`.
 * @returns The order list, filled as the connector calls.
 */
function stubQueue(): string[] {
    const order: string[] = [];
    (globalThis as { GeoLeaf?: unknown }).GeoLeaf = {
        Storage: {
            requeueAll: vi.fn(async (reason?: string) => {
                order.push(`requeueAll:${reason}`);
                return { requeued: 1 };
            }),
            pushOutbox: vi.fn(async () => {
                order.push("pushOutbox");
                return { pushed: 1 };
            }),
        },
    };
    return order;
}

/**
 * How a promise settled within `ms` — `"pending"` is how a login window that never closes
 * shows up.
 */
function settle(promise: Promise<unknown>, ms = 250): Promise<string> {
    return Promise.race([
        promise.then(
            () => "resolved",
            (error: unknown) =>
                `rejected: ${error instanceof Error ? error.message : String(error)}`
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), ms)),
    ]);
}

describe("un démarrage à jeton expiré — ce qui doit ouvrir la fenêtre, et ce qui ne doit pas", () => {
    let api: ConnectorApi;
    let store: Store;
    let state: Servers;

    /** Loads the plugin fresh, with `stored` in the database — nothing configured yet. */
    async function load(
        renewal: Renewal,
        stored: { token: string; expiresAt: number } | null
    ): Promise<void> {
        vi.resetModules();
        vi.stubGlobal("indexedDB", makeIDBDouble());
        state = { renewal, renewals: 0, gate: null };
        vi.stubGlobal("fetch", serve(state));
        store = (await import("../token-store.js")).TokenStore;
        api = await import("../connector-api.js");
        (await import("../session-resume.js")).disarmSessionResume();
        if (stored) await store.save(BASE, stored.token, stored.expiresAt);
    }

    const expired = (): { token: string; expiresAt: number } => ({
        token: STORED,
        expiresAt: Date.now() - 60_000,
    });

    afterEach(async () => {
        for (const overlay of document.querySelectorAll(".gc-overlay")) overlay.remove();
        (await import("../session-resume.js")).disarmSessionResume();
        delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
        vi.unstubAllGlobals();
    });

    it.each([
        ["injoignable, avec interface", "network", true],
        ["injoignable, sans interface", "network", false],
        ["en 503, avec interface", "503", true],
    ] as const)(
        "🛑 renouvellement %s : configure se résout, sans fenêtre ni ConfigError",
        async (_label, renewal, ui) => {
            // Opening the application with no network, the token expired in the night: the
            // session is asleep, not gone. A login window needs the very network that is
            // missing, and closing it made `configure()` reject — the application booted
            // without a connector.
            await load(renewal, expired());

            const settled = await settle(
                api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT, ui } })
            );

            expect(state.renewals).toBe(1);
            expect(settled).toBe("resolved");
            expect(document.querySelector(".gc-overlay")).toBeNull();
            expect((await store.load(BASE))?.token).toBe(STORED);
        }
    );

    it("contre-épreuve : aucune session et auth.ui — la fenêtre s'ouvre", async () => {
        await load("network", null);

        const settled = await settle(
            api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT, ui: true } })
        );

        expect(settled).toBe("pending");
        expect(document.querySelector(".gc-overlay")).not.toBeNull();
    });

    it("contre-épreuve : aucune session et pas d'interface — ConfigError", async () => {
        await load("network", null);

        expect(
            await settle(api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } }))
        ).toMatch(/^rejected: .*No valid token found/);
    });

    it("contre-épreuve : un renouvellement refusé au démarrage ouvre la fenêtre", async () => {
        await load("401", expired());

        const settled = await settle(
            api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT, ui: true } })
        );

        expect(settled).toBe("pending");
        expect(document.querySelector(".gc-overlay")).not.toBeNull();
    });

    it("🛑 un renouvellement réussi au démarrage remet la file en route — la reprise écoute déjà", async () => {
        // The renewal at boot emits `token-refreshed`. If the queue resume were armed after
        // the session is read, that event would leave with nobody listening, and what the
        // previous session set aside would stay aside after the reload.
        const order = stubQueue();
        await load("renewed", expired());

        expect(await settle(api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } }))).toBe(
            "resolved"
        );

        await vi.waitFor(() => expect(order).toEqual(["requeueAll:authRequired", "pushOutbox"]));
    });
});

describe("après une panne passagère, la relance — les moments que le cœur laisse sans personne", () => {
    let api: ConnectorApi;
    let store: Store;
    let state: Servers;
    let events: string[];
    const record = (event: Event): void => {
        events.push(event.type);
    };

    /**
     * A session stored and valid, an API that retired it, a renewal that cannot conclude: the
     * first request leaves the session kept, the relaunch armed, and the drain would be halted.
     */
    async function afterOutage(): Promise<void> {
        vi.resetModules();
        vi.stubGlobal("indexedDB", makeIDBDouble());
        state = { renewal: "network", renewals: 0, gate: null };
        vi.stubGlobal("fetch", serve(state));
        store = (await import("../token-store.js")).TokenStore;
        api = await import("../connector-api.js");
        (await import("../session-resume.js")).disarmSessionResume();
        await store.save(BASE, STORED, Date.now() + HOUR);
        await api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT } });
        expect((await fetch(`${BASE}/data/p.json`)).status).toBe(401);
        expect(state.renewals).toBe(1);
    }

    /** Lets the listeners and the renewal they start run to completion. */
    const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

    beforeEach(() => {
        events = [];
        for (const name of WATCHED) document.addEventListener(name, record);
    });

    afterEach(async () => {
        for (const name of WATCHED) document.removeEventListener(name, record);
        (await import("../session-resume.js")).disarmSessionResume();
        await api?.logout();
        delete (globalThis as { GeoLeaf?: unknown }).GeoLeaf;
        vi.unstubAllGlobals();
    });

    it.each([
        ["le retour du réseau", () => window.dispatchEvent(new Event("online"))],
        ["le retour au premier plan", () => document.dispatchEvent(new Event("visibilitychange"))],
        [
            "une saisie mise en file",
            () => document.dispatchEvent(new CustomEvent("geoleaf:offline:outbox-queued")),
        ],
    ] as const)(
        "🛑 %s retente le renouvellement : token-refreshed, puis la file repart",
        async (_label, trigger) => {
            const order = stubQueue();
            await afterOutage();

            state.renewal = "renewed";
            trigger();

            await vi.waitFor(() => expect(events).toContain("geoleaf:connector:token-refreshed"));
            expect((await store.load(BASE))?.token).toBe(RENEWED);
            await vi.waitFor(() =>
                expect(order).toEqual(["requeueAll:authRequired", "pushOutbox"])
            );
        }
    );

    it("une page masquée ne relance rien", async () => {
        await afterOutage();
        const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        try {
            document.dispatchEvent(new Event("visibilitychange"));
            await settled();
            expect(state.renewals).toBe(1);
        } finally {
            if (visibility) Object.defineProperty(document, "visibilityState", visibility);
            else delete (document as { visibilityState?: unknown }).visibilityState;
        }
    });

    it("toujours injoignable : la relance reste armée, et chaque retour retente une fois", async () => {
        await afterOutage();

        window.dispatchEvent(new Event("online"));
        await vi.waitFor(() => expect(state.renewals).toBe(2));
        window.dispatchEvent(new Event("online"));
        await vi.waitFor(() => expect(state.renewals).toBe(3));

        expect((await store.load(BASE))?.token).toBe(STORED);
        expect(events).not.toContain("geoleaf:connector:auth-error");
    });

    it("un refus pendant la relance termine la session, et la relance se tait", async () => {
        await afterOutage();

        state.renewal = "401";
        window.dispatchEvent(new Event("online"));
        await vi.waitFor(() => expect(events).toContain("geoleaf:connector:auth-error"));
        expect(await store.load(BASE)).toBeNull();

        window.dispatchEvent(new Event("online"));
        await settled();
        expect(state.renewals).toBe(2);
    });

    it("une connexion faite entre-temps désarme la relance", async () => {
        await afterOutage();

        // The login window stores its token, then announces it — exactly so.
        await store.save(BASE, FRESH, Date.now() + HOUR);
        document.dispatchEvent(new CustomEvent("geoleaf:connector:authenticated"));
        window.dispatchEvent(new Event("online"));
        await settled();

        expect(state.renewals).toBe(1);
    });

    it("logout() relâche la relance", async () => {
        // Not observable through the network: after a sign-out the store holds nothing, so a
        // relaunch would find no token to present and stop by itself. What is pinned is the
        // release — no listener of the ended session outlives it.
        await afterOutage();
        const host = globalThis as { __GEOLEAF_CONNECTOR_RENEWAL_RETRY__?: unknown };
        expect(host.__GEOLEAF_CONNECTOR_RENEWAL_RETRY__).toBeDefined();

        await api.logout();

        expect(host.__GEOLEAF_CONNECTOR_RENEWAL_RETRY__).toBeUndefined();
    });

    it("🛑 un démarrage hors réseau arme la relance : au retour du réseau, la session revient", async () => {
        const order = stubQueue();
        vi.resetModules();
        vi.stubGlobal("indexedDB", makeIDBDouble());
        state = { renewal: "network", renewals: 0, gate: null };
        vi.stubGlobal("fetch", serve(state));
        store = (await import("../token-store.js")).TokenStore;
        api = await import("../connector-api.js");
        (await import("../session-resume.js")).disarmSessionResume();
        await store.save(BASE, STORED, Date.now() - 60_000);
        await api.configure({ baseUrl: BASE, auth: { endpoint: ENDPOINT, ui: true } });

        state.renewal = "renewed";
        window.dispatchEvent(new Event("online"));

        await vi.waitFor(() => expect(events).toContain("geoleaf:connector:token-refreshed"));
        await vi.waitFor(() => expect(order).toEqual(["requeueAll:authRequired", "pushOutbox"]));
    });
});
