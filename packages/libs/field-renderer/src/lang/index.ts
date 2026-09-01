/*!
 * @geoleaf/field-renderer — built-in label catalogue
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The `form.*` labels the library **owns**.
 *
 * 🛑 **THIS CATALOGUE FIXES AN OWNERSHIP INVERSION, not a tidy-up.** The
 * library used **43 `form.*` keys it declared nowhere**: they lived in
 * `editor`'s and `addpoi`'s dictionaries, i.e. at its consumers. A host
 * loading the lib **alone** thus saw `_getLabel` fall back to **the raw key**
 * — `form.error.imageSize` shown as-is to the user.
 *
 * ⚠️ **And the demonstration happened in the act twice**: two tasks had to
 * write their new keys **into both plugin catalogues**, for want of an owner.
 *
 * ⚠️ **Reading stays opportunistic** — the lib still does not depend on
 * GeoLeaf. The order is: the host's dictionary, then this catalogue, then the
 * key. A host thus keeps the last word on its labels, and the lib works alone.
 */
import fr from "./lang-fr.js";
import en from "./lang-en.js";
import es from "./lang-es.js";
import de from "./lang-de.js";
import it from "./lang-it.js";
import pt from "./lang-pt.js";

/** The repo's six locales, indexed by code. */
const _CATALOGUE: Record<string, Record<string, string>> = { fr, en, es, de, it, pt };

/** Locale served when the requested one is unknown. */
export const FALLBACK_LANG = "fr";

/**
 * Looks a label up in the built-in catalogue.
 *
 * ⚠️ The {@link FALLBACK_LANG} fallback is **per key**, not per locale: a
 * locale losing a key would return the French label rather than the raw key.
 * A word in the wrong language stays readable; `form.error.imageSize` does not.
 *
 * @param key  - `form.*` key.
 * @param lang - Two-letter language code.
 * @returns the label, or `undefined` when the key is unknown everywhere.
 *
 * @example
 * ```ts
 * builtinLabel("form.error.imageSize", "en"); // "Image too large"
 * ```
 */
export function builtinLabel(key: string, lang: string): string | undefined {
    return _CATALOGUE[lang]?.[key] ?? _CATALOGUE[FALLBACK_LANG]?.[key];
}

/** @returns the locale codes the built-in catalogue carries. */
export function builtinLangs(): string[] {
    return Object.keys(_CATALOGUE);
}
