/*!
 * GeoLeaf Core - Taxonomy (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Taxonomy` facade — geometry-agnostic category styling
 * (icon / fill / stroke) driven by a `value → style` mapping. Reclassified from
 * `@geoleaf-plugins/taxonomy` into an in-core capability (SR0).
 *
 * The capability is **opt-out**: its gate defaults to `true`, so it is active unless a profile
 * sets `modules.taxonomy.enabled: false`. Category paint is **pulled** by its consumers — the
 * POI renderer, the legend and the filter call this facade when they need to resolve a style;
 * nothing pushes paint onto bound layers.
 *
 * ⚠️ Both statements above were the exact opposite until 29/07/2026 (B-63). The header said the
 * capability was "inert unless `modules.taxonomy.enabled` is set" — it is opt-out — and that paint
 * was "applied automatically via the capability lifecycle" — this capability has **no lifecycle at
 * all**, which its own `install.ts` states directly above the same code. Both were published to
 * integrators through TypeDoc, and neither could be caught by a gate: whether a sentence is
 * still TRUE has no verifier, and never will — that one is left to the human reviewer.
 *
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `isEnabled()` | `true` when `modules.taxonomy.enabled` is set |
 * | `resolvePoiIcon(poi)` | Resolves the icon a POI point should display |
 * | `getCategories(ref)` | Returns a named taxonomy's `value → style` table |
 * | `resolveTitleIcon(layerId, feature, surface)` | Title icon `symbolId` for a feature on a surface (per-surface `render` flags, priority sub→cat→default) |
 * | `ensureSprite()` | Ensures the profile sprite `<symbol>` defs are in the DOM (for `<use>`) |
 */
import { buildPublicApi } from "../capabilities/taxonomy/public-api.js";

/** The object mounted on `GeoLeaf.Taxonomy`. */
export const Taxonomy = buildPublicApi();
