/*!
 * GeoLeaf Core – Filters / Utils
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Dotted-path read for the filter engine.
 *
 * Public-API review — this file used to hold two more exports, both dead once
 * `GeoLeaf.Filters` and its route engine were removed:
 *
 *   - `extractRouteCoords` — only caller was the proximity predicate of `route-filter.ts` ;
 *   - `getSearchFieldsFromProfile` (+ its 3 private helpers) — only caller was the same file.
 *     It derived search fields from the profile LAYOUT (`panels.detail.layout[].search:true`,
 *     then the legacy `panels.search.filters`). That is the pre-S5 mechanism: the current
 *     engine reads them from the filter DESCRIPTOR instead (`engine/predicate.ts`,
 *     `active.descriptor.searchFields`). It was superseded, not merely unused — which is why
 *     it is deleted rather than kept wired to nothing.
 *
 * Their removal emptied `filter-types.ts`, deleted in the same commit. The one export left
 * has a single consumer: `capabilities/filter/engine/field-access.ts`.
 */

/**
 * Reads a value at a dotted path (e.g. "attributes.shortDescription").
 *
 * ⚠️ Not interchangeable with `Utils.getNestedValue()` (utils/general/object-utils.ts),
 * despite the identical name. This one refuses to traverse a primitive, so `"title.length"`
 * resolves to `null`; the kernel copy returns `5`. Routing this call site to the kernel would
 * WIDEN what a filter descriptor's `searchFields` can reach — a behaviour change, not a
 * de-duplication. The true twin is `kernel/geojson/style-resolver.ts` (same semantics);
 * merging those two belongs to the kernel, not to this capability.
 *
 * @param obj - Object to read from.
 * @param path - Dot-separated path.
 * @returns The value at `path`, or `null` when any segment is missing.
 */
export function getNestedValue(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((current, prop) => {
        if (
            current &&
            typeof current === "object" &&
            (current as Record<string, unknown>)[prop] !== undefined
        ) {
            return (current as Record<string, unknown>)[prop];
        }
        return null;
    }, obj);
}
