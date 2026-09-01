/*!
 * @geoleaf/field-renderer — built-in labels (fr)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The library's `form.*` labels, in fr.
 *
 * ⚠️ **Derived from `editor`'s catalogues, not rewritten** — these
 * translations were already in production and at parity across the six
 * locales. Rewriting them would have introduced silent variants where the
 * work aims for the opposite.
 */
const lang_fr: Record<string, string> = {
    "form.aria.badgeColor": "Couleur du badge",
    "form.aria.coordsCapture": "Capturer la position depuis la carte",
    "form.aria.coordsCaptureUnavailable": "Capturer la position depuis la carte (indisponible)",
    "form.aria.coordsCopy": "Copier les coordonnées",
    "form.aria.imageRemove": "Supprimer l'image",
    "form.aria.latitude": "Latitude",
    "form.aria.listRemove": "Supprimer l'élément",
    "form.aria.longitude": "Longitude",
    "form.aria.reviewRemove": "Supprimer l'avis",
    "form.aria.tableRowRemove": "Supprimer la ligne",
    "form.error.date": "Date invalide (format AAAA-MM-JJ attendu).",
    "form.error.email": "Adresse e-mail invalide.",
    "form.error.fetchFailed": "Échec du chargement des options.",
    "form.error.imageCanvas": "Compression indisponible sur cet appareil",
    "form.error.imageCompress": "La compression de l'image a échoué",
    "form.error.imageDecode": "Image illisible ou corrompue",
    "form.error.imageRead": "Lecture du fichier impossible",
    "form.error.imageSize": "Image trop volumineuse.",
    "form.error.imageType": "Type de fichier image non accepté.",
    "form.error.max": "Valeur trop élevée.",
    "form.error.maxLength": "Texte trop long.",
    "form.error.min": "Valeur trop faible.",
    "form.error.minItems": "Nombre d'éléments insuffisant.",
    "form.error.minLength": "Texte trop court.",
    "form.error.pattern": "Format invalide.",
    "form.error.phoneE164": "Numéro de téléphone invalide.",
    "form.error.required": "Ce champ est obligatoire.",
    "form.error.tel": "Numéro de téléphone invalide.",
    "form.error.timeFormat": "Format d'heure invalide (HH:MM attendu).",
    "form.error.uploadFailed": "Échec de l'envoi de l'image.",
    "form.error.url": "URL invalide. Protocoles acceptés : http, https, mailto, tel.",
    "form.label.add": "Ajouter",
    "form.label.cancel": "Annuler",
    "form.label.capture": "Capturer",
    "form.label.imageDropzone": "Cliquez ou glissez une image ici",
    "form.label.linkLabel": "Libellé (optionnel)",
    "form.label.reviewAdd": "Ajouter un avis",
    "form.label.tableAddRow": "Ajouter une ligne",
    "form.placeholder.lat": "Lat",
    "form.placeholder.lng": "Lon",
    "form.placeholder.reviewAuthor": "Auteur",
    "form.placeholder.reviewComment": "Commentaire",
    "form.title.captureUnavailable":
        "La capture depuis la carte n'est pas disponible dans ce contexte",
};

export default lang_fr;
