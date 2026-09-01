/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Module - Event Delegation
 * Centralized UI event handling built on efficient delegation patterns
 *
 * @author Assistant
 * @version 1.2.0
 */
import { Log } from "../../utils/log/index.js";

// ========================================
//   CONSTANTES & STATE
// ========================================

// ── Local structural types (ui/event-delegation) ─────────────────────

/** Entry stored per tracked listener, used for later removal. */
interface TrackedListener {
    element: HTMLElement;
    event: string;
    handler: EventListener;
    originalHandler: EventListener;
}

/**
 * Map of active listeners, kept for cleanup
 * @type {Map<string, {element: HTMLElement, event: string, handler: Function}>}
 */
const _activeListeners = new Map<string, TrackedListener>();

/**
 * Counter backing the unique listener ids
 * @type {number}
 */
let _listenerIdCounter = 0;

// ========================================
//   UTILITAIRES DE DELEGATION
// ========================================

/**
 * Attaches an event listener, tracked automatically for cleanup
 * @param {HTMLElement} element - Element DOM
 * @param {string} event - Type d'event
 * @param {Function} handler - Handler of the event
 * @param {Object} options - addEventListener options
 * @returns {string} Unique listener id, used for cleanup
 */
function attachTrackedListener(
    element: HTMLElement,
    event: string,
    handler: EventListener,
    options: boolean | AddEventListenerOptions = {}
) {
    if (!element || typeof handler !== "function") {
        if (Log) Log.warn("[UI.EventDelegation] attachTrackedListener: element or handler missing");
        return null;
    }

    const listenerId = `listener_${++_listenerIdCounter}`;

    // Wrapper providing automatic error tracking
    const wrappedHandler = function (this: HTMLElement, e: Event) {
        try {
            return handler.call(this, e);
        } catch (error) {
            if (Log) Log.error("[UI.EventDelegation] Error in handler:", error);
        }
    };

    element.addEventListener(event, wrappedHandler, options);

    _activeListeners.set(listenerId, {
        element,
        event,
        handler: wrappedHandler,
        originalHandler: handler,
    });

    return listenerId;
}

/**
 * Cleans up all tracked listeners
 * @returns {number} Number of listeners cleaned
 */
function cleanupAllListeners() {
    let cleaned = 0;
    for (const [_listenerId, { element, event, handler }] of _activeListeners) {
        element.removeEventListener(event, handler);
        cleaned++;
    }
    _activeListeners.clear();
    if (Log && cleaned > 0) {
        Log.info(`[UI.EventDelegation] ${cleaned} listeners cleaned`);
    }
    return cleaned;
}

// ========================================
//   DELEGATION BY SPECIFIC UI TYPES
// ========================================

/**
 * Handles accordion events through delegation
 * @param {HTMLElement} container - Accordion container
 * @returns {string} Id of the created listener
 */
function attachAccordionEvents(container: HTMLElement) {
    if (!container) {
        if (Log) Log.warn("[UI.EventDelegation] attachAccordionEvents: conteneur manquant");
        return null;
    }

    const accordionHandler = function (e: Event) {
        const target = e.target as HTMLElement;
        // Look up the accordion button in the hierarchy
        const accordionButton = target.closest(".gl-accordion-toggle, .accordion-arrow");
        if (!accordionButton) return;

        e.preventDefault();
        e.stopPropagation();

        // Finds the associated panel
        const panel = accordionButton
            .closest(".gl-accordion")
            ?.querySelector(".gl-accordion-content") as HTMLElement | null;
        if (!panel) return;

        // Toggle accordion
        const isExpanded = panel.style.display !== "none";
        panel.style.display = isExpanded ? "none" : "block";

        // Updates the aria-expanded
        accordionButton.setAttribute("aria-expanded", String(!isExpanded));

        // Update the icon when present
        const icon = accordionButton.querySelector(".accordion-icon, .accordion-arrow");
        if (icon) {
            icon.classList.toggle("expanded", !isExpanded);
        }
    };

    return attachTrackedListener(container, "click", accordionHandler);
}

// ========================================
//   API PUBLIQUE
// ========================================

const _UIEventDelegation = {
    attachTrackedListener,
    cleanupAllListeners,
    attachAccordionEvents,
};

// ── ESM Export ──
export { _UIEventDelegation };
