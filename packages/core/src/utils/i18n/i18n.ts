/*!
 * GeoLeaf Core — i18n
 * © 2026 Mattieu Pottier — MIT License
 *
 * Lightweight internationalisation — no external dependency.
 * Resolution order: profile labels override > active lang > French fallback > key.
 * Template variables: {0}, {1}, ...
 * https://geoleaf.dev
 */
import type { LangDict } from "../../lang/lang-fr.js";
import langFr from "../../lang/lang-fr.js";
import langEn from "../../lang/lang-en.js";
import langEs from "../../lang/lang-es.js";
import langPt from "../../lang/lang-pt.js";
import langIt from "../../lang/lang-it.js";
import langDe from "../../lang/lang-de.js";
import { Config } from "../../kernel/config/geoleaf-config/config-core.js";

/**
 * Minimal view of the `Config.get` accessor (attached at boot by
 * `config-accessors.ts`, not declared on the bare `Config` singleton type).
 */
interface ConfigGetter {
    get?<T = unknown>(path: string, defaultValue?: T): T;
}
const ConfigGet = Config as unknown as ConfigGetter;

const LANGS: Record<string, LangDict> = {
    fr: langFr,
    en: langEn,
    es: langEs,
    pt: langPt,
    it: langIt,
    de: langDe,
    al: langDe, // "al" = Allemand (French shorthand for German)
};

let _active: LangDict = langFr;
let _overrides: LangDict = {};
/** Set by the boot's {@link initI18n} only: before it, every read resolves live. */
let _initialized = false;

// Plugin i18n support — namespace → { lang → dict }
const _pluginDicts: Record<string, Record<string, LangDict>> = {};
let _pluginActive: LangDict = {};
let _pluginFr: LangDict = {};

/**
 * Returns the active language code (`"fr"`, `"en"`, …).
 *
 * Resolution order: `?lang=` → `localStorage['gl-lang']` → `ui.language` → `"fr"`. The code
 * is read back from the dictionary the labels use, never derived a second time, so the code
 * and the labels cannot drift apart.
 *
 * Before the boot's {@link initI18n}, the code follows the live configuration, like
 * {@link getLabel}: it answers what a label asked for right now would be written in.
 * After it, the code is the one the boot fixed for the page.
 *
 * Exposed on `GeoLeaf.I18n` because the code was computed internally and never published:
 * consumers that need to format a number or a date in the profile's language had no way
 * to ask, and hard-coded `"fr-FR"` instead (CAPACITÉS B.26 named this gap).
 */
export function getActiveLang(): string {
    if (!_initialized) _resolve();
    return _codeOf(_active);
}

/**
 * The canonical code of a dictionary. `al` shares German's dictionary and comes after `de`
 * in {@link LANGS}, so the first match is always the real subtag.
 */
function _codeOf(dict: LangDict): string {
    return Object.keys(LANGS).find((k) => LANGS[k] === dict) ?? "fr";
}

function _rebuildPluginFlat(): void {
    // `_active` itself, never `getActiveLang()`: before the boot the latter resolves, and
    // resolving rebuilds this table — a registration would re-enter itself.
    const activeLang = _codeOf(_active);
    _pluginActive = {};
    _pluginFr = {};
    for (const dict of Object.values(_pluginDicts)) {
        Object.assign(_pluginActive, dict[activeLang] ?? {});
        Object.assign(_pluginFr, dict["fr"] ?? {});
    }
}

/** localStorage key holding the user's standing language choice (`language-switcher`). */
export const LANG_STORAGE_KEY = "gl-lang";

/**
 * Reads the persisted language, or `null`.
 *
 * ⚠️ The `try/catch` is not defensive decoration: every label resolved before the boot,
 * and the boot's own `initI18n()`, go through here, so an exception takes the whole boot
 * down. Storage access throws outright in private browsing on some engines — the only
 * acceptable outcome is a silent fall-through to the configured language.
 */
function _readStoredLang(): string | null {
    try {
        return localStorage.getItem(LANG_STORAGE_KEY)?.toLowerCase() || null;
    } catch {
        return null;
    }
}

/**
 * Resolves the language and the profile's label overrides from the current state, and
 * rebuilds the plugin table accordingly. Writes nothing outside this module.
 *
 * Order: `?lang=` → `localStorage['gl-lang']` → `ui.language` → `"fr"`.
 */
function _resolve(): void {
    const urlLang =
        typeof location === "undefined"
            ? null
            : (new URLSearchParams(location.search).get("lang")?.toLowerCase() ?? null);
    const configCode = ConfigGet.get?.<string>("ui.language", "fr")?.toLowerCase() ?? "fr";
    // The URL parameter stays on TOP on purpose: a shared link must render the same for
    // its recipient as for its author. Were the stored preference to win, the same URL
    // would show a different language per visitor — the link would stop being a
    // reproducible reference.
    const code = urlLang ?? _readStoredLang() ?? configCode;
    _active = LANGS[code] ?? langFr;
    _overrides = (ConfigGet.get?.<LangDict>("labels", {}) as LangDict) ?? {};
    _rebuildPluginFlat();
}

/**
 * Fixes the page's language. Called by the boot (`SharedModule`), once the configuration,
 * the profile and the `beforeBoot` hook have all run — the first moment the configuration
 * is complete.
 *
 * From here on the language no longer follows the configuration: changing it means a
 * reload, which is what the language switcher does. Before this call, labels already
 * resolve, but from the live configuration and without fixing anything — see {@link getLabel}.
 *
 * Also publishes the resolved language to `<html lang>`, unless `ui.syncDocumentLang` is
 * `false` — see {@link _syncDocumentLang}.
 */
export function initI18n(): void {
    _resolve();
    _initialized = true;
    _syncDocumentLang();
}

/**
 * Publishes the resolved language to `<html lang>`, unless `ui.syncDocumentLang` is `false`.
 *
 * The deployed application shipped `<html lang="en">` hard-coded while serving six languages,
 * so a screen reader announced French content with English phonetics on every profile — and
 * the attribute was *wrong* for five of the six, including the default. It is set here, in the
 * function that RESOLVES the language, rather than in the app: any other site would be a second
 * source of truth for the same fact, free to drift from `?lang=` and from the stored preference.
 *
 * ⚠️ The value comes from {@link getActiveLang}, never from the resolution `code` above. `code`
 * can legitimately be `"al"` — a French shorthand for German that {@link LANGS} accepts — and
 * `al` is not a language subtag: writing it into `lang=` would produce an attribute no user
 * agent can interpret, which is worse than the hard-coded one it replaces. `getActiveLang()`
 * resolves back through the dictionary and yields the canonical `"de"`.
 *
 * 🛑 `ui.syncDocumentLang: false` opts OUT, and the reason it exists is that `<html lang>` is a
 * PAGE-WIDE attribute the map does not always own. Embedded in a host that sets it for its own
 * session, a map mounted in a form would rewrite the locale of everything around it. The opt-out
 * suppresses only the write: the language still resolves normally, so `getActiveLang()` and every
 * label are unaffected. Default `true` — the standalone application keeps the behaviour above.
 *
 * 🛑 {@link initI18n} is the ONLY writer, and that is the other half of the opt-out. A label
 * resolved before the boot (at a module's import, by a plugin) used to publish the attribute
 * too. At that moment neither the host's `Config.set` nor the profile had run, so the opt-out
 * was read at its default and the page's attribute was rewritten before the host could say
 * `false`. A write that happens before the configuration is complete cannot honour a key
 * of that configuration.
 */
function _syncDocumentLang(): void {
    if (typeof document === "undefined") return;
    if (ConfigGet.get?.<boolean>("ui.syncDocumentLang", true) === false) return;
    document.documentElement.lang = getActiveLang();
}

/**
 * Registers a plugin i18n dictionary. Must be called before `GeoLeaf.boot()`.
 * Keys are namespaced (e.g. `"print.toolbar.button"`) and merged into the
 * resolution table without overwriting core keys.
 *
 * @param namespace - Plugin identifier used for deduplication (e.g. `"print"`).
 * @param dictsByLang - Map of language code → `LangDict` (keys: `"fr"`, `"en"`, …).
 */
export function registerDict(namespace: string, dictsByLang: Record<string, LangDict>): void {
    _pluginDicts[namespace] = dictsByLang;
    _rebuildPluginFlat();
}

/**
 * Returns the localised label for `key`, optionally interpolating positional args.
 * Resolution order: profile overrides → active lang (core + plugins) → French (core + plugins) → key.
 *
 * Before the boot's {@link initI18n}, each call resolves the language from the live
 * configuration, and fixes and writes nothing. A host's `Config.set` made in the meantime is
 * read by the next label. A string meant to follow the profile's language must therefore be
 * resolved when its control is built, never when its module is imported.
 *
 * @example getLabel("toast.geoloc.position_found")
 * @example getLabel("toast.geoloc.error_timeout", "timeout")
 */
export function getLabel(key: string, ...args: string[]): string {
    if (!_initialized) _resolve();
    let label: string =
        _overrides[key] ??
        _active[key] ??
        _pluginActive[key] ??
        langFr[key] ??
        _pluginFr[key] ??
        key;
    for (const [i, arg] of args.entries()) {
        label = label.replace(`{${i}}`, arg);
    }
    return label;
}

/**
 * Plugin/consumer seam mounted as `GeoLeaf.I18n.t`. Resolves `key`, returning the
 * provided `fallback` (or the key itself) when no dictionary defines it.
 *
 * Distinct from {@link getLabel}, whose extra positional args are interpolation
 * values: the `t(key, fallback)` contract (documented by the field renderer and
 * consumed by feature-info) treats the second argument as a fallback string.
 * Output is byte-identical to the previous inline fallbacks when no dict is
 * registered; a registered dict now actually resolves the key (RM-P2 #7 — the
 * `.t` seam was never mounted, so consumers always fell back).
 */
export function t(key: string, fallback?: string): string {
    const resolved = getLabel(key);
    return resolved === key ? (fallback ?? key) : resolved;
}
