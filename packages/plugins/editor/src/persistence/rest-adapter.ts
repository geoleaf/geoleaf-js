/*!
 * @geoleaf-plugins/editor — REST persistence adapter
 * © 2026 Mattieu Pottier — MIT License
 *
 * Online backend: `POST/PUT/DELETE ${baseUrl}/features`. The adapter is UI-free
 * — it throws typed {@link PersistenceError}s and the caller (submit.ts /
 * _doDelete) renders toasts. An HTTP 409 fires `onConflict` once at the response
 * boundary (so exactly one `feature-conflict` event per conflict) and rejects
 * with a `"conflict"` error for the resolution flow to pick up.
 * https://geoleaf.dev
 */
import { _getLabel } from "../internal.js";
import {
    PersistenceError,
    type ConflictEventDetail,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
    type UpdateOptions,
} from "./adapter-interface.js";
import { restFetch, restHeaders, parseJson, toSaved, statusError } from "./rest-wire-mapping.js";

/** Configuration for {@link createRestAdapter}. */
interface RestAdapterOptions {
    /** API root, e.g. `https://api.example.com`. */
    baseUrl: string;
    /** Optional `Authorization` header value. */
    authHeader?: string | null;
    /** Per-request timeout in ms before aborting. */
    timeoutMs: number;
    /** Injected fetch (tests). Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
    /** Called once when the backend reports an HTTP 409 conflict. */
    onConflict?: (detail: ConflictEventDetail) => void;
}

/** Builds the request URL for a feature collection or a single feature. */
function _buildUrl(baseUrl: string, layerId: string, featureId?: string): string {
    const root = baseUrl.replace(/\/+$/, "");
    const q = `?layerId=${encodeURIComponent(layerId)}`;
    return featureId
        ? `${root}/features/${encodeURIComponent(featureId)}${q}`
        : `${root}/features${q}`;
}

/** Maps a response to a parsed body or a typed error; fires `onConflict` once on a 409. */
async function _handleResponse(
    res: Response,
    ctx: { feature: EditorFeature; layerId: string },
    onConflict?: (detail: ConflictEventDetail) => void
): Promise<unknown> {
    if (res.ok) return parseJson(res);

    if (res.status === 409) {
        const serverData = await parseJson(res).catch(() => undefined);
        onConflict?.({
            featureId: ctx.feature.id ?? "",
            layerId: ctx.layerId,
            localFeature: ctx.feature,
            serverData,
        });
        throw new PersistenceError("conflict", _getLabel("editor.error.conflict"), {
            status: 409,
            serverData,
        });
    }

    // Everything past the 409 flow is the policy both dialects share — one home, one 501.
    throw statusError(res.status);
}

/** A minimal placeholder feature for DELETE conflict mapping (only the id matters). */
function _syntheticFeature(featureId: string): EditorFeature {
    return { id: featureId, geometry: { type: "Point", coordinates: [] }, properties: {} };
}

/**
 * Creates a REST-backed {@link EditorPersistenceAdapter}.
 */
export function createRestAdapter(opts: RestAdapterOptions): EditorPersistenceAdapter {
    const doFetch = opts.fetchImpl ?? globalThis.fetch;

    return {
        async save(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            const url = _buildUrl(opts.baseUrl, layerId);
            const res = await restFetch(doFetch, opts.timeoutMs, url, {
                method: "POST",
                headers: restHeaders(opts.authHeader),
                body: JSON.stringify({ feature, layerId }),
            });
            const body = await _handleResponse(res, { feature, layerId }, opts.onConflict);
            return toSaved(body, feature, layerId);
        },

        async update(
            feature: EditorFeature,
            layerId: string,
            updateOpts?: UpdateOptions
        ): Promise<SavedFeature> {
            const url = _buildUrl(opts.baseUrl, layerId, feature.id);
            const res = await restFetch(doFetch, opts.timeoutMs, url, {
                method: "PUT",
                headers: restHeaders(opts.authHeader, updateOpts?.force),
                body: JSON.stringify({ feature, layerId, force: updateOpts?.force ?? false }),
            });
            const body = await _handleResponse(res, { feature, layerId }, opts.onConflict);
            return toSaved(body, feature, layerId);
        },

        async delete(featureId: string, layerId: string): Promise<void> {
            const url = _buildUrl(opts.baseUrl, layerId, featureId);
            const res = await restFetch(doFetch, opts.timeoutMs, url, {
                method: "DELETE",
                headers: restHeaders(opts.authHeader),
            });
            // DELETE: a conflict is still meaningful; map with a synthetic feature carrying the id.
            await _handleResponse(
                res,
                { feature: _syntheticFeature(featureId), layerId },
                opts.onConflict
            );
        },

        isOnline(): boolean {
            return typeof navigator !== "undefined" ? navigator.onLine : true;
        },
    };
}
