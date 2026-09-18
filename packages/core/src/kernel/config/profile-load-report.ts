/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Profile load report — the resources the active profile DECLARES and could not obtain.
 *
 * ## Why a report, and not an exception
 *
 * Every loader in `profile-loader.ts` catches its own failure and returns `null`, and that is
 * deliberate: one missing plugin configuration must not take the whole profile down. The
 * defect was not the catch, it was that the catch ENDED the story — the profile then counted
 * as loaded, `geoleaf:profile:loaded` fired with no flag, and the map started without layers
 * or settings, saying nothing. The loaders keep catching; they now also RECORD here, and the
 * boot reads the record.
 *
 * ## What counts as a failure
 *
 * A resource the profile declares — `profile.json`, a `Files.*` key, a layer `configFile` —
 * that could not be obtained: an HTTP error, invalid JSON, or, on the bundle path, a declared
 * section the bundle does not carry (the bundle compiler skips a missing file without a
 * word). An optional file the profile does not declare is not a failure, and neither is a
 * bundle that failed to load while its cascade fallback succeeded: that one is recovered,
 * and only logged.
 *
 * ⚠️ Module-level state, like `ProfileManager` itself — one active profile per page. It is
 * reset at the start of every load and by `ProfileManager.reset()`. `kernel/` must not import
 * `app/`: the boot READS this module, never the other way round.
 */

import { dispatchCancelableGeoLeafEvent } from "../events/event-bus.js";

/** One declared resource that could not be obtained. */
export interface ProfileResourceFailure {
    /** `profile.json`, a `Files.*` key (`Files.uiFile`, `Files.modules.legend`) or a layer `configFile`. */
    readonly resource: string;
    /** The requested URL, query string removed except the `t` cache token. */
    readonly url: string;
    /** Whether the profile contract marks the resource as required. */
    readonly required: boolean;
    readonly message: string;
}

/** Snapshot of the current profile load. */
export interface ProfileLoadReport {
    readonly profileId: string | null;
    /** `profile.json` itself failed: nothing of the profile could be applied. */
    readonly fatal: boolean;
    readonly failures: readonly ProfileResourceFailure[];
    /** A listener cancelled `geoleaf:profile:failed`: the host owns the signal. */
    readonly prevented: boolean;
}

/** Upper bound on a recorded message: the report travels into a diagnostic. */
const MAX_MESSAGE_LENGTH = 300;

let _profileId: string | null = null;
let _failures: ProfileResourceFailure[] = [];
let _fatal = false;
let _prevented = false;
let _emitted = false;

/**
 * Removes the query string of every path-like token in `text`, keeping the `t` cache token.
 *
 * A token counts as a path when it contains a `/` before its `?` — prose such as "why?" is
 * left alone. The cache token survives because it tells support WHICH deployment answered;
 * every other parameter is dropped, since a base path can carry a signed query.
 *
 * @param text - A URL, or a message that may embed one.
 * @returns The same text with each query reduced to `?t=<token>`, or removed.
 */
function stripQueryExceptToken(text: string): string {
    return text.replace(/(\S*\/[^\s?]*)\?([^\s"'<>)]*)/g, (_match, path: string, query: string) => {
        const token = /(?:^|&)t=([^&#]*)/.exec(query);
        return token ? `${path}?t=${token[1]}` : path;
    });
}

/** A bounded, query-stripped description of whatever was thrown. */
function _describe(error: unknown): string {
    const raw =
        error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
    const clean = stripQueryExceptToken(raw);
    return clean.length > MAX_MESSAGE_LENGTH ? `${clean.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : clean;
}

/**
 * Starts a new load: every previous record is dropped.
 *
 * @param profileId - The profile about to load, or `null` when none is active.
 */
export function beginProfileLoad(profileId: string | null): void {
    _profileId = profileId;
    _failures = [];
    _fatal = false;
    _prevented = false;
    _emitted = false;
}

/**
 * Records one declared resource that could not be obtained.
 *
 * @param entry - The resource, its URL, whether the contract requires it, and what was thrown.
 */
export function recordProfileFailure(entry: {
    resource: string;
    url: string;
    required: boolean;
    error: unknown;
}): void {
    _failures.push({
        resource: entry.resource,
        url: stripQueryExceptToken(entry.url),
        required: entry.required,
        message: _describe(entry.error),
    });
}

/** Marks the load as fatal: `profile.json` itself could not be applied. */
export function markProfileLoadFatal(): void {
    _fatal = true;
}

/**
 * Emits `geoleaf:profile:failed` once for the current load, when it recorded any failure.
 *
 * Called right before `geoleaf:profile:loaded` on the success paths, and from the fatal
 * catch — so a listener always hears the failure first. Whether a listener cancelled it is
 * kept in the report, for the boot to read.
 */
export function emitProfileFailuresOnce(): void {
    if (_emitted || _failures.length === 0 || _profileId === null) return;
    _emitted = true;
    const notPrevented = dispatchCancelableGeoLeafEvent("geoleaf:profile:failed", {
        profileId: _profileId,
        fatal: _fatal,
        failures: _failures.map((failure) => ({ ...failure })),
    });
    _prevented = !notPrevented;
}

/**
 * The current report.
 *
 * @returns A snapshot: later records do not mutate it.
 */
export function getProfileLoadReport(): ProfileLoadReport {
    return {
        profileId: _profileId,
        fatal: _fatal,
        failures: [..._failures],
        prevented: _prevented,
    };
}

/** Drops the report — lifecycle teardown, and the boot before it asks for a new load. */
export function resetProfileLoadReport(): void {
    beginProfileLoad(null);
}
