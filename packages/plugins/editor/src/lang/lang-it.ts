/*!
 * @geoleaf-plugins/editor — Italian dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_it: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Modifica",

    // Sub-menu group labels
    "editor.menu.tools": "Strumenti di disegno",
    "editor.menu.history": "Cronologia",
    "editor.menu.actions": "Azioni",

    // Tool labels & hints
    "editor.tool.point.label": "Punto",
    "editor.tool.point.hint": "Fai clic sulla mappa per posizionare un punto.",
    "editor.tool.line.label": "Linea",
    "editor.tool.line.hint": "Fai clic per posizionare 2 punti. Invio o doppio clic per terminare.",
    "editor.tool.polyline.label": "Polilinea",
    "editor.tool.polyline.hint":
        "Fai clic per posizionare i vertici. Doppio clic o Invio per terminare.",
    "editor.tool.polygon.label": "Poligono",
    "editor.tool.polygon.hint":
        "Fai clic per posizionare i vertici. Aggancia al primo vertice, doppio clic o Invio per chiudere.",
    "editor.tool.select.label": "Selezione",
    "editor.tool.select.hint":
        "Fai clic su un'entità modificabile per selezionarla e modificarne i vertici.",
    "editor.tool.undo.label": "Annulla",
    "editor.tool.undo.hint": "Annulla l'ultima azione (Ctrl+Z)",
    "editor.tool.redo.label": "Ripristina",
    "editor.tool.redo.hint": "Ripristina l'ultima azione annullata (Ctrl+Maiusc+Z)",
    "editor.tool.delete.label": "Elimina",
    "editor.tool.delete.hint": "Elimina l'entità selezionata (Canc)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Annulla: {op}",
    "editor.history.redoOf": "Ripristina: {op}",
    "editor.history.op.create": "creazione",
    "editor.history.op.move": "spostamento",
    "editor.history.op.vertex-add": "aggiunta di vertice",
    "editor.history.op.vertex-del": "eliminazione di vertice",
    "editor.history.op.delete": "eliminazione",

    // Modal
    "editor.modal.title.create": "Crea un'entità",
    "editor.modal.title.edit": "Modifica l'entità",
    "editor.modal.layer.dropdown": "Livello di destinazione",
    "editor.modal.layer.placeholder": "Seleziona un livello…",
    "editor.modal.layer.noLayer": "(Nessun livello disponibile)",
    "editor.modal.btn.save": "Salva",
    "editor.modal.btn.cancel": "Annulla",
    "editor.modal.btn.delete": "Elimina",
    "editor.modal.btn.deleteConfirm": "Elimina definitivamente",
    "editor.modal.delete.title": "Conferma di eliminazione",
    "editor.modal.delete.body": "Questa azione è irreversibile. Vuoi eliminare questa entità?",
    "editor.modal.cancel.confirmDirty": "Sei sicuro di voler annullare i dati inseriti?",
    "editor.modal.cancel.discardBtn": "Annulla i dati",

    // Form validation
    "editor.form.required": "Questo campo è obbligatorio.",
    "editor.form.invalidUrl": "URL non valido. Protocolli accettati: http, https, mailto, tel.",
    "editor.form.invalidPhone": "Numero di telefono non valido.",
    "editor.form.outOfRange": "Il valore deve essere compreso tra {min} e {max}.",
    "editor.form.maxLengthExceeded": "Massimo {max} caratteri consentiti.",

    // Persistence toasts
    "editor.toast.saved": "Entità salvata.",
    "editor.toast.deleted": "Entità eliminata.",

    // Sync / offline
    "editor.sync.queued": "Modifica messa in coda offline.",
    "editor.sync.flushed": "Modifiche sincronizzate con successo.",
    "editor.sync.conflict.title": "Conflitto di dati",
    "editor.sync.conflict.body":
        "Questa entità è stata modificata altrove dalla tua ultima lettura. Cosa vuoi conservare?",
    "editor.sync.conflict.btn.keepLocal": "Conserva le mie modifiche",
    "editor.sync.conflict.btn.keepServer": "Conserva la versione del server",
    "editor.sync.conflict.btn.merge": "Unisci manualmente",
    "editor.sync.conflict.merge.title": "Unione manuale dei campi",
    "editor.sync.conflict.merge.useLocal": "Locale",
    "editor.sync.conflict.merge.useServer": "Server",
    "editor.sync.conflict.merge.apply": "Applica l'unione",
    "editor.sync.pending": "{n} modifica/e in attesa di sincronizzazione",
    "editor.sync.kind.save": "Creazione",
    "editor.sync.kind.update": "Modifica",
    "editor.sync.kind.delete": "Eliminazione",
    "editor.sync.detail.title": "Operazioni in attesa",
    "editor.sync.detail.empty": "Nessuna operazione in attesa.",
    "editor.sync.detail.retry": "Riprova ora",
    "editor.sync.detail.close": "Chiudi",

    // Errors
    "editor.error.networkTimeout": "Timeout di rete superato.",
    "editor.error.editionNotPermitted": "Questo livello non consente questa operazione.",
    "editor.error.server": "Errore del server. Riprova.",
    "editor.error.storageUnavailable":
        "Archiviazione offline non disponibile. Modifica non salvata.",
    "editor.error.permissionDenied": "Autorizzazione negata.",
    "editor.error.conflict": "Conflitto di versione rilevato.",
    "editor.error.minVertices": "Numero minimo di vertici raggiunto.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Chiudi il menu di modifica",
    "editor.aria.closeModal": "Chiudi il modulo",
    "editor.aria.dragMenu": "Sposta il menu di modifica",

    // Accessibility
    "editor.placement.prompt": "Tocca la mappa per posizionare il punto",
    "editor.placement.existingDetected": "Entità esistente rilevata:",
    "editor.placement.markerNew": "Nuovo punto (trascina per regolare)",
    "editor.placement.markerExisting": "Punto esistente (trascina per regolare)",
    // 5.1-f — le flux « ajouter un POI », descendu du core avec le bouton qu'il sert.
    "editor.toolbar.poi_add": "Aggiungi POI",
    "editor.addform.unavailable": "L'editor non è pronto — riprova tra un istante.",
    "editor.export.session": "Esporta questa sessione",
    "editor.export.empty": "Nessuna entità creata in questa sessione.",
    "editor.export.done": "{count} entità esportata/e.",
};

export default lang_it;
