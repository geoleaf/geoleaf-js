/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @file truncation-notice.ts
 * @description The single place that TELLS a user their layer was cut short.
 *
 * 🛑 WHY THIS FILE EXISTS (R9, tâche 2.4). `ogc-api-loader.ts` has signalled its cap
 * through a `truncated` member since 19/08/2026, with an explicit motive: *"a truncated
 * collection was INDISTINGUISHABLE from a complete one […] a silent subset is a wrong map
 * that looks correct."* The member then had **one reader in the whole repository** — the
 * offline pull, which turned it into a `capped` boolean nobody displayed. The display
 * path read it not at all. So the signal existed, was correct, and reached no one: a
 * layer of 30 000 entities under the default cap of 10 000 drew a map at a third of the
 * parc, and nothing but a `console.warn` said so.
 *
 * ## Why the primitive and not `GeoLeaf.UI.notify`
 *
 * The two surfaces do NOT degrade the same way, and only one fits a warning that must not
 * be lost — the account is `kernel/storage/eviction-notice.ts`, and it is the same here:
 *
 *   · `GeoLeaf.UI.notify.*` reads `_UINotifications` through `?.` → **silent no-op**;
 *   · `notifyPrimitive.notify()` carries a `_consoleFallback` → **`console.warn`**.
 *
 * A profile that disables the toast renderer loses the toast but **not the signal**.
 *
 * ## Why once per layer
 *
 * The display path re-fetches on `moveend` when `autoRefresh` is on. A notice emitted per
 * fetch would fire on every pan of a capped layer, and a warning that repeats forty times
 * teaches the user to dismiss it without reading — which is a slower way of being silent.
 * The guard is per layer and per session: a reload re-arms it, because a reload is also
 * when the user may have changed the cap.
 *
 * @version 1.0.0
 */

import { getLabel } from "../../../utils/i18n/i18n.js";
import { notifyPrimitive } from "../../../utils/notify/notify.primitive.js";

/** Layers already warned about, this session. */
const _announced = new Set<string>();

/** What the loader observed when it cut. Mirrors `GeoJSONFeatureCollection.truncated`. */
interface TruncationFacts {
    /** The cap that bit — `offline.maxFeatures`, `data.ogcApi.maxFeatures`, or the default. */
    readonly limit: number;
    /** What the loop had accumulated when it stopped. NOT the collection's size. */
    readonly fetched: number;
    /** The source's own `numberMatched`, when it served one. */
    readonly matched?: number;
}

/**
 * Announces, once per layer, that a layer is showing less than its source holds.
 *
 * ⚠️ **The message says "N sur M" only when M was MEASURED.** `matched` comes from the
 * source's `numberMatched`; `fetched` is what the loop had accumulated when the cap
 * stopped it — at most one page past the bound — so announcing "10 000 sur 10 999" for a
 * layer of 30 000 would be a precise-looking lie. Without `matched`, the message says the
 * layer holds more, and names no total.
 *
 * @param layerId - Layer concerned; also the deduplication key.
 * @param layerLabel - Human label to show, falling back to the identifier.
 * @param truncated - What the loader reported, or `undefined` when nothing was cut.
 * @returns `true` when a notice was emitted — `false` when nothing was cut or the layer
 *          was already announced.
 * @example
 * const fc = await fetchOgcApiFeatures(config);
 * announceTruncation("sites_rosario", "Sites", fc.truncated);
 */
export function announceTruncation(
    layerId: string,
    layerLabel: string,
    truncated: TruncationFacts | undefined
): boolean {
    if (!truncated) return false;
    if (_announced.has(layerId)) return false;
    _announced.add(layerId);

    const label = layerLabel || layerId;
    const shown = String(truncated.limit);
    const message =
        typeof truncated.matched === "number" && truncated.matched > truncated.limit
            ? getLabel("toast.layer.truncated.known", label, shown, String(truncated.matched))
            : getLabel("toast.layer.truncated.unknown", label, shown);

    notifyPrimitive.notify(message, "warning");
    return true;
}

/**
 * Forgets every announcement.
 *
 * ⚠️ **EXPORTED FOR THE TESTS, and the orphan-export sweep will flag it.** It is class D
 * of that survey — "test seams: the corpus excludes `__tests__` by design" — not dead
 * code: the deduplication is module state, so without this a second case would be
 * measuring the first case's leftovers. A profile switch is the other legitimate caller
 * the day one appears; until then, keeping it is what makes the guard testable at all.
 */
export function resetTruncationNotices(): void {
    _announced.clear();
}
