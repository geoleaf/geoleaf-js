/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * url-resolver — resolve a layer's realtime `url` / `fallbackUrl` against the
 * active profile's base path, mirroring how the core resolves a layer's own data
 * files.
 *
 * Realtime URLs in a profile are written **profile-root-relative**
 * (e.g. `"data/<id>_snapshot.pb"`, alongside `data.directory: "data"`). The plugin
 * reads the raw config and, unlike the core layer loader, would otherwise `fetch()`
 * such a path relative to the page — 404-ing in any deployment served from a root
 * that is not the profile directory (the deployed demo profiles are served from
 * site root, so the snapshot lives under `/profiles/<id>/data/`). This helper
 * applies the `<profilesBasePath>/<profileId>/` prefix so the URL resolves
 * correctly in production.
 */

/** Matches a bare URI scheme token (letters/digits) — `http`, `https`, `data`, `blob`, `ws`, … */
const SCHEME_TOKEN = /^[a-z][a-z0-9]*$/i;

/**
 * True for URLs that must not be profile-prefixed: root-absolute (`/foo`),
 * protocol-relative (`//host`) and scheme URIs (`http://`, `data:`, `blob:`, …).
 * Uses string scanning (no backtracking-prone regex) for the scheme check.
 */
function _isAbsolute(url: string): boolean {
    if (url.startsWith("/")) return true; // "/foo" and "//host"
    const colon = url.indexOf(":");
    if (colon <= 0) return false;
    const firstSlash = url.indexOf("/");
    // A scheme's ":" comes before any "/". If a "/" precedes it, this is a path.
    if (firstSlash !== -1 && firstSlash < colon) return false;
    return SCHEME_TOKEN.test(url.slice(0, colon));
}

/** Strip leading `./` and `../` segments — a realtime URL is profile-root relative. */
function _stripDotSegments(url: string): string {
    let rel = url;
    while (rel.startsWith("./") || rel.startsWith("../")) {
        rel = rel.startsWith("../") ? rel.slice(3) : rel.slice(2);
    }
    return rel;
}

/** Strip trailing slashes from the base path. */
function _trimTrailingSlash(base: string): string {
    let out = base;
    while (out.endsWith("/")) out = out.slice(0, -1);
    return out;
}

/**
 * Resolve a realtime source URL against the active profile base path.
 *
 * Absolute URLs (`http(s)://`, `//host`, `data:` / `blob:` URIs) and root-absolute
 * paths (`/foo`) are returned unchanged. A profile-relative path (`data/x`,
 * `./data/x`, `../data/x`) becomes `<profilesBasePath>/<profileId>/<path>`. When
 * `profileId` is unknown the input is returned unchanged (legacy behaviour).
 *
 * @param rawUrl - URL or path from `data.realtime.url` / `data.realtime.fallbackUrl`.
 * @param profileId - Active profile id (`layerConfig._profileId`).
 * @param profilesBasePath - Base path to the profiles folder (Config `data.profilesBasePath`).
 * @returns The resolved URL.
 */
export function resolveProfileUrl(
    rawUrl: string,
    profileId: string | undefined,
    profilesBasePath: string
): string {
    if (!rawUrl) return rawUrl;
    if (_isAbsolute(rawUrl)) return rawUrl;
    if (!profileId) return rawUrl;
    const base = _trimTrailingSlash(profilesBasePath || "profiles");
    return `${base}/${profileId}/${_stripDotSegments(rawUrl)}`;
}
