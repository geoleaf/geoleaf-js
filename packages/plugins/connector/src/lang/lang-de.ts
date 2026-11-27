/*!
 * @geoleaf-plugins/connector — German dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langConnectorDe = {
    "connector.modal.title": "Anmelden",
    "connector.modal.close": "Schließen",
    "connector.modal.loginLabel": "Benutzername",
    "connector.modal.passwordLabel": "Passwort",
    "connector.modal.submit": "Anmelden",
    "connector.modal.submitting": "Verbinden…",
    "connector.modal.signup": "Konto erstellen",
    "connector.modal.forgot": "Passwort vergessen",
    "connector.error.emptyFields": "Bitte füllen Sie alle Felder aus.",
    "connector.error.noEndpoint": "Ungültige Konfiguration: Endpunkt fehlt.",
    "connector.error.invalidCredentials": "Benutzername oder Passwort falsch.",
    "connector.error.networkUnavailable": "Server nicht erreichbar. Prüfen Sie Ihre Verbindung.",
    "connector.error.invalidResponse":
        "Der Server hat ohne Sitzungstoken geantwortet. Wenden Sie sich an den Administrator.",
    "connector.session.hostManaged": "Die Sitzung wird von der Anwendung verwaltet.",
    "connector.error.generic": "Fehler: ",
    "connector.error.unexpected": "Ein unerwarteter Fehler ist aufgetreten.",
    "connector.error.tooManyAttempts": "Zu viele Versuche. Erneut versuchen in {seconds} s.",
    "connector.error.tooManyAttemptsLater": "Zu viele Versuche. Bitte später erneut versuchen.",
} satisfies Record<string, string>;

export default langConnectorDe;
