/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage - Layer Selector / cached-resource matching
 *
 * PLUGINS S7 — deciding whether a given layer or basemap is present in the
 * cached-resource manifest. Pure string work, no DOM and no I/O.
 *
 * ⚠️ WHY THIS IS NOT A ONE-LINER. The manifest holds the urls that were
 * actually downloaded, and nothing links them back to the basemap that
 * produced them:
 *
 *  - a RASTER basemap yields tile urls built by `CacheCalculator.buildTileUrl`,
 *    which substitutes `{x}`/`{y}`/`{z}` and replaces `{s}` with the literal
 *    `"a"` — so the cached url shares only a static PREFIX with the template;
 *  - a VECTOR basemap (`type: "maplibre"`) yields whatever `StyleResolver`
 *    enumerates from its style document — style, glyphs, sprite, `.pbf` tiles.
 *    Those urls carry neither the basemap id nor its `url`; they hang off the
 *    STYLE's origin (e.g. `data.geopf.fr` for IGN Plan).
 *
 * That second case is why the previous implementation fell back to
 * `resourceUrl.includes("tile")` — which made EVERY basemap report "cached" as
 * soon as any single tile of any basemap was. Matching on prefixes derived from
 * the basemap's own declaration covers both cases without that collapse.
 */

/** Normalises a url for comparison: backslashes, duplicate slashes, query, hash. */
export function normalizeResourceUrl(url: string): string {
    return url
        .replace(/\\/g, "/")
        .replace(/[?#].*$/, "")
        .replace(/([^:])\/{2,}/g, "$1/")
        .toLowerCase();
}

/**
 * Rejects prefixes too generic to identify anything — a bare scheme would match
 * every https url in the manifest, which is the very bug this module fixes.
 */
function _isDistinctive(prefix: string): boolean {
    const withoutScheme = prefix.replace(/^https?:\/\//, "");
    return withoutScheme.length > 0 && withoutScheme !== "/";
}

/**
 * The static url prefixes a basemap's cached resources can be expected to
 * start with. Empty when the basemap declares no url and no style, in which
 * case nothing can be asserted and the caller reports "not cached".
 */
export function basemapUrlPrefixes(basemap: {
    url?: unknown;
    fallbackUrl?: unknown;
    style?: unknown;
}): string[] {
    const prefixes: string[] = [];

    const pushTemplate = (raw: unknown): void => {
        if (typeof raw !== "string" || raw.length === 0) return;
        // Mirror CacheCalculator.buildTileUrl: `{s}` becomes the literal "a" in
        // every url it writes, so the cached urls carry that subdomain.
        const concrete = raw.replace("{s}", "a");
        const stop = concrete.indexOf("{");
        const prefix = normalizeResourceUrl(stop === -1 ? concrete : concrete.slice(0, stop));
        if (_isDistinctive(prefix)) prefixes.push(prefix);
    };

    // `url` is a template, or an array of templates (subdomain rotation).
    if (Array.isArray(basemap.url)) basemap.url.forEach(pushTemplate);
    else pushTemplate(basemap.url);

    pushTemplate(basemap.fallbackUrl);

    // Vector basemaps: style, glyphs, sprite and tiles all resolve against the
    // style document's own origin.
    if (typeof basemap.style === "string" && basemap.style.length > 0) {
        try {
            const origin = normalizeResourceUrl(new URL(basemap.style).origin);
            if (_isDistinctive(origin)) prefixes.push(origin);
        } catch {
            pushTemplate(basemap.style);
        }
    }

    return prefixes;
}

/** True when any cached resource url starts with one of the basemap's prefixes. */
export function matchesBasemap(resourceUrls: string[], prefixes: string[]): boolean {
    if (prefixes.length === 0) return false;
    return resourceUrls.some((url) => prefixes.some((prefix) => url.startsWith(prefix)));
}

/**
 * True when a cached resource url designates one of a layer's files.
 *
 * ⚠️ Uses `endsWith`, not `includes` in both directions as before. The reverse
 * direction (`searchUrl.includes(resourceUrl)`) let a SHORTER cached url match
 * a longer layer path, and it was never needed: the caller already supplies
 * both the plain and the `../`-prefixed spelling of every path, which is what
 * the bidirectional test was really compensating for.
 */
export function matchesLayer(resourceUrls: string[], searchUrls: string[]): boolean {
    if (searchUrls.length === 0) return false;
    return resourceUrls.some((url) => searchUrls.some((search) => url.endsWith(search)));
}
