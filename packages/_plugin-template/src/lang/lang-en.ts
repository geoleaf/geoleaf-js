/*!
 * __PLUGIN_PKG__ — English dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateEn = {
    "__PLUGIN_NAME__.toolbar.button": "__PLUGIN_NAME__",
} satisfies Record<string, string>;

export default langTemplateEn;
