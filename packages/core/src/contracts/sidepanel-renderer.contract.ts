/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Contract — Side-panel renderer (public type boundary)
 *
 * Structural shape a rendering surface must satisfy to be usable as the
 * kernel's side-panel implementation. There is no import relationship across
 * the plugin/core boundary: `@geoleaf-plugins/feature-info` declares the same
 * shape independently (`ISidePanelRenderer` in its own `types.ts`, checked at
 * compile time against its own exports) and is looked up at runtime via
 * `globalThis.GeoLeaf.FeatureInfo` — never imported statically.
 */

/**
 * Geometry payload of a rendered feature, or `null` when unavailable
 * (e.g. a POI without GeoJSON geometry).
 */
export interface SidePanelFeatureGeometry {
    type: string;
    coordinates: unknown;
}

/**
 * Click-like detail describing the feature a side-panel (or popup) opens for.
 * Mirrors `GeoLeafFeatureClickDetail` (`contracts/event-bus.contract.ts`) —
 * kept as a separate, structurally-identical type here so this contract has
 * no dependency direction onto the GeoJSON event contract.
 */
export interface SidePanelFeatureDetail {
    /** GeoLeaf layer id the feature belongs to. */
    layerId: string;
    /** Stable feature id, or `null` when the source has none. */
    featureId: string | number | null;
    /** Feature properties (attribute bag). */
    properties: Record<string, unknown>;
    /** Feature geometry, or `null` when unavailable. */
    geometry: SidePanelFeatureGeometry | null;
    /** Geographic position associated with the interaction. */
    lngLat: { lat: number; lng: number };
    /** Pixel coordinates within the map container, when known. */
    point: { x: number; y: number };
}

/**
 * One field to render in the side-panel body.
 *
 * `type` and `style` stay plain strings HERE: this contract describes an injection
 * boundary, and core only ever copies values across it — it never validates them.
 *
 * ⚠️ This paragraph named two closed unions "in `plugin-feature-info`". Both claims
 * were stale: the package was reclassified as an in-core capability long ago, and the
 * two unions were deleted at the Sprint 2 deletion pass because they had drifted from
 * what the engine renders. The closed vocabulary now lives in
 * `contracts/attributes.contract.ts`, where a schema and a parity gate can confront it.
 */
export interface SidePanelLayoutField {
    readonly field: string;
    readonly label?: string;
    readonly type?: string;
    readonly style?: string;
    readonly hidden?: boolean;
    readonly format?: string;
    readonly actionId?: string;
}

/**
 * Explicit field layout a caller can pass to `openSidePanel()` to bypass the
 * renderer's own auto-resolution (from its per-layer config). Used when the
 * caller (e.g. POI) already knows the authoritative field list and title.
 */
export interface SidePanelLayout {
    readonly layerId: string;
    readonly fields: readonly SidePanelLayoutField[];
    readonly titleField?: string;
    readonly lngLat?: { readonly lng: number; readonly lat: number };
    readonly featureId?: string | number;
}

/**
 * Structural contract a side-panel renderer must satisfy. Consumed by the
 * kernel via a runtime duck-type check on `globalThis.GeoLeaf.FeatureInfo`
 * (see `app/boot-modules/feature-info.module.ts`) — never imported. Implemented by
 * `capabilities/feature-info/surfaces/sidepanel.ts` (S9).
 */
export interface ISidePanelRenderer {
    /** Opens (or re-opens) the side-panel for the given feature. */
    readonly openSidePanel: (detail: SidePanelFeatureDetail, layout?: SidePanelLayout) => void;
    /** Closes the side-panel, if open. */
    readonly closeSidePanel: () => void;
    /** Returns `true` when the side-panel is currently open. */
    readonly isSidePanelOpen: () => boolean;
}
