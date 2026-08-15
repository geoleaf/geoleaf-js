/*!
 * GeoLeaf Connector — Login UI (v1.2.3)
 * Accessible login modal with close button, overlay dismiss, and optional
 * signup / forgot-password links. Colors follow the active GeoLeaf theme
 * (light / dark / green / alt) through --gl-color-* custom properties.
 * CSS is inlined as a constant — no external stylesheet required.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig } from "./config.js";
import { TokenStore } from "./token-store.js";
import { AuthClient, AuthError } from "./auth-client.js";
import { adoptStylesheet } from "@geoleaf/host-runtime";
import { tLabel as t } from "@geoleaf/host-runtime";

// ─── CSS ──────────────────────────────────────────────────────────────────────

const _CSS = `
.gc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  font-family: system-ui, -apple-system, sans-serif;
}
.gc-modal {
  position: relative;
  background: var(--gl-color-bg-surface, #ffffff);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.24);
  padding: 2rem;
  width: 100%;
  max-width: 360px;
  box-sizing: border-box;
}
.gc-modal h2 {
  margin: 0 0 1.25rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--gl-color-text-main, #0f172a);
}
.gc-modal label {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--gl-color-text-muted, #374151);
}
.gc-modal input {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  margin-bottom: 1rem;
  background: var(--gl-color-bg-surface-muted, #f9fafb);
  color: var(--gl-color-text-main, #0f172a);
  border: 1px solid var(--gl-color-border-strong, rgba(15,23,42,0.22));
  border-radius: 6px;
  font-size: 1rem;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.gc-modal input::placeholder {
  color: var(--gl-color-text-muted, #9ca3af);
  opacity: 0.7;
}
.gc-modal input:focus {
  border-color: var(--gl-color-accent, #3b82f6);
  box-shadow: 0 0 0 2px var(--gl-color-accent-soft, rgba(59,130,246,0.25));
}
.gc-modal button[type="submit"] {
  width: 100%;
  padding: 0.625rem 1rem;
  background: var(--gl-color-accent, #3b82f6);
  color: var(--gl-color-accent-contrast, #ffffff);
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.gc-modal button[type="submit"]:hover:not(:disabled) {
  background: var(--gl-color-accent-hover, #2563eb);
}
.gc-modal button[type="submit"]:disabled {
  background: var(--gl-color-accent-soft, #93c5fd);
  color: var(--gl-color-text-muted, #ffffff);
  cursor: not-allowed;
}
.gc-error {
  color: #dc2626;
  font-size: 0.875rem;
  margin: 0 0 0.75rem;
  min-height: 1.25em;
}
.gc-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--gl-color-text-muted, #6b7280);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}
.gc-close:hover {
  background: var(--gl-color-bg-surface-muted, #f3f4f6);
  color: var(--gl-color-text-main, #111);
}
.gc-close:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 1px;
}
.gc-links {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--gl-color-border-soft, rgba(15,23,42,0.08));
  font-size: 0.875rem;
  color: var(--gl-color-text-muted, #6b7280);
}
.gc-links a {
  color: var(--gl-color-accent, #3b82f6);
  text-decoration: none;
}
.gc-links a:hover { text-decoration: underline; }
.gc-links a:focus-visible {
  outline: 2px solid var(--gl-color-focus-ring, #2684FF);
  outline-offset: 2px;
  border-radius: 2px;
}
`;

// ─── Focus trap helpers ───────────────────────────────────────────────────────

const FOCUSABLE = "input:not([disabled]), button:not([disabled]), a[href]:not([hidden])";

function _trapFocus(overlay: HTMLElement): (e: KeyboardEvent) => void {
    return (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE));
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    };
}

// ─── Close button SVG builder ─────────────────────────────────────────────────

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

// ─── Modal builder ────────────────────────────────────────────────────────────

interface ModalElements {
    overlay: HTMLDivElement;
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

function _buildModal(): ModalElements {
    // Inject styles once — CSP-safe constructable stylesheet, not a <style>
    // element (static string, no user data) — security roadmap B.7.
    adoptStylesheet(_CSS, "gc-style");

    const overlay = document.createElement("div");
    overlay.className = "gc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gc-modal-title");

    const modal = document.createElement("div");
    modal.className = "gc-modal";

    // Close button (top-right)
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gc-close";
    closeBtn.setAttribute("aria-label", t("connector.modal.close", "Fermer"));
    closeBtn.appendChild(_buildCloseSvg());

    const title = document.createElement("h2");
    title.id = "gc-modal-title";
    title.textContent = t("connector.modal.title", "Connexion");

    const form = document.createElement("form");
    form.id = "gc-login-form";
    form.setAttribute("novalidate", "");

    const loginLabel = document.createElement("label");
    loginLabel.setAttribute("for", "gc-login");
    loginLabel.textContent = t("connector.modal.loginLabel", "Identifiant");

    const loginInput = document.createElement("input");
    loginInput.id = "gc-login";
    loginInput.type = "text";
    loginInput.setAttribute("autocomplete", "username");
    loginInput.required = true;

    const passwordLabel = document.createElement("label");
    passwordLabel.setAttribute("for", "gc-password");
    passwordLabel.textContent = t("connector.modal.passwordLabel", "Mot de passe"); // NOSONAR: UI label text, not a credential

    const passwordInput = document.createElement("input");
    passwordInput.id = "gc-password"; // NOSONAR: element ID, not a credential
    passwordInput.type = "password"; // NOSONAR: input type, not a credential
    passwordInput.setAttribute("autocomplete", "current-password");
    passwordInput.required = true;

    const errorEl = document.createElement("p");
    errorEl.id = "gc-error";
    errorEl.className = "gc-error";
    errorEl.setAttribute("role", "alert");
    errorEl.setAttribute("aria-live", "polite");
    errorEl.hidden = true;

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = t("connector.modal.submit", "Se connecter");

    form.appendChild(loginLabel);
    form.appendChild(loginInput);
    form.appendChild(passwordLabel);
    form.appendChild(passwordInput);
    form.appendChild(errorEl);
    form.appendChild(submitBtn);

    // External links container (hidden by default)
    const linksDiv = document.createElement("div");
    linksDiv.className = "gc-links";
    linksDiv.hidden = true;

    const signupLink = document.createElement("a");
    signupLink.id = "gc-link-signup";
    signupLink.textContent = t("connector.modal.signup", "Créer un compte");
    signupLink.target = "_blank";
    signupLink.rel = "noopener noreferrer";
    signupLink.hidden = true;

    const forgotLink = document.createElement("a");
    forgotLink.id = "gc-link-forgot";
    forgotLink.textContent = t("connector.modal.forgot", "Mot de passe oublié");
    forgotLink.target = "_blank";
    forgotLink.rel = "noopener noreferrer";
    forgotLink.hidden = true;

    linksDiv.appendChild(signupLink);
    linksDiv.appendChild(forgotLink);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(form);
    modal.appendChild(linksDiv);
    overlay.appendChild(modal);

    return {
        overlay,
        closeBtn,
        loginInput,
        passwordInput,
        submitBtn,
        errorEl,
        form,
        linksDiv,
        signupLink,
        forgotLink,
    };
}

// ─── Link wiring ──────────────────────────────────────────────────────────────

/**
 * Reveal and wire the optional signup / forgot-password links. Each click fires a
 * cancelable `connector:*-requested` event; if a host handler calls
 * `preventDefault()`, the default navigation is suppressed.
 */
function _configureLinks(els: ModalElements, config: ConnectorConfig): void {
    if (config.auth?.signupUrl) {
        els.signupLink.href = config.auth.signupUrl;
        els.signupLink.hidden = false;
        els.linksDiv.hidden = false;
    }
    if (config.auth?.forgotPasswordUrl) {
        els.forgotLink.href = config.auth.forgotPasswordUrl;
        els.forgotLink.hidden = false;
        els.linksDiv.hidden = false;
    }

    els.signupLink.addEventListener("click", (e) => {
        const evt = new CustomEvent("geoleaf:connector:signup-requested", {
            detail: { url: config.auth!.signupUrl! },
            cancelable: true,
        });
        if (!document.dispatchEvent(evt)) e.preventDefault();
    });
    els.forgotLink.addEventListener("click", (e) => {
        const evt = new CustomEvent("geoleaf:connector:forgot-password-requested", {
            detail: { url: config.auth!.forgotPasswordUrl! },
            cancelable: true,
        });
        if (!document.dispatchEvent(evt)) e.preventDefault();
    });
}

// ─── Dismiss wiring ───────────────────────────────────────────────────────────

/**
 * Wire the three dismiss paths — Escape key, close button, overlay click — which
 * all run `cleanup()` then reject with `Error("Modal closed by user")`. Returns the
 * keydown handler so the caller's `cleanup` can unregister it.
 */
function _wireDismiss(
    els: ModalElements,
    cleanup: () => void,
    reject: (reason: Error) => void
): (e: KeyboardEvent) => void {
    const dismiss = (): void => {
        cleanup();
        reject(new Error("Modal closed by user"));
    };
    const escapeHandler = (e: KeyboardEvent): void => {
        if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", escapeHandler);
    els.closeBtn.addEventListener("click", dismiss);
    els.overlay.addEventListener("click", (e) => {
        if (e.target === els.overlay) dismiss();
    });
    return escapeHandler;
}

// ─── Submit wiring ────────────────────────────────────────────────────────────

/**
 * Wire the form submit: field validation, loading state, the auth call, and
 * success / error handling. On success it saves the token, cleans up, dispatches
 * `connector:authenticated`, and resolves; on failure it surfaces a localized
 * message and clears the password field (OWASP A02).
 */
function _wireSubmit(
    els: ModalElements,
    config: ConnectorConfig,
    cleanup: () => void,
    resolve: () => void
): void {
    const showError = (msg: string): void => {
        els.errorEl.textContent = msg;
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

    // Sync wrapper — a listener must return void. The body below try/catches its
    // whole async section and renders every failure into the form, so it cannot
    // reject; `preventDefault()` still runs synchronously, before any await.
    els.form.addEventListener("submit", (e) => {
        void handleSubmit(e);
    });

    async function handleSubmit(e: Event) {
        e.preventDefault();
        clearError();

        const loginValue = els.loginInput.value.trim();
        const passwordValue = els.passwordInput.value;

        if (!loginValue || !passwordValue) {
            showError(t("connector.error.emptyFields", "Veuillez remplir tous les champs."));
            return;
        }

        setLoading(true);

        try {
            const auth = config.auth;
            if (!auth?.endpoint) {
                showError(
                    t("connector.error.noEndpoint", "Configuration invalide : endpoint manquant.")
                );
                setLoading(false);
                return;
            }
            const result = await AuthClient.login(auth.endpoint, loginValue, passwordValue);
            const expiresAt = Date.now() + result.expiresIn * 1000;
            await TokenStore.save(config.baseUrl, result.token, expiresAt);

            cleanup();

            document.dispatchEvent(
                new CustomEvent("geoleaf:connector:authenticated", {
                    detail: { baseUrl: config.baseUrl },
                })
            );

            resolve();
        } catch (err) {
            setLoading(false);
            // Clear password on any error (OWASP A02)
            els.passwordInput.value = "";

            if (err instanceof AuthError) {
                if (err.message === "Invalid credentials") {
                    showError(
                        t(
                            "connector.error.invalidCredentials",
                            "Identifiant ou mot de passe incorrect."
                        )
                    );
                } else if (err.message === "Network unavailable") {
                    showError(
                        t(
                            "connector.error.networkUnavailable",
                            "Serveur inaccessible. Vérifiez votre connexion."
                        )
                    );
                } else {
                    showError(t("connector.error.generic", "Erreur : ") + err.message);
                }
            } else {
                showError(t("connector.error.unexpected", "Une erreur inattendue est survenue."));
            }
        }
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Displays the login modal and resolves when the user authenticates successfully.
 * Rejects with `Error("Modal closed by user")` if the user dismisses the modal
 * via close button, Escape key, or overlay click.
 */
export function showLoginModal(config: ConnectorConfig): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const els = _buildModal();
        _configureLinks(els, config);

        // Focus trap — registered here, torn down by cleanup.
        const trapHandler = _trapFocus(els.overlay);
        document.addEventListener("keydown", trapHandler);

        // `cleanup` closes over `escapeHandler`, declared just below. It is only ever
        // invoked from an event (dismiss or successful submit), long after that binding
        // is initialized, so the reference is always resolved by call time.
        const cleanup = (): void => {
            document.removeEventListener("keydown", trapHandler);
            document.removeEventListener("keydown", escapeHandler);
            els.overlay.remove();
        };

        const escapeHandler = _wireDismiss(els, cleanup, reject);
        _wireSubmit(els, config, cleanup, resolve);

        document.body.appendChild(els.overlay);

        // Focus on first input after mount
        requestAnimationFrame(() => els.loginInput.focus());
    });
}
