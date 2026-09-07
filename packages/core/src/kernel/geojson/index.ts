/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * @description Public barrel for the GeoJSON sub-system.
 *
 * Mediated entry point for the `capabilities/ → kernel/` boundary (backlog R.8) —
 * the busiest edge of that boundary (9 of the 25 mediated imports).
 *
 * ⚠️ **Types are NOT re-exported here.** The domain type hubs (`core-types.ts`,
 * `loader/loader-types.ts`) are a documented category of their own
 * (`ARCHITECTURE.md` §Hubs `<module>-types.ts`) and stay directly importable: routing
 * compile-time-only imports through a runtime barrel would pull the implementation
 * modules into the graph for consumers that need nothing but a shape.
 *
 * Named re-exports only — never `export *`.
 */

export { GeoJSONCore } from "./core.js";
export { GeoJSONShared } from "./shared.js";
export { VisibilityManager } from "./visibility-manager.js";
export { bindFeatureInteractionEvents } from "./feature-interaction.js";

/**
 * OGC API Features transport — mediation added for the offline pull.
 *
 * The offline pull lives under `capabilities/offline/pull/` and must reach
 * `loader/ogc-api-loader.js`, which the boundary forbids it to import deeply.
 * Widening this barrel is the gesture the rule **designates** — not a workaround:
 * the mediation stays visible here, and it is motivated.
 *
 * ⚠️ Bundle cost **zero**, and that is what makes the gesture safe:
 * `loader/single-layer.ts` already imports `fetchOgcApiFeatures` **statically**,
 * so `ogc-api-loader.js` has long been in the geojson chunk's eager closure. This
 * re-export adds no module to it.
 *
 * `streamOgcApiFeatures` joined it for the chunked pull (R9): the pull consumes the
 * collection page by page instead of materialising it, so it needs the walk, not the
 * accumulator. Same module, same chunk, same zero cost.
 */
export { fetchOgcApiFeatures, streamOgcApiFeatures } from "./loader/ogc-api-loader.js";
export type { OgcApiPage, OgcApiStreamOutcome } from "./loader/ogc-api-loader.js";

/**
 * Truncation notice — mediated for the same reason, and for the same importer.
 *
 * The offline pull is the only caller of `announceTruncation` outside `kernel/`, and it
 * reaches it through the dynamic import above rather than a static one: the notice is
 * needed at pull time, and putting it in the offline chunk's eager graph would undo what
 * that dynamic import buys.
 */
export { announceTruncation, resetTruncationNotices } from "./loader/truncation-notice.js";
