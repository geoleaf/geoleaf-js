/*!
 * GeoLeaf Core - LanguageSwitcher (public facade)
 * Released under the MIT License
 * © 2026 Mattieu Pottier
 * https://geoleaf.dev
 */

/**
 *
 * Public `GeoLeaf.LanguageSwitcher` facade — UI language selector rendered in the
 * desktop tab strip and the mobile toolbar. In-core capability.
 *
 * Opt-in: inert unless `modules.language-switcher.enabled` is `true`. The language
 * itself resolves as `?lang=` → `localStorage['gl-lang']` → `ui.language` → `fr`.
 */

import {
    buildPublicApi,
    type LanguageSwitcherPublicApi,
} from "../capabilities/language-switcher/public-api.js";

/** The object mounted on `GeoLeaf.LanguageSwitcher`. */
export const LanguageSwitcher: LanguageSwitcherPublicApi = buildPublicApi();
