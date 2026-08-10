/*!
 * @geoleaf-plugins/table — Spanish dictionary
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
const lang_es: Record<string, string> = {
    "table.toolbar.button": "Tabla",
    "ui.table.layer_placeholder": "Seleccionar una capa...",
    "ui.table.zoomToSelection": "Zoom a la selección",
    "ui.table.highlight": "Resaltar",
    "ui.table.exportSelection": "Exportar",
    "ui.table.exportLayer": "Capa",
    "aria.table.hide": "Ocultar la tabla",
    "aria.table.show": "Mostrar la tabla",
    "aria.table.layerSelect": "Capa que mostrar en la tabla",
};

export default lang_es;
