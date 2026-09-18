/*!
 * GeoLeaf Connector — Token Store
 * IndexedDB persistence + RAM cache + silent refresh for JWT tokens.
 * Standalone IDB wrapper — no external dependencies, no @core imports.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { EXCHANGE_TIMEOUT_MS } from "./auth-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TokenRecord {
    baseUrl: string;
    token: string;
    expiresAt: number; // timestamp ms
}

/**
 * What a renewal attempt concluded, in the store's terms.
 *
 * - `renewed` — the new token, already stored.
 * - `refused` — the renewal cannot succeed. `presented` is the token the server refused, so that
 *   ending the session never erases a DIFFERENT token stored meanwhile.
 * - `unavailable` — the attempt did not conclude; the session is kept.
 * - `absent` — nothing is stored: there is no session to renew, nor to end.
 * - `superseded` — the store changed while the attempt was in flight (a sign-in, a sign-out):
 *   what it learned is about a token that is no longer there, and is dropped.
 */
export type RefreshOutcome =
    | { readonly verdict: "renewed"; readonly token: string }
    | { readonly verdict: "refused"; readonly presented: string }
    | { readonly verdict: "unavailable" | "absent" | "superseded" };

/**
 * The session as a caller about to present it sees it: a token, or why there is none.
 *
 * `unavailable` is the case that must not be read as an absence — a stored session whose
 * renewal could not be reached right now.
 */
export type SessionState =
    | { readonly token: string }
    | { readonly token: null; readonly verdict: "absent" | "refused" | "unavailable" };

/** Refresh delegate — set by `connector-api.ts` when `auth.endpoint` is configured. */
type RefreshFn = (baseUrl: string) => Promise<RefreshOutcome>;

const UNAVAILABLE: RefreshOutcome = { verdict: "unavailable" };

// ─── IDB constants ────────────────────────────────────────────────────────────

const DB_NAME = "geoleaf-connector";
const DB_VERSION = 1;
const STORE_NAME = "auth-tokens";

// ─── RAM cache ────────────────────────────────────────────────────────────────

const _cache = new Map<string, { token: string; expiresAt: number }>();

// ─── Refresh state ────────────────────────────────────────────────────────────

let _refreshFn: RefreshFn | null = null;
const _refreshPromise = new Map<string, Promise<RefreshOutcome>>();

/**
 * Until when no new renewal is attempted, after one that did not conclude.
 *
 * 🛑 **Deduplication only merges CONCURRENT attempts.** During an outage every request that met
 * a 401 started its own POST once the previous one had failed — a map pan meant dozens of them
 * against an authentication server already struggling. One attempt per exchange window
 * ({@link EXCHANGE_TIMEOUT_MS}); the connector's retry triggers (network back, foreground, a new
 * capture) pass it, since each is a change of state worth one more try.
 */
const _pausedUntil = new Map<string, number>();

/** Whether the current outage was reported — once per episode, not once per request. */
const _outageReported = new Set<string>();

// ─── IDB helpers (promise-based, no lib) ─────────────────────────────────────

function _openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "baseUrl" });
            }
        };
        req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
        req.onerror = (e) =>
            reject((e.target as IDBOpenDBRequest).error ?? new Error("IDB open failed"));
    });
}

async function _idbGet(baseUrl: string): Promise<TokenRecord | null> {
    try {
        const db = await _openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const req = tx.objectStore(STORE_NAME).get(baseUrl);
            req.onsuccess = () => resolve((req.result as TokenRecord) ?? null);
            req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
            tx.oncomplete = () => db.close();
        });
    } catch {
        return null; // IDB unavailable — graceful degradation
    }
}

async function _idbPut(record: TokenRecord): Promise<void> {
    try {
        const db = await _openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const req = tx.objectStore(STORE_NAME).put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error("IDB put failed"));
            tx.oncomplete = () => db.close();
        });
    } catch {
        // IDB unavailable — only RAM cache will be used
    }
}

async function _idbDelete(baseUrl: string): Promise<void> {
    try {
        const db = await _openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const req = tx.objectStore(STORE_NAME).delete(baseUrl);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
            tx.oncomplete = () => db.close();
        });
    } catch {
        // ignore
    }
}

// ─── Internal functions ───────────────────────────────────────────────────────

/** A stored or erased token ends any outage in progress: the next renewal may go at once. */
function _endOutage(baseUrl: string): void {
    _pausedUntil.delete(baseUrl);
    _outageReported.delete(baseUrl);
}

/** Persists a token to IDB and feeds the RAM cache. expiresAt = timestamp ms. */
async function save(baseUrl: string, token: string, expiresAt: number): Promise<void> {
    _cache.set(baseUrl, { token, expiresAt });
    _endOutage(baseUrl);
    await _idbPut({ baseUrl, token, expiresAt });
}

/** Reads from RAM cache first, then IDB. Feeds RAM cache on IDB hit. */
async function load(baseUrl: string): Promise<{ token: string; expiresAt: number } | null> {
    const cached = _cache.get(baseUrl);
    if (cached) return cached;
    const record = await _idbGet(baseUrl);
    if (record) {
        _cache.set(baseUrl, { token: record.token, expiresAt: record.expiresAt });
        return { token: record.token, expiresAt: record.expiresAt };
    }
    return null;
}

/** Removes a token from IDB and RAM cache. */
async function clear(baseUrl: string): Promise<void> {
    _cache.delete(baseUrl);
    _endOutage(baseUrl);
    await _idbDelete(baseUrl);
}

/**
 * The token stored right now — memory first, since every write lands there first; then the
 * database, which alone still holds an expired token `getTokenSync` evicted from memory.
 */
async function _storedToken(baseUrl: string): Promise<string | null> {
    const cached = _cache.get(baseUrl);
    if (cached) return cached.token;
    return (await _idbGet(baseUrl))?.token ?? null;
}

/**
 * Stores a renewed token — only if the store still holds the token the renewal presented.
 *
 * 🛑 **A verdict applies to the token it concerns, and to no other.** A renewal in flight while
 * the user signs out would otherwise store its result and resurrect the session they ended —
 * and emit `token-refreshed`, which resumes the queue after a sign-out.
 *
 * @param baseUrl - The API the token authenticates against.
 * @param presented - The token the renewal presented.
 * @param token - The renewed token.
 * @param expiresAt - Its expiry, timestamp ms.
 * @returns `true` when stored, `false` when the store changed meanwhile.
 */
async function saveIfCurrent(
    baseUrl: string,
    presented: string,
    token: string,
    expiresAt: number
): Promise<boolean> {
    if ((await _storedToken(baseUrl)) !== presented) return false;
    await save(baseUrl, token, expiresAt);
    return true;
}

/**
 * Ends a session the server refused: erases it and tells the host — only if the refused token
 * is still the one stored.
 *
 * ⚠️ A sign-in that completed while the refused renewal was in flight stored a NEW token;
 * erasing it, and reopening the login window through `auth-error`, would undo what the user
 * just did. The same compare-and-set as {@link saveIfCurrent}, for the same reason.
 *
 * @param baseUrl - The API the token authenticates against.
 * @param presented - The token the server refused.
 * @param message - The `error` carried by `geoleaf:connector:auth-error`.
 * @returns `true` when the session was ended.
 */
async function declareSessionDead(
    baseUrl: string,
    presented: string,
    message: string
): Promise<boolean> {
    if ((await _storedToken(baseUrl)) !== presented) return false;
    await clear(baseUrl);
    if (typeof document !== "undefined") {
        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:auth-error", { detail: { baseUrl, error: message } })
        );
    }
    return true;
}

/**
 * RAM cache only — NEVER reads IDB.
 * Returns null if not loaded or expired.
 * Used by maplibre-bridge (synchronous transformRequest).
 */
function getTokenSync(baseUrl: string): string | null {
    const entry = _cache.get(baseUrl);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        _cache.delete(baseUrl);
        return null;
    }
    return entry.token;
}

// ─── Refresh internals ────────────────────────────────────────────────────────

const _VERDICTS = new Set(["renewed", "refused", "unavailable", "absent", "superseded"]);

/**
 * The delegate's answer, or `unavailable` when it is not one — a delegate written against the
 * former `string | null` contract must not be read as a renewal, nor as a refusal.
 */
function _asOutcome(value: unknown): RefreshOutcome {
    const verdict = (value as { verdict?: unknown } | null)?.verdict;
    return typeof verdict === "string" && _VERDICTS.has(verdict)
        ? (value as RefreshOutcome)
        : UNAVAILABLE;
}

/** Reports an outage once per episode — the store never talks to the network, it only says so. */
function _reportOutage(baseUrl: string): void {
    if (_outageReported.has(baseUrl)) return;
    _outageReported.add(baseUrl);
    console.warn(
        "[GeoLeaf Connector] The session could not be renewed right now — it is kept, and the " +
            "renewal will be tried again."
    );
}

async function _doRefresh(baseUrl: string): Promise<RefreshOutcome> {
    if (!_refreshFn) {
        // Nothing can renew this session. A stored token is then a refused one: the login
        // window must reopen, rather than a session nothing will ever bring back.
        const stored = await _storedToken(baseUrl);
        return stored ? { verdict: "refused", presented: stored } : { verdict: "absent" };
    }
    try {
        return _asOutcome(await _refreshFn(baseUrl));
    } catch (err) {
        // An exception proves nothing about the session — it is not an explicit refusal.
        console.warn("[GeoLeaf Connector] Renewal failed unexpectedly:", err);
        return UNAVAILABLE;
    }
}

/**
 * Anti-concurrent refresh — callers join the in-flight promise; after an attempt that did not
 * conclude, no new one before the pause ends (see {@link _pausedUntil}).
 */
function _refreshToken(baseUrl: string, bypassPause = false): Promise<RefreshOutcome> {
    const inflight = _refreshPromise.get(baseUrl);
    if (inflight !== undefined) return inflight;
    if (!bypassPause && (_pausedUntil.get(baseUrl) ?? 0) > Date.now()) {
        return Promise.resolve(UNAVAILABLE);
    }
    const p = _doRefresh(baseUrl)
        .then((outcome) => {
            if (outcome.verdict === "unavailable") {
                _pausedUntil.set(baseUrl, Date.now() + EXCHANGE_TIMEOUT_MS);
                _reportOutage(baseUrl);
            }
            return outcome;
        })
        .finally(() => _refreshPromise.delete(baseUrl));
    _refreshPromise.set(baseUrl, p);
    return p;
}

/**
 * The renewal in flight for `baseUrl`, or `null`.
 *
 * For a caller reacting to a change of state (`renewal-retry.ts`): a verdict reached by an
 * attempt that started BEFORE the network came back describes the world before it, and must not
 * be taken for an answer to the event.
 */
function inflightRefresh(baseUrl: string): Promise<RefreshOutcome> | null {
    return _refreshPromise.get(baseUrl) ?? null;
}

// ─── resolveSession / getTokenAsync ───────────────────────────────────────────

/**
 * RAM cache → IDB → renewal, and what came of it.
 *
 * Sequence:
 *  1. RAM cache hit with >30s margin → the token (proactive renewal when <5 min left)
 *  2. IDB hit with >30s margin → populate RAM, the token (same proactive renewal)
 *  3. A token stored, expired or close to it → renewal; its verdict when it does not renew
 *  4. Nothing stored → `absent`
 *
 * @param baseUrl - The API the token authenticates against.
 * @returns The token, or why there is none.
 */
async function resolveSession(baseUrl: string): Promise<SessionState> {
    const now = Date.now();

    // 1. RAM cache — valid with >30s margin
    const cached = _cache.get(baseUrl);
    if (cached && cached.expiresAt > now + 30_000) {
        if (cached.expiresAt - now < 300_000) void _refreshToken(baseUrl);
        return { token: cached.token };
    }

    // 2. IDB fallback
    const record = await _idbGet(baseUrl);
    if (record && record.expiresAt > now + 30_000) {
        _cache.set(baseUrl, { token: record.token, expiresAt: record.expiresAt });
        if (record.expiresAt - now < 300_000) void _refreshToken(baseUrl);
        return { token: record.token };
    }

    // 3. Token expired or close to expiry — renew
    if (record || cached) {
        const outcome = await _refreshToken(baseUrl);
        switch (outcome.verdict) {
            case "renewed":
                return { token: outcome.token };
            case "refused":
            case "unavailable":
            case "absent":
                return { token: null, verdict: outcome.verdict };
            case "superseded": {
                // The store changed while the renewal flew: what it holds NOW decides.
                const current = getTokenSync(baseUrl);
                return current ? { token: current } : { token: null, verdict: "absent" };
            }
        }
    }

    // 4. No token at all
    return { token: null, verdict: "absent" };
}

/**
 * IDB → RAM cache → returns token or null if not authenticated / expired.
 *
 * The token of {@link resolveSession}, for callers that only present it. ⚠️ Its `null` does not
 * say WHY — a caller that decides something from the absence of a token (`configure()`) reads
 * `resolveSession` instead.
 */
async function getTokenAsync(baseUrl: string): Promise<string | null> {
    return (await resolveSession(baseUrl)).token;
}

/**
 * Refreshes unconditionally, whatever the store holds.
 *
 * 🛑 **`getTokenAsync` CANNOT reach the refresh once a token is gone.** Its third branch
 * is guarded by `if (record || cached)`, so the 401 path — which used to clear the store
 * first — landed on branch 4 and returned `null` without ever trying. That guard is
 * right for a READ (nothing to renew when nothing was ever stored); it is wrong for a
 * caller who KNOWS a session existed and wants it renewed.
 *
 * ⚠️ It goes through `_refreshToken`, never `_doRefresh`, so concurrent callers still
 * join the SAME in-flight promise — the anti-concurrency property must not be paid for
 * by the recovery path. The pause after an outage applies too, unless `bypassPause`.
 *
 * @param baseUrl - The API this token authenticates against.
 * @param options - `bypassPause`: try now even within the pause — for a change of state.
 * @returns What the renewal concluded.
 */
async function forceRefresh(
    baseUrl: string,
    options: { readonly bypassPause?: boolean } = {}
): Promise<RefreshOutcome> {
    return _refreshToken(baseUrl, options.bypassPause === true);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persists authentication tokens across reloads.
 *
 * ⚠️ Persistence is the point and the risk: a stored token outlives the page, so sign-out
 * must clear it here and not only in memory. See {@link AuthClient} for the network side.
 */
export const TokenStore = {
    save,
    saveIfCurrent,
    load,
    clear,
    declareSessionDead,
    getTokenSync,
    getTokenAsync,
    resolveSession,
    forceRefresh,
    inflightRefresh,

    /**
     * Injects a refresh delegate.
     * Called by `connector-api.ts` when auth.endpoint is configured.
     * Pass null to disable refresh (e.g. when using getToken callback).
     */
    _setRefreshFn(fn: RefreshFn | null): void {
        _refreshFn = fn;
    },
};
