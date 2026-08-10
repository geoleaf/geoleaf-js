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
 * 🛑 **`"forbidden"` n'est pas une étiquette de plus, c'est une DÉCISION DE REJEU** (tâche 8.7,
 * **B-139**). Tout refus rendu par `applyEdit` — `deleteNotPermitted` et `layerNotEditable`
 * compris — était typé `"network"`, et `auto-adapter.ts` traite `"network"` comme
 * **réessayable** : un refus de permission était donc présenté comme une panne de
 * connectivité, c'est-à-dire comme quelque chose qui marchera au prochain essai. Il ne
 * marchera jamais.
 *
 * ⚠️ **Ne pas ranger `"forbidden"` parmi les transports.** `_isTransportError` décide du repli
 * vers la file ; y ajouter ce cas remettrait en file une écriture que la couche refuse, ce qui
 * est précisément la moitié du défaut qui ne tient pas dans l'étiquette.
 *
 * ⚠️ Distinct de `"client"`, qui porte un 4xx **du serveur**. `"forbidden"` est une décision
 * LOCALE, prise sur la déclaration de la couche, avant toute requête.
 */
type PersistenceErrorKind =
    | "network"
    | "timeout"
    | "client"
    | "conflict"
    | "parse"
    | "forbidden"
    | "unknown";

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
