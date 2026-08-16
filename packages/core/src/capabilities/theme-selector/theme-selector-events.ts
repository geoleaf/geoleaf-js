/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

import { _state } from "./theme-selector-state.js";

/**
 * Attaches a native DOM event handler on an element.
 * Registers the cleanup in _state._eventCleanups.
 *
 * Uses a non-capturing stopPropagation wrapper so that clicks on
 * theme-selector buttons do not propagate to the map canvas, while
 * still allowing the handler itself to execute normally.
 *
 * @param el - Target DOM element
 * @param eventType - Event type ("click", "change", etc.)
 * @param handler - Handler
 * @param _tag - Debug tag (kept for call-site compat, unused)
 */
export function attachDOMEvent(
    el: HTMLElement,
    eventType: string,
    handler: (ev: Event) => void,
    _tag: string
): void {
    el.addEventListener(eventType, handler);

    // Prevent click from reaching the map
    // Uses bubbling phase so the handler above fires first.
    const stopProp = (e: Event) => e.stopPropagation();
    el.addEventListener("click", stopProp);

    _state._eventCleanups.push(
        () => el.removeEventListener(eventType, handler),
        () => el.removeEventListener("click", stopProp)
    );
}
