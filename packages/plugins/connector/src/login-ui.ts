/*!
 * GeoLeaf Connector — Login UI
 * The login window's two presentations: an accessible modal (the default), or the same form
 * mounted in an element of the host. Optional signup / forgot-password links.
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import type { ConnectorConfig, LoginUiOptions } from "./config.js";
import { loginUiOf } from "./config.js";
import { buildLoginForm, configureLinks, wireSubmit } from "./login-form.js";
import type { FormElements } from "./login-form.js";

// ─── Focus trap (modal only) ──────────────────────────────────────────────────

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

// ─── Presentations ────────────────────────────────────────────────────────────

/**
 * A presentation of the form: where it is put, and what listens while it is open.
 *
 * `root` is what leaves the page when the window closes. `detach` releases what `attach` took.
 */
interface Presentation {
    readonly root: HTMLElement;
    attach(dismiss: () => void): void;
    detach(): void;
}

/**
 * The modal: a backdrop over the page, `role="dialog"` + `aria-modal`, a page-wide focus trap,
 * and three ways out — `Escape` anywhere, the close button, a click on the backdrop.
 */
function _modal(els: FormElements): Presentation {
    const overlay = document.createElement("div");
    overlay.className = "gc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "gc-modal-title");
    overlay.appendChild(els.card);

    const trap = _trapFocus(overlay);
    let escape: ((e: KeyboardEvent) => void) | null = null;
    return {
        root: overlay,
        attach(dismiss) {
            escape = (e) => {
                if (e.key === "Escape") dismiss();
            };
            document.addEventListener("keydown", trap);
            document.addEventListener("keydown", escape);
            els.closeBtn.addEventListener("click", dismiss);
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) dismiss();
            });
            document.body.appendChild(overlay);
        },
        detach() {
            document.removeEventListener("keydown", trap);
            if (escape) document.removeEventListener("keydown", escape);
            overlay.remove();
        },
    };
}

/**
 * The form mounted in an element of the host — a side panel, a drawer.
 *
 * ⚠️ **No backdrop, no `aria-modal`, no page-wide listener.** The page around it stays usable,
 * and trapping the focus or listening to every key would take it from the host. `Escape` is
 * heard on the form only, and with the close button it hands the window back to the host
 * (`onDismiss`).
 */
function _mounted(els: FormElements, host: HTMLElement): Presentation {
    const section = document.createElement("section");
    section.className = "gc-mount";
    section.setAttribute("aria-labelledby", "gc-modal-title");
    els.card.classList.add("gc-mounted");
    section.appendChild(els.card);
    return {
        root: section,
        attach(dismiss) {
            section.addEventListener("keydown", (e) => {
                if (e.key === "Escape") dismiss();
            });
            els.closeBtn.addEventListener("click", dismiss);
            host.appendChild(section);
        },
        detach() {
            section.remove();
        },
    };
}

/** The element the host asked the form to be mounted in, or `null` for a modal. */
function _mountOf(options: LoginUiOptions): HTMLElement | null {
    const mount = options.mount;
    if (!mount) return null;
    return typeof mount === "function" ? mount() : mount;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * The window on screen, with the promise its callers share — `null` when none is open.
 *
 * The root element is kept beside the promise because a host can take the window out of the
 * page without settling it: a promise alone would then be joined for ever, by callers handed a
 * window nobody can see.
 */
let _open: { promise: Promise<void>; root: HTMLElement } | null = null;

/**
 * Displays the login window and resolves when the user authenticates successfully.
 * Rejects with `Error("Modal closed by user")` if the user dismisses it — close button,
 * `Escape`, or a click on the modal's backdrop — after calling `auth.ui.onDismiss`.
 *
 * The presentation follows `auth.ui`: a modal by default, or the same form mounted in
 * `auth.ui.mount` (see `LoginUiOptions`).
 *
 * There is one window at a time: a call made while it is on screen JOINS it and receives the
 * same promise, so one sign-in — or one dismissal — settles every caller. Several paths open
 * it (a `configure()` on an absent session, `openLoginModal()`, the credential button, the
 * guided reconnection), and two stacked windows carried the same element ids, each with its
 * own promise.
 */
export function showLoginModal(config: ConnectorConfig): Promise<void> {
    if (_open?.root.isConnected) return _open.promise;

    const options = loginUiOf(config) ?? {};
    const els = buildLoginForm(options);
    const host = _mountOf(options);
    const view = host ? _mounted(els, host) : _modal(els);

    const promise = new Promise<void>((resolve, reject) => {
        configureLinks(els, config);
        const dismiss = (): void => {
            view.detach();
            reject(new Error("Modal closed by user"));
            try {
                options.onDismiss?.();
            } catch (error) {
                // The host's callback: its failure must not keep the window's promise pending.
                console.warn("[GeoLeaf Connector] auth.ui.onDismiss threw:", error);
            }
        };
        wireSubmit(els, config, options, { cleanup: () => view.detach(), resolve });
        view.attach(dismiss);
        requestAnimationFrame(() => els.loginInput.focus());
    });

    const entry = { promise, root: view.root };
    _open = entry;
    // Both branches are handled here, so this bookkeeping never surfaces a rejection of its
    // own; the caller still receives `promise` and its outcome.
    const release = (): void => {
        if (_open === entry) _open = null;
    };
    promise.then(release, release);
    return promise;
}
