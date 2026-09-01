/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @fileoverview Resolves the geometry a layer configuration declares, in either spelling.
 *
 * 🛑 WHY THIS FILE EXISTS — `geometry` and `geometryType` are THE SAME FIELD.
 *
 * The schema says it explicitly (`profiles/schemas/layer-config.schema.json:42`):
 * "Root-level **alias of `geometry`**. Canonical form READ BY THE CODE — do NOT
 * migrate (ANO-007)". Both carry the same `enum`. The arbitration is thus
 * **already taken**: profiles are not migrated, and the code reads both.
 *
 * It did not. Measured on 07/08/2026 over the **24** layer configs of the 3
 * profiles:
 *
 * | What the config declares | Count |
 * |---|---|
 * | `geometry` alone | **18** |
 * | both | 6 |
 * | `geometryType` alone | **0** |
 *
 * And of the **7** sites reading this field, **3** resolved the alias by hand
 * (`legend.ts`, the two `vector-tiles`) and **4** read `geometryType` alone — i.e.
 * the key **no** config carries without the other. Measured consequences: 38 of
 * the offline selector's 42 rows rendered `-`, and the editor's
 * `_acceptsGeometry` fell back to "accepts ANY geometry" for a layer declaring its
 * own — the failure mode its own TSDoc describes as dangerous.
 *
 * ⚠️ **The three hand-rolled resolutions already diverged on their FALLBACK**:
 * `"point"` for the legend, `"polygon"` for vector tiles. That is why the fallback
 * is a **parameter** here — collapsing them onto a single value would have changed
 * two subsystems' behaviour with nothing asking for it.
 */

/**
 * Every geometry family, in the two vocabularies that name it.
 *
 * 🛑 THERE ARE TWO, and they had never been reconciled. A profile declares its layer's kind
 * in LOWERCASE — `profiles/schemas/layer-config.schema.json` allows nothing else — while the
 * MapLibre adapter's fast path only ever accepted GeoJSON names. Measured on 27/08/2026:
 * **0 of the 25 layer configs in the repo reached that fast path**. A declaration nobody can
 * spell is not a fast path, it is a silently ignored field.
 *
 * The lowercase kinds expand to BOTH the singular and the `Multi` form: a kind names a
 * family, not one encoding, and a consumer testing for `MultiLineString` must not miss a
 * layer that calls itself `polyline`.
 */
const _GEOMETRY_FAMILIES: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
    [
        ["point", "multipoint"],
        ["Point", "MultiPoint"],
    ],
    [
        ["line", "polyline", "multiline", "linestring", "multilinestring"],
        ["LineString", "MultiLineString"],
    ],
    [
        ["polygon", "multipolygon", "fill-extrusion"],
        ["Polygon", "MultiPolygon"],
    ],
];

/** GeoJSON names accepted verbatim, so an exact declaration stays exact. */
const _GEOJSON_TYPES: ReadonlySet<string> = new Set([
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
]);

/**
 * The GeoJSON geometry types a declared kind names, in either vocabulary.
 *
 * A GeoJSON name is kept verbatim; a lowercase kind expands to its family; anything else
 * answers an EMPTY set. Empty is the honest answer for a token nobody defined — a guess
 * would render a layer as something it never said it was, and no caller could tell.
 *
 * @param kind - One declared value, or a list of them. Any other type answers empty.
 * @returns The GeoJSON type names, possibly empty. Never `null`.
 * @example
 * geometryKindToGeoJSONTypes("polyline");  // Set { "LineString", "MultiLineString" }
 * geometryKindToGeoJSONTypes("Point");     // Set { "Point" }
 * geometryKindToGeoJSONTypes("hexagon");   // Set {}
 */
export function geometryKindToGeoJSONTypes(kind: unknown): Set<string> {
    const out = new Set<string>();
    const list = Array.isArray(kind) ? kind : kind != null ? [kind] : [];
    for (const raw of list) {
        if (typeof raw !== "string" || raw.length === 0) continue;
        if (_GEOJSON_TYPES.has(raw)) {
            out.add(raw);
            continue;
        }
        const lower = raw.toLowerCase();
        for (const [kinds, types] of _GEOMETRY_FAMILIES) {
            if (kinds.includes(lower)) for (const t of types) out.add(t);
        }
    }
    return out;
}

/**
 * The minimal shape this helper reads — any layer config satisfies it.
 *
 * ⚠️ NOT exported: it has no named consumer, callers passing their config as-is.
 * Exporting it came out as a `check-orphan-exports` regression when first added,
 * and ALLOWLISTING it would have been exempting ourselves from a gate rather than
 * listening to it.
 */
interface LayerGeometryShape {
    geometry?: unknown;
    geometryType?: unknown;
}

/**
 * The geometry a layer configuration declares, whichever of the two aliases carries it.
 *
 * ⚠️ `geometryType` wins when both are present. They are aliases, so this only matters if a
 * profile declares them with DIFFERENT values — measured on 07/08/2026: **0 of the 6 configs
 * that declare both disagree**. Should that ever change, the disagreement is a profile error
 * and belongs to `validate:profiles`, not to a silent tie-break here.
 *
 * @param config - A layer configuration, raw from disk or normalised by the profile loader.
 * @param fallback - Returned when the config declares neither key. Defaults to `null`.
 * @returns The declared geometry (e.g. `"point"`, `"polygon"`), or `fallback`.
 * @example
 * layerGeometry({ geometryType: "point" });              // "point"
 * layerGeometry({ geometry: "polygon" });                // "polygon"
 * layerGeometry({ geometry: "line" }, "point");          // "line"
 * layerGeometry({ label: "sans géométrie" });            // null
 * layerGeometry({ label: "sans géométrie" }, "polygon"); // "polygon"
 */
export function layerGeometry<T extends string | null = null>(
    config: LayerGeometryShape | null | undefined,
    fallback: T = null as T
): string | T {
    if (!config || typeof config !== "object") return fallback;
    if (typeof config.geometryType === "string" && config.geometryType) return config.geometryType;
    if (typeof config.geometry === "string" && config.geometry) return config.geometry;
    return fallback;
}
