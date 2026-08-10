/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Vector Tiles (public type boundary)
 *
 * Engine-agnostic description of a vector-tile layer, consumed by
 * `IMapAdapter.addVectorTileLayer` / `updateVectorTileLayerStyle`. Split out of
 * `map-adapter.contract.ts` (socle B.1) to keep that file under the 700-line budget.
 * Pure type surface — no runtime value (see `scripts/check-contracts-pure.cjs`).
 */

/**
 * Raw GeoLeaf style inputs for a vector-tile layer — the adapter normalises these to
 * engine paint (no MapLibre paint object ever crosses this boundary). Socle B.1.
 */
export interface VectorTileStyleInput {
    /** Profile-level default style (e.g. `state.options.defaultStyle`). */
    defaultStyle?: unknown;
    /** Layer-resolved style object, if any. */
    resolvedStyle?: unknown;
    /** Data-driven style rules (GeoLeaf `GeoJSONStyleRule[]`, opaque here). */
    styleRules?: unknown[];
}

/**
 * Engine-agnostic description of a vector-tile layer to add via
 * `IMapAdapter.addVectorTileLayer`. Socle B.1 — lets the `vector-tiles` capability
 * describe *what* to render without importing MapLibre builders.
 */
export interface VectorTileLayerSpec {
    /** Full tile URL template (`.../{z}/{x}/{y}.pbf`). */
    tileUrl: string;
    /** MVT source-layer name to render. */
    sourceLayer: string;
    /** Expected geometry: `"point"` | `"polygon"` | `"line"` | … | `"fill-extrusion"` | `"mixed"`. */
    geometryType: string;
    /** Paint z-order hint (default 0). */
    zIndex?: number;
    /** Vector source bounds. */
    source?: {
        minZoom?: number;
        maxNativeZoom?: number;
        scheme?: string;
        bounds?: number[];
    };
    /** Per-sub-layer zoom constraints. */
    subLayerZoom?: { minZoom?: number; maxZoom?: number };
    /** Raw GeoLeaf style — normalised by the adapter. */
    style?: VectorTileStyleInput;
}
