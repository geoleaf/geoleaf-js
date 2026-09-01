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
 * `{ ...properties, geom }` {@link createCollectionRestAdapter}. URL building stays
 * per-adapter, and so does the `409` conflict flow — it needs request context the
 * collection dialect does not have.
 * ⚠️ This banner read "HTTP status mapping … stays per-adapter — the two dialects
 * genuinely diverge there" until 2026-08-13, and it was true of `409` only. The
 * `4xx`/`5xx` tail was byte-identical in both files — a clone jscpd had already
 * measured — and that is precisely how a `501` came to be classified `"network"` on
 * both paths at once. That tail now lives here, in {@link statusError}.
 * https://geoleaf.dev
 */
import {
    jsonHeaders,
    fetchWithTimeout,
    parseJsonBody,
    HttpFetchError,
} from "@geoleaf/host-runtime";
import { _getLabel } from "../internal.js";
import {
    PersistenceError,
    NOT_IMPLEMENTED_STATUS,
    type EditorFeature,
    type SavedFeature,
} from "./adapter-interface.js";

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

/**
 * Maps a non-`ok` HTTP status onto a typed {@link PersistenceError}.
 *
 * 🛑 **Single home of the status policy that the two dialects SHARE.** `rest-adapter` and
 * `collection-rest-adapter` carried this tail byte-for-byte — a clone jscpd already measured —
 * and that is exactly how a `501` came to be classified `"network"` on *both* paths at once.
 * "The fix was true on one path out of two" is the failure class here; keeping one home
 * is what makes that impossible here.
 *
 * ⚠️ **What deliberately stays per-adapter**: the `409` conflict flow. It needs the request
 * context (`feature`, `layerId`) and fires `onConflict`, which the collection dialect does not
 * have at all. Callers handle `409` BEFORE delegating here.
 *
 * ⚠️ **`501` is tested first for READABILITY, not out of necessity** — `501 >= 500`, so it could
 * never fall into the `4xx` branch. The order of the code follows the order of the decision:
 * statuses that carry a verdict of their own, then classes. Writing "before, otherwise it would
 * fall into the 4xx" would be false, and that is the very class of comment this sprint removes.
 *
 * @param status - HTTP status of a response whose `ok` is `false`.
 * @returns The typed error to throw.
 */
export function statusError(status: number): PersistenceError {
    if (status === NOT_IMPLEMENTED_STATUS) {
        return new PersistenceError("capability", _getLabel("editor.error.operationNotSupported"), {
            status,
        });
    }
    if (status >= 400 && status < 500) {
        return new PersistenceError("client", _getLabel("editor.error.server"), { status });
    }
    return new PersistenceError("network", _getLabel("editor.error.server"), { status });
}
