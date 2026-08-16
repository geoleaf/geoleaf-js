/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Language-switcher capability — config reader.
 *
 * Opt-in: the button is inert unless the merged config sets
 * `modules.language-switcher.enabled: true` (real default OFF, enforced by the
 * lifecycle's late gate).
 */

import { Config } from "../../kernel/config/config-primitives.js";

/** Subset of `Config` consumed here (`get` is augmented onto Config at runtime). */
interface ConfigLike {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const _Config = Config as ConfigLike;

/** One offered language. */
export interface LanguageEntry {
    /** ISO code matching a compiled dictionary (`fr`, `en`, `es`, `pt`, `it`, `de`). */
    code: string;
    /** Endonym — each language names itself, so a lost user can find their own. */
    label: string;
    /** Regional-indicator emoji, used when `display: "flag"`. */
    flag: string;
}

/**
 * The languages the core compiles in (`utils/i18n/i18n.ts` → `LANGS`).
 *
 * Module-local: the offered set is read through `getOfferedLanguages()`, which is the
 * only supported way in (it applies the `languages` allow-list).
 *
 * Labels are ENDONYMS on purpose: someone who lands on a page in a language they cannot
 * read still recognises "Deutsch" or "Español" — "Allemand" would not help them.
 */
const SUPPORTED_LANGUAGES: readonly LanguageEntry[] = [
    { code: "fr", label: "Français", flag: "🇫🇷" },
    { code: "en", label: "English", flag: "🇬🇧" },
    { code: "es", label: "Español", flag: "🇪🇸" },
    { code: "pt", label: "Português", flag: "🇵🇹" },
    { code: "it", label: "Italiano", flag: "🇮🇹" },
    { code: "de", label: "Deutsch", flag: "🇩🇪" },
];

/** The `modules.language-switcher` capability config block. */
export interface LanguageSwitcherCapabilityConfig {
    /** Capability gate — the button is inert unless `true`. Opt-in (default OFF). */
    enabled: boolean;
    /** `"flag"` (regional emoji) or `"code"` (FR, EN…) for platforms without flag emoji. */
    display: "flag" | "code";
    /** Restricts the offered languages; empty means "every compiled dictionary". */
    languages: string[];
}

/** Built-in defaults. `enabled` is `false` — the switcher is opt-in. */
const DEFAULTS: LanguageSwitcherCapabilityConfig = {
    enabled: false,
    display: "flag",
    languages: [],
};

/** Reads `modules.language-switcher.*` merged over the built-in defaults. */
export function getLanguageSwitcherConfig(): LanguageSwitcherCapabilityConfig {
    const raw =
        _Config.get?.<Partial<LanguageSwitcherCapabilityConfig>>("modules.language-switcher", {}) ??
        {};
    const merged = { ...DEFAULTS, ...raw };
    // A typo in `display` must not render an empty button: anything but "code" reads as
    // the default.
    if (merged.display !== "code") merged.display = "flag";
    return merged;
}

/**
 * Returns the languages to offer: the compiled set, narrowed by `languages` when it
 * lists known codes.
 *
 * An unknown code is dropped rather than honoured — offering a language with no
 * dictionary would switch the UI to a silent fallback.
 */
export function getOfferedLanguages(): LanguageEntry[] {
    const { languages } = getLanguageSwitcherConfig();
    if (!Array.isArray(languages) || languages.length === 0) {
        return [...SUPPORTED_LANGUAGES];
    }
    const wanted = new Set(languages.map((c) => String(c).toLowerCase()));
    const kept = SUPPORTED_LANGUAGES.filter((l) => wanted.has(l.code));
    // A filter that matches nothing would leave an empty popover — fall back to all.
    return kept.length > 0 ? kept : [...SUPPORTED_LANGUAGES];
}
