/*!
 * @geoleaf-plugins/table — English dictionary
 * © 2026 Mattieu Pottier — MIT License
 *
 * Flat key → label map (the core i18n table is flat; the namespace passed to
 * `registerDict` is only a dedup bucket, not a key prefix).
 *
 * `placeholder.search.input` is intentionally absent: the core defines it in all
 * six locales and core keys win over plugin keys in `getLabel`'s cascade
 * (`_active[key] ?? _pluginActive[key]`), so a copy here would never be read.
 * https://geoleaf.dev
 */
const lang_en: Record<string, string> = {
    "table.toolbar.button": "Table",
    "ui.table.layer_placeholder": "Select a layer...",
    "ui.table.zoomToSelection": "Zoom to selection",
    "ui.table.highlight": "Highlight",
    "ui.table.exportSelection": "Export",
    "ui.table.exportLayer": "Layer",
    "aria.table.hide": "Hide table",
    "aria.table.show": "Show table",
    "aria.table.layerSelect": "Layer to display in the table",
};

export default lang_en;
