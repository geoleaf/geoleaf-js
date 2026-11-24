/**
 * The `"pair"` contract's session, run for real — store, client, lock, channel — against a
 * fake server that rotates refresh tokens and refuses any replay.
 *
 * 🛑 **THE ASSERTION THAT MATTERS IS `replays === 0`.** A server of this contract may revoke
 * the whole family of a refresh token presented twice: the user is then signed out on every
 * device. Each suite below runs against a server that counts replays.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BroadcastChannel as NodeBroadcastChannel } from "node:worker_threads";
import { makeIDBDouble } from "./helpers/idb-double.js";
import { makeLocksDouble } from "./helpers/locks-double.js";
import { makePairServer } from "./helpers/pair-server.js";

type Store = (typeof import("../token-store.js"))["TokenStore"];
type Sessions = (typeof import("../pair-session.js"))["PairSessions"];

const BASE = "https://api.example.com";
const LOGIN = `${BASE}/auth/token`;
const REFRESH = `${BASE}/auth/refresh`;
const REVOKE = `${BASE}/auth/revoke`;

/** One tab: its own module graph — its own memory — over the device's shared database. */
interface Tab {
    store: Store;
    sessions: Sessions;
    channel: BroadcastChannel | undefined;
}

type ChannelHost = { __GEOLEAF_CONNECTOR_PAIR_CHANNEL__?: BroadcastChannel };

/**
 * Opens a tab. ⚠️ The channel is published on `globalThis`, which every tab of a suite shares:
 * the holder is emptied after arming, so the next tab arms its own instead of closing this one.
 * Two `BroadcastChannel` objects of the same name then talk, as two tabs do.
 */
async function openTab(): Promise<Tab> {
    vi.resetModules();
    const store = (await import("../token-store.js")).TokenStore;
    const sessions = (await import("../pair-session.js")).PairSessions;
    store._setRefreshFn(sessions.renewal(REFRESH));
    sessions.armChannel(BASE);
    const host = globalThis as ChannelHost;
    const channel = host.__GEOLEAF_CONNECTOR_PAIR_CHANNEL__;
    delete host.__GEOLEAF_CONNECTOR_PAIR_CHANNEL__;
    return { store, sessions, channel };
}

const settle = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let idb: ReturnType<typeof makeIDBDouble>;
let locks: ReturnType<typeof makeLocksDouble>;
let server: ReturnType<typeof makePairServer>;
const tabs: Tab[] = [];

/** A device that signed in before this page loaded: the refresh token stored, nothing else. */
function seedDevice(): string {
    const pair = server.seed();
    idb._db.set(BASE, { baseUrl: BASE, refreshToken: pair.refresh_token });
    return pair.refresh_token;
}

beforeEach(() => {
    idb = makeIDBDouble();
    locks = makeLocksDouble();
    server = makePairServer({ loginUrl: LOGIN, refreshUrl: REFRESH, revokeUrl: REVOKE });
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("fetch", vi.fn(server.fetch));
    // The test environment has no `BroadcastChannel`: Node's delivers between two objects of
    // the same name in one thread, which is what two tabs need.
    vi.stubGlobal("BroadcastChannel", NodeBroadcastChannel);
    Object.defineProperty(globalThis.navigator, "locks", { value: locks, configurable: true });
});

afterEach(() => {
    for (const tab of tabs.splice(0)) tab.channel?.close();
    delete (globalThis.navigator as { locks?: unknown }).locks;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function tab(): Promise<Tab> {
    const opened = await openTab();
    tabs.push(opened);
    return opened;
}

describe("contrat pair — la session d'un onglet", () => {
    it("🛑 au chargement, aucun jeton d'accès n'existe : la reprise renouvelle d'abord", async () => {
        seedDevice();
        const { store } = await tab();
        const session = await store.resolveSession(BASE);
        expect(session).toEqual({ token: "at-2" });
        expect(server.renewals).toBe(1);
        expect(server.requests[0]?.body).toEqual({ refresh_token: "rt-1" });
    });

    it("🛑 la base ne contient JAMAIS le jeton d'accès — seulement celui de renouvellement", async () => {
        seedDevice();
        const { store } = await tab();
        await store.resolveSession(BASE);
        const record = idb._db.get(BASE);
        expect(record).toEqual({ baseUrl: BASE, refreshToken: "rt-2" });
        expect(JSON.stringify(record)).not.toContain("at-");
    });

    it("chaque renouvellement présente le jeton que le précédent a reçu (rotation)", async () => {
        seedDevice();
        const { store } = await tab();
        await store.forceRefresh(BASE);
        await store.forceRefresh(BASE);
        const presented = server.requests.map((r) => r.body["refresh_token"]);
        expect(presented).toEqual(["rt-1", "rt-2"]);
        expect(server.replays).toBe(0);
        expect(store.getTokenSync(BASE)).toBe("at-3");
    });

    it("le renouvellement passe par le verrou de l'appareil", async () => {
        seedDevice();
        const { store } = await tab();
        await store.forceRefresh(BASE);
        expect(locks._requests).toBe(1);
    });

    it("passé 80 % de expires_in, une lecture renouvelle en arrière-plan — pas avant", async () => {
        const now = Date.now();
        const clock = vi.spyOn(Date, "now").mockReturnValue(now);
        const { store, sessions } = await tab();
        server.seed(); // rt-1 is the device's, unused here
        await sessions.establish(BASE, {
            accessToken: "at-x",
            expiresIn: 1000,
            refreshToken: "rt-1",
        });
        clock.mockReturnValue(now + 790_000);
        expect(await store.resolveSession(BASE)).toEqual({ token: "at-x" });
        await settle(30);
        expect(server.renewals).toBe(0);

        clock.mockReturnValue(now + 810_000);
        expect(await store.resolveSession(BASE)).toEqual({ token: "at-x" });
        await settle(30);
        expect(server.renewals).toBe(1);
    });

    it("un jeton de renouvellement refusé met fin à la session", async () => {
        idb._db.set(BASE, { baseUrl: BASE, refreshToken: "rt-unknown" });
        const { store } = await tab();
        expect(await store.resolveSession(BASE)).toEqual({ token: null, verdict: "refused" });
    });

    it("refresh_expires_in est lu et stocké — il borne la session", async () => {
        server = makePairServer({
            loginUrl: LOGIN,
            refreshUrl: REFRESH,
            revokeUrl: REVOKE,
            refreshExpiresIn: 7200,
        });
        vi.stubGlobal("fetch", vi.fn(server.fetch));
        seedDevice();
        const { store } = await tab();
        const before = Date.now();
        await store.resolveSession(BASE);
        const record = await store.readPairRecord(BASE);
        expect(record?.refreshExpiresAt).toBeGreaterThanOrEqual(before + 7_200_000);
    });
});

describe("contrat pair — deux onglets, un seul appareil", () => {
    it("🛑 deux onglets qui renouvellent à la fois ne présentent JAMAIS deux fois le même jeton", async () => {
        seedDevice();
        const a = await tab();
        const b = await tab();
        const [sa, sb] = await Promise.all([
            a.store.resolveSession(BASE),
            b.store.resolveSession(BASE),
        ]);
        expect(server.replays).toBe(0);
        expect(sa.token).not.toBeNull();
        expect(sb.token).not.toBeNull();
    });

    it("🛑 le second onglet reçoit la paire diffusée, sans renouvellement de son cru", async () => {
        seedDevice();
        const a = await tab();
        const b = await tab();
        const [sa, sb] = await Promise.all([
            a.store.resolveSession(BASE),
            b.store.resolveSession(BASE),
        ]);
        expect(server.renewals).toBe(1);
        expect(sb).toEqual(sa);
        expect(sa).toEqual({ token: "at-2" });
    });

    it("un renouvellement d'un onglet alimente la mémoire de l'autre et y annonce token-refreshed", async () => {
        seedDevice();
        const a = await tab();
        const b = await tab();
        const announced = vi.fn();
        document.addEventListener("geoleaf:connector:token-refreshed", announced);
        await a.store.forceRefresh(BASE);
        await settle(20);
        document.removeEventListener("geoleaf:connector:token-refreshed", announced);
        expect(b.store.getTokenSync(BASE)).toBe("at-2");
        // One announce in each tab: the renewing one, and the one that received the pair.
        expect(announced).toHaveBeenCalledTimes(2);
    });

    it("sans BroadcastChannel reçu à temps, l'onglet qui attendait renouvelle avec le jeton RELU", async () => {
        seedDevice();
        const a = await tab();
        const b = await tab();
        // B never hears A: its channel is closed.
        b.channel?.close();
        await Promise.all([a.store.resolveSession(BASE), b.store.resolveSession(BASE)]);
        expect(server.replays).toBe(0);
        expect(server.requests.map((r) => r.body["refresh_token"])).toEqual(["rt-1", "rt-2"]);
    }, 5000);

    it("sans navigator.locks, un avertissement unique — la sérialisation se réduit à l'onglet", async () => {
        delete (globalThis.navigator as { locks?: unknown }).locks;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        seedDevice();
        const { store } = await tab();
        await store.forceRefresh(BASE);
        await store.forceRefresh(BASE);
        const lockWarnings = warn.mock.calls.filter((c) =>
            String(c[0]).includes("navigator.locks")
        );
        expect(lockWarnings).toHaveLength(1);
    });
});

describe("contrat pair — connexion et déconnexion", () => {
    it("une connexion stocke la paire sous le verrou et la diffuse aux autres onglets", async () => {
        const a = await tab();
        const b = await tab();
        await a.sessions.establish(BASE, {
            accessToken: "at-login",
            expiresIn: 3600,
            refreshToken: "rt-login",
        });
        await settle(20);
        expect(idb._db.get(BASE)).toEqual({ baseUrl: BASE, refreshToken: "rt-login" });
        expect(b.store.getTokenSync(BASE)).toBe("at-login");
        expect(locks._requests).toBe(1);
    });

    it("🛑 la déconnexion efface d'abord, puis révoque le jeton de renouvellement", async () => {
        seedDevice();
        const a = await tab();
        await a.store.resolveSession(BASE);
        const order: string[] = [];
        const confirmed = await a.sessions.end(BASE, REVOKE, () => {
            order.push(idb._db.has(BASE) ? "announced-before-erasure" : "erased");
        });
        expect(order).toEqual(["erased"]);
        expect(confirmed).toBe(true);
        expect(server.revoked).toEqual(["rt-2"]);
        expect(a.store.getTokenSync(BASE)).toBeNull();
    });

    it("🛑 une révocation qui échoue laisse l'appareil déconnecté", async () => {
        seedDevice();
        const a = await tab();
        await a.store.resolveSession(BASE);
        server.overrides.set(REVOKE, { status: 503 });
        expect(await a.sessions.end(BASE, REVOKE, () => undefined)).toBe(false);
        expect(idb._db.has(BASE)).toBe(false);
        expect(a.store.getTokenSync(BASE)).toBeNull();
    });

    it("un 400 « déjà révoqué » vaut succès", async () => {
        seedDevice();
        const a = await tab();
        await a.store.resolveSession(BASE);
        server.overrides.set(REVOKE, { status: 400 });
        expect(await a.sessions.end(BASE, REVOKE, () => undefined)).toBe(true);
    });

    it("la déconnexion d'un onglet efface la mémoire de l'autre et y annonce signed-out", async () => {
        seedDevice();
        const a = await tab();
        const b = await tab();
        await a.store.resolveSession(BASE);
        await settle(20);
        expect(b.store.getTokenSync(BASE)).toBe("at-2");
        const signedOut = vi.fn();
        document.addEventListener("geoleaf:connector:signed-out", signedOut);
        await a.sessions.end(BASE, undefined, () => undefined);
        await settle(20);
        document.removeEventListener("geoleaf:connector:signed-out", signedOut);
        expect(b.store.getTokenSync(BASE)).toBeNull();
        expect(signedOut).toHaveBeenCalledTimes(1);
    });
});
