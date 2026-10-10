/*!
 * GeoLeaf Core (offline capability) — Offline POI Restore (boot wiring)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 * Boot wiring for the offline entity restore (S9 D5). Kept separate from the pure
 * restore logic in `poi-restore.ts` so that logic stays side-effect-free and
 * unit-testable, while this module owns the DOM event lifecycle.
 */
import {
    layerIdentityOf,
    markPendingStatus,
    restorePendingPois,
    type PoiRestoreDeps,
} from "./poi-restore.js";

/** Module guard so the boot listeners are attached at most once. */
let _attached = false;

/**
 * Attaches the boot listeners that push offline entities onto their host layers.
 *
 * Listens on `geoleaf:layers:initial-loaded` (earliest — phase-1 host sources
 * exist) and replays on `geoleaf:app:ready` (net for deferred layers). Both
 * passes are idempotent. Attaches at most once; the returned function detaches.
 *
 * @param deps - Optional injected seams forwarded to {@link restorePendingPois}.
 * @returns A cleanup function that removes the listeners.
 */
export function registerPoiRestore(deps: PoiRestoreDeps = {}): () => void {
    if (typeof document === "undefined" || _attached) return () => {};
    _attached = true;
    const run = (): void => {
        void restorePendingPois(deps);
    };
    document.addEventListener("geoleaf:layers:initial-loaded", run);
    document.addEventListener("geoleaf:app:ready", run);
    return () => {
        document.removeEventListener("geoleaf:layers:initial-loaded", run);
        document.removeEventListener("geoleaf:app:ready", run);
        _attached = false;
    };
}

/** An entity queued in this session whose layer does not hold it yet. */
interface AwaitedEntity {
    layerId: string;
    /** Its identity on the layer; `null` while the store is being read for it. */
    id: string | number | null;
}

/** Module guard so the session listeners are attached at most once. */
let _badgeAttached = false;

/**
 * How many queued entities may wait for their layer at once. A capture on a layer that is
 * never displayed waits for the whole session; beyond the bound the oldest is let go.
 */
const MAX_AWAITED = 500;

/**
 * Bakes the "pending" badge on the entities queued IN THIS SESSION.
 *
 * 🛑 THE ORDER IS WHY THIS IS NOT ONE LINE IN THE WRITE PATH. Measured in a browser: the core
 * announces that the queue moved (`geoleaf:offline:outbox-queued`) BEFORE the capture is on
 * its layer — the editor writes the layer once the write is safe. Marking at the announcement
 * finds nothing to mark. So a queued entity is remembered, and marked at the first
 * `geoleaf:layer:updated` of its layer that finds it there. An entity already on its layer —
 * a served one, modified — is marked at once.
 *
 * ⚠️ The mark is itself a write of the layer, hence announced: the entity leaves the waiting
 * list BEFORE it is marked, so its own announcement finds nothing left to do.
 *
 * A deletion is owed too, but leaves the map: nothing to mark. An annulled pair (a creation
 * deleted before it was sent) stops waiting.
 *
 * @returns A cleanup function that removes the listeners and forgets what was waiting.
 * @example
 * const detach = registerSessionBadge();
 * // … at teardown
 * detach();
 */
export function registerSessionBadge(): () => void {
    if (typeof document === "undefined" || _badgeAttached) return () => {};
    _badgeAttached = true;
    const awaited = new Map<string, AwaitedEntity>();
    const keyOf = (layerId: string, localId: string): string => `${layerId}\u0000${localId}`;

    const settle = (key: string): void => {
        const entity = awaited.get(key);
        if (!entity || entity.id === null) return;
        // Out of the list first: the mark announces the layer, and this runs again.
        awaited.delete(key);
        if (!markPendingStatus(entity.layerId, entity.id)) awaited.set(key, entity);
    };

    const onQueued = (event: Event): void => {
        const detail = (event as CustomEvent).detail as
            | { layerId?: unknown; localId?: unknown; kind?: unknown; annulled?: unknown }
            | undefined;
        if (typeof detail?.layerId !== "string" || typeof detail.localId !== "string") return;
        const { layerId, localId } = detail;
        const key = keyOf(layerId, localId);
        if (detail.kind === "delete" || detail.annulled === true) {
            awaited.delete(key);
            return;
        }
        const entity: AwaitedEntity = { layerId, id: null };
        awaited.delete(key);
        awaited.set(key, entity);
        if (awaited.size > MAX_AWAITED) {
            const oldest = awaited.keys().next().value;
            if (oldest !== undefined) awaited.delete(oldest);
        }
        void layerIdentityOf(layerId, localId).then((id) => {
            // Annulled, or queued again, while the store was read: this answer is stale.
            if (awaited.get(key) !== entity) return;
            entity.id = id;
            settle(key);
        });
    };

    const onLayerUpdated = (event: Event): void => {
        const layerId = ((event as CustomEvent).detail as { layerId?: unknown } | undefined)
            ?.layerId;
        if (typeof layerId !== "string" || awaited.size === 0) return;
        for (const [key, entity] of [...awaited]) {
            if (entity.layerId === layerId) settle(key);
        }
    };

    document.addEventListener("geoleaf:offline:outbox-queued", onQueued);
    document.addEventListener("geoleaf:layer:updated", onLayerUpdated);
    return () => {
        document.removeEventListener("geoleaf:offline:outbox-queued", onQueued);
        document.removeEventListener("geoleaf:layer:updated", onLayerUpdated);
        awaited.clear();
        _badgeAttached = false;
    };
}
