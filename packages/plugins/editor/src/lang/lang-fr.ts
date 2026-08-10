/*!
 * @geoleaf-plugins/editor — French dictionary (fallback)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const lang_fr: Record<string, string> = {
    // Toolbar
    "editor.toolbar.button": "Édition",

    // Sub-menu group labels
    "editor.menu.tools": "Outils de dessin",
    "editor.menu.history": "Historique",
    "editor.menu.actions": "Actions",

    // Tool labels & hints
    "editor.tool.point.label": "Point",
    "editor.tool.point.hint": "Cliquez sur la carte pour placer un point.",
    "editor.tool.line.label": "Ligne",
    "editor.tool.line.hint": "Cliquez pour poser 2 points. Entrée ou double-clic pour terminer.",
    "editor.tool.polyline.label": "Polyligne",
    "editor.tool.polyline.hint":
        "Cliquez pour poser des sommets. Double-clic ou Entrée pour terminer.",
    "editor.tool.polygon.label": "Polygone",
    "editor.tool.polygon.hint":
        "Cliquez pour poser des sommets. Raccrochez au 1er sommet, double-clic ou Entrée pour clore.",
    "editor.tool.select.label": "Sélection",
    "editor.tool.select.hint":
        "Cliquez sur une entité éditable pour la sélectionner et éditer ses sommets.",
    "editor.tool.undo.label": "Annuler",
    "editor.tool.undo.hint": "Annuler la dernière action (Ctrl+Z)",
    "editor.tool.redo.label": "Rétablir",
    "editor.tool.redo.hint": "Rétablir la dernière action annulée (Ctrl+Maj+Z)",
    "editor.tool.delete.label": "Supprimer",
    "editor.tool.delete.hint": "Supprimer l'entité sélectionnée (Suppr)",

    // History — dynamic undo/redo tooltips ({op} = operation label below)
    "editor.history.undoOf": "Annuler : {op}",
    "editor.history.redoOf": "Rétablir : {op}",
    "editor.history.op.create": "création",
    "editor.history.op.move": "déplacement",
    "editor.history.op.vertex-add": "ajout de sommet",
    "editor.history.op.vertex-del": "suppression de sommet",
    "editor.history.op.delete": "suppression",

    // Modal
    "editor.modal.title.create": "Créer une entité",
    "editor.modal.title.edit": "Modifier l'entité",
    "editor.modal.layer.dropdown": "Couche cible",
    "editor.modal.layer.placeholder": "Sélectionner une couche…",
    "editor.modal.layer.noLayer": "(Aucune couche disponible)",
    "editor.modal.btn.save": "Enregistrer",
    "editor.modal.btn.cancel": "Annuler",
    // 5.2 — LUE PAR LA LIB PARTAGÉE, et elle manquait ici : `responsive-modal.ts` la pose
    // sur le bouton de suppression qu'`editor` arme lui-même, et seul `addpoi` la déclarait.
    // Dans `deploy-full` (editor sans addpoi) le bouton affichait donc la CLÉ BRUTE. Le
    // défaut était vivant avant la fusion ; le retrait d'`addpoi` l'aurait rendu universel.
    "editor.modal.btn.delete": "Supprimer",
    "editor.modal.btn.deleteConfirm": "Supprimer définitivement",
    "editor.modal.delete.title": "Confirmation de suppression",
    "editor.modal.delete.body":
        "Cette action est irréversible. Souhaitez-vous supprimer cette entité ?",
    "editor.modal.cancel.confirmDirty": "Êtes-vous sûr de vouloir supprimer la saisie ?",
    "editor.modal.cancel.discardBtn": "Supprimer la saisie",

    // Form validation
    "editor.form.required": "Ce champ est obligatoire.",
    "editor.form.invalidUrl": "URL invalide. Protocoles acceptés : http, https, mailto, tel.",
    "editor.form.invalidPhone": "Numéro de téléphone invalide.",
    "editor.form.outOfRange": "La valeur doit être comprise entre {min} et {max}.",
    "editor.form.maxLengthExceeded": "Maximum {max} caractères autorisés.",

    // Persistence toasts
    "editor.toast.saved": "Entité enregistrée.",
    "editor.toast.deleted": "Entité supprimée.",

    // Sync / offline
    "editor.sync.queued": "Modification mise en file d'attente hors ligne.",
    "editor.sync.flushed": "Modifications synchronisées avec succès.",
    "editor.sync.conflict.title": "Conflit de données",
    "editor.sync.conflict.body":
        "Cette entité a été modifiée ailleurs depuis votre dernière lecture. Que souhaitez-vous conserver ?",
    "editor.sync.conflict.btn.keepLocal": "Conserver mes modifications",
    "editor.sync.conflict.btn.keepServer": "Conserver la version serveur",
    "editor.sync.conflict.btn.merge": "Fusionner manuellement",
    "editor.sync.conflict.merge.title": "Fusion manuelle des champs",
    "editor.sync.conflict.merge.useLocal": "Local",
    "editor.sync.conflict.merge.useServer": "Serveur",
    "editor.sync.conflict.merge.apply": "Appliquer la fusion",
    "editor.sync.pending": "{n} modification(s) en attente de synchronisation",
    "editor.sync.kind.save": "Création",
    "editor.sync.kind.update": "Modification",
    "editor.sync.kind.delete": "Suppression",
    "editor.sync.detail.title": "Opérations en attente",
    "editor.sync.detail.empty": "Aucune opération en attente.",
    "editor.sync.detail.retry": "Réessayer maintenant",
    "editor.sync.detail.close": "Fermer",

    // Errors
    "editor.error.networkTimeout": "Délai d'attente réseau dépassé.",
    "editor.error.editionNotPermitted": "Cette couche n'autorise pas cette opération.",
    "editor.error.server": "Erreur serveur. Veuillez réessayer.",
    "editor.error.storageUnavailable":
        "Stockage hors ligne indisponible. Modification non enregistrée.",
    "editor.error.permissionDenied": "Permission refusée.",
    "editor.error.conflict": "Conflit de version détecté.",
    "editor.error.minVertices": "Nombre minimum de sommets atteint.",

    // Aria / accessibility
    "editor.aria.closeMenu": "Fermer le menu d'édition",
    "editor.aria.closeModal": "Fermer le formulaire",
    "editor.aria.dragMenu": "Déplacer le menu d'édition",

    // Form validator errors (keys returned by field-renderer/validators.ts)
    // Field-renderer runtime errors (image upload, hours, dropdown fetch)

    // Field-renderer secondary labels

    // Accessibility
    "editor.placement.prompt": "Touchez la carte pour placer le point",
    "editor.placement.existingDetected": "Entité existante détectée :",
    "editor.placement.markerNew": "Nouveau point (glissez pour ajuster)",
    "editor.placement.markerExisting": "Point existant (glissez pour ajuster)",
    // 5.1-f — le flux « ajouter un POI », descendu du core avec le bouton qu'il sert.
    "editor.toolbar.poi_add": "Ajouter un POI",
    "editor.addform.unavailable": "L'éditeur n'est pas prêt — réessayez dans un instant.",
    "editor.export.session": "Exporter cette session",
    "editor.export.empty": "Aucune entité créée dans cette session.",
    "editor.export.done": "{count} entité(s) exportée(s).",
};

export default lang_fr;
