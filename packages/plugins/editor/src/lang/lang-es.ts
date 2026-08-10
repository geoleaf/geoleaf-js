/*!
 * @geoleaf-plugins/editor — Spanish dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_es: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Edición",

    // Sub-menu group labels
    "editor.menu.tools": "Herramientas de dibujo",
    "editor.menu.history": "Historial",
    "editor.menu.actions": "Acciones",

    // Tool labels & hints
    "editor.tool.point.label": "Punto",
    "editor.tool.point.hint": "Haz clic en el mapa para colocar un punto.",
    "editor.tool.line.label": "Línea",
    "editor.tool.line.hint": "Haz clic para colocar 2 puntos. Intro o doble clic para terminar.",
    "editor.tool.polyline.label": "Polilínea",
    "editor.tool.polyline.hint":
        "Haz clic para colocar vértices. Doble clic o Intro para terminar.",
    "editor.tool.polygon.label": "Polígono",
    "editor.tool.polygon.hint":
        "Haz clic para colocar vértices. Engancha al primer vértice, doble clic o Intro para cerrar.",
    "editor.tool.select.label": "Selección",
    "editor.tool.select.hint":
        "Haz clic en una entidad editable para seleccionarla y editar sus vértices.",
    "editor.tool.undo.label": "Deshacer",
    "editor.tool.undo.hint": "Deshacer la última acción (Ctrl+Z)",
    "editor.tool.redo.label": "Rehacer",
    "editor.tool.redo.hint": "Rehacer la última acción deshecha (Ctrl+Mayús+Z)",
    "editor.tool.delete.label": "Eliminar",
    "editor.tool.delete.hint": "Eliminar la entidad seleccionada (Supr)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Deshacer: {op}",
    "editor.history.redoOf": "Rehacer: {op}",
    "editor.history.op.create": "creación",
    "editor.history.op.move": "desplazamiento",
    "editor.history.op.vertex-add": "adición de vértice",
    "editor.history.op.vertex-del": "eliminación de vértice",
    "editor.history.op.delete": "eliminación",

    // Modal
    "editor.modal.title.create": "Crear una entidad",
    "editor.modal.title.edit": "Editar la entidad",
    "editor.modal.layer.dropdown": "Capa de destino",
    "editor.modal.layer.placeholder": "Seleccionar una capa…",
    "editor.modal.layer.noLayer": "(Ninguna capa disponible)",
    "editor.modal.btn.save": "Guardar",
    "editor.modal.btn.cancel": "Cancelar",
    "editor.modal.btn.delete": "Eliminar",
    "editor.modal.btn.deleteConfirm": "Eliminar definitivamente",
    "editor.modal.delete.title": "Confirmación de eliminación",
    "editor.modal.delete.body": "Esta acción es irreversible. ¿Deseas eliminar esta entidad?",
    "editor.modal.cancel.confirmDirty": "¿Seguro que quieres descartar lo introducido?",
    "editor.modal.cancel.discardBtn": "Descartar",

    // Form validation
    "editor.form.required": "Este campo es obligatorio.",
    "editor.form.invalidUrl": "URL no válida. Protocolos aceptados: http, https, mailto, tel.",
    "editor.form.invalidPhone": "Número de teléfono no válido.",
    "editor.form.outOfRange": "El valor debe estar comprendido entre {min} y {max}.",
    "editor.form.maxLengthExceeded": "Máximo de {max} caracteres permitidos.",

    // Persistence toasts
    "editor.toast.saved": "Entidad guardada.",
    "editor.toast.deleted": "Entidad eliminada.",

    // Sync / offline
    "editor.sync.queued": "Cambio puesto en cola sin conexión.",
    "editor.sync.flushed": "Cambios sincronizados correctamente.",
    "editor.sync.conflict.title": "Conflicto de datos",
    "editor.sync.conflict.body":
        "Esta entidad se ha modificado en otro lugar desde tu última lectura. ¿Qué deseas conservar?",
    "editor.sync.conflict.btn.keepLocal": "Conservar mis cambios",
    "editor.sync.conflict.btn.keepServer": "Conservar la versión del servidor",
    "editor.sync.conflict.btn.merge": "Combinar manualmente",
    "editor.sync.conflict.merge.title": "Combinación manual de campos",
    "editor.sync.conflict.merge.useLocal": "Local",
    "editor.sync.conflict.merge.useServer": "Servidor",
    "editor.sync.conflict.merge.apply": "Aplicar la combinación",
    "editor.sync.pending": "{n} cambio(s) pendiente(s) de sincronización",
    "editor.sync.kind.save": "Creación",
    "editor.sync.kind.update": "Modificación",
    "editor.sync.kind.delete": "Eliminación",
    "editor.sync.detail.title": "Operaciones pendientes",
    "editor.sync.detail.empty": "Ninguna operación pendiente.",
    "editor.sync.detail.retry": "Reintentar ahora",
    "editor.sync.detail.close": "Cerrar",

    // Errors
    "editor.error.networkTimeout": "Se ha superado el tiempo de espera de la red.",
    "editor.error.editionNotPermitted": "Esta capa no permite esta operación.",
    "editor.error.server": "Error del servidor. Vuelve a intentarlo.",
    "editor.error.storageUnavailable":
        "Almacenamiento sin conexión no disponible. Cambio no guardado.",
    "editor.error.permissionDenied": "Permiso denegado.",
    "editor.error.conflict": "Conflicto de versión detectado.",
    "editor.error.minVertices": "Número mínimo de vértices alcanzado.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Cerrar el menú de edición",
    "editor.aria.closeModal": "Cerrar el formulario",
    "editor.aria.dragMenu": "Mover el menú de edición",

    // Form validator errors (keys returned by field-renderer/validators.ts)
    // Field-renderer runtime errors (image upload, hours, dropdown fetch)

    // Field-renderer secondary labels

    // Accessibility
    "editor.placement.prompt": "Toque el mapa para colocar el punto",
    "editor.placement.existingDetected": "Entidad existente detectada:",
    "editor.placement.markerNew": "Punto nuevo (arrastre para ajustar)",
    "editor.placement.markerExisting": "Punto existente (arrastre para ajustar)",
    "editor.toolbar.poi_add": "Añadir POI",
    "editor.addform.unavailable": "El editor no está listo: inténtelo de nuevo en un momento.",
    "editor.export.session": "Exportar esta sesión",
    "editor.export.empty": "Ninguna entidad creada en esta sesión.",
    "editor.export.done": "{count} entidad(es) exportada(s).",
};

export default lang_es;
