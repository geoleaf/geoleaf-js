/*!
 * GeoLeaf Core – Permalink / URL Parsing and Building
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * URL parsing and serialization for the GeoLeaf permalink system (§1.3).
 *
 * Exposes `readUrl`, `buildUrl`, the `PermalinkState` type, and URL parameter
 * constants. Consumed by `permalink-sync.ts` and re-exported via
 * `permalink-api.ts`.
 */

import { validateCoordinates, validateNumber } from "../../kernel/security/index.js";
import type { PermalinkConfig } from "../../kernel/config/geoleaf-config/config-types.js";
import type { PermalinkState } from "./types.js";
import { DEFAULT_PERMALINK_FIELDS } from "./constants.js";

export type { PermalinkState };

// ── URL parameter names ───────────────────────────────────────────────────────

const P_LAT = "gl_lat";
const P_LNG = "gl_lng";
const P_ZOOM = "gl_zoom";
const P_LAYERS = "gl_layers";
const P_FILTER = "gl_filter";
/** Compact mode key: `#gl=<base64>` */
const P_COMPACT = "gl";
/** Active data theme parameter key. */
const P_THEME = "gl_theme";
/** Layers manually shown by the user (beyond what the active theme displays). */
const P_SHOWN = "gl_shown";
/** Active category filter param key (taxonomy values, flat). */
const P_CATS = "gl_cats";
/** Active tag filter param key. */
const P_TAGS = "gl_tags";
/** Minimum rating filter param key. */
const P_RATING = "gl_rating";

/** Auto-compact threshold in characters (param string length). */
const AUTO_COMPACT_THRESHOLD = 200;
/** Maximum number of serialized layer IDs (prevents URL abuse). */
const MAX_LAYERS = 100;
/** Maximum length of serialized text fields — applies to scalars AND to list elements. */
export const MAX_TEXT_LEN = 200;
/**
 * Upper bound for the `rating` facet. It maps to the `min` bound of a range filter, so it
 * is not tied to a 0–5 scale; the cap only exists to keep the value finite and sane.
 */
const MAX_RATING = Number.MAX_SAFE_INTEGER;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Keep only the optional facets listed in `fields`.
 *
 * The view triple is mandatory (see {@link PermalinkState}) and is never filtered — the
 * whitelist gates the optional facets only, which is exactly what
 * {@link DEFAULT_PERMALINK_FIELDS} enumerates.
 *
 * @security Enforces the `config.fields` whitelist on the compact (`gl=<base64>`) path,
 * which used to bypass it in both directions — a forged compact URL could drive facets a
 * profile had deliberately excluded, and a build could publish them.
 */
function _pruneToFields(state: PermalinkState, fields: readonly string[]): PermalinkState {
    const pruned: PermalinkState = { lat: state.lat, lng: state.lng, zoom: state.zoom };
    const source = state as unknown as Record<string, unknown>;
    const target = pruned as unknown as Record<string, unknown>;

    for (const key of DEFAULT_PERMALINK_FIELDS) {
        if (!fields.includes(key)) continue;
        const value = source[key];
        if (value !== undefined) target[key] = value;
    }

    return pruned;
}

/** Chunk size for byte→binary-string conversion — keeps the spread off the call stack. */
const _B64_CHUNK = 0x8000;

/**
 * Serialises the compact payload as **UTF-8** base64.
 *
 * ⚠️ This is a WIRE FORMAT, and it changed at B.43 — see {@link _decodeCompact} for the
 * compatibility half. It used to be `btoa(JSON.stringify(state))`, and `btoa` throws on
 * any code point above 255: a filter in CJK or Cyrillic, or a lone typographic ellipsis,
 * made the whole encoding fail. Where it hurt was `startSync._doWrite`, which catches the
 * throw (`permalink-sync.ts`) — the URL just stopped tracking the map, silently.
 */
function _encodeCompact(state: PermalinkState): string {
    const bytes = new TextEncoder().encode(JSON.stringify(state));
    let binary = "";
    for (let i = 0; i < bytes.length; i += _B64_CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + _B64_CHUNK));
    }
    return btoa(binary);
}

/**
 * Parses a compact payload, accepting **both** encodings.
 *
 * Links emitted before B.43 carry Latin-1 code units, so this cannot be a substitution —
 * replacing the decoder outright would have broken every permalink already shared. The
 * discrimination is decisive rather than heuristic: UTF-8 is decoded in `fatal` mode, so a
 * legacy high byte (`é` = `0xE9`, which is not valid UTF-8 on its own) throws and falls
 * through to the Latin-1 reading. Pure-ASCII legacy payloads are byte-identical under both
 * and decode on the first attempt.
 *
 * The residual ambiguity is a legacy payload whose Latin-1 bytes also happen to form valid
 * UTF-8 *and* valid JSON — it would need the author to have typed the mojibake themselves
 * (`Ã©` for `é`), and it round-trips to what was stored, so it is accepted knowingly.
 *
 * @returns The parsed payload, or `null` if it is neither encoding — malformed input is
 *          rejected rather than guessed at.
 */
function _decodeCompact(compact: string): Partial<PermalinkState> | null {
    let binary: string;
    try {
        binary = atob(compact);
    } catch {
        return null;
    }

    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    try {
        const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return JSON.parse(utf8) as Partial<PermalinkState>;
    } catch {
        // Not valid UTF-8, or valid UTF-8 that is not JSON → read it as a legacy payload.
        try {
            return JSON.parse(binary) as Partial<PermalinkState>;
        } catch {
            return null;
        }
    }
}

/**
 * Coerce one required view param. Returns null when the param is absent, empty or blank —
 * `params.get()` yields `""` for a present-but-empty `gl_lat=`, and `Number("")` is `0`,
 * which used to slip past the `=== null` guard and silently recentre the map on 0,0.
 */
function _parseRequiredNumber(raw: string | null, min: number, max: number): number | null {
    if (raw === null || raw.trim().length === 0) return null;
    return validateNumber(Number(raw), min, max);
}

/** Filters a raw array down to non-empty strings, capped in count AND in element length. */
function _sanitizeIdList(raw: unknown): string[] {
    return (raw as unknown[])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .slice(0, MAX_LAYERS)
        .map((v) => v.slice(0, MAX_TEXT_LEN));
}

/**
 * Validate and coerce a raw parsed permalink state object.
 * Returns null if required numeric fields are missing or out of range.
 *
 * @security Validates decoded permalink state; rejects invalid coordinates and non-finite
 * numbers, caps array length, array ELEMENT length and text lengths.
 */
function _validateRaw(raw: Partial<PermalinkState>): PermalinkState | null {
    if (!raw || typeof raw !== "object") return null;

    const lat = validateNumber(raw.lat, -90, 90);
    const lng = validateNumber(raw.lng, -180, 180);
    const zoom = validateNumber(raw.zoom, 0, 28);
    if (lat === null || lng === null || zoom === null) return null;

    try {
        validateCoordinates(lat, lng);
    } catch {
        return null;
    }

    const state: PermalinkState = { lat, lng, zoom };

    if (Array.isArray(raw.layers)) state.layers = _sanitizeIdList(raw.layers);
    if (Array.isArray(raw.shownLayers)) state.shownLayers = _sanitizeIdList(raw.shownLayers);
    if (typeof raw.filter === "string" && raw.filter.length > 0) {
        state.filter = raw.filter.slice(0, MAX_TEXT_LEN);
    }
    if (Array.isArray(raw.categories)) state.categories = _sanitizeIdList(raw.categories);
    if (Array.isArray(raw.tags)) state.tags = _sanitizeIdList(raw.tags);
    // `JSON.parse('1e400')` yields Infinity, so a decoded payload needs the same numeric
    // validation as a URL param — a `typeof === "number"` check is not one. The typeof
    // guard is kept on top of it: a JSON string must not be coerced into a rating.
    const rating =
        typeof raw.rating === "number" ? validateNumber(raw.rating, 0, MAX_RATING) : null;
    if (rating !== null && rating > 0) {
        state.rating = rating;
    }
    if (typeof raw.theme === "string" && raw.theme.length > 0) {
        state.theme = raw.theme.slice(0, MAX_TEXT_LEN);
    }

    return state;
}

/**
 * Parse URL params into a PermalinkState according to the active config.
 * Handles both verbose (`gl_lat=…`) and compact (`gl=<base64>`) formats, and applies the
 * `config.fields` whitelist to both.
 *
 * @security Validates all URL parameters; every numeric field goes through validateNumber
 * (rating included), text and list elements are capped at MAX_TEXT_LEN, list length at
 * MAX_LAYERS, and non-whitelisted facets are dropped whatever the encoding.
 */
function _parseParams(params: URLSearchParams, config: PermalinkConfig): PermalinkState | null {
    const fields = config.fields ?? DEFAULT_PERMALINK_FIELDS;

    // Compact mode (base64 JSON) — pruned to the whitelist exactly like the verbose path.
    const compact = params.get(P_COMPACT);
    if (compact) {
        const decoded = _decodeCompact(compact);
        if (!decoded) return null;
        const validated = _validateRaw(decoded);
        return validated ? _pruneToFields(validated, fields) : null;
    }

    const lat = _parseRequiredNumber(params.get(P_LAT), -90, 90);
    const lng = _parseRequiredNumber(params.get(P_LNG), -180, 180);
    const zoom = _parseRequiredNumber(params.get(P_ZOOM), 0, 28);

    if (lat === null || lng === null || zoom === null) return null;

    try {
        validateCoordinates(lat, lng);
    } catch {
        return null;
    }

    const state: PermalinkState = { lat, lng, zoom };

    _parseListStateFields(params, fields, state);
    _parseScalarStateFields(params, fields, state);

    return state;
}

/**
 * Splits a comma-delimited URL value into a trimmed string list, capped in count
 * (MAX_LAYERS) AND in per-element length (MAX_TEXT_LEN), or undefined.
 */
function _parseDelimitedList(raw: string | null): string[] | undefined {
    if (!raw) return undefined;
    return _sanitizeIdList(raw.split(",").map((s) => s.trim()));
}

/** Parses the comma-delimited list fields (layers / shownLayers / categories / tags). */
function _parseListStateFields(
    params: URLSearchParams,
    fields: readonly string[],
    state: PermalinkState
): void {
    if (fields.includes("layers")) {
        const v = _parseDelimitedList(params.get(P_LAYERS));
        if (v) state.layers = v;
    }
    if (fields.includes("shownLayers")) {
        const v = _parseDelimitedList(params.get(P_SHOWN));
        if (v) state.shownLayers = v;
    }
    if (fields.includes("categories")) {
        const v = _parseDelimitedList(params.get(P_CATS));
        if (v) state.categories = v;
    }
    if (fields.includes("tags")) {
        const v = _parseDelimitedList(params.get(P_TAGS));
        if (v) state.tags = v;
    }
}

/** Parses the scalar fields (filter / rating / theme), capping text values. */
function _parseScalarStateFields(
    params: URLSearchParams,
    fields: readonly string[],
    state: PermalinkState
): void {
    if (fields.includes("filter")) {
        const rawFilter = params.get(P_FILTER);
        if (rawFilter) state.filter = rawFilter.slice(0, MAX_TEXT_LEN);
    }
    if (fields.includes("rating")) {
        const r = params.get(P_RATING);
        // `!isNaN(Number(r))` used to let `Infinity` through — the only numeric field that
        // bypassed validateNumber, contradicting this module's @security contract.
        const n = r ? validateNumber(Number(r), 0, MAX_RATING) : null;
        if (n !== null && n > 0) state.rating = n;
    }
    if (fields.includes("theme")) {
        const rawTheme = params.get(P_THEME);
        if (rawTheme) state.theme = rawTheme.slice(0, MAX_TEXT_LEN);
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read and validate the current URL, returning the embedded map state or null.
 *
 * @security Parses URL parameters with numeric validation and length caps; rejects malicious input.
 *
 * @param config - Active permalink configuration.
 * @returns Parsed and validated state, or null if the URL carries no permalink data.
 */
export function readUrl(config: PermalinkConfig): PermalinkState | null {
    if (typeof window === "undefined") return null;

    const mode = config.mode ?? "hash";
    let params: URLSearchParams;

    if (mode === "query") {
        params = new URLSearchParams(window.location.search);
    } else {
        // "hash" and "compact" modes both use the fragment
        const hash = window.location.hash;
        if (!hash || hash === "#") return null;
        params = new URLSearchParams(hash.slice(1));
    }

    return _parseParams(params, config);
}

/**
 * Serialize a state object into a URL fragment or query string.
 *
 * When `mode` is `"compact"` *or* the verbose param string exceeds
 * {@link AUTO_COMPACT_THRESHOLD} chars, the state is base64-encoded instead. Both branches
 * honour `config.fields`; only the mandatory view triple is always serialized.
 *
 * @param state - State to serialize. Uses current-map defaults if undefined.
 * @param config - Active permalink configuration.
 * @returns A full URL change string starting with `#` (hash) or `?` (query).
 */
export function buildUrl(
    state: PermalinkState | null | undefined,
    config: PermalinkConfig
): string {
    if (!state) return "";

    const mode = config.mode ?? "hash";
    const fields = config.fields ?? DEFAULT_PERMALINK_FIELDS;

    const params = new URLSearchParams();
    params.set(P_LAT, state.lat.toFixed(6));
    params.set(P_LNG, state.lng.toFixed(6));
    params.set(P_ZOOM, String(Math.round(state.zoom)));

    _setStateListParams(params, state, fields);
    _setStateScalarParams(params, state, fields);

    const paramStr = params.toString();

    // Auto-compact or explicit compact mode
    const shouldCompact = mode === "compact" || paramStr.length > AUTO_COMPACT_THRESHOLD;

    if (shouldCompact) {
        const compactParams = new URLSearchParams();
        // Prune first: the verbose branch above already filtered by `fields`, the compact
        // branch used to publish the WHOLE state — including facets the profile excluded.
        compactParams.set(P_COMPACT, _encodeCompact(_pruneToFields(state, fields)));
        const compactStr = compactParams.toString();
        return mode === "query" ? "?" + compactStr : "#" + compactStr;
    }

    return mode === "query" ? "?" + paramStr : "#" + paramStr;
}

/** Serializes the comma-delimited list fields (layers / shownLayers / categories / tags). */
function _setStateListParams(
    params: URLSearchParams,
    state: PermalinkState,
    fields: readonly string[]
): void {
    if (fields.includes("layers") && state.layers?.length) {
        params.set(P_LAYERS, state.layers.join(","));
    }
    if (fields.includes("shownLayers") && state.shownLayers?.length) {
        params.set(P_SHOWN, state.shownLayers.join(","));
    }
    if (fields.includes("categories") && state.categories?.length) {
        params.set(P_CATS, state.categories.join(","));
    }
    if (fields.includes("tags") && state.tags?.length) {
        params.set(P_TAGS, state.tags.join(","));
    }
}

/** Serializes the scalar fields (filter / rating / theme). */
function _setStateScalarParams(
    params: URLSearchParams,
    state: PermalinkState,
    fields: readonly string[]
): void {
    if (fields.includes("filter") && state.filter) {
        params.set(P_FILTER, state.filter);
    }
    if (fields.includes("rating") && state.rating && state.rating > 0) {
        params.set(P_RATING, String(state.rating));
    }
    if (fields.includes("theme") && state.theme) {
        params.set(P_THEME, state.theme);
    }
}
