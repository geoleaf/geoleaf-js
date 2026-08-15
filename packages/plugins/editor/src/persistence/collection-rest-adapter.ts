/*!
 * @geoleaf-plugins/editor — Collection REST persistence adapter
 * © 2026 Mattieu Pottier — MIT License
 *
 * Speaks the "collection" wire dialect used by OGC API Features / PostgREST-style
 * backends: `POST ${baseUrl}/${layerId}` with a FLAT body `{ ...properties, geom }`
 * (properties hoisted to the top level, geometry under a configurable key, default
 * `"geom"`). This differs from the generic {@link createRestAdapter} (`/features`
 * envelope) and matches the demo_qgis PostGIS server contract.
 *
 * Auth is delegated to `@geoleaf-plugins/connector` (it monkey-patches the global
 * `fetch` and injects `Authorization: Bearer …` for the configured baseUrl), so the
 * adapter does NOT set an Authorization header itself unless `authHeader` is given.
 *
 * Create-only for this milestone: `update`/`delete` throw a typed
 * {@link PersistenceError} until the server update/delete contract is defined.
 * https://geoleaf.dev
 */
import { _getLabel } from "../internal.js";
import {
    PersistenceError,
    type EditorFeature,
    type EditorPersistenceAdapter,
    type SavedFeature,
} from "./adapter-interface.js";
import { restFetch, restHeaders, parseJson, toSaved, statusError } from "./rest-wire-mapping.js";

/** Configuration for {@link createCollectionRestAdapter}. */
interface CollectionRestAdapterOptions {
    /** API root, e.g. `https://ogc.example.org`. The collection path is appended as `/{layerId}`. */
    baseUrl: string;
    /** Property key carrying the geometry in the request body. Default: `"geom"`. */
    geometryProperty?: string;
    /** Per-request timeout in ms before aborting. */
    timeoutMs: number;
    /**
     * Optional `Authorization` header value. Usually omitted: the Connector plugin
     * injects the bearer token on the global fetch. Provide it only when the
     * Connector is not in use.
     */
    authHeader?: string | null;
    /** Injected fetch (tests). Defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
}

/** Builds the collection URL: `{baseUrl}/{layerId}`. */
function _buildUrl(baseUrl: string, layerId: string): string {
    const root = baseUrl.replace(/\/+$/, "");
    return `${root}/${encodeURIComponent(layerId)}`;
}

/** Maps a response to a parsed body or a typed error. */
async function _handleResponse(res: Response): Promise<unknown> {
    if (res.ok) return parseJson(res);
    // No 409 flow in this dialect: the whole status policy is the shared one.
    throw statusError(res.status);
}

/** Throws the create-only milestone error (update/delete are not defined server-side yet). */
function _createOnly(): never {
    throw new PersistenceError("client", _getLabel("editor.error.server"), { status: 405 });
}

/**
 * Creates a collection-dialect {@link EditorPersistenceAdapter}.
 */
export function createCollectionRestAdapter(
    opts: CollectionRestAdapterOptions
): EditorPersistenceAdapter {
    const doFetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
    const geomKey = opts.geometryProperty || "geom";

    return {
        async save(feature: EditorFeature, layerId: string): Promise<SavedFeature> {
            const url = _buildUrl(opts.baseUrl, layerId);
            const body = { ...feature.properties, [geomKey]: feature.geometry };
            const res = await restFetch(doFetch, opts.timeoutMs, url, {
                method: "POST",
                headers: restHeaders(opts.authHeader),
                body: JSON.stringify(body),
            });
            const parsed = await _handleResponse(res);
            return toSaved(parsed, feature, layerId);
        },

        // Create-only milestone — update/delete contracts are not defined server-side yet.
        async update(): Promise<SavedFeature> {
            return _createOnly();
        },

        async delete(): Promise<void> {
            _createOnly();
        },

        isOnline(): boolean {
            return typeof navigator !== "undefined" ? navigator.onLine : true;
        },
    };
}
