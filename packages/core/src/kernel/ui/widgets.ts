/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * GeoLeaf UI Widgets - Accordion and toggle-button builders
 *
 * Generic interactive widgets shared by Legend and LayerManager. Split out of
 * components.ts in KERNEL S8 (2 responsibilities in one file); `components.ts`
 * re-aggregates this with ui/legend-symbols.ts into `_UIComponents`, so every
 * existing import path and the global namespace are unchanged.
 *
 * DEPENDENCIES:
 * - native DOM events
 *
 * EXPOSE:
 * - _UIWidgets (consumed by ui/components.ts)
 */

import { domCreate } from "../../utils/general/dom-helpers.js";

// ── Local structural types (S2.1 — ui/components) ───────────────────────────
// Accordion / toggle configs arrive as loosely-typed bags from legend and
// layer-manager callers. Narrow to the members read here.

/** Accordion config consumed by `createAccordion`. */
interface AccordionConfig {
    layerId: string;
    label?: string;
    collapsed?: boolean;
    visible?: boolean;
    onToggle?: (layerId: string, expanded: boolean) => void;
}

/** Toggle-button config consumed by `createToggleButton`. */
interface ToggleButtonConfig {
    id?: string;
    isActive?: boolean;
    active?: boolean;
    className?: string;
    label?: string;
    title?: string;
    onToggle?: (id: string | undefined, isActive: boolean, ev: Event) => void;
}

/**
 * Attaches a native DOM event handler and blocks map propagation for clicks.
 * @param {HTMLElement} element - Target element
 * @param {string} eventName - Name of the event
 * @param {Function} handler - Manager
 */
export function attachEventHandler(
    element: HTMLElement,
    eventName: string,
    handler: (ev: Event) => void
): void {
    element.addEventListener(eventName, handler);
    if (eventName === "click") {
        // Prevent click from propagating to the map (bubbling phase, non-blocking)
        element.addEventListener("click", (e) => e.stopPropagation());
    }
}

/**
 * Interactive UI widgets.
 *
 * `attachEventHandler` is a module-level function rather than a `this` call so
 * these builders keep working when destructured off the aggregate.
 *
 * @namespace _UIWidgets
 * @private
 */
const _UIWidgets = {
    /**
     * Creates an accordion
     * @param {HTMLElement} container - Parent container
     * @param {Object} config - Configuration of the accordion
     * @param {string} config.layerId - ID de the layer
     * @param {string} config.label - Title of the accordion
     * @param {boolean} config.collapsed - Initial state
     * @param {boolean} config.visible - Whether the layer is visible (drives the greyed-out state)
     * @param {Function} [config.onToggle] - Callback during the toggle
     * @returns {Object} - { accordionEl, headerEl, bodyEl }
     */
    createAccordion(container: HTMLElement, config: AccordionConfig) {
        const accordionEl = domCreate("div", "gl-legend__accordion", container);
        accordionEl.setAttribute("data-layer-id", config.layerId);

        if (config.collapsed) {
            accordionEl.classList.add("gl-legend__accordion--collapsed");
        }

        // Add the inactive class when the layer is hidden
        if (config.visible === false) {
            accordionEl.classList.add("gl-legend__accordion--inactive");
        }

        // A1+A2+A3: single semantic <button> — native keyboard, no nesting violation
        const headerEl = domCreate("button", "gl-legend__accordion-header", accordionEl);
        headerEl.type = "button";
        headerEl.setAttribute("aria-expanded", config.collapsed ? "false" : "true");

        const titleEl = domCreate("span", "gl-legend__accordion-title", headerEl);
        titleEl.textContent = config.label as string;

        // Icon span excluded from accessibility tree (replaces nested <button>)
        // Arrow rotation handled by CSS (.gl-legend__accordion--collapsed / :not(--collapsed))
        const toggleEl = domCreate("span", "gl-legend__accordion-icon", headerEl);
        toggleEl.setAttribute("aria-hidden", "true");
        toggleEl.textContent = "\u25b6";

        // Body of the accordion
        const bodyEl = domCreate("div", "gl-legend__accordion-body", accordionEl);

        // Click handler on the header
        const onToggle = (ev: Event): void => {
            // No-op when the layer is inactive
            if (config.visible === false) {
                ev.stopPropagation();
                ev.preventDefault();
                return;
            }

            ev.stopPropagation();
            ev.preventDefault();

            const isCollapsed = accordionEl.classList.toggle("gl-legend__accordion--collapsed");
            headerEl.setAttribute("aria-expanded", isCollapsed ? "false" : "true");

            // Callback optional
            if (typeof config.onToggle === "function") {
                config.onToggle(config.layerId, !isCollapsed);
            }
        };

        attachEventHandler(headerEl, "click", onToggle);

        return { accordionEl, headerEl, bodyEl, toggleEl };
    },

    /**
     * Creates a toggle button (checkbox/switch)
     * @param {HTMLElement} container - Parent container
     * @param {Object} config - Toggle configuration
     * @param {string} [config.id] - Toggle id
     * @param {boolean} config.isActive - Initial state (alias: active)
     * @param {string} [config.className] - Custom CSS class
     * @param {string} [config.label] - Toggle label
     * @param {string} [config.title] - Tooltip
     * @param {Function} [config.onToggle] - Callback during the toggle
     * @returns {HTMLElement} - Created button element
     */
    createToggleButton(container: HTMLElement, config: ToggleButtonConfig) {
        // Support isActive ou active
        const isActive = config.isActive !== undefined ? config.isActive : config.active;
        const className = config.className || "gl-toggle-btn";

        const toggleBtn = domCreate("button", className, container);
        toggleBtn.type = "button";

        if (config.id) {
            toggleBtn.setAttribute("data-toggle-id", config.id);
        }

        toggleBtn.setAttribute("aria-pressed", isActive ? "true" : "false");

        if (config.title) {
            toggleBtn.title = config.title;
        }

        if (isActive) {
            toggleBtn.classList.add(className + "--on");
        }

        if (config.label) {
            toggleBtn.textContent = config.label;
        }

        // Attach the handler
        if (typeof config.onToggle === "function") {
            const className = config.className || "gl-toggle-btn";
            const onToggle = (ev: Event): void => {
                ev.stopPropagation();
                ev.preventDefault();

                const isActive = toggleBtn.classList.toggle(className + "--on");
                toggleBtn.setAttribute("aria-pressed", isActive ? "true" : "false");

                config.onToggle!(config.id, isActive, ev);
            };

            attachEventHandler(toggleBtn, "click", onToggle);
        }

        return toggleBtn;
    },

    attachEventHandler,
};

// ── ESM Export ──
export { _UIWidgets };

export type { AccordionConfig, ToggleButtonConfig };
