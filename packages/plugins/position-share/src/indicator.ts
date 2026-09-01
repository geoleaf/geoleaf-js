/*!
 * @geoleaf-plugins/position-share — Emission indicator
 * © 2026 Mattieu Pottier — MIT License
 *
 * A position leaving the browser without the user seeing it is not acceptable. This badge is
 * the visible half of that contract: whenever the loop runs, it is on screen.
 * https://geoleaf.dev
 */
import { createEl, tLabel } from "@geoleaf/host-runtime";

let _badge: HTMLElement | null = null;

/** The map container, or the document body when the map is not built yet. */
function host(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(".maplibregl-map") ?? document.body;
}

/**
 * Shows or hides the "sharing my position" badge.
 *
 * @param active - `true` while the emission loop runs.
 *
 * @example
 * ```ts
 * setIndicator(true);
 * ```
 */
export function setIndicator(active: boolean): void {
    if (!active) {
        _badge?.remove();
        _badge = null;
        return;
    }

    if (_badge) return;

    const parent = host();
    if (!parent) return;

    // Class names are written as LITERALS, never assembled from a shared prefix. purgecss
    // scans the sources for the strings it finds; a name built at runtime is invisible to it, so
    // the rule would be reported dead and deleted from the shipped stylesheet — the badge would
    // then render unstyled, with every gate still green.
    const badge = createEl("div", "gl-position-share-badge", {
        role: "status",
        "aria-live": "polite",
    });
    const dot = createEl("span", "gl-position-share-badge-dot");
    const text = createEl("span", "gl-position-share-badge-text");
    // `textContent`, never `innerHTML`: the label crosses the i18n seam and a profile can
    // override it, so it is untrusted input by the time it reaches here.
    text.textContent = tLabel("position-share.status.emitting", "Sharing my position");

    badge.appendChild(dot);
    badge.appendChild(text);
    parent.appendChild(badge);
    _badge = badge;
}

/** Whether the badge is currently on screen. Exposed for tests. */
export function isIndicatorVisible(): boolean {
    return _badge !== null;
}
