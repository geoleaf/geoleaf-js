/*!
 * @geoleaf-plugins/connector — Portuguese dictionary
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

const langConnectorPt = {
    "connector.modal.title": "Entrar",
    "connector.modal.close": "Fechar",
    "connector.modal.loginLabel": "Nome de utilizador",
    "connector.modal.passwordLabel": "Palavra-passe",
    "connector.modal.submit": "Entrar",
    "connector.modal.submitting": "A ligar…",
    "connector.modal.signup": "Criar uma conta",
    "connector.modal.forgot": "Esqueci-me da palavra-passe",
    "connector.error.emptyFields": "Preencha todos os campos.",
    "connector.error.noEndpoint": "Configuração inválida: endpoint em falta.",
    "connector.error.invalidCredentials": "Nome de utilizador ou palavra-passe incorretos.",
    "connector.error.networkUnavailable": "Servidor inacessível. Verifique a sua ligação.",
    "connector.error.invalidResponse":
        "O servidor respondeu sem token de sessão. Contacte o administrador.",
    "connector.session.hostManaged": "A sessão é gerida pela aplicação.",
    "connector.error.generic": "Erro: ",
    "connector.error.unexpected": "Ocorreu um erro inesperado.",
    "connector.error.tooManyAttempts":
        "Demasiadas tentativas. Tente novamente dentro de {seconds} s.",
    "connector.error.tooManyAttemptsLater": "Demasiadas tentativas. Tente novamente mais tarde.",
} satisfies Record<string, string>;

export default langConnectorPt;
