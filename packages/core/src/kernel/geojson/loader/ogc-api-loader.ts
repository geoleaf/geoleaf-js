/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf OGC API Features Loader
 *
 * Fetches GeoJSON features from an OGC API Features endpoint with support for:
 * - Automatic pagination via `next` link relations, exposed BOTH as a stream
 *   (`streamOgcApiFeatures`, one page at a time) and as an accumulator
 *   (`fetchOgcApiFeatures`, the whole collection) — one walk, two surfaces
 * - Bounding-box (`bbox`) query filtering
 * - Hard `maxFeatures` cap (memory anti-DoS)
 * - Cooperative cancellation via `AbortSignal`
 * - WKT geometry fallback (detects string geometry → converts via wktToGeoJSON)
 * - Auto-refresh on map `moveend` events with debouncing
 */

import { validateUrl } from "../../../utils/general/utils-base.js";
import { debounce } from "../../../utils/general/utils-base.js";
import { wktToGeoJSON } from "../../../utils/geo/wkt-parser.js";
import { getLog } from "../../../utils/general/di-accessors.js";
import type { OgcApiConfig } from "./loader-types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OgcLink {
    href: string;
    rel?: string;
    type?: string;
}

interface OgcFeatureCollection {
    type: string;
    features?: unknown[];
    links?: OgcLink[];
    numberReturned?: number;
    numberMatched?: number;
}

interface GeoJSONFeature {
    type: "Feature";
    geometry: unknown;
    properties: Record<string, unknown> | null;
    [key: string]: unknown;
}

interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
    /**
     * Present, and only present, when the cap cut the result short.
     *
     * 🛑 **The point of this member is that a truncated collection was INDISTINGUISHABLE from a
     * complete one.** The loader logged a warning and returned a subset; every caller received
     * a perfectly ordinary FeatureCollection, and a map drawn from it looks right. A silent
     * subset is a wrong map that looks correct — which is worse than an error.
     *
     * A foreign member is the right channel here: RFC 7946 permits them, it reaches every
     * caller without changing a signature, and it survives serialisation. `limit` and `fetched`
     * are both carried because "it was capped" alone does not say by how much it was missed.
     *
     * ⚠️ **`fetched` is NOT the collection's size**, and reading it as one produces a false
     * "N out of M": it is what the loop had accumulated when the cap stopped it, hence at most
     * one page past the bound. The source's real total is `matched`, taken from the first
     * page's `numberMatched` — **absent when the server does not serve it**, because a total
     * that cannot be measured is not guessed.
     */
    truncated?: { limit: number; fetched: number; matched?: number };
}

// Minimal map interface for autoRefresh (avoids direct MapLibre import)
interface MapLike {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
    getBounds?: () => {
        getWest: () => number;
        getSouth: () => number;
        getEast: () => number;
        getNorth: () => number;
    };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_FEATURES = 10_000;
const DEFAULT_LIMIT = 1_000;
const DEFAULT_DEBOUNCE_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _buildItemsUrl(config: OgcApiConfig): string {
    let base = config.url.trim().replace(/\/$/, "");
    if (config.collectionId && !base.endsWith("/items")) {
        base = `${base}/collections/${config.collectionId}/items`;
    }
    return base;
}

function _buildRequestUrl(
    base: string,
    config: OgcApiConfig,
    bbox?: [number, number, number, number],
    offset?: number
): string {
    // Use URL constructor to correctly merge any existing query params in base
    const url = new URL(base);
    url.searchParams.set("f", "json");
    const limit = config.limit ?? DEFAULT_LIMIT;
    url.searchParams.set("limit", String(limit));
    const effectiveBbox = bbox ?? config.bbox;
    if (effectiveBbox) {
        url.searchParams.set("bbox", effectiveBbox.join(","));
    }
    if (offset && offset > 0) {
        url.searchParams.set("offset", String(offset));
    }
    return url.toString();
}

/**
 * Resolves the next-page cursor from a dotted path declared in the profile.
 *
 * 🛑 **The value is treated as a URL, never as a token.** `validateUrl()` is this
 * path's only anti-SSRF guard; accepting a bare token to re-inject into a query
 * parameter would require one more key AND a page bound, and neither is decided. A
 * value that is not an absolute http(s) URL therefore stops pagination — and says
 * so, naming the path AND the start of the value: without both, an integrator who
 * mis-declared their path cannot know which of the two is at fault.
 *
 * @param response - The response envelope, as received.
 * @param dotPath - The declared path, e.g. `"pagination.next_cursor"`.
 * @returns The next page's URL, or `null` — which stops the loop.
 */
function _resolveCursor(response: unknown, dotPath: string): string | null {
    let node: unknown = response;
    for (const key of dotPath.split(".")) {
        if (!node || typeof node !== "object") return null;
        node = (node as Record<string, unknown>)[key];
    }
    if (typeof node !== "string" || node.length === 0) return null;
    if (!/^https?:\/\//i.test(node)) {
        // The logger is obtained by injection in this module — never imported directly.
        getLog().warn(
            `[OgcApiLoader] cursorPath "${dotPath}" resolved to a value that is not an ` +
                `absolute http(s) URL — pagination stops here. Value starts with: ` +
                `"${node.slice(0, 24)}". A bare cursor token is not supported: it would have ` +
                `to be re-injected into a query parameter, which no declared key describes.`
        );
        return null;
    }
    return node;
}

function _extractNextUrl(response: OgcFeatureCollection): string | null {
    if (!Array.isArray(response.links)) return null;
    const next = response.links.find(
        (l) => l.rel === "next" && typeof l.href === "string" && l.href.length > 0
    );
    return next ? next.href : null;
}

/**
 * Resolves WKT string geometries in a GeoJSON feature to proper GeoJSON geometry objects.
 * Some OGC API Features implementations return WKT strings instead of GeoJSON geometry.
 */
function _resolveWktGeometry(features: unknown[]): GeoJSONFeature[] {
    return features.map((rawFeature) => {
        const f = rawFeature as GeoJSONFeature;
        if (typeof f.geometry === "string") {
            const converted = wktToGeoJSON(f.geometry);
            return { ...f, geometry: converted };
        }
        return f;
    });
}

/**
 * Validates that `data` is an OGC API Features-compatible response object.
 */
function _validateOgcResponse(data: unknown): data is OgcFeatureCollection {
    if (!data || typeof data !== "object") return false;
    const d = data as Record<string, unknown>;
    if (d["type"] !== "FeatureCollection") return false;
    if (d["features"] !== undefined && !Array.isArray(d["features"])) return false;
    return true;
}

// ─── Core fetch function ──────────────────────────────────────────────────────

/**
 * Fetches and validates a single page from an OGC API Features endpoint.
 * @returns The validated OGC response, or `null` if the request was aborted or the URL is invalid.
 * @throws Error on network failure or malformed response.
 * @internal
 */
async function _fetchPage(
    url: string,
    signal: AbortSignal | undefined,
    headers: Record<string, string>
): Promise<OgcFeatureCollection | null> {
    const Log = getLog();

    const safeUrl = validateUrl(url);
    if (!safeUrl) {
        Log.warn("[OgcApiLoader] Skipping invalid URL:", url.substring(0, 100));
        return null;
    }

    let response: Response;
    try {
        response = await fetch(safeUrl, { signal: signal ?? null, headers });
    } catch (err) {
        if ((err as Error).name === "AbortError") {
            Log.info("[OgcApiLoader] Fetch aborted by signal");
            return null;
        }
        throw new Error(
            `[OgcApiLoader] Network error fetching "${safeUrl}": ${(err as Error).message}`,
            { cause: err }
        );
    }

    if (!response.ok) {
        throw new Error(`[OgcApiLoader] HTTP ${response.status} from "${safeUrl}"`);
    }

    let data: unknown;
    try {
        data = await response.json();
    } catch (err) {
        throw new Error(`[OgcApiLoader] Failed to parse JSON response: ${(err as Error).message}`, {
            cause: err,
        });
    }

    if (!_validateOgcResponse(data)) {
        throw new Error(
            `[OgcApiLoader] Response is not a valid FeatureCollection (type="${(data as { type?: unknown })?.type}")`
        );
    }

    return data;
}

/**
 * One page, handed over the instant it is parsed.
 *
 * The consumer decides what to do with it — accumulate, or write it and forget it.
 * `nextUrl` is the cursor that WOULD be followed after this page, so a consumer can
 * persist it as a resume point; it is `null` on the last page, whatever stopped the
 * loop.
 */
export interface OgcApiPage {
    /** Features of this page, WKT already resolved and the cap already applied. */
    readonly features: readonly GeoJSONFeature[];
    /** 0-based page number. */
    readonly index: number;
    /** Features handed over so far, this page included — after the cap. */
    readonly delivered: number;
    /** Features the source returned so far, this page included — before the cap. */
    readonly fetched: number;
    /** `numberMatched` of the first page, when the server serves it. Never invented. */
    readonly matched?: number;
    /** Cursor to the page after this one, or `null` when the loop stops here. */
    readonly nextUrl: string | null;
}

/** What a full pagination run observed. */
export interface OgcApiStreamOutcome {
    /** Features the source returned across every page — before the cap. */
    readonly fetched: number;
    /** Features actually handed to `onPage` — after the cap. */
    readonly delivered: number;
    /** Present, and only present, when the cap cut the run short. */
    readonly truncated?: { limit: number; fetched: number; matched?: number };
    /** True when the caller's signal was raised: the run is PARTIAL. */
    readonly aborted: boolean;
    /** Cursor of the page never fetched, or `null` when the source was exhausted. */
    readonly lastCursor: string | null;
}

/**
 * Walks an OGC API Features collection page by page, handing each one over as it lands.
 *
 * 🛑 **This is the ONE authority on pagination, and {@link fetchOgcApiFeatures} is a thin
 * accumulator over it.** The two used to be one function whose only exit was a fully
 * materialised array, which forced every consumer to hold the whole collection: the
 * offline pull then held it a SECOND time as store records, and wrote all of them in one
 * IndexedDB transaction. Splitting the walk from the accumulation is what lets a consumer
 * bound its own memory — and it is the same code path, so the display path cannot drift
 * away from the pull's.
 *
 * ⚠️ **`onPage` is AWAITED.** The loop therefore serialises fetch → consume → fetch, on
 * purpose: a consumer that writes to IndexedDB must be allowed to finish before the next
 * page lands, otherwise the peak memory this function exists to bound comes straight back.
 *
 * ⚠️ **The cap applies PER PAGE, and `fetched` counts the raw lengths.** The previous
 * shape cut once at the end (`slice(0, maxFeatures)`) over an array it had fully built;
 * cutting per page yields the same features in the same order while never holding more
 * than one page over the bound.
 *
 * 🖐 **The break's anchor is NOT the interesting half, and a first draft of this comment
 * claimed it was.** It read "a cap that stopped on the delivered count would fetch one
 * page too many" — measured false by mutation: `delivered` is `min(fetched, maxFeatures)`
 * by construction, so the two conditions are provably the same and nothing can tell them
 * apart. What the raw count is genuinely needed for is `truncated.fetched`, the half that
 * says by HOW MUCH the source was missed. Anchoring the break on it is a coincidence of
 * having it at hand, not a property.
 *
 * @param config - OGC API source configuration.
 * @param onPage - Called once per page, in order. Awaited.
 * @param signal - AbortSignal for cooperative cancellation, checked between pages.
 * @param bbox - Override bounding box (used by autoRefresh to inject viewport bbox).
 * @returns What the run observed — counts, truncation, abort, and the unfollowed cursor.
 * @throws Error if the URL is invalid, the network request fails, or the response is malformed.
 * @example
 * const outcome = await streamOgcApiFeatures(config, async (page) => {
 *     await writeBatch(page.features);
 * });
 * if (outcome.truncated) console.warn("lot tronqué :", outcome.truncated.limit);
 */
export async function streamOgcApiFeatures(
    config: OgcApiConfig,
    onPage: (page: OgcApiPage) => void | Promise<void>,
    signal?: AbortSignal,
    bbox?: [number, number, number, number]
): Promise<OgcApiStreamOutcome> {
    const Log = getLog();
    const maxFeatures = config.maxFeatures ?? DEFAULT_MAX_FEATURES;

    const validatedUrl = validateUrl(config.url);
    if (!validatedUrl) {
        throw new Error(`[OgcApiLoader] Invalid or disallowed URL: "${config.url}"`);
    }

    const baseItemsUrl = _buildItemsUrl(config);
    let nextUrl: string | null = _buildRequestUrl(baseItemsUrl, config, bbox);
    const headers = config.headers ?? {};

    let fetched = 0;
    let delivered = 0;
    let index = 0;
    let matched: number | undefined;
    let aborted = false;
    let lastCursor: string | null = null;

    while (nextUrl !== null) {
        if (signal?.aborted) {
            Log.info("[OgcApiLoader] Request aborted");
            aborted = true;
            break;
        }

        const page = await _fetchPage(nextUrl, signal, headers);
        if (!page) {
            // `_fetchPage` returns null on an abort mid-flight as well as on a URL it
            // refused: the signal is what tells the two apart, and only one of them
            // makes the run partial.
            if (signal?.aborted) aborted = true;
            break;
        }

        // 🛑 The source's OWN total, read once and never recomputed. It is the only
        // honest "M" of an "N out of M" message: `fetched` is what the loop had
        // accumulated when it stopped, which is at most one page past the bound — it
        // says nothing about how big the collection really is. When the server omits
        // `numberMatched`, this stays `undefined` and the message says less rather
        // than inventing a total.
        if (index === 0 && typeof page.numberMatched === "number") {
            matched = page.numberMatched;
        }

        const resolved = _resolveWktGeometry(page.features ?? []);
        fetched += resolved.length;

        const room = maxFeatures - delivered;
        const slice = resolved.length > room ? resolved.slice(0, Math.max(0, room)) : resolved;
        delivered += slice.length;

        Log.debug(`[OgcApiLoader] Page loaded: ${resolved.length} features (total: ${fetched})`);

        const capReached = fetched >= maxFeatures;
        if (capReached) {
            Log.warn(
                `[OgcApiLoader] maxFeatures limit reached (${maxFeatures}). Stopping pagination. ` +
                    `The result is a SUBSET of the source: ${fetched} feature(s) were ` +
                    `accumulated and it is cut to ${maxFeatures}. Read the collection's ` +
                    `\`truncated\` member — nothing else distinguishes this from a complete set.`
            );
        }

        // ⚠️ The cursor is NOT resolved when the cap stops us. `_resolveCursor` warns on a
        // mis-declared path, and emitting that warning on a page we have already decided
        // not to follow would report a defect the run never hit.
        //
        // The declared cursor goes BEFORE the standard link relation: a profile
        // declaring `cursorPath` has a reason to, and the `next` relation may be
        // absent from its envelope. Without a declaration, nothing changes.
        const cursor = capReached
            ? null
            : config.cursorPath
              ? _resolveCursor(page, config.cursorPath)
              : _extractNextUrl(page);

        await onPage({
            features: slice,
            index,
            delivered,
            fetched,
            ...(matched !== undefined ? { matched } : {}),
            nextUrl: cursor,
        });

        index += 1;
        lastCursor = cursor;
        nextUrl = cursor;
    }

    // 🛑 THE CAP IS EXACT, and it was not: the loop used to stop after accumulating
    // a WHOLE PAGE, so `maxFeatures: 15` with `limit: 10` yielded **20** entities. A
    // cap that yields more than its bound is not a cap.
    //
    // ⚠️ The cut already existed — but **in a single caller**, the offline pull,
    // which redid it on its own account and exposed its own indicator. The DISPLAY
    // path, meanwhile, received the overflow unknowingly. Fixing at the source makes
    // the caller's compensation redundant (cutting an already-cut list has no
    // effect) and serves both paths in one gesture.
    return {
        fetched,
        delivered,
        ...(fetched > maxFeatures
            ? {
                  truncated: {
                      limit: maxFeatures,
                      fetched,
                      ...(matched !== undefined ? { matched } : {}),
                  },
              }
            : {}),
        aborted,
        lastCursor,
    };
}

/**
 * Fetches all features from an OGC API Features endpoint, following `next` pagination links.
 *
 * A thin accumulator over {@link streamOgcApiFeatures} — it holds the whole collection,
 * which is what the display path needs and what a bounded consumer must NOT do.
 *
 * Security controls applied:
 * - URL validated via `validateUrl()` before any network request
 * - All requests carry the provided `AbortSignal` for cooperative cancellation
 * - `maxFeatures` limit enforced to prevent memory exhaustion
 * - Response `type` field validated before data consumption
 *
 * ⚠️ **It rejects on the same three conditions as before — invalid URL, network failure,
 * malformed response — but it no longer raises them itself.** They are thrown by
 * {@link streamOgcApiFeatures} and propagate through the `await` below, so the caller's
 * contract is unchanged; the `@throws` tag moved to where the `throw` now lives, because
 * a tag whose body carries no `throw` is a claim the gate cannot check.
 *
 * @param config - OGC API source configuration.
 * @param signal - AbortSignal for cooperative cancellation.
 * @param bbox - Override bounding box (used by autoRefresh to inject viewport bbox).
 * @returns A GeoJSON FeatureCollection, carrying `truncated` when the cap cut it short.
 */
export async function fetchOgcApiFeatures(
    config: OgcApiConfig,
    signal?: AbortSignal,
    bbox?: [number, number, number, number]
): Promise<GeoJSONFeatureCollection> {
    const features: GeoJSONFeature[] = [];
    const outcome = await streamOgcApiFeatures(
        config,
        (page) => {
            features.push(...page.features);
        },
        signal,
        bbox
    );

    return outcome.truncated
        ? { type: "FeatureCollection", features, truncated: outcome.truncated }
        : { type: "FeatureCollection", features };
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────

/**
 * Registers a `moveend` listener on the map to re-fetch OGC features when
 * the viewport changes. The listener is debounced to avoid flooding the server.
 *
 * @param map - MapLibre map instance (minimal interface).
 * @param config - OGC API source configuration.
 * @param reloadFn - Callback invoked with the current viewport bbox on each refresh.
 * @returns A cleanup function that removes the listener. Call it on layer removal.
 */
export function setupAutoRefresh(
    map: MapLike,
    config: OgcApiConfig,
    reloadFn: (bbox: [number, number, number, number]) => void
): () => void {
    const Log = getLog();
    const ms = config.autoRefreshDebounce ?? DEFAULT_DEBOUNCE_MS;

    const handler = debounce(() => {
        const bounds = map.getBounds?.();
        if (!bounds) return;
        const bbox: [number, number, number, number] = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth(),
        ];
        Log.debug("[OgcApiLoader] autoRefresh triggered, bbox:", bbox);
        reloadFn(bbox);
    }, ms);

    map.on("moveend", handler);
    return () => map.off("moveend", handler);
}
