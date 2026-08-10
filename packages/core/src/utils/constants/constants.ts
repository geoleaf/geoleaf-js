/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description GeoLeaf global constants — centralized numeric values plus the
 * shared runtime version fallback.
 */

/**
 * Frozen tuning constants, exposed as `GeoLeaf.CONSTANTS`.
 *
 * ⚠️ **Do not purge the "unused" keys.** Only `DEFAULT_ZOOM`, `DEFAULT_CENTER` and
 * `GEOJSON_MAX_ZOOM_ON_FIT` have an internal reader; the other 10 have none, and a
 * dead-code sweep flagged them as such (S5 backlog B.3). They are kept on purpose:
 * all 13 are **public API** — documented key by key in
 * `packages/core/docs/constants/GeoLeaf_Constants_README.md`, mounted at runtime by
 * `globals.core.ts`, and re-exported by `kernel-exports.ts` (so they reach the generated
 * `dist/types/`, the published type contract since ARCHI S6 removed the root `index.d.ts`).
 *
 * Removing one is a **silent** breaking change: integrators read them through the
 * namespace, and until S5 the public type was a bare index signature, so TypeScript
 * would not have flagged a single call site. That declaration is now explicit — a
 * removal at least breaks compilation on the consumer side.
 */
export const CONSTANTS = Object.freeze({
    // Carte — vue neutre, le fitBounds positionne after loading des layers
    DEFAULT_ZOOM: 3,
    DEFAULT_CENTER: [0, 0] as [number, number],
    MAX_ZOOM_ON_FIT: 15,

    // POI
    POI_MARKER_SIZE: 12,
    POI_MAX_ZOOM: 18,
    POI_SWIPE_THRESHOLD: 50,
    POI_LIGHTBOX_TRANSITION_MS: 300,
    POI_SIDEPANEL_DEFAULT_WIDTH: 420,

    // Route
    ROUTE_MAX_ZOOM_ON_FIT: 14,
    ROUTE_WAYPOINT_RADIUS: 5,

    // GeoJSON
    GEOJSON_MAX_ZOOM_ON_FIT: 15,
    GEOJSON_POINT_RADIUS: 6,

    // UI
    FULLSCREEN_TRANSITION_MS: 10,
});

/**
 * Default feature color used when a rule/paint declares no explicit color.
 * Single source of truth shared by the MapLibre style converter (on-map paint) and
 * the legend generator (auto-legend swatch) so they stay in sync. Kept in this
 * neutral module so the legend capability never imports the adapter (socle B.1).
 * (RM-P2 #4 — the legend used to default to Leaflet blue `#3388ff` while the map
 * rendered this grey.)
 */
export const DEFAULT_FEATURE_COLOR = "#cccccc";

/**
 * Fallback version string used **only** in dev/test, when the Rollup-injected
 * `__GEOLEAF_VERSION__` token is absent. Production builds always carry the real
 * `package.json` version via `GeoLeaf._version`; every public version surface
 * (`GeoLeaf.version`, the ESM `GeoLeafAPI.version`, the boot toast) mirrors that
 * value and falls back here. Single source of truth for the fallback — replaces
 * the previously divergent `1.2.0-dev` / `1.2.0` / `1.1.0` literals.
 */
export const VERSION_FALLBACK = "3.0.0-dev";
