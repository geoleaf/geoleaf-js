/*!
 * @geoleaf-plugins/table — French dictionary
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
const lang_fr: Record<string, string> = {
    "table.toolbar.button": "Tableau",
    "ui.table.layer_placeholder": "Sélectionner une couche...",
    "ui.table.zoomToSelection": "Zoom sur la sélection",
    "ui.table.highlight": "Surbrillance",
    "ui.table.exportSelection": "Exporter",
    "ui.table.exportLayer": "Couche",
    "aria.table.hide": "Masquer le tableau",
    "aria.table.show": "Afficher le tableau",
    "aria.table.layerSelect": "Couche à afficher dans le tableau",
};

export default lang_fr;
