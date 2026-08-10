/*!
 * @geoleaf-plugins/offline-ui
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf Storage — Shared DOM Helpers
 */

/**
 * Creates a DOM element with optional class name and parent attachment.
 * Type-safe: return type matches the tag name via HTMLElementTagNameMap.
 *
 * @param tag - HTML tag name
 * @param className - CSS class(es) to assign
 * @param parent - Optional parent to append the element to
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    parent?: HTMLElement
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
}
