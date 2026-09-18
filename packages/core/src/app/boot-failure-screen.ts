/*!
 * GeoLeaf Core – App / Boot failure screen
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * The default boot failure screen, drawn INSIDE the app shell's `#gl-loader` veil.
 *
 * ## Why inside the veil, and only there
 *
 * The veil is the one piece of page-level markup the library already drives: the app shell
 * declares it and `revealApp()` hides it. Drawing the screen there replaces the spinner the
 * user is looking at, instead of stacking a second overlay on top of it. A host that embeds
 * the library WITHOUT the veil gets no DOM at all: it receives `geoleaf:boot:failed` and
 * decides — the library never creates a page-level overlay of its own.
 *
 * ⚠️ Every class name is written literally below: purgecss reads this file to keep the rules
 * of `css/geoleaf-loader.css`, and a class assembled from a template would be purged. The DOM
 * is built with `domCreate` and `textContent` only — no `innerHTML`, nothing to audit.
 */

import type { GeoLeafEventMap } from "../contracts/event-bus.contract.js";
import { domCreate } from "../utils/general/dom-helpers.js";
import { getLabel } from "../utils/i18n/i18n.js";

type BootFailureReason = GeoLeafEventMap["geoleaf:boot:failed"]["reason"];

/** What the screen says. */
export interface BootFailureScreenModel {
    /**
     * `failure`: the boot cannot continue. `attention`: declared resources or modules failed, and
     * a map can show.
     */
    readonly kind: "failure" | "attention";
    /**
     * The failure's reason. For `attention`: `module` when a module failed — the screen then
     * speaks of components — and `profile` otherwise.
     */
    readonly reason: BootFailureReason;
    /** One line per module or resource that failed. */
    readonly resources: readonly string[];
}

/** The callbacks behind the buttons. */
export interface BootFailureScreenActions {
    readonly reload: () => void;
    readonly continueBoot: () => void;
    readonly diagnostic: () => string;
}

/** One literal `getLabel` call per reason, so the requested-keys guard sees every key. */
const REASON_MESSAGES: Readonly<Record<BootFailureReason, () => string>> = {
    config: () => getLabel("boot.failure.reason.config"),
    profile: () => getLabel("boot.failure.reason.profile"),
    webgl: () => getLabel("boot.failure.reason.webgl"),
    map: () => getLabel("boot.failure.reason.map"),
    module: () => getLabel("boot.failure.reason.module"),
    timeout: () => getLabel("boot.failure.reason.timeout"),
    internal: () => getLabel("boot.failure.reason.internal"),
};

/**
 * The user-facing sentence for a failure reason, in the active language.
 *
 * @param reason - A `geoleaf:boot:failed` reason.
 * @returns The translated sentence.
 */
export function bootFailureMessage(reason: BootFailureReason): string {
    return REASON_MESSAGES[reason]();
}

/**
 * The warning shown when a module fails once the application is revealed, in the active language.
 *
 * @param module - The id of the module that failed.
 * @returns The translated sentence, naming the module.
 */
export function moduleWarningMessage(module: string): string {
    return getLabel("boot.failure.module_warning", module);
}

/** The app shell's veil — an id `docs/specs/contrats/APP_SHELL.md` forbids renaming. */
function _veil(): HTMLElement | null {
    return typeof document === "undefined" ? null : document.getElementById("gl-loader");
}

/** Removes a screen drawn in the veil, and gives the spinner back. */
export function clearBootFailureScreen(): void {
    const veil = _veil();
    if (!veil) return;
    for (const panel of Array.from(veil.getElementsByClassName("gl-boot-failure"))) {
        panel.remove();
    }
    veil.classList.remove("gl-loader--error");
}

/**
 * Draws the screen in the veil, replacing any screen already drawn there.
 *
 * « Continue » exists only for `attention`, and is then the primary action: the map exists,
 * and reloading a page whose resources are missing, offline, fails the same way. For a
 * failure, « Reload » is the primary action.
 *
 * @param model - What to say.
 * @param actions - What the buttons do.
 * @returns `false` when the page has no veil: nothing is drawn.
 */
export function renderBootFailureScreen(
    model: BootFailureScreenModel,
    actions: BootFailureScreenActions
): boolean {
    const veil = _veil();
    if (!veil) return false;
    clearBootFailureScreen();
    veil.classList.add("gl-loader--error");

    const panel = domCreate("div", "gl-boot-failure", veil);
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "gl-boot-failure-title");
    panel.setAttribute("aria-describedby", "gl-boot-failure-message");

    const title = domCreate("h2", "gl-boot-failure__title", panel);
    title.id = "gl-boot-failure-title";
    const message = domCreate("p", "gl-boot-failure__message", panel);
    message.id = "gl-boot-failure-message";
    if (model.kind === "attention" && model.reason === "module") {
        title.textContent = getLabel("boot.failure.attention.module_title");
        message.textContent = getLabel("boot.failure.attention.module_message");
    } else if (model.kind === "attention") {
        title.textContent = getLabel("boot.failure.attention.title");
        message.textContent = getLabel("boot.failure.attention.message");
    } else {
        title.textContent = getLabel("boot.failure.title");
        message.textContent = bootFailureMessage(model.reason);
    }

    if (model.resources.length > 0) {
        const list = domCreate("ul", "gl-boot-failure__list", panel);
        for (const line of model.resources) {
            domCreate("li", undefined, list).textContent = line;
        }
    }

    const row = domCreate("div", "gl-boot-failure__actions", panel);
    const status = domCreate("p", "gl-boot-failure__status", panel);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const attention = model.kind === "attention";
    const continueButton = attention
        ? _button(
              row,
              "continue",
              getLabel("boot.failure.action.continue"),
              true,
              actions.continueBoot
          )
        : null;
    const reloadButton = _button(
        row,
        "reload",
        getLabel("boot.failure.action.reload"),
        !attention,
        actions.reload
    );
    _button(row, "copy", getLabel("boot.failure.action.copy"), false, () =>
        _copy(actions.diagnostic(), status, panel)
    );
    _button(row, "download", getLabel("boot.failure.action.download"), false, () =>
        _download(actions.diagnostic())
    );
    (continueButton ?? reloadButton).focus();
    return true;
}

/** A button of the screen; `data-gl-action` names it for hosts, tests and E2E. */
function _button(
    parent: HTMLElement,
    action: string,
    label: string,
    primary: boolean,
    onClick: () => void
): HTMLButtonElement {
    const button = domCreate(
        "button",
        primary
            ? "gl-boot-failure__button gl-boot-failure__button--primary"
            : "gl-boot-failure__button",
        parent
    );
    button.type = "button";
    button.dataset["glAction"] = action;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
}

/**
 * Copies the diagnostic; without a usable clipboard (no secure context, permission refused),
 * shows it in a read-only field, selected, so the user can copy it by hand.
 */
function _copy(text: string, status: HTMLElement, panel: HTMLElement): void {
    const manual = (): void => {
        status.textContent = getLabel("boot.failure.copy_manual");
        let field = panel.querySelector<HTMLTextAreaElement>(
            "textarea.gl-boot-failure__diagnostic"
        );
        if (!field) {
            field = domCreate("textarea", "gl-boot-failure__diagnostic", panel);
            field.readOnly = true;
        }
        field.value = text;
        field.focus();
        field.select();
    };
    const clipboard: Clipboard | undefined =
        typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
        manual();
        return;
    }
    clipboard.writeText(text).then(() => {
        status.textContent = getLabel("boot.failure.copied");
    }, manual);
}

/** Hands the diagnostic over as a JSON file — the one channel that works with no clipboard. */
function _download(text: string): void {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = domCreate("a");
    link.href = url;
    link.download = `geoleaf-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
