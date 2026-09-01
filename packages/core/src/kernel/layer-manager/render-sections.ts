/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * LayerManager — Section Renderer
 * Builds the legend sections' DOM (accordions, titles, basemap/item delegation).
 *
 * Extrait de layer-manager/renderer.ts.
 */

import { Log } from "../../utils/log/index.js";
import { DOMSecurity } from "../security/dom-security.js";
import { getLabel } from "../../utils/i18n/i18n.js";
import { BasemapSelector } from "./basemap-selector.js";
import { renderItems } from "./item-controls.js";
import type { LMSection } from "./layer-manager-helpers.js";
import { domCreate } from "../../utils/general/dom-helpers.js";

function _buildAccordionHeader(section: LMSection, sectionEl: HTMLElement): void {
    const accordionHeader = domCreate("div", "gl-layer-manager__accordion-header", sectionEl);
    const sectionTitle = domCreate("div", "gl-layer-manager__section-title", accordionHeader);
    sectionTitle.textContent = section.label!;
    const accordionArrow = domCreate("span", "gl-layer-manager__accordion-arrow", accordionHeader);
    accordionArrow.textContent = "▶";
    accordionHeader.addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const wasCollapsed = sectionEl.classList.contains("gl-layer-manager__section--collapsed");
        sectionEl.classList.toggle("gl-layer-manager__section--collapsed");
        accordionArrow.textContent = wasCollapsed ? "▼" : "▶";
        if (Log)
            Log.debug("[LayerManager] Accordion", section.id, wasCollapsed ? "opened" : "closed");
    });
}

function _renderSectionEl(section: LMSection, bodyEl: HTMLElement): void {
    const isCollapsible = typeof section.collapsedByDefault === "boolean";
    const isCollapsed = section.collapsedByDefault === true;
    const sectionEl = domCreate(
        "div",
        isCollapsible
            ? "gl-layer-manager__section gl-layer-manager__section--accordion"
            : "gl-layer-manager__section",
        bodyEl
    );
    if (isCollapsed) sectionEl.classList.add("gl-layer-manager__section--collapsed");
    if (section.label) {
        if (isCollapsible) _buildAccordionHeader(section, sectionEl);
        else {
            const sectionTitle = domCreate("div", "gl-layer-manager__section-title", sectionEl);
            sectionTitle.textContent = section.label;
        }
    }
    if (!Array.isArray(section.items) || section.items.length === 0) return;
    const sectionBody = isCollapsible
        ? domCreate("div", "gl-layer-manager__accordion-body", sectionEl)
        : sectionEl;
    if (section.id === "basemap") {
        if (BasemapSelector)
            BasemapSelector.render(
                section as import("./basemap-selector.js").BasemapSection,
                sectionBody
            );
    } else {
        renderItems(section, sectionBody);
    }
}

/**
 * Generates the DOM for the whole set of legend sections.
 */
function renderSections(bodyEl: HTMLElement | null, sections: LMSection[]) {
    if (!bodyEl) return;
    DOMSecurity.clearElementFast(bodyEl);
    if (!Array.isArray(sections) || sections.length === 0) {
        const emptyEl = domCreate("div", "gl-layer-manager__empty", bodyEl);
        emptyEl.textContent = getLabel("ui.layer_manager.empty");
        return;
    }
    sections
        .filter((s) => s.id !== "poi" && s.id !== "route")
        .forEach((section) => _renderSectionEl(section, bodyEl));
    // Label buttons are injected per item by the labels capability via the
    // `geoleaf:layer-item:controls` seam (emitted from renderItems), so no
    // post-render bulk sync is needed here.
}

export { renderSections };
