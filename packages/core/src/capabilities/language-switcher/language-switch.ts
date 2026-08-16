/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Language-switcher capability — the switch itself.
 *
 * Switching reloads the page: `initI18n()` freezes the active dictionary at boot, and
 * every label is resolved when its DOM node is BUILT. Swapping in place would mean
 * re-rendering the whole UI — out of scope, and the reload is the mechanism the demo
 * layer used before T1b removed it.
 */

import { Log } from "../../utils/log/index.js";
import { LANG_STORAGE_KEY } from "../../utils/i18n/i18n.js";

/** Language codes are ISO-ish and land in a URL — keep the accepted shape narrow. */
const LANG_CODE_RE = /^[a-z]{2}$/;

/**
 * Persists `code` and reloads with `?lang=<code>`.
 *
 * Both channels are written for the same reason as the profile switcher: the URL
 * parameter makes THIS load deterministic (and is what `initI18n` reads first), while
 * localStorage carries the preference to later visits.
 *
 * @param code - Target language code (validated).
 */
export function switchToLanguage(code: string): void {
    const lang = String(code).toLowerCase();
    if (!LANG_CODE_RE.test(lang)) {
        Log?.warn?.("[LanguageSwitcher] Refusing invalid language code:", code);
        return;
    }

    try {
        localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch (e) {
        // Private browsing: the switch still applies to this load through ?lang=, it
        // just will not be remembered.
        Log?.warn?.("[LanguageSwitcher] Unable to persist language choice:", e);
    }

    try {
        const url = new URL(window.location.href);
        url.searchParams.set("lang", lang);
        window.location.href = url.href;
    } catch (e) {
        Log?.error?.("[LanguageSwitcher] Language switch failed:", e);
    }
}
