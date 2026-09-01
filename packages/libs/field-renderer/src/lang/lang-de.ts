/*!
 * @geoleaf/field-renderer — built-in labels (de)
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The library's `form.*` labels, in de.
 *
 * ⚠️ **Derived from `editor`'s catalogues, not rewritten** — these
 * translations were already in production and at parity across the six
 * locales. Rewriting them would have introduced silent variants where the
 * work aims for the opposite.
 */
const lang_de: Record<string, string> = {
    "form.aria.badgeColor": "Badge-Farbe",
    "form.aria.coordsCapture": "Position von der Karte erfassen",
    "form.aria.coordsCaptureUnavailable": "Position von der Karte erfassen (nicht verfügbar)",
    "form.aria.coordsCopy": "Koordinaten kopieren",
    "form.aria.imageRemove": "Bild entfernen",
    "form.aria.latitude": "Breitengrad",
    "form.aria.listRemove": "Element entfernen",
    "form.aria.longitude": "Längengrad",
    "form.aria.reviewRemove": "Bewertung entfernen",
    "form.aria.tableRowRemove": "Zeile entfernen",
    "form.error.date": "Ungültiges Datum (Format JJJJ-MM-TT erwartet).",
    "form.error.email": "Ungültige E-Mail-Adresse.",
    "form.error.fetchFailed": "Optionen konnten nicht geladen werden.",
    "form.error.imageCanvas": "Komprimierung auf diesem Gerät nicht verfügbar",
    "form.error.imageCompress": "Bildkomprimierung fehlgeschlagen",
    "form.error.imageDecode": "Unlesbares oder beschädigtes Bild",
    "form.error.imageRead": "Datei konnte nicht gelesen werden",
    "form.error.imageSize": "Bilddatei ist zu groß.",
    "form.error.imageType": "Nicht unterstützter Bilddateityp.",
    "form.error.max": "Wert zu hoch.",
    "form.error.maxLength": "Text zu lang.",
    "form.error.min": "Wert zu niedrig.",
    "form.error.minItems": "Zu wenige Elemente.",
    "form.error.minLength": "Text zu kurz.",
    "form.error.pattern": "Ungültiges Format.",
    "form.error.phoneE164": "Ungültige Telefonnummer.",
    "form.error.required": "Dieses Feld ist erforderlich.",
    "form.error.tel": "Ungültige Telefonnummer.",
    "form.error.timeFormat": "Ungültiges Zeitformat (HH:MM erwartet).",
    "form.error.uploadFailed": "Bild-Upload fehlgeschlagen.",
    "form.error.url": "Ungültige URL. Zulässige Protokolle: http, https, mailto, tel.",
    "form.label.add": "Hinzufügen",
    "form.label.cancel": "Abbrechen",
    "form.label.capture": "Erfassen",
    "form.label.imageDropzone": "Klicken oder ziehen Sie ein Bild hierher",
    "form.label.linkLabel": "Bezeichnung (optional)",
    "form.label.reviewAdd": "Bewertung hinzufügen",
    "form.label.tableAddRow": "Zeile hinzufügen",
    "form.placeholder.lat": "Breite",
    "form.placeholder.lng": "Länge",
    "form.placeholder.reviewAuthor": "Autor",
    "form.placeholder.reviewComment": "Kommentar",
    "form.title.captureUnavailable": "Kartenerfassung ist in diesem Kontext nicht verfügbar",
};

export default lang_de;
