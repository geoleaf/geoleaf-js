/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf MapLibre Adapter — layer data diff translation.
 *
 * Turns the engine-neutral `LayerDataDiff` of `map-adapter.contract.ts` into the
 * `GeoJSONSource.updateData` shape, and answers whether a live source can take one.
 * Extracted from `maplibre-adapter.ts`, which sits at its line ceiling — same motive
 * as `maplibre-layer-builders.ts`.
 *
 * Everything MapLibre-specific about diffing lives here; the adapter method itself is
 * four lines of delegation.
 */

import type {
    LayerDataDiff,
    LayerFeatureDiff,
    LayerFeaturePropertyEntry,
} from "../../contracts/map-adapter.contract.js";
import type { GeoJSONSourceLike, MaplibreSourceDiff } from "./maplibre-adapter-types.js";

/** The property GeoLeaf promotes to the feature id on every GeoJSON source it builds. */
const PROMOTED_ID_KEY = "id";

/**
 * Can this live source take a diff at all?
 *
 * Read off the source itself, in O(1), on every call — never cached. The two facts it
 * asks about both belong to the source object and both can change without this module
 * hearing about it: `transformStyle` recreates every source on a basemap switch, and a
 * layer can be removed between two writes.
 *
 * ⚠️ This is NOT the whole eligibility question. It says the source is *able*; whether
 * the layer's features are *identifiable* (every one carrying a unique id) is a property
 * of the data, costs O(N) to establish, and is therefore decided once per whole-collection
 * write by `GeoJSONCore` — not here, and not per mutation.
 */
export function isDiffableSource(source: GeoJSONSourceLike | undefined | null): boolean {
    if (!source) return false;
    if (typeof source.updateData !== "function") return false;
    return source.promoteId === PROMOTED_ID_KEY;
}

/** Resolves the id MapLibre will address a feature by, under `promoteId: "id"`. */
function promotedId(feature: GeoJSON.Feature): string | number | undefined {
    const raw = (feature.properties as { id?: unknown } | null | undefined)?.id;
    return typeof raw === "string" || typeof raw === "number" ? raw : undefined;
}

/**
 * Translates a neutral diff into the engine's shape, or returns `null` when the diff
 * names something the engine could not address.
 *
 * 🛑 **`null` is a REFUSAL, and refusing is the only safe answer.** MapLibre does not
 * report an unusable diff to its caller: `_dispatchWorkerUpdate` wraps the whole update
 * in a `try/catch` that ends in `fire(new ErrorEvent(...))`, so the promise it returns
 * RESOLVES either way — and the incompatibility is detected on the main thread only
 * *after* the worker has already applied the diff. There is no `.catch()` that could
 * rescue this downstream. Anything doubtful must therefore be refused BEFORE the call,
 * and the caller re-feeds the whole collection.
 *
 * 🛑 **Every added feature is SHALLOW-COPIED, and the copy is not hygiene — it is
 * required twice over.**
 *
 *   1. *The engine mutates what it is given.* `promoteFeatureIds` writes `feature.id`
 *      and `demoteFeatureIds` deletes it, on the very objects handed over. Those objects
 *      are the store's own features: passing them uncopied would let the engine add and
 *      remove a field on GeoLeaf's state.
 *   2. *A top-level `id` is mandatory, because of an engine defect.* `updateData` calls
 *      `mergeSourceDiffs(pending, diff)` with two arguments where the function takes
 *      three — `promoteId` is never passed — and the coalescing it performs hashes
 *      `add` by the TOP-LEVEL `feature.id` (`diffToHashed`). Two adds coalesced while
 *      the worker is busy, carrying their id only under `properties.id`, therefore both
 *      hash under `undefined`, and the `Map` keeps one: **the other is lost, silently.**
 *      Setting the top-level id makes the coalescing key correct.
 *
 * A shallow copy suffices: `id` is the only field the engine writes, and it is at the
 * top level.
 */
export function toSourceDiff(diff: LayerDataDiff): MaplibreSourceDiff | null {
    const out: MaplibreSourceDiff = {};

    if (diff.removeAll) out.removeAll = true;

    if (diff.remove?.length) {
        for (const id of diff.remove) if (id == null) return null;
        out.remove = [...diff.remove];
    }

    if (diff.add?.length) {
        const add: GeoJSON.Feature[] = [];
        for (const feature of diff.add) {
            const id = promotedId(feature);
            if (id === undefined) return null;
            add.push({ ...feature, id });
        }
        out.add = add;
    }

    if (diff.update?.length) {
        const update: NonNullable<MaplibreSourceDiff["update"]> = [];
        for (const entry of diff.update as readonly LayerFeatureDiff[]) {
            if (entry.id == null) return null;
            update.push({
                id: entry.id,
                ...(entry.newGeometry ? { newGeometry: entry.newGeometry } : {}),
                ...(entry.removeAllProperties ? { removeAllProperties: true } : {}),
                ...(entry.removeProperties
                    ? { removeProperties: [...entry.removeProperties] }
                    : {}),
                ...(entry.addOrUpdateProperties
                    ? {
                          addOrUpdateProperties: entry.addOrUpdateProperties.map(
                              (p: LayerFeaturePropertyEntry) => ({ ...p })
                          ),
                      }
                    : {}),
            });
        }
        out.update = update;
    }

    return out;
}
