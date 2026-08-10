/*!
 * GeoLeaf Core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Legend capability — the panel's "busy" overlay.
 *
 * The spinner shown over the legend control while layer legends are being built,
 * with its own auto-hide deadline. Split out of the legend runtime (B.28): it is the
 * one block of pure DOM in that module, it owns two state slots of its own, and it
 * needs nothing from the legend except *which element to cover*.
 *
 * The container is passed as a RESOLVER, not as an element. The auto-hide fires up
 * to 12 s later, and by then the control may have been replaced or torn down — the
 * legend runtime holds the live reference, so it must be asked again at that moment.
 * Capturing the element up front would let the timeout strip `aria-busy` off a
 * detached node while the current panel stays marked busy forever.
 */
"use strict";

/**
 * Reads the legend control's current container, if it has one. Deliberately NOT
 * exported: callers pass a function literal, so nothing outside needs to name it.
 */
type ContainerResolver = () => HTMLElement | undefined;

let _overlayEl: HTMLElement | null = null;
let _overlayTimer: ReturnType<typeof setTimeout> | null = null;

/** Deadline after which the overlay hides itself, whatever the caller does. */
const LOADING_OVERLAY_TIMEOUT_MS = 12000;

function _clearOverlayTimeout(): void {
    if (_overlayTimer) {
        clearTimeout(_overlayTimer);
        _overlayTimer = null;
    }
}

/** Builds the spinner overlay element (once — it is reused across shows). */
function _buildOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "gl-map-legend__loading-overlay";
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(255,255,255,0.6)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.pointerEvents = "auto";
    overlay.style.zIndex = "2";
    overlay.setAttribute("aria-hidden", "false");

    const spinner = document.createElement("div");
    spinner.className = "gl-map-legend__spinner";
    spinner.style.width = "34px";
    spinner.style.height = "34px";
    spinner.style.border = "3px solid rgba(0,0,0,0.12)";
    spinner.style.borderTop = "3px solid rgba(0,0,0,0.55)";
    spinner.style.borderRadius = "50%";
    spinner.style.animation = "gl-legend-spin 1s linear infinite";

    overlay.appendChild(spinner);
    return overlay;
}

/**
 * Covers the legend panel with the spinner and marks it busy for assistive tech.
 * No-op when the control has no container yet. Re-arms the auto-hide deadline.
 *
 * @param resolveContainer - Reads the control's live container.
 */
export function showLoadingOverlay(resolveContainer: ContainerResolver): void {
    const container = resolveContainer();
    if (!container) return;

    _clearOverlayTimeout();

    if (!container.style.position) {
        container.style.position = "relative";
    }

    _overlayEl ??= _buildOverlay();
    if (!_overlayEl.parentElement) {
        container.appendChild(_overlayEl);
    }

    container.setAttribute("aria-busy", "true");
    container.setAttribute("aria-live", "polite");

    _overlayTimer = setTimeout(() => {
        _overlayTimer = null;
        hideLoadingOverlay(resolveContainer);
    }, LOADING_OVERLAY_TIMEOUT_MS);
}

/**
 * Removes the spinner and clears the busy markers. Safe to call when nothing is
 * shown.
 *
 * @param resolveContainer - Reads the control's live container.
 */
export function hideLoadingOverlay(resolveContainer: ContainerResolver): void {
    _clearOverlayTimeout();
    if (_overlayEl?.parentElement) {
        _overlayEl.parentElement.removeChild(_overlayEl);
    }
    const container = resolveContainer();
    if (container) {
        container.removeAttribute("aria-busy");
        container.removeAttribute("aria-live");
    }
}

/**
 * Full teardown for module destroy / lifecycle recreate: cancels the deadline,
 * detaches the overlay and drops the cached element so the next `init()` starts from
 * a clean slate. Unlike {@link hideLoadingOverlay} it touches no container — the
 * legend's `_reset()` releases the control right after, and there is nothing left to
 * un-mark.
 */
export function resetOverlay(): void {
    _clearOverlayTimeout();
    if (_overlayEl?.parentElement) {
        _overlayEl.parentElement.removeChild(_overlayEl);
    }
    _overlayEl = null;
}
