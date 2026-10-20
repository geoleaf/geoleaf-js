/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Source key — WHOSE rows a pulled record is, beyond the layer id that names its slot.
 *
 * 🛑 WHY THE LAYER ID IS NOT ENOUGH. The `features` store is keyed `[layerId, localId]` and
 * shared by every profile of the origin, as is the pull state, one entry per layer id. Two
 * profiles declaring a layer of the same id over two DIFFERENT sources therefore met in both: a
 * complete pull under one swept what the other had pulled, the layer drew the other's rows, and
 * a layer only the other had pulled read as pulled.
 *
 * ⚠️ WHY THE SOURCE AND NOT THE PROFILE. Two profiles over the SAME source hold the same rows:
 * keyed by profile, each pull would re-label the other's copies and hide them until its next
 * pull, and the two would force each other into complete pulls at every switch. A record
 * belongs to the source that served it; a profile sees what its own layer's source served.
 *
 * ⚠️ WHAT IT DOES NOT FIX. The store key stays `[layerId, localId]`: two sources serving the
 * same identity on a layer of the same id share ONE slot, and the last pull's copy is the one
 * kept. The other source's layer then misses that entity until its own next pull, which is
 * complete — its pull state was replaced by the other source's. A row is missing, never
 * wrong, and local work is never touched. A key carrying the source would close it, at the
 * price of a schema upgrade and a migration.
 *
 * A record or a pull state written before this existed carries no source, and keeps the old
 * behaviour: visible, swept and read under every profile.
 *
 * @version 1.0.0
 */

import { coreProfileLayerConfig } from "../config-seam.js";

/**
 * The key of one source: its URL and its collection, serialised.
 *
 * @param url - `offline.source.url`.
 * @param collectionId - The collection pulled — `offline.source.collectionId`, or the layer id.
 * @returns The key, comparable by string equality.
 */
export function sourceKeyOf(url: string, collectionId: string): string {
    return JSON.stringify([url, collectionId]);
}

/**
 * The source the ACTIVE profile's layer of this id pulls from.
 *
 * Read the way the pull resolves it (`offline.source.url`, `collectionId` defaulting to the
 * layer id), so that what a pull tags and what a read compares are the same string.
 *
 * @param layerId - The layer.
 * @returns Its source key, or `null` when the active profile declares no pull source for it.
 */
export function activeSourceKey(layerId: string): string | null {
    const config = coreProfileLayerConfig(layerId) as
        { offline?: { source?: { url?: unknown; collectionId?: unknown } } } | null | undefined;
    const source = config?.offline?.source;
    if (typeof source?.url !== "string" || source.url === "") return null;
    const collectionId =
        typeof source.collectionId === "string" && source.collectionId !== ""
            ? source.collectionId
            : layerId;
    return sourceKeyOf(source.url, collectionId);
}

/**
 * Whether something tagged with a source belongs to the active profile's layer.
 *
 * @param tagged - A record or a pull state; `sourceKey` absent when written before sources were
 *   recorded.
 * @param active - {@link activeSourceKey} of its layer.
 * @returns `true` when untagged, or tagged with the active source.
 */
export function fromActiveSource(
    tagged: { readonly sourceKey?: string },
    active: string | null
): boolean {
    return tagged.sourceKey === undefined || tagged.sourceKey === active;
}
