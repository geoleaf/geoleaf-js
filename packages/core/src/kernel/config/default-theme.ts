/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The theme a profile starts on — one resolver for every reader.
 *
 * Three readers answered « which theme does this profile start on? », and not alike. The GeoJSON
 * loader (`kernel/geojson/loader/profile.ts`) and the boot reveal (`app/init-reveal.ts`) read the
 * legacy `config.defautTheme` then `defaultTheme`, and answered « none » without either. The
 * theme loader (`kernel/themes/theme-loader.ts`) read `defaultTheme` alone and fell back to the
 * first theme — and `theme-engine` applies what the theme loader says. On a profile declaring
 * themes without a default, the GeoJSON loader therefore loaded EVERY layer in the background
 * while `theme-engine` applied `themes[0]`: measured on the tourism profile, 19 to 21 layers
 * visible for a 7-layer theme, a different count from one load to the next, and a reveal ten
 * times slower than with that same theme declared.
 *
 * The rule is the theme loader's, with the legacy key the other two honoured: the declared
 * default when it names a theme of the list — the canonical `defaultTheme` first, the historical
 * `config.defautTheme` typo second —, otherwise the first theme that has an id, otherwise `null`:
 * the profile declares no theme.
 *
 * Imports nothing, on purpose: `kernel/geojson` and `kernel/themes` both read it, and the second
 * already imports the first — a resolver living in either would close a cycle.
 */

/** A string that can name a theme. */
function _isId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/** Reads `key` off `value` when it is an object; `undefined` otherwise. */
function _field(value: unknown, key: string): unknown {
    return value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
}

/**
 * Resolves the id of the theme a profile starts on.
 *
 * @param themes - A profile's `themes` block, as the profile or a `themes.json` carries it:
 *   `{ defaultTheme?, config?: { defautTheme? }, themes?: [{ id, … }] }`. Anything else counts as
 *   a profile without themes.
 * @returns The declared default when it names a theme of the list (`defaultTheme`, then the
 *   legacy `config.defautTheme`); otherwise the first theme that has an id; `null` when the list
 *   holds no theme with an id.
 *
 * @example
 * ```ts
 * resolveDefaultThemeId({ themes: [{ id: "day" }, { id: "night" }] }); // "day"
 * resolveDefaultThemeId({ defaultTheme: "night", themes: [{ id: "day" }, { id: "night" }] }); // "night"
 * resolveDefaultThemeId({}); // null
 * ```
 */
export function resolveDefaultThemeId(themes: unknown): string | null {
    const list = _field(themes, "themes");
    if (!Array.isArray(list)) return null;
    const ids = list.map((theme) => _field(theme, "id")).filter(_isId);
    if (ids.length === 0) return null;

    const declared = [
        _field(themes, "defaultTheme"),
        _field(_field(themes, "config"), "defautTheme"),
    ];
    const named = declared.find((id): id is string => _isId(id) && ids.includes(id));
    return named ?? ids[0] ?? null;
}
