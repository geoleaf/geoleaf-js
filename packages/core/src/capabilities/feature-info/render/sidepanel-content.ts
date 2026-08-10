/*!
 * GeoLeaf Core (feature-info capability) — Side-panel layout
 * © 2026 Mattieu Pottier — MIT License
 *
 * The third reading surface: the side panel.
 *
 * ⚠️ This file used to hold a 19-entry dispatch table of lambdas, plus three value
 * formatters and an opening-hours renderer nobody else could reach. It holds none
 * of that now — every widget is rendered by `./widget-dispatch.js`, and what
 * remains here is LAYOUT: which fields survive an empty value, and which ones are
 * wrapped in a collapsible section.
 *
 * The `gl-poi-sidepanel__body` and `gl-accordion` structure of the pre-extraction
 * core is preserved exactly.
 * https://geoleaf.dev
 */

import { isTitleField, type RenderContext, type RenderField } from "./dom.js";
import { buildNormalizedModel, resolvePath } from "../resolve.js";
import { isEmptyFieldValue, renderFieldNode } from "./widget-dispatch.js";
import { attachGalleryEvents, attachSingleAccordionBehavior, lightbox } from "./lightbox.js";

/**
 * Wraps content in a collapsible accordion.
 *
 * @param field - Field configuration; provides the accordion label.
 * @param content - The rendered section content to nest inside the panel.
 * @param isOpen - Whether the accordion starts expanded.
 * @returns The `<details>` accordion element.
 */
function wrapInAccordion(field: RenderField, content: HTMLElement, isOpen: boolean): HTMLElement {
    const details = document.createElement("details");
    details.className = "gl-accordion";
    if (isOpen) details.setAttribute("open", "");

    const summary = document.createElement("summary");
    summary.className = "gl-accordion__header";
    summary.textContent = field.label || "Section";

    const arrow = document.createElement("span");
    arrow.className = "gl-accordion__arrow";
    arrow.textContent = "▼";
    summary.appendChild(arrow);

    const panel = document.createElement("div");
    panel.className = "gl-accordion__panel";

    const panelContent = document.createElement("div");
    panelContent.className = "gl-accordion__panel-content";
    panelContent.appendChild(content);

    panel.appendChild(panelContent);

    details.appendChild(summary);
    details.appendChild(panel);

    return details;
}

/**
 * Builds the side-panel body for a feature.
 *
 * For each field in order: resolve its value, skip it when empty EXCEPT for the two
 * required kinds (a title field and a badge), render it through the shared widget
 * dispatch, and wrap it in a collapsible section when the declaration asks for one.
 *
 * Gallery events are wired against the shared lightbox singleton afterwards, and
 * accordions get exclusive-open behaviour — opening one collapses the others.
 *
 * ⚠️ A field with no declared widget used to be dropped BEFORE the dispatch, which
 * is what made `"all"` render an empty panel: the implicit fallback emitted
 * descriptors carrying a path and nothing else, and every one of them was skipped
 * here. The guard is gone with `"all"` itself — an undeclared widget now defaults
 * to `text`, exactly as it always did on the popup, so the two surfaces agree.
 *
 * @param fields - Ordered field configurations, the resolved side-panel layout.
 * @param rawProperties - Raw feature property bag.
 * @param ctx - Per-surface render context.
 * @returns The populated `gl-poi-sidepanel__body` element.
 */
export function buildSidePanelBody(
    fields: readonly RenderField[],
    rawProperties: Record<string, unknown>,
    ctx: RenderContext
): HTMLElement {
    const body = document.createElement("div");
    body.className = "gl-poi-sidepanel__body";

    const model = buildNormalizedModel(rawProperties);

    for (const field of fields) {
        if (field.hidden) continue;

        const value = resolvePath(model, field.field);

        // A title and a badge render even when empty: the first anchors the panel,
        // the second is a category marker whose absence would read as a data error.
        const isRequiredField = isTitleField(field) || field.type === "badge";
        if (isEmptyFieldValue(value) && !isRequiredField) continue;

        const content = renderFieldNode(field, value, ctx, "sidepanel", rawProperties);
        if (!content) continue;

        if (field.accordion) {
            body.appendChild(wrapInAccordion(field, content, field.defaultOpen === true));
        } else {
            body.appendChild(content);
        }
    }

    attachGalleryEvents(body, lightbox);
    attachSingleAccordionBehavior(body);

    return body;
}
