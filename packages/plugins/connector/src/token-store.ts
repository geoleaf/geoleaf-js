/*!
 * GeoLeaf Connector — Token Store
 * IndexedDB persistence + RAM cache + silent refresh for JWT tokens.
 * Standalone IDB wrapper — no external dependencies, no @core imports.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface TokenRecord {
    baseUrl: string;
    token: string;
    expiresAt: number; // timestamp ms
}

/** Refresh delegate — set by entry.ts when auth.endpoint is configured. */
type RefreshFn = (baseUrl: string) => Promise<string | null>;

// ─── IDB constants ────────────────────────────────────────────────────────────

const DB_NAME = "geoleaf-connector";
const DB_VERSION = 1;
const STORE_NAME = "auth-tokens";

// ─── RAM cache ────────────────────────────────────────────────────────────────

const _cache = new Map<string, { token: string; expiresAt: number }>();

// ─── Refresh state ────────────────────────────────────────────────────────────

let _refreshFn: RefreshFn | null = null;
const _refreshPromise = new Map<string, Promise<string | null>>();

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

/** Persists a token to IDB and feeds the RAM cache. expiresAt = timestamp ms. */
async function save(baseUrl: string, token: string, expiresAt: number): Promise<void> {
    _cache.set(baseUrl, { token, expiresAt });
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
    await _idbDelete(baseUrl);
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

async function _doRefresh(baseUrl: string): Promise<string | null> {
    if (!_refreshFn) return null;
    try {
        return await _refreshFn(baseUrl);
    } catch (err) {
        // Propagate as domain event — fetch-interceptor also listens
        if (typeof document !== "undefined") {
            document.dispatchEvent(
                new CustomEvent("geoleaf:connector:auth-error", {
                    detail: {
                        baseUrl,
                        error: err instanceof Error ? err.message : String(err),
                    },
                })
            );
        }
        return null;
    }
}

/** Anti-concurrent refresh — multiple callers join the same in-flight promise. */
async function _refreshToken(baseUrl: string): Promise<string | null> {
    const inflight = _refreshPromise.get(baseUrl);
    if (inflight !== undefined) {
        return inflight;
    }
    const p = _doRefresh(baseUrl).finally(() => _refreshPromise.delete(baseUrl));
    _refreshPromise.set(baseUrl, p);
    return p;
}

// ─── getTokenAsync ────────────────────────────────────────────────────────────

/**
 * IDB → RAM cache → returns token or null if not authenticated / expired.
 *
 * Sequence:
 *  1. RAM cache hit with >30s margin → return immediately (trigger refresh if <5 min)
 *  2. IDB hit with >30s margin → populate RAM, return (trigger refresh if <5 min)
 *  3. Token close to expiry → force refresh
 *  4. No token → return null
 */
async function getTokenAsync(baseUrl: string): Promise<string | null> {
    const now = Date.now();

    // 1. RAM cache — valid with >30s margin
    const cached = _cache.get(baseUrl);
    if (cached && cached.expiresAt > now + 30_000) {
        if (cached.expiresAt - now < 300_000) {
            // Non-blocking proactive refresh
            _refreshToken(baseUrl).catch(() => {
                /* handled in _doRefresh */
            });
        }
        return cached.token;
    }

    // 2. IDB fallback
    const record = await _idbGet(baseUrl);
    if (record && record.expiresAt > now + 30_000) {
        _cache.set(baseUrl, { token: record.token, expiresAt: record.expiresAt });
        if (record.expiresAt - now < 300_000) {
            _refreshToken(baseUrl).catch(() => {
                /* handled in _doRefresh */
            });
        }
        return record.token;
    }

    // 3. Token expired or close to expiry — force refresh
    if (record || cached) {
        return _refreshToken(baseUrl);
    }

    // 4. No token at all
    return null;
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
    load,
    clear,
    getTokenSync,
    getTokenAsync,

    /**
     * Injects a refresh delegate.
     * Called by entry.ts when auth.endpoint is configured.
     * Pass null to disable refresh (e.g. when using getToken callback).
     */
    _setRefreshFn(fn: RefreshFn | null): void {
        _refreshFn = fn;
    },
};
