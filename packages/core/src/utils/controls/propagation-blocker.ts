/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Blocks map-level DOM event propagation on control containers.
 *
 * @version 2.0.0
 */

/**
 * Prevents click / scroll events on a control container from reaching
 * the underlying map canvas.
 *
 * This utility uses native addEventListener in the **bubbling phase**
 * so that events first reach child elements (accordion headers, toggle
 * buttons) and are only stopped from propagating further up to the map.
 *
 * @param container - The control's root HTMLElement.
 * @param cleanups - Optional array; removal functions are pushed into it
 *                   so the caller can tear down listeners on control removal.
 */
export function blockMapPropagation(container: HTMLElement, cleanups?: (() => void)[]): void {
    const stop = (e: Event): void => {
        e.stopPropagation();
    };

    // Click-family events (bubbling phase — lets children handle first)
    container.addEventListener("click", stop);
    container.addEventListener("dblclick", stop);
    container.addEventListener("mousedown", stop);
    container.addEventListener("touchstart", stop, { passive: true } as AddEventListenerOptions);

    // Scroll / wheel
    container.addEventListener("wheel", stop, { passive: false } as AddEventListenerOptions);

    // Context menu
    container.addEventListener("contextmenu", stop);

    if (cleanups) {
        cleanups.push(() => {
            container.removeEventListener("click", stop);
            container.removeEventListener("dblclick", stop);
            container.removeEventListener("mousedown", stop);
            container.removeEventListener("touchstart", stop);
            container.removeEventListener("wheel", stop);
            container.removeEventListener("contextmenu", stop);
        });
    }
}
