/**
 * An in-memory IndexedDB double — just what `token-store.ts` asks of it.
 *
 * Shared by the store's own suite and by the session suites that run the real store: those
 * need a token that SURVIVES the memory cache, since `getTokenSync` evicts an expired entry
 * from memory and only the database still holds it — exactly the state an expired session
 * reaches on a device.
 *
 * ⚠️ It implements `get`, `put` and `delete` on one store, and the success path of `open`.
 * Nothing else: a caller reaching for more gets `undefined` and should extend the double
 * rather than trust a partial one.
 */

/** A record as `token-store.ts` persists it. */
export interface IDBDoubleRecord {
    baseUrl: string;
    token: string;
    expiresAt: number;
}

/** The request shape the store reads: `result`, `error`, and the two callbacks. */
interface RequestDouble<T> {
    result: T | undefined;
    error: unknown;
    onsuccess: ((e: { target: RequestDouble<T> }) => void) | null;
    onerror: ((e: { target: RequestDouble<T> }) => void) | null;
}

/** Settles like an IDB request: on a later microtask, through the callbacks. */
function _request<T>(work: () => T): RequestDouble<T> {
    const request: RequestDouble<T> = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
    };
    void Promise.resolve().then(() => {
        try {
            request.result = work();
            request.onsuccess?.({ target: request });
        } catch (error) {
            request.error = error;
            request.onerror?.({ target: request });
        }
    });
    return request;
}

/**
 * Builds a fresh double. Install it with `vi.stubGlobal("indexedDB", double)`; read or seed its
 * content through `_db`, keyed by `baseUrl`.
 */
export function makeIDBDouble() {
    const records = new Map<string, IDBDoubleRecord>();

    const database = {
        close: (): void => undefined,
        objectStoreNames: { contains: (): boolean => false },
        createObjectStore: (): void => undefined,
        transaction() {
            const tx: { oncomplete: (() => void) | null; objectStore: () => unknown } = {
                oncomplete: null,
                objectStore: () => ({
                    get: (key: string) => _request(() => records.get(key)),
                    put: (value: IDBDoubleRecord) =>
                        _request(() => void records.set(value.baseUrl, value)),
                    delete: (key: string) => _request(() => void records.delete(key)),
                }),
            };
            // The store closes the database on `oncomplete`: fire it once the request settled.
            void Promise.resolve()
                .then(() => undefined)
                .then(() => tx.oncomplete?.());
            return tx;
        },
    };

    return {
        open() {
            const request: RequestDouble<typeof database> & {
                onupgradeneeded: ((e: { target: RequestDouble<typeof database> }) => void) | null;
            } = {
                result: undefined,
                error: null,
                onsuccess: null,
                onerror: null,
                onupgradeneeded: null,
            };
            void Promise.resolve().then(() => {
                request.result = database;
                request.onupgradeneeded?.({ target: request });
                request.onsuccess?.({ target: request });
            });
            return request;
        },
        _db: records,
    };
}
