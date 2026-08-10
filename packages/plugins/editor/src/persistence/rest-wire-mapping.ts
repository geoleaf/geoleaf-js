/*!
 * @geoleaf-plugins/editor — shared HTTP helpers for REST persistence adapters
 * © 2026 Mattieu Pottier — MIT License
 *
 * Thin domain adapter over the neutral HTTP primitives of `@geoleaf/host-runtime`:
 * the wire helpers live in the shared lib, this module maps their neutral
 * outcomes back into editor-domain {@link PersistenceError}s and i18n labels.
 * The local wrappers are deliberately NOT named after the primitives they wrap
 * (`restHeaders` / `restFetch`, not `jsonHeaders` / `fetchWithTimeout`): PSF-01
 * derives its canonical symbol list from the host-runtime barrel and cannot tell
 * a domain wrapper from a fork.
 * Wire-level primitives are shared by the two online adapters: the
 * `/features`-envelope {@link createRestAdapter} and the flat
 * `{ ...properties, geom }` {@link createCollectionRestAdapter}. URL building and
 * HTTP status mapping (e.g. the 409 conflict flow) stay per-adapter — the two
 * dialects genuinely diverge there.
 * https://geoleaf.dev
 */
import {
    jsonHeaders,
    fetchWithTimeout,
    parseJsonBody,
    HttpFetchError,
} from "@geoleaf/host-runtime";
import { _getLabel } from "../internal.js";
import { PersistenceError, type EditorFeature, type SavedFeature } from "./adapter-interface.js";

/**
 * Builds JSON request headers.
 *
 * @param authHeader - Optional `Authorization` value (usually injected by the
 *   Connector plugin on the global fetch, so commonly omitted).
 * @param force - When `true`, adds `X-Force-Update: true` (client-wins conflict
 *   override). The collection dialect never forces, so it omits this argument.
 */
export function restHeaders(authHeader?: string | null, force?: boolean): Record<string, string> {
    return jsonHeaders({
        ...(authHeader != null && { authorization: authHeader }),
        ...(force !== undefined && { force }),
    });
}

/** Runs a fetch with an AbortController timeout. Maps abort → timeout error. */
export async function restFetch(
    doFetch: typeof fetch,
    timeoutMs: number,
    url: string,
    init: RequestInit
): Promise<Response> {
    try {
        return await fetchWithTimeout(doFetch, url, init, timeoutMs);
    } catch (err) {
        if (err instanceof HttpFetchError) {
            if (err.kind === "timeout") {
                throw new PersistenceError("timeout", _getLabel("editor.error.networkTimeout"), {
                    cause: err.cause,
                });
            }
            throw new PersistenceError("network", _getLabel("editor.error.server"), {
                cause: err.cause,
            });
        }
        throw err;
    }
}

/** Parses a JSON body, tolerating an empty body (returns `{}`). */
export async function parseJson(res: Response): Promise<unknown> {
    try {
        return await parseJsonBody(res);
    } catch (err) {
        throw new PersistenceError("parse", _getLabel("editor.error.server"), {
            status: res.status,
            cause: err,
        });
    }
}

/** Coerces a parsed body into a {@link SavedFeature}, falling back to the local edit. */
export function toSaved(body: unknown, feature: EditorFeature, layerId: string): SavedFeature {
    const b = (body ?? {}) as Partial<SavedFeature> & { id?: string | number };
    return {
        id: b.id != null ? String(b.id) : (feature.id ?? ""),
        layerId: b.layerId ?? layerId,
        geometry: b.geometry ?? feature.geometry,
        properties: b.properties ?? feature.properties,
        ...(b.version !== undefined && { version: b.version }),
        raw: body,
    };
}
