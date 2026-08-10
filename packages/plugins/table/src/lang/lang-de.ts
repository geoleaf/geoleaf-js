/*!
 * @geoleaf-plugins/table — German dictionary
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
const lang_de: Record<string, string> = {
    "table.toolbar.button": "Tabelle",
    "ui.table.layer_placeholder": "Ebene auswählen...",
    "ui.table.zoomToSelection": "Auf Auswahl zoomen",
    "ui.table.highlight": "Hervorheben",
    "ui.table.exportSelection": "Exportieren",
    "ui.table.exportLayer": "Ebene",
    "aria.table.hide": "Tabelle ausblenden",
    "aria.table.show": "Tabelle einblenden",
    "aria.table.layerSelect": "Anzuzeigende Ebene",
};

export default lang_de;
