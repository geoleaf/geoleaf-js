/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * What a basemap definition must carry to be drawn — one predicate, for the registry that draws
 * it and for the profile check that warns about it.
 *
 * The two used to answer separately, and the check asked for less than the registry accepts:
 * "`url` or `style` is required" fell on a basemap made of `tiles` alone, on `type: "maplibre"`,
 * and on the four types whose configuration lives in their own block. Those basemaps display, so
 * the warning told an integrator that something was missing from a basemap that works.
 *
 * @version 3.16.2
 */

/** The basemap types whose configuration lives in their own block, not in `url` or `style`. */
const EXTENDED_TYPES: readonly string[] = ["image", "hillshade", "wmts", "wms"];

/**
 * Whether a basemap definition carries something to draw: a `url`, a non-empty `tiles` list, a
 * `style`, `type: "maplibre"`, or one of the types configured by their own block — `image`,
 * `hillshade`, `wmts`, `wms`. The block itself is not inspected here: its absence is the type's
 * own reader's to report.
 *
 * @param definition A basemap entry, as the profile or a caller wrote it.
 * @returns `true` when the registry can draw it.
 */
export function hasDrawableBasemapShape(definition: unknown): boolean {
    if (!definition || typeof definition !== "object") return false;
    const d = definition as Record<string, unknown>;
    if (d.url) return true;
    if (Array.isArray(d.tiles) && d.tiles.length > 0) return true;
    if (d.style || d.type === "maplibre") return true;
    return typeof d.type === "string" && EXTENDED_TYPES.includes(d.type);
}
