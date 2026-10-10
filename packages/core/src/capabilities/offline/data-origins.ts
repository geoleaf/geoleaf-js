/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Declared data origins — routing by DECLARATION instead of by guesswork.
 *
 * 🛑 WHAT THIS REPLACES, and why none of it could be reviewed. The Service Worker decided
 * where a request should go by four heuristics, all of them guesses:
 *   - hostname SUBSTRINGS (`includes("tile")` matched `mon-site-hostile.tilerie.com`);
 *   - path sniffing (`/profiles/` in the URL means "profile resource");
 *   - one provider domain hardcoded in the worker;
 *   - a blanket `/api/` exclusion — which skips the most common path of a data API, i.e.
 *     exactly the traffic a field deployment depends on.
 *
 * An earlier fix made the first three honest (host boundaries instead of substrings). It did not
 * make them REVIEWABLE: an integrator still could not answer "which origins does my profile
 * talk to, and which of them may be cached?" without reading the worker's source. A
 * declaration can be read, diffed and refused; a heuristic can only be discovered.
 *
 * ⚠️ HOW IT REACHES THE WORKER — through IndexedDB, not a message.
 * The worker is a standalone script: it cannot import this module. It COULD be told by
 * `postMessage`, but a message is lost on every worker restart, and the worker restarts
 * whenever the browser feels like it — leaving it un-declared exactly when a field device
 * wakes up offline. Writing to IndexedDB makes the declaration survive, and the worker can
 * already read that database since its versionless open was repaired.
 *
 * @version 3.0.0
 */

import { Log } from "../../utils/log/index.js";
import type { DataOriginDeclaration, DataOriginRole } from "../../contracts/sync.contract.js";

/**
 * Key under which the declarations are stored, in the `preferences` store.
 *
 * ⚠️ `preferences` and NOT `metadata`, although `metadata` fits the meaning better.
 * Measured: `metadata` has NO writer — one reader in `cache-manager.ts`, one `clear`
 * in the facade, and nothing else. Adding one would open an API surface for a single
 * use, while `setPreference` / `getPreference` exist, are exposed on the facade and
 * are tested. The worker reads the same store, through the same key.
 *
 * ⚠️ The prefix is NOT `geoleaf:`: the EVENT-MAP gate scans `geoleaf:*` literals and
 * took this storage key for an untyped EVENT. A name posing as what it is not fools
 * the tooling before it fools a reader.
 *
 * SHARED literal: `sw-core.js` hard-codes it, unable to import. The source guard in
 * `__tests__/storage/sw-core.test.js` checks that both say the same thing.
 */
export const DATA_ORIGINS_KEY = "offline.dataOrigins";

/**
 * Normalises one declaration, dropping what cannot be trusted.
 *
 * ⚠️ An origin is parsed with `new URL(...).origin`, never accepted as written: a profile
 * that declares `"https://api.example.com/v1"` or `"api.example.com"` means an origin, and
 * accepting the raw string would reintroduce the substring comparison this task removes.
 * A declaration that does not parse is DROPPED and logged — never coerced.
 */
function normaliseOrigin(entry: unknown): DataOriginDeclaration | null {
    if (!entry || typeof entry !== "object") return null;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.origin !== "string" || !raw.origin) return null;

    let origin: string;
    try {
        origin = new URL(raw.origin).origin;
    } catch {
        Log.warn(`[DataOrigins] Ignored — not a parsable origin: ${String(raw.origin)}`);
        return null;
    }

    const roles = Array.isArray(raw.roles)
        ? (raw.roles.filter((r) => typeof r === "string") as DataOriginRole[])
        : [];
    if (roles.length === 0) {
        Log.warn(`[DataOrigins] Ignored — no role declared: ${origin}`);
        return null;
    }

    // `cacheable` must be EXPLICIT. Defaulting it to `true` would silently cache an
    // authenticated API the day someone forgets the field; defaulting to `false` would
    // silently break an offline basemap. Neither default is safe, so absence is a refusal.
    if (typeof raw.cacheable !== "boolean") {
        Log.warn(`[DataOrigins] Ignored — \`cacheable\` must be declared explicitly: ${origin}`);
        return null;
    }

    // `prefetch` is reconciled HERE, where the enumerator reads it: a credentialed origin is
    // never downloaded ahead of use, and a non-cacheable one keeps nothing it could download.
    // Both are said rather than silently corrected.
    let prefetch = raw.prefetch === true;
    if (prefetch && raw.authenticated === true) {
        Log.warn(`[DataOrigins] \`prefetch\` dropped — the origin is authenticated: ${origin}`);
        prefetch = false;
    } else if (prefetch && raw.cacheable !== true) {
        Log.warn(`[DataOrigins] \`prefetch\` ignored — it requires \`cacheable: true\`: ${origin}`);
        prefetch = false;
    }

    return {
        origin,
        roles,
        cacheable: raw.cacheable,
        ...(raw.authenticated === true ? { authenticated: true } : {}),
        ...(prefetch ? { prefetch: true } : {}),
    };
}

/**
 * Reads the profile's declarations and normalises them.
 *
 * @param declared - Raw value of `modules.offline.dataOrigins`.
 * @returns The declarations that survived normalisation. An empty array means "nothing
 *   declared", which the worker reads as "route nothing to a cache" — a refusal, not a
 *   fallback.
 * @example
 * const origins = parseDataOrigins(configGet("modules.offline.dataOrigins", []));
 */
export function parseDataOrigins(declared: unknown): DataOriginDeclaration[] {
    if (!Array.isArray(declared)) return [];
    const out: DataOriginDeclaration[] = [];
    for (const entry of declared) {
        const ok = normaliseOrigin(entry);
        if (ok) out.push(ok);
    }
    return out;
}

/**
 * Does `url` belong to a declared origin, and may it be cached?
 *
 * ⚠️ NOT exported. Its consumers live in this file — the duplicate detection,
 * {@link prefetchVerdict} and {@link pullVerdict} — and exporting for a caller that does not
 * yet exist is exactly the posture criticised elsewhere. Its behaviour stays PROVEN, through
 * `publishDataOrigins` and the two verdicts.
 *
 * @param url - Absolute URL of the request.
 * @param origins - Normalised declarations.
 * @param role - Optional role the caller needs (`"tiles"`, `"layerData"`…).
 * @returns The matching declaration, or `null` when the origin is undeclared — or declared
 *   without the requested role.
 * @example
 * const decl = matchDataOrigin(req.url, origins, "tiles");
 * if (decl?.cacheable) { ... }
 */
function matchDataOrigin(
    url: string,
    origins: readonly DataOriginDeclaration[],
    role?: DataOriginRole
): DataOriginDeclaration | null {
    let origin: string;
    try {
        origin = new URL(url).origin;
    } catch {
        return null;
    }
    for (const d of origins) {
        // Strict equality on the parsed origin. Not `startsWith`, not `includes` — the two
        // comparisons this whole task exists to remove.
        if (d.origin !== origin) continue;
        if (role && !d.roles.includes(role)) continue;
        return d;
    }
    return null;
}

/**
 * What the origin rule answers for one URL. `reason` is present on a refusal only.
 *
 * ⚠️ NOT exported: the facade declares its own structural shape (`StoragePrefetchVerdict`),
 * because it lives in the boot graph and this module in the deferred chunk.
 */
interface PrefetchVerdict {
    allowed: boolean;
    origin: string;
    reason?: "undeclared" | "notPrefetchable" | "unparsable";
}

/**
 * May `url` be downloaded AHEAD of use — during the offline preparation — and from which
 * origin does it come?
 *
 * **A declaration prevails.** An origin declared in `modules.offline.dataOrigins` — the page's
 * own included — is allowed when it says `cacheable: true` and `prefetch: true`, and refused
 * otherwise. An UNDECLARED origin is allowed only when it is the page's own: no third party is
 * involved, and that origin cannot be written portably in a profile. Anything else is refused:
 * an undeclared third-party origin, a declaration that only allows caching what was already
 * served, an unparsable URL.
 *
 * ⚠️ Roles are NOT consulted. They route the Service Worker's cache; `prefetch` is the
 * integrator's statement that the origin's terms allow downloading ahead of use, and it covers
 * everything the profile needs from that origin — tiles, style, glyphs, sprite. One origin, one
 * verdict: declaring the page's own origin for a same-origin data API alone — `authenticated`,
 * or `cacheable` without `prefetch` — also refuses the tiles that origin serves.
 *
 * @param url - Resource URL, absolute or relative to `pageUrl`.
 * @param origins - Normalised declarations ({@link parseDataOrigins}).
 * @param pageUrl - The page's URL, which resolves a relative `url` and defines "own origin".
 *   Absent (no `location`), only a declared origin is allowed. The own origin is implicit only
 *   while it is undeclared.
 * @returns `origin` — the parsed origin, or the raw URL when it does not parse — and `allowed`.
 *   A refusal also says why, in `reason`: `"undeclared"` (a third-party origin no declaration
 *   names), `"notPrefetchable"` (declared, without `cacheable: true` and `prefetch: true` — an
 *   `authenticated` origin lands here, the flag being dropped from it) or `"unparsable"`.
 * @example
 * const origins = parseDataOrigins(configGet("modules.offline.dataOrigins", []));
 * const { allowed, origin } = prefetchVerdict(tileUrl, origins, globalThis.location?.href);
 * if (!allowed) Log.warn(`Not downloaded: ${origin} is not declared for offline use`);
 */
export function prefetchVerdict(
    url: string,
    origins: readonly DataOriginDeclaration[],
    pageUrl?: string
): PrefetchVerdict {
    let resolved: URL;
    try {
        resolved = new URL(url, pageUrl);
    } catch {
        return { allowed: false, origin: url, reason: "unparsable" };
    }
    const origin = resolved.origin;
    // The declaration is read FIRST: admitting the page's own origin before it made a declared
    // `authenticated` own origin downloadable all the same.
    const declared = matchDataOrigin(resolved.href, origins);
    if (declared) {
        return declared.cacheable === true && declared.prefetch === true
            ? { allowed: true, origin }
            : { allowed: false, origin, reason: "notPrefetchable" };
    }
    const ownOrigin = pageUrl !== undefined && origin === new URL(pageUrl).origin;
    return ownOrigin ? { allowed: true, origin } : { allowed: false, origin, reason: "undeclared" };
}

/**
 * May the ENTITIES of a layer be pulled from `url` — the source its `offline.source.url` names?
 *
 * **Silence is a refusal only in a profile that declares.** A profile with no declaration at
 * all pulls from wherever its layers say, as it always did. From the first declaration on, a
 * source is pulled when its origin is declared or is the page's own, and refused otherwise.
 *
 * ⚠️ **Not {@link prefetchVerdict}, on purpose — neither `prefetch` nor `cacheable` is read,
 * and an `authenticated` origin is pullable.** `prefetch` says an origin's terms allow
 * downloading what was not asked for; the layer naming its source IS the request. `cacheable`
 * rules the Service Worker's cache, and a pull writes the `features` store, not that cache.
 * And `prefetch` is dropped from an `authenticated` declaration: read here, it would make the
 * one kind of source a pull exists for — a data API behind a session — impossible to pull.
 *
 * @param url - The source URL, absolute or relative to `pageUrl`.
 * @param origins - Normalised declarations ({@link parseDataOrigins}).
 * @param pageUrl - The page's URL, which resolves a relative `url` and defines "own origin".
 * @returns `origin` — the parsed origin, or the raw URL when it does not parse — and `allowed`.
 *   A refusal says why, in `reason`: `"undeclared"` or `"unparsable"`. An unparsable URL is
 *   refused only where a declaration exists; elsewhere the loader's own URL guard judges it.
 * @example
 * const origins = parseDataOrigins(configGet("modules.offline.dataOrigins", []));
 * const { allowed, origin } = pullVerdict(source.url, origins, globalThis.location?.href);
 * if (!allowed) Log.warn(`Not pulled: ${origin} is not a declared origin`);
 */
export function pullVerdict(
    url: string,
    origins: readonly DataOriginDeclaration[],
    pageUrl?: string
): PrefetchVerdict {
    let resolved: URL | null;
    try {
        resolved = new URL(url, pageUrl);
    } catch {
        resolved = null;
    }
    if (origins.length === 0) return { allowed: true, origin: resolved?.origin ?? url };
    if (!resolved) return { allowed: false, origin: url, reason: "unparsable" };
    const origin = resolved.origin;
    if (matchDataOrigin(resolved.href, origins)) return { allowed: true, origin };
    const ownOrigin = pageUrl !== undefined && origin === new URL(pageUrl).origin;
    return ownOrigin ? { allowed: true, origin } : { allowed: false, origin, reason: "undeclared" };
}

/**
 * Publishes the declarations where the Service Worker can read them.
 *
 * ⚠️ An `authenticated` origin is published with `cacheable: false`, whatever the profile
 * said. A credentialed response in a shared cache is served to the next reader, and no
 * amount of declaring makes that acceptable — so the two fields are reconciled HERE rather
 * than trusted to be consistent.
 *
 * @param db - The storage façade (`GeoLeaf.Storage.DB`).
 * @param origins - Normalised declarations.
 * @returns Resolves once written; a storage failure is logged, never thrown — a profile
 *   still has to load when persistence is unavailable.
 */
export async function publishDataOrigins(
    db: { setPreference?: (key: string, value: unknown) => Promise<unknown> } | null | undefined,
    origins: readonly DataOriginDeclaration[]
): Promise<void> {
    // Two declarations for the SAME origin are a silent configuration error:
    // `matchDataOrigin` returns the first, the second never applies, and the
    // integrator believes they declared what they wrote. We SAY it rather than let
    // them find out.
    const seen: DataOriginDeclaration[] = [];
    for (const d of origins) {
        if (matchDataOrigin(d.origin, seen)) {
            Log.warn(
                `[DataOrigins] Duplicate declaration ignored — ${d.origin} is already declared. ` +
                    `Only the first applies.`
            );
            continue;
        }
        seen.push(d);
    }

    const safe = seen.map((d) => (d.authenticated ? { ...d, cacheable: false } : d));
    try {
        await db?.setPreference?.(DATA_ORIGINS_KEY, safe);
        Log.debug(`[DataOrigins] Published ${safe.length} declaration(s) for the worker`);
    } catch (err) {
        Log.warn("[DataOrigins] Could not publish declarations:", (err as Error).message);
    }
}
