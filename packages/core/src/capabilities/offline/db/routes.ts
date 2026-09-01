/*!
 * @geoleaf/core — IndexedDB sub-module: persisted routes
 *
 * Keeps a computed route, its decoded line and the identity of its downloaded corridor, so
 * guidance can resume — and run offline — after the tab is closed.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */
import { Log } from "../../../utils/log/index.js";

/**
 * ## 🛑 Why the version bump is safe, and why the SERVICE WORKER is part of this lot
 *
 * The decision behind this store says the worker and the engine ship together, because
 * "IndexedDB refuses to open below the stored version". That risk is real — for a **versioned**
 * open. This worker does not do one: it calls `indexedDB.open("geoleaf-db")` with no second
 * argument, and a source guard in `sw-core.test.js` refuses any call that carries one, with a
 * witness assertion so it cannot pass on an empty match.
 *
 * ⚠️ **So the constraint is enforced by construction, and the job here is not to break it.**
 * Adding a store is additive: every creation in `_upgradeDatabase` is guarded by
 * `objectStoreNames.contains(...)`, so an old database gains the new store and keeps the rest,
 * and a worker that never names a version opens whatever exists.
 *
 * ## Why the LINE is stored, and not just the route
 *
 * `RouteResult.geometry` is an encoded polyline, and decoding it needs a codec that lives in a
 * plugin. A core store that kept only the encoded form would force every reader to own a
 * decoder — and the repository already has a gate and a scar for helpers copied that way. The
 * decoded line costs more bytes and no coupling.
 *
 * ## Why the corridor is identified but NOT stored here
 *
 * The tiles live in the HTTP cache, where the service worker serves them from. Duplicating
 * them into IndexedDB would double the quota cost of the one feature whose entire point is to
 * fit inside a quota.
 */

/**
 * One persisted route.
 *
 * ⚠️ **Not exported**, deliberately as long as nothing names it. An exported type
 * nobody imports is an orphan, and freezing it in a baseline would be the admission
 * of defect this work forbids. It stays reachable without being named:
 * `Parameters<RoutesAPI["saveRoute"]>[0]` derives it from the signature, so it
 * cannot diverge from it. It will be exported the day a caller genuinely imports it.
 */
interface StoredRoute {
    /** Stable identity, chosen by the caller. */
    id: string;
    /** The route as a provider normalised it, opaque to this store. */
    route: unknown;
    /** Its geometry, DECODED, in `[longitude, latitude]`. See the note above. */
    line: ReadonlyArray<readonly [number, number]>;
    /** Milliseconds since the epoch, at write time. */
    timestamp: number;
    /** Buffer radius of the downloaded corridor, in METRES, or `0` when none was downloaded. */
    corridorBufferM: number;
    /** Zoom levels the corridor covers, or an empty array when none was downloaded. */
    corridorZooms: readonly number[];
}

/** What this sub-module offers. */
export interface RoutesAPI {
    /**
     * Writes a route, replacing any route with the same id.
     *
     * @param entry The route to persist.
     * @returns Nothing. Rejects when the transaction fails.
     */
    saveRoute(entry: StoredRoute): Promise<void>;
    /**
     * Reads one route.
     *
     * @param id Its identity.
     * @returns The route, or `null` when there is none.
     */
    getRoute(id: string): Promise<StoredRoute | null>;
    /**
     * Every persisted route, newest first.
     *
     * @returns The routes.
     */
    listRoutes(): Promise<StoredRoute[]>;
    /**
     * Removes one route.
     *
     * @param id Its identity.
     * @returns Nothing. Resolves even when nothing was stored under `id` — a delete that
     *          reports "not found" makes callers write a read they do not need.
     */
    deleteRoute(id: string): Promise<void>;
}

/** The object store this module owns. */
export const ROUTES_STORE = "routes";

/**
 * Builds the sub-module over an open database.
 *
 * @param db The open database.
 * @returns The API.
 */
function init(db: IDBDatabase): RoutesAPI {
    if (!db) {
        throw new Error("[DB.Routes] Database instance is required");
    }

    /**
     * Runs one transaction and resolves on its COMPLETION, not on the request's success.
     *
     * ⚠️ The distinction is the whole reason this helper exists. A request's `onsuccess` fires
     * while the transaction is still open: resolving there lets a caller believe a write
     * landed when the transaction can still abort — on a quota error, most often, which is
     * exactly the condition this feature operates near.
     *
     * @param mode  Transaction mode.
     * @param body  Issues the request against the store.
     * @returns Whatever `body` produced, once the transaction has committed.
     */
    function run<T>(
        mode: IDBTransactionMode,
        body: (store: IDBObjectStore) => IDBRequest
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let request: IDBRequest;
            try {
                const tx = db.transaction([ROUTES_STORE], mode);
                request = body(tx.objectStore(ROUTES_STORE));
                tx.oncomplete = () => resolve(request.result as T);
                tx.onabort = () => reject(tx.error ?? new Error("[DB.Routes] transaction aborted"));
                tx.onerror = () => reject(tx.error ?? new Error("[DB.Routes] transaction failed"));
            } catch (e) {
                // A missing store on an old database, most often. Rejecting rather than
                // throwing synchronously keeps every caller on one error path.
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        });
    }

    return {
        async saveRoute(entry: StoredRoute): Promise<void> {
            await run<void>("readwrite", (store) => store.put(entry));
            Log.debug(`[DB.Routes] saved ${entry.id}`);
        },

        async getRoute(id: string): Promise<StoredRoute | null> {
            const found = await run<StoredRoute | undefined>("readonly", (store) => store.get(id));
            return found ?? null;
        },

        async listRoutes(): Promise<StoredRoute[]> {
            const all = await run<StoredRoute[]>("readonly", (store) => store.getAll());
            // Newest first: the list a user sees is "what I last prepared", and sorting here
            // rather than at each call site is what keeps two screens from disagreeing.
            return (all ?? []).slice().sort((a, b) => b.timestamp - a.timestamp);
        },

        async deleteRoute(id: string): Promise<void> {
            await run<void>("readwrite", (store) => store.delete(id));
            Log.debug(`[DB.Routes] deleted ${id}`);
        },
    };
}

/**
 * The `routes` sub-module, as the module registry expects it.
 *
 * ⚠️ Exported as an object carrying `init` and not as a bare function:
 * `DBModulesRegistry` indexes its entries by `{ init(db) }`, and a bare function
 * would pass typing there while breaking at initialisation — the registry calls
 * `module.init`, not `module`.
 */
export const DBRoutes = { init };
