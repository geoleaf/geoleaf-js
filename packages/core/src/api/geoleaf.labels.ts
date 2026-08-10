/*!
 * GeoLeaf Core - Labels (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Labels` facade — per-layer text labels rendered as a native
 * MapLibre `symbol` layer. In-core capability (S4, migrated from
 * `modules/optional/labels`). Mounted by `globals.ui.ts` (Full build only —
 * labels are excluded from the Lite build, PERF-02).
 *
 * Labels are opt-out: active unless `modules.labels.enabled` is `false`. The
 * layer manager injects a per-layer toggle button via the
 * `geoleaf:layer-item:controls` seam.
 */
import { buildPublicApi } from "../capabilities/labels/public-api.js";

/** The object mounted on `GeoLeaf.Labels`. */
export const Labels = buildPublicApi();
