/*!
 * GeoLeaf Core (feature-info capability) — Popup layout + tooltip text
 * © 2026 Mattieu Pottier — MIT License
 *
 * Two of the three reading surfaces: the anchored popup and the hover tooltip.
 *
 * ⚠️ This file used to hold a 17-entry dispatch table of its own. It holds none
 * now — every widget is rendered by `./widget-dispatch.js`, and what remains here
 * is LAYOUT: where the hero image goes, how consecutive badges are grouped, where
 * the "see details" affordance lands. That separation is the point of the
 * refactor: a widget renders the same way on every surface, and a surface decides
 * only where the rendered nodes land.
 *
 * The `gl-poi-popup*` class names and element nesting of the pre-extraction core
 * are preserved exactly.
 *
 * ⚠️ The tooltip lives here rather than beside `surfaces/tooltip.ts` for a
 * historical reason and no other — it was extracted with the popup. It is now a
 * two-line function over the shared text projection.
 * https://geoleaf.dev
 */

import { el, type RenderContext, type RenderField } from "./dom.js";
import { safeUrl } from "./dom.js";
import { formatFieldTextEscaped, isEmptyFieldValue, renderFieldNode } from "./widget-dispatch.js";
import { buildNormalizedModel, resolvePath, type NormalizedFeature } from "../resolve.js";

/**
 * Creates the popup body wrapper — the container every non-hero field and the
 * "see details" link live inside.
 *
 * @returns The empty body element.
 */
function createBody(): HTMLElement {
    return el("div", "gl-poi-popup__body");
}

/**
 * Builds the "see details" side-panel link.
 *
 * ⚠️ Its text is hard-coded French, served to all six languages. Known defect,
 * a known class in this repo, and it is on a deletion list rather
 * than fixed in passing here.
 *
 * @returns The link element.
 */
function buildVoirPlusLink(): HTMLElement {
    const a = el("a", "gl-poi-popup__link", { href: "#" });
    a.dataset["poiId"] = "";
    a.textContent = "Voir plus >>>";
    return a;
}

/**
 * Renders a hero image element for the popup, outside the body.
 *
 * @param field - Field configuration; `alt` provides the image alt text.
 * @param value - Already-resolved hero image URL.
 * @returns The hero `<img>` element, or `null` when the URL is empty or unsafe.
 */
function renderHeroImage(field: RenderField, value: unknown): HTMLElement | null {
    const src = safeUrl(value);
    if (!src) return null;
    return el("img", "gl-poi-popup__hero", {
        src,
        alt: typeof field.alt === "string" ? field.alt : "",
        loading: "lazy",
    });
}

/**
 * Builds the popup content element for a set of resolved fields.
 *
 * ```
 * <div class="gl-poi-popup">
 *   [<img class="gl-poi-popup__hero">]           ← hero, outside the body
 *   <div class="gl-poi-popup__body">
 *     <div class="gl-poi-popup__badges">…</div>   ← consecutive badges grouped
 *     [field nodes from the shared widget dispatch]
 *     <a class="gl-poi-popup__link">…</a>         ← last, only when hasSidepanel
 *   </div>
 * </div>
 * ```
 *
 * Only two widgets get special treatment, and both for LAYOUT reasons rather than
 * rendering ones: a hero image closes the current body and attaches to the root,
 * and consecutive badges are buffered into one row instead of being interleaved
 * with the text around them.
 *
 * @param fields - Render descriptors, in display order.
 * @param rawProperties - The feature's properties as they came from the source.
 * @param ctx - Render context — layer and feature identity, plus the click position.
 * @param opts - `hasSidepanel` tells the builder whether a "see details"
 *   affordance has anywhere to lead; without one, it is not rendered at all.
 * @returns The popup root element, ready to mount. Text is escaped at the sinks.
 */
export function buildPopupContent(
    fields: readonly RenderField[],
    rawProperties: Record<string, unknown>,
    ctx: RenderContext,
    opts: { hasSidepanel: boolean }
): HTMLElement {
    const model: NormalizedFeature = buildNormalizedModel(rawProperties);

    const root = el("div", "gl-poi-popup");

    let body: HTMLElement | null = null;
    let badgesContainer: HTMLElement | null = null;

    const flushBadges = (): void => {
        if (badgesContainer && body) {
            body.appendChild(badgesContainer);
            badgesContainer = null;
        }
    };
    const ensureBody = (): HTMLElement => {
        if (!body) body = createBody();
        return body;
    };

    for (const field of fields) {
        if (field.hidden) continue;

        const value = resolvePath(model, field.field);

        if (field.type === "image" && field.variant === "hero") {
            // A hero lives outside the body — flush and close the body first.
            flushBadges();
            if (body) {
                root.appendChild(body);
                body = null;
            }
            const heroEl = renderHeroImage(field, value);
            if (heroEl) root.appendChild(heroEl);
            continue;
        }

        if (field.type === "badge") {
            ensureBody();
            if (!badgesContainer) badgesContainer = el("div", "gl-poi-popup__badges");
            const badgeEl = renderFieldNode(field, value, ctx, "popup", rawProperties);
            if (badgeEl) badgesContainer.appendChild(badgeEl);
            continue;
        }

        const b = ensureBody();
        flushBadges();
        const fieldEl = renderFieldNode(field, value, ctx, "popup", rawProperties);
        if (fieldEl) b.appendChild(fieldEl);
    }

    const b = ensureBody();
    flushBadges();
    if (opts.hasSidepanel) b.appendChild(buildVoirPlusLink());
    root.appendChild(b);

    return root;
}

/**
 * Builds plain-text tooltip content — the surface with no DOM at all.
 *
 * ⚠️ This function used to be the THIRD rendering engine: it joined `String(value)`
 * with `" | "` and skipped exactly two widgets by name. That is why a `price`, a
 * `badge` or a `link` read as `[object Object]` in a tooltip — the same defect as
 * the popup's, on more widgets. It now delegates to the shared text projection, so
 * a value reads the same way here as anywhere else, and widgets with no text form
 * (a button, an image, a gallery) contribute nothing instead of contributing
 * noise.
 *
 * This IS the safe mode of FE-07: no anchors, no buttons, no interactive nodes —
 * not because they are stripped afterwards, but because a text surface never asks
 * for them.
 *
 * @param fields - Ordered field configurations for the tooltip surface.
 * @param rawProperties - Raw feature property bag, resolved per field.
 * @returns The pipe-separated, HTML-escaped tooltip text.
 */
export function buildTooltipText(
    fields: readonly RenderField[],
    rawProperties: Record<string, unknown>
): string {
    const model: NormalizedFeature = buildNormalizedModel(rawProperties);
    const parts: string[] = [];

    for (const field of fields) {
        if (field.hidden || !field.field) continue;

        const value = resolvePath(model, field.field);
        if (isEmptyFieldValue(value)) continue;

        const text = formatFieldTextEscaped(field, value);
        if (text) parts.push(text);
    }

    return parts.join(" | ");
}
