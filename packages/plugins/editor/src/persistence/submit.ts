/*!
 * @geoleaf-plugins/editor — Save / update submission flow
 * © 2026 Mattieu Pottier — MIT License
 *
 * Shared create/update path used by the form modal and the deselect-commit of an
 * edited host feature. Maps persistence outcomes to toasts and events:
 *  - success            → commit host geometry (update) or host the new feature (create)
 *                         + `feature-saved` + toast;
 *  - HTTP 409 conflict  → resolve per strategy (the event was already emitted at
 *                         the adapter boundary), then resolve so the modal closes;
 *  - any other failure  → toast + rethrow so the modal stays open for a retry.
 * https://geoleaf.dev
 */
import { Log } from "@geoleaf/host-runtime";
import { _getLabel, _notify } from "../internal.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
} from "./adapter-interface.js";
import { resolveConflict, type ConflictStrategy } from "./conflict-resolution.js";
import { trackSessionFeature, renameSessionFeature } from "./session-export.js";

/** Detail shape of the `geoleaf:editor:feature-saved` event. */
export interface FeatureSavedDetail {
    featureId: string;
    layerId: string;
    saved: SavedFeature;
    isUpdate: boolean;
}

/** Collaborators wired by entry.ts so this module stays backend/UI-agnostic. */
export interface SubmitContext {
    adapter: EditorPersistenceAdapter;
    strategy: ConflictStrategy;
    /** Commits a saved geometry to the host source (existing-feature updates). */
    commitHost: (layerId: string, featureId: string, geometry: unknown) => void;
    /**
     * Puts a created feature into its host layer; `true` when the layer now holds it.
     * Optional: without it a creation stays where it was drawn, as before.
     */
    addHost?: (layerId: string, saved: SavedFeature) => boolean;
    /** Repaints the host feature from the server state (server-wins). */
    reloadFeature: (serverData: unknown, layerId: string) => void;
    /** Emits the `feature-saved` DOM event. */
    dispatchSaved: (detail: FeatureSavedDetail) => void;
}

/** Arguments for a single submission. */
interface SubmitArgs {
    feature: EditorFeature;
    layerId: string;
    /** true → PUT update of an existing feature; false → POST create. */
    isUpdate: boolean;
}

/** What a submission that did not fail produced. */
export interface SubmitOutcome {
    /** The feature as the write returned it. */
    saved: SavedFeature;
    /** Whether a CREATED feature now lives in its host layer — the drawing copy may go. */
    hosted: boolean;
}

/**
 * Persists a feature. Resolves on success or once a conflict has been handed to
 * resolution (so the caller's modal closes); rejects on a hard failure so the
 * modal stays open for a retry.
 *
 * 🛑 **ONLY THE WRITE CAN REJECT.** What follows it — updating the host layer, the event, the
 * toast — runs once the write has LEFT (to the server or the outbox). A throw there used to
 * keep the form open on a creation already queued, and its "retry" wrote it twice.
 *
 * @param ctx - Collaborators wired by `entry.ts`.
 * @param args - The feature, its layer, and whether it is an update.
 * @returns What was saved, and whether a creation now lives in its host layer; `null` when a
 *   conflict was handed to resolution instead.
 * @throws {Error} when the write itself failed (after a toast), so the form stays open.
 */
export async function submitFeature(
    ctx: SubmitContext,
    args: SubmitArgs
): Promise<SubmitOutcome | null> {
    const { feature, layerId, isUpdate } = args;
    let saved: SavedFeature;
    try {
        saved = isUpdate
            ? await ctx.adapter.update(feature, layerId)
            : await ctx.adapter.save(feature, layerId);
    } catch (err) {
        if (err instanceof PersistenceError && err.kind === "conflict") {
            _scheduleConflict(ctx, feature, layerId, err.serverData);
            return null; // resolve: let the form modal close; conflict modal takes over
        }
        _notifyError(err);
        throw err instanceof Error ? err : new Error(String(err));
    }
    return { saved, hosted: _onSuccess(ctx, saved, feature, layerId, isUpdate) };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Reports the write's outcome to the layer, the session and the page; returns `hosted`. */
function _onSuccess(
    ctx: SubmitContext,
    saved: SavedFeature,
    feature: EditorFeature,
    layerId: string,
    isUpdate: boolean
): boolean {
    // Before `dispatchSaved`, so a listener already finds the feature where its layer holds it.
    const hosted = _updateHost(ctx, saved, feature, layerId, isUpdate);
    // Session tracking. At CREATE we keep the identity the write returned — the server's,
    // or the outbox's client key: the one the host layer now holds it under. At UPDATE we
    // reconcile, otherwise an entity whose update answered with another identity would
    // drop out of the export (tracked under an identifier the layer no longer carries).
    if (!isUpdate) trackSessionFeature(String(saved.id));
    else if (feature.id && String(feature.id) !== String(saved.id)) {
        renameSessionFeature(String(feature.id), String(saved.id));
    }
    ctx.dispatchSaved({ featureId: saved.id, layerId, saved, isUpdate });
    _notify("success", _getLabel("editor.toast.saved"));
    return hosted;
}

/**
 * Brings the host layer up to date with a write that has left: the new geometry of an update,
 * or the created feature itself. Never throws — the write is done, and the layer failing to
 * follow is said in the console rather than turned into a failed save.
 */
function _updateHost(
    ctx: SubmitContext,
    saved: SavedFeature,
    feature: EditorFeature,
    layerId: string,
    isUpdate: boolean
): boolean {
    try {
        if (!isUpdate) return ctx.addHost?.(layerId, saved) ?? false;
        if (feature.id) ctx.commitHost(layerId, feature.id, saved.geometry);
    } catch (err) {
        Log?.warn?.("[GeoLeaf.Editor] Saved, but the host layer could not follow:", err);
    }
    return false;
}

/** Hands a 409 to the configured strategy without blocking the caller. */
function _scheduleConflict(
    ctx: SubmitContext,
    feature: EditorFeature,
    layerId: string,
    serverData: unknown
): void {
    void resolveConflict(
        { featureId: feature.id ?? "", layerId, localFeature: feature, serverData },
        ctx.strategy,
        {
            adapter: ctx.adapter,
            reloadFeature: ctx.reloadFeature,
            onResolvedLocal: (saved) => {
                if (feature.id) ctx.commitHost(layerId, feature.id, saved.geometry);
                ctx.dispatchSaved({ featureId: saved.id, layerId, saved, isUpdate: true });
                _notify("success", _getLabel("editor.toast.saved"));
            },
        }
    ).catch((e) => _notifyError(e));
}

/** Maps a failure to a user-facing toast. */
function _notifyError(err: unknown): void {
    let key = "editor.error.server";
    if (err instanceof PersistenceError) {
        if (err.kind === "timeout") key = "editor.error.networkTimeout";
        // 🛑 THE FIX'S VISIBLE HALF. Without this branch, a PERMISSION refusal
        // fell on `editor.error.server` — "Erreur serveur. Veuillez réessayer."
        // — i.e. we invited the user to retry an operation the layer will
        // always refuse. The refusal now names itself for what it is.
        //
        // ⚠️ And it does NOT blur with `permissionDenied`, despite the kinship of
        // words: that one carries a 401/403 **from the server** (YOU are
        // refused, reconnecting may help), this one carries the layer's
        // declaration (the operation is refused to everyone, there is nothing
        // to try). Two causes, two gestures, two labels.
        else if (err.kind === "forbidden") key = "editor.error.editionNotPermitted";
        // 🛑 THE 501 DEFECT'S VISIBLE HALF, on the exact pattern of the branch
        // above. A 501 also fell on "Erreur serveur. Veuillez réessayer." — the
        // one thing that will serve nothing, since the server does not know the
        // verb. Fixing the queue WITHOUT this branch would leave the machine
        // right and the user deceived: the half of the defect that does not fit
        // in the label.
        else if (err.kind === "capability") key = "editor.error.operationNotSupported";
        else if (err.kind === "client" && (err.status === 401 || err.status === 403)) {
            key = "editor.error.permissionDenied";
        }
    }
    _notify("error", _getLabel(key));
}
