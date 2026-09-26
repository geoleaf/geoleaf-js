/**
 * The write session, told to the core's pre-departure check.
 *
 * The core authenticates nothing: it cannot know whether captures made off-network will reach
 * the server. When this plugin holds the session (`auth.endpoint`), it registers a reader in the
 * slot the core opens (`GeoLeaf.Sync.registerSessionReader`). What is judged here: the reader
 * says the session as stored — absent, valid, expired — and 🛑 NEVER renews it: a check made
 * before leaving writes nothing, and the store's `resolveSession` would renew an expired token.
 * The real store runs, over the in-memory IndexedDB double.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenStore } from "../token-store.js";
import { registerSessionReader } from "../session-reader.js";
import type { ConnectorConfig } from "../config.js";
import { makeIDBDouble } from "./helpers/idb-double.js";

const BASE = "https://api.example.com";
const TOKEN = "eyJzdG9yZWQ.payload.sig";
const AUTH: ConnectorConfig = { baseUrl: BASE, auth: { endpoint: `${BASE}/auth` } };
const HOST: ConnectorConfig = { baseUrl: BASE, getToken: () => "host-token" };

type Reader = () => Promise<unknown>;

let idb: ReturnType<typeof makeIDBDouble>;
let registered: Reader | null;
const slot = vi.fn((reader: Reader) => {
    registered = reader;
});

beforeEach(async () => {
    idb = makeIDBDouble();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("GeoLeaf", { Sync: { registerSessionReader: slot } });
    registered = null;
    slot.mockClear();
    await TokenStore.clear(BASE);
});

afterEach(async () => {
    await TokenStore.clear(BASE);
    TokenStore._setRefreshFn(null);
    vi.unstubAllGlobals();
});

describe("what the reader says", () => {
    it("absent — nothing stored: captures will wait for a sign-in", async () => {
        registerSessionReader(() => AUTH);
        expect(await registered?.()).toEqual({ state: "absent", expiresAt: null });
    });

    it("valid — the stored token and its expiry, read from the database", async () => {
        const expiresAt = Date.now() + 3_600_000;
        idb._db.set(BASE, { baseUrl: BASE, token: TOKEN, expiresAt });
        registerSessionReader(() => AUTH);
        expect(await registered?.()).toEqual({ state: "valid", expiresAt });
    });

    it("🛑 expired — and read WITHOUT renewing: no renewal, no request, the token left as stored", async () => {
        const expiresAt = Date.now() - 60_000;
        idb._db.set(BASE, { baseUrl: BASE, token: TOKEN, expiresAt });
        const renew = vi.fn(async () => ({ verdict: "unavailable" as const }));
        TokenStore._setRefreshFn(renew);
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);

        registerSessionReader(() => AUTH);
        expect(await registered?.()).toEqual({ state: "expired", expiresAt });

        expect(renew).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(idb._db.get(BASE)).toEqual({ baseUrl: BASE, token: TOKEN, expiresAt });
    });

    it("reads the configuration at each call — a page switched to getToken is not answered for", async () => {
        let config: ConnectorConfig | null = AUTH;
        registerSessionReader(() => config);
        config = HOST;
        expect(await registered?.()).toBeNull();
    });
});

describe("when it registers", () => {
    it("never in getToken mode — the host alone knows the expiry, and its reader stays", () => {
        registerSessionReader(() => HOST);
        expect(slot).not.toHaveBeenCalled();
    });

    it("on a core without the slot (< 3.11.0), nothing — and nothing throws", () => {
        vi.stubGlobal("GeoLeaf", { Sync: {} });
        expect(() => registerSessionReader(() => AUTH)).not.toThrow();
        vi.stubGlobal("GeoLeaf", undefined);
        expect(() => registerSessionReader(() => AUTH)).not.toThrow();
    });
});
