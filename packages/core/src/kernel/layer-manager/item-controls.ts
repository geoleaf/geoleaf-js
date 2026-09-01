/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerManager — Item Controls
 * Renders a section's items and their controls (toggle, label, style selector).
 *
 * Extracted from layer-manager/renderer.ts.
 */

import { StyleSelector } from "./style-selector.js";
import { _UIComponents } from "../ui/components.js";
import { emitLayerItemControls } from "./item-controls-seam.js";
import { checkLayerVisibility } from "./visibility-checker.js";
import { attachToggleHandler } from "./attach-toggle.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import type { LMSection, LMItem } from "./layer-manager-helpers.js";

/**
 * Renders a section's items into the DOM.
 */
function renderItems(section: LMSection, sectionEl: HTMLElement) {
    const listEl = domCreate("div", "gl-layer-manager__items", sectionEl);

    section.items.forEach((item: LMItem) => {
        const itemEl = domCreate("div", "gl-layer-manager__item", listEl);

        // Add the data-layer-id attribute to make DOM lookups easier
        if (item.id) {
            itemEl.setAttribute("data-layer-id", item.id);

            // Add the gl-layer--hidden class when the layer starts out hidden
            const isVisible = checkLayerVisibility(item.id);
            if (!isVisible) {
                itemEl.classList.add("gl-layer--hidden");
            }
        }

        // Main row container (always created, for the column layout)
        const mainRow = domCreate("div", "gl-layer-manager__item-row", itemEl);

        // Label
        const labelEl = domCreate("span", "gl-layer-manager__label", mainRow);
        labelEl.textContent = item.label || "";

        // Visibility toggle, for toggleable layers
        if (item.toggleable && item.id) {
            renderToggleControls(item, mainRow, itemEl);
        } else if (item.id) {
            // Non-toggleable layers: emit the control seam so capabilities
            // (e.g. labels) can inject their per-layer buttons.
            const controlsContainer = domCreate("div", "gl-layer-manager__item-controls", mainRow);
            emitLayerItemControls({ layerId: item.id, controlsContainer, toggleable: false });
        } else {
            // Complementary value/info for items without an id
            if (typeof item.value !== "undefined") {
                const valueEl = domCreate("span", "gl-layer-manager__value", itemEl);
                valueEl.textContent = String(item.value);
            }
        }
    });
}

/**
 * Renders an item's toggle controls (label button + toggle button + style selector).
 */
function renderToggleControls(item: LMItem, mainRow: HTMLElement, itemEl: HTMLElement) {
    // L.DomUtil guard removed (MapLibre only)
    const controlsContainer = domCreate("div", "gl-layer-manager__item-controls", mainRow);

    // Emit the control seam so capabilities (e.g. labels) can inject their
    // per-layer buttons before the visibility toggle is appended.
    if (item.id) emitLayerItemControls({ layerId: item.id, controlsContainer, toggleable: true });

    // Check the state initial
    const isActive = checkLayerVisibility(item.id);

    const toggleBtn = _UIComponents.createToggleButton(controlsContainer, {
        isActive: isActive,
        className: "gl-layer-manager__item-toggle",
        title: getLabel("aria.layer.toggle"),
    });

    // Attach the toggle handler (checkLayerVisibility injected as a callback)
    attachToggleHandler(
        toggleBtn as HTMLButtonElement & {
            _toggleHandlerAttached?: boolean;
            _isToggling?: boolean;
        },
        item.id,
        checkLayerVisibility
    );

    // Style selector, when available
    if (item.styles && StyleSelector && item.id) {
        const styleElement = StyleSelector.renderDOM(
            item as import("./style-selector.js").LayerItemForStyle
        );
        if (styleElement) {
            itemEl.appendChild(styleElement);
            StyleSelector.bindEvents(
                styleElement,
                item as import("./style-selector.js").LayerItemForStyle
            );
        }
    }
}

export { renderItems, renderToggleControls };
