/*!
 * @geoleaf-plugins/position-share — French dictionary
 *
 * The plugin's user-visible strings in French: the toolbar button, and the badge that stays on
 * screen while a position is being shared. Registered at entry time so labels resolve during
 * boot, before anything reads them.
 *
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

// Keys MUST be flat and dotted ("<plugin>.toolbar.button"). `GeoLeaf.I18n.getLabel`
// indexes the merged table directly and never splits on "." — a nested dictionary
// resolves to nothing and silently falls back to French (audit C-5).
// `satisfies Record<string, string>` makes that a compile error rather than a
// runtime surprise; keep it.
const langTemplateFr = {
    "position-share.toolbar.button": "Partager ma position",
    "position-share.status.emitting": "Partage de ma position en cours",
} satisfies Record<string, string>;

export default langTemplateFr;
