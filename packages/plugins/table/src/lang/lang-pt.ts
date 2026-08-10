/*!
 * @geoleaf-plugins/table — Portuguese dictionary
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
const lang_pt: Record<string, string> = {
    "table.toolbar.button": "Tabela",
    "ui.table.layer_placeholder": "Selecionar uma camada...",
    "ui.table.zoomToSelection": "Zoom para a seleção",
    "ui.table.highlight": "Realçar",
    "ui.table.exportSelection": "Exportar",
    "ui.table.exportLayer": "Camada",
    "aria.table.hide": "Ocultar a tabela",
    "aria.table.show": "Mostrar a tabela",
    "aria.table.layerSelect": "Camada a exibir na tabela",
};

export default lang_pt;
