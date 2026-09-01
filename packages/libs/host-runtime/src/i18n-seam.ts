/*!
 * @geoleaf/host-runtime — i18n runtime seam
 * © 2026 Mattieu Pottier — MIT License
 *
 * Consolidated at STRUCT S2 (F2) from the four copies carried by `plugin-connector`,
 * `plugin-geocoding`, `plugin-storage` and `plugin-table` (X2e). connector and
 * geocoding were byte-identical; the other two differed only in their fallback.
 * https://geoleaf.dev
 */

/**
 * Runtime seam for the core i18n catalog.
 *
 * The catalog itself lives in the core (`packages/core/src/utils/i18n/i18n.ts`):
 * dictionary registration, `?lang=` → `ui.language` → `"fr"` resolution order and
 * `{0}` interpolation all belong there. These are ACCESSORS — re-deriving any of that
 * here would drift the first time one side changes.
 *
 * ⚠️ The exported name is `tLabel`, not `t`. `t` is the single most common local
 * variable name in the plugin zone (six unrelated `const t = …`, four of them in
 * `plugin-print`), and `verify-plugin-shared-fork` cannot tell a one-letter local
 * apart from a fork. Consumers that prefer the short name alias it at the import:
 * `import { tLabel as t } from "@geoleaf/host-runtime"`.
 */

/** The i18n façade the core mounts on `GeoLeaf.I18n`. */
type I18nFacade = {
    getLabel?: (key: string, ...args: string[]) => string;
    getActiveLang?: () => string;
};

/** Reads the façade at CALL time — a plugin module may be evaluated before boot. */
function facade(): I18nFacade | undefined {
    const carrier = globalThis as { GeoLeaf?: { I18n?: I18nFacade } };
    return carrier.GeoLeaf?.I18n;
}

/**
 * Resolves a localized label, or `fallback` (defaulting to `key`) when unresolved.
 *
 * A key is UNRESOLVED when the core is absent, when `I18n` is not mounted yet, or when
 * `getLabel` echoes the key back — which is exactly how the core signals a miss
 * (`i18n.ts`). Passing no `fallback` therefore reproduces the core's own
 * `t()` contract, and passing one reproduces the connector/geocoding contract.
 *
 * @param key Dotted i18n key, e.g. `"ui.table.layer_placeholder"`.
 * @param fallback Returned on a miss. Defaults to `key`.
 */
export function tLabel(key: string, fallback?: string): string {
    const value = facade()?.getLabel?.(key);
    const resolved = typeof value === "string" && value.length > 0 && value !== key;
    return resolved ? value : (fallback ?? key);
}

/**
 * Returns the active language code (`"fr"`, `"en"`, …), or `"fr"` when the core is absent.
 *
 * Reads the core's resolution (`?lang=` → `ui.language` → `"fr"`) rather than re-deriving
 * it: a second implementation of that order would drift the first time one side changes.
 */
export function getActiveLang(): string {
    const lang = facade()?.getActiveLang?.();
    return typeof lang === "string" && lang.length > 0 ? lang : "fr";
}
