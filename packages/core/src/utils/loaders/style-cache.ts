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
 * the session. A new bundle of a profile retires that profile's seeded entries
 * ({@link seedStyleDocuments}). Extracted from style-loader.ts.
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
 * Keys each profile's last bundle seeded, so that the next bundle of that profile can retire
 * them. Kept per profile rather than matched by a `profileId:` prefix: a prefix would also
 * match the keys of a profile whose id starts with this one followed by a colon.
 */
const seededKeysByProfile = new Map<string, Set<string>>();

/**
 * Seeds the document store from a profile bundle's `layerStyleDocuments` bag.
 *
 * 🛑 **A bundle REPLACES what the previous bundle of the same profile seeded.** A host that
 * unmounts and mounts a profile again, without reloading the page, receives a new bundle when
 * a style changed on the server. The envelope cache ({@link styleCache}) is read BEFORE this
 * store, so an envelope built from the first bundle used to mask the document of the next one
 * under the same key, until the page was reloaded. Seeding therefore retires, for this profile:
 * the documents the previous bundle carried (one this bundle no longer carries does not
 * survive it), and the envelopes built from them. The next load rebuilds each envelope from
 * the new document, still without a request.
 *
 * What is NOT retired: another profile's entries, and an envelope fetched over HTTP for a key
 * no bundle carries — the cascade (`debug: true`, no bundle) keeps its cache as before.
 *
 * @param profileId - The profile the documents belong to.
 * @param bag - `{ [layerId]: { [styleId]: document } }`, or anything else (then ignored, and
 *   nothing is retired).
 */
export function seedStyleDocuments(profileId: string, bag: unknown): void {
    if (!profileId || !bag || typeof bag !== "object") return;
    for (const key of seededKeysByProfile.get(profileId) ?? []) {
        styleDocumentStore.delete(key);
        styleCache.delete(key);
    }
    const seeded = new Set<string>();
    for (const [layerId, styles] of Object.entries(bag as Record<string, unknown>)) {
        if (!styles || typeof styles !== "object") continue;
        for (const [styleId, doc] of Object.entries(styles as Record<string, unknown>)) {
            if (doc === undefined) continue;
            const key = `${profileId}:${layerId}:${styleId}`;
            styleDocumentStore.set(key, doc);
            // An envelope fetched before this bundle arrived would mask its document too.
            styleCache.delete(key);
            seeded.add(key);
        }
    }
    seededKeysByProfile.set(profileId, seeded);
}

/**
 * Clears the style cache.
 *
 * @internal Test-only: no production code calls it. Production invalidation is narrower and
 * lives in {@link seedStyleDocuments} — a new bundle retires what the previous bundle of the
 * same profile seeded. Kept because the loader suite needs to reset state between cases.
 *
 * @param {string|null} [cacheKey] - Specific key to remove, or null to clear all entries.
 */
export function clearStyleCache(cacheKey: string | null = null): void {
    if (cacheKey) {
        styleCache.delete(cacheKey);
        styleDocumentStore.delete(cacheKey);
        for (const keys of seededKeysByProfile.values()) keys.delete(cacheKey);
    } else {
        styleCache.clear();
        styleDocumentStore.clear();
        seededKeysByProfile.clear();
    }
}
