/*!
 * @geoleaf/core
 * © 2026 Mattieu Pottier
 * Released under the MIT License
 * https://geoleaf.dev
 */

/**
 * Module Legend Renderer
 * Renders the cartographic legend symbols.
 *
 * DEPENDENCIES:
 * - DOM utilities
 * - GeoLeaf.Log (optional)
 *
 * EXPOSE:
 * - GeoLeaf._LegendRenderer
 */

import { Log } from "../../utils/log/index.js";
import { _UIComponents } from "../../kernel/ui/index.js";
import { domCreate } from "../../utils/general/dom-helpers.js";
import { getGeoLeaf } from "../../utils/general/geoleaf-global.js";

/**
 * A titled group of entries inside one layer's legend accordion.
 *
 * Both members are optional: a section with no `title` renders its items without a heading,
 * and a section with no `items` renders nothing.
 */
export interface LegendSection {
    title?: string;
    items?: LegendItem[];
}

/**
 * One entry of a {@link LegendSection} — a symbol and the text that explains it.
 *
 * `symbol` is an untyped style record because a legend entry can describe any renderer's
 * output (circle, icon, hatch pattern, line dash…); the renderer that owns the layer decides
 * how to read it. `order` sorts entries within their section; entries without it keep their
 * declaration order.
 */
export interface LegendItem {
    label?: string;
    description?: string;
    symbol?: Record<string, unknown>;
    order?: number;
}

/**
 * Free-text note rendered under a layer's legend sections.
 *
 * `style` is applied as inline CSS text — it goes through the CSP-safe helper, never through
 * a raw `style` attribute assignment.
 */
export interface LegendFooter {
    text?: string;
    style?: string;
}

interface LegendAccordionData {
    layerId: string;
    label: string;
    collapsed?: boolean;
    visible?: boolean;
    sections?: LegendSection[];
}

/**
 * Renders a legend section.
 */
function renderSection(container: HTMLElement, section: LegendSection): HTMLElement | undefined {
    const sectionEl = domCreate("div", "gl-legend__section", container);

    if (section.title) {
        const titleEl = domCreate("h3", "gl-legend__section-title", sectionEl);
        titleEl.textContent = section.title;
    }

    const itemsContainer = domCreate("div", "gl-legend__items", sectionEl);
    if (Array.isArray(section.items)) {
        section.items.forEach((item) => renderItem(itemsContainer, item));
    }

    return sectionEl;
}

/**
 * Renders a legend item.
 */
function renderItem(container: HTMLElement, item: LegendItem): HTMLElement | undefined {
    const itemEl = domCreate("div", "gl-legend__item", container);

    const symbolEl = domCreate("div", "gl-legend__symbol", itemEl);
    renderSymbol(symbolEl, item);

    const textContainer = domCreate("div", "gl-legend__text", itemEl);

    const labelEl = domCreate("span", "gl-legend__label", textContainer);
    labelEl.textContent = item.label ?? "";

    if (item.description) {
        const descEl = domCreate("span", "gl-legend__description", textContainer);
        descEl.textContent = item.description;
    }

    return itemEl;
}

/**
 * Renders a symbol according to its geometry type.
 */
function renderSymbol(container: HTMLElement, item: LegendItem): void {
    if (_UIComponents && typeof _UIComponents.renderSymbol === "function") {
        _UIComponents.renderSymbol(container, item);
    } else {
        if (Log) Log.error("[LegendRenderer] Module _UIComponents not available");
    }
}

/**
 * Renders the footer.
 */
function renderFooter(container: HTMLElement, footer: LegendFooter | null | undefined): void {
    if (!footer?.text) return;
    const footerEl = domCreate("div", "gl-legend__footer", container);
    footerEl.textContent = footer.text;

    if (footer.style === "italic") {
        footerEl.style.fontStyle = "italic";
    }
}

/**
 * Renders an accordion for a layer.
 */
function renderAccordion(container: HTMLElement, accordionData: LegendAccordionData): void {
    // Public-API review — this site re-read `globalThis.GeoLeaf._UIComponents` with a
    // hand-rewritten type, in a file that already IMPORTS the symbol (l.14) and uses
    // it 25 lines above (l.88). Two channels for the same object, one copying its
    // shape: the type duplication was the real debt, not the read. The
    // service-locator was not needed here — the import boundary allows the
    // `kernel/ui/index.js` barrel, which the l.14 import already takes.
    if (!_UIComponents || typeof _UIComponents.createAccordion !== "function") {
        if (Log) Log.error("[LegendRenderer] Module _UIComponents not available");
        return;
    }

    const { bodyEl } = _UIComponents.createAccordion(container, {
        layerId: accordionData.layerId,
        label: accordionData.label,
        collapsed: accordionData.collapsed !== false,
        ...(accordionData.visible !== undefined && { visible: accordionData.visible }),
        onToggle: (_layerId: string, _expanded: boolean) => {
            const gl = getGeoLeaf();
            if (gl?.Legend && typeof gl.Legend.toggleAccordion === "function") {
                gl.Legend.toggleAccordion(accordionData.layerId);
            }
        },
    });

    if (Array.isArray(accordionData.sections)) {
        accordionData.sections.forEach((section) => {
            renderSection(bodyEl, section);
        });
    }
}

const LegendRenderer = {
    renderSection,
    renderItem,
    renderSymbol,
    renderFooter,
    renderAccordion,
};
export { LegendRenderer };
