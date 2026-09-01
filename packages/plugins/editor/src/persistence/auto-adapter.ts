/*!
 * @geoleaf-plugins/editor — Auto persistence adapter (online ⇄ offline)
 * © 2026 Mattieu Pottier — MIT License
 *
 * Transparent switch between the online REST adapter and the offline Storage
 * queue. Reachability is `navigator.onLine` plus a cached HEAD ping on the API
 * base URL (TTL-debounced to avoid a network round-trip per mutation). A network
 * or timeout failure from REST falls back to the queue so the edit is never lost;
 * conflict (409) and client (4xx) errors propagate untouched — REST already
 * fired the conflict event for the resolution flow.
 * https://geoleaf.dev
 */
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type UpdateOptions,
} from "./adapter-interface.js";

/** Configuration for {@link createAutoAdapter}. */
interface AutoAdapterOptions {
    /** Online backend (REST or collection adapter). */
    rest: EditorPersistenceAdapter;
    /** Offline backend (Storage sync queue). */
    queue: EditorPersistenceAdapter;
    /** API base URL pinged to confirm reachability. Empty → skip the ping. */
    baseUrl?: string;
    /** Injected fetch (tests). Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Ms to cache the reachability probe. Default: `30000`. */
    pingTtlMs?: number;
    /** Ms before the HEAD probe is aborted. Default: `3000`. */
    pingTimeoutMs?: number;
}

/**
 * Whether a failure is a transport error (→ fall back to the queue).
 *
 * 🛑 **THIS LIST IS CLOSED, AND ITS CLOSURE IS THE DECISION.** Add neither
 * `"forbidden"` nor `"capability"`: they are **definitive** refusals. Putting
 * them in would requeue a write no replay will get through — the very defect
 * these two cases were extracted from `"network"` for.
 *
 * ⚠️ **This comment guards nothing, and that must be known.** The
 * `PersistenceErrorKind` banner already carried this ban, and it did not stop
 * a `501` from coming out as `"network"` all that time. What guards the
 * invariant is the test "a capability refusal does not fall back into the
 * queue" (`__tests__/auto-adapter.test.ts`): adding `"capability"` below turns
 * it red on two axes — the promise resolves instead of rejecting, and
 * `queue.save` is called.
 */
function _isTransportError(err: unknown): boolean {
    return err instanceof PersistenceError && (err.kind === "network" || err.kind === "timeout");
}

/** Cached reachability tracker: `navigator.onLine` + a TTL-debounced HEAD ping. */
interface Reachability {
    /** Resolves current reachability, using the cached probe within the TTL. */
    check(): Promise<boolean>;
    /** Marks the backend offline (cached) after a transport failure. */
    markOffline(): void;
    /** Synchronous best-effort flag: cached probe AND `navigator.onLine`. */
    isOnline(): boolean;
}

/** Builds the reachability state machine (cached probe + offline flag). */
function _createReachability(
    baseUrl: string | undefined,
    doFetch: typeof fetch | undefined,
    ttl: number,
    pingTimeout: number
): Reachability {
    let _online = true;
    let _lastPing = -Infinity;

    /** HEAD-probes the base URL. Any HTTP response (even 4xx/5xx) means reachable. */
    async function _ping(): Promise<boolean> {
        if (typeof doFetch !== "function" || !baseUrl) {
            return typeof navigator === "undefined" ? true : navigator.onLine;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), pingTimeout);
        try {
            await doFetch(baseUrl, { method: "HEAD", signal: controller.signal });
            return true;
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        async check(): Promise<boolean> {
            if (typeof navigator !== "undefined" && !navigator.onLine) {
                _online = false;
                return false;
            }
            const now = Date.now();
            if (now - _lastPing < ttl) return _online;
            _lastPing = now;
            _online = await _ping();
            return _online;
        },
        markOffline(): void {
            _online = false;
            _lastPing = Date.now();
        },
        isOnline(): boolean {
            const navOnline = typeof navigator === "undefined" ? true : navigator.onLine;
            return _online && navOnline;
        },
    };
}

/**
 * Creates an {@link EditorPersistenceAdapter} that routes each write to the REST
 * adapter when reachable and to the Storage queue otherwise.
 */
export function createAutoAdapter(opts: AutoAdapterOptions): EditorPersistenceAdapter {
    const net = _createReachability(
        opts.baseUrl,
        opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined),
        opts.pingTtlMs ?? 30_000,
        opts.pingTimeoutMs ?? 3_000
    );

    /**
     * Routes a write to REST when reachable, falling back to the queue on a
     * transport failure (conflict/client errors propagate untouched).
     */
    async function _route<T>(online: () => Promise<T>, offline: () => Promise<T>): Promise<T> {
        if (await net.check()) {
            try {
                return await online();
            } catch (err) {
                if (!_isTransportError(err)) throw err;
                net.markOffline();
            }
        }
        return offline();
    }

    return {
        save: (feature: EditorFeature, layerId: string) =>
            _route(
                () => opts.rest.save(feature, layerId),
                () => opts.queue.save(feature, layerId)
            ),
        update: (feature: EditorFeature, layerId: string, updateOpts?: UpdateOptions) =>
            _route(
                () => opts.rest.update(feature, layerId, updateOpts),
                () => opts.queue.update(feature, layerId, updateOpts)
            ),
        delete: (featureId: string, layerId: string) =>
            _route(
                () => opts.rest.delete(featureId, layerId),
                () => opts.queue.delete(featureId, layerId)
            ),
        isOnline: () => net.isOnline(),
    };
}
