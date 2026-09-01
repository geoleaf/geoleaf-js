/*!
 * @geoleaf-plugins/position-share — English dictionary
 *
 * The plugin's user-visible strings in English: the toolbar button, and the badge that stays on
 * screen while a position is being shared. Its key set must match the French dictionary exactly
 * — a test asserts that, because a missing key resolves to nothing and falls back silently.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateEn = {
    "position-share.toolbar.button": "Share my position",
    "position-share.status.emitting": "Sharing my position",
} satisfies Record<string, string>;

export default langTemplateEn;
