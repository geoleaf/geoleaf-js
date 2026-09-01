/*!
 * @geoleaf-plugins/table
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * panel-resize.ts
 *
 * Resize handle helpers for the table bottom-sheet panel.
 * Extracted from panel.ts to keep it within the 700-line limit.
 */

import { events as _events } from "./utils/events.js";
import type { TableConfig } from "./types.js";
import type { EventCleanup } from "./event-cleanups.js";

/**
 * Parses a height value (%, px, vh) into pixels.
 * @param {string} value - Value to parse ("40%", "300px", "50vh")
 * @param {number} referenceHeight - Reference height for the % case
 * @returns {number} Height in pixels
 * @private
 */
function parseHeight(value: unknown, referenceHeight: number): number {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return 300;

    if (value.endsWith("%")) {
        const percent = parseFloat(value);
        return (referenceHeight * percent) / 100;
    } else if (value.endsWith("px")) {
        return parseFloat(value);
    } else if (value.endsWith("vh")) {
        const vh = parseFloat(value);
        return (window.innerHeight * vh) / 100;
    }
    return 300; // Default
}

function attachResizeEvents(
    handle: HTMLElement,
    container: HTMLElement,
    config: TableConfig,
    cleanups: EventCleanup[]
): void {
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    const events = _events;

    const onPointerMove = (e: PointerEvent) => {
        if (!isResizing) return;
        const delta = startY - e.clientY;
        let newHeight = startHeight + delta;
        const viewportHeight = window.innerHeight;
        const minHeightPx = parseHeight(config.minHeight || "20%", viewportHeight);
        const maxHeightPx = parseHeight(config.maxHeight || "80%", viewportHeight);
        newHeight = Math.max(minHeightPx, Math.min(maxHeightPx, newHeight));
        container.style.height = newHeight + "px";
    };

    const onPointerEnd = () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        handle.removeEventListener("pointermove", onPointerMove as EventListener);
        handle.removeEventListener("pointerup", onPointerEnd);
        handle.removeEventListener("pointercancel", onPointerEnd);
    };

    const onPointerDown = (e: PointerEvent) => {
        // One gesture at a time, and left button only. ⚠️ Do NOT guard on
        // `e.isPrimary`: happy-dom leaves it `false` by default, so the guard
        // would be true under test and false in the browser — the opposite of
        // what a guard is for.
        if (isResizing || e.button !== 0) return;
        isResizing = true;
        startY = e.clientY;
        startHeight = container.offsetHeight;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        // Suppresses text selection during the drag. ⚠️ It is NOT what
        // prevents finger scrolling — that is `touch-action: none` on the
        // handle, CSS-side, and without that rule the conversion would be cosmetic.
        e.preventDefault();
        try {
            handle.setPointerCapture(e.pointerId);
        } catch {
            /* not all envs support this */
        }
        // Set HERE and not at registration: before, two permanent `document`
        // listeners lived for the panel's whole lifetime and fired on every
        // mouse move in the application, guarded by a mere `if (!isResizing) return`.
        handle.addEventListener("pointermove", onPointerMove as EventListener);
        handle.addEventListener("pointerup", onPointerEnd);
        // A touch gesture cancels (scroll claim, OS interruption); a mouse
        // gesture does not. Without this, `document.body` would keep
        // `ns-resize` and `user-select: none` set on the whole page.
        handle.addEventListener("pointercancel", onPointerEnd);
    };
    // The `events` seam is a constant module export (`utils/events.ts`): it can never be
    // null in production, a property proven and pinned by
    // `__tests__/events-seam-never-null.guard.test.ts`. The `else { addEventListener }`
    // fallback that used to sit here — and its eleven twins across the package — rested on
    // the opposite premise and was covered by nothing once the test suites started mocking
    // the seam faithfully; all twelve were removed on 25/08/2026. Do not reintroduce one:
    // the guard reddens on any new fallback, in either spelling of the import.
    cleanups.push(
        events.on(
            handle,
            "pointerdown",
            onPointerDown as EventListener,
            false,
            "TablePanel.resizePointerDown"
        )
    );
}

/**
 * Creates the resize handle.
 * @param {HTMLElement} container - Table container
 * @param {Object} config - Configuration
 * @param {EventCleanup[]} cleanups - Event cleanup callbacks array
 * @returns {HTMLElement}
 */
export function createResizeHandle(
    container: HTMLElement,
    config: TableConfig,
    cleanups: EventCleanup[]
): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "gl-table-panel__resize-handle";
    const resizeBar = document.createElement("div");
    resizeBar.className = "gl-table-panel__resize-bar";
    handle.appendChild(resizeBar);
    attachResizeEvents(handle, container, config, cleanups);
    return handle;
}
