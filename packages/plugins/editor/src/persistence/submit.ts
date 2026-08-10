/*!
 * @geoleaf-plugins/editor — Save / update submission flow
 * © 2026 Mattieu Pottier — MIT License
 *
 * Shared create/update path used by the form modal and the deselect-commit of an
 * edited host feature. Maps persistence outcomes to toasts and events:
 *  - success            → commit host geometry (updates only) + `feature-saved` + toast;
 *  - HTTP 409 conflict  → resolve per strategy (the event was already emitted at
 *                         the adapter boundary), then resolve so the modal closes;
 *  - any other failure  → toast + rethrow so the modal stays open for a retry.
 * https://geoleaf.dev
 */
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

/**
 * Persists a feature. Resolves on success or once a conflict has been handed to
 * resolution (so the caller's modal closes); rejects on a hard failure so the
 * modal stays open for a retry.
 */
export async function submitFeature(ctx: SubmitContext, args: SubmitArgs): Promise<void> {
    const { feature, layerId, isUpdate } = args;
    try {
        const saved = isUpdate
            ? await ctx.adapter.update(feature, layerId)
            : await ctx.adapter.save(feature, layerId);
        _onSuccess(ctx, saved, feature, layerId, isUpdate);
    } catch (err) {
        if (err instanceof PersistenceError && err.kind === "conflict") {
            _scheduleConflict(ctx, feature, layerId, err.serverData);
            return; // resolve: let the form modal close; conflict modal takes over
        }
        _notifyError(err);
        throw err instanceof Error ? err : new Error(String(err));
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function _onSuccess(
    ctx: SubmitContext,
    saved: SavedFeature,
    feature: EditorFeature,
    layerId: string,
    isUpdate: boolean
): void {
    if (isUpdate && feature.id) ctx.commitHost(layerId, feature.id, saved.geometry);
    // 5.1-e — le suivi de session. À la CRÉATION on retient l'identifiant retenu par le
    // serveur ; à la MISE À JOUR on réconcilie, sans quoi une entité créée hors réseau puis
    // synchronisée sortirait de l'export (elle serait suivie sous un identifiant local que la
    // couche hôte ne porte plus).
    if (!isUpdate) trackSessionFeature(String(saved.id));
    else if (feature.id && String(feature.id) !== String(saved.id)) {
        renameSessionFeature(String(feature.id), String(saved.id));
    }
    ctx.dispatchSaved({ featureId: saved.id, layerId, saved, isUpdate });
    _notify("success", _getLabel("editor.toast.saved"));
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
        // 🛑 LA MOITIÉ VISIBLE DE B-139 (tâche 8.7). Sans cette branche, un refus de PERMISSION
        // tombait sur `editor.error.server` — « Erreur serveur. Veuillez réessayer. » —, c'est-
        // à-dire qu'on invitait l'utilisateur à réessayer une opération que la couche refusera
        // toujours. Le refus se nomme désormais pour ce qu'il est.
        //
        // ⚠️ Et il ne se confond PAS avec `permissionDenied`, malgré la parenté des mots : ce
        // dernier porte un 401/403 **du serveur** (c'est VOUS qui êtes refusé, se reconnecter
        // peut aider), celui-ci porte la déclaration de la couche (l'opération est refusée à
        // tout le monde, il n'y a rien à tenter). Deux causes, deux gestes, deux libellés.
        else if (err.kind === "forbidden") key = "editor.error.editionNotPermitted";
        else if (err.kind === "client" && (err.status === 401 || err.status === 403)) {
            key = "editor.error.permissionDenied";
        }
    }
    _notify("error", _getLabel(key));
}
