/*!
 * @geoleaf-plugins/realtime-layer
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * feature-index — shared feature-identity resolution for the realtime layer.
 *
 * Inbound updates are written under `[idField ?? "_realtimeId"]` (see
 * {@link ../layer-updater}), so every consumer that later looks a feature up by id
 * — the updater (find-and-update) and the stale-tracking (evict/dim stale features)
 * — must resolve identity with the SAME precedence. When they disagree, a feature
 * stored under `_realtimeId` or a custom `idField` becomes unreachable to stale
 * eviction: `remove`/`dim` silently no-op. Centralising the precedence here is what
 * keeps the two in lock-step.
 *
 * Precedence: explicit `idField` (when the property is present) → `id` → `_id` →
 * `_realtimeId`.
 */

/** Whether a feature property value equals the target id (string/number coercion only). */
function idMatches(value: unknown, id: string): boolean {
    return (typeof value === "string" || typeof value === "number") && String(value) === id;
}

/**
 * Resolve a feature's string id using the same precedence as the updater's writes.
 * Returns `""` when no usable id is present — `""` never matches a real update id,
 * so an unidentifiable feature is simply left in place rather than mis-evicted.
 *
 * @param props   - The feature's `properties` bag (may be null/undefined).
 * @param idField - The configured id field, if any.
 * @param featureId - The feature's own `id` member: read after `idField`, before the
 *   `id` / `_id` / `_realtimeId` properties — it is where the decoder reads the identity.
 */
export function resolveFeatureId(
    props: Record<string, unknown> | null | undefined,
    idField: string | undefined,
    featureId?: unknown
): string {
    if (idField && props && props[idField] !== undefined) {
        const v = props[idField];
        return typeof v === "string" || typeof v === "number" ? String(v) : "";
    }
    // The feature's own `id` first: it is where the decoder reads the identity
    // (`json-decoder.ts`), so a lookup that skipped it never found the features the boot drew.
    if (typeof featureId === "string" || typeof featureId === "number") return String(featureId);
    if (!props) return "";
    const fallback = props["id"] ?? props["_id"] ?? props["_realtimeId"] ?? "";
    return typeof fallback === "string" || typeof fallback === "number" ? String(fallback) : "";
}

/**
 * Find the index of a feature by id, honouring `idField` first and otherwise
 * falling back to `id` → `_id` → `_realtimeId`. Returns `-1` when absent.
 *
 * @param features - Features to search.
 * @param id       - Target id (as produced by the decoder).
 * @param idField  - The configured id field, if any.
 */
export function findFeatureIndex<
    T extends { id?: unknown; properties?: Record<string, unknown> | null },
>(features: T[], id: string, idField: string | undefined): number {
    return features.findIndex((f) => {
        const props = f.properties;
        if (idField && props && props[idField] !== undefined) {
            return idMatches(props[idField], id);
        }
        // 🛑 `feature.id` FIRST, and its absence here was the duplicates: the decoder takes the
        // identity from `feature.id`, this lookup read only `properties`, so not one of the
        // features the boot drew was ever found — each refresh added beside them.
        if (f.id !== undefined && f.id !== null) return idMatches(f.id, id);
        if (!props) return false;
        const fallback = props["id"] ?? props["_id"] ?? props["_realtimeId"] ?? "";
        return idMatches(fallback, id);
    });
}
