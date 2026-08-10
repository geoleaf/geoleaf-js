/*!
 * GeoLeaf Core — Share / Modal
 * © 2026 Mattieu Pottier — MIT License
 * https://geoleaf.dev
 */

/**
 *
 * @description
 * Lightweight modal that exposes the current shareable URL and, on demand,
 * a QR code. The QR generator chunk is only fetched the first time the user
 * clicks "Afficher le QR" — see {@link share-qr}.
 *
 * Accessibility: dialog role + aria-labelledby, focus trap, ESC to close.
 */

import { DOMSecurity } from "../../../kernel/security/index.js";
import { getLabel } from "../../../utils/i18n/i18n.js";
import { handleFocusTrap } from "../../../utils/controls/focus-trap.js";
import { buildShareUrl } from "./share-link.js";
import { generateQrSvg } from "./share-qr.js";

const MODAL_ID = "gl-share-modal";
const QR_ALLOWED_TAGS = ["svg", "path", "rect", "g", "defs"];

let _activeModal: HTMLElement | null = null;
let _previousFocus: HTMLElement | null = null;
let _onKeydown: ((e: KeyboardEvent) => void) | null = null;

function _createOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "gl-share-modal__overlay";
    overlay.id = MODAL_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", `${MODAL_ID}-title`);
    return overlay;
}

function _createHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "gl-share-modal__header";
    const title = document.createElement("h2");
    title.className = "gl-share-modal__title";
    title.id = `${MODAL_ID}-title`;
    title.textContent = getLabel("share.modal.title");
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gl-share-modal__close";
    closeBtn.setAttribute("aria-label", getLabel("share.modal.close"));
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", closeShareModal);
    header.appendChild(title);
    header.appendChild(closeBtn);
    return header;
}

function _createLinkRow(url: string): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement("div");
    row.className = "gl-share-modal__link-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "gl-share-modal__link";
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", getLabel("share.modal.url"));
    input.addEventListener("focus", () => input.select());
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "gl-share-modal__copy";
    copyBtn.textContent = getLabel("share.modal.copy");
    copyBtn.addEventListener("click", () => {
        _handleCopy(input, copyBtn).catch(() => {
            // _handleCopy already renders its own failure state in the button.
        });
    });
    row.appendChild(input);
    row.appendChild(copyBtn);
    return { row, input };
}

async function _handleCopy(input: HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
    const url = input.value;
    let ok = false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            ok = true;
        }
    } catch {
        // Fall through to legacy fallback below
    }
    if (!ok) {
        // Legacy fallback for older browsers / non-secure contexts
        input.focus();
        input.select();
        try {
            ok = document.execCommand("copy");
        } catch {
            ok = false;
        }
    }
    const restoreLabel = btn.textContent;
    btn.textContent = ok ? getLabel("share.modal.copied") : getLabel("share.modal.copy_failed");
    btn.classList.toggle("gl-is-success", ok);
    btn.classList.toggle("gl-is-error", !ok);
    setTimeout(() => {
        btn.textContent = restoreLabel;
        btn.classList.remove("gl-is-success", "gl-is-error");
    }, 2000);
}

function _createQrSection(url: string): HTMLElement {
    const section = document.createElement("div");
    section.className = "gl-share-modal__qr";
    const showBtn = document.createElement("button");
    showBtn.type = "button";
    showBtn.className = "gl-share-modal__qr-btn";
    showBtn.textContent = getLabel("share.modal.show_qr");
    const container = document.createElement("div");
    container.className = "gl-share-modal__qr-container";
    container.setAttribute("aria-live", "polite");

    const showQr = async () => {
        showBtn.disabled = true;
        showBtn.textContent = getLabel("share.modal.qr_loading");
        try {
            const svg = await generateQrSvg(url);
            DOMSecurity.setSafeHTML(container, svg, QR_ALLOWED_TAGS);
            showBtn.style.display = "none";
        } catch {
            showBtn.disabled = false;
            showBtn.textContent = getLabel("share.modal.qr_failed");
        }
    };
    // Sync wrapper — a listener must return void. `showQr` try/catches its whole
    // body and renders the failure in the button itself, so it cannot reject.
    showBtn.addEventListener("click", () => {
        void showQr();
    });

    section.appendChild(showBtn);
    section.appendChild(container);
    return section;
}

function _attachKeyboard(overlay: HTMLElement): void {
    _onKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            closeShareModal();
            return;
        }
        handleFocusTrap(overlay, e);
    };
    document.addEventListener("keydown", _onKeydown);
}

/**
 * Opens the share modal. Idempotent — calling it while the modal is open
 * is a no-op.
 */
export function openShareModal(): void {
    if (_activeModal || typeof document === "undefined") return;
    _previousFocus = document.activeElement as HTMLElement | null;

    const url = buildShareUrl();
    const overlay = _createOverlay();
    const panel = document.createElement("div");
    panel.className = "gl-share-modal__panel";
    overlay.appendChild(panel);

    panel.appendChild(_createHeader());
    const { row, input } = _createLinkRow(url);
    panel.appendChild(row);
    panel.appendChild(_createQrSection(url));

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeShareModal();
    });

    document.body.appendChild(overlay);
    _activeModal = overlay;
    _attachKeyboard(overlay);

    // Focus the URL input first so power users can copy immediately with Ctrl+C
    input.focus();
    input.select();
}

/**
 * Closes the share modal if open. Restores focus to the element that
 * triggered the open.
 */
export function closeShareModal(): void {
    if (!_activeModal) return;
    if (_onKeydown) {
        document.removeEventListener("keydown", _onKeydown);
        _onKeydown = null;
    }
    _activeModal.remove();
    _activeModal = null;
    if (_previousFocus && typeof _previousFocus.focus === "function") {
        _previousFocus.focus();
    }
    _previousFocus = null;
}

/** Returns whether the share modal is currently open. @internal */
export function isShareModalOpen(): boolean {
    return _activeModal !== null;
}
