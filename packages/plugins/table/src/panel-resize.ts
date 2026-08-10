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
    const mouseDownHandler = (e: MouseEvent) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = container.offsetHeight;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    };
    const mouseMoveHandler = (e: MouseEvent) => {
        if (!isResizing) return;
        const delta = startY - e.clientY;
        let newHeight = startHeight + delta;
        const viewportHeight = window.innerHeight;
        const minHeightPx = parseHeight(config.minHeight || "20%", viewportHeight);
        const maxHeightPx = parseHeight(config.maxHeight || "80%", viewportHeight);
        newHeight = Math.max(minHeightPx, Math.min(maxHeightPx, newHeight));
        (container as HTMLElement).style.height = newHeight + "px";
    };
    const mouseUpHandler = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        }
    };
    if (events) {
        cleanups.push(
            events.on(
                handle,
                "mousedown",
                mouseDownHandler as EventListener,
                false,
                "TablePanel.resizeMouseDown"
            )
        );
        cleanups.push(
            events.on(
                document,
                "mousemove",
                mouseMoveHandler as EventListener,
                false,
                "TablePanel.resizeMouseMove"
            )
        );
        cleanups.push(
            events.on(document, "mouseup", mouseUpHandler, false, "TablePanel.resizeMouseUp")
        );
    } else {
        handle.addEventListener("mousedown", mouseDownHandler);
        document.addEventListener("mousemove", mouseMoveHandler);
        document.addEventListener("mouseup", mouseUpHandler);
    }
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
