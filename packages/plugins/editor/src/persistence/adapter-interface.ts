/*!
 * @geoleaf-plugins/editor — Persistence adapter contract
 * © 2026 Mattieu Pottier — MIT License
 *
 * Pure type surface shared by every persistence backend (REST online — S10;
 * Storage queue offline + Auto — S11). Modules depend on
 * {@link EditorPersistenceAdapter}, never on a concrete adapter, so the offline
 * adapters slot in at the factory (`persistence/adapter-factory.ts`) without touching call
 * sites.
 * https://geoleaf.dev
 */
import type { Geometry } from "geojson";

/**
 * A feature about to be persisted. Decoupled from Terra Draw's
 * `GeoJSONStoreFeatures` so the wire contract stays explicit.
 */
export interface EditorFeature {
    /** Host-layer feature id. Absent for a brand-new feature (assigned on save). */
    id?: string;
    /** GeoJSON geometry. */
    geometry: Geometry;
    /** Attribute bag from the form. */
    properties: Record<string, unknown>;
}

/** A feature as confirmed by the backend after a successful save/update. */
export interface SavedFeature {
    /** Server-assigned (or echoed) feature id. */
    id: string;
    /** Target host-layer id. */
    layerId: string;
    /** Persisted geometry (may be normalised server-side). */
    geometry: Geometry;
    /** Persisted attributes. */
    properties: Record<string, unknown>;
    /** Optimistic-concurrency token, when the backend exposes one. */
    version?: string | number;
    /** Raw server payload, for callers that need backend-specific fields. */
    raw?: unknown;
}

/**
 * Discriminates the failure modes a {@link PersistenceError} can carry.
 *
 * 🛑 **`"forbidden"` is not one more label, it is a REPLAY DECISION.** Every
 * refusal returned by `applyEdit` — `deleteNotPermitted` and
 * `layerNotEditable` included — was typed `"network"`, and `auto-adapter.ts`
 * treats `"network"` as **retryable**: a permission refusal was thus presented
 * as a connectivity outage, i.e. as something that will work at the next
 * attempt. It never will.
 *
 * ⚠️ **Do not file `"forbidden"` among the transports.** `_isTransportError`
 * decides the fallback into the queue; adding this case would requeue a write
 * the layer refuses, which is precisely the half of the defect that does not
 * fit in the label.
 *
 * ⚠️ Distinct from `"client"`, which carries a 4xx **from the server**.
 * `"forbidden"` is a LOCAL decision, taken on the layer's declaration, before
 * any request.
 *
 * 🛑 **`"capability"` is the SAME decision taken on the other edge — and the
 * banner above did not prevent it.** A `501` came out as `"network"` through
 * both adapters' catch-all branch, hence **retryable**, hence **queued**: the
 * server says "I do not know this verb" and the client promised to try again.
 * The core had already settled the opposite for its own queue — the 501 is
 * deliberately EXCLUDED from the transient statuses there, goes to immediate
 * quarantine and does not spend the replay budget. The editor aligns here; not
 * a new policy, but the end of a divergence.
 *
 * ⚠️ **Do not file `"capability"` among the transports**, exactly like
 * `"forbidden"`: `_isTransportError` decides the fallback into the queue, and
 * adding it would requeue the write this case exists to get OUT of it. This
 * sentence is not what guards it — the one above already carried the ban and
 * did not stop the defect from living. A test is.
 *
 * ⚠️ Distinct from `"client"` (a 4xx: THIS request is refused, another may
 * pass) and from `"forbidden"` (local decision, before any request).
 * `"capability"` carries a **server** refusal, definitive, bearing on the
 * **verb**: it will only become true again if the server changes.
 */
type PersistenceErrorKind =
    | "network"
    | "timeout"
    | "client"
    | "conflict"
    | "parse"
    | "forbidden"
    | "capability"
    | "unknown";

/**
 * The server declares it does not implement the verb — HTTP 501.
 *
 * The status's single home, next to the {@link PersistenceErrorKind} it
 * produces. Mirror of the core's homonymous constant, which carries the same
 * decision for the offline queue.
 */
export const NOT_IMPLEMENTED_STATUS = 501;

/** Options accepted by the {@link PersistenceError} constructor. */
interface PersistenceErrorOptions {
    /** HTTP status code, when the failure originated from a response. */
    status?: number;
    /** Parsed server body (used by conflict resolution on HTTP 409). */
    serverData?: unknown;
    /** Underlying error, preserved for diagnostics. */
    cause?: unknown;
}

/**
 * Typed persistence failure. Extends `Error` so `instanceof` keeps working;
 * callers branch on {@link PersistenceError.kind} to map the failure to a toast
 * or to the conflict-resolution flow.
 */
export class PersistenceError extends Error {
    readonly kind: PersistenceErrorKind;
    readonly status?: number;
    readonly serverData?: unknown;

    constructor(kind: PersistenceErrorKind, message: string, opts?: PersistenceErrorOptions) {
        super(message);
        this.name = "PersistenceError";
        this.kind = kind;
        if (opts?.status !== undefined) this.status = opts.status;
        this.serverData = opts?.serverData;
        if (opts?.cause !== undefined) {
            (this as { cause?: unknown }).cause = opts.cause;
        }
    }
}

/** Options accepted by {@link EditorPersistenceAdapter.update}. */
export interface UpdateOptions {
    /** Force the write even if the server reports a conflict (client-wins). */
    force?: boolean;
}

/**
 * Payload emitted (DOM event) and handed to conflict resolution when the
 * backend reports an HTTP 409 on a save/update.
 */
export interface ConflictEventDetail {
    /** Host-layer feature id in conflict. */
    featureId: string;
    /** Target host-layer id. */
    layerId: string;
    /** The local edit the user attempted to persist. */
    localFeature: EditorFeature;
    /** The server's current state of the feature (parsed 409 body). */
    serverData: unknown;
}

/**
 * Backend-agnostic persistence contract. Implemented by the REST adapter (S10)
 * and the Storage-queue / Auto adapters (S11). Every method rejects with a
 * {@link PersistenceError} on failure.
 */
export interface EditorPersistenceAdapter {
    /** Creates a new feature on the host layer. */
    save(feature: EditorFeature, layerId: string): Promise<SavedFeature>;
    /** Updates an existing feature on the host layer. */
    update(feature: EditorFeature, layerId: string, opts?: UpdateOptions): Promise<SavedFeature>;
    /** Deletes a feature from the host layer. */
    delete(featureId: string, layerId: string): Promise<void>;
    /** Whether the adapter currently expects writes to reach the backend. */
    isOnline(): boolean;
}
