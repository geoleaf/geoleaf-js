/*!
 * GeoLeaf Core - Filter (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

"use strict";
/**
 *
 * Public `GeoLeaf.Filter` facade — generic attribute filter (side-panel, geometry-
 * agnostic, multi-source). In-core capability (S5).
 *
 * The filter is opt-out: active unless `modules.filter.enabled` is `false`. This
 * facade exposes the read surface for integrators / no-code studio; the panel and
 * predicate engine consume the capability internally.
 *
 * The plural `GeoLeaf.Filters` that used to sit beside this facade is gone (API publique
 * S4.5): one method, no caller, and a one-letter distance from this one. Nothing here
 * changed — the ambiguity did.
 *
 * ## Public API summary
 *
 * | Method | Description |
 * |---|---|
 * | `isEnabled()` | `true` when the filter is enabled |
 * | `getConfig()` | The resolved `modules.filter` config |
 * | `getActiveFilter()` | Reads the active filter as a serialisable state (permalink capture) |
 * | `applyFilter(state)` | Restores a serialised state onto the panel + sources (no ghost DOM) |
 * | `applyNow()` | Re-applies the current panel state |
 * | `reset()` | Clears every panel control and re-applies |
 * | `hasActiveFilters()` | `true` when at least one field is constrained |
 * | `proximity` | Proximity sub-API (`setRadius`/`toggle`) — replaces `_UIFilterPanelProximity` |
 */
import { buildPublicApi } from "../capabilities/filter/public-api.js";

/** The object mounted on `GeoLeaf.Filter`. */
export const Filter = buildPublicApi();
