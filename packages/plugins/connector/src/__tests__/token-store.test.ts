import { TokenStore } from "../token-store.js";
// The IndexedDB double is shared with the session suites, which run this store for real.
import { makeIDBDouble } from "./helpers/idb-double.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.example.com";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const EXPIRES_FAR = Date.now() + 3_600_000; // 1 hour from now
const EXPIRES_SOON = Date.now() + 120_000; // 2 minutes from now (< 5 min threshold)
const EXPIRES_PAST = Date.now() - 1_000; // already expired

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TokenStore", () => {
    let idbMock: ReturnType<typeof makeIDBDouble>;
    let originalIndexedDB: IDBFactory;

    beforeEach(async () => {
        idbMock = makeIDBDouble();
        originalIndexedDB = (globalThis as any).indexedDB;
        (globalThis as any).indexedDB = idbMock;
        TokenStore._setRefreshFn(null);
        // Clear any leftover state from previous tests
        await TokenStore.clear(BASE_URL);
    });

    afterEach(async () => {
        await TokenStore.clear(BASE_URL);
        TokenStore._setRefreshFn(null);
        (globalThis as any).indexedDB = originalIndexedDB;
    });

    // ─── getTokenSync ─────────────────────────────────────────────────────────

    describe("getTokenSync", () => {
        it("returns null when RAM cache is empty", () => {
            expect(TokenStore.getTokenSync(BASE_URL)).toBeNull();
        });

        it("returns token when it is in RAM cache", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            expect(TokenStore.getTokenSync(BASE_URL)).toBe(TOKEN);
        });

        it("returns null and evicts entry when token is expired", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);
            expect(TokenStore.getTokenSync(BASE_URL)).toBeNull();
        });
    });

    // ─── save / load ──────────────────────────────────────────────────────────

    describe("save", () => {
        it("populates RAM cache immediately (synchronous effect)", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            expect(TokenStore.getTokenSync(BASE_URL)).toBe(TOKEN);
        });

        it("persists to IDB (async)", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            // Wait a tick for IDB async ops
            await new Promise((r) => setTimeout(r, 20));
            const record = idbMock._db.get(BASE_URL);
            expect(record).toBeDefined();
            expect(record?.token).toBe(TOKEN);
        });
    });

    describe("load", () => {
        it("reads from RAM cache when populated", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            const result = await TokenStore.load(BASE_URL);
            expect(result?.token).toBe(TOKEN);
            expect(result?.expiresAt).toBe(EXPIRES_FAR);
        });

        it("falls back to IDB when RAM cache is empty", async () => {
            // Populate IDB directly
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_FAR,
            });
            // RAM cache is empty — load should read IDB
            const result = await TokenStore.load(BASE_URL);
            expect(result?.token).toBe(TOKEN);
        });

        it("returns null when nothing exists in IDB or RAM", async () => {
            const result = await TokenStore.load(BASE_URL);
            expect(result).toBeNull();
        });
    });

    // ─── clear ────────────────────────────────────────────────────────────────

    describe("clear", () => {
        it("removes the entry from RAM cache", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            await TokenStore.clear(BASE_URL);
            expect(TokenStore.getTokenSync(BASE_URL)).toBeNull();
        });

        it("removes the entry from IDB", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            await new Promise((r) => setTimeout(r, 20));
            await TokenStore.clear(BASE_URL);
            await new Promise((r) => setTimeout(r, 20));
            expect(idbMock._db.has(BASE_URL)).toBe(false);
        });
    });

    // ─── getTokenAsync ────────────────────────────────────────────────────────

    describe("getTokenAsync", () => {
        it("returns valid token from RAM cache without hitting IDB", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            const result = await TokenStore.getTokenAsync(BASE_URL);
            expect(result).toBe(TOKEN);
        });

        it("triggers a non-blocking refresh when token expires in < 5 min", async () => {
            const refreshFn = vi.fn().mockResolvedValue({ verdict: "unavailable" });
            TokenStore._setRefreshFn(refreshFn);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_SOON);
            await TokenStore.getTokenAsync(BASE_URL);
            // Allow microtasks to flush
            await new Promise((r) => setTimeout(r, 20));
            expect(refreshFn).toHaveBeenCalledWith(BASE_URL);
        });

        it("forces a synchronous refresh when token is expired", async () => {
            const newToken = "new-token.payload.sig";
            const refreshFn = vi.fn().mockResolvedValue({ verdict: "renewed", token: newToken });
            TokenStore._setRefreshFn(refreshFn);
            // Manually place an expired record in IDB
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_PAST,
            });
            await TokenStore.getTokenAsync(BASE_URL);
            // Refresh should have been triggered for the expired record
            expect(refreshFn).toHaveBeenCalled();
        });

        it("returns null when no token exists anywhere", async () => {
            const result = await TokenStore.getTokenAsync(BASE_URL);
            expect(result).toBeNull();
        });
    });

    // ─── Concurrent refresh prevention ───────────────────────────────────────

    describe("concurrent refresh deduplication", () => {
        it("joins in-flight refresh promise instead of calling refresh twice", async () => {
            let resolveRefresh!: (v: { verdict: "renewed"; token: string }) => void;
            const refreshPromise = new Promise<{ verdict: "renewed"; token: string }>(
                (res) => (resolveRefresh = res)
            );
            const refreshFn = vi.fn().mockReturnValue(refreshPromise);
            TokenStore._setRefreshFn(refreshFn);

            // Place an expired record so getTokenAsync triggers refresh
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_PAST,
            });

            // Fire two concurrent getTokenAsync calls
            const p1 = TokenStore.getTokenAsync(BASE_URL);
            const p2 = TokenStore.getTokenAsync(BASE_URL);

            resolveRefresh({ verdict: "renewed", token: "refreshed-token.payload.sig" });
            await Promise.all([p1, p2]);

            // refreshFn should only have been called once
            expect(refreshFn).toHaveBeenCalledTimes(1);
        });
    });

    // ─── _setRefreshFn ────────────────────────────────────────────────────────

    describe("_setRefreshFn", () => {
        it("returns null when refresh function is null (no refresh configured)", async () => {
            TokenStore._setRefreshFn(null);
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_PAST,
            });
            const result = await TokenStore.getTokenAsync(BASE_URL);
            expect(result).toBeNull();
        });

        it("🛑 un délégué qui jette conclut « indisponible » — sans auth-error, session gardée", async () => {
            // `auth-error` says the session DIED (core event contract). An exception inside the
            // renewal proves nothing of the kind: it used to announce a death, and the guided
            // reconnection opened a login window that needs the very server that just failed.
            TokenStore._setRefreshFn(async () => {
                throw new Error("auth server unavailable");
            });
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_PAST,
            });

            const events: Event[] = [];
            document.addEventListener("geoleaf:connector:auth-error", (e) => events.push(e));

            expect(await TokenStore.resolveSession(BASE_URL)).toEqual({
                token: null,
                verdict: "unavailable",
            });
            expect(events).toHaveLength(0);
            expect(idbMock._db.get(BASE_URL)?.token).toBe(TOKEN);
        });
    });

    // ─── resolveSession — the session as a caller about to present it sees it ─

    describe("resolveSession", () => {
        it("un jeton valide est rendu tel quel", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            expect(await TokenStore.resolveSession(BASE_URL)).toEqual({ token: TOKEN });
        });

        it("rien de stocké : « absent » — aucune session à renouveler ni à terminer", async () => {
            const refreshFn = vi.fn();
            TokenStore._setRefreshFn(refreshFn);
            expect(await TokenStore.resolveSession(BASE_URL)).toEqual({
                token: null,
                verdict: "absent",
            });
            expect(refreshFn).not.toHaveBeenCalled();
        });

        it.each(["refused", "unavailable"] as const)(
            "un jeton expiré dont le renouvellement conclut « %s » le dit",
            async (verdict: "refused" | "unavailable") => {
                TokenStore._setRefreshFn(async () =>
                    verdict === "refused" ? { verdict, presented: TOKEN } : { verdict }
                );
                idbMock._db.set(BASE_URL, {
                    baseUrl: BASE_URL,
                    token: TOKEN,
                    expiresAt: EXPIRES_PAST,
                });
                expect(await TokenStore.resolveSession(BASE_URL)).toEqual({ token: null, verdict });
            }
        );

        it("sans délégué, un jeton expiré est « refusé » : rien ne pourra le renouveler", async () => {
            TokenStore._setRefreshFn(null);
            idbMock._db.set(BASE_URL, { baseUrl: BASE_URL, token: TOKEN, expiresAt: EXPIRES_PAST });
            expect(await TokenStore.resolveSession(BASE_URL)).toEqual({
                token: null,
                verdict: "refused",
            });
        });

        it("un délégué qui rend une forme inconnue conclut « indisponible »", async () => {
            TokenStore._setRefreshFn((async () => "new.token.sig") as never);
            idbMock._db.set(BASE_URL, { baseUrl: BASE_URL, token: TOKEN, expiresAt: EXPIRES_PAST });
            expect(await TokenStore.resolveSession(BASE_URL)).toEqual({
                token: null,
                verdict: "unavailable",
            });
        });
    });

    // ─── Compare-and-set — a verdict only applies to the token it concerns ───

    describe("saveIfCurrent / declareSessionDead", () => {
        it("saveIfCurrent enregistre quand le jeton présenté est toujours en place", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);
            expect(
                await TokenStore.saveIfCurrent(BASE_URL, TOKEN, "new.token.sig", EXPIRES_FAR)
            ).toBe(true);
            expect((await TokenStore.load(BASE_URL))?.token).toBe("new.token.sig");
        });

        it("🛑 saveIfCurrent n'écrit rien quand le jeton a changé pendant le vol", async () => {
            // A sign-out (or another sign-in) happened while the renewal flew: storing its
            // result would resurrect a session the user ended.
            expect(
                await TokenStore.saveIfCurrent(BASE_URL, TOKEN, "new.token.sig", EXPIRES_FAR)
            ).toBe(false);
            expect(await TokenStore.load(BASE_URL)).toBeNull();
        });

        it("declareSessionDead efface et émet auth-error quand le jeton refusé est en place", async () => {
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_FAR);
            const events: Event[] = [];
            const listener = (e: Event): void => {
                events.push(e);
            };
            document.addEventListener("geoleaf:connector:auth-error", listener);

            expect(await TokenStore.declareSessionDead(BASE_URL, TOKEN, "refused")).toBe(true);

            document.removeEventListener("geoleaf:connector:auth-error", listener);
            expect(await TokenStore.load(BASE_URL)).toBeNull();
            expect(events).toHaveLength(1);
        });

        it("🛑 declareSessionDead n'efface pas un jeton neuf stocké entre-temps, et se tait", async () => {
            await TokenStore.save(BASE_URL, "fresh.token.sig", EXPIRES_FAR);
            const events: Event[] = [];
            const listener = (e: Event): void => {
                events.push(e);
            };
            document.addEventListener("geoleaf:connector:auth-error", listener);

            expect(await TokenStore.declareSessionDead(BASE_URL, TOKEN, "refused")).toBe(false);

            document.removeEventListener("geoleaf:connector:auth-error", listener);
            expect((await TokenStore.load(BASE_URL))?.token).toBe("fresh.token.sig");
            expect(events).toHaveLength(0);
        });
    });

    // ─── The pause after a renewal that did not conclude ─────────────────────

    describe("pause après « indisponible »", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it("pendant la durée d'un échange, forceRefresh conclut « indisponible » sans solliciter le délégué", async () => {
            vi.useFakeTimers({ toFake: ["Date"] });
            const refreshFn = vi.fn().mockResolvedValue({ verdict: "unavailable" });
            TokenStore._setRefreshFn(refreshFn);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);

            expect(await TokenStore.forceRefresh(BASE_URL)).toEqual({ verdict: "unavailable" });
            expect(await TokenStore.forceRefresh(BASE_URL)).toEqual({ verdict: "unavailable" });
            expect(refreshFn).toHaveBeenCalledTimes(1);

            vi.setSystemTime(Date.now() + 15_001);
            await TokenStore.forceRefresh(BASE_URL);
            expect(refreshFn).toHaveBeenCalledTimes(2);
        });

        it("bypassPause passe outre — c'est ce qu'un retour du réseau demande", async () => {
            const refreshFn = vi.fn().mockResolvedValue({ verdict: "unavailable" });
            TokenStore._setRefreshFn(refreshFn);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);

            await TokenStore.forceRefresh(BASE_URL);
            await TokenStore.forceRefresh(BASE_URL, { bypassPause: true });
            expect(refreshFn).toHaveBeenCalledTimes(2);
        });

        it("un enregistrement termine la pause", async () => {
            const refreshFn = vi.fn().mockResolvedValue({ verdict: "unavailable" });
            TokenStore._setRefreshFn(refreshFn);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);

            await TokenStore.forceRefresh(BASE_URL);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_PAST);
            await TokenStore.forceRefresh(BASE_URL);
            expect(refreshFn).toHaveBeenCalledTimes(2);
        });
    });
});
