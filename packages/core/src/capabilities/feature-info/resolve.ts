/*!
 * GeoLeaf Core (feature-info capability) — Feature model normalization & path resolution
 * © 2026 Mattieu Pottier — MIT License
 *
 * Authored field configs address a normalized `{ properties, attributes }`
 * feature model with dotted paths (`properties.Name`, `attributes.photo`),
 * matching the legacy core renderer. The kernel seam
 * (`geoleaf:feature:click/hover`) delivers the raw MapLibre property bag, whose
 * shape varies:
 *   - rich attributes may sit nested under `properties.attributes` (an object,
 *     or a JSON string — MapLibre GL serializes nested values across the worker
 *     boundary), or
 *   - already hoisted to the top level (a flat bag).
 * This module builds a normalized model from either shape and resolves dotted
 * paths against it — falling back to flat access — so a config authored before
 * the extraction renders identically regardless of how the bag arrives.
 * https://geoleaf.dev
 */

/** Normalized feature: a `properties` namespace and an `attributes` namespace. */
export interface NormalizedFeature {
    readonly properties: Record<string, unknown>;
    readonly attributes: Record<string, unknown>;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Returns `v` as a plain object — parsing a JSON-encoded object string — else `null`. */
function asObject(v: unknown): Record<string, unknown> | null {
    if (isPlainObject(v)) return v;
    if (typeof v === "string") {
        try {
            const parsed: unknown = JSON.parse(v);
            if (isPlainObject(parsed)) return parsed;
        } catch {
            // Not a JSON object string — no nested attributes to expose.
        }
    }
    return null;
}

/**
 * Builds the normalized `{ properties, attributes }` model from a raw feature
 * property bag. `attributes` is the nested `raw.attributes` (object or
 * JSON-string) when present, else an empty object. `properties` stays the raw
 * bag, so `properties.<key>`, `attributes.<key>`, and flat `<key>` paths all
 * resolve via {@link resolvePath}.
 *
 * @param raw Raw feature property bag (`feature.properties`).
 */
export function buildNormalizedModel(
    raw: Record<string, unknown> | null | undefined
): NormalizedFeature {
    const properties = isPlainObject(raw) ? raw : {};
    const attributes = asObject(properties["attributes"]) ?? {};
    return { properties, attributes };
}

/** Walks a dotted path (as segments) from `obj`, returning `undefined` on any miss. */
function traverse(obj: unknown, segments: readonly string[]): unknown {
    let cur = obj;
    for (const seg of segments) {
        if (isPlainObject(cur) && seg in cur) {
            cur = cur[seg];
        } else {
            return undefined;
        }
    }
    return cur;
}

/**
 * Resolves a dotted `path` against the normalized model.
 *
 * A `properties.*` / `attributes.*` path is first resolved from the model root;
 * if that misses (the runtime bag is flat — nested attributes hoisted to the
 * top level), the remainder is resolved against both namespaces. A bare key is
 * resolved flat against `properties`. Returns `undefined` when nothing matches.
 *
 * @param model Normalized feature model.
 * @param path Dotted path (e.g. `"attributes.photo"`) or a flat key.
 */
export function resolvePath(model: NormalizedFeature, path: string): unknown {
    if (typeof path !== "string" || path.length === 0) return undefined;
    const segments = path.split(".");
    const head = segments[0];
    if (head === "properties" || head === "attributes") {
        const direct = traverse(model, segments);
        if (direct !== undefined) return direct;
        // Fallback: flat bag — resolve the tail against both namespaces.
        const rest = segments.slice(1);
        const fromProps = traverse(model.properties, rest);
        if (fromProps !== undefined) return fromProps;
        return traverse(model.attributes, rest);
    }
    return traverse(model.properties, segments);
}
