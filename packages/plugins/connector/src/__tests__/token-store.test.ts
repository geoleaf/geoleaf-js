import { TokenStore } from "../token-store.js";

// ─── IDB mock (no external dependency) ───────────────────────────────────────

interface IDBMockRecord {
    baseUrl: string;
    token: string;
    expiresAt: number;
}

function _makeAsyncReq<T>(fn: () => T): IDBRequest {
    const r: any = {
        result: undefined,
        error: null,
        onsuccess: null as ((e: { target: { result: T } }) => void) | null,
        onerror: null,
    };
    Promise.resolve().then(() => {
        try {
            r.result = fn();
            if (r.onsuccess) r.onsuccess({ target: r });
        } catch (e) {
            r.error = e;
            if (r.onerror) r.onerror({ target: r });
        }
    });
    return r as IDBRequest;
}

function makeIDBMock() {
    const db = new Map<string, IDBMockRecord>();

    const dbObj = {
        close: () => {},
        objectStoreNames: { contains: () => false },
        createObjectStore: () => {},
        transaction(_storeName: string, _mode: string) {
            const tx: any = {
                oncomplete: null as (() => void) | null,
                objectStore() {
                    return {
                        get: (key: string) =>
                            _makeAsyncReq(() => {
                                const rec = db.get(key);
                                Promise.resolve().then(() => {
                                    if (tx.oncomplete) tx.oncomplete();
                                });
                                return rec;
                            }),
                        put: (val: IDBMockRecord) =>
                            _makeAsyncReq(() => {
                                db.set(val.baseUrl, val);
                                Promise.resolve().then(() => {
                                    if (tx.oncomplete) tx.oncomplete();
                                });
                            }),
                        delete: (key: string) =>
                            _makeAsyncReq(() => {
                                db.delete(key);
                                Promise.resolve().then(() => {
                                    if (tx.oncomplete) tx.oncomplete();
                                });
                            }),
                    };
                },
            };
            return tx;
        },
    };

    return {
        open(_name: string, _version: number): IDBOpenDBRequest {
            const req: any = {
                result: null,
                error: null,
                onupgradeneeded: null as ((e: { target: { result: typeof dbObj } }) => void) | null,
                onsuccess: null as ((e: { target: { result: typeof dbObj } }) => void) | null,
                onerror: null,
            };
            Promise.resolve().then(() => {
                req.result = dbObj;
                if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
                if (req.onsuccess) req.onsuccess({ target: req });
            });
            return req as IDBOpenDBRequest;
        },
        _db: db,
    };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.example.com";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.payload.sig";
const EXPIRES_FAR = Date.now() + 3_600_000; // 1 hour from now
const EXPIRES_SOON = Date.now() + 120_000; // 2 minutes from now (< 5 min threshold)
const EXPIRES_PAST = Date.now() - 1_000; // already expired

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TokenStore", () => {
    let idbMock: ReturnType<typeof makeIDBMock>;
    let originalIndexedDB: IDBFactory;

    beforeEach(async () => {
        idbMock = makeIDBMock();
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
            const refreshFn = vi.fn().mockResolvedValue(null);
            TokenStore._setRefreshFn(refreshFn);
            await TokenStore.save(BASE_URL, TOKEN, EXPIRES_SOON);
            await TokenStore.getTokenAsync(BASE_URL);
            // Allow microtasks to flush
            await new Promise((r) => setTimeout(r, 20));
            expect(refreshFn).toHaveBeenCalledWith(BASE_URL);
        });

        it("forces a synchronous refresh when token is expired", async () => {
            const newToken = "new-token.payload.sig";
            const refreshFn = vi.fn().mockResolvedValue(newToken);
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
            let resolveRefresh!: (v: string) => void;
            const refreshPromise = new Promise<string>((res) => (resolveRefresh = res));
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

            resolveRefresh("refreshed-token.payload.sig");
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

        it("dispatches connector:auth-error when refresh function throws", async () => {
            TokenStore._setRefreshFn(async () => {
                throw new Error("auth server unavailable");
            });
            idbMock._db.set(BASE_URL, {
                baseUrl: BASE_URL,
                token: TOKEN,
                expiresAt: EXPIRES_PAST,
            });

            const events: Event[] = [];
            document.addEventListener("connector:auth-error", (e) => events.push(e));

            await TokenStore.getTokenAsync(BASE_URL);
            await new Promise((r) => setTimeout(r, 20));

            const authErrorFired = events.some(
                (e) => (e as CustomEvent).type === "connector:auth-error"
            );
            expect(authErrorFired).toBe(true);
        });
    });
});
