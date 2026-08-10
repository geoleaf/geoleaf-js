/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Permalink capability — default serialized field set.
 *
 * The same default array lived as a bare literal in three places that must agree: the
 * state capture (`permalink-sync._captureState`), the URL parse
 * (`permalink-url._parseParams`) and the URL build (`permalink-url.buildUrl`). When
 * `config.fields` is unset each site fell back to its own copy, so editing one without
 * the others would silently drop or add a field on only one half of the round-trip.
 *
 * Centralising the array here — imported by both `permalink-sync` and `permalink-url`
 * — makes the captured field set and the serialized field set identical by construction.
 * The order mirrors the {@link PermalinkState} key order.
 *
 * The list holds the **optional facets only**: `lat` / `lng` / `zoom` used to sit in it
 * but were inert (the view state is structurally mandatory — `buildUrl` always writes it
 * and `_parseParams` always requires it), so listing them promised a granularity the
 * runtime never honoured. They are now declared mandatory in `PermalinkConfig.fields`'
 * TSDoc and excluded from the enum.
 */
"use strict";

import type { PermalinkConfig } from "../../kernel/config/geoleaf-config/config-types.js";

/** One serializable permalink field name — an element of `PermalinkConfig.fields`. */
type PermalinkField = NonNullable<PermalinkConfig["fields"]>[number];

/**
 * Default set of optional facets serialized into the permalink when `config.fields` is
 * unset (layer visibility + taxonomy/tag/rating facets + text filter + theme).
 *
 * It doubles as the **exhaustive** list of whitelistable facets: `permalink-url` iterates
 * it to prune a state down to `config.fields` (compact path included). The view triple
 * (`lat` / `lng` / `zoom`) is deliberately absent — it is always serialized and always
 * required on parse.
 */
export const DEFAULT_PERMALINK_FIELDS: readonly PermalinkField[] = [
    "layers",
    "shownLayers",
    "filter",
    "categories",
    "tags",
    "rating",
    "theme",
];

/**
 * DOM id of the Filter capability's panel — the mount the permalink filter restore
 * waits for before calling `GeoLeaf.Filter.applyFilter()` (which writes onto the real
 * controls since S13, so it needs the panel to exist).
 *
 * Declared here rather than imported from `capabilities/filter/`: permalink talks to
 * the Filter capability through its public contract (`GeoLeaf.Filter`) only, and must
 * not take a module dependency on it. The id is a stable public DOM hook — the desktop
 * panel, the mobile toolbar and the mobile sheet all query it the same way.
 */
export const FILTER_PANEL_ID = "gl-filter-panel";
