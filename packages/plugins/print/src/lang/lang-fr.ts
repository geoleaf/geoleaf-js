/*!
 * @geoleaf-plugins/print — FR dictionary (fallback)
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/** French labels for the print plugin. Serves as the fallback for all missing translations. */
const langPrintFr = {
    "print.toolbar.button": "Imprimer / Exporter",
    "print.emprise.hint": "Cliquez-glissez pour définir la zone d'impression",
    "print.emprise.hint.adjust": "Ajustez les poignées puis cliquez OK",
    "print.modal.title": "Impression / Export",
    "print.modal.field.title": "Titre",
    "print.modal.field.description": "Description",
    "print.modal.check.legend": "Légende",
    "print.modal.check.scale": "Échelle",
    "print.modal.check.northArrow": "Flèche nord",
    "print.modal.check.annotations": "Annotations",
    "print.modal.format": "Format papier",
    "print.modal.scaleLocked": "Échelle verrouillée",
    "print.modal.redefineExtent": "Redéfinir l'emprise",
    "print.btn.pdf": "PDF",
    "print.btn.jpg": "JPG",
    "print.btn.export": "Exporter",
    "print.btn.cancel": "Annuler",
    "print.btn.ok": "OK",
    "print.error.tainted":
        "Impossible d'exporter : une source de tuiles ne supporte pas CORS. Configurez un endpoint serveur ou utilisez des sources CORS-compatibles.",
    "print.error.render": "Erreur lors du rendu de la carte.",
    "print.error.noMap": "Aucune carte disponible.",
    "print.error.serverEndpoint": "L'URL du serveur de rendu est invalide.",
    "print.error.serverFailed": "Le serveur de rendu a renvoyé une erreur.",
    "print.spinner.rendering": "Rendu en cours…",
    "print.orientation.portrait": "Portrait",
    "print.orientation.landscape": "Paysage",
    "print.aria.scaleLocked": "Échelle verrouillée à",
    "print.aria.toolbar.print": "Imprimer / Exporter la carte",
} satisfies Record<string, string>;

export default langPrintFr;
/**
 * Shape of the print translation table, derived from the French one.
 *
 * Same rule as the other plugin dictionaries: typed from the reference table, so a missing
 * key fails at compile time rather than rendering an empty label.
 */
export type PrintLangDict = typeof langPrintFr;
