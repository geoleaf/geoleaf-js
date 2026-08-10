/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — config reader.
 *
 * Reads `modules.legend.*` from the core Config singleton (typed import — the
 * in-core equivalent of the former `GeoLeaf.Config.get` runtime seam) and merges
 * it over the built-in defaults. S10 F2 — replaces the scattered `ui.showLegend` /
 * `legendConfig` reads. `collapsible` is intentionally not a profile setting (a
 * fixed control constant applied in `public-api.ts`).
 */
"use strict";

import type { LegendModuleConfig } from "./types.js";
import { Config } from "../../kernel/config/config-primitives.js";
import { getLabel } from "../../utils/i18n/i18n.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/**
 * Built-in defaults. `enabled` is `true` — the legend is opt-out (active unless a
 * profile sets `modules.legend.enabled: false`). `position` / `collapsedByDefault`
 * / `title` reproduce the former hardcoded control options so a profile carrying
 * no `modules.legend` block renders exactly as before.
 */
const DEFAULTS: Omit<LegendModuleConfig, "title"> = {
    enabled: true,
    position: "bottomleft",
    collapsedByDefault: false,
};

/**
 * Default panel title, resolved from the dictionary.
 *
 * ⚠️ Resolved LAZILY, per call — never hoisted into {@link DEFAULTS}. A module-level
 * `getLabel()` would run at import time, before `initI18n()` has read `ui.language`, and
 * would freeze the fallback language for the process. The boot order makes that a real
 * hazard, not a theoretical one.
 *
 * Was the English literal `"Legend"` until B.24/B.38 surfaced it: the schema advertised no
 * default at all, so a French interface served an English title to all six locales and
 * nothing failed. The key exists in the six dictionaries and is enforced by
 * `__tests__/i18n/requested-keys-exist.test.js`.
 */
function _defaultTitle(): string {
    return getLabel("ui.legend.title");
}

/**
 * Reads `modules.legend.*` from the running core config and merges it over the
 * built-in defaults.
 *
 * **Single accessor (B.29).** This module used to export a second, boolean one —
 * `isLegendEnabled()`, `getLegendConfig().enabled !== false` under another name.
 * Legend was the ONLY capability doing so: every sibling late-gate reads its own
 * `getXConfig()` inline (`scale/lifecycle.ts:30`, `coordinates/lifecycle.ts:35`,
 * `geolocation/lifecycle.ts:33`, `theme-toggle/lifecycle.ts:33`,
 * `toast-renderer/lifecycle.ts:179`, `filter/lifecycle.ts:48`,
 * `route/lifecycle.ts:56,65`, `feature-info/lifecycle.ts:17,25`). The late re-gate
 * legend needs is real — the boot gate runs on the pre-merge `baseCfg` — but it is
 * not specific to legend, and naming it bought a second spelling of one predicate for two
 * call sites, both inside this capability.
 */
export function getLegendConfig(): LegendModuleConfig {
    const raw = _Config.get?.<Partial<LegendModuleConfig>>("modules.legend", {}) ?? {};
    return { ...DEFAULTS, title: _defaultTitle(), ...raw };
}
