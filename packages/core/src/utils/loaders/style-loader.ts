/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */
/**
 * @fileoverview Aggregator for GeoLeaf style loader — re-exports from sub-modules.
 * Refactored in Sprint 1: 1549 lines split into style-cache.ts, label-extractor.ts,
 * style-loader-core.ts, style-from-layer.ts.
 *
 * KERNEL S11 — the façade went from 10 members to 4. `initStyleLoader`, `loadStyleLenient`,
 * `preloadStyles` and `getCacheStats` had no production caller and were deleted along with
 * `style-from-layer.ts` (both of its exports were likewise test-only). `StyleLoader` is NOT
 * part of the public surface — it appears in neither `kernel-exports.ts`, `bundle-esm-entry.ts`
 * nor `globals.*.ts`, so it never reaches the generated `dist/types/` — so this was an
 * internal purge.
 *
 * `extractLabelConfig` is kept here for API symmetry, but note its production consumer
 * (`style-loader-core`) imports it directly from `label-extractor.js`, not through this façade.
 */

"use strict";

import { styleCache, clearStyleCache } from "./style-cache.js";
import { extractLabelConfig } from "./label-extractor.js";
import { loadAndValidateStyle } from "./style-loader-core.js";

/**
 * Module Style Loader — exposes all public functions.
 */
const StyleLoader = {
    loadAndValidateStyle,
    extractLabelConfig,
    clearStyleCache,
    styleCache,
};

export { StyleLoader };
