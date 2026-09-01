/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * In-memory cache for loaded GeoLeaf styles.
 *
 * Keyed by style identifier; avoids refetching a style file already resolved during
 * the session. Extracted from style-loader.ts.
 */

/**
 * In-memory cache for loaded styles.
 * Key: "profileId:layerId:styleId"
 * Value: { styleData, labelConfig, timestamp }
 */
export const styleCache = new Map<string, unknown>();

/**
 * Style DOCUMENTS pre-seeded from a profile bundle, keyed like {@link styleCache}
 * (`"profileId:layerId:styleId"`), holding the RAW document — not the loaded envelope.
 *
 * 🛑 **Two stores, and the distinction is load-bearing.** {@link styleCache} holds what
 * `loadAndValidateStyle` RETURNS: an envelope with `labelConfig`, a derived `id` and metadata.
 * This one holds what a `fetch` would have RECEIVED. A raw document put into `styleCache`
 * would satisfy every consumer that only reads `styleData`, and break the legend generator,
 * which reads `styleData.id` — the exact defect `_ensureStyleId` exists to prevent. So the
 * seeded path runs the same envelope chain as the fetched one; it does not shortcut it.
 */
export const styleDocumentStore = new Map<string, unknown>();

/**
 * Seeds the document store from a profile bundle's `layerStyleDocuments` bag.
 *
 * @param profileId - The profile the documents belong to.
 * @param bag - `{ [layerId]: { [styleId]: document } }`, or anything else (then ignored).
 */
export function seedStyleDocuments(profileId: string, bag: unknown): void {
    if (!profileId || !bag || typeof bag !== "object") return;
    for (const [layerId, styles] of Object.entries(bag as Record<string, unknown>)) {
        if (!styles || typeof styles !== "object") continue;
        for (const [styleId, doc] of Object.entries(styles as Record<string, unknown>)) {
            if (doc !== undefined)
                styleDocumentStore.set(`${profileId}:${layerId}:${styleId}`, doc);
        }
    }
}

/**
 * Clears the style cache.
 *
 * @internal Test-only as of KERNEL S11 — no production code invalidates the style cache
 * (styles are immutable for the lifetime of a profile). Kept because the loader suite needs
 * to reset state between cases; do not build production behaviour on it without a caller.
 *
 * @param {string|null} [cacheKey] - Specific key to remove, or null to clear all entries.
 */
export function clearStyleCache(cacheKey: string | null = null): void {
    if (cacheKey) {
        styleCache.delete(cacheKey);
        styleDocumentStore.delete(cacheKey);
    } else {
        styleCache.clear();
        styleDocumentStore.clear();
    }
}
