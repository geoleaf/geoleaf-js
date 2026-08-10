/*!
 * @geoleaf-plugins/editor — English dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_en: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Edit",

    // Sub-menu group labels
    "editor.menu.tools": "Drawing tools",
    "editor.menu.history": "History",
    "editor.menu.actions": "Actions",

    // Tool labels & hints
    "editor.tool.point.label": "Point",
    "editor.tool.point.hint": "Click on the map to place a point.",
    "editor.tool.line.label": "Line",
    "editor.tool.line.hint": "Click to set 2 points. Press Enter or double-click to finish.",
    "editor.tool.polyline.label": "Polyline",
    "editor.tool.polyline.hint": "Click to add vertices. Double-click or Enter to finish.",
    "editor.tool.polygon.label": "Polygon",
    "editor.tool.polygon.hint":
        "Click to add vertices. Snap to first vertex, double-click or Enter to close.",
    "editor.tool.select.label": "Select",
    "editor.tool.select.hint": "Click an editable feature to select it and edit its vertices.",
    "editor.tool.undo.label": "Undo",
    "editor.tool.undo.hint": "Undo last action (Ctrl+Z)",
    "editor.tool.redo.label": "Redo",
    "editor.tool.redo.hint": "Redo last undone action (Ctrl+Shift+Z)",
    "editor.tool.delete.label": "Delete",
    "editor.tool.delete.hint": "Delete selected feature (Del)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Undo: {op}",
    "editor.history.redoOf": "Redo: {op}",
    "editor.history.op.create": "create",
    "editor.history.op.move": "move",
    "editor.history.op.vertex-add": "add vertex",
    "editor.history.op.vertex-del": "delete vertex",
    "editor.history.op.delete": "delete",

    // Modal
    "editor.modal.title.create": "Create feature",
    "editor.modal.title.edit": "Edit feature",
    "editor.modal.layer.dropdown": "Target layer",
    "editor.modal.layer.placeholder": "Select a layer…",
    "editor.modal.layer.noLayer": "(No editable layer)",
    "editor.modal.btn.save": "Save",
    "editor.modal.btn.cancel": "Cancel",
    // 5.2 — read by the shared lib (`responsive-modal.ts`) on the delete button that
    // `editor` itself arms, yet only `addpoi` declared it. See lang-fr.ts for the full note.
    "editor.modal.btn.delete": "Delete",
    "editor.modal.btn.deleteConfirm": "Delete permanently",
    "editor.modal.delete.title": "Confirm deletion",
    "editor.modal.delete.body": "This action cannot be undone. Delete this feature?",
    "editor.modal.cancel.confirmDirty": "Are you sure you want to discard your input?",
    "editor.modal.cancel.discardBtn": "Discard input",

    // Form validation
    "editor.form.required": "This field is required.",
    "editor.form.invalidUrl": "Invalid URL. Accepted protocols: http, https, mailto, tel.",
    "editor.form.invalidPhone": "Invalid phone number.",
    "editor.form.outOfRange": "Value must be between {min} and {max}.",
    "editor.form.maxLengthExceeded": "Maximum {max} characters allowed.",

    // Persistence toasts
    "editor.toast.saved": "Feature saved.",
    "editor.toast.deleted": "Feature deleted.",

    // Sync / offline
    "editor.sync.queued": "Change queued for offline sync.",
    "editor.sync.flushed": "Changes synced successfully.",
    "editor.sync.conflict.title": "Data conflict",
    "editor.sync.conflict.body":
        "This feature was changed elsewhere since you loaded it. Which version do you want to keep?",
    "editor.sync.conflict.btn.keepLocal": "Keep my changes",
    "editor.sync.conflict.btn.keepServer": "Keep server version",
    "editor.sync.conflict.btn.merge": "Merge manually",
    "editor.sync.conflict.merge.title": "Merge fields manually",
    "editor.sync.conflict.merge.useLocal": "Local",
    "editor.sync.conflict.merge.useServer": "Server",
    "editor.sync.conflict.merge.apply": "Apply merge",
    "editor.sync.pending": "{n} change(s) waiting to sync",
    "editor.sync.kind.save": "Create",
    "editor.sync.kind.update": "Update",
    "editor.sync.kind.delete": "Delete",
    "editor.sync.detail.title": "Pending operations",
    "editor.sync.detail.empty": "No pending operations.",
    "editor.sync.detail.retry": "Retry now",
    "editor.sync.detail.close": "Close",

    // Errors
    "editor.error.networkTimeout": "Network request timed out.",
    "editor.error.editionNotPermitted": "This layer does not allow this operation.",
    "editor.error.server": "Server error. Please try again.",
    "editor.error.storageUnavailable": "Offline storage unavailable. Change not saved.",
    "editor.error.permissionDenied": "Permission denied.",
    "editor.error.conflict": "Version conflict detected.",
    "editor.error.minVertices": "Minimum vertex count reached.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Close edit menu",
    "editor.aria.closeModal": "Close form",
    "editor.aria.dragMenu": "Drag edit menu",

    // Form validator errors (keys returned by field-renderer/validators.ts)
    // Field-renderer runtime errors (image upload, hours, dropdown fetch)

    // Field-renderer secondary labels

    // Accessibility
    "editor.placement.prompt": "Tap the map to place the point",
    "editor.placement.existingDetected": "Existing feature detected:",
    "editor.placement.markerNew": "New point (drag to adjust)",
    "editor.placement.markerExisting": "Existing point (drag to adjust)",
    // 5.1-f — the "add a POI" flow, moved down from the core with the button it serves.
    "editor.toolbar.poi_add": "Add POI",
    "editor.addform.unavailable": "The editor is not ready — try again in a moment.",
    "editor.export.session": "Export this session",
    "editor.export.empty": "No feature created in this session.",
    "editor.export.done": "{count} feature(s) exported.",
};

export default lang_en;
