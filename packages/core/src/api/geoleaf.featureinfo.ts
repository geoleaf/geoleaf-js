/*!
 * GeoLeaf Core - Feature Info (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.FeatureInfo` facade — attribute rendering on feature
 * click/hover across three surfaces (tooltip, popup, side-panel). Reclassified
 * from `@geoleaf-plugins/feature-info` into an in-core capability (SR0).
 *
 * The capability is active unless `modules.feature-info.enabled` is `false`.
 * Rendering is driven automatically by the `geoleaf:feature:click/hover` seam;
 * this facade exposes the imperative open/close surface.
 *
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `isEnabled()` | `true` unless `modules.feature-info.enabled` is `false` |
 * | `close()` | Closes the popup and the side-panel if open |
 * | `openPopup(detail, layout?)` | Opens the click popup for a feature |
 * | `openSidePanel(detail, layout?)` | Opens the side-panel for a feature |
 * | `getConfig(layerId)` | Returns the resolved per-layer binding, or `null` |
 */
import { buildPublicApi } from "../capabilities/feature-info/public-api.js";

/** The object mounted on `GeoLeaf.FeatureInfo`. */
export const FeatureInfo = buildPublicApi();
