/*!
 * @geoleaf-plugins/print — ES dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langPrintEs = {
    "print.toolbar.button": "Imprimir / Exportar",
    "print.emprise.hint": "Haz clic y arrastra para definir el área de impresión",
    "print.emprise.hint.adjust": "Ajusta los tiradores y haz clic en Aceptar",
    "print.modal.title": "Impresión / Exportación",
    "print.modal.field.title": "Título",
    "print.modal.field.description": "Descripción",
    "print.modal.check.legend": "Leyenda",
    "print.modal.check.scale": "Barra de escala",
    "print.modal.check.northArrow": "Flecha norte",
    "print.modal.check.annotations": "Anotaciones",
    "print.modal.format": "Formato de papel",
    "print.modal.scaleLocked": "Escala bloqueada",
    "print.modal.redefineExtent": "Redefinir extensión",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Exportar",
    "print.btn.cancel": "Cancelar",
    "print.btn.ok": "Aceptar",
    "print.error.tainted":
        "No se puede exportar: una fuente de teselas no admite CORS. Configure un endpoint de servidor o utilice fuentes compatibles con CORS.",
    "print.error.render": "Error al renderizar el mapa.",
    "print.error.noMap": "No hay mapa disponible.",
    "print.error.serverEndpoint": "La URL del servidor de renderizado no es válida.",
    "print.error.serverFailed": "El servidor de renderizado devolvió un error.",
    "print.spinner.rendering": "Renderizando…",
    "print.orientation.portrait": "Vertical",
    "print.orientation.landscape": "Horizontal",
    "print.aria.scaleLocked": "Escala bloqueada en",
    "print.aria.toolbar.print": "Imprimir / Exportar el mapa",
} satisfies Record<string, string>;

export default langPrintEs;
