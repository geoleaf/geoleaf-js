/*!
 * GeoLeaf Connector — Login form
 * The form both presentations of the login window share: fields, links, submission.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The login form, without its frame.
 *
 * `login-ui.ts` puts it in a modal (the default) or in an element of the host
 * (`auth.ui.mount`); everything that does not depend on that choice lives here — the fields,
 * the optional links, the notice, and the submission under either token contract.
 */

import type { ConnectorConfig, LoginUiOptions } from "./config.js";
import { isPairContract } from "./config.js";
import { TokenStore } from "./token-store.js";
import { AuthClient, AuthError } from "./auth-client.js";
import { PairAuthClient } from "./auth-pair-client.js";
import { PairSessions } from "./pair-session.js";
import { adoptStylesheet, tLabel as t } from "@geoleaf/host-runtime";
import { LOGIN_CSS } from "./login-styles.js";

/** The elements of one login form. */
export interface FormElements {
    /** The card holding everything below — what a presentation frames. */
    card: HTMLDivElement;
    closeBtn: HTMLButtonElement;
    loginInput: HTMLInputElement;
    passwordInput: HTMLInputElement;
    submitBtn: HTMLButtonElement;
    errorEl: HTMLParagraphElement;
    form: HTMLFormElement;
    linksDiv: HTMLDivElement;
    signupLink: HTMLAnchorElement;
    forgotLink: HTMLAnchorElement;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

function _buildCloseSvg(): SVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M18 6L6 18M6 6l12 12");
    svg.appendChild(path);
    return svg;
}

/** A labelled input, appended to `form`. */
function _field(
    form: HTMLFormElement,
    spec: { id: string; type: string; autocomplete: string; label: string }
): HTMLInputElement {
    const label = document.createElement("label");
    label.setAttribute("for", spec.id);
    label.textContent = spec.label;
    const input = document.createElement("input");
    input.id = spec.id;
    input.type = spec.type;
    input.setAttribute("autocomplete", spec.autocomplete);
    input.required = true;
    form.append(label, input);
    return input;
}

/** The form: the two fields, the error line, the submit button. */
function _buildFields(): Pick<
    FormElements,
    "form" | "loginInput" | "passwordInput" | "errorEl" | "submitBtn"
> {
    const form = document.createElement("form");
    form.id = "gc-login-form";
    form.setAttribute("novalidate", "");
    const loginInput = _field(form, {
        id: "gc-login",
        type: "text",
        autocomplete: "username",
        label: t("connector.modal.loginLabel", "Identifiant"),
    });
    const passwordInput = _field(form, {
        id: "gc-password", // NOSONAR: element ID, not a credential
        type: "password", // NOSONAR: input type, not a credential
        autocomplete: "current-password",
        label: t("connector.modal.passwordLabel", "Mot de passe"), // NOSONAR: UI label text
    });
    const errorEl = document.createElement("p");
    errorEl.id = "gc-error";
    errorEl.className = "gc-error";
    errorEl.setAttribute("role", "alert");
    errorEl.setAttribute("aria-live", "polite");
    errorEl.hidden = true;
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = t("connector.modal.submit", "Se connecter");
    form.append(errorEl, submitBtn);
    return { form, loginInput, passwordInput, errorEl, submitBtn };
}

/** An external link, hidden until configured. */
function _link(id: string, label: string): HTMLAnchorElement {
    const link = document.createElement("a");
    link.id = id;
    link.textContent = label;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = true;
    return link;
}

/**
 * Builds the card: close button, title, the host's notice when it gave one, the form, the
 * links. The title carries `gc-modal-title`, which each presentation names itself after.
 */
export function buildLoginForm(options: LoginUiOptions): FormElements {
    // CSP-safe constructable stylesheet, not a <style> element (static string, no user data).
    adoptStylesheet(LOGIN_CSS, "gc-style");

    const card = document.createElement("div");
    card.className = "gc-modal";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gc-close";
    closeBtn.setAttribute("aria-label", t("connector.modal.close", "Fermer"));
    closeBtn.appendChild(_buildCloseSvg());

    const title = document.createElement("h2");
    title.id = "gc-modal-title";
    title.textContent = t("connector.modal.title", "Connexion");

    card.append(closeBtn, title);
    if (options.notice) {
        // The host's text, rendered as text.
        const notice = document.createElement("p");
        notice.className = "gc-notice";
        notice.textContent = options.notice;
        card.appendChild(notice);
    }

    const fields = _buildFields();
    const linksDiv = document.createElement("div");
    linksDiv.className = "gc-links";
    linksDiv.hidden = true;
    const signupLink = _link("gc-link-signup", t("connector.modal.signup", "Créer un compte"));
    const forgotLink = _link("gc-link-forgot", t("connector.modal.forgot", "Mot de passe oublié"));
    linksDiv.append(signupLink, forgotLink);
    card.append(fields.form, linksDiv);

    return { card, closeBtn, linksDiv, signupLink, forgotLink, ...fields };
}

// ─── Link wiring ──────────────────────────────────────────────────────────────

/** Reveals one link and makes its click a cancelable `connector:*-requested` event. */
function _wireLink(
    els: FormElements,
    link: HTMLAnchorElement,
    url: string | undefined,
    event: string
): void {
    if (!url) return;
    link.href = url;
    link.hidden = false;
    els.linksDiv.hidden = false;
    link.addEventListener("click", (e) => {
        const evt = new CustomEvent(event, { detail: { url }, cancelable: true });
        if (!document.dispatchEvent(evt)) e.preventDefault();
    });
}

/**
 * Reveal and wire the optional signup / forgot-password links. Each click fires a
 * cancelable `connector:*-requested` event; if a host handler calls
 * `preventDefault()`, the default navigation is suppressed.
 */
export function configureLinks(els: FormElements, config: ConnectorConfig): void {
    _wireLink(els, els.signupLink, config.auth?.signupUrl, "geoleaf:connector:signup-requested");
    _wireLink(
        els,
        els.forgotLink,
        config.auth?.forgotPasswordUrl,
        "geoleaf:connector:forgot-password-requested"
    );
}

// ─── Submission ───────────────────────────────────────────────────────────────

/** How much of a server's motive the window shows. */
const REASON_MAX_CHARS = 300;

/**
 * Tells the host a sign-in was refused or could not conclude —
 * `geoleaf:connector:login-failed`.
 *
 * The window shows the server's motive as the server wrote it; a host that wants its own
 * wording, or its own next step (asking for a second factor), reads `status` and `problem`
 * here — the application code the problem declared is in `problem.body`. Distinct from
 * `:auth-error`, which says an established session died.
 */
function _announceFailure(baseUrl: string, err: AuthError): void {
    document.dispatchEvent(
        new CustomEvent("geoleaf:connector:login-failed", {
            detail: {
                baseUrl,
                error: err.message,
                ...(err.status !== undefined && { status: err.status }),
                ...(err.problem && { problem: err.problem }),
            },
        })
    );
}

/** Signs in under the configured contract and stores what the server issued. */
async function _signIn(config: ConnectorConfig, login: string, password: string): Promise<void> {
    const endpoint = config.auth?.endpoint ?? "";
    if (isPairContract(config)) {
        const pair = await PairAuthClient.login(endpoint, login, password);
        await PairSessions.establish(config.baseUrl, pair);
        return;
    }
    const result = await AuthClient.login(endpoint, login, password);
    await TokenStore.save(config.baseUrl, result.token, Date.now() + result.expiresIn * 1000);
}

/** The error line, and the loading and waiting states of the form. */
function _formState(els: FormElements) {
    // `reason` is the SERVER's text — the motive of a refusal, in its own language. It is
    // set through `textContent`, never parsed, and cut to a length a window can hold.
    const showError = (msg: string, reason?: string): void => {
        els.errorEl.textContent = msg;
        if (reason) {
            const line = document.createElement("span");
            line.className = "gc-error-reason";
            line.textContent =
                reason.length > REASON_MAX_CHARS ? reason.slice(0, REASON_MAX_CHARS) + "…" : reason;
            els.errorEl.append(document.createElement("br"), line);
        }
        els.errorEl.hidden = false;
    };
    const clearError = (): void => {
        els.errorEl.textContent = "";
        els.errorEl.hidden = true;
    };
    const setLoading = (loading: boolean): void => {
        els.submitBtn.disabled = loading;
        els.loginInput.disabled = loading;
        els.passwordInput.disabled = loading;
        els.submitBtn.textContent = loading
            ? t("connector.modal.submitting", "Connexion…")
            : t("connector.modal.submit", "Se connecter");
    };
    return { showError, clearError, setLoading };
}

/**
 * Holds the submit button disabled for `seconds`, the remaining time in the error line —
 * what a `429` with a `Retry-After` asks for. The error line is `aria-live="polite"`: the
 * countdown is announced without stealing the focus.
 */
function _holdFor(els: FormElements, seconds: number, show: (msg: string) => void): void {
    let left = Math.ceil(seconds);
    const say = (): void =>
        show(
            t(
                "connector.error.tooManyAttempts",
                "Trop de tentatives. Réessayez dans {seconds} s."
            ).replace("{seconds}", String(left))
        );
    els.submitBtn.disabled = true;
    say();
    const timer = setInterval(() => {
        left -= 1;
        if (left > 0 && els.card.isConnected) {
            say();
            return;
        }
        clearInterval(timer);
        els.submitBtn.disabled = false;
        els.errorEl.textContent = "";
        els.errorEl.hidden = true;
    }, 1000);
}

/** Shows what a failed sign-in deserves, and tells the host. */
function _onFailure(
    els: FormElements,
    config: ConnectorConfig,
    state: ReturnType<typeof _formState>,
    err: unknown
): void {
    state.setLoading(false);
    if (!(err instanceof AuthError)) {
        state.showError(t("connector.error.unexpected", "Une erreur inattendue est survenue."));
        return;
    }
    const reason = err.problem?.detail ?? err.problem?.title;
    if (err.message === "Invalid credentials") {
        state.showError(
            t("connector.error.invalidCredentials", "Identifiant ou mot de passe incorrect."),
            reason
        );
    } else if (err.message === "Network unavailable") {
        state.showError(
            t(
                "connector.error.networkUnavailable",
                "Serveur inaccessible. Vérifiez votre connexion."
            )
        );
    } else if (err.status === 429 && err.retryAfter !== undefined && err.retryAfter > 0) {
        _holdFor(els, err.retryAfter, (msg) => state.showError(msg));
    } else if (err.status === 429) {
        state.showError(
            t("connector.error.tooManyAttemptsLater", "Trop de tentatives. Réessayez plus tard."),
            reason
        );
    } else {
        state.showError(t("connector.error.generic", "Erreur : ") + err.message, reason);
    }
    _announceFailure(config.baseUrl, err);
}

/**
 * Wire the form submit: field validation, loading state, the auth call under the configured
 * contract, and success / error handling.
 *
 * The password field is emptied as soon as the request leaves (OWASP A02) — it does not wait
 * for the answer. On success it stores the session, cleans up, dispatches
 * `connector:authenticated`, resolves, and reloads the page when `reloadOnSuccess` asks for it;
 * on failure it surfaces a localized message — with the server's own motive under it when the
 * refusal declared one, a countdown on a `429` that said how long — and dispatches
 * `connector:login-failed`.
 */
export function wireSubmit(
    els: FormElements,
    config: ConnectorConfig,
    options: LoginUiOptions,
    done: { cleanup: () => void; resolve: () => void }
): void {
    const state = _formState(els);

    els.form.addEventListener("submit", (e) => {
        e.preventDefault();
        void handleSubmit();
    });

    async function handleSubmit(): Promise<void> {
        state.clearError();
        const loginValue = els.loginInput.value.trim();
        const passwordValue = els.passwordInput.value;
        if (!loginValue || !passwordValue) {
            state.showError(t("connector.error.emptyFields", "Veuillez remplir tous les champs."));
            return;
        }
        if (!config.auth?.endpoint) {
            state.showError(
                t("connector.error.noEndpoint", "Configuration invalide : endpoint manquant.")
            );
            return;
        }
        state.setLoading(true);
        els.passwordInput.value = "";
        try {
            await _signIn(config, loginValue, passwordValue);
        } catch (err) {
            _onFailure(els, config, state, err);
            return;
        }
        done.cleanup();
        document.dispatchEvent(
            new CustomEvent("geoleaf:connector:authenticated", {
                detail: { baseUrl: config.baseUrl },
            })
        );
        done.resolve();
        if (options.reloadOnSuccess) location.reload();
    }
}
