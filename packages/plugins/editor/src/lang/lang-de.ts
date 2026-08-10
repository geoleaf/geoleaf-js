/*!
 * @geoleaf-plugins/editor — German dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_de: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Bearbeiten",

    // Sub-menu group labels
    "editor.menu.tools": "Zeichenwerkzeuge",
    "editor.menu.history": "Verlauf",
    "editor.menu.actions": "Aktionen",

    // Tool labels & hints
    "editor.tool.point.label": "Punkt",
    "editor.tool.point.hint": "Klicken Sie auf die Karte, um einen Punkt zu setzen.",
    "editor.tool.line.label": "Linie",
    "editor.tool.line.hint":
        "Klicken Sie, um 2 Punkte zu setzen. Enter oder Doppelklick zum Beenden.",
    "editor.tool.polyline.label": "Linienzug",
    "editor.tool.polyline.hint":
        "Klicken Sie, um Stützpunkte zu setzen. Doppelklick oder Enter zum Beenden.",
    "editor.tool.polygon.label": "Polygon",
    "editor.tool.polygon.hint":
        "Klicken Sie, um Stützpunkte zu setzen. Am ersten Stützpunkt einrasten, Doppelklick oder Enter zum Schließen.",
    "editor.tool.select.label": "Auswahl",
    "editor.tool.select.hint":
        "Klicken Sie auf ein bearbeitbares Objekt, um es auszuwählen und seine Stützpunkte zu bearbeiten.",
    "editor.tool.undo.label": "Rückgängig",
    "editor.tool.undo.hint": "Letzte Aktion rückgängig machen (Strg+Z)",
    "editor.tool.redo.label": "Wiederherstellen",
    "editor.tool.redo.hint": "Letzte rückgängig gemachte Aktion wiederherstellen (Strg+Umschalt+Z)",
    "editor.tool.delete.label": "Löschen",
    "editor.tool.delete.hint": "Ausgewähltes Objekt löschen (Entf)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Rückgängig: {op}",
    "editor.history.redoOf": "Wiederherstellen: {op}",
    "editor.history.op.create": "Erstellung",
    "editor.history.op.move": "Verschiebung",
    "editor.history.op.vertex-add": "Stützpunkt hinzufügen",
    "editor.history.op.vertex-del": "Stützpunkt löschen",
    "editor.history.op.delete": "Löschung",

    // Modal
    "editor.modal.title.create": "Objekt erstellen",
    "editor.modal.title.edit": "Objekt bearbeiten",
    "editor.modal.layer.dropdown": "Zielebene",
    "editor.modal.layer.placeholder": "Ebene auswählen…",
    "editor.modal.layer.noLayer": "(Keine Ebene verfügbar)",
    "editor.modal.btn.save": "Speichern",
    "editor.modal.btn.cancel": "Abbrechen",
    "editor.modal.btn.delete": "Löschen",
    "editor.modal.btn.deleteConfirm": "Endgültig löschen",
    "editor.modal.delete.title": "Löschbestätigung",
    "editor.modal.delete.body":
        "Diese Aktion ist unwiderruflich. Möchten Sie dieses Objekt löschen?",
    "editor.modal.cancel.confirmDirty": "Möchten Sie die Eingabe wirklich verwerfen?",
    "editor.modal.cancel.discardBtn": "Eingabe verwerfen",

    // Form validation
    "editor.form.required": "Dieses Feld ist erforderlich.",
    "editor.form.invalidUrl": "Ungültige URL. Zulässige Protokolle: http, https, mailto, tel.",
    "editor.form.invalidPhone": "Ungültige Telefonnummer.",
    "editor.form.outOfRange": "Der Wert muss zwischen {min} und {max} liegen.",
    "editor.form.maxLengthExceeded": "Maximal {max} Zeichen erlaubt.",

    // Persistence toasts
    "editor.toast.saved": "Objekt gespeichert.",
    "editor.toast.deleted": "Objekt gelöscht.",

    // Sync / offline
    "editor.sync.queued": "Änderung offline in die Warteschlange gestellt.",
    "editor.sync.flushed": "Änderungen erfolgreich synchronisiert.",
    "editor.sync.conflict.title": "Datenkonflikt",
    "editor.sync.conflict.body":
        "Dieses Objekt wurde seit Ihrem letzten Abruf anderweitig geändert. Was möchten Sie behalten?",
    "editor.sync.conflict.btn.keepLocal": "Meine Änderungen behalten",
    "editor.sync.conflict.btn.keepServer": "Serverversion behalten",
    "editor.sync.conflict.btn.merge": "Manuell zusammenführen",
    "editor.sync.conflict.merge.title": "Felder manuell zusammenführen",
    "editor.sync.conflict.merge.useLocal": "Lokal",
    "editor.sync.conflict.merge.useServer": "Server",
    "editor.sync.conflict.merge.apply": "Zusammenführung anwenden",
    "editor.sync.pending": "{n} Änderung(en) warten auf Synchronisierung",
    "editor.sync.kind.save": "Erstellung",
    "editor.sync.kind.update": "Änderung",
    "editor.sync.kind.delete": "Löschung",
    "editor.sync.detail.title": "Ausstehende Vorgänge",
    "editor.sync.detail.empty": "Keine ausstehenden Vorgänge.",
    "editor.sync.detail.retry": "Jetzt erneut versuchen",
    "editor.sync.detail.close": "Schließen",

    // Errors
    "editor.error.networkTimeout": "Netzwerk-Zeitüberschreitung.",
    "editor.error.editionNotPermitted": "Diese Ebene erlaubt diesen Vorgang nicht.",
    "editor.error.server": "Serverfehler. Bitte versuchen Sie es erneut.",
    "editor.error.storageUnavailable":
        "Offline-Speicher nicht verfügbar. Änderung nicht gespeichert.",
    "editor.error.permissionDenied": "Zugriff verweigert.",
    "editor.error.conflict": "Versionskonflikt erkannt.",
    "editor.error.minVertices": "Mindestanzahl an Stützpunkten erreicht.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Bearbeitungsmenü schließen",
    "editor.aria.closeModal": "Formular schließen",
    "editor.aria.dragMenu": "Bearbeitungsmenü verschieben",

    // Form validator errors (keys returned by field-renderer/validators.ts)
    // Field-renderer runtime errors (image upload, hours, dropdown fetch)

    // Field-renderer secondary labels

    // Accessibility
    "editor.placement.prompt": "Tippen Sie auf die Karte, um den Punkt zu setzen",
    "editor.placement.existingDetected": "Vorhandenes Objekt erkannt:",
    "editor.placement.markerNew": "Neuer Punkt (zum Anpassen ziehen)",
    "editor.placement.markerExisting": "Vorhandener Punkt (zum Anpassen ziehen)",
    "editor.toolbar.poi_add": "POI hinzufügen",
    "editor.addform.unavailable": "Der Editor ist nicht bereit — bitte gleich erneut versuchen.",
    "editor.export.session": "Diese Sitzung exportieren",
    "editor.export.empty": "In dieser Sitzung wurde kein Objekt erstellt.",
    "editor.export.done": "{count} Objekt(e) exportiert.",
};

export default lang_de;
