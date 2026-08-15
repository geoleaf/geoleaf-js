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
        (container as HTMLElement).style.height = newHeight + "px";
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
        // Un seul geste à la fois, et bouton gauche seulement. ⚠️ Ne PAS garder sur
        // `e.isPrimary` : happy-dom le laisse à `false` par défaut, donc la garde serait
        // vraie sous test et fausse en navigateur — l'inverse de ce qu'on veut d'une garde.
        if (isResizing || e.button !== 0) return;
        isResizing = true;
        startY = e.clientY;
        startHeight = container.offsetHeight;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";
        // Supprime la sélection de texte pendant le glissement. ⚠️ Ce n'est PAS ce qui
        // empêche le défilement au doigt — c'est `touch-action: none` sur la poignée, côté
        // CSS, et sans cette règle la conversion serait cosmétique.
        e.preventDefault();
        try {
            handle.setPointerCapture(e.pointerId);
        } catch {
            /* not all envs support this */
        }
        // Posés ICI et non à l'inscription : avant, deux écouteurs `document` permanents
        // vivaient toute la durée du panneau et se déclenchaient à chaque mouvement de
        // souris de l'application, gardés par un simple `if (!isResizing) return`.
        handle.addEventListener("pointermove", onPointerMove as EventListener);
        handle.addEventListener("pointerup", onPointerEnd);
        // Un geste tactile s'annule (revendication de défilement, interruption OS) ; un
        // geste souris non. Sans ceci, `document.body` garderait `ns-resize` et
        // `user-select: none` posés sur toute la page.
        handle.addEventListener("pointercancel", onPointerEnd);
    };
    // 🛑 NE PAS « SIMPLIFIER » CE `if` EN LE SUPPRIMANT — mesuré le 14/08/2026, et
    // l'apparence trompe dans le sens dangereux. `events` est un objet CONSTANT de module
    // (`utils/events.ts`), donc en PRODUCTION la condition est toujours vraie et le repli
    // ne sert jamais. Mais `table-panel.test.ts` fait
    // `vi.mock("../utils/events.js", () => ({ events: null }))` : sous test, `events` EST
    // nul et c'est le repli qui s'exécute.
    //
    // Conséquence à connaître avant de s'y fier : la branche jamais couverte est celle du
    // HAUT, c'est-à-dire **celle que la production prend**. Retirer le repli fait tomber
    // trois tests avec un `Cannot read properties of null`. Le sens inverse — retirer le
    // mock — est un chantier de test, pas un geste de ce lot ; il est versé au backlog.
    if (events) {
        cleanups.push(
            events.on(
                handle,
                "pointerdown",
                onPointerDown as EventListener,
                false,
                "TablePanel.resizePointerDown"
            )
        );
    } else {
        handle.addEventListener("pointerdown", onPointerDown as EventListener);
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
