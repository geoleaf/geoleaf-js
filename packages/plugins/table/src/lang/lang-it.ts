/*!
 * @geoleaf-plugins/table — Italian dictionary
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
const lang_it: Record<string, string> = {
    "table.toolbar.button": "Tabella",
    "ui.table.layer_placeholder": "Seleziona un livello...",
    "ui.table.zoomToSelection": "Zoom sulla selezione",
    "ui.table.highlight": "Evidenzia",
    "ui.table.exportSelection": "Esporta",
    "ui.table.exportLayer": "Livello",
    "aria.table.hide": "Nascondi la tabella",
    "aria.table.show": "Mostra la tabella",
    "aria.table.layerSelect": "Livello da visualizzare nella tabella",
};

export default lang_it;
