/*!
 * @geoleaf-plugins/connector — Italian dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langConnectorIt = {
    "connector.modal.title": "Accedi",
    "connector.modal.close": "Chiudi",
    "connector.modal.loginLabel": "Nome utente",
    "connector.modal.passwordLabel": "Password",
    "connector.modal.submit": "Accedi",
    "connector.modal.submitting": "Connessione…",
    "connector.modal.signup": "Crea un account",
    "connector.modal.forgot": "Password dimenticata",
    "connector.error.emptyFields": "Compila tutti i campi.",
    "connector.error.noEndpoint": "Configurazione non valida: endpoint mancante.",
    "connector.error.invalidCredentials": "Nome utente o password errati.",
    "connector.error.networkUnavailable": "Server irraggiungibile. Controlla la connessione.",
    "connector.error.invalidResponse":
        "Il server ha risposto senza token di sessione. Contatta l'amministratore.",
    "connector.session.hostManaged": "La sessione è gestita dall'applicazione.",
    "connector.error.generic": "Errore: ",
    "connector.error.unexpected": "Si è verificato un errore imprevisto.",
    "connector.error.tooManyAttempts": "Troppi tentativi. Riprova tra {seconds} s.",
    "connector.error.tooManyAttemptsLater": "Troppi tentativi. Riprova più tardi.",
} satisfies Record<string, string>;

export default langConnectorIt;
